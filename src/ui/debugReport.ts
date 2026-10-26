import type { LogSummary, StepResult } from "../engine/LLMDiagnostics";
import { STEP_IDS } from "../engine/LLMDiagnostics";
import { messages } from "../i18n/messages";

// AI 診断の文面化（画面とコピー用レポートで共有する）。ここに診断のロジックは置かない。

const t = messages.ui.debug;
const RAW_REPORT_MAX = 1500;

export interface Hint {
  readonly cause: string;
  readonly fix: string;
}

/** コードから原因と対処を引く。細かいコード（call.upstream_5xx など）は近い汎用の説明にまとめる */
export const hintFor = (code: string): Hint => {
  const exact = t.hints[code];
  if (exact) return exact;
  if (code.endsWith(".skipped")) return t.hints.skipped ?? { cause: "", fix: "" };
  const upstream = /^call\.upstream_(\d+)$/.exec(code);
  if (upstream) return t.upstreamGeneric(upstream[1] ?? "");
  return { cause: code, fix: "" };
};

export const factLabel = (key: string): string => (t.facts as Record<string, string>)[key] ?? key;

const pad = (text: string): string => text.split("\n").map((l) => `    ${l}`).join("\n");

export const formatReport = (
  steps: readonly StepResult[],
  env: { readonly llmMode: "proxy" | "mock"; readonly pageOrigin: string },
  past: LogSummary | null,
): string => {
  const lines: string[] = [t.report.heading, `${t.report.mode}: ${env.llmMode}`, `${t.report.origin}: ${env.pageOrigin}`, "", t.report.steps];
  for (const id of STEP_IDS) {
    const step = steps.find((s) => s.id === id);
    if (!step) continue;
    const hint = hintFor(step.code);
    lines.push(`- ${t.steps[id]}: ${t.verdict[step.verdict]} [${step.code}]${step.ms === null ? "" : ` ${t.ms(step.ms)}`}`);
    for (const [key, value] of Object.entries(step.facts)) if (value !== "") lines.push(`    ${factLabel(key)}: ${value}`);
    if (step.verdict !== "ok" && hint.cause !== "") lines.push(`    ${t.sections.cause}: ${hint.cause}`);
    if (step.verdict !== "ok" && hint.fix !== "") lines.push(`    ${t.sections.fix}: ${hint.fix}`);
    if (step.raw !== null && step.verdict !== "ok") lines.push(`    ${t.sections.raw}:`, pad(step.raw.slice(0, RAW_REPORT_MAX)));
  }
  if (past !== null && past.turns + past.failures.length > 0) {
    lines.push("", t.past.title, `- ${t.past.turns(past.turns, past.viaLlm, past.viaTemplate)}`);
    for (const f of past.failures) lines.push(`    ${f.count}× ${f.key}`);
  }
  return lines.join("\n");
};
