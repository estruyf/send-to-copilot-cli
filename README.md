# Send to Copilot CLI

Compose prompts in VS Code. Send them to your Copilot CLI session with one click.

## Why?

Writing prompts directly in the terminal is awkward. One accidental <kbd>Enter</kbd> and your half-finished prompt is sent. You can't easily select, rearrange, or paste code snippets. And if you're building a multi-line prompt with context from multiple files, the terminal input line just isn't built for that.

This extension lets you **write your prompts in a VS Code editor** — a virtual/scratch document, an untitled file, or any file you have open — and send the content (or a selection) straight into your active Copilot CLI session. You get all the editing power of VS Code (multi-cursor, find & replace, snippets) for crafting the perfect prompt, and the CLI gets the final result.

## How it works

The extension pairs with a small **CLI bridge extension** that runs inside your Copilot CLI session. When the CLI starts, the bridge opens a local connection and registers itself. When you send text from VS Code, the extension discovers the bridge and injects your prompt into the active session using `session.send()` from the Copilot CLI SDK.

```
VS Code editor ──▶ VS Code extension ──HTTP──▶ CLI bridge extension ──session.send()──▶ Copilot CLI
```

The bridge is a lightweight Copilot CLI extension, which is a single `.mjs` file that the CLI loads automatically. No npm install required; the CLI runtime resolves `@github/copilot-sdk` on its own.

## Getting started

### 1. Install the VS Code extension

Install **Send to Copilot CLI** from the VS Code Marketplace (or build from source).

### 2. Install the CLI bridge extension

Open the Command Palette (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) and run:

```
Send to Copilot CLI: Install Bridge Extension
```

You'll be asked where to install:

| Location | Path | Scope |
|----------|------|-------|
| **Global** | `~/.copilot/extensions/vscode-prompt-bridge/` | Available in all projects |
| **Workspace** | `.github/extensions/vscode-prompt-bridge/` | Available only in this repo (can be committed) |

### 3. Start a CLI session

Open a terminal and start the Copilot CLI (`copilot`). The bridge extension loads automatically and you'll see:

```
🔗 VS Code prompt bridge ready
```

### 4. Send your prompt

1. Open (or create) a file in VS Code (an untitled scratch file works great)
2. Write your prompt
3. Right-click → **Send to Copilot CLI** → **Send Selection**, or use the Command Palette
4. Your prompt appears in the CLI session

> **Tip:** If nothing is selected, the **Send Selection** command sends the entire file content.

## Commands

| Command | Description |
|---------|-------------|
| **Send Selection to Terminal** | Send the current selection (or entire file) to the CLI session |
| **Send File Content to Terminal** | Send the full file content to the CLI session |
| **Install Bridge Extension** | Install the CLI bridge (global or workspace) |
| **Update Bridge Extension** | Update installed bridges to the latest version |
| **Uninstall Bridge Extension** | Remove the CLI bridge from a chosen location |
| **Refresh Connection** | Re-scan and reconnect to an active Copilot CLI bridge session |

All commands are available in the Command Palette under the `Send to Copilot CLI:` prefix and in the editor right-click context menu.

## Requirements

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) with extension support
- The CLI bridge extension (installed via the **Install Bridge Extension** command)

## Resources

- [Complete Guide to GitHub Copilot CLI Extensions](https://htek.dev/articles/github-copilot-cli-extensions-complete-guide)

## License

MIT License. See [LICENSE](LICENSE) for details.