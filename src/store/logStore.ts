/**
 * SecretMasker (in-memory) + HistoryStore (append-only JSON with debounced
 * flush + rotation). All writes to `<workspace>/.am-i-good-at-vibe/raw_history.json`
 * pass through the masker first — secrets never reach disk in plaintext.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

import { applyMaskPatterns } from "../util";
import { Config } from "../config";
import { log } from "../logger";
import { LogEntry, STORAGE_DIR_NAME, RAW_HISTORY_FILE } from "../types";

export class SecretMasker {
  mask(text: string): string {
    if (!Config.maskingEnabled() || !text) return text;
    return applyMaskPatterns(text);
  }
}

export class HistoryStore {
  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly logDir: string;
  private readonly logFile: string;

  /** Fires whenever a new entry is appended. The sidebar webview subscribes to it for auto-refresh. */
  private readonly _onDidAppend = new vscode.EventEmitter<LogEntry>();
  readonly onDidAppend = this._onDidAppend.event;

  constructor(private readonly workspaceRoot: string) {
    this.logDir = path.join(workspaceRoot, STORAGE_DIR_NAME);
    this.logFile = path.join(this.logDir, RAW_HISTORY_FILE);
    this.ensureDir();
  }

  private ensureDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      // Auto-add .gitignore so missed masking never leaks to git
      const gitignore = path.join(this.logDir, ".gitignore");
      if (!fs.existsSync(gitignore)) {
        fs.writeFileSync(gitignore, "*\n", "utf8");
      }
    } catch (err) {
      console.error("[AM-I-GOOD-AT-VIBE] ensureDir failed:", err);
    }
  }

  filePath(): string {
    return this.logFile;
  }

  append(entry: LogEntry): void {
    this.queue.push(entry);
    this.scheduleFlush();
    this._onDidAppend.fire(entry);
  }

  /** Return the last N entries combined from memory + disk (used by sidebar recent activity). */
  recent(limit = 20): LogEntry[] {
    let disk: LogEntry[] = [];
    try {
      if (fs.existsSync(this.logFile)) {
        const raw = fs.readFileSync(this.logFile, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) disk = parsed as LogEntry[];
        }
      }
    } catch {
      /* ignore */
    }
    return [...disk, ...this.queue].slice(-limit).reverse();
  }

  /** Count statistics (full — disk + queue). */
  stats(): { aiChats: number; commands: number; codeChanges: number; total: number } {
    let disk: LogEntry[] = [];
    try {
      if (fs.existsSync(this.logFile)) {
        const raw = fs.readFileSync(this.logFile, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) disk = parsed as LogEntry[];
        }
      }
    } catch {
      /* ignore */
    }
    const all = [...disk, ...this.queue];
    let aiChats = 0, commands = 0, codeChanges = 0;
    for (const e of all) {
      if (e.type === "ai_chat") aiChats++;
      else if (e.type === "terminal_command") commands++;
      else if (e.type === "code_change") codeChanges++;
    }
    return { aiChats, commands, codeChanges, total: all.length };
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 1000);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      this.ensureDir();
      let existing: LogEntry[] = [];
      if (fs.existsSync(this.logFile)) {
        try {
          const raw = fs.readFileSync(this.logFile, "utf8");
          existing = raw.trim() ? (JSON.parse(raw) as LogEntry[]) : [];
          if (!Array.isArray(existing)) existing = [];
        } catch {
          // On corruption, back up and start with an empty array
          const backup = this.logFile + `.corrupt-${Date.now()}.bak`;
          try { fs.renameSync(this.logFile, backup); } catch { /* ignore */ }
          existing = [];
        }
      }
      existing.push(...batch);

      const serialized = JSON.stringify(existing, null, 2);
      fs.writeFileSync(this.logFile, serialized, "utf8");

      // Rotate
      const limit = Config.logRotateBytes();
      if (Buffer.byteLength(serialized, "utf8") > limit) {
        this.rotate();
      }
    } catch (err) {
      console.error("[AM-I-GOOD-AT-VIBE] flush failed:", err);
      // Put the batch back at the front of the queue so nothing is lost
      this.queue.unshift(...batch);
    }
  }

  private rotate() {
    try {
      // Keep at most 5 backups
      for (let i = 4; i >= 1; i--) {
        const src = path.join(this.logDir, `raw_history.${i}.json`);
        const dst = path.join(this.logDir, `raw_history.${i + 1}.json`);
        if (fs.existsSync(src)) fs.renameSync(src, dst);
      }
      const dst1 = path.join(this.logDir, `raw_history.1.json`);
      fs.renameSync(this.logFile, dst1);
    } catch (err) {
      console.error("[AM-I-GOOD-AT-VIBE] rotate failed:", err);
    }
  }

  async readAll(): Promise<string> {
    await this.flush();
    if (!fs.existsSync(this.logFile)) return "[]";
    return fs.readFileSync(this.logFile, "utf8");
  }

  async clear(): Promise<void> {
    this.queue = [];
    try {
      if (fs.existsSync(this.logFile)) fs.unlinkSync(this.logFile);
    } catch (err) {
      console.error("[AM-I-GOOD-AT-VIBE] clear failed:", err);
    }
  }

  dispose() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Synchronous flush
    if (this.queue.length > 0) {
      try {
        let existing: LogEntry[] = [];
        if (fs.existsSync(this.logFile)) {
          const raw = fs.readFileSync(this.logFile, "utf8");
          existing = raw.trim() ? (JSON.parse(raw) as LogEntry[]) : [];
          if (!Array.isArray(existing)) existing = [];
        }
        existing.push(...this.queue);
        fs.writeFileSync(this.logFile, JSON.stringify(existing, null, 2), "utf8");
        this.queue = [];
      } catch (err) {
        console.error("[AM-I-GOOD-AT-VIBE] sync flush on dispose failed:", err);
      }
    }
    // Avoid unused warning for the captured workspaceRoot
    void this.workspaceRoot;
  }
}
