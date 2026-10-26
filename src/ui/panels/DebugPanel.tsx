import { useMemo, useState } from "react";
import { TARGETS, type Target } from "../../domain/Buildings";
import { countTextChars, SCALE_TAG_VALUES, type Decree, type DecreeTag, type ScaleTagValue } from "../../domain/Decree";
import {
  probeAuth,
  probeCall,
  probeConfig,
  probePipeline,
  probeReach,
  probeValidate,
  runDiagnostics,
  STEP_IDS,
  summarizeLlmLog,
  type ProbeConfig,
  type StepId,
  type StepResult,
} from "../../engine/LLMDiagnostics";
import { messages } from "../../i18n/messages";
import { readStoredLog } from "../../services/LogService";
import { factLabel, formatReport, hintFor } from "../debugReport";

// AI 診断画面（?debug）。フロント → プロキシ → Mistral の経路を段階ごとに試し、原因を切り分ける。
// ゲームの状態・設定には一切触れない（入力欄の上書きはこの画面の診断だけに効く）。

const t = messages.ui.debug;
const DEFAULT_DECREE = "道を大いに造れ";

interface Props {
  readonly llmMode: "proxy" | "mock";
  readonly envUrl: string;
  readonly envToken: string;
}

type Results = Partial<Record<StepId, StepResult>>;

