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

- **Verify on Windows / Linux** — install via `.vsix`, run, file an issue describing what worked and what didn't.
- **Verify non-Claude CLIs** — Codex, Gemini, aider, `q chat`, `gh copilot`, Cody, `cursor-agent`. Patterns live in [`AI_CLI_PATTERNS` in src/util.ts](src/util.ts); confirm they actually match real-world invocations.
- **Add a new AI CLI** — usually a one-line addition (see below).
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
