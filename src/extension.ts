/**
 * AM I GOOD AT VIBE — VS Code activation entrypoint.
 *
 * Wires modules together: capture (terminal, pseudoterminal, code change,
 * chat participant), analyzer, sidebar + report webviews. All cross-cutting
 * state (HistoryStore, SecretMasker, OutputChannel) is created here and
 * injected into the modules. Heavy logic lives in ./capture, ./store,
 * ./analyzer, ./webview, ./chat.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { Config } from "./config";
import { initLogger, getLogChannel, disposeLogger, log } from "./logger";
import { randomSessionId } from "./util";
import { HistoryStore, SecretMasker } from "./store/logStore";
import { TerminalCapture } from "./capture/terminal";
import { AmIGoodAtVibePseudoterminal } from "./capture/pseudoterminal";
import { CodeChangeCapture } from "./capture/codeChange";
import { OwnChatCapture } from "./chat/ownChatParticipant";
import { HabitAnalyzer } from "./analyzer/runAnalysis";
import { SidebarWebviewProvider } from "./webview/sidebar";
import { collectExtensionChatTurns, sqlite3Available } from "./extensionCache";
import {
  LogEntry,
  extractedTurnToLogEntry,
  STORAGE_DIR_NAME,
  RAW_HISTORY_FILE,
  EXTENSION_DISPLAY_NAME,
  VERSION,
} from "./types";

let historyStoreSingleton: HistoryStore | null = null;

export function activate(ctx: vscode.ExtensionContext): void {
  // Initialize the OutputChannel — users can diagnose via [View → Output → AM I GOOD AT VIBE]
  const logChannel = initLogger();
  ctx.subscriptions.push(logChannel);
  log("==========================================");
  log(`🚀 ${EXTENSION_DISPLAY_NAME} activation started`);
  log("VS Code version:", vscode.version);
  log("Platform:", process.platform, "/ shell:", process.env.SHELL || "(unknown)");
  log("Workspace folders:", vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ?? "(none)");

  // Fall back to home directory if no workspace is open
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    path.join(os.homedir(), `${STORAGE_DIR_NAME}-workspace`);
  log("Log file location:", path.join(workspaceRoot, STORAGE_DIR_NAME, RAW_HISTORY_FILE));

  const masker = new SecretMasker();
  const store = new HistoryStore(workspaceRoot);
  historyStoreSingleton = store;

  const terminalCapture = new TerminalCapture(store, masker);
  const ownChat = new OwnChatCapture(store, masker);
  const codeChange = new CodeChangeCapture(store, masker);
  const analyzer = new HabitAnalyzer(store, workspaceRoot);

  // Start capture
  for (const d of terminalCapture.start()) ctx.subscriptions.push(d);
  for (const d of ownChat.start())         ctx.subscriptions.push(d);
  for (const d of codeChange.start())      ctx.subscriptions.push(d);

  // ---- AM I GOOD AT VIBE Capture Terminal (Pseudoterminal Profile) — opt-in 100% capture ----
  ctx.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("amigoodatvibe.captureTerminal", {
      provideTerminalProfile: () => {
        log(`🔒 ${EXTENSION_DISPLAY_NAME} Capture Terminal instance created`);
        return new vscode.TerminalProfile({
          name: `${EXTENSION_DISPLAY_NAME} Capture`,
          pty: new AmIGoodAtVibePseudoterminal(store, masker, workspaceRoot),
        });
      },
    })
  );

  // ---- Commands ----
  ctx.subscriptions.push(
    vscode.commands.registerCommand("amigoodatvibe.analyzeHabits", () =>
      analyzer.run(ctx)
    ),
    vscode.commands.registerCommand("amigoodatvibe.openLog", async () => {
      const filePath = store.filePath();
      if (!fs.existsSync(filePath)) {
        vscode.window.showInformationMessage(
          `${EXTENSION_DISPLAY_NAME}: no log entries yet. Check View → Output → ${EXTENSION_DISPLAY_NAME} for diagnostic logs.`
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(filePath);
      vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand("amigoodatvibe.clearLog", async () => {
      const ok = await vscode.window.showWarningMessage(
        `${EXTENSION_DISPLAY_NAME}: delete all accumulated log entries?`,
        { modal: true },
        "Delete"
      );
      if (ok === "Delete") {
        await store.clear();
        vscode.window.showInformationMessage(`${EXTENSION_DISPLAY_NAME}: log cleared.`);
      }
    }),
    vscode.commands.registerCommand("amigoodatvibe.runDiagnostics", async () => {
      const startEvt = (vscode.window as unknown as Record<string, unknown>)
        .onDidStartTerminalShellExecution;
      const writeEvt = (vscode.window as unknown as Record<string, unknown>)
        .onDidWriteTerminalData;
      const shellIntegConfig = vscode.workspace
        .getConfiguration("terminal.integrated.shellIntegration")
        .get<boolean>("enabled", true);
      const lines = [
        `=== ${EXTENSION_DISPLAY_NAME} diagnostics ===`,
        `VS Code version: ${vscode.version}`,
        `Shell Integration setting: ${shellIntegConfig ? "ON" : "OFF"}`,
        `onDidStartTerminalShellExecution stable API: ${startEvt ? "✅ available" : "❌ unavailable"}`,
        `onDidWriteTerminalData proposed API: ${writeEvt ? "✅ active" : "❌ inactive (normal)"}`,
        `Auto-capture: ${Config.autoCapture() ? "ON" : "OFF"}`,
        `Masking: ${Config.maskingEnabled() ? "ON" : "OFF"}`,
        `Log file: ${store.filePath()}`,
        `Log file exists: ${fs.existsSync(store.filePath()) ? "YES" : "NO"}`,
        "",
        "💡 If capture isn't working:",
        "  1) Make sure you're using VS Code's built-in integrated terminal (external Terminal.app/iTerm won't be detected)",
        "  2) A small dot next to the integrated terminal prompt = Shell Integration is active",
        `  3) Still not working? Open '+ New Terminal' dropdown → choose '${EXTENSION_DISPLAY_NAME} Capture' for 100% capture`,
      ];
      log(lines.join("\n"));
      getLogChannel()?.show(true);
      vscode.window.showInformationMessage(
        `${EXTENSION_DISPLAY_NAME} diagnostics: stable=${startEvt ? "✅" : "❌"} / proposed=${writeEvt ? "✅" : "❌"} / shellInteg=${shellIntegConfig ? "✅" : "❌"}. See the Output channel for details.`
      );
    }),
    vscode.commands.registerCommand("amigoodatvibe.importExtensionCache", async () => {
      if (!sqlite3Available()) {
        vscode.window.showWarningMessage(
          `${EXTENSION_DISPLAY_NAME}: the system \`sqlite3\` CLI was not found on PATH. ` +
          "macOS / Linux ship it by default; on Windows, install it from sqlite.org."
        );
        return;
      }
      const before = store.stats().aiChats;
      const fallbackSessionId = randomSessionId();
      const diagnostics: string[] = [];
      const report = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `${EXTENSION_DISPLAY_NAME}: reading IDE extension chat caches...`,
          cancellable: false,
        },
        async () =>
          collectExtensionChatTurns({
            workspaceFsPath: workspaceRoot,
            mask: (s) => masker.mask(s),
            onDiagnostic: (m) => diagnostics.push(m),
          })
      );
      for (const line of diagnostics) log("[extensionCache]", line);
      for (const t of report.turns) {
        store.append({
          ts: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(),
          type: "ai_chat",
          turn: t.turn,
          source: "gui",
          tool: t.tool,
          sessionId: t.sessionId ?? fallbackSessionId,
          content: t.content,
        });
      }
      const added = store.stats().aiChats - before;
      vscode.window.showInformationMessage(
        `${EXTENSION_DISPLAY_NAME}: imported ${added} chat turn(s) from ${report.inspectedDbs} DB file(s). ` +
        `Matched key group(s): ${report.matchedKeys}.`
      );
    }),
    vscode.commands.registerCommand("amigoodatvibe.analyzeFromClaudeLog", async () => {
      // Read Claude Code / Copilot / Cursor chat for this workspace and pass
      // it to the analyzer alongside the in-memory capture log. We *don't*
      // persist these external turns to raw_history.json — keeping the file
      // small and avoiding the previous failure mode where a huge sync flush
      // would silently drop turns.
      if (!sqlite3Available()) {
        log("[analyzeFromClaudeLog] sqlite3 missing — skipping SQLite sources but Claude Code JSONL still works");
      }
      const report = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `${EXTENSION_DISPLAY_NAME}: reading existing AI chat history...`,
          cancellable: false,
        },
        async () =>
          collectExtensionChatTurns({
            workspaceFsPath: workspaceRoot,
            mask: (s) => masker.mask(s),
          })
      );
      const extraEntries: LogEntry[] = report.turns.map(extractedTurnToLogEntry);
      log(
        `[analyzeFromClaudeLog] collected ${extraEntries.length} chat turn(s) ` +
          `from ${report.inspectedClaudeCodeFiles} Claude Code file(s) + ` +
          `${report.inspectedDbs} SQLite DB(s) + ${report.inspectedSessionFiles} chatSessions file(s)`
      );
      await analyzer.run(ctx, extraEntries);
    }),
    vscode.commands.registerCommand("amigoodatvibe.startFresh", async () => {
      const ok = await vscode.window.showWarningMessage(
        `${EXTENSION_DISPLAY_NAME}: clear all captured logs and start with an empty history for this project? Existing IDE / Claude Code sessions on disk are NOT deleted — they just won't be imported.`,
        { modal: true },
        "Start Fresh"
      );
      if (ok === "Start Fresh") {
        await store.clear();
        vscode.window.showInformationMessage(
          `${EXTENSION_DISPLAY_NAME}: log cleared. New AI CLI / @amigoodatvibe turns will be captured from now on.`
        );
      }
    })
  );

  // Sidebar — rich webview-based UI (main CTA + stats + recent activity)
  const sidebarProvider = new SidebarWebviewProvider(ctx, store, masker, workspaceRoot);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarWebviewProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Safe flush on shutdown
  ctx.subscriptions.push({
    dispose: () => store.dispose(),
  });

  // Persistent status-bar item — lets the user see which version is active
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = `$(pulse) ${EXTENSION_DISPLAY_NAME} v${VERSION}`;
  statusBar.tooltip = `${EXTENSION_DISPLAY_NAME} v${VERSION} — click for diagnostics`;
  statusBar.command = "amigoodatvibe.runDiagnostics";
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  log(`✅ ${EXTENSION_DISPLAY_NAME} v${VERSION} activated`);
}

export function deactivate(): void {
  log(`👋 ${EXTENSION_DISPLAY_NAME} deactivate`);
  if (historyStoreSingleton) {
    historyStoreSingleton.dispose();
    historyStoreSingleton = null;
  }
  disposeLogger();
}
