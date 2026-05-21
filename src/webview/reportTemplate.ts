/**
 * ReportWebview — HTML report driven by VS Code theme variables.
 *
 * Renders the analysis result as a stand-alone webview panel: nickname hero,
 * social share buttons, score bars, strengths/improvements cards, and a star
 * link back to the repo. CSP blocks external scripts; share links are plain
 * anchor hrefs (no JS needed).
 */

import * as vscode from "vscode";

import {
  clampScore,
  escapeHtml,
  buildTwitterShareUrl,
  buildLinkedInShareUrl,
  GITHUB_URL,
} from "../util";
import { Config } from "../config";
import { AnalysisResult, EXTENSION_DISPLAY_NAME } from "../types";

export class ReportWebview {
  static show(_ctx: vscode.ExtensionContext, result: AnalysisResult): void {
    const panel = vscode.window.createWebviewPanel(
      "amigoodatvibeReport",
      `🧠 ${EXTENSION_DISPLAY_NAME} Report`,
      vscode.ViewColumn.Active,
      { enableScripts: false, retainContextWhenHidden: true }
    );
    panel.webview.html = this.render(result);
  }

  private static render(r: AnalysisResult): string {
    const overall = clampScore(r.overall_score);
    const nicknameRaw = (r.nickname ?? "vibe coder seedling").trim() || "vibe coder seedling";
    const oneLineRaw  = (r.one_line_pack ?? "").trim();
    const nickname    = escapeHtml(nicknameRaw);
    const oneLine     = escapeHtml(oneLineRaw);
    const summary     = escapeHtml(r.summary ?? "");

    // ----- Social share links (built in util) -----
    const xHref        = escapeHtml(buildTwitterShareUrl(nicknameRaw, overall));
    const linkedinHref = escapeHtml(buildLinkedInShareUrl());

    // ----- Competency bars (English labels) -----
    const competencyKeys = [
      ["prompt_quality",       "Prompt"],
      ["context_setting",      "Context"],
      ["iteration_efficiency", "Iteration"],
      ["security_awareness",   "Security"],
      ["code_review_habit",    "Review"],
      ["tool_diversity",       "Tools"],
    ] as const;

    const bars = competencyKeys
      .map(([key, label]) => {
        const v = clampScore((r.competency_scores ?? {})[key] ?? 0);
        return `
          <div class="bar-row">
            <div class="bar-label">${escapeHtml(label)}</div>
            <div class="bar-track" role="progressbar"
                 aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100">
              <div class="bar-fill" style="width:${v}%"></div>
            </div>
            <div class="bar-value">${v}</div>
          </div>`;
      })
      .join("\n");

    const strengths = (r.strengths ?? [])
      .map(
        (s) => `
        <div class="card card-strength">
          <div class="card-title">${escapeHtml(s.title)}</div>
          <div class="card-evidence">${escapeHtml(s.evidence ?? "")}</div>
        </div>`
      )
      .join("\n") || `<div class="empty-state">—</div>`;

    const improvements = (r.improvements ?? [])
      .map(
        (i) => `
        <div class="card card-improve">
          <div class="card-title">${escapeHtml(i.title)}</div>
          <div class="card-evidence">${escapeHtml(i.evidence ?? "")}</div>
          ${i.actionable ? `<div class="card-actionable">→ ${escapeHtml(i.actionable)}</div>` : ""}
        </div>`
      )
      .join("\n") || `<div class="empty-state">—</div>`;

    const actionItems = (r.action_items ?? [])
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join("\n");
    const nextActions = (r.recommended_next_actions ?? [])
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join("\n");

    // Overall-score conic-gradient gauge
    const gauge = `
      <div class="gauge"
           style="background: conic-gradient(
             var(--vscode-progressBar-background) 0%,
             var(--vscode-progressBar-background) ${overall}%,
             var(--vscode-editorWidget-border) ${overall}%,
             var(--vscode-editorWidget-border) 100%);">
        <div class="gauge-inner">
          <div class="gauge-score">${overall}</div>
          <div class="gauge-suffix">/ 100</div>
        </div>
      </div>`;

    // CSP: block external scripts. Social share links are anchor hrefs only — no script needed.
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data: https:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${EXTENSION_DISPLAY_NAME} Report</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground);
    --card-bg: var(--vscode-editorWidget-background);
    --card-border: var(--vscode-editorWidget-border);
    --accent: var(--vscode-textLink-foreground);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --progress: var(--vscode-progressBar-background);
    --warn: var(--vscode-editorWarning-foreground);
    --ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
    --info-bg: var(--vscode-editorInfo-background, var(--vscode-editorWidget-background));
    --info-fg: var(--vscode-editorInfo-foreground, var(--vscode-editor-foreground));
    --info-border: var(--vscode-editorInfo-border, var(--vscode-editorWidget-border));
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 32px 48px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
  }

  /* ============ HERO (nickname spotlight) ============ */
  header.hero {
    display: flex; gap: 28px; align-items: center;
    padding: 24px 28px;
    margin-bottom: 18px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    position: relative;
    overflow: hidden;
  }
  .hero-text { flex: 1; min-width: 0; }
  .hero-eyebrow {
    font-size: 0.85em; color: var(--muted);
    letter-spacing: 0.05em; text-transform: uppercase;
    margin: 0 0 6px;
  }
  .nickname {
    font-size: 2.1em; font-weight: 800;
    margin: 0 0 12px;
    color: var(--accent);
    letter-spacing: -0.01em;
    line-height: 1.15;
    word-break: keep-all;
  }
  .one-line-pack {
    display: inline-block;
    padding: 8px 14px;
    margin: 0 0 10px;
    background: var(--bg);
    border: 1px dashed var(--accent);
    border-radius: 8px;
    color: var(--fg);
    font-weight: 600;
    font-size: 1.02em;
  }
  .hero-summary { color: var(--muted); margin: 6px 0 0; }

  /* ============ GAUGE ============ */
  .gauge {
    width: 148px; height: 148px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .gauge-inner {
    width: 112px; height: 112px;
    border-radius: 50%;
    background: var(--bg);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .gauge-score { font-size: 2.2em; font-weight: 800; color: var(--accent); }
  .gauge-suffix { font-size: 0.8em; color: var(--muted); }

  /* ============ SNS SHARE ROW ============ */
  .share-row {
    display: flex; flex-wrap: wrap; gap: 10px;
    margin: 0 0 26px;
    padding: 14px 18px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    align-items: center;
  }
  .share-label {
    margin-right: 8px;
    font-weight: 600;
    color: var(--fg);
  }
  .share-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    background: var(--btn-bg);
    color: var(--btn-fg);
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.95em;
    border: 1px solid transparent;
  }
  .share-btn:hover { background: var(--btn-hover); }
  .share-btn.outline {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--accent);
  }
  .share-hint {
    margin-left: auto;
    font-size: 0.85em;
    color: var(--muted);
  }

  /* ============ SECTIONS ============ */
  section { margin: 28px 0; }
  h2.section-title {
    font-size: 1.1em; font-weight: 600;
    margin: 0 0 14px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--card-border);
  }

  /* Competency bars */
  .bars { display: grid; gap: 10px; }
  .bar-row {
    display: grid;
    grid-template-columns: 160px 1fr 48px;
    gap: 12px;
    align-items: center;
  }
  .bar-label { color: var(--muted); font-weight: 500; }
  .bar-track {
    height: 12px; border-radius: 6px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--progress);
    transition: width .25s ease;
  }
  .bar-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--fg); }

  /* Cards */
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    padding: 14px 16px;
  }
  .card-title { font-weight: 600; margin-bottom: 6px; }
  .card-evidence { color: var(--muted); font-size: 0.95em; }
  .card-actionable {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px dashed var(--card-border);
    color: var(--accent);
  }
  .empty-state { color: var(--muted); padding: 12px; }

  ul.actions { padding-left: 22px; }
  ul.actions li { margin: 6px 0; }

  .cta {
    margin-top: 40px; padding: 18px;
    text-align: center;
    background: var(--card-bg);
    border: 1px dashed var(--card-border);
    border-radius: 10px;
  }
  .cta a {
    display: inline-block;
    margin-top: 6px; padding: 8px 16px;
    background: var(--btn-bg); color: var(--btn-fg);
    text-decoration: none; border-radius: 6px; font-weight: 600;
  }
  .cta a:hover { background: var(--btn-hover); }

  footer.foot {
    margin-top: 24px;
    color: var(--muted);
    font-size: 0.85em;
    text-align: center;
  }

  /* Responsive */
  @media (max-width: 720px) {
    header.hero { flex-direction: column; align-items: flex-start; }
    .nickname { font-size: 1.7em; }
    .gauge { width: 124px; height: 124px; }
    .gauge-inner { width: 92px; height: 92px; }
    .bar-row { grid-template-columns: 110px 1fr 42px; }
    .share-hint { margin-left: 0; width: 100%; }
  }
