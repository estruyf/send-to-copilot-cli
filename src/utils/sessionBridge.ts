import * as fs from "fs/promises";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

interface BridgeInfo {
  socketPath: string;
  pid: number;
  cwd: string;
  timestamp: number;
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
      const info: BridgeInfo = JSON.parse(content);
      if (isProcessRunning(info.pid)) {
        bridges.push(info);
      } else {
        await fs.unlink(filePath).catch(() => {});
      }
    } catch {
      // skip unreadable files
    }
  }

  return bridges;
}

/**
 * Find the best bridge for the current workspace.
 * Prefers bridges whose cwd overlaps with a workspace folder.
 */
async function findBridgeForWorkspace(): Promise<BridgeInfo | undefined> {
  const bridges = await findBridges();
  if (bridges.length === 0) {
    return undefined;
  }

  const workspaceFolders =
    vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];

  for (const bridge of bridges) {
    for (const folder of workspaceFolders) {
      if (bridge.cwd.startsWith(folder) || folder.startsWith(bridge.cwd)) {
        return bridge;
      }
    }
  }

  return undefined;
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
  const bridge = await findBridgeForWorkspace();
  if (!bridge) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
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
            const result = JSON.parse(body);
            resolve(result.ok === true);
          } catch {
            resolve(false);
          }
        });
      },
    );

    req.on("error", (err) => {
      outputChannel.appendLine(
        `[SessionBridge] Failed to send prompt: ${err.message}`,
      );
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}
