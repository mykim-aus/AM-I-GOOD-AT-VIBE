"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const util_1 = require("../util");
const prompt_1 = require("../prompt");
// =============================================================================
// matchAiCli — Regex matrix for 9 AI CLI tools
// =============================================================================
(0, node_test_1.default)("matchAiCli: claude with double-quoted prompt", () => {
    const r = (0, util_1.matchAiCli)('claude "write me a hello world function"');
    strict_1.default.deepEqual(r, { tool: "claude-code", prompt: "write me a hello world function" });
});
(0, node_test_1.default)("matchAiCli: claude -p flag with single quotes", () => {
    const r = (0, util_1.matchAiCli)("claude -p 'fix this bug'");
    strict_1.default.deepEqual(r, { tool: "claude-code", prompt: "fix this bug" });
});
(0, node_test_1.default)("matchAiCli: claude bare REPL invocation", () => {
    const r = (0, util_1.matchAiCli)("claude");
    strict_1.default.deepEqual(r, { tool: "claude-code", prompt: "<INTERACTIVE_REPL_START>" });
});
(0, node_test_1.default)("matchAiCli: claude with unquoted prompt", () => {
    const r = (0, util_1.matchAiCli)("claude refactor this");
    strict_1.default.deepEqual(r, { tool: "claude-code", prompt: "refactor this" });
});
(0, node_test_1.default)("matchAiCli: codex chat", () => {
    const r = (0, util_1.matchAiCli)('codex chat "explain this code"');
    strict_1.default.deepEqual(r, { tool: "codex", prompt: "explain this code" });
});
(0, node_test_1.default)("matchAiCli: codex exec", () => {
    const r = (0, util_1.matchAiCli)('codex exec "run migration"');
    strict_1.default.deepEqual(r, { tool: "codex", prompt: "run migration" });
});
(0, node_test_1.default)("matchAiCli: gemini chat", () => {
    const r = (0, util_1.matchAiCli)('gemini chat "what is dependency injection"');
    strict_1.default.deepEqual(r, { tool: "gemini", prompt: "what is dependency injection" });
});
(0, node_test_1.default)("matchAiCli: aider --message", () => {
    const r = (0, util_1.matchAiCli)('aider --message "add a new endpoint"');
    strict_1.default.deepEqual(r, { tool: "aider", prompt: "add a new endpoint" });
});
(0, node_test_1.default)("matchAiCli: amazon q chat", () => {
    const r = (0, util_1.matchAiCli)('q chat "deploy to staging"');
    strict_1.default.deepEqual(r, { tool: "amazon-q", prompt: "deploy to staging" });
});
(0, node_test_1.default)("matchAiCli: gh copilot suggest", () => {
    const r = (0, util_1.matchAiCli)('gh copilot suggest "list pods in namespace"');
    strict_1.default.deepEqual(r, { tool: "gh-copilot", prompt: "list pods in namespace" });
});
(0, node_test_1.default)("matchAiCli: cody chat", () => {
    const r = (0, util_1.matchAiCli)('cody chat "explain symbol"');
    strict_1.default.deepEqual(r, { tool: "cody", prompt: "explain symbol" });
});
(0, node_test_1.default)("matchAiCli: cursor-agent", () => {
    const r = (0, util_1.matchAiCli)('cursor-agent "create a unit test"');
    strict_1.default.deepEqual(r, { tool: "cursor-agent", prompt: "create a unit test" });
});
(0, node_test_1.default)("matchAiCli: non-AI command returns null", () => {
    strict_1.default.equal((0, util_1.matchAiCli)("ls -la"), null);
    strict_1.default.equal((0, util_1.matchAiCli)("git status"), null);
    strict_1.default.equal((0, util_1.matchAiCli)("npm install express"), null);
});
(0, node_test_1.default)("matchAiCli: empty / whitespace returns null", () => {
    strict_1.default.equal((0, util_1.matchAiCli)(""), null);
    strict_1.default.equal((0, util_1.matchAiCli)("   "), null);
});
(0, node_test_1.default)("AI_CLI_PATTERNS: covers all expected tools", () => {
    const tools = new Set(util_1.AI_CLI_PATTERNS.map((p) => p.tool));
    for (const expected of [
        "claude-code", "codex", "gemini", "aider",
        "amazon-q", "gh-copilot", "cody", "cursor-agent",
    ]) {
        strict_1.default.ok(tools.has(expected), `tool '${expected}' is registered`);
    }
});
// =============================================================================
// applyMaskPatterns — Security masking
// =============================================================================
(0, node_test_1.default)("applyMaskPatterns: masks OpenAI key", () => {
    const out = (0, util_1.applyMaskPatterns)("export OPENAI_API_KEY=sk-abcdefghijklmnop1234567890");
    strict_1.default.ok(out.includes("[MASKED_OPENAI_KEY]"));
    strict_1.default.ok(!out.includes("sk-abcdefghijklmnop1234567890"));
});
(0, node_test_1.default)("applyMaskPatterns: masks Anthropic key (not collided with OpenAI)", () => {
    const out = (0, util_1.applyMaskPatterns)("ANTHROPIC=sk-ant-api03-1234567890abcdefghij");
    strict_1.default.ok(out.includes("[MASKED_ANTHROPIC_KEY]"));
    strict_1.default.ok(!out.includes("[MASKED_OPENAI_KEY]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks Gemini key", () => {
    const out = (0, util_1.applyMaskPatterns)("GOOGLE=AIzaSyD-1234567890abcdefghijklmnopqrstuvw");
    strict_1.default.ok(out.includes("[MASKED_GEMINI_KEY]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks GitHub PAT", () => {
    const out = (0, util_1.applyMaskPatterns)("token: ghp_abcdefghijklmnop1234567890");
    strict_1.default.ok(out.includes("[MASKED_GITHUB_TOKEN]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks AWS access key", () => {
    const out = (0, util_1.applyMaskPatterns)("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    strict_1.default.ok(out.includes("[MASKED_AWS_KEY]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.4Adcj3UFYzPUVaVF43FmMab6RlaQD8A9V8wFzzht-KQ";
    const out = (0, util_1.applyMaskPatterns)(`Authorization: ${jwt}`);
    strict_1.default.ok(out.includes("[MASKED_JWT]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks Bearer token", () => {
    const out = (0, util_1.applyMaskPatterns)("curl -H 'Authorization: Bearer abc123def456ghi789'");
    strict_1.default.ok(out.includes("[MASKED_BEARER]"));
});
(0, node_test_1.default)("applyMaskPatterns: masks password assignment", () => {
    const out = (0, util_1.applyMaskPatterns)("password=hunter2");
    strict_1.default.ok(out.includes("[MASKED_PASSWORD_ASSIGNMENT]"));
    strict_1.default.ok(!out.includes("hunter2"));
});
(0, node_test_1.default)("applyMaskPatterns: masks .env line", () => {
    const out = (0, util_1.applyMaskPatterns)("DATABASE_URL=postgres://user:pw@localhost/db");
    strict_1.default.ok(out.includes("[MASKED_DOTENV_LINE]"));
});
(0, node_test_1.default)("applyMaskPatterns: leaves benign text alone", () => {
    const input = "// just a normal comment\nconst x = 1;";
    strict_1.default.equal((0, util_1.applyMaskPatterns)(input), input);
});
(0, node_test_1.default)("MASK_PATTERNS: defines all expected pattern names", () => {
    const names = new Set(util_1.MASK_PATTERNS.map((p) => p.name));
    for (const expected of [
        "ANTHROPIC_KEY", "OPENAI_KEY", "GEMINI_KEY", "GITHUB_TOKEN", "AWS_KEY",
        "JWT", "BEARER", "PASSWORD_ASSIGNMENT", "SECRET_ASSIGNMENT", "DOTENV_LINE",
    ]) {
        strict_1.default.ok(names.has(expected), `pattern ${expected} exists`);
    }
});
// =============================================================================
// stripAnsi & ANSI_REGEX
// =============================================================================
(0, node_test_1.default)("stripAnsi: removes color codes", () => {
    const colored = "\x1B[31mERROR:\x1B[0m something wrong";
    strict_1.default.equal((0, util_1.stripAnsi)(colored), "ERROR: something wrong");
});
(0, node_test_1.default)("stripAnsi: removes cursor / clear codes", () => {
    const s = "before\x1B[2Jafter";
    strict_1.default.equal((0, util_1.stripAnsi)(s), "beforeafter");
});
(0, node_test_1.default)("stripAnsi: idempotent on plain text", () => {
    strict_1.default.equal((0, util_1.stripAnsi)("just text"), "just text");
});
(0, node_test_1.default)("ANSI_REGEX: is a valid global regex", () => {
    strict_1.default.ok(util_1.ANSI_REGEX instanceof RegExp);
    strict_1.default.ok(util_1.ANSI_REGEX.global);
});
// =============================================================================
// REPL_USER_INDICATORS
// =============================================================================
(0, node_test_1.default)("REPL_USER_INDICATORS: matches common REPL prompt lines", () => {
    strict_1.default.ok(util_1.REPL_USER_INDICATORS.test("> hello"));
    strict_1.default.ok(util_1.REPL_USER_INDICATORS.test("❯ command"));
    strict_1.default.ok(util_1.REPL_USER_INDICATORS.test("Human: question"));
    strict_1.default.ok(util_1.REPL_USER_INDICATORS.test("User: q"));
    strict_1.default.ok(util_1.REPL_USER_INDICATORS.test("You: hi"));
});
(0, node_test_1.default)("REPL_USER_INDICATORS: rejects non-prompt lines", () => {
    strict_1.default.ok(!util_1.REPL_USER_INDICATORS.test("just text"));
    strict_1.default.ok(!util_1.REPL_USER_INDICATORS.test("123 numbers"));
});
// =============================================================================
// classifyReplLine — Claude Code REPL line classification
// =============================================================================
(0, node_test_1.default)("classifyReplLine: ❯ prefix → user turn", () => {
    const r = (0, util_1.classifyReplLine)("❯ don't change anything. I am just testing");
    strict_1.default.equal(r.kind, "user");
    if (r.kind === "user") {
        strict_1.default.equal(r.content, "don't change anything. I am just testing");
    }
});
(0, node_test_1.default)("classifyReplLine: ⏺ prefix → assistant turn", () => {
    const r = (0, util_1.classifyReplLine)("⏺ Got it — I won't touch anything. Happy testing!");
    strict_1.default.equal(r.kind, "assistant");
    if (r.kind === "assistant") {
        strict_1.default.equal(r.content, "Got it — I won't touch anything. Happy testing!");
    }
});
(0, node_test_1.default)("classifyReplLine: > prompt prefix → user", () => {
    const r = (0, util_1.classifyReplLine)("> hello world");
    strict_1.default.equal(r.kind, "user");
});
(0, node_test_1.default)("classifyReplLine: Human: prefix → user", () => {
    const r = (0, util_1.classifyReplLine)("Human: explain dependency injection");
    strict_1.default.equal(r.kind, "user");
    if (r.kind === "user")
        strict_1.default.equal(r.content, "explain dependency injection");
});
(0, node_test_1.default)("classifyReplLine: empty line → blank", () => {
    strict_1.default.equal((0, util_1.classifyReplLine)("").kind, "blank");
    strict_1.default.equal((0, util_1.classifyReplLine)("   \t").kind, "blank");
});
(0, node_test_1.default)("classifyReplLine: ANSI-colored ❯ still detected", () => {
    const r = (0, util_1.classifyReplLine)("\x1B[36m❯\x1B[0m my prompt");
    strict_1.default.equal(r.kind, "user");
});
(0, node_test_1.default)("classifyReplLine: box-drawing UI noise → ui", () => {
    const r = (0, util_1.classifyReplLine)("╭───────────────────────────────╮");
    // If all box chars get replaced with spaces it becomes blank; otherwise ui
    strict_1.default.ok(r.kind === "blank" || r.kind === "ui");
});
(0, node_test_1.default)("classifyReplLine: plain text without markers → ui (assistant continuation candidate)", () => {
    const r = (0, util_1.classifyReplLine)("just a plain response continuation");
    strict_1.default.equal(r.kind, "ui");
    if (r.kind === "ui") {
        strict_1.default.equal(r.content, "just a plain response continuation");
    }
});
// =============================================================================
// clampScore
// =============================================================================
(0, node_test_1.default)("clampScore: clamps within 0-100", () => {
    strict_1.default.equal((0, util_1.clampScore)(50), 50);
    strict_1.default.equal((0, util_1.clampScore)(-10), 0);
    strict_1.default.equal((0, util_1.clampScore)(150), 100);
});
(0, node_test_1.default)("clampScore: rounds floats", () => {
    strict_1.default.equal((0, util_1.clampScore)(72.7), 73);
    strict_1.default.equal((0, util_1.clampScore)(72.3), 72);
});
(0, node_test_1.default)("clampScore: non-numbers become 0", () => {
    strict_1.default.equal((0, util_1.clampScore)("abc"), 0);
    strict_1.default.equal((0, util_1.clampScore)(undefined), 0);
    strict_1.default.equal((0, util_1.clampScore)(null), 0);
    strict_1.default.equal((0, util_1.clampScore)(NaN), 0);
    strict_1.default.equal((0, util_1.clampScore)(Infinity), 0);
});
// =============================================================================
// escapeHtml
// =============================================================================
(0, node_test_1.default)("escapeHtml: escapes HTML special chars", () => {
    strict_1.default.equal((0, util_1.escapeHtml)(`<script>alert("hi")</script>`), `&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;`);
});
(0, node_test_1.default)("escapeHtml: escapes ampersand and single quote", () => {
    strict_1.default.equal((0, util_1.escapeHtml)("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
});
(0, node_test_1.default)("escapeHtml: handles undefined/null safely", () => {
    // @ts-expect-error testing runtime safety
    strict_1.default.equal((0, util_1.escapeHtml)(undefined), "");
    // @ts-expect-error testing runtime safety
    strict_1.default.equal((0, util_1.escapeHtml)(null), "");
});
// =============================================================================
// extractJsonObject
// =============================================================================
(0, node_test_1.default)("extractJsonObject: parses clean JSON", () => {
    const r = (0, util_1.extractJsonObject)('{"a":1}');
    strict_1.default.deepEqual(r, { a: 1 });
});
(0, node_test_1.default)("extractJsonObject: strips markdown code fence", () => {
    const r = (0, util_1.extractJsonObject)('```json\n{"a":2}\n```');
    strict_1.default.deepEqual(r, { a: 2 });
});
(0, node_test_1.default)("extractJsonObject: extracts JSON from surrounding text", () => {
    const text = 'Here is the result: {"score": 88, "name": "test"} hope this helps';
    const r = (0, util_1.extractJsonObject)(text);
    strict_1.default.deepEqual(r, { score: 88, name: "test" });
});
(0, node_test_1.default)("extractJsonObject: returns null on garbage", () => {
    strict_1.default.equal((0, util_1.extractJsonObject)("nothing parseable here"), null);
    strict_1.default.equal((0, util_1.extractJsonObject)(""), null);
});
(0, node_test_1.default)("extractJsonObject: handles nested objects", () => {
    const text = '{"a": {"b": {"c": 1}}, "d": [1,2,3]}';
    const r = (0, util_1.extractJsonObject)(text);
    strict_1.default.deepEqual(r, { a: { b: { c: 1 } }, d: [1, 2, 3] });
});
// =============================================================================
// Social share — the heart of the vibe coder badge
// =============================================================================
(0, node_test_1.default)("buildShareText: includes nickname, score, marketplace URL", () => {
    const t = (0, util_1.buildShareText)("Claude Whisperer Pro", 87);
    strict_1.default.ok(t.includes("Claude Whisperer Pro"));
    strict_1.default.ok(t.includes("87"));
    strict_1.default.ok(t.includes(util_1.MARKETPLACE_URL));
    strict_1.default.ok(t.includes("AM I GOOD AT VIBE"));
});
(0, node_test_1.default)("buildShareText: clamps score within 0-100", () => {
    const high = (0, util_1.buildShareText)("nick", 250);
    strict_1.default.ok(high.includes("100"));
    const low = (0, util_1.buildShareText)("nick", -5);
    strict_1.default.ok(low.includes("0"));
});
(0, node_test_1.default)("buildShareText: falls back when nickname is empty", () => {
    const t = (0, util_1.buildShareText)("", 50);
    strict_1.default.ok(t.includes("vibe coder seedling"));
});
(0, node_test_1.default)("buildTwitterShareUrl: produces a valid twitter intent URL", () => {
    const url = (0, util_1.buildTwitterShareUrl)("Tab-Tab Brain-Outsourcer", 72);
    strict_1.default.ok(url.startsWith("https://twitter.com/intent/tweet?text="));
    // The URL must contain the encoded nickname
    strict_1.default.ok(url.includes(encodeURIComponent("Tab-Tab Brain-Outsourcer")));
    strict_1.default.ok(url.includes(encodeURIComponent("72")));
});
(0, node_test_1.default)("buildLinkedInShareUrl: targets share-offsite with marketplace url", () => {
    const url = (0, util_1.buildLinkedInShareUrl)();
    strict_1.default.ok(url.startsWith("https://www.linkedin.com/sharing/share-offsite/"));
    strict_1.default.ok(url.includes(encodeURIComponent(util_1.MARKETPLACE_URL)));
});
// =============================================================================
// prompt.ts
// =============================================================================
(0, node_test_1.default)("SYSTEM_INSTRUCTION: mentions all 6 competency keys", () => {
    for (const key of [
        "prompt_quality", "context_setting", "iteration_efficiency",
        "security_awareness", "code_review_habit", "tool_diversity",
    ]) {
        strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes(key), `SYSTEM_INSTRUCTION includes ${key}`);
    }
});
(0, node_test_1.default)("SYSTEM_INSTRUCTION: enforces nickname and one_line_pack output fields", () => {
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes('"nickname"'));
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes('"one_line_pack"'));
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes('"action_items"'));
});
(0, node_test_1.default)("SYSTEM_INSTRUCTION: requires JSON-only output (no markdown)", () => {
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes("VALID JSON"));
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.toLowerCase().includes("markdown"));
});
(0, node_test_1.default)("SYSTEM_INSTRUCTION: instructs output language detection (EN/KO only)", () => {
    // Only English and Korean are supported; everything else falls back to English.
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes("Only TWO output languages are supported"));
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes("THAT detected language"));
    strict_1.default.ok(prompt_1.SYSTEM_INSTRUCTION.includes("default to English"));
    // Modules for other languages must NOT be present anymore.
    strict_1.default.ok(!/\bJA — Japanese\b/.test(prompt_1.SYSTEM_INSTRUCTION));
    strict_1.default.ok(!/\bZH — Chinese\b/.test(prompt_1.SYSTEM_INSTRUCTION));
});
(0, node_test_1.default)("buildAnalysisPrompt: combines instruction + raw log + request", () => {
    const out = (0, prompt_1.buildAnalysisPrompt)('[{"ts":"t","type":"ai_chat","content":"hi"}]');
    strict_1.default.ok(out.includes(prompt_1.SYSTEM_INSTRUCTION));
    strict_1.default.ok(out.includes("[RAW_LOG_JSON]"));
    strict_1.default.ok(out.includes("[ANALYSIS_REQUEST]"));
    strict_1.default.ok(out.includes('"type":"ai_chat"'));
});
(0, node_test_1.default)("buildAnalysisPrompt: clips oversized logs", () => {
    const big = "x".repeat(2_000_000); // 2MB
    const out = (0, prompt_1.buildAnalysisPrompt)(big, { maxBytes: 100_000 });
    // 100KB clip + system instruction + boilerplate < 2MB
    strict_1.default.ok(out.length < 2_000_000);
    strict_1.default.ok(out.includes("exceeded 100,000 bytes"));
});
(0, node_test_1.default)("buildAnalysisPrompt: passes through small logs unchanged", () => {
    const small = '[{"a":1}]';
    const out = (0, prompt_1.buildAnalysisPrompt)(small);
    strict_1.default.ok(out.includes(small));
    strict_1.default.ok(!out.includes("exceeded"));
});
(0, node_test_1.default)("buildAnalysisPrompt: auto mode keeps the detect-language directive", () => {
    const out = (0, prompt_1.buildAnalysisPrompt)("[]", { outputLanguage: "auto" });
    strict_1.default.ok(out.includes("Detect the primary language"));
    strict_1.default.ok(!out.includes("OUTPUT LANGUAGE OVERRIDE"));
});
(0, node_test_1.default)("buildAnalysisPrompt: explicit korean injects the override block", () => {
    const out = (0, prompt_1.buildAnalysisPrompt)("[]", { outputLanguage: "korean" });
    strict_1.default.ok(out.includes("OUTPUT LANGUAGE OVERRIDE"));
    strict_1.default.ok(out.includes("Korean"));
    strict_1.default.ok(out.includes("KO module"));
    strict_1.default.ok(!out.includes("Detect the primary language"));
});
(0, node_test_1.default)("buildAnalysisPrompt: explicit english injects EN module", () => {
    const out = (0, prompt_1.buildAnalysisPrompt)("[]", { outputLanguage: "english" });
    strict_1.default.ok(out.includes("OUTPUT LANGUAGE OVERRIDE"));
    strict_1.default.ok(out.includes("EN module"));
});
// =============================================================================
// compressLogForAnalysis
// =============================================================================
(0, node_test_1.default)("compressLogForAnalysis: returns empty shape for malformed input", () => {
    const out = JSON.parse((0, util_1.compressLogForAnalysis)("not-json"));
    strict_1.default.equal(out.session.n_raw_events, 0);
    strict_1.default.deepEqual(out.ai_chats, []);
    strict_1.default.deepEqual(out.code_changes, []);
});
(0, node_test_1.default)("compressLogForAnalysis: drops empty-snippet micro-deletions", () => {
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "code_change",
            file: "a.ts", added: 0, removed: 3, snippet: "" },
        { ts: "2026-05-21T10:00:05Z", type: "code_change",
            file: "a.ts", added: 0, removed: 4, snippet: "" },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.code_changes.length, 0);
});
(0, node_test_1.default)("compressLogForAnalysis: merges same-file edits within window", () => {
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "code_change",
            file: "a.ts", added: 10, removed: 2, snippet: "x" },
        { ts: "2026-05-21T10:00:30Z", type: "code_change",
            file: "a.ts", added: 5, removed: 1, snippet: "y" },
        { ts: "2026-05-21T10:00:45Z", type: "code_change",
            file: "a.ts", added: 7, removed: 0, snippet: "z" },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.code_changes.length, 1);
    strict_1.default.equal(out.code_changes[0].edits, 3);
    strict_1.default.equal(out.code_changes[0].added, 22);
    strict_1.default.equal(out.code_changes[0].removed, 3);
    strict_1.default.match(out.code_changes[0].span, /^\+0s\.\.\+/);
});
(0, node_test_1.default)("compressLogForAnalysis: does NOT merge across the window boundary", () => {
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "code_change",
            file: "a.ts", added: 10, removed: 0, snippet: "x" },
        { ts: "2026-05-21T10:05:00Z", type: "code_change", // 5min gap
            file: "a.ts", added: 5, removed: 0, snippet: "y" },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.code_changes.length, 2);
});
(0, node_test_1.default)("compressLogForAnalysis: truncates long ai_chat content with a hint", () => {
    const longText = "A".repeat(2000);
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "ai_chat", turn: "user",
            tool: "claude", source: "cui", sessionId: "x", content: longText },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.ai_chats.length, 1);
    strict_1.default.ok(out.ai_chats[0].content.length < longText.length);
    strict_1.default.match(out.ai_chats[0].content, /…\(\+\d+c\)$/);
});
(0, node_test_1.default)("compressLogForAnalysis: rewrites timestamps as relative offsets", () => {
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "ai_chat", turn: "user",
            tool: "claude", source: "cui", sessionId: "x", content: "hi" },
        { ts: "2026-05-21T10:00:12Z", type: "ai_chat", turn: "assistant",
            tool: "claude", source: "cui", sessionId: "x", content: "hello" },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.ai_chats[0].t, "+0s");
    strict_1.default.equal(out.ai_chats[1].t, "+12s");
});
(0, node_test_1.default)("compressLogForAnalysis: drops cwd from terminal commands; keeps non-zero exit", () => {
    const raw = JSON.stringify([
        { ts: "2026-05-21T10:00:00Z", type: "terminal_command",
            command: "npm test", cwd: "/x", exitCode: 0 },
        { ts: "2026-05-21T10:00:05Z", type: "terminal_command",
            command: "ls /nope", cwd: "/x", exitCode: 2 },
    ]);
    const out = JSON.parse((0, util_1.compressLogForAnalysis)(raw));
    strict_1.default.equal(out.terminal_commands.length, 2);
    strict_1.default.equal(out.terminal_commands[0].cmd, "npm test");
    strict_1.default.equal(out.terminal_commands[0].exit, undefined);
    strict_1.default.equal(out.terminal_commands[1].exit, 2);
    strict_1.default.equal(out.terminal_commands[0].cwd, undefined);
});
(0, node_test_1.default)("compressLogForAnalysis: significantly shrinks a realistic noisy log", () => {
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
    const compressed = (0, util_1.compressLogForAnalysis)(raw);
    const out = JSON.parse(compressed);
    // 8 raw entries → 2 merged buckets (one per file).
    strict_1.default.equal(out.code_changes.length, 2);
    const extBucket = out.code_changes.find((c) => c.file === "src/extension.ts");
    strict_1.default.equal(extBucket.edits, 7); // 2 empty-deletion entries dropped → 6 real;
    // wait: the 2 empty are kept iff removed>=5.
    // Here removed=9 and removed=7 (both ≥5)
    // so they survive — total = 7 edits.
    // Compression must be substantially smaller than raw JSON.
    strict_1.default.ok(compressed.length < raw.length / 2, `expected >2× compression; got raw=${raw.length} compressed=${compressed.length}`);
    // The clipped/useless snippets must NOT appear.
    strict_1.default.ok(!compressed.includes("link-btn primary"));
    strict_1.default.ok(!compressed.includes("version"));
});
//# sourceMappingURL=unit.test.js.map