/**
 * OwnChatCapture — AM I GOOD AT VIBE's own GUI entry point.
 *
 * Registers an `@amigoodatvibe` chat participant so users can record GUI-side
 * prompts. Optionally subscribes to the proposed `onDidPerformUserAction` API
 * to summarise chat actions from other participants when available.
 */

import * as vscode from "vscode";

import { randomSessionId } from "../util";
import { Config } from "../config";
import type { HistoryStore, SecretMasker } from "../store/logStore";

export class OwnChatCapture {
  private sessionId = randomSessionId();

  constructor(
    private readonly store: HistoryStore,
    private readonly masker: SecretMasker
  ) {}

  start(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // -----------------------------------------------------------------------
    // (A) @amigoodatvibe chat participant — VS Code Chat API (stable)
    // -----------------------------------------------------------------------
    try {
      const handler: vscode.ChatRequestHandler = async (request, _context, response) => {
        const userPrompt = request.prompt ?? "";
        if (userPrompt.trim()) {
          this.store.append({
            ts: new Date().toISOString(),
            type: "ai_chat",
            turn: "user",
            source: "gui",
            tool: "amigoodatvibe-chat",
            sessionId: this.sessionId,
            content: this.masker.mask(userPrompt),
          });
        }
        const reply =
          `✅ Your prompt has been recorded in AM I GOOD AT VIBE.\n\n` +
          `Click **"Analyze My AI Usage Habits"** in the sidebar to analyze your accumulated log, ` +
          `or pass it directly to the \`${Config.localCliTool()}\` CLI to get an answer.`;
        response.markdown(reply);

        // Also record the (meta) assistant response
        this.store.append({
          ts: new Date().toISOString(),
          type: "ai_chat",
          turn: "assistant",
          source: "gui",
          tool: "amigoodatvibe-chat",
          sessionId: this.sessionId,
          content: this.masker.mask(reply),
        });

        return {};
      };

      const participant = vscode.chat.createChatParticipant("amigoodatvibe.chat", handler);
      participant.iconPath = new vscode.ThemeIcon("pulse");
      disposables.push(participant);
    } catch (err) {
      console.warn("[AM-I-GOOD-AT-VIBE] failed to register chat participant:", err);
    }

    // -----------------------------------------------------------------------
    // (B) Proposed API try/catch — onDidPerformUserAction
    //     When enabled, this also captures user actions on other chat
    //     participants.
    // -----------------------------------------------------------------------
    try {
      const proposed = (vscode.chat as unknown as {
        onDidPerformUserAction?: vscode.Event<{ action?: { kind?: string }; result?: unknown }>;
      }).onDidPerformUserAction;

      if (typeof proposed === "function") {
        disposables.push(
          proposed((e) => {
            try {
              const summary = JSON.stringify({
                kind: e.action?.kind ?? "unknown",
                result: e.result,
              });
              this.store.append({
                ts: new Date().toISOString(),
                type: "ai_chat",
                turn: "assistant",
                source: "gui",
                tool: "vscode-chat-proposed",
                sessionId: this.sessionId,
                content: this.masker.mask(summary),
              });
            } catch {
              /* swallow */
            }
          })
        );
      }
    } catch (err) {
      // proposed API inactive — ignore
      console.debug("[AM-I-GOOD-AT-VIBE] proposed onDidPerformUserAction skipped:", err);
    }

    return disposables;
  }
}
