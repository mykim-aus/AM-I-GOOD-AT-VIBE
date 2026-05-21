/**
 * TerminalCapture — Precise CUI AI CLI capture (★ Phase 1 core module ★)
 *
 * Two layers run side-by-side:
 *   (A) Stable Shell Integration API (VS Code 1.93+) — line-by-line stream of
 *       executed commands with their full stdout.
 *   (B) Proposed `onDidWriteTerminalData` — raw stream for environments
 *       without Shell Integration. Same classifier, applied per chunk.
 */

import * as vscode from "vscode";

import { matchAiCli, randomSessionId, classifyReplLine } from "../util";
import { Config } from "../config";
import { log } from "../logger";
import type { HistoryStore, SecretMasker } from "../store/logStore";
import type { TerminalShellExecutionStartEvent } from "../types";

export class TerminalCapture {
  private sessionId = randomSessionId();
  /** Track terminals that have entered interactive REPL mode and their currently active tool. */
  private replActive: WeakMap<vscode.Terminal, { tool: string }> = new WeakMap();

  constructor(
    private readonly store: HistoryStore,
    private readonly masker: SecretMasker
  ) {}

  start(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // -----------------------------------------------------------------------
    // (A) Stable API — based on Shell Integration (VS Code 1.93+)
    // -----------------------------------------------------------------------
    const startEvent = (vscode.window as unknown as {
      onDidStartTerminalShellExecution?: vscode.Event<TerminalShellExecutionStartEvent>;
    }).onDidStartTerminalShellExecution;

    if (startEvent) {
      log("✅ onDidStartTerminalShellExecution stable API available");
      disposables.push(
        startEvent((e) => {
          log("→ shell execution start:", e.execution?.commandLine?.value ?? "(no cmdline)");
          void this.handleShellExecution(e);
        })
      );
    } else {
      log("⚠️ onDidStartTerminalShellExecution unavailable — VS Code version too old or feature disabled. Falling back to proposed API only.");
    }

    // -----------------------------------------------------------------------
    // (B) Proposed API fallback — onDidWriteTerminalData
    // -----------------------------------------------------------------------
    try {
      const writeEvent = (vscode.window as unknown as {
        onDidWriteTerminalData?: vscode.Event<{ terminal: vscode.Terminal; data: string }>;
      }).onDidWriteTerminalData;

      if (writeEvent) {
        log("✅ proposed onDidWriteTerminalData active — capturing raw data from all terminals");
        disposables.push(
          writeEvent((e) => {
            this.handleWriteData(e.terminal, e.data);
          })
        );
      } else {
        log("ℹ️ proposed onDidWriteTerminalData inactive (normal — production environment)");
      }
    } catch (err) {
      log("ℹ️ proposed onDidWriteTerminalData skipped:", String(err));
    }

    // -----------------------------------------------------------------------
    // (C) Session lifecycle
    // -----------------------------------------------------------------------
    disposables.push(
      vscode.window.onDidOpenTerminal((t) => {
        log("📂 terminal opened:", t.name);
        this.sessionId = randomSessionId();
      })
    );
    disposables.push(
      vscode.window.onDidCloseTerminal((t) => {
        log("📁 terminal closed:", t.name);
        this.replActive.delete(t);
      })
    );

    return disposables;
  }

  /**
   * Command-execution event for terminals with Shell Integration active.
   * The stream is processed line-by-line in real time — entries are persisted
   * on every line, even before the REPL exits.
   */
  private async handleShellExecution(e: TerminalShellExecutionStartEvent): Promise<void> {
    if (!Config.autoCapture()) return;

    const commandLine = e.execution?.commandLine?.value ?? "";
    const cwd = e.execution?.cwd?.toString?.() ?? process.cwd();
    const trimmed = commandLine.trim();
    if (!trimmed) return;

    const matched = matchAiCli(trimmed);
    const isRepl = matched?.prompt === "<INTERACTIVE_REPL_START>";

    if (matched) {
      // Persist the initial user turn (the command itself)
      this.store.append({
        ts: new Date().toISOString(),
        type: "ai_chat",
        turn: "user",
        source: "cui",
        tool: matched.tool,
        sessionId: this.sessionId,
        content: this.masker.mask(matched.prompt),
      });
      log("⏺ AI CLI matched:", matched.tool, "/ prompt:", matched.prompt.slice(0, 80));
    } else {
      this.store.append({
        ts: new Date().toISOString(),
        type: "terminal_command",
        command: this.masker.mask(trimmed),
        cwd,
      });
      log("⏺ terminal_command stored:", trimmed.slice(0, 80));
    }

    // Stream processing — line-buffered real-time handling for both REPL and one-shot
    try {
      const stream = e.execution.read?.();
      if (!stream) {
        log("⚠️ execution.read() is undefined — Shell Integration may be off");
        return;
      }
      const tool = matched?.tool ?? "shell";
      await this.consumeStreamByLine(stream, tool, isRepl, e.terminal);
    } catch (err) {
      log("❌ stream consume failed:", String(err));
    }
  }

