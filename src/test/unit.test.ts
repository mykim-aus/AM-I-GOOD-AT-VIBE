/**
 * AM I GOOD AT VIBE — Unit tests
 *
 * Uses Node's built-in `node:test` runner (zero external dependencies).
 * Covers util.ts (pure helpers) and prompt.ts (systemInstruction) only.
 * Code that depends on the vscode module is verified manually in the
 * Extension Development Host.
 *
 * Run:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MARKETPLACE_URL,
  matchAiCli,
  applyMaskPatterns,
  stripAnsi,
  ANSI_REGEX,
  clampScore,
  escapeHtml,
  extractJsonObject,
  buildShareText,
  buildTwitterShareUrl,
  buildLinkedInShareUrl,
  AI_CLI_PATTERNS,
  MASK_PATTERNS,
  REPL_USER_INDICATORS,
  classifyReplLine,
  compressLogForAnalysis,
} from "../util";

import { SYSTEM_INSTRUCTION, buildAnalysisPrompt } from "../prompt";

// =============================================================================
// matchAiCli — Regex matrix for 9 AI CLI tools
// =============================================================================

test("matchAiCli: claude with double-quoted prompt", () => {
  const r = matchAiCli('claude "write me a hello world function"');
  assert.deepEqual(r, { tool: "claude-code", prompt: "write me a hello world function" });
});

test("matchAiCli: claude -p flag with single quotes", () => {
  const r = matchAiCli("claude -p 'fix this bug'");
  assert.deepEqual(r, { tool: "claude-code", prompt: "fix this bug" });
});

test("matchAiCli: claude bare REPL invocation", () => {
  const r = matchAiCli("claude");
  assert.deepEqual(r, { tool: "claude-code", prompt: "<INTERACTIVE_REPL_START>" });
});

test("matchAiCli: claude with unquoted prompt", () => {
  const r = matchAiCli("claude refactor this");
  assert.deepEqual(r, { tool: "claude-code", prompt: "refactor this" });
});

test("matchAiCli: codex chat", () => {
  const r = matchAiCli('codex chat "explain this code"');
  assert.deepEqual(r, { tool: "codex", prompt: "explain this code" });
});

test("matchAiCli: codex exec", () => {
  const r = matchAiCli('codex exec "run migration"');
  assert.deepEqual(r, { tool: "codex", prompt: "run migration" });
});

test("matchAiCli: gemini chat", () => {
  const r = matchAiCli('gemini chat "what is dependency injection"');
  assert.deepEqual(r, { tool: "gemini", prompt: "what is dependency injection" });
});

test("matchAiCli: aider --message", () => {
  const r = matchAiCli('aider --message "add a new endpoint"');
  assert.deepEqual(r, { tool: "aider", prompt: "add a new endpoint" });
});

test("matchAiCli: amazon q chat", () => {
  const r = matchAiCli('q chat "deploy to staging"');
  assert.deepEqual(r, { tool: "amazon-q", prompt: "deploy to staging" });
});

test("matchAiCli: gh copilot suggest", () => {
  const r = matchAiCli('gh copilot suggest "list pods in namespace"');
  assert.deepEqual(r, { tool: "gh-copilot", prompt: "list pods in namespace" });
});

test("matchAiCli: cody chat", () => {
  const r = matchAiCli('cody chat "explain symbol"');
  assert.deepEqual(r, { tool: "cody", prompt: "explain symbol" });
});

test("matchAiCli: cursor-agent", () => {
  const r = matchAiCli('cursor-agent "create a unit test"');
  assert.deepEqual(r, { tool: "cursor-agent", prompt: "create a unit test" });
});

test("matchAiCli: non-AI command returns null", () => {
  assert.equal(matchAiCli("ls -la"), null);
  assert.equal(matchAiCli("git status"), null);
  assert.equal(matchAiCli("npm install express"), null);
});

test("matchAiCli: empty / whitespace returns null", () => {
  assert.equal(matchAiCli(""), null);
  assert.equal(matchAiCli("   "), null);
});

test("AI_CLI_PATTERNS: covers all expected tools", () => {
  const tools = new Set(AI_CLI_PATTERNS.map((p) => p.tool));
  for (const expected of [
    "claude-code", "codex", "gemini", "aider",
    "amazon-q", "gh-copilot", "cody", "cursor-agent",
  ]) {
    assert.ok(tools.has(expected), `tool '${expected}' is registered`);
  }
});

// =============================================================================
// applyMaskPatterns — Security masking
// =============================================================================

test("applyMaskPatterns: masks OpenAI key", () => {
  const out = applyMaskPatterns("export OPENAI_API_KEY=sk-abcdefghijklmnop1234567890");
  assert.ok(out.includes("[MASKED_OPENAI_KEY]"));
  assert.ok(!out.includes("sk-abcdefghijklmnop1234567890"));
});

test("applyMaskPatterns: masks Anthropic key (not collided with OpenAI)", () => {
  const out = applyMaskPatterns("ANTHROPIC=sk-ant-api03-1234567890abcdefghij");
  assert.ok(out.includes("[MASKED_ANTHROPIC_KEY]"));
  assert.ok(!out.includes("[MASKED_OPENAI_KEY]"));
});

test("applyMaskPatterns: masks Gemini key", () => {
  const out = applyMaskPatterns("GOOGLE=AIzaSyD-1234567890abcdefghijklmnopqrstuvw");
  assert.ok(out.includes("[MASKED_GEMINI_KEY]"));
});

test("applyMaskPatterns: masks GitHub PAT", () => {
  const out = applyMaskPatterns("token: ghp_abcdefghijklmnop1234567890");
  assert.ok(out.includes("[MASKED_GITHUB_TOKEN]"));
});

test("applyMaskPatterns: masks AWS access key", () => {
  const out = applyMaskPatterns("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
  assert.ok(out.includes("[MASKED_AWS_KEY]"));
});

test("applyMaskPatterns: masks JWT", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.4Adcj3UFYzPUVaVF43FmMab6RlaQD8A9V8wFzzht-KQ";
  const out = applyMaskPatterns(`Authorization: ${jwt}`);
  assert.ok(out.includes("[MASKED_JWT]"));
});

test("applyMaskPatterns: masks Bearer token", () => {
  const out = applyMaskPatterns("curl -H 'Authorization: Bearer abc123def456ghi789'");
  assert.ok(out.includes("[MASKED_BEARER]"));
});

test("applyMaskPatterns: masks password assignment", () => {
  const out = applyMaskPatterns("password=hunter2");
  assert.ok(out.includes("[MASKED_PASSWORD_ASSIGNMENT]"));
  assert.ok(!out.includes("hunter2"));
});

test("applyMaskPatterns: masks .env line", () => {
  const out = applyMaskPatterns("DATABASE_URL=postgres://user:pw@localhost/db");
  assert.ok(out.includes("[MASKED_DOTENV_LINE]"));
});

test("applyMaskPatterns: leaves benign text alone", () => {
  const input = "// just a normal comment\nconst x = 1;";
  assert.equal(applyMaskPatterns(input), input);
});

test("MASK_PATTERNS: defines all expected pattern names", () => {
  const names = new Set(MASK_PATTERNS.map((p) => p.name));
  for (const expected of [
    "ANTHROPIC_KEY", "OPENAI_KEY", "GEMINI_KEY", "GITHUB_TOKEN", "AWS_KEY",
    "JWT", "BEARER", "PASSWORD_ASSIGNMENT", "SECRET_ASSIGNMENT", "DOTENV_LINE",
  ]) {
    assert.ok(names.has(expected), `pattern ${expected} exists`);
  }
});

// =============================================================================
// stripAnsi & ANSI_REGEX
// =============================================================================

test("stripAnsi: removes color codes", () => {
  const colored = "\x1B[31mERROR:\x1B[0m something wrong";
  assert.equal(stripAnsi(colored), "ERROR: something wrong");
});

test("stripAnsi: removes cursor / clear codes", () => {
  const s = "before\x1B[2Jafter";
  assert.equal(stripAnsi(s), "beforeafter");
});

test("stripAnsi: idempotent on plain text", () => {
  assert.equal(stripAnsi("just text"), "just text");
});

test("ANSI_REGEX: is a valid global regex", () => {
  assert.ok(ANSI_REGEX instanceof RegExp);
  assert.ok(ANSI_REGEX.global);
});

// =============================================================================
// REPL_USER_INDICATORS
// =============================================================================

test("REPL_USER_INDICATORS: matches common REPL prompt lines", () => {
  assert.ok(REPL_USER_INDICATORS.test("> hello"));
  assert.ok(REPL_USER_INDICATORS.test("❯ command"));
  assert.ok(REPL_USER_INDICATORS.test("Human: question"));
  assert.ok(REPL_USER_INDICATORS.test("User: q"));
  assert.ok(REPL_USER_INDICATORS.test("You: hi"));
});

test("REPL_USER_INDICATORS: rejects non-prompt lines", () => {
  assert.ok(!REPL_USER_INDICATORS.test("just text"));
  assert.ok(!REPL_USER_INDICATORS.test("123 numbers"));
});

// =============================================================================
// classifyReplLine — Claude Code REPL line classification
// =============================================================================

test("classifyReplLine: ❯ prefix → user turn", () => {
  const r = classifyReplLine("❯ don't change anything. I am just testing");
  assert.equal(r.kind, "user");
  if (r.kind === "user") {
    assert.equal(r.content, "don't change anything. I am just testing");
  }
});

test("classifyReplLine: ⏺ prefix → assistant turn", () => {
  const r = classifyReplLine("⏺ Got it — I won't touch anything. Happy testing!");
  assert.equal(r.kind, "assistant");
  if (r.kind === "assistant") {
    assert.equal(r.content, "Got it — I won't touch anything. Happy testing!");
  }
});

test("classifyReplLine: > prompt prefix → user", () => {
  const r = classifyReplLine("> hello world");
  assert.equal(r.kind, "user");
});

test("classifyReplLine: Human: prefix → user", () => {
  const r = classifyReplLine("Human: explain dependency injection");
  assert.equal(r.kind, "user");
  if (r.kind === "user") assert.equal(r.content, "explain dependency injection");
});

test("classifyReplLine: empty line → blank", () => {
  assert.equal(classifyReplLine("").kind, "blank");
  assert.equal(classifyReplLine("   \t").kind, "blank");
});

test("classifyReplLine: ANSI-colored ❯ still detected", () => {
  const r = classifyReplLine("\x1B[36m❯\x1B[0m my prompt");
  assert.equal(r.kind, "user");
});

test("classifyReplLine: box-drawing UI noise → ui", () => {
  const r = classifyReplLine("╭───────────────────────────────╮");
  // If all box chars get replaced with spaces it becomes blank; otherwise ui
  assert.ok(r.kind === "blank" || r.kind === "ui");
});

test("classifyReplLine: plain text without markers → ui (assistant continuation candidate)", () => {
  const r = classifyReplLine("just a plain response continuation");
  assert.equal(r.kind, "ui");
  if (r.kind === "ui") {
    assert.equal(r.content, "just a plain response continuation");
  }
});

// =============================================================================
// clampScore
// =============================================================================

test("clampScore: clamps within 0-100", () => {
  assert.equal(clampScore(50), 50);
  assert.equal(clampScore(-10), 0);
  assert.equal(clampScore(150), 100);
});

test("clampScore: rounds floats", () => {
  assert.equal(clampScore(72.7), 73);
  assert.equal(clampScore(72.3), 72);
});

test("clampScore: non-numbers become 0", () => {
  assert.equal(clampScore("abc"), 0);
  assert.equal(clampScore(undefined), 0);
  assert.equal(clampScore(null), 0);
  assert.equal(clampScore(NaN), 0);
  assert.equal(clampScore(Infinity), 0);
});

// =============================================================================
// escapeHtml
// =============================================================================

test("escapeHtml: escapes HTML special chars", () => {
  assert.equal(
    escapeHtml(`<script>alert("hi")</script>`),
    `&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;`
  );
});

test("escapeHtml: escapes ampersand and single quote", () => {
  assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
});

test("escapeHtml: handles undefined/null safely", () => {
  // @ts-expect-error testing runtime safety
  assert.equal(escapeHtml(undefined), "");
  // @ts-expect-error testing runtime safety
  assert.equal(escapeHtml(null), "");
});

// =============================================================================
// extractJsonObject
// =============================================================================

test("extractJsonObject: parses clean JSON", () => {
  const r = extractJsonObject<{ a: number }>('{"a":1}');
  assert.deepEqual(r, { a: 1 });
});

test("extractJsonObject: strips markdown code fence", () => {
  const r = extractJsonObject<{ a: number }>('```json\n{"a":2}\n```');
  assert.deepEqual(r, { a: 2 });
});

test("extractJsonObject: extracts JSON from surrounding text", () => {
  const text = 'Here is the result: {"score": 88, "name": "test"} hope this helps';
  const r = extractJsonObject<{ score: number; name: string }>(text);
  assert.deepEqual(r, { score: 88, name: "test" });
});

test("extractJsonObject: returns null on garbage", () => {
  assert.equal(extractJsonObject("nothing parseable here"), null);
  assert.equal(extractJsonObject(""), null);
});

test("extractJsonObject: handles nested objects", () => {
  const text = '{"a": {"b": {"c": 1}}, "d": [1,2,3]}';
  const r = extractJsonObject<Record<string, unknown>>(text);
  assert.deepEqual(r, { a: { b: { c: 1 } }, d: [1, 2, 3] });
});

// =============================================================================
// Social share — the heart of the vibe coder badge
// =============================================================================

test("buildShareText: includes nickname, score, marketplace URL", () => {
  const t = buildShareText("Claude Whisperer Pro", 87);
  assert.ok(t.includes("Claude Whisperer Pro"));
  assert.ok(t.includes("87"));
  assert.ok(t.includes(MARKETPLACE_URL));
  assert.ok(t.includes("AM I GOOD AT VIBE"));
});

test("buildShareText: clamps score within 0-100", () => {
  const high = buildShareText("nick", 250);
  assert.ok(high.includes("100"));
  const low = buildShareText("nick", -5);
  assert.ok(low.includes("0"));
});

test("buildShareText: falls back when nickname is empty", () => {
  const t = buildShareText("", 50);
  assert.ok(t.includes("vibe coder seedling"));
});

test("buildTwitterShareUrl: produces a valid twitter intent URL", () => {
  const url = buildTwitterShareUrl("Tab-Tab Brain-Outsourcer", 72);
  assert.ok(url.startsWith("https://twitter.com/intent/tweet?text="));
  // The URL must contain the encoded nickname
  assert.ok(url.includes(encodeURIComponent("Tab-Tab Brain-Outsourcer")));
  assert.ok(url.includes(encodeURIComponent("72")));
});

test("buildLinkedInShareUrl: targets share-offsite with marketplace url", () => {
  const url = buildLinkedInShareUrl();
  assert.ok(url.startsWith("https://www.linkedin.com/sharing/share-offsite/"));
  assert.ok(url.includes(encodeURIComponent(MARKETPLACE_URL)));
});

// =============================================================================
// prompt.ts
// =============================================================================

test("SYSTEM_INSTRUCTION: mentions all 6 competency keys", () => {
  for (const key of [
    "prompt_quality", "context_setting", "iteration_efficiency",
    "security_awareness", "code_review_habit", "tool_diversity",
  ]) {
    assert.ok(SYSTEM_INSTRUCTION.includes(key), `SYSTEM_INSTRUCTION includes ${key}`);
  }
});

test("SYSTEM_INSTRUCTION: enforces nickname and one_line_pack output fields", () => {
  assert.ok(SYSTEM_INSTRUCTION.includes('"nickname"'));
  assert.ok(SYSTEM_INSTRUCTION.includes('"one_line_pack"'));
  assert.ok(SYSTEM_INSTRUCTION.includes('"action_items"'));
});

test("SYSTEM_INSTRUCTION: requires JSON-only output (no markdown)", () => {
  assert.ok(SYSTEM_INSTRUCTION.includes("VALID JSON"));
  assert.ok(SYSTEM_INSTRUCTION.toLowerCase().includes("markdown"));
});

test("SYSTEM_INSTRUCTION: instructs output language detection (EN/KO only)", () => {
  // Only English and Korean are supported; everything else falls back to English.
  assert.ok(SYSTEM_INSTRUCTION.includes("Only TWO output languages are supported"));
  assert.ok(SYSTEM_INSTRUCTION.includes("THAT detected language"));
  assert.ok(SYSTEM_INSTRUCTION.includes("default to English"));
  // Modules for other languages must NOT be present anymore.
  assert.ok(!/\bJA — Japanese\b/.test(SYSTEM_INSTRUCTION));
  assert.ok(!/\bZH — Chinese\b/.test(SYSTEM_INSTRUCTION));
});

test("buildAnalysisPrompt: combines instruction + raw log + request", () => {
  const out = buildAnalysisPrompt('[{"ts":"t","type":"ai_chat","content":"hi"}]');
  assert.ok(out.includes(SYSTEM_INSTRUCTION));
  assert.ok(out.includes("[RAW_LOG_JSON]"));
  assert.ok(out.includes("[ANALYSIS_REQUEST]"));
  assert.ok(out.includes('"type":"ai_chat"'));
});

test("buildAnalysisPrompt: clips oversized logs", () => {
  const big = "x".repeat(2_000_000); // 2MB
  const out = buildAnalysisPrompt(big, { maxBytes: 100_000 });
  // 100KB clip + system instruction + boilerplate < 2MB
  assert.ok(out.length < 2_000_000);
  assert.ok(out.includes("exceeded 100,000 bytes"));
});

test("buildAnalysisPrompt: passes through small logs unchanged", () => {
  const small = '[{"a":1}]';
  const out = buildAnalysisPrompt(small);
  assert.ok(out.includes(small));
  assert.ok(!out.includes("exceeded"));
});

test("buildAnalysisPrompt: auto mode keeps the detect-language directive", () => {
  const out = buildAnalysisPrompt("[]", { outputLanguage: "auto" });
  assert.ok(out.includes("Detect the primary language"));
  assert.ok(!out.includes("OUTPUT LANGUAGE OVERRIDE"));
});

test("buildAnalysisPrompt: explicit korean injects the override block", () => {
  const out = buildAnalysisPrompt("[]", { outputLanguage: "korean" });
  assert.ok(out.includes("OUTPUT LANGUAGE OVERRIDE"));
  assert.ok(out.includes("Korean"));
  assert.ok(out.includes("KO module"));
  assert.ok(!out.includes("Detect the primary language"));
});

test("buildAnalysisPrompt: explicit english injects EN module", () => {
  const out = buildAnalysisPrompt("[]", { outputLanguage: "english" });
  assert.ok(out.includes("OUTPUT LANGUAGE OVERRIDE"));
  assert.ok(out.includes("EN module"));
});

// =============================================================================
// compressLogForAnalysis
// =============================================================================

test("compressLogForAnalysis: returns empty shape for malformed input", () => {
  const out = JSON.parse(compressLogForAnalysis("not-json"));
  assert.equal(out.session.n_raw_events, 0);
  assert.deepEqual(out.ai_chats, []);
  assert.deepEqual(out.code_changes, []);
});

test("compressLogForAnalysis: drops empty-snippet micro-deletions", () => {
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "code_change",
      file: "a.ts", added: 0, removed: 3, snippet: "" },
    { ts: "2026-05-21T10:00:05Z", type: "code_change",
      file: "a.ts", added: 0, removed: 4, snippet: "" },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.code_changes.length, 0);
});

test("compressLogForAnalysis: merges same-file edits within window", () => {
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "code_change",
      file: "a.ts", added: 10, removed: 2, snippet: "x" },
    { ts: "2026-05-21T10:00:30Z", type: "code_change",
      file: "a.ts", added: 5, removed: 1, snippet: "y" },
    { ts: "2026-05-21T10:00:45Z", type: "code_change",
      file: "a.ts", added: 7, removed: 0, snippet: "z" },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.code_changes.length, 1);
  assert.equal(out.code_changes[0].edits, 3);
  assert.equal(out.code_changes[0].added, 22);
  assert.equal(out.code_changes[0].removed, 3);
  assert.match(out.code_changes[0].span, /^\+0s\.\.\+/);
});

test("compressLogForAnalysis: does NOT merge across the window boundary", () => {
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "code_change",
      file: "a.ts", added: 10, removed: 0, snippet: "x" },
    { ts: "2026-05-21T10:05:00Z", type: "code_change",  // 5min gap
      file: "a.ts", added: 5,  removed: 0, snippet: "y" },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.code_changes.length, 2);
});

test("compressLogForAnalysis: truncates long ai_chat content with a hint", () => {
  const longText = "A".repeat(2000);
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "ai_chat", turn: "user",
      tool: "claude", source: "cui", sessionId: "x", content: longText },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.ai_chats.length, 1);
  assert.ok(out.ai_chats[0].content.length < longText.length);
  assert.match(out.ai_chats[0].content, /…\(\+\d+c\)$/);
});

test("compressLogForAnalysis: rewrites timestamps as relative offsets", () => {
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "ai_chat", turn: "user",
      tool: "claude", source: "cui", sessionId: "x", content: "hi" },
    { ts: "2026-05-21T10:00:12Z", type: "ai_chat", turn: "assistant",
      tool: "claude", source: "cui", sessionId: "x", content: "hello" },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.ai_chats[0].t, "+0s");
  assert.equal(out.ai_chats[1].t, "+12s");
});

test("compressLogForAnalysis: drops cwd from terminal commands; keeps non-zero exit", () => {
  const raw = JSON.stringify([
    { ts: "2026-05-21T10:00:00Z", type: "terminal_command",
      command: "npm test", cwd: "/x", exitCode: 0 },
    { ts: "2026-05-21T10:00:05Z", type: "terminal_command",
      command: "ls /nope", cwd: "/x", exitCode: 2 },
  ]);
  const out = JSON.parse(compressLogForAnalysis(raw));
  assert.equal(out.terminal_commands.length, 2);
  assert.equal(out.terminal_commands[0].cmd, "npm test");
  assert.equal(out.terminal_commands[0].exit, undefined);
  assert.equal(out.terminal_commands[1].exit, 2);
  assert.equal(out.terminal_commands[0].cwd, undefined);
});

test("compressLogForAnalysis: significantly shrinks a realistic noisy log", () => {
  // Mimics the user-reported pattern: 8 micro code_change events on 2 files.
  const raw = JSON.stringify([
    { ts: "2026-05-21T09:59:14Z", type: "code_change",
      file: "src/extension.ts", added: 0, removed: 9, snippet: "" },
    { ts: "2026-05-21T09:59:18Z", type: "code_change",
      file: "src/extension.ts", added: 0, removed: 7, snippet: "" },
    { ts: "2026-05-21T09:59:29Z", type: "code_change",
      file: "src/extension.ts", added: 7, removed: 5,
      snippet: "    <button class=\"link-btn primary\"..." },
    { ts: "2026-05-21T09:59:35Z", type: "code_change",
      file: "src/prompt.ts", added: 80, removed: 39,
      snippet: "/** Explicit output-language choice. */" },
    { ts: "2026-05-21T09:59:38Z", type: "code_change",
      file: "src/extension.ts", added: 434, removed: 413,
      snippet: "    <div class=\"version\">v0.1.1</div>" },
    { ts: "2026-05-21T09:59:52Z", type: "code_change",
      file: "src/extension.ts", added: 14, removed: 0,
      snippet: "  static outputLanguage()" },
    { ts: "2026-05-21T10:00:01Z", type: "code_change",
      file: "src/extension.ts", added: 4, removed: 2,
      snippet: "const finalPrompt = buildAnalysisPrompt" },
    { ts: "2026-05-21T10:00:12Z", type: "code_change",
      file: "src/extension.ts", added: 17, removed: 7,
      snippet: "view.webview.onDidReceiveMessage" },
  ]);
  const compressed = compressLogForAnalysis(raw);
  const out = JSON.parse(compressed);
  // 8 raw entries → 2 merged buckets (one per file).
  assert.equal(out.code_changes.length, 2);
  const extBucket = out.code_changes.find((c: { file: string }) =>
    c.file === "src/extension.ts"
  );
  assert.equal(extBucket.edits, 7); // 2 empty-deletion entries dropped → 6 real;
                                    // wait: the 2 empty are kept iff removed>=5.
                                    // Here removed=9 and removed=7 (both ≥5)
                                    // so they survive — total = 7 edits.
  // Compression must be substantially smaller than raw JSON.
  assert.ok(compressed.length < raw.length / 2,
    `expected >2× compression; got raw=${raw.length} compressed=${compressed.length}`);
  // The clipped/useless snippets must NOT appear.
  assert.ok(!compressed.includes("link-btn primary"));
  assert.ok(!compressed.includes("version"));
});
