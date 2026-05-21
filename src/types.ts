/**
 * Shared type definitions for AM I GOOD AT VIBE.
 */

export type LogEntry =
  | {
      ts: string;
      type: "ai_chat";
      turn: "user" | "assistant";
      source: "cui" | "gui";
      tool: string;
      sessionId: string;
      content: string;
    }
  | {
      ts: string;
      type: "terminal_command";
      command: string;
      cwd: string;
      exitCode?: number;
    }
  | {
      ts: string;
      type: "code_change";
      file: string;
      added: number;
      removed: number;
      snippet: string;
    };

export interface AnalysisResult {
  /** Vibe coder nickname — the heart of the social-share badge. */
  nickname?: string;
  /** Spicy one-liner roast — surfaced verbatim in the social share template. */
  one_line_pack?: string;
  overall_score: number;
  summary: string;
  competency_scores: Record<string, number>;
  strengths: Array<{ title: string; evidence: string }>;
  improvements: Array<{ title: string; evidence: string; actionable?: string }>;
  /** Concrete actions to try in the next 5 minutes (command / checklist level). */
  action_items?: string[];
  recommended_next_actions: string[];
}

/** Stable-API type helper — defined in VS Code 1.93+ environments. */
export interface TerminalShellExecutionStartEvent {
  terminal: import("vscode").Terminal;
  execution: {
    commandLine?: { value: string };
    cwd?: { toString(): string };
    read?: () => AsyncIterable<string>;
  };
}

import type { ExtractedTurn } from "./extensionCache";

/** Convert an ExtractedTurn (extensionCache output) to the unified LogEntry
 *  shape so it can be merged with capture-side entries. Used both by the
 *  sidebar activity feed and the analyzer when it pulls in Claude Code
 *  history. */
export function extractedTurnToLogEntry(t: ExtractedTurn): LogEntry {
  return {
    ts: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(),
    type: "ai_chat",
    turn: t.turn,
    source: "gui",
    tool: t.tool,
    sessionId: t.sessionId ?? "claude-code-cache",
    content: t.content,
  };
}

/** Project-wide constants. Single source of truth for the extension's identity. */
export const STORAGE_DIR_NAME = ".am-i-good-at-vibe";
export const RAW_HISTORY_FILE = "raw_history.json";
export const CONFIG_SECTION = "amigoodatvibe";
export const EXTENSION_DISPLAY_NAME = "AM I GOOD AT VIBE";
export const LOG_PREFIX = "[AM-I-GOOD-AT-VIBE]";
export const VERSION = "0.1.0";
