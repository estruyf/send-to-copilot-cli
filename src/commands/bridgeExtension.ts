import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_NAME = "vscode-prompt-bridge";
const EXTENSION_FILE = "extension.mjs";

type InstallLocation = "global" | "workspace";

export interface BridgeInstallationState {
  installedCount: number;
  outdatedCount: number;
}

function getGlobalExtensionDir(): string {
  return path.join(os.homedir(), ".copilot", "extensions", EXTENSION_NAME);
}

function getWorkspaceExtensionDir(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return path.join(folder.uri.fsPath, ".github", "extensions", EXTENSION_NAME);
}

function getExtensionDir(location: InstallLocation): string | undefined {
  return location === "global"
    ? getGlobalExtensionDir()
    : getWorkspaceExtensionDir();
}

// Embedded CLI extension source
const EXTENSION_SOURCE = `/**
 * VS Code Prompt Bridge — Copilot CLI Extension
 *
 * Receives prompts from VS Code and injects them into the active CLI session
 * using session.send() from the Copilot CLI SDK.
 *
 * VS Code extension ──HTTP POST──▶ this bridge ──session.send()──▶ CLI session
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";

const BRIDGE_DIR = join(
  process.env.XDG_STATE_HOME || homedir(),
  ".copilot",
  "cli-bridge"
);
const BRIDGE_ID = randomUUID();
const BRIDGE_FILE = join(BRIDGE_DIR, BRIDGE_ID + ".json");
const socketPath =
  platform() === "win32"
    ? "\\\\\\\\.\\\\pipe\\\\copilot-bridge-" + BRIDGE_ID
    : join(tmpdir(), "copilot-bridge-" + BRIDGE_ID.slice(0, 8) + ".sock");

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        "[vscode-prompt-bridge] VS Code prompt bridge is active. " +
        "Prompts from VS Code will be injected into this session.",
    }),
    onSessionEnd: async () => {
      cleanup();
      return null;
    },
  },
});

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/send") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { prompt } = JSON.parse(body);
      if (!prompt || typeof prompt !== "string") {
        res.writeHead(400).end(JSON.stringify({ ok: false }));
        return;
      }
      setTimeout(() => session.send({ prompt }).catch(() => {}), 0);
      res.writeHead(200).end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400).end(JSON.stringify({ ok: false }));
    }
  });
});

server.listen(socketPath, () => {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  writeFileSync(
    BRIDGE_FILE,
    JSON.stringify({
      socketPath,
      pid: process.pid,
      cwd: process.cwd(),
      timestamp: Date.now(),
    }),
    { mode: 0o600 }
  );
  session.log("🔗 VS Code prompt bridge ready");
});

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  try { unlinkSync(BRIDGE_FILE); } catch {}
  server.close();
}
process.on("exit", cleanup);
process.on("SIGTERM", () => { cleanup(); process.exit(); });
process.on("SIGINT", () => { cleanup(); process.exit(); });
`;

const EXTENSION_HASH = crypto
  .createHash("sha256")
  .update(EXTENSION_SOURCE)
  .digest("hex")
  .slice(0, 12);

