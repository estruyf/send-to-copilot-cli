import * as vscode from "vscode";
import {
  createSendSelectionToTerminal,
  createSendFileToTerminal,
} from "./commands/sendToTerminal";
import {
  createInstallBridgeCommand,
  promptForBridgeInstallOrUpdate,
  createUpdateBridgeCommand,
  createUninstallBridgeCommand,
} from "./commands/bridgeExtension";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel(
    "Send to Copilot CLI",
  );
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "send-to-copilot-cli.sendSelection",
      createSendSelectionToTerminal(outputChannel),
    ),
    vscode.commands.registerCommand(
      "send-to-copilot-cli.sendFileContent",
      createSendFileToTerminal(outputChannel),
    ),
    vscode.commands.registerCommand(
      "send-to-copilot-cli.installBridge",
      createInstallBridgeCommand(outputChannel),
    ),
    vscode.commands.registerCommand(
      "send-to-copilot-cli.updateBridge",
      createUpdateBridgeCommand(outputChannel),
    ),
    vscode.commands.registerCommand(
      "send-to-copilot-cli.uninstallBridge",
      createUninstallBridgeCommand(outputChannel),
    ),
  );

  await promptForBridgeInstallOrUpdate(context, outputChannel);
}

export async function deactivate() {}
