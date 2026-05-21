/**
 * HabitAnalyzer — Delegates analysis to the local AI CLI.
 *
 * Merges captured log + extra entries (e.g. Claude Code session history),
 * compresses, then runs the user's local CLI via stdin redirection. The
 * temp prompt file is written to <workspace>/.am-i-good-at-vibe/ and deleted
 * after the run.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec, ExecException } from "child_process";

import { buildAnalysisPrompt } from "../prompt";
import { compressLogForAnalysis, extractJsonObject } from "../util";
import { Config } from "../config";
import { log } from "../logger";
import { ReportWebview } from "../webview/reportTemplate";
import type { HistoryStore } from "../store/logStore";
import {
  LogEntry,
  AnalysisResult,
  STORAGE_DIR_NAME,
  EXTENSION_DISPLAY_NAME,
} from "../types";

export class HabitAnalyzer {
  constructor(
    private readonly store: HistoryStore,
    private readonly workspaceRoot: string
  ) {}

  /**
   * Run analysis. `extraEntries` lets the caller mix in log entries that
   * aren't on disk (e.g. Claude Code session history read directly from
   * `~/.claude/projects/`) so the analyzer sees the union of captured CLI
   * activity and external GUI/IDE chat — without bloating raw_history.json.
   * Entries are merged and sorted by timestamp ascending before compression.
   */
  async run(
    ctx: vscode.ExtensionContext,
    extraEntries: LogEntry[] = []
  ): Promise<void> {
    const cliTool = Config.localCliTool().trim();
    if (!cliTool) {
      vscode.window.showErrorMessage(
        `${EXTENSION_DISPLAY_NAME}: the \`amigoodatvibe.localCliTool\` setting is empty.`
      );
      return;
    }

    const rawJson = await this.store.readAll();
    let storeEntries: LogEntry[] = [];
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) storeEntries = parsed as LogEntry[];
    } catch {
      storeEntries = [];
    }
    const merged: LogEntry[] = [...storeEntries, ...extraEntries].sort(
      (a, b) => Date.parse(a.ts) - Date.parse(b.ts)
    );
    if (merged.length === 0) {
      vscode.window.showWarningMessage(
        `${EXTENSION_DISPLAY_NAME}: not enough log data to analyze. Do some work and try again.`
      );
      return;
    }
    const mergedJson = JSON.stringify(merged);
    log(
      `[analyze] merged ${storeEntries.length} store entry(ies) + ` +
        `${extraEntries.length} extra entry(ies) = ${merged.length} total`
    );

    const compressedJson = compressLogForAnalysis(mergedJson);
    log(
      `[analyze] compressed log: ${mergedJson.length} → ${compressedJson.length} bytes ` +
        `(${((compressedJson.length / Math.max(1, mergedJson.length)) * 100).toFixed(1)}%)`
    );
    const finalPrompt = buildAnalysisPrompt(compressedJson, {
      outputLanguage: Config.outputLanguage(),
    });

    // Temp file path
    const tempDir = path.join(this.workspaceRoot, STORAGE_DIR_NAME);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFile = path.join(tempDir, `temp_prompt_${Date.now()}.txt`);

    try {
      fs.writeFileSync(tempFile, finalPrompt, "utf8");

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `🧠 ${EXTENSION_DISPLAY_NAME}: analyzing with the ${cliTool} CLI...`,
          cancellable: false,
        },
        async () => this.executeCli(cliTool, tempFile)
      );

      const parsedResult = extractJsonObject<AnalysisResult>(result);
      if (!parsedResult) {
        vscode.window.showErrorMessage(
          `${EXTENSION_DISPLAY_NAME}: could not find a JSON object in the AI CLI response. Please check the output format.`
        );
        // For debugging
        const channel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
        channel.appendLine("=== Raw CLI Output ===");
        channel.appendLine(result);
        channel.show(true);
        return;
      }

      ReportWebview.show(ctx, parsedResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`${EXTENSION_DISPLAY_NAME} analysis failed: ${message}`);
    } finally {
      // Safely delete the temp file in finally
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Uses stdin redirection in the form `<cliTool> < tempFile`.
   * This sidesteps argv length limits and lets the user's CLI aliases / PATH
   * from the shell environment apply as-is.
   */
  private executeCli(cliTool: string, tempFile: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const isWin = process.platform === "win32";
      const cmd = `${cliTool} < "${tempFile}"`;

      const child = exec(
        cmd,
        {
          cwd: this.workspaceRoot,
          maxBuffer: 50 * 1024 * 1024,
          timeout: Config.cliTimeoutMs(),
          env: process.env,
          shell: isWin ? undefined : process.env.SHELL || "/bin/sh",
        },
        (error: ExecException | null, stdout: string, stderr: string) => {
          if (error) {
            // On spawn failure the `code` can be a string like 'ENOENT', but
            // ExecException only declares `number`, so narrow it via ErrnoException.
            const errnoCode = (error as NodeJS.ErrnoException).code;
            if (errnoCode === "ENOENT") {
              reject(
                new Error(
                  `Local CLI "${cliTool}" not found. Check your PATH or the setting value.`
                )
              );
              return;
            }
            const detail = stderr?.trim() || error.message;
            reject(new Error(detail));
            return;
          }
          resolve(stdout);
        }
      );
      child.on("error", (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
