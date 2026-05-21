/**
 * AM I GOOD AT VIBE — extensionCache tests.
 *
 * Three layers:
 *   1) Parser fixtures — exercise each known storage-key parser against a
 *      synthetic JSON value. No filesystem, no sqlite3.
 *   2) Pure helpers — workspace folder hash & path-to-URI.
 *   3) Round-trip integration — create a real `state.vscdb` in a tempdir,
 *      seed known chat keys, and verify `collectExtensionChatTurns` extracts
 *      and (optionally) masks them. Skipped if `sqlite3` isn't on PATH.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  claudeCodeProjectDirName,
  collectExtensionChatTurns,
  flattenClaudeCodeContent,
  ideRootCandidates,
  KNOWN_CHAT_KEYS,
  parseChatSessionFile,
  parseClaudeCodeJsonl,
  parseCursorChatData,
  parseCursorGenerations,
  parseCursorPrompts,
  parseVscodeInteractiveSessions,
  pathToFileUri,
  readChatKeysFromDb,
  readChatSessionFiles,
  readClaudeCodeSessions,
  resetSqlite3AvailabilityCache,
  sqlite3Available,
  workspaceFolderHash,
} from "../extensionCache";

// =============================================================================
// (1) Parser fixtures
// =============================================================================

test("parseVscodeInteractiveSessions: extracts user + assistant from Copilot-shape session", () => {
  const fixture = [
    {
      sessionId: "sess-1",
      creationDate: 1_700_000_000_000,
      requests: [
        {
          timestamp: 1_700_000_001_000,
          message: { text: "How do I parse JSON?" },
          response: [
            { value: "Use JSON.parse(...)", kind: "markdown" },
            { value: "Be sure to wrap in try/catch.", kind: "markdown" },
          ],
        },
        {
          message: "bare string prompt",
          response: [{ value: "bare string reply" }],
        },
      ],
    },
  ];
  const turns = parseVscodeInteractiveSessions(fixture);
  assert.equal(turns.length, 4);
  assert.equal(turns[0].turn, "user");
  assert.equal(turns[0].content, "How do I parse JSON?");
  assert.equal(turns[0].tool, "copilot-chat");
  assert.equal(turns[0].sessionId, "sess-1");
  assert.equal(turns[0].ts, 1_700_000_001_000);
  assert.equal(turns[1].turn, "assistant");
  assert.ok(turns[1].content.includes("JSON.parse"));
  assert.ok(turns[1].content.includes("try/catch"));
  // Second request: missing timestamp → falls back to creationDate
  assert.equal(turns[2].ts, 1_700_000_000_000);
  assert.equal(turns[2].content, "bare string prompt");
  assert.equal(turns[3].content, "bare string reply");
});

test("parseVscodeInteractiveSessions: tolerates message.parts array shape", () => {
  const fixture = [
    {
      sessionId: "s",
      requests: [{ message: { parts: [{ text: "hello " }, { text: "world" }] } }],
    },
  ];
  const turns = parseVscodeInteractiveSessions(fixture);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].content, "hello world");
});

test("parseVscodeInteractiveSessions: returns [] on unknown shape", () => {
  assert.deepEqual(parseVscodeInteractiveSessions({}), []);
  assert.deepEqual(parseVscodeInteractiveSessions(null), []);
  assert.deepEqual(parseVscodeInteractiveSessions("garbage"), []);
  assert.deepEqual(parseVscodeInteractiveSessions([{ noRequests: true }]), []);
});

test("parseCursorPrompts: extracts text entries as user turns", () => {
  const fixture = [
    { text: "Refactor this function", commandType: 4 },
    { text: "Add tests", commandType: 1 },
    { commandType: 99 }, // no text → skipped
    "garbage",
  ];
  const turns = parseCursorPrompts(fixture);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, "user");
  assert.equal(turns[0].tool, "cursor");
  assert.equal(turns[0].content, "Refactor this function");
});

test("parseCursorGenerations: extracts textDescription as assistant turns", () => {
  const fixture = [
    { textDescription: "Refactored to use map()", type: "composer", unixMs: 1_700_000_000_000 },
    { text: "fallback", type: "chat" },
    { type: "noisy" },
  ];
  const turns = parseCursorGenerations(fixture);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, "assistant");
  assert.equal(turns[0].ts, 1_700_000_000_000);
  assert.equal(turns[0].content, "Refactored to use map()");
  assert.equal(turns[1].content, "fallback");
});

test("parseCursorChatData: walks tabs → bubbles", () => {
  const fixture = {
    tabs: [
      {
        tabId: "tab-A",
        bubbles: [
          { type: "user", text: "ping" },
          { type: "ai", text: "pong" },
          { type: "ai" }, // no text → skipped
        ],
      },
    ],
  };
  const turns = parseCursorChatData(fixture);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, "user");
  assert.equal(turns[0].sessionId, "tab-A");
  assert.equal(turns[1].turn, "assistant");
  assert.equal(turns[1].sessionId, "tab-A");
});

test("KNOWN_CHAT_KEYS: registers expected keys", () => {
  const keys = new Set(KNOWN_CHAT_KEYS.map((k) => k.key));
  for (const expected of [
    "interactive.sessions",
    "chat.workspaceTransfer",
    "aiService.prompts",
    "aiService.generations",
    "workbench.panel.aichat.view.aichat.chatdata",
  ]) {
    assert.ok(keys.has(expected), `${expected} registered`);
  }
});

// =============================================================================
// (2) workspaceFolderHash & pathToFileUri
// =============================================================================

test("pathToFileUri: POSIX folder path becomes file:///abs/path", () => {
  if (process.platform === "win32") return;
  assert.equal(pathToFileUri("/Users/me/proj"), "file:///Users/me/proj");
});

test("workspaceFolderHash: deterministic md5 hex", () => {
  // Sanity: same input → same hex, length 32.
  const h1 = workspaceFolderHash("/some/path/A");
  const h2 = workspaceFolderHash("/some/path/A");
  assert.equal(h1, h2);
  assert.match(h1, /^[a-f0-9]{32}$/);
  assert.notEqual(h1, workspaceFolderHash("/some/path/B"));
});

// =============================================================================
// (3) ideRootCandidates: per-platform paths
// =============================================================================

test("ideRootCandidates: macOS layout includes VS Code & Cursor", () => {
  const cands = ideRootCandidates("/Users/x", "darwin", {});
  const names = cands.map((c) => c.name);
  assert.ok(names.includes("VS Code"));
  assert.ok(names.includes("Cursor"));
  const vsc = cands.find((c) => c.name === "VS Code")!;
  assert.equal(
    vsc.userRoot,
    "/Users/x/Library/Application Support/Code/User"
  );
});

test("ideRootCandidates: Linux honors XDG_CONFIG_HOME", () => {
  const cands = ideRootCandidates("/home/x", "linux", { XDG_CONFIG_HOME: "/custom/cfg" });
  const vsc = cands.find((c) => c.name === "VS Code")!;
  assert.equal(vsc.userRoot, "/custom/cfg/Code/User");
});

test("ideRootCandidates: Windows uses APPDATA", () => {
  const cands = ideRootCandidates("C:\\Users\\x", "win32", { APPDATA: "C:\\Users\\x\\AppData\\Roaming" });
  const vsc = cands.find((c) => c.name === "VS Code")!;
  // `path.join` uses the host separator (likely `/` on the test host); compare
  // in a separator-insensitive way so this test passes on macOS / Linux too.
  const normalize = (s: string) => s.replace(/\\/g, "/");
  assert.ok(normalize(vsc.userRoot).endsWith("AppData/Roaming/Code/User"));
});

// =============================================================================
// (4) Integration: real sqlite3 round-trip
// =============================================================================

const HAS_SQLITE3 = (() => {
  resetSqlite3AvailabilityCache();
  return sqlite3Available();
})();

test("readChatKeysFromDb: returns empty Map for missing file", () => {
  const m = readChatKeysFromDb("/this/path/does/not/exist.vscdb", ["interactive.sessions"]);
  assert.equal(m.size, 0);
});

test("readChatKeysFromDb: round-trips known keys from a real state.vscdb", { skip: !HAS_SQLITE3 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amigoodatvibe-extcache-"));
  const db = path.join(tmp, "state.vscdb");
  const fixture = [
    {
      sessionId: "round-trip",
      creationDate: 1_700_000_000_000,
      requests: [
        { message: { text: "round-trip user" }, response: [{ value: "round-trip assistant" }] },
      ],
    },
  ];
  const initSql = `
    CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
    INSERT INTO ItemTable(key, value) VALUES('interactive.sessions', '${JSON.stringify(fixture).replace(/'/g, "''")}');
    INSERT INTO ItemTable(key, value) VALUES('aiService.prompts', '${JSON.stringify([{ text: "cursor user" }]).replace(/'/g, "''")}');
  `;
  execFileSync("sqlite3", [db, initSql], { stdio: "ignore" });

  const m = readChatKeysFromDb(db, ["interactive.sessions", "aiService.prompts", "missing.key"]);
  assert.equal(m.size, 2);
  const parsed = JSON.parse(m.get("interactive.sessions")!);
  assert.equal(parsed[0].sessionId, "round-trip");

  fs.rmSync(tmp, { recursive: true, force: true });
});

// =============================================================================
// (4b) chatSessions JSONL — modern VS Code GUI panel storage
// =============================================================================

test("parseChatSessionFile: extracts turns from {kind, v:{requests:[…]}} envelope", () => {
  const envelope = {
    kind: 0,
    v: {
      version: 3,
      sessionId: "sess-modern",
      creationDate: 1_770_000_000_000,
      initialLocation: "panel",
      requests: [
        {
          timestamp: 1_770_000_001_000,
          message: { text: "hello panel" },
          response: [{ value: "hi from copilot", kind: "markdown" }],
        },
      ],
    },
  };
  const turns = parseChatSessionFile(envelope);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, "user");
  assert.equal(turns[0].content, "hello panel");
  assert.equal(turns[0].sessionId, "sess-modern");
  assert.equal(turns[1].turn, "assistant");
  assert.equal(turns[1].content, "hi from copilot");
});

test("parseChatSessionFile: empty requests array yields []", () => {
  assert.deepEqual(
    parseChatSessionFile({ kind: 0, v: { sessionId: "x", requests: [] } }),
    []
  );
});

test("readChatSessionFiles: reads every .jsonl in directory; skips garbage", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amigoodatvibe-sess-"));
  fs.writeFileSync(path.join(tmp, "a.jsonl"), JSON.stringify({
    kind: 0,
    v: {
      sessionId: "A",
      requests: [{ message: { text: "from A" }, response: [{ value: "reply A" }] }],
    },
  }));
  fs.writeFileSync(path.join(tmp, "b.jsonl"), JSON.stringify({
    kind: 0,
    v: { sessionId: "B", requests: [] }, // empty session — valid but yields no turns
  }));
  fs.writeFileSync(path.join(tmp, "c.jsonl"), "not json at all");
  fs.writeFileSync(path.join(tmp, "ignored.txt"), "should be skipped");

  const turns = readChatSessionFiles(tmp);
  assert.equal(turns.length, 2);
  assert.ok(turns.some((t) => t.content === "from A" && t.turn === "user"));
  assert.ok(turns.some((t) => t.content === "reply A" && t.turn === "assistant"));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readChatSessionFiles: missing directory returns []", () => {
  assert.deepEqual(readChatSessionFiles("/no/such/dir/anywhere"), []);
});

// =============================================================================
// (4c) Claude Code JSONL — ~/.claude/projects/<encoded>/<uuid>.jsonl
// =============================================================================

test("claudeCodeProjectDirName: replaces / with - byte-for-byte (POSIX)", () => {
  assert.equal(
    claudeCodeProjectDirName("/Users/me/proj"),
    "-Users-me-proj"
  );
});

test("claudeCodeProjectDirName: replaces \\ and : (Windows paths)", () => {
  // On POSIX, path.resolve leaves the Windows-style path's tail intact
  // (backslashes aren't separators here, so they pass through as bytes),
  // letting us assert the suffix encodes the way Claude Code's CLI does
  // on Windows: `C:\Users\me\proj` → `C--Users-me-proj`.
  const encoded = claudeCodeProjectDirName("C:\\Users\\me\\proj");
  assert.ok(
    encoded.endsWith("C--Users-me-proj"),
    `expected encoded path to end with "C--Users-me-proj", got: ${encoded}`
  );
});

test("flattenClaudeCodeContent: passes through bare string", () => {
  assert.equal(flattenClaudeCodeContent("hi there"), "hi there");
});

test("flattenClaudeCodeContent: keeps only `text` blocks; drops thinking / tool_use", () => {
  const blocks = [
    { type: "thinking", thinking: "internal reasoning — should drop" },
    { type: "text", text: "line one" },
    { type: "tool_use", name: "Read", input: { path: "/x" } },
    { type: "text", text: "line two" },
  ];
  assert.equal(flattenClaudeCodeContent(blocks), "line one\nline two");
});

test("flattenClaudeCodeContent: unknown shapes → empty string", () => {
  assert.equal(flattenClaudeCodeContent(undefined), "");
  assert.equal(flattenClaudeCodeContent(null), "");
  assert.equal(flattenClaudeCodeContent({}), "");
});

test("parseClaudeCodeJsonl: extracts user + assistant turns; skips file-history-snapshot", () => {
  const jsonl = [
    JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
    JSON.stringify({
      type: "user",
      sessionId: "S",
      timestamp: "2025-05-21T20:00:00.000Z",
      message: { role: "user", content: "do the thing" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "S",
      timestamp: "2025-05-21T20:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "doing the thing" },
        ],
      },
    }),
    "not valid json — should be skipped",
    JSON.stringify({ type: "system", message: { content: "ignored" } }),
  ].join("\n");
  const turns = parseClaudeCodeJsonl(jsonl);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].turn, "user");
  assert.equal(turns[0].content, "do the thing");
  assert.equal(turns[0].sessionId, "S");
  assert.equal(turns[0].ts, Date.parse("2025-05-21T20:00:00.000Z"));
  assert.equal(turns[0].tool, "claude-code-ide");
  assert.equal(turns[1].turn, "assistant");
  assert.equal(turns[1].content, "doing the thing");
  // thinking block must not leak through
  assert.ok(!turns[1].content.includes("secret"));
});

test("readClaudeCodeSessions: walks directory and parses every .jsonl", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amigoodatvibe-cc-"));
  fs.writeFileSync(
    path.join(tmp, "sess1.jsonl"),
    JSON.stringify({
      type: "user",
      sessionId: "s1",
      message: { role: "user", content: "first session" },
    }) + "\n"
  );
  fs.writeFileSync(
    path.join(tmp, "sess2.jsonl"),
    JSON.stringify({
      type: "user",
      sessionId: "s2",
      message: { role: "user", content: "second session" },
    }) + "\n"
  );
  fs.writeFileSync(path.join(tmp, "ignored.txt"), "skip me");

  const turns = readClaudeCodeSessions(tmp);
  assert.equal(turns.length, 2);
  assert.ok(turns.some((t) => t.content === "first session"));
  assert.ok(turns.some((t) => t.content === "second session"));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("collectExtensionChatTurns: discovers Claude Code sessions via $HOME override", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amigoodatvibe-cc-e2e-"));
  const wsPath = "/Users/fake/some-project";
  const ccDir = path.join(tmp, ".claude", "projects", claudeCodeProjectDirName(wsPath));
  fs.mkdirSync(ccDir, { recursive: true });
  fs.writeFileSync(
    path.join(ccDir, "abc.jsonl"),
    JSON.stringify({
      type: "user",
      sessionId: "live-sess",
      timestamp: "2025-05-21T20:00:00.000Z",
      message: { role: "user", content: "is this captured?" },
    }) + "\n" +
    JSON.stringify({
      type: "assistant",
      sessionId: "live-sess",
      timestamp: "2025-05-21T20:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "yes, now it is." }],
      },
    }) + "\n"
  );

  const report = collectExtensionChatTurns({
    workspaceFsPath: wsPath,
    homedir: tmp,
    ideRoots: [], // no other IDEs in this test
  });
  assert.equal(report.inspectedClaudeCodeFiles, 1);
  assert.equal(report.turns.length, 2);
  assert.equal(report.turns[0].tool, "claude-code-ide");
  assert.equal(report.turns[0].content, "is this captured?");
  assert.equal(report.turns[1].content, "yes, now it is.");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("collectExtensionChatTurns: end-to-end with masker", { skip: !HAS_SQLITE3 }, () => {
  // Build a fake IDE userRoot under tmpdir matching the live layout
  //   <tmp>/User/workspaceStorage/<hash>/state.vscdb
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amigoodatvibe-extcache-e2e-"));
  const wsPath = path.join(tmp, "fake-workspace");
  fs.mkdirSync(wsPath, { recursive: true });

  const userRoot = path.join(tmp, "User");
  const wsHash = workspaceFolderHash(wsPath);
  const wsStorage = path.join(userRoot, "workspaceStorage", wsHash);
  fs.mkdirSync(wsStorage, { recursive: true });
  const dbPath = path.join(wsStorage, "state.vscdb");

  const copilotFixture = [
    {
      sessionId: "S1",
      requests: [
        {
          message: { text: "OPENAI=sk-abcdefghijklmnopqrstuvwxyz0123 ship it" },
          response: [{ value: "okay, but mask your key next time" }],
        },
      ],
    },
  ];
  const cursorFixture = [{ text: "refactor this method" }];

  const initSql = `
    CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
    INSERT INTO ItemTable VALUES('interactive.sessions', '${JSON.stringify(copilotFixture).replace(/'/g, "''")}');
    INSERT INTO ItemTable VALUES('aiService.prompts', '${JSON.stringify(cursorFixture).replace(/'/g, "''")}');
    INSERT INTO ItemTable VALUES('unrelated.key', 'noise');
  `;
  execFileSync("sqlite3", [dbPath, initSql], { stdio: "ignore" });

  // Also seed a chatSessions/*.jsonl file (modern VS Code GUI chat path).
  const chatSessionsDir = path.join(wsStorage, "chatSessions");
  fs.mkdirSync(chatSessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(chatSessionsDir, "sess-from-panel.jsonl"),
    JSON.stringify({
      kind: 0,
      v: {
        sessionId: "panel-1",
        version: 3,
        initialLocation: "panel",
        requests: [
          { message: { text: "panel prompt" }, response: [{ value: "panel reply" }] },
        ],
      },
    })
  );

  const diagnostics: string[] = [];
  const report = collectExtensionChatTurns({
    workspaceFsPath: wsPath,
    ideRoots: [{ name: "Fake IDE", userRoot }],
    mask: (s) => s.replace(/sk-[A-Za-z0-9]+/g, "[MASKED]"),
    onDiagnostic: (m) => diagnostics.push(m),
  });

  assert.equal(report.inspectedDbs, 1);
  assert.equal(report.inspectedSessionFiles, 1);
  assert.ok(report.matchedKeys >= 2, "at least 2 key parsers extracted data");
  // 2 turns from Copilot SQLite + 1 from Cursor + 2 from chatSessions JSONL = 5
  assert.equal(report.turns.length, 5);

  const userTurns = report.turns.filter((t) => t.turn === "user");
  const assistantTurns = report.turns.filter((t) => t.turn === "assistant");
  assert.equal(userTurns.length, 3);
  assert.equal(assistantTurns.length, 2);

  // Masker was applied: no raw `sk-...` value should leak through.
  const all = report.turns.map((t) => t.content).join("\n");
  assert.ok(!/sk-[A-Za-z0-9]/.test(all), "API key was masked");
  assert.ok(all.includes("[MASKED]"));

  // Panel-sourced turns are attributed to the chat-panel tool, not copilot-chat.
  assert.ok(
    report.turns.some((t) => t.tool === "vscode-chat-panel" && t.content === "panel prompt"),
    "chatSessions JSONL turn is tagged vscode-chat-panel"
  );

  assert.ok(diagnostics.length >= 2, "diagnostic per inspected DB + chatSessions dir");
  assert.ok(diagnostics.some((d) => d.includes("chatSessions")));

  fs.rmSync(tmp, { recursive: true, force: true });
});
