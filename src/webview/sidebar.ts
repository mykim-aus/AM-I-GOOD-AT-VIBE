/**
 * SidebarWebviewProvider — Rich sidebar UI (main CTA + stats + recent activity).
 *
 * Design principles:
 *  - The main CTA (vibe analysis) is the largest — the most frequent action
 *  - Three stat cards: AI chats / commands / code edits — to make the user
 *    aware of their own usage
 *  - Recent activity entries — surface what's been captured (also handy
 *    for debugging)
 *  - All colors use VS Code theme variables (auto dark/light support)
 *  - Auto-refresh on log changes (subscribed to HistoryStore.onDidAppend)
 */

import * as vscode from "vscode";

import { randomSessionId, escapeHtml } from "../util";
import { Config } from "../config";
import { log } from "../logger";
import { collectExtensionChatTurns, type ExtractedTurn } from "../extensionCache";
import type { HistoryStore, SecretMasker } from "../store/logStore";
import { LogEntry, extractedTurnToLogEntry, VERSION } from "../types";
import type { OutputLanguage } from "../prompt";

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "amigoodatvibe.sidebar";
  private view?: vscode.WebviewView;
  private refreshTimer: NodeJS.Timeout | null = null;
  /** Snapshot of this workspace's Claude Code chat turns. Loaded lazily on
   *  first resolveWebviewView so the activity feed can show real history
   *  without forcing the user to click Analyze. */
  private claudeCodeCache: ExtractedTurn[] = [];
  private cacheLoaded = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: HistoryStore,
    private readonly masker: SecretMasker,
    private readonly workspaceRoot: string
  ) {
    // Debounced refresh when log entries arrive
    store.onDidAppend(() => this.scheduleRefresh());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.ctx.extensionUri],
    };
    view.webview.html = this.render();

    // First-time lazy load of Claude Code turns. Done off the resolve frame
    // (~1s for a workspace with hundreds of sessions) so the initial empty
    // sidebar paints immediately, then refreshes once cache is populated.
    if (!this.cacheLoaded) {
      this.cacheLoaded = true;
      setImmediate(() => this.loadClaudeCodeCache());
    }

    view.webview.onDidReceiveMessage(
      async (msg: { type?: string; cmd?: string; lang?: string }) => {
        if (msg.type === "exec" && typeof msg.cmd === "string") {
          vscode.commands.executeCommand(msg.cmd);
        } else if (msg.type === "refresh") {
          this.refresh();
        } else if (msg.type === "setLanguage" && typeof msg.lang === "string") {
          const valid: OutputLanguage[] = ["auto", "english", "korean"];
          if ((valid as string[]).includes(msg.lang)) {
            await Config.setOutputLanguage(msg.lang as OutputLanguage);
            this.refresh();
          }
        }
      }
    );

    view.onDidChangeVisibility(() => {
      if (view.visible) this.refresh();
    });
  }

  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 800);
  }

  refresh() {
    if (this.view) {
      this.view.webview.html = this.render();
    }
  }

  /** Pull every Claude Code turn for this workspace and stash it in-memory
   *  for the activity feed. Re-run is cheap (one second per ~4k turns) but we
   *  cache so the user doesn't pay it on every redraw. */
  private loadClaudeCodeCache(): void {
    try {
      const report = collectExtensionChatTurns({
        workspaceFsPath: this.workspaceRoot,
        mask: (s) => this.masker.mask(s),
      });
      this.claudeCodeCache = report.turns;
      log(
        `[sidebar] loaded ${report.turns.length} chat turn(s) from disk; ` +
        `Claude Code files: ${report.inspectedClaudeCodeFiles}`
      );
      this.refresh();
    } catch (err) {
      log("[sidebar] loadClaudeCodeCache failed:", String(err));
    }
  }

  private render(): string {
    const stats = this.store.stats();
    const importedByTool = countImportedTurnsByTool(this.claudeCodeCache);
    const importedTotal = this.claudeCodeCache.length;
    const chatsTotal = stats.aiChats + importedTotal;
    const importedBreakdownHtml = renderImportedBreakdown(importedByTool);
    const ACTIVITY_LIMIT = 30;
    // Merge:
    //  - cached Claude Code chat turns (read once on first show)
    //  - in-memory + on-disk log entries (terminal_command, code_change, etc.)
    // Sort by timestamp desc and clip to ACTIVITY_LIMIT.
    const claudeEntries: LogEntry[] = this.claudeCodeCache.map(extractedTurnToLogEntry);
    const storeEntries = this.store.recent(ACTIVITY_LIMIT * 2);
    const merged: LogEntry[] = [...claudeEntries, ...storeEntries]
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, ACTIVITY_LIMIT);
    const recent = merged;
    const captureOn = Config.autoCapture();
    const currentLang = Config.outputLanguage();
    const nonce = randomSessionId();
    const langOptions: Array<{ value: OutputLanguage; label: string }> = [
      { value: "auto",    label: "🌐 Auto-detect" },
      { value: "english", label: "🇺🇸 English" },
      { value: "korean",  label: "🇰🇷 한국어" },
    ];
    const langOptionsHtml = langOptions
      .map(
        (o) =>
          `<option value="${o.value}"${
            o.value === currentLang ? " selected" : ""
          }>${o.label}</option>`
      )
      .join("");

    const recentHtml = recent.length === 0
      ? `<div class="empty">
           <div class="empty-icon">🌱</div>
           <div class="empty-sub">No activity yet — run a command in the integrated terminal.</div>
         </div>`
      : recent.map((e) => renderEntry(e)).join("");

    const css = sidebarCss();

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${css}</style>
</head><body>

  <!-- ===== Output language selector ===== -->
  <div class="lang-row" title="Language for the nickname and roast">
    <label for="amigoodatvibe-lang" class="lang-label">Roast in</label>
    <select id="amigoodatvibe-lang" class="lang-select">
      ${langOptionsHtml}
    </select>
  </div>

  <!-- ===== Single CTA: Analyze (imports Claude Code history then analyzes) ===== -->
  <button class="cta" data-cmd="amigoodatvibe.analyzeFromClaudeLog"
          title="Imports this workspace's Claude Code session history (+ any Copilot/Cursor chat) and runs the vibe analysis.">
    <span class="cta-emoji">📊</span>
    <span class="cta-label">
      <span class="cta-title">Analyze</span>
    </span>
  </button>

  <!-- ===== Stats ===== -->
  <div class="stats">
    <div class="stat" title="Captured live (${stats.aiChats}) + imported from Claude Code / Codex / Cursor / Copilot caches (${importedTotal})">
      <div class="stat-num">${chatsTotal}</div>
      <div class="stat-label">chats</div>
      ${importedBreakdownHtml}
    </div>
    <div class="stat">
      <div class="stat-num">${stats.commands}</div>
      <div class="stat-label">cmds</div>
    </div>
    <div class="stat">
      <div class="stat-num">${stats.codeChanges}</div>
      <div class="stat-label">edits</div>
    </div>
  </div>

  <!-- ===== Recent Log ===== -->
  <div class="section-head">
    <span>Log</span>
    <span class="capture-badge ${captureOn ? "on" : "off"}">
      ${captureOn ? "● rec" : "○ paused"}
    </span>
  </div>
  <div class="activity">
    ${recentHtml}
  </div>


  <div class="footer">
    <div class="local">🔒 100% local — your code never leaves this machine.</div>
    <div class="version">v${VERSION}</div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (!btn) return;
    vscode.postMessage({ type: "exec", cmd: btn.dataset.cmd });
  });
  const langSel = document.getElementById("amigoodatvibe-lang");
  if (langSel) {
    langSel.addEventListener("change", (e) => {
      vscode.postMessage({ type: "setLanguage", lang: e.target.value });
    });
  }