async function pickLocation(): Promise<InstallLocation | undefined> {
  const items: vscode.QuickPickItem[] = [
    {
      label: "$(home) Global",
      description: "~/.copilot/extensions/",
      detail: "Available in all projects",
    },
    {
      label: "$(folder) Workspace",
      description: ".github/extensions/",
      detail: "Available only in this project (committed to repo)",
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Where should the CLI bridge extension be installed?",
  });

  if (!picked) {
    return undefined;
  }

  return picked.label.includes("Global") ? "global" : "workspace";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findInstalled(): Promise<
  { location: InstallLocation; dir: string }[]
> {
  const found: { location: InstallLocation; dir: string }[] = [];

  const globalDir = getGlobalExtensionDir();
  if (await exists(path.join(globalDir, EXTENSION_FILE))) {
    found.push({ location: "global", dir: globalDir });
  }

  const wsDir = getWorkspaceExtensionDir();
  if (wsDir && (await exists(path.join(wsDir, EXTENSION_FILE)))) {
    found.push({ location: "workspace", dir: wsDir });
  }

  return found;
}

export async function getBridgeInstallationState(): Promise<BridgeInstallationState> {
  const installed = await findInstalled();

  let outdatedCount = 0;
  for (const { dir } of installed) {
    const hashPath = path.join(dir, ".hash");
    const currentHash = await fs.readFile(hashPath, "utf-8").catch(() => "");
    if (currentHash.trim() !== EXTENSION_HASH) {
      outdatedCount++;
    }
  }

  return {
    installedCount: installed.length,
    outdatedCount,
  };
}

export async function promptForBridgeInstallOrUpdate(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const extensionVersion = String(context.extension.packageJSON.version ?? "0");
  const installPromptKey = `bridge.installPrompt.dismissed.${extensionVersion}`;
  const updatePromptKey = `bridge.updatePrompt.dismissed.${EXTENSION_HASH}`;

  const state = await getBridgeInstallationState();

  if (state.installedCount === 0) {
    const installDismissed = context.globalState.get<boolean>(installPromptKey, false);
    if (installDismissed) {
      return;
    }

    const picked = await vscode.window.showInformationMessage(
      "Install the Copilot CLI bridge extension now to enable sending prompts directly from VS Code?",
      "Install",
      "Not now",
    );

    if (picked === "Install") {
      await vscode.commands.executeCommand("send-to-copilot-cli.installBridge");
    } else {
      await context.globalState.update(installPromptKey, true);
    }

    return;
  }

  if (state.outdatedCount > 0) {
    const updateDismissed = context.globalState.get<boolean>(updatePromptKey, false);
    if (updateDismissed) {
      return;
    }

    const picked = await vscode.window.showInformationMessage(
      `An updated Copilot CLI bridge extension is available (${state.outdatedCount} location${state.outdatedCount > 1 ? "s" : ""}). Update now?`,
      "Update",
      "Not now",
    );

    if (picked === "Update") {
      await vscode.commands.executeCommand("send-to-copilot-cli.updateBridge");
    } else {
      await context.globalState.update(updatePromptKey, true);
      outputChannel.appendLine("[Bridge] User postponed bridge update prompt.");
    }
  }
}

export function createInstallBridgeCommand(
  outputChannel: vscode.OutputChannel,
) {
  return async (): Promise<void> => {
    const location = await pickLocation();
    if (!location) {
      return;
    }

    const dir = getExtensionDir(location);
    if (!dir) {
      vscode.window.showWarningMessage(
        "No workspace folder open. Open a folder first for workspace install.",
      );
      return;
    }

    if (await exists(path.join(dir, EXTENSION_FILE))) {
      const overwrite = await vscode.window.showWarningMessage(
        `CLI bridge extension already installed at ${location} location. Overwrite?`,
        "Overwrite",
        "Cancel",
      );
      if (overwrite !== "Overwrite") {
        return;
      }
    }

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, EXTENSION_FILE), EXTENSION_SOURCE);
      await fs.writeFile(path.join(dir, ".hash"), EXTENSION_HASH);

      outputChannel.appendLine(`[Bridge] Installed CLI extension to ${dir}`);
      vscode.window.showInformationMessage(
        `CLI bridge extension installed (${location}). Restart any active CLI sessions to load it.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[Bridge] Install failed: ${msg}`);
      vscode.window.showErrorMessage(
        `Failed to install CLI bridge extension: ${msg}`,
      );
    }
  };
}

export function createUpdateBridgeCommand(outputChannel: vscode.OutputChannel) {
  return async (): Promise<void> => {
    const installed = await findInstalled();

    if (installed.length === 0) {
      vscode.window.showWarningMessage(
        "CLI bridge extension is not installed. Use the install command first.",
      );
      return;
    }

    let updated = 0;
    for (const { location, dir } of installed) {
      const hashPath = path.join(dir, ".hash");
      const currentHash = await fs.readFile(hashPath, "utf-8").catch(() => "");

      if (currentHash.trim() === EXTENSION_HASH) {
        continue;
      }

      await fs.writeFile(path.join(dir, EXTENSION_FILE), EXTENSION_SOURCE);
      await fs.writeFile(hashPath, EXTENSION_HASH);
      outputChannel.appendLine(`[Bridge] Updated CLI extension at ${dir}`);
      updated++;
    }

    if (updated > 0) {
      vscode.window.showInformationMessage(
        `CLI bridge extension updated (${updated} location${updated > 1 ? "s" : ""}). Restart any active CLI sessions to pick up changes.`,
      );
    } else {
      vscode.window.showInformationMessage(
        "CLI bridge extension is already up to date.",
      );
    }
  };
}

export function createUninstallBridgeCommand(
  outputChannel: vscode.OutputChannel,
) {
  return async (): Promise<void> => {
    const installed = await findInstalled();

    if (installed.length === 0) {
      vscode.window.showWarningMessage(
        "CLI bridge extension is not installed.",
      );
      return;
    }

    let items: (vscode.QuickPickItem & { location: InstallLocation })[];
    if (installed.length === 1) {
      items = installed.map((i) => ({
        label:
          i.location === "global" ? "$(home) Global" : "$(folder) Workspace",
        description: i.dir,
        location: i.location,
      }));
    } else {
      items = installed.map((i) => ({
        label:
          i.location === "global" ? "$(home) Global" : "$(folder) Workspace",
        description: i.dir,
        location: i.location,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Which installation should be removed?",
      });
      if (!picked) {
        return;
      }
      items = [picked];
    }

    for (const item of items) {
      const dir =
        item.location === "global"
          ? getGlobalExtensionDir()
          : getWorkspaceExtensionDir();
      if (!dir) {
        continue;
      }

      try {
        await fs.rm(dir, { recursive: true, force: true });
        outputChannel.appendLine(
          `[Bridge] Uninstalled CLI extension from ${dir}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[Bridge] Uninstall failed: ${msg}`);
        vscode.window.showErrorMessage(
          `Failed to uninstall CLI bridge extension: ${msg}`,
        );
        return;
      }
    }

    vscode.window.showInformationMessage("CLI bridge extension uninstalled.");
  };
}