  /**
   * Process the stream line-by-line in real time.
   *  - Even inside a REPL, parse and persist on every chunk — no waiting for command end
   *  - `❯ ...` line → user turn
   *  - `⏺ ...` line → start of assistant response (subsequent lines accumulate)
   *  - On a blank line or a new marker, flush the accumulated assistant block
   */
  private async consumeStreamByLine(
    stream: AsyncIterable<string>,
    tool: string,
    isRepl: boolean,
    terminal: vscode.Terminal
  ): Promise<void> {
    if (isRepl && terminal) {
      this.replActive.set(terminal, { tool });
    }

    let lineBuf = "";
    let assistantBuf = "";
    const flushAssistant = () => {
      const text = assistantBuf.trim();
      if (text.length >= 2) {
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "assistant",
          source: "cui",
          tool,
          sessionId: this.sessionId,
          content: this.masker.mask(text),
        });
        log("⏺ assistant stored:", text.slice(0, 80));
      }
      assistantBuf = "";
    };

    for await (const chunk of stream) {
      lineBuf += chunk;
      // Runaway guard
      if (lineBuf.length > 256 * 1024) {
        lineBuf = lineBuf.slice(-32 * 1024);
      }
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop() ?? "";

      for (const raw of lines) {
        const classified = classifyReplLine(raw);
        switch (classified.kind) {
          case "user": {
            if (assistantBuf) flushAssistant();
            if (classified.content) {
              this.store.append({
                ts: new Date().toISOString(),
                type: "ai_chat",
                turn: "user",
                source: "cui",
                tool,
                sessionId: this.sessionId,
                content: this.masker.mask(classified.content),
              });
              log("⏺ user stored:", classified.content.slice(0, 80));
            }
            break;
          }
          case "assistant": {
            if (assistantBuf) flushAssistant();
            assistantBuf = classified.content;
            break;
          }
          case "blank": {
            // Two consecutive blank lines means the response is done
            if (assistantBuf) flushAssistant();
            break;
          }
          case "ui":
          default: {
            // If an assistant response is in progress, treat this as a continuation and accumulate
            if (assistantBuf) {
              assistantBuf += "\n" + classified.content;
            }
            // Otherwise it's a welcome message / progress indicator / etc. — ignore
            break;
          }
        }
      }
    }
    // On stream end (command finished), flush any leftover assistantBuf
    if (assistantBuf) flushAssistant();
    // Treat the trailing incomplete lineBuf as a final line as well
    if (lineBuf.trim()) {
      const tail = classifyReplLine(lineBuf);
      if (tail.kind === "assistant" || tail.kind === "ui") {
        assistantBuf = tail.kind === "assistant" ? tail.content : tail.content;
        flushAssistant();
      } else if (tail.kind === "user" && tail.content) {
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "user",
          source: "cui",
          tool,
          sessionId: this.sessionId,
          content: this.masker.mask(tail.content),
        });
      }
    }
  }

  /**
   * Proposed API — raw terminal data. Only fires in environments without
   * Shell Integration. Apply the same line classifier on every chunk.
   */
  private writeBuf = new WeakMap<vscode.Terminal, string>();
  private handleWriteData(terminal: vscode.Terminal, data: string): void {
    if (!Config.autoCapture()) return;
    const prev = this.writeBuf.get(terminal) ?? "";
    const combined = prev + data;
    const lines = combined.split(/\r?\n/);
    this.writeBuf.set(terminal, lines.pop() ?? "");

    const repl = this.replActive.get(terminal);
    const tool = repl?.tool ?? "shell";

    for (const raw of lines) {
      const c = classifyReplLine(raw);
      if (c.kind === "user" && c.content) {
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "user",
          source: "cui",
          tool,
          sessionId: this.sessionId,
          content: this.masker.mask(c.content),
        });
      } else if (c.kind === "assistant" && c.content) {
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "assistant",
          source: "cui",
          tool,
          sessionId: this.sessionId,
          content: this.masker.mask(c.content),
        });
      }
    }
  }
}