</script>
</body></html>`;
  }
}

/** Map raw `tool` labels (claude-code-ide, copilot-chat, cursor-chat, …)
 *  to short user-facing source names shown under the chats stat. */
function friendlyToolLabel(tool: string): string {
  if (tool.startsWith("claude")) return "claude";
  if (tool.startsWith("codex")) return "codex";
  if (tool.startsWith("gemini")) return "gemini";
  if (tool.startsWith("cursor")) return "cursor";
  if (tool === "copilot-chat" || tool === "vscode-chat-panel") return "copilot";
  if (tool === "amazon-q") return "amazon-q";
  if (tool === "gh-copilot") return "gh-copilot";
  if (tool === "cody") return "cody";
  if (tool === "aider") return "aider";
  return tool || "other";
}

function countImportedTurnsByTool(turns: ExtractedTurn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of turns) {
    const label = friendlyToolLabel(t.tool);
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

function renderImportedBreakdown(byTool: Record<string, number>): string {
  const entries = Object.entries(byTool)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const text = entries
    .map(([label, n]) => `${escapeHtml(label)} ${n}`)
    .join(" · ");
  return `<div class="stat-sub">${text}</div>`;
}

function sidebarCss(): string {
  return `
:root {
  --bg: var(--vscode-sideBar-background);
  --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
  --muted: var(--vscode-descriptionForeground);
  --card-bg: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
  --card-border: var(--vscode-sideBarSectionHeader-border, var(--vscode-editorWidget-border));
  --accent: var(--vscode-textLink-foreground);
  --accent-bg: var(--vscode-textLink-foreground);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --hover-bg: var(--vscode-list-hoverBackground);
  --danger: var(--vscode-errorForeground);
  --ok: var(--vscode-testing-iconPassed, #4caf50);
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 12px 10px 16px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--fg);
  background: transparent;
  line-height: 1.4;
}

/* ===== Output-language selector ===== */
.lang-row {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
  font-size: 0.82em;
}
.lang-label {
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  font-size: 0.85em;
  flex: 0 0 auto;
}
.lang-select {
  flex: 1; min-width: 0;
  font-family: inherit;
  font-size: 0.95em;
  padding: 4px 6px;
  background: var(--vscode-dropdown-background, var(--card-bg));
  color: var(--vscode-dropdown-foreground, var(--fg));
  border: 1px solid var(--vscode-dropdown-border, var(--card-border));
  border-radius: 4px;
  cursor: pointer;
}
.lang-select:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

