/**
 * Shared OutputChannel — users can diagnose via [View → Output → AM I GOOD AT VIBE]
 */

import * as vscode from "vscode";
import { EXTENSION_DISPLAY_NAME, LOG_PREFIX } from "./types";

let logChannel: vscode.OutputChannel | null = null;

export function initLogger(): vscode.OutputChannel {
  logChannel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
  return logChannel;
}

export function getLogChannel(): vscode.OutputChannel | null {
  return logChannel;
}

export function disposeLogger(): void {
  if (logChannel) {
    logChannel.dispose();
    logChannel = null;
  }
}

export function log(...args: unknown[]): void {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  if (logChannel) logChannel.appendLine(`[${new Date().toISOString()}] ${line}`);
  console.log(LOG_PREFIX, ...args);
}