</style>
</head>
<body>
  <!-- ===== HERO ===== -->
  <header class="hero">
    <div class="hero-text">
      <p class="hero-eyebrow">${EXTENSION_DISPLAY_NAME}</p>
      <h1 class="nickname">${nickname}</h1>
      ${oneLine ? `<div class="one-line-pack">${oneLine}</div>` : ""}
      <p class="hero-summary">${summary}</p>
    </div>
    ${gauge}
  </header>

  <!-- ===== Share ===== -->
  <div class="share-row">
    <a class="share-btn" href="${xHref}" target="_blank" rel="noopener noreferrer">𝕏 Share</a>
    <a class="share-btn outline" href="${linkedinHref}" target="_blank" rel="noopener noreferrer">in LinkedIn</a>
  </div>

  <section>
    <h2 class="section-title">Scores</h2>
    <div class="bars">${bars}</div>
  </section>

  <section>
    <h2 class="section-title">Strengths</h2>
    <div class="cards">${strengths}</div>
  </section>

  <section>
    <h2 class="section-title">Improvements</h2>
    <div class="cards">${improvements}</div>
  </section>

  ${actionItems ? `
  <section>
    <h2 class="section-title">Do in 5 min</h2>
    <ul class="actions">${actionItems}</ul>
  </section>` : ""}

  ${nextActions ? `
  <section>
    <h2 class="section-title">Next 24h</h2>
    <ul class="actions">${nextActions}</ul>
  </section>` : ""}

  <div class="cta">
    <a href="${escapeHtml(GITHUB_URL)}" target="_blank" rel="noopener noreferrer">
      ⭐ Star on GitHub
    </a>
  </div>

  <footer class="foot">
    Local CLI: <code>${escapeHtml(Config.localCliTool())}</code>
  </footer>
</body>
</html>`;
  }
}