function StepCard({ id, step, running, onRun }: { id: StepId; step: StepResult | undefined; running: boolean; onRun: () => void }) {
  const hint = step ? hintFor(step.code) : null;
  const note = (t.stepNote as Partial<Record<StepId, string>>)[id];
  return (
    <article className={`debug-step ${step?.verdict ?? "idle"}`} data-testid={`debug-step-${id}`} data-verdict={step?.verdict ?? "idle"}>
      <header className="debug-step-head">
        <h3>{t.steps[id]}</h3>
        {step && <span className={`debug-badge ${step.verdict}`}>{t.verdict[step.verdict]}</span>}
        {step?.ms != null && <span className="debug-ms">{t.ms(step.ms)}</span>}
        <button className="button subtle" disabled={running} onClick={onRun}>
          {t.run.step}
        </button>
      </header>
      {note && <p className="panel-note">{note}</p>}
      {step && hint && (
        <div className="debug-step-body">
          {hint.cause !== "" && (
            <p>
              {step.verdict !== "ok" && <strong>{t.sections.cause}：</strong>}
              {hint.cause}
            </p>
          )}
          {step.verdict !== "ok" && hint.fix !== "" && (
            <p>
              <strong>{t.sections.fix}：</strong>
              {hint.fix}
            </p>
          )}
          {Object.entries(step.facts).some(([, v]) => v !== "") && (
            <dl className="debug-facts">
              {Object.entries(step.facts)
                .filter(([, v]) => v !== "")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{factLabel(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
          {step.raw !== null && (
            <details open={step.verdict !== "ok"}>
              <summary>{t.sections.raw}</summary>
              <pre className="debug-raw">{step.raw}</pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export function DebugPanel({ llmMode, envUrl, envToken }: Props) {
  const [url, setUrl] = useState(envUrl);
  const [token, setToken] = useState(envToken);
  const [showToken, setShowToken] = useState(false);
  const [text, setText] = useState(DEFAULT_DECREE);
  const [target, setTarget] = useState<Target | "">("");
  const [scale, setScale] = useState<ScaleTagValue | "">("");
  const [results, setResults] = useState<Results>({});
  const [running, setRunning] = useState<StepId | "all" | null>(null);
  const [output, setOutput] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "done" | "failed">("idle");
  const [pastVersion, setPastVersion] = useState(0);

  const cfg: ProbeConfig = {
    baseUrl: url.trim(),
    token: token.trim(),
    fetch: (input, init) => window.fetch(input, init),
    pageOrigin: window.location.origin,
    pageProtocol: window.location.protocol,
  };
  const decree: Decree = {
    text,
    tags: [
      ...(target === "" ? [] : [{ kind: "target", value: target } satisfies DecreeTag]),
      ...(scale === "" ? [] : [{ kind: "scale", value: scale } satisfies DecreeTag]),
    ],
  };
  // 計測ログは診断のたびに読み直す（診断の最中にも増えるため）
  const past = useMemo(() => summarizeLlmLog(readStoredLog(window.localStorage)), [pastVersion]);

  const put = (step: StepResult) => setResults((prev) => ({ ...prev, [step.id]: step }));

  const runAll = async () => {
    setRunning("all");
    setResults({});
    setCopyState("idle");
    setOutput("");
    await runDiagnostics(cfg, decree, put).catch(() => undefined);
    setPastVersion((v) => v + 1);
    setRunning(null);
  };

  const runOne = async (id: StepId) => {
    setRunning(id);
    try {
      switch (id) {
        case "config":
          put(probeConfig(cfg));
          break;
        case "reach":
          put(await probeReach(cfg));
          break;
        case "auth":
          put(await probeAuth(cfg));
          break;
        case "call": {
          const outcome = await probeCall(cfg, decree);
          put(outcome.step);
          if (outcome.output !== null) {
            setOutput(outcome.output);
            put(probeValidate(outcome.output));
          }
          break;
        }
        case "validate":
          put(probeValidate(output));
          break;
        case "pipeline":
          put(await probePipeline(cfg, decree));
          setPastVersion((v) => v + 1);
          break;
      }
    } finally {
      setRunning(null);
    }
  };

  const steps = STEP_IDS.map((id) => results[id]).filter((s): s is StepResult => s !== undefined);
  // 検証欄：手で貼った／④で受け取った出力。一括実行のときは⑤の raw（＝④の出力）が入る
  const shownOutput = output !== "" ? output : (results.validate?.raw ?? "");

  const copy = async () => {
    const report = formatReport(steps, { llmMode, pageOrigin: window.location.origin }, past);
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("done");
    } catch {
      setCopyState("failed");
    }
  };

  const busy = running !== null;
  const chars = countTextChars(text);
  return (
    <div className="desk debug" data-testid="debug">
      <header className="desk-header">
        <h1 className="title">{t.title}</h1>
        <span className="spacer" />
        <a className="button subtle on-wood" href={window.location.pathname}>
          {t.back}
        </a>
      </header>

      <p className="debug-lead">{t.lead}</p>
      <p className={`debug-mode ${llmMode}`} data-testid="debug-mode">
        {t.mode[llmMode]}
      </p>
      <p className="debug-lead small">{t.envNote}</p>

      <section className="paper debug-form" aria-label={t.title}>
        <label>
          {t.form.url}
          <input value={url} placeholder={t.form.urlHint} onChange={(e) => setUrl(e.target.value)} data-testid="debug-url" />
        </label>
        <label>
          {t.form.token}
          <span className="debug-token">
            <input type={showToken ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} data-testid="debug-token" />
            <button className="button subtle" type="button" onClick={() => setShowToken(!showToken)}>
              {showToken ? t.form.hide : t.form.show}
            </button>
          </span>
        </label>
        <label>
          {t.form.text}
          <input value={text} onChange={(e) => setText(e.target.value)} data-testid="debug-text" />
          <span className="panel-note">{chars}</span>
        </label>
        <div className="debug-tags">
          <label>
            {t.form.target}
            <select value={target} onChange={(e) => setTarget(e.target.value as Target | "")}>
              <option value="">{t.form.none}</option>
              {TARGETS.map((value) => (
                <option key={value} value={value}>
                  {messages.targets[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.form.scale}
            <select value={scale} onChange={(e) => setScale(e.target.value as ScaleTagValue | "")}>
              <option value="">{t.form.none}</option>
              {SCALE_TAG_VALUES.map((value) => (
                <option key={value} value={value}>
                  {messages.scaleTags[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="debug-actions">
          <button className="button" disabled={busy} onClick={() => void runAll()} data-testid="debug-run-all">
            {running === "all" ? t.run.running : t.run.all}
          </button>
          <button className="button subtle" disabled={steps.length === 0} onClick={() => void copy()} data-testid="debug-copy">
            {t.run.copy}
          </button>
          {copyState === "done" && <span className="panel-note">{t.run.copied}</span>}
          {copyState === "failed" && <span className="warning-text">{t.run.copyFailed}</span>}
        </div>
      </section>

      <div className="debug-steps">
        {STEP_IDS.map((id) => (
          <StepCard key={id} id={id} step={results[id]} running={busy} onRun={() => void runOne(id)} />
        ))}
      </div>

      <section className="paper debug-form" aria-label={t.validateManual.title}>
        <h2 className="panel-title">{t.validateManual.title}</h2>
        <p className="panel-note">{t.validateManual.lead}</p>
        <textarea value={shownOutput} rows={4} onChange={(e) => setOutput(e.target.value)} data-testid="debug-output" />
        <div className="debug-actions">
          <button className="button subtle" disabled={busy || shownOutput === ""} onClick={() => put(probeValidate(shownOutput))}>
            {t.validateManual.button}
          </button>
        </div>
      </section>

      <section className="paper debug-form" aria-label={t.past.title} data-testid="debug-past">
        <h2 className="panel-title">{t.past.title}</h2>
        {past.turns === 0 && past.failures.length === 0 ? (
          <p className="panel-note">{t.past.empty}</p>
        ) : (
          <>
            <p>{t.past.turns(past.turns, past.viaLlm, past.viaTemplate)}</p>
            <h3 className="debug-sub">{t.past.failures}</h3>
            {past.failures.length === 0 ? (
              <p className="panel-note">{t.past.none}</p>
            ) : (
              <ul className="debug-list">
                {past.failures.map((f) => (
                  <li key={f.key}>
                    {f.count}× {f.key}
                  </li>
                ))}
              </ul>
            )}
            <p className="panel-note">{t.past.oldNote}</p>
          </>
        )}
      </section>
    </div>
  );
}
