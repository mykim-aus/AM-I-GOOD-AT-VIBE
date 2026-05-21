/**
 * AM I GOOD AT VIBE — Extension chat-cache reader (vscode-free, unit-testable).
 *
 * Reads chat history that other IDE extensions persist to disk as a
 * complement to terminal capture. The "GUI chats can't be intercepted via
 * VS Code API" limit in the README still holds — this module bypasses the
 * extension boundary by reading the same SQLite stores VS Code/Cursor write
 * to themselves, so it requires no proposed API.
 *
 * Coverage:
 *   - GitHub Copilot Chat (key: `interactive.sessions`, `chat.workspaceTransfer`)
 *   - Cursor (`aiService.prompts`, `aiService.generations`,
 *             `workbench.panel.aichat.view.aichat.chatdata`)
 *
 * Trade-offs:
 *   - Shells out to the system `sqlite3` CLI to avoid native deps. macOS / Linux
 *     ship it; on Windows the import becomes a no-op with a clear diagnostic.
 *   - Stored value formats are best-effort and may drift between extension
 *     versions — parsers are defensive (return [] on unknown shapes).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

// =============================================================================
// IDE user-data root discovery
// =============================================================================

export interface IdeRoot {
  /** Display name, e.g. "VS Code", "Cursor". */
  name: string;
  /** Absolute path to the IDE's user-data root (`.../User`). */
  userRoot: string;
}

/** Per-platform candidate locations for known IDE user-data roots. */
export function ideRootCandidates(
  homedir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env
): Array<{ name: string; userRoot: string }> {
  if (platform === "darwin") {
    const base = path.join(homedir, "Library", "Application Support");
    return [
      { name: "VS Code",          userRoot: path.join(base, "Code", "User") },
      { name: "VS Code Insiders", userRoot: path.join(base, "Code - Insiders", "User") },
      { name: "VSCodium",         userRoot: path.join(base, "VSCodium", "User") },
      { name: "Cursor",           userRoot: path.join(base, "Cursor", "User") },
      { name: "Windsurf",         userRoot: path.join(base, "Windsurf", "User") },
      { name: "Trae",             userRoot: path.join(base, "Trae", "User") },
    ];
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(homedir, "AppData", "Roaming");
    return [
      { name: "VS Code",          userRoot: path.join(appData, "Code", "User") },
      { name: "VS Code Insiders", userRoot: path.join(appData, "Code - Insiders", "User") },
      { name: "VSCodium",         userRoot: path.join(appData, "VSCodium", "User") },
      { name: "Cursor",           userRoot: path.join(appData, "Cursor", "User") },
      { name: "Windsurf",         userRoot: path.join(appData, "Windsurf", "User") },
    ];
  }
  // linux / other
  const config = env.XDG_CONFIG_HOME ?? path.join(homedir, ".config");
  return [
    { name: "VS Code",          userRoot: path.join(config, "Code", "User") },
    { name: "VS Code Insiders", userRoot: path.join(config, "Code - Insiders", "User") },
    { name: "VSCodium",         userRoot: path.join(config, "VSCodium", "User") },
    { name: "Cursor",           userRoot: path.join(config, "Cursor", "User") },
  ];
}

/** Return only the candidate roots that actually exist on disk. */
export function listIdeUserRoots(
  homedir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): IdeRoot[] {
  return ideRootCandidates(homedir, platform).filter((r) => fs.existsSync(r.userRoot));
}

// =============================================================================
// Workspace folder hash — matches VS Code's workspaceStorage subfolder naming
// =============================================================================

/**
 * VS Code names each `workspaceStorage/<hash>/` folder by MD5-hashing the
 * canonical `file://` URI of the opened folder. Multi-root workspaces use a
 * different scheme (file content hash) — out of scope here.
 */
export function workspaceFolderHash(workspaceFsPath: string): string {
  return crypto.createHash("md5").update(pathToFileUri(workspaceFsPath)).digest("hex");
}

/**
 * Mirror of VS Code's `URI.file(p).toString()` for plain folder paths.
 * Returns `file:///abs/path` on POSIX and `file:///c%3A/abs/path` on Windows.
 */
