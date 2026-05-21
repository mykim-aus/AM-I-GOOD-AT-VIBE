/**
 * Configuration helper — reads VS Code workspace settings under the
 * `amigoodatvibe.*` namespace.
 */

import * as vscode from "vscode";
import { CONFIG_SECTION } from "./types";
import type { OutputLanguage } from "./prompt";

export class Config {
  private static section() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }
  static localCliTool(): string {
    return this.section().get<string>("localCliTool", "claude");
  }
  static outputLanguage(): OutputLanguage {
    const v = this.section().get<string>("outputLanguage", "auto");
    const valid: OutputLanguage[] = ["auto", "english", "korean"];
    return (valid as string[]).includes(v) ? (v as OutputLanguage) : "auto";
  }
  static async setOutputLanguage(lang: OutputLanguage): Promise<void> {
    await this.section().update(
      "outputLanguage",
      lang,
      vscode.ConfigurationTarget.Global
    );
  }
  static autoCapture(): boolean {
    return this.section().get<boolean>("autoCapture", true);
  }
  static maskingEnabled(): boolean {
    return this.section().get<boolean>("maskingEnabled", true);
  }
  static cliTimeoutMs(): number {
    return this.section().get<number>("cliTimeoutMs", 120000);
  }
  static captureCodeChanges(): boolean {
    return this.section().get<boolean>("captureCodeChanges", true);
  }
  static logRotateBytes(): number {
    return this.section().get<number>("logRotateBytes", 1_048_576);
  }
}
