import * as fs from "fs/promises";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

interface BridgeInfo {
  discoveryFile: string;
  socketPath: string;
  pid: number;
  cwd: string;
  timestamp?: number;
}

function getBridgeDir(): string {
  const xdgHome = process.env.XDG_STATE_HOME;
  return xdgHome
    ? path.join(xdgHome, ".copilot", "cli-bridge")
    : path.join(os.homedir(), ".copilot", "cli-bridge");
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find active CLI bridge endpoints by scanning discovery files.
 * Cleans up stale entries whose process has exited.
 */
async function findBridges(): Promise<BridgeInfo[]> {
  const dir = getBridgeDir();

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const bridges: BridgeInfo[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(dir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const info = JSON.parse(content) as Omit<BridgeInfo, "discoveryFile">;
      if (isProcessRunning(info.pid)) {
        bridges.push({ ...info, discoveryFile: filePath });
      } else {
        await fs.unlink(filePath).catch(() => {});
      }
    } catch {
      // skip unreadable files
    }
  }

  // Prefer the newest session when multiple bridges are available.
  bridges.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  return bridges;
}

/**
 * Find candidate bridges for the current workspace.
 * Prefer bridges whose cwd overlaps with a workspace folder.
 */
async function findBridgesForWorkspace(): Promise<BridgeInfo[]> {
  const bridges = await findBridges();
  if (bridges.length === 0) {
    return [];
  }

  const workspaceFolders =
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];

  if (workspaceFolders.length === 0) {
    return bridges;
  }

  const matching: BridgeInfo[] = [];
  const nonMatching: BridgeInfo[] = [];

  for (const bridge of bridges) {
    let matches = false;
    for (const folder of workspaceFolders) {
      if (bridge.cwd.startsWith(folder) || folder.startsWith(bridge.cwd)) {
        matches = true;
        break;
      }
    }

    if (matches) {
      matching.push(bridge);
    } else {
      nonMatching.push(bridge);
    }
  }

  return [...matching, ...nonMatching];
}

function isStaleSocketError(err: NodeJS.ErrnoException): boolean {
  return err.code === "ENOENT" || err.code === "ECONNREFUSED";
}

async function postPromptToBridge(
  bridge: BridgeInfo,
  text: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const payload = JSON.stringify({ prompt: text });
    const req = http.request(
      {
        socketPath: bridge.socketPath,
        path: "/send",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(body) as { ok?: boolean };
            resolve(result.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );

    req.on("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send a prompt to the active CLI session via the CLI SDK bridge.
 * Returns `true` if the prompt was accepted, `false` if no bridge
 * was available or the request failed (caller should fall back).
 */
export async function sendPromptViaSession(
  text: string,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  const bridges = await findBridgesForWorkspace();
  if (bridges.length === 0) {
    return false;
  }

  for (const bridge of bridges) {
    try {
      const sent = await postPromptToBridge(bridge, text);
      if (sent) {
        return true;
      }
    } catch (err) {
      const socketErr = err as NodeJS.ErrnoException;
      if (isStaleSocketError(socketErr)) {
        // Remove stale bridge metadata so future sends don't select dead endpoints.
        await fs.unlink(bridge.discoveryFile).catch(() => {});
      }

      outputChannel.appendLine(
        `[SessionBridge] Failed to send prompt via ${bridge.socketPath}: ${socketErr.message}`,
      );
    }
  }

  return false;
}
