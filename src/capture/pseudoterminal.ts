/**
 * AmIGoodAtVibePseudoterminal — opt-in 100% capture terminal.
 *
 * Appears when the user selects "AM I GOOD AT VIBE Capture" from the
 * "+ New Terminal" dropdown. Uses `child_process.spawn` to launch the user's
 * default shell, intercepts stdin/stdout wholesale, and writes 100% of it to
 * file. No need for Shell Integration or the proposed API.
 *
 * Limitation: it's a fake PTY (pipe stdio), so raw TUI apps (the claude REPL,
 * vim, etc.) won't work. Suited for regular commands plus single-shot AI CLI
 * invocations like `claude "..."` / `claude -p "..."`.
 */

import * as vscode from "vscode";

import { matchAiCli, randomSessionId, classifyReplLine } from "../util";
import { log } from "../logger";
import type { HistoryStore, SecretMasker } from "../store/logStore";

export class AmIGoodAtVibePseudoterminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  private child: import("child_process").ChildProcessWithoutNullStreams | null = null;
  private inputBuffer = "";
  private sessionId = randomSessionId();

  constructor(
    private readonly store: HistoryStore,
    private readonly masker: SecretMasker,
    private readonly workspaceRoot: string
  ) {}

  open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
    const shell = process.env.SHELL || "/bin/bash";
    const banner =
      "\x1B[1;36m🔒 AM I GOOD AT VIBE Capture Terminal\x1B[0m\r\n" +
      "\x1B[2mAll input and output in this terminal is captured 100% into .am-i-good-at-vibe/raw_history.json.\x1B[0m\r\n" +
      `\x1B[2mShell: ${shell}\x1B[0m\r\n\r\n`;
    this.writeEmitter.fire(banner);

    try {
      // Dynamic require call — avoids a top-level import so dispose stays safe
      const cp = require("child_process") as typeof import("child_process");
      this.child = cp.spawn(shell, ["-i"], {
        cwd: this.workspaceRoot,
        env: { ...process.env, TERM: "dumb", AMIGOODATVIBE_CAPTURE: "1" },
      });

      this.child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString("utf8");
        this.writeEmitter.fire(text);
        // Persist probable assistant lines (per line)
        this.capture(text, "assistant");
      });
      this.child.stderr.on("data", (buf: Buffer) => {
        this.writeEmitter.fire(buf.toString("utf8"));
      });
      this.child.on("exit", (code) => {
        this.writeEmitter.fire(`\r\n\x1B[2m[process exit code ${code ?? "?"}]\x1B[0m\r\n`);
        this.closeEmitter.fire();
      });
      this.child.on("error", (err) => {
        log("❌ pseudoterminal spawn error:", err.message);
        this.writeEmitter.fire(`\r\n\x1B[1;31m[error] ${err.message}\x1B[0m\r\n`);
        this.closeEmitter.fire();
      });
    } catch (err) {
      log("❌ pseudoterminal open failed:", String(err));
      this.writeEmitter.fire(`\r\n\x1B[1;31m[shell launch failed] ${String(err)}\x1B[0m\r\n`);
      this.closeEmitter.fire();
    }
  }

  /** User key input — persist line-by-line, then forward to the child shell. */
  handleInput(data: string): void {
    // Echo to screen
    this.writeEmitter.fire(data);
    this.inputBuffer += data;

    // A line is complete once Enter (\r) arrives
    if (data.includes("\r") || data.includes("\n")) {
      const lines = this.inputBuffer.split(/\r\n|\r|\n/);
      this.inputBuffer = lines.pop() ?? "";
      for (const raw of lines) {
        const cmd = raw.replace(/\x7F/g, "").trim(); // strip backspace
        if (!cmd) continue;
        const matched = matchAiCli(cmd);
        if (matched) {
          this.store.append({
            ts: new Date().toISOString(),
            type: "ai_chat",
            turn: "user",
            source: "cui",
            tool: matched.tool,
            sessionId: this.sessionId,
            content: this.masker.mask(matched.prompt),
          });
          log("⏺ [AM I GOOD AT VIBE Term] AI CLI matched:", matched.tool);
        } else {
          this.store.append({
            ts: new Date().toISOString(),
            type: "terminal_command",
            command: this.masker.mask(cmd),
            cwd: this.workspaceRoot,
          });
          log("⏺ [AM I GOOD AT VIBE Term] command:", cmd.slice(0, 80));
        }
      }
      // Forward the input to the child shell (Enter included)
      if (this.child?.stdin.writable) {
        this.child.stdin.write(this.inputBuffer + data);
      }
    } else {
      if (this.child?.stdin.writable) {
        this.child.stdin.write(data);
      }
    }
  }

  /** Classify text from stdout etc. as an assistant candidate line-by-line, then persist. */
  private capture(text: string, _hint: "user" | "assistant"): void {
    for (const raw of text.split(/\r?\n/)) {
      const c = classifyReplLine(raw);
      if (c.kind === "assistant" && c.content) {
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "assistant",
          source: "cui",
          tool: "amigoodatvibe-term",
          sessionId: this.sessionId,
          content: this.masker.mask(c.content),
        });
      }
    }
  }

  close(): void {
    try {
      this.child?.stdin.end();
      this.child?.kill();
    } catch {
      /* ignore */
    }
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