export function pathToFileUri(p: string): string {
  const abs = path.resolve(p);
  if (process.platform === "win32") {
    // VS Code lowercases the drive letter and URI-encodes the colon.
    const m = /^([A-Za-z]):(.*)$/.exec(abs);
    if (m) {
      const drive = m[1].toLowerCase();
      const rest = m[2].replace(/\\/g, "/");
      return `file:///${drive}%3A${rest}`;
    }
  }
  const normalized = abs.replace(/\\/g, "/");
  return "file://" + (normalized.startsWith("/") ? normalized : "/" + normalized);
}

// =============================================================================
// Extracted-turn shape
// =============================================================================

export interface ExtractedTurn {
  turn: "user" | "assistant";
  content: string;
  /** Epoch ms when known. */
  ts?: number;
  tool: string;
  sessionId?: string;
}

// =============================================================================
// Defensive helpers (kept private)
// =============================================================================

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function numberOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * VS Code's chat "message" field has appeared as: a bare string; `{text}`;
 * `{value}`; `{content}`; or `{parts: [{text}]}`. Take whichever is present.
 */
function pickText(v: unknown): string {
  if (typeof v === "string") return v;
  if (!isObj(v)) return "";
  if (typeof v.text === "string") return v.text;
  if (typeof v.value === "string") return v.value;
  if (typeof v.content === "string") return v.content;
  if (Array.isArray(v.parts)) {
    return v.parts
      .map((p) => (isObj(p) && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

/** Copilot responses are typically `[{value, kind}, ...]`. Concatenate text parts. */
function pickResponseText(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((part) => {
        if (typeof part === "string") return part;
        if (isObj(part)) {
          if (typeof part.value === "string") return part.value;
          if (typeof part.text === "string") return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return pickText(v);
}

// =============================================================================
// Parsers — one per known storage key
// =============================================================================

/**
 * VS Code Chat / Copilot Chat — `interactive.sessions`.
 * Shape: `[{sessionId, creationDate, requests: [{message, response, timestamp}]}]`.
 */
export function parseVscodeInteractiveSessions(value: unknown): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  for (const s of asArray(value)) {
    if (!isObj(s)) continue;
    const sessionId = stringOrUndef(s.sessionId) ?? stringOrUndef(s.id);
    const sessionTs = numberOrUndef(s.creationDate);
    for (const r of asArray(s.requests)) {
      if (!isObj(r)) continue;
      const ts = numberOrUndef(r.timestamp) ?? sessionTs;
      const userText = pickText(r.message) || pickText(r.prompt) || pickText(r.userMessage);
      if (userText) {
        out.push({ turn: "user", content: userText, ts, tool: "copilot-chat", sessionId });
      }
      const respText = pickResponseText(r.response);
      if (respText) {
        out.push({ turn: "assistant", content: respText, ts, tool: "copilot-chat", sessionId });
      }
    }
  }
  return out;
}

/**
 * Cursor — `aiService.prompts`. Each entry is `{text, commandType, ...}`.
 * Only user prompts; pair with generations for assistant side.
 */
export function parseCursorPrompts(value: unknown): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  for (const item of asArray(value)) {
    if (!isObj(item)) continue;
    const text = stringOrUndef(item.text);
    if (!text) continue;
    out.push({ turn: "user", content: text, tool: "cursor" });
  }
  return out;
}

/**
 * Cursor — `aiService.generations`. Each entry is
 * `{textDescription, type, unixMs, generationUUID, ...}`.
 */
export function parseCursorGenerations(value: unknown): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  for (const item of asArray(value)) {
    if (!isObj(item)) continue;
    const text = stringOrUndef(item.textDescription) ?? stringOrUndef(item.text);
    if (!text) continue;
    const ts = numberOrUndef(item.unixMs);
    out.push({ turn: "assistant", content: text, ts, tool: "cursor" });
  }
  return out;
}

/**
 * Cursor chat view — `workbench.panel.aichat.view.aichat.chatdata`.
 * Shape: `{tabs: [{bubbles: [{type: "user"|"ai", text}]}]}`.
 */
export function parseCursorChatData(value: unknown): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  if (!isObj(value)) return out;
  for (const tab of asArray(value.tabs)) {
    if (!isObj(tab)) continue;
    const sessionId = stringOrUndef(tab.tabId) ?? stringOrUndef(tab.chatTitle);
    for (const bubble of asArray(tab.bubbles)) {
      if (!isObj(bubble)) continue;
      const type = stringOrUndef(bubble.type);
      const text = stringOrUndef(bubble.text);
      if (!text || !type) continue;
      const turn: "user" | "assistant" = type === "user" ? "user" : "assistant";
      out.push({ turn, content: text, tool: "cursor-chat", sessionId });
    }
  }
  return out;
}

/** Registry of (storage key → parser). */
export const KNOWN_CHAT_KEYS: Array<{
  key: string;
  parser: (value: unknown) => ExtractedTurn[];
}> = [
  { key: "interactive.sessions",                              parser: parseVscodeInteractiveSessions },
  { key: "chat.workspaceTransfer",                            parser: parseVscodeInteractiveSessions },
  { key: "aiService.prompts",                                 parser: parseCursorPrompts },
  { key: "aiService.generations",                             parser: parseCursorGenerations },
  { key: "workbench.panel.aichat.view.aichat.chatdata",       parser: parseCursorChatData },
];

/**
 * Modern VS Code (1.95+) persists each GUI chat panel session as its own file
 * under `workspaceStorage/<hash>/chatSessions/<uuid>.jsonl`. The file content
 * is a single JSON object of the shape `{kind, v: {version, sessionId,
 * creationDate, requests, ...}}` (extension `.jsonl` but currently emitted as
 * one JSON blob, not line-delimited). Sessions that never received user input
 * are persisted with `requests: []` — empty but parseable.
 */
export function parseChatSessionFile(value: unknown): ExtractedTurn[] {
  if (!isObj(value)) return [];
  const v = isObj(value.v) ? value.v : value;
  // Reuse the same `requests` parser by wrapping in a single-element session array.
  return parseVscodeInteractiveSessions([v]);
}

/**
 * Claude Code (Anthropic's official CLI / VS Code extension) writes one
 * line-delimited JSONL file per session under
 * `~/.claude/projects/<encoded-workspace>/<uuid>.jsonl`. Encoding: workspace
 * path with `/` → `-` (a literal byte-level substitution, no escaping).
 *
 * Each line is one record: `{type, message:{role, content}, timestamp,
 * sessionId, cwd, gitBranch, ...}`. Content can be a bare string or an
 * Anthropic Messages-API content-block array (`text` / `thinking` /
 * `tool_use` / `tool_result`). We extract only `text` blocks for the chat
 * turn body — `thinking` is the model's internal scratchpad (analytically
 * noisy), and tool I/O is structured data, not conversation.
 */
export function claudeCodeProjectDirName(workspaceFsPath: string): string {
  return path.resolve(workspaceFsPath).replace(/\//g, "-");
}

/**
 * Flatten Anthropic content blocks down to a plain string. String content
 * passes through unchanged. Non-text blocks are dropped (see
 * [[claudeCodeProjectDirName]] for rationale).
 */
export function flattenClaudeCodeContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isObj(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * Parse the entire content of a Claude Code session `.jsonl` file. Lines
 * that aren't valid JSON or aren't `user`/`assistant` turns are skipped.
 */
export function parseClaudeCodeJsonl(raw: string): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isObj(rec)) continue;
    const type = stringOrUndef(rec.type);
    if (type !== "user" && type !== "assistant") continue;
    const msg = isObj(rec.message) ? rec.message : null;
    if (!msg) continue;
    const content = flattenClaudeCodeContent(msg.content);
    if (!content) continue;
    const ts = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : undefined;
    out.push({
      turn: type,
      content,
      ts: Number.isFinite(ts) ? ts : undefined,
      tool: "claude-code-ide",
      sessionId: stringOrUndef(rec.sessionId),
    });
  }
  return out;
}

/**
 * Read every `.jsonl` file in a Claude Code project directory and parse it.
 * Missing directory → empty array.
 */
export function readClaudeCodeSessions(dir: string): ExtractedTurn[] {
  if (!fs.existsSync(dir)) return [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out: ExtractedTurn[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, name);
    let raw: string;
    try { raw = fs.readFileSync(filePath, "utf8"); } catch { continue; }
    out.push(...parseClaudeCodeJsonl(raw));
  }
  return out;
}

/**
 * Walk a `chatSessions/` directory and return turns from every readable
 * session file. Missing directory → empty array.
 */
export function readChatSessionFiles(dir: string): ExtractedTurn[] {
  const out: ExtractedTurn[] = [];
  if (!fs.existsSync(dir)) return out;
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (!name.endsWith(".json") && !name.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, name);
    let raw: string;
    try { raw = fs.readFileSync(filePath, "utf8"); } catch { continue; }
    if (!raw.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      // Fallback: real JSONL — one object per line.
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { out.push(...parseChatSessionFile(JSON.parse(line))); } catch { /* skip */ }
      }
      continue;
    }
    out.push(...parseChatSessionFile(parsed));
  }
  return out;
}

