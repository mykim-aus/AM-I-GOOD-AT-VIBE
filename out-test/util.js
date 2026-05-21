"use strict";
/**
 * AM I GOOD AT VIBE — Pure helper module.
 *
 * Contains only functions, regular expressions, and constants that do not
 * depend on the vscode module. Separating these out makes the module
 * unit-testable in a plain Node environment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOX_DRAWING_REGEX = exports.REPL_ASSISTANT_MARKERS = exports.REPL_USER_INDICATORS = exports.ANSI_REGEX = exports.MASK_PATTERNS = exports.AI_CLI_PATTERNS = exports.GITHUB_URL = exports.MARKETPLACE_URL = void 0;
exports.matchAiCli = matchAiCli;
exports.applyMaskPatterns = applyMaskPatterns;
exports.stripAnsi = stripAnsi;
exports.classifyReplLine = classifyReplLine;
exports.randomSessionId = randomSessionId;
exports.clampScore = clampScore;
exports.escapeHtml = escapeHtml;
exports.extractJsonObject = extractJsonObject;
exports.buildShareText = buildShareText;
exports.buildTwitterShareUrl = buildTwitterShareUrl;
exports.buildLinkedInShareUrl = buildLinkedInShareUrl;
exports.compressLogForAnalysis = compressLogForAnalysis;
// =============================================================================
// Marketplace / external link constants
// =============================================================================
exports.MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=amigoodatvibe.amigoodatvibe";
exports.GITHUB_URL = "https://github.com/mykim-aus/AM-I-GOOD-AT-VIBE";
// =============================================================================
// AI CLI command matching
// =============================================================================
exports.AI_CLI_PATTERNS = [
    // ---- Claude Code (Anthropic) ----
    {
        tool: "claude-code",
        pattern: /^\s*claude(?:\s+(?:-p|--print))?\s+(["'])([\s\S]+?)\1\s*$/,
        promptExtractor: (m) => m[2],
    },
    {
        tool: "claude-code",
        pattern: /^\s*claude(?:\s+(?:-p|--print))?\s+([^"'\s][^\n]*)$/,
        promptExtractor: (m) => m[1],
    },
    {
        tool: "claude-code",
        pattern: /^\s*claude\s*$/,
        promptExtractor: () => "<INTERACTIVE_REPL_START>",
    },
    // ---- OpenAI Codex CLI ----
    {
        tool: "codex",
        pattern: /^\s*codex(?:\s+(?:chat|exec|run))?\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    {
        tool: "codex",
        pattern: /^\s*codex(?:\s+(?:chat|exec|run))?\s+([^"'\s][^\n]*)$/,
        promptExtractor: (m) => m[1],
    },
    // ---- Google Gemini CLI ----
    {
        tool: "gemini",
        pattern: /^\s*gemini(?:\s+chat)?\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    {
        tool: "gemini",
        pattern: /^\s*gemini(?:\s+chat)?\s+([^"'\s][^\n]*)$/,
        promptExtractor: (m) => m[1],
    },
    // ---- aider ----
    {
        tool: "aider",
        pattern: /^\s*aider\s+(?:--message\s+)?(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    // ---- Amazon Q CLI ----
    {
        tool: "amazon-q",
        pattern: /^\s*q\s+chat\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    // ---- GitHub Copilot CLI ----
    {
        tool: "gh-copilot",
        pattern: /^\s*gh\s+copilot\s+(?:suggest|explain)\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    // ---- Sourcegraph Cody ----
    {
        tool: "cody",
        pattern: /^\s*cody\s+chat\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
    // ---- Cursor Agent ----
    {
        tool: "cursor-agent",
        pattern: /^\s*cursor-agent\s+(["'])([\s\S]+?)\1/,
        promptExtractor: (m) => m[2],
    },
];
function matchAiCli(commandLine) {
    for (const { tool, pattern, promptExtractor } of exports.AI_CLI_PATTERNS) {
        const m = commandLine.match(pattern);
        if (m) {
            const prompt = promptExtractor(m).trim();
            if (prompt)
                return { tool, prompt };
        }
    }
    return null;
}
// =============================================================================
// Security masking
// =============================================================================
exports.MASK_PATTERNS = [
    { name: "ANTHROPIC_KEY", regex: /sk-ant-[A-Za-z0-9\-_]{20,}/g },
    { name: "OPENAI_KEY", regex: /sk-(?!ant-)[A-Za-z0-9]{20,}/g },
    { name: "GEMINI_KEY", regex: /AIza[0-9A-Za-z\-_]{35}/g },
    { name: "GITHUB_TOKEN", regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
    { name: "AWS_KEY", regex: /AKIA[0-9A-Z]{16}/g },
    { name: "JWT", regex: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g },
    { name: "BEARER", regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g },
    // PASSWORD/SECRET assignments run last and are guarded by a negative
    // lookahead `(?!\[MASKED_)` so they don't overwrite a more specific mask
    // that has already been applied (otherwise a precise label would be replaced
    // by a generic one).
    { name: "PASSWORD_ASSIGNMENT", regex: /(?<=\b(?:password|passwd|pwd)\s*[:=]\s*["']?)(?!\[MASKED_)[^\s"',;]+/gi },
    { name: "SECRET_ASSIGNMENT", regex: /(?<=\b(?:secret|token|api[_-]?key)\s*[:=]\s*["']?)(?!\[MASKED_)[^\s"',;]+/gi },
    // DOTENV_LINE: move the start-of-line anchor inside the lookbehind (`^`
    // combined with a lookbehind would be contradictory). Guard with
    // `(?!\[MASKED_)` so an already-masked value is not masked again.
    { name: "DOTENV_LINE", regex: /(?<=^[A-Z_][A-Z0-9_]{2,}=)(?!\[MASKED_)\S+/gm },
];
/** Pure masking function — applied unconditionally without consulting settings. */
function applyMaskPatterns(text) {
    if (!text)
        return text;
    let out = text;
    for (const { name, regex } of exports.MASK_PATTERNS) {
        out = out.replace(regex, `[MASKED_${name}]`);
    }
    return out;
}
// =============================================================================
// Text utilities
// =============================================================================
/** Strip ANSI escape sequences. */
// eslint-disable-next-line no-control-regex
exports.ANSI_REGEX = /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07]*\x07/g;
function stripAnsi(s) {
    return s.replace(exports.ANSI_REGEX, "");
}
/** Line-start indicator that marks user input in an interactive REPL. */
exports.REPL_USER_INDICATORS = /^(?:>|❯|\?|Human:|User:|You:)\s+/;
/** Assistant response marker in Claude Code's REPL (`⏺ ...`). */
exports.REPL_ASSISTANT_MARKERS = /^[⏺●▶►]\s+/;
/** Box-drawing characters (UI decorations) for removal. */
exports.BOX_DRAWING_REGEX = /[─-╿▀-▟]/g;
/**
 * Classify a single ANSI-containing line that arrived from a REPL stream.
 *  - `❯ ...` → user
 *  - `⏺ ...` → assistant response (marker stripped)
 *  - Lines that contain only box-drawing or are very short → ui
 *  - Other plain text is a continuation candidate of an assistant response →
 *    classified as ui; the caller decides whether to accumulate it.
 */
function classifyReplLine(rawLine) {
    const stripped = stripAnsi(rawLine).replace(exports.BOX_DRAWING_REGEX, " ").trim();
    if (!stripped)
        return { kind: "blank" };
    if (exports.REPL_USER_INDICATORS.test(stripped)) {
        const content = stripped.replace(exports.REPL_USER_INDICATORS, "").trim();
        return { kind: "user", content };
    }
    if (exports.REPL_ASSISTANT_MARKERS.test(stripped)) {
        const content = stripped.replace(exports.REPL_ASSISTANT_MARKERS, "").trim();
        return { kind: "assistant", content };
    }
    return { kind: "ui", content: stripped };
}
function randomSessionId() {
    return (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
}
function clampScore(n) {
    const v = typeof n === "number" && isFinite(n) ? Math.round(n) : 0;
    return Math.max(0, Math.min(100, v));
}
function escapeHtml(s) {
    return (s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
// =============================================================================
// Safe JSON response extraction
// =============================================================================
/**
 * Safely extract a JSON object from CLI output.
 *  - Strips markdown code fences
 *  - Parses the substring from the first `{` to the matching last `}`
 */
function extractJsonObject(text) {
    if (!text)
        return null;
    const stripped = text
        .replace(/```json/gi, "```")
        .replace(/```/g, "")
        .trim();
    // First attempt: parse as-is
    try {
        const obj = JSON.parse(stripped);
        if (obj && typeof obj === "object")
            return obj;
    }
    catch {
        /* fallthrough */
    }
    // Second attempt: slice from first `{` to last `}`
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) {
        const slice = stripped.slice(first, last + 1);
        try {
            const obj = JSON.parse(slice);
            if (obj && typeof obj === "object")
                return obj;
        }
        catch {
            /* ignore */
        }
    }
    return null;
}
// =============================================================================
// Social share text builder (vibe coder badge)
// =============================================================================
/**
 * Caption template for sharing on X (Twitter) / LinkedIn.
 *  "Just got my AI coding vibe diagnosed with AM I GOOD AT VIBE! My rank is '[nickname]', overall score [score] lol — y'all should try it -> [marketplace]"
 */
function buildShareText(nickname, score) {
    const safeNick = (nickname ?? "vibe coder seedling").trim() || "vibe coder seedling";
    const safeScore = clampScore(score);
    return (`Just got my AI coding vibe diagnosed with AM I GOOD AT VIBE! ` +
        `My rank is '${safeNick}', overall score ${safeScore} lol ` +
        `y'all should try it -> ${exports.MARKETPLACE_URL}`);
}
function buildTwitterShareUrl(nickname, score) {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText(nickname, score))}`;
}
function buildLinkedInShareUrl() {
    return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(exports.MARKETPLACE_URL)}`;
}
/** Format a millisecond delta as `+12s` / `+1m23s` / `+1h05m`. */
function formatRelTime(deltaMs) {
    const totalSec = Math.max(0, Math.floor(deltaMs / 1000));
    if (totalSec < 60)
        return `+${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m < 60)
        return s === 0 ? `+${m}m` : `+${m}m${String(s).padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `+${h}h${String(rem).padStart(2, "0")}m`;
}
function truncate(s, max) {
    if (!s)
        return s;
    if (s.length <= max)
        return s;
    return s.slice(0, max) + `…(+${s.length - max}c)`;
}
/**
 * Compress a raw history JSON string into an analysis-ready compact JSON.
 * Caller passes the result through `buildAnalysisPrompt` instead of the raw log.
 *
 * The function is forgiving — malformed entries are dropped silently. The model
 * never sees the timestamps or fields we removed, so the prompt budget stretches
 * further and the signal-to-noise ratio improves.
 */
function compressLogForAnalysis(rawJson, opts = {}) {
    const maxUser = opts.maxUserChatChars ?? 600;
    const maxAssistant = opts.maxAssistantChatChars ?? 300;
    const mergeWindow = opts.mergeCodeChangeWindowMs ?? 60_000;
    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    }
    catch {
        return JSON.stringify(emptyCompressed());
    }
    if (!Array.isArray(parsed))
        return JSON.stringify(emptyCompressed());
    const entries = [];
    for (const e of parsed) {
        if (!e || typeof e !== "object")
            continue;
        const ms = Date.parse(typeof e.ts === "string" ? e.ts : "");
        if (!isFinite(ms))
            continue;
        entries.push({ ...e, _ms: ms });
    }
    if (entries.length === 0)
        return JSON.stringify(emptyCompressed());
    entries.sort((a, b) => a._ms - b._ms);
    const t0 = entries[0]._ms;
    const tLast = entries[entries.length - 1]._ms;
    const aiChats = [];
    const commands = [];
    const ccBuckets = [];
    const lastBucketIdxByFile = new Map();
    for (const e of entries) {
        const rel = formatRelTime(e._ms - t0);
        if (e.type === "ai_chat") {
            const turn = e.turn === "assistant" ? "assistant" : "user";
            const tool = typeof e.tool === "string" ? e.tool : "unknown";
            const raw = typeof e.content === "string" ? e.content.trim() : "";
            if (!raw)
                continue;
            const cap = turn === "assistant" ? maxAssistant : maxUser;
            aiChats.push({ t: rel, turn, tool, content: truncate(raw, cap) });
            continue;
        }
        if (e.type === "terminal_command") {
            const cmd = typeof e.command === "string" ? e.command.trim() : "";
            if (!cmd)
                continue;
            const c = { t: rel, cmd: truncate(cmd, 200) };
            if (typeof e.exitCode === "number" && e.exitCode !== 0)
                c.exit = e.exitCode;
            commands.push(c);
            continue;
        }
        if (e.type === "code_change") {
            const file = typeof e.file === "string" ? e.file : "";
            if (!file)
                continue;
            const added = typeof e.added === "number" ? e.added : 0;
            const removed = typeof e.removed === "number" ? e.removed : 0;
            const snippet = typeof e.snippet === "string" ? e.snippet.trim() : "";
            // Drop noise: tiny pure deletions / cursor-jitter edits.
            if (added === 0 && removed < 5 && !snippet)
                continue;
            const prevIdx = lastBucketIdxByFile.get(file);
            if (prevIdx !== undefined) {
                const prev = ccBuckets[prevIdx];
                if (e._ms - prev.lastMs <= mergeWindow) {
                    prev.edits += 1;
                    prev.added += added;
                    prev.removed += removed;
                    prev.lastMs = e._ms;
                    continue;
                }
            }
            ccBuckets.push({
                file,
                edits: 1,
                added,
                removed,
                firstMs: e._ms,
                lastMs: e._ms,
            });
            lastBucketIdxByFile.set(file, ccBuckets.length - 1);
            continue;
        }
    }
    const codeChanges = ccBuckets.map((b) => {
        const startRel = formatRelTime(b.firstMs - t0);
        const span = b.firstMs === b.lastMs
            ? startRel
            : `${startRel}..${formatRelTime(b.lastMs - t0)}`;
        return {
            file: b.file,
            edits: b.edits,
            added: b.added,
            removed: b.removed,
            span,
        };
    });
    const filesTouched = Array.from(new Set(codeChanges.map((c) => c.file)));
    const compressed = {
        session: {
            span_seconds: Math.round((tLast - t0) / 1000),
            n_raw_events: entries.length,
            n_after_compression: aiChats.length + commands.length + codeChanges.length,
        },
        ai_chats: aiChats,
        terminal_commands: commands,
        code_changes: codeChanges,
        files_touched: filesTouched,
    };
    return JSON.stringify(compressed);
}
function emptyCompressed() {
    return {
        session: { span_seconds: 0, n_raw_events: 0, n_after_compression: 0 },
        ai_chats: [],
        terminal_commands: [],
        code_changes: [],
        files_touched: [],
    };
}
//# sourceMappingURL=util.js.map