/* ===== Main CTA ===== */
.cta {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 12px 14px;
  background: var(--btn-bg); color: var(--btn-fg);
  border: none; border-radius: 8px;
  cursor: pointer; text-align: left;
  font-family: inherit; font-size: inherit;
  transition: background .15s ease;
}
.cta:hover { background: var(--btn-hover); }
.cta-emoji { font-size: 1.6em; line-height: 1; flex: 0 0 auto; }
.cta-label { display: flex; flex-direction: column; min-width: 0; }
.cta-title { font-weight: 700; font-size: 1.02em; }
.cta-sub { opacity: 0.82; font-size: 0.82em; margin-top: 2px; }
.cta + .cta { margin-top: 6px; }
.cta.cta-secondary {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--card-border);
}
.cta.cta-secondary:hover { background: var(--hover-bg); }
.cta.cta-tertiary {
  background: transparent;
  color: var(--muted);
  border: 1px dashed var(--card-border);
  padding: 8px 14px;
}
.cta.cta-tertiary .cta-emoji { font-size: 1.2em; }
.cta.cta-tertiary .cta-title { font-weight: 500; font-size: 0.95em; }
.cta.cta-tertiary:hover { background: var(--hover-bg); color: var(--fg); }

/* ===== Stats ===== */
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px; margin: 14px 0 16px;
}
.stat {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  padding: 8px 4px;
  text-align: center;
}
.stat-num {
  font-size: 1.35em; font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-size: 0.72em;
  color: var(--muted);
  margin-top: 2px;
  white-space: nowrap;
}
.stat-sub {
  font-size: 0.62em;
  color: var(--muted);
  margin-top: 3px;
  line-height: 1.25;
  opacity: 0.85;
  word-break: keep-all;
  overflow-wrap: anywhere;
  padding: 0 2px;
}

/* ===== Section head ===== */
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin: 4px 0 6px;
  font-size: 0.78em; text-transform: uppercase;
  color: var(--muted); letter-spacing: 0.04em; font-weight: 600;
}
.capture-badge {
  font-size: 0.85em;
  padding: 2px 6px; border-radius: 10px;
  text-transform: none; letter-spacing: 0;
}
.capture-badge.on  { color: var(--ok); }
.capture-badge.off { color: var(--muted); }

/* ===== Activity list ===== */
.activity {
  display: flex; flex-direction: column; gap: 4px;
  margin-bottom: 10px;
}
.activity-item {
  display: flex; gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  cursor: default;
}
.activity-item:hover { background: var(--hover-bg); }
.activity-icon { flex: 0 0 auto; font-size: 1.05em; line-height: 1.3; }
.activity-body { flex: 1; min-width: 0; }
.activity-meta {
  font-size: 0.74em; color: var(--muted);
  display: flex; gap: 6px; align-items: center;
  margin-bottom: 1px;
}
.activity-meta .tool {
  background: var(--card-border);
  padding: 0 5px; border-radius: 3px;
  color: var(--fg);
  font-family: var(--vscode-editor-font-family);
}
.activity-content {
  font-size: 0.85em;
  overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  text-align: center;
  padding: 24px 12px;
  color: var(--muted);
}
.empty-icon { font-size: 2em; }
.empty-title { font-weight: 600; margin-top: 6px; color: var(--fg); }
.empty-sub { font-size: 0.82em; margin-top: 4px; line-height: 1.5; }

/* ===== Footer ===== */
.footer {
  margin-top: 14px;
  font-size: 0.72em; color: var(--muted);
  border-top: 1px solid var(--card-border);
  padding-top: 8px;
  text-align: center;
  line-height: 1.5;
}
.local { font-weight: 600; color: var(--fg); }
.version { font-family: var(--vscode-editor-font-family); margin-top: 2px; opacity: 0.7; }

@media (max-width: 220px) {
  .stats { grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .stat-num { font-size: 1.1em; }
  .stat-label { font-size: 0.65em; }
}
`;
}

/** Render a single log entry as a sidebar card. */
function renderEntry(e: LogEntry): string {
  const ts = relativeTime(new Date(e.ts).getTime());
  let icon = "•";
  let tool = "";
  let content = "";
  if (e.type === "ai_chat") {
    icon = e.turn === "user" ? "👤" : "🤖";
    tool = e.tool;
    content = e.content;
  } else if (e.type === "terminal_command") {
    icon = "🛠";
    tool = "shell";
    content = e.command;
  } else {
    icon = "📝";
    tool = e.file;
    content = `+${e.added} / -${e.removed}`;
  }
  return `<div class="activity-item">
    <div class="activity-icon">${icon}</div>
    <div class="activity-body">
      <div class="activity-meta">
        <span class="tool">${escapeHtml(tool)}</span>
        <span>·</span>
        <span>${escapeHtml(ts)}</span>
      </div>
      <div class="activity-content" title="${escapeHtml(content)}">${escapeHtml(content)}</div>
    </div>
  </div>`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0)            return "just now";
  if (diff < 60_000)       return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