// =============================================================================
// SQLite reader — system `sqlite3` CLI shell-out (no native dep)
// =============================================================================

let sqlite3Cached: boolean | null = null;

/** Whether a usable `sqlite3` CLI is on PATH. Result is cached per-process. */
export function sqlite3Available(): boolean {
  if (sqlite3Cached !== null) return sqlite3Cached;
  try {
    execFileSync("sqlite3", ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    sqlite3Cached = true;
  } catch {
    sqlite3Cached = false;
  }
  return sqlite3Cached;
}

/** Reset the cached `sqlite3` availability — exposed for tests. */
export function resetSqlite3AvailabilityCache(): void {
  sqlite3Cached = null;
}

const ROW_SEP = "AMIGOOD_ROW";
const COL_SEP = "AMIGOOD_COL";

/**
 * Read the specified keys from a VS Code-style `state.vscdb` (table
 * `ItemTable(key TEXT, value BLOB)`). Returns `Map<key, raw string>`.
 * Missing file / sqlite3 / IO error → empty Map.
 */
export function readChatKeysFromDb(dbPath: string, keys: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (keys.length === 0) return result;
  if (!fs.existsSync(dbPath)) return result;
  if (!sqlite3Available()) return result;

  const inClause = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
  const sql =
    `SELECT key || '${COL_SEP}' || value || '${ROW_SEP}' ` +
    `FROM ItemTable WHERE key IN (${inClause});`;

  let stdout = "";
  try {
    stdout = execFileSync("sqlite3", ["-readonly", "-bail", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      // Silence sqlite3 stderr; we treat any failure as "no data".
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return result;
  }

  for (const rawRow of stdout.split(ROW_SEP)) {
    // sqlite3 CLI emits a trailing newline after each row; that newline ends
    // up at the *start* of the next chunk once we split on ROW_SEP. Strip it
    // so it doesn't get glued onto the key.
    const row = rawRow.replace(/^\r?\n/, "");
    if (!row) continue;
    const ix = row.indexOf(COL_SEP);
    if (ix < 0) continue;
    const key = row.slice(0, ix);
    const value = row.slice(ix + COL_SEP.length);
    if (value) result.set(key, value);
  }
  return result;
}

// =============================================================================
// High-level entry point
// =============================================================================

export interface CollectOptions {
  /** Absolute path of the workspace whose per-workspace storage should be read. */
  workspaceFsPath: string;
  /** Optional masker applied to each turn's content before yielding. */
  mask?: (s: string) => string;
  /** Override IDE roots (for tests). Defaults to live filesystem discovery. */
  ideRoots?: IdeRoot[];
  /** Override the user home directory (for tests). */
  homedir?: string;
  /** Optional diagnostic sink — called once per inspected DB path. */
  onDiagnostic?: (msg: string) => void;
}

export interface CollectReport {
  turns: ExtractedTurn[];
  inspectedDbs: number;
  matchedKeys: number;
  /** Number of `chatSessions/*.jsonl` files actually opened. */
  inspectedSessionFiles: number;
  /** Number of Claude Code `~/.claude/projects/.../*.jsonl` files opened. */
  inspectedClaudeCodeFiles: number;
  sqlite3Found: boolean;
}

/**
 * Walk every known IDE user-data root, open globalStorage and the current
 * workspace's per-workspace `state.vscdb`, and extract chat turns from each
 * known key.
 */
export function collectExtensionChatTurns(opts: CollectOptions): CollectReport {
  const ideRoots = opts.ideRoots ?? listIdeUserRoots();
  const wsHash = workspaceFolderHash(opts.workspaceFsPath);
  const keys = KNOWN_CHAT_KEYS.map((k) => k.key);
  const turns: ExtractedTurn[] = [];
  let inspectedDbs = 0;
  let matchedKeys = 0;
  let inspectedSessionFiles = 0;
  let inspectedClaudeCodeFiles = 0;
  const sqlite3Found = sqlite3Available();
  const home = opts.homedir ?? os.homedir();

  const pushTurn = (t: ExtractedTurn) => {
    if (!t.content) return;
    turns.push(opts.mask ? { ...t, content: opts.mask(t.content) } : t);
  };

  // Claude Code (Anthropic's CLI / VS Code extension): one project dir per
  // workspace, one JSONL file per session. Lives outside the per-IDE roots.
  const claudeDir = path.join(home, ".claude", "projects", claudeCodeProjectDirName(opts.workspaceFsPath));
  if (fs.existsSync(claudeDir)) {
    let files: string[] = [];
    try { files = fs.readdirSync(claudeDir); } catch { files = []; }
    const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
    inspectedClaudeCodeFiles = sessionFiles.length;
    opts.onDiagnostic?.(
      `inspected Claude Code @ ${claudeDir} — ${sessionFiles.length} session file(s)`
    );
    for (const t of readClaudeCodeSessions(claudeDir)) pushTurn(t);
  }

  for (const root of ideRoots) {
    const dbPaths = [
      path.join(root.userRoot, "globalStorage", "state.vscdb"),
      path.join(root.userRoot, "workspaceStorage", wsHash, "state.vscdb"),
    ];
    for (const dbPath of dbPaths) {
      if (!fs.existsSync(dbPath)) continue;
      inspectedDbs++;
      const valuesByKey = readChatKeysFromDb(dbPath, keys);
      opts.onDiagnostic?.(
        `inspected ${root.name} @ ${dbPath} — ${valuesByKey.size} known chat key(s) matched`
      );
      for (const { key, parser } of KNOWN_CHAT_KEYS) {
        const raw = valuesByKey.get(key);
        if (!raw) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { continue; }
        const extracted = parser(parsed);
        matchedKeys += extracted.length > 0 ? 1 : 0;
        for (const t of extracted) pushTurn(t);
      }
    }

    // Modern VS Code: per-session JSONL files. Each opened workspace can have
    // its own chatSessions/ dir; we only read the current workspace's dir.
    const sessionsDir = path.join(root.userRoot, "workspaceStorage", wsHash, "chatSessions");
    if (fs.existsSync(sessionsDir)) {
      let files: string[] = [];
      try { files = fs.readdirSync(sessionsDir); } catch { files = []; }
      const inspected = files.filter((f) => f.endsWith(".json") || f.endsWith(".jsonl")).length;
      inspectedSessionFiles += inspected;
      opts.onDiagnostic?.(
        `inspected ${root.name} @ ${sessionsDir} — ${inspected} session file(s)`
      );
      const extracted = readChatSessionFiles(sessionsDir);
      // Stamp the tool consistently — chatSessions files don't carry a
      // distinguishing field, so attribute to the VS Code chat panel.
      for (const t of extracted) pushTurn({ ...t, tool: "vscode-chat-panel" });
    }
  }

  return {
    turns,
    inspectedDbs,
    matchedKeys,
    inspectedSessionFiles,
    inspectedClaudeCodeFiles,
    sqlite3Found,
  };
}
