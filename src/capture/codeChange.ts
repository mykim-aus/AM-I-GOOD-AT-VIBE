/**
 * CodeChangeCapture — Debounced persistence of file edits.
 *
 * Collects added/removed-line counts per file in a rolling 2-second window,
 * then writes a single `code_change` LogEntry per file per window. Self-loop
 * paths (the storage dir, build outputs, node_modules) are ignored.
 */

import * as vscode from "vscode";

import { Config } from "../config";
import type { HistoryStore, SecretMasker } from "../store/logStore";
import { STORAGE_DIR_NAME } from "../types";

export class CodeChangeCapture {
  private timer: NodeJS.Timeout | null = null;
  private buckets: Map<string, { added: number; removed: number; lastSnippet: string }> = new Map();

  constructor(
    private readonly store: HistoryStore,
    private readonly masker: SecretMasker
  ) {}

  start(): vscode.Disposable[] {
    if (!Config.captureCodeChanges()) return [];

    const selfLoopFragments = [
      `/${STORAGE_DIR_NAME}/`, `\\${STORAGE_DIR_NAME}\\`,
      "/out/", "\\out\\",
      "/out-test/", "\\out-test\\",
      "/node_modules/", "\\node_modules\\",
    ];

    return [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme !== "file") return;
        const fsPath = e.document.uri.fsPath;
        // Self-loop / noise exclusion (simple substring check; no path.sep dependency)
        if (selfLoopFragments.some((frag) => fsPath.includes(frag))) {
          return;
        }
        // contentChanges.length === 0 indicates an external disk-change reload, etc. — ignore.
        if (!e.contentChanges || e.contentChanges.length === 0) return;
        const file = vscode.workspace.asRelativePath(e.document.uri, false);
        const bucket = this.buckets.get(file) ?? { added: 0, removed: 0, lastSnippet: "" };
        for (const change of e.contentChanges) {
          const addedLines = change.text ? change.text.split(/\r?\n/).length - 1 : 0;
          const removedLines =
            change.range.end.line - change.range.start.line;
          bucket.added += Math.max(addedLines, 0);
          bucket.removed += Math.max(removedLines, 0);
          if (change.text) {
            bucket.lastSnippet = change.text.slice(0, 200);
          }
        }
        this.buckets.set(file, bucket);
        this.scheduleFlush();
      }),
    ];
  }

  private scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushBuckets();
    }, 2000);
  }

  private flushBuckets() {
    for (const [file, b] of this.buckets.entries()) {
      if (b.added === 0 && b.removed === 0) continue;
      this.store.append({
        ts: new Date().toISOString(),
        type: "code_change",
        file,
        added: b.added,
        removed: b.removed,
        snippet: this.masker.mask(b.lastSnippet),
      });
    }
    this.buckets.clear();
  }
}
