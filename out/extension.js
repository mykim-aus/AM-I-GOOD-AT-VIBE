"use strict";
/**
 * AM I GOOD AT VIBE — VS Code activation entrypoint.
 *
 * Wires modules together: capture (terminal, pseudoterminal, code change,
 * chat participant), analyzer, sidebar + report webviews. All cross-cutting
 * state (HistoryStore, SecretMasker, OutputChannel) is created here and
 * injected into the modules. Heavy logic lives in ./capture, ./store,
 * ./analyzer, ./webview, ./chat.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const util_1 = require("./util");
const logStore_1 = require("./store/logStore");
const terminal_1 = require("./capture/terminal");
const pseudoterminal_1 = require("./capture/pseudoterminal");
const codeChange_1 = require("./capture/codeChange");
const ownChatParticipant_1 = require("./chat/ownChatParticipant");
const runAnalysis_1 = require("./analyzer/runAnalysis");
const sidebar_1 = require("./webview/sidebar");
const extensionCache_1 = require("./extensionCache");
const types_1 = require("./types");
let historyStoreSingleton = null;
function activate(ctx) {
    // Initialize the OutputChannel — users can diagnose via [View → Output → AM I GOOD AT VIBE]
    const logChannel = (0, logger_1.initLogger)();
    ctx.subscriptions.push(logChannel);
    (0, logger_1.log)("==========================================");
    (0, logger_1.log)(`🚀 ${types_1.EXTENSION_DISPLAY_NAME} activation started`);
    (0, logger_1.log)("VS Code version:", vscode.version);
    (0, logger_1.log)("Platform:", process.platform, "/ shell:", process.env.SHELL || "(unknown)");
    (0, logger_1.log)("Workspace folders:", vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ?? "(none)");
    // Fall back to home directory if no workspace is open
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        path.join(os.homedir(), `${types_1.STORAGE_DIR_NAME}-workspace`);
    (0, logger_1.log)("Log file location:", path.join(workspaceRoot, types_1.STORAGE_DIR_NAME, types_1.RAW_HISTORY_FILE));
    const masker = new logStore_1.SecretMasker();
    const store = new logStore_1.HistoryStore(workspaceRoot);
    historyStoreSingleton = store;
    const terminalCapture = new terminal_1.TerminalCapture(store, masker);
    const ownChat = new ownChatParticipant_1.OwnChatCapture(store, masker);
    const codeChange = new codeChange_1.CodeChangeCapture(store, masker);
    const analyzer = new runAnalysis_1.HabitAnalyzer(store, workspaceRoot);
    // Start capture
    for (const d of terminalCapture.start())
        ctx.subscriptions.push(d);
    for (const d of ownChat.start())
        ctx.subscriptions.push(d);
    for (const d of codeChange.start())
        ctx.subscriptions.push(d);
    // ---- AM I GOOD AT VIBE Capture Terminal (Pseudoterminal Profile) — opt-in 100% capture ----
    ctx.subscriptions.push(vscode.window.registerTerminalProfileProvider("amigoodatvibe.captureTerminal", {
        provideTerminalProfile: () => {
            (0, logger_1.log)(`🔒 ${types_1.EXTENSION_DISPLAY_NAME} Capture Terminal instance created`);
            return new vscode.TerminalProfile({
                name: `${types_1.EXTENSION_DISPLAY_NAME} Capture`,
                pty: new pseudoterminal_1.AmIGoodAtVibePseudoterminal(store, masker, workspaceRoot),
            });
        },
    }));
    // ---- Commands ----
    ctx.subscriptions.push(vscode.commands.registerCommand("amigoodatvibe.analyzeHabits", () => analyzer.run(ctx)), vscode.commands.registerCommand("amigoodatvibe.openLog", async () => {
        const filePath = store.filePath();
        if (!fs.existsSync(filePath)) {
            vscode.window.showInformationMessage(`${types_1.EXTENSION_DISPLAY_NAME}: no log entries yet. Check View → Output → ${types_1.EXTENSION_DISPLAY_NAME} for diagnostic logs.`);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(filePath);
        vscode.window.showTextDocument(doc);
    }), vscode.commands.registerCommand("amigoodatvibe.clearLog", async () => {
        const ok = await vscode.window.showWarningMessage(`${types_1.EXTENSION_DISPLAY_NAME}: delete all accumulated log entries?`, { modal: true }, "Delete");
        if (ok === "Delete") {
            await store.clear();
            vscode.window.showInformationMessage(`${types_1.EXTENSION_DISPLAY_NAME}: log cleared.`);
        }
    }), vscode.commands.registerCommand("amigoodatvibe.runDiagnostics", async () => {
        const startEvt = vscode.window
            .onDidStartTerminalShellExecution;
        const writeEvt = vscode.window
            .onDidWriteTerminalData;
        const shellIntegConfig = vscode.workspace
            .getConfiguration("terminal.integrated.shellIntegration")
            .get("enabled", true);
        const lines = [
            `=== ${types_1.EXTENSION_DISPLAY_NAME} diagnostics ===`,
            `VS Code version: ${vscode.version}`,
            `Shell Integration setting: ${shellIntegConfig ? "ON" : "OFF"}`,
            `onDidStartTerminalShellExecution stable API: ${startEvt ? "✅ available" : "❌ unavailable"}`,
            `onDidWriteTerminalData proposed API: ${writeEvt ? "✅ active" : "❌ inactive (normal)"}`,
            `Auto-capture: ${config_1.Config.autoCapture() ? "ON" : "OFF"}`,
            `Masking: ${config_1.Config.maskingEnabled() ? "ON" : "OFF"}`,
            `Log file: ${store.filePath()}`,
            `Log file exists: ${fs.existsSync(store.filePath()) ? "YES" : "NO"}`,
            "",
            "💡 If capture isn't working:",
            "  1) Make sure you're using VS Code's built-in integrated terminal (external Terminal.app/iTerm won't be detected)",
            "  2) A small dot next to the integrated terminal prompt = Shell Integration is active",
            `  3) Still not working? Open '+ New Terminal' dropdown → choose '${types_1.EXTENSION_DISPLAY_NAME} Capture' for 100% capture`,
        ];
        (0, logger_1.log)(lines.join("\n"));
        (0, logger_1.getLogChannel)()?.show(true);
        vscode.window.showInformationMessage(`${types_1.EXTENSION_DISPLAY_NAME} diagnostics: stable=${startEvt ? "✅" : "❌"} / proposed=${writeEvt ? "✅" : "❌"} / shellInteg=${shellIntegConfig ? "✅" : "❌"}. See the Output channel for details.`);
    }), vscode.commands.registerCommand("amigoodatvibe.importExtensionCache", async () => {
        if (!(0, extensionCache_1.sqlite3Available)()) {
            vscode.window.showWarningMessage(`${types_1.EXTENSION_DISPLAY_NAME}: the system \`sqlite3\` CLI was not found on PATH. ` +
                "macOS / Linux ship it by default; on Windows, install it from sqlite.org.");
            return;
        }
        const before = store.stats().aiChats;
        const fallbackSessionId = (0, util_1.randomSessionId)();
        const diagnostics = [];
        const report = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${types_1.EXTENSION_DISPLAY_NAME}: reading IDE extension chat caches...`,
            cancellable: false,
        }, async () => (0, extensionCache_1.collectExtensionChatTurns)({
            workspaceFsPath: workspaceRoot,
            mask: (s) => masker.mask(s),
            onDiagnostic: (m) => diagnostics.push(m),
        }));
        for (const line of diagnostics)
            (0, logger_1.log)("[extensionCache]", line);
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
        vscode.window.showInformationMessage(`${types_1.EXTENSION_DISPLAY_NAME}: imported ${added} chat turn(s) from ${report.inspectedDbs} DB file(s). ` +
            `Matched key group(s): ${report.matchedKeys}.`);
    }), vscode.commands.registerCommand("amigoodatvibe.analyzeFromClaudeLog", async () => {
        // Read Claude Code / Copilot / Cursor chat for this workspace and pass
        // it to the analyzer alongside the in-memory capture log. We *don't*
        // persist these external turns to raw_history.json — keeping the file
        // small and avoiding the previous failure mode where a huge sync flush
        // would silently drop turns.
        if (!(0, extensionCache_1.sqlite3Available)()) {
            (0, logger_1.log)("[analyzeFromClaudeLog] sqlite3 missing — skipping SQLite sources but Claude Code JSONL still works");
        }
        const report = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `${types_1.EXTENSION_DISPLAY_NAME}: reading existing AI chat history...`,
            cancellable: false,
        }, async () => (0, extensionCache_1.collectExtensionChatTurns)({
            workspaceFsPath: workspaceRoot,
            mask: (s) => masker.mask(s),
        }));
        const extraEntries = report.turns.map(types_1.extractedTurnToLogEntry);
        (0, logger_1.log)(`[analyzeFromClaudeLog] collected ${extraEntries.length} chat turn(s) ` +
            `from ${report.inspectedClaudeCodeFiles} Claude Code file(s) + ` +
            `${report.inspectedDbs} SQLite DB(s) + ${report.inspectedSessionFiles} chatSessions file(s)`);
        await analyzer.run(ctx, extraEntries);
    }), vscode.commands.registerCommand("amigoodatvibe.startFresh", async () => {
        const ok = await vscode.window.showWarningMessage(`${types_1.EXTENSION_DISPLAY_NAME}: clear all captured logs and start with an empty history for this project? Existing IDE / Claude Code sessions on disk are NOT deleted — they just won't be imported.`, { modal: true }, "Start Fresh");
        if (ok === "Start Fresh") {
            await store.clear();
            vscode.window.showInformationMessage(`${types_1.EXTENSION_DISPLAY_NAME}: log cleared. New AI CLI / @amigoodatvibe turns will be captured from now on.`);
        }
    }));
    // Sidebar — rich webview-based UI (main CTA + stats + recent activity)
    const sidebarProvider = new sidebar_1.SidebarWebviewProvider(ctx, store, masker, workspaceRoot);
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebar_1.SidebarWebviewProvider.viewType, sidebarProvider, { webviewOptions: { retainContextWhenHidden: true } }));
    // Safe flush on shutdown
    ctx.subscriptions.push({
        dispose: () => store.dispose(),
    });
    // Persistent status-bar item — lets the user see which version is active
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = `$(pulse) ${types_1.EXTENSION_DISPLAY_NAME} v${types_1.VERSION}`;
    statusBar.tooltip = `${types_1.EXTENSION_DISPLAY_NAME} v${types_1.VERSION} — click for diagnostics`;
    statusBar.command = "amigoodatvibe.runDiagnostics";
    statusBar.show();
    ctx.subscriptions.push(statusBar);
    (0, logger_1.log)(`✅ ${types_1.EXTENSION_DISPLAY_NAME} v${types_1.VERSION} activated`);
}
function deactivate() {
    (0, logger_1.log)(`👋 ${types_1.EXTENSION_DISPLAY_NAME} deactivate`);
    if (historyStoreSingleton) {
        historyStoreSingleton.dispose();
        historyStoreSingleton = null;
    }
    (0, logger_1.disposeLogger)();
}
//# sourceMappingURL=extension.js.map