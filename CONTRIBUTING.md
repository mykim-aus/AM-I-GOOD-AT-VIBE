# Contributing to AM I GOOD AT VIBE

Thanks for considering a contribution. AM I GOOD AT VIBE stays **local-first** — every change must preserve the invariant that user source code and prompts never leave the machine.

This is a v0.1 release tested on one environment (macOS + Claude Code). Cross-platform verification reports, bug fixes, and new-CLI patterns are the most valuable contributions you can make right now.

## Quick dev loop

```bash
npm install
npm run compile          # or: npm run watch
# Open this folder in VS Code → F5 to launch an Extension Development Host
npm test                 # 100 unit tests for pure helpers + prompt builder + extension cache reader
```

## Source layout

```
src/
├── extension.ts          activation + command wiring (kept thin)
├── types.ts              shared types + project constants (storage dir, display name, version)
├── logger.ts             OutputChannel + log() helper
├── config.ts             reads workspace settings under `amigoodatvibe.*`
├── util.ts               vscode-free helpers (regex matchers, masking, compression)
├── prompt.ts             system instruction + buildAnalysisPrompt
├── extensionCache.ts     reads Claude Code / Copilot / Cursor chat caches from disk
├── store/
│   └── logStore.ts       SecretMasker + HistoryStore (append + flush + rotate)
├── capture/
│   ├── terminal.ts       shell-integration + onDidWriteTerminalData capture
│   ├── pseudoterminal.ts opt-in 100% capture terminal profile
│   └── codeChange.ts     debounced onDidChangeTextDocument capture
├── chat/
│   └── ownChatParticipant.ts  @amigoodatvibe chat participant
├── analyzer/
│   └── runAnalysis.ts    HabitAnalyzer — runs the local CLI and parses JSON
└── webview/
    ├── sidebar.ts        sidebar UI provider (CTA + stats + activity feed)
    └── reportTemplate.ts post-analysis report webview (HTML + theme CSS)
```

## What needs help (v0.1)

- **Verify on Windows / Linux** — install from the Marketplace (or build the `.vsix` locally), run, file an issue describing what worked and what didn't.
- **Verify non-Claude CLIs** — Codex, Gemini, aider, `q chat`, `gh copilot`, Cody, `cursor-agent`. Patterns live in [`AI_CLI_PATTERNS` in src/util.ts](src/util.ts); confirm they actually match real-world invocations.
- **Add a new AI CLI** — usually a one-line addition (see below).
- **Tune the evaluation criteria** — the 6 competency scores (`prompt_quality`, `context_setting`, `iteration_efficiency`, `security_awareness`, `code_review_habit`, `tool_diversity`) are defined in [src/prompt.ts](src/prompt.ts). Propose new axes, sharper rubrics, or different weighting (see below).
- **Improve the analysis system prompt** — the prompt that produces the nickname, roast, and scores also lives in [src/prompt.ts](src/prompt.ts). Sharper roasts, more reliable JSON output, better language detection, and tighter token usage are all great PR material (see below).
- **Code review** — this is the first public release. Spot something embarrassing? Open an issue or PR.

## Adding a new AI CLI (the most common contribution)

Want AM I GOOD AT VIBE to capture a new terminal AI tool? It's usually a **one-line addition** to [src/util.ts](src/util.ts).

1. Open [src/util.ts](src/util.ts) and find the `AI_CLI_PATTERNS` array.
2. Add a regex that matches the command pattern of the new CLI. Examples already in the file:
   ```ts
   /^\s*claude(\s|$)/,
   /^\s*codex\s+(chat|exec)\b/,
   /^\s*gemini(\s|$)/,
   ```
3. If the CLI has a REPL with distinctive user/assistant turn markers (like Claude Code's `❯` / `⏺`), add detection logic in the REPL parser in [src/capture/terminal.ts](src/capture/terminal.ts). For non-REPL one-shot CLIs, the regex alone is enough.
4. Add a test case in [src/test/](src/test/) covering at least one positive and one negative match.
5. Update the **Supported AI CLIs** table in [README.md](README.md), and mark the verification column once you've tested end-to-end.

That's it — no new dependencies, no telemetry hooks, no remote calls.

## Tuning the evaluation rubric

The whole vibe analysis is a single local CLI call against the system
prompt in [src/prompt.ts](src/prompt.ts). The 6 competency scores
(`prompt_quality`, `context_setting`, `iteration_efficiency`,
`security_awareness`, `code_review_habit`, `tool_diversity`) are defined
inline in the JSON schema the model is asked to produce. Improving them
is one of the highest-leverage contributions right now.

What's open to change:

- **Add or remove an axis.** If you can argue why "test_discipline" or
  "spec_writing" reflects AI collaboration quality better than one of the
  existing six, propose the swap. Keep the total at 6 (the report
  webview lays them out as a 2×3 grid).
- **Sharpen the rubric.** Each score's guidance lives next to its key
  in the system prompt. Move the bar — describe what a 30/60/90 looks
  like concretely so the model stops drifting toward "everyone gets 75".
- **Reweight.** `overall_score` is currently a soft average. If you
  think `security_awareness` should be a hard cap (one severe miss → 60
  max), make that case.

After any change run `npm test` — the prompt builder and JSON schema
have unit tests in [src/test/unit.test.ts](src/test/unit.test.ts).

## Improving the system prompt

Same file, different concern: the **voice and reliability** of the
output. Common PR shapes:

- **Sharper roasts / nicknames** — without losing actionability. The
  one-line pack is the most-shared artifact; it should be funny *and*
  identify a real pattern.
- **More reliable JSON output** — if you've seen the
  "could not find a JSON object" error path, that's the model returning
  prose instead of pure JSON. Tighter system-prompt directives, JSON
  schema reinforcement, or a smarter extractor in
  [src/analyzer/runAnalysis.ts](src/analyzer/runAnalysis.ts) all help.
- **Better language detection** — only English and Korean are tuned.
  Korean output in particular is under-polished; native speakers very
  welcome. Anything else falls back to English by design — adding a new
  output language means adding both detection in [src/util.ts](src/util.ts)
  and a translated nickname/roast guidance block in the prompt.
- **Tighter token usage** — the log compression in
  [src/util.ts](src/util.ts) (`compressLogForAnalysis`) drops what the
  model doesn't need. If you can shave more without losing signal,
  that's directly cheaper analysis runs for every user.

PRs touching the prompt should include a sample input/output pair in
the description (redact anything sensitive) so reviewers can sanity-check
the tone shift.

## Pull request guidelines

- **Local-first guarantee**: PRs that add network calls, telemetry, or upload anything (even anonymized) will not be merged. Analysis must continue to delegate to the user's local CLI.
- **Masking**: if you add a new code path that writes to `raw_history.json`, the write must pass through the existing masking layer. Don't bypass it for "performance".
- **Tests**: pure helpers and prompt-builder changes need unit tests. UI/webview changes need a manual repro note in the PR description (screenshot or short clip).
- **Keep it small**: one CLI, one bug fix, or one feature per PR. Bundled PRs get split or held.
- **Commits**: imperative mood, scoped if it helps (`capture: …`, `mask: …`, `ui: …`). Squash optional.

## Reporting issues

Please include:
- VS Code version, OS, and which CLI you were using.
- Whether **Shell Integration** is enabled (`echo $TERM_PROGRAM` + VS Code's terminal indicator).
- A **redacted** snippet of `.am-i-good-at-vibe/raw_history.json` reproducing the issue. Re-mask anything that looks sensitive — the auto-masker is not perfect.
- For capture bugs: did the `🔒 100% Capture Terminal` profile also miss it?

## Scope

This repo is the **open-source capture extension and local vibe report**. Team analytics, hiring-eval rubrics, and aggregate dashboards live in a separate product and are not in scope here. Contributions that try to add team/server features will be redirected.

## Code of conduct

Be kind. Roast the code, not the contributor.
