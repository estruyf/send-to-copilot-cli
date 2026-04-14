import * as vscode from "vscode";
import {
  refreshBridgeConnection,
  sendPromptViaSession,
} from "../utils/sessionBridge";

export function createSendSelectionToTerminal(
  outputChannel: vscode.OutputChannel,
) {
  return async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(
        "No active editor. Open a file and select text first.",
      );
      return;
    }

    const selection = editor.selection;
    const text = selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(selection);

    if (!text.trim()) {
      vscode.window.showWarningMessage(
        "No text to send. Select text or open a non-empty file.",
      );
      return;
    }

    await sendText(text, outputChannel);
  };
}

export function createSendFileToTerminal(outputChannel: vscode.OutputChannel) {
  return async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor. Open a file first.");
      return;
    }

    const text = editor.document.getText();
    if (!text.trim()) {
      vscode.window.showWarningMessage("The file is empty.");
      return;
    }

    await sendText(text, outputChannel);
  };
}

async function sendText(
  text: string,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const sent = await sendPromptViaSession(text, outputChannel);
  if (sent) {
    return;
  }

  const reconnected = await refreshBridgeConnection(outputChannel);
  if (reconnected) {
    const retried = await sendPromptViaSession(text, outputChannel);
    if (retried) {
      return;
    }
  }

  const action = await vscode.window.showWarningMessage(
    "No active Copilot CLI session found. Install the bridge extension and start a CLI session.",
    "Refresh Connection",
    "Install Bridge",
  );

  if (action === "Refresh Connection") {
    await vscode.commands.executeCommand(
      "send-to-copilot-cli.refreshConnection",
    );
  }

  if (action === "Install Bridge") {
    await vscode.commands.executeCommand("send-to-copilot-cli.installBridge");
  }
}
