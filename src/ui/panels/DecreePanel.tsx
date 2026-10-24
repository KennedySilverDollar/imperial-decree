import { useEffect, useState } from "react";
import { DECREE_BASE_COST, DECREE_POLITICAL_COST, STAMP_ANIMATION_MS, TAG_CHAR_COST } from "../../domain/constants";
import { remainingChars, validateDecree, type Decree, type DecreeTag, type ScaleTagValue } from "../../domain/Decree";
import { isValidIntentDeclaration, type IntentDeclaration } from "../../domain/IntentDeclaration";
import { TARGETS, type Target } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";
import { EMPTY_INTENT, IntentPanel, type IntentDraft } from "./IntentPanel";
import { validationMessage } from "../validation";

// 勅令入力（SPEC §6.1 / A-06）：残り文字数の常時表示、タグ（対象・規模、1つ3文字）、超過時は判を押せない。

const SCALES: readonly ScaleTagValue[] = ["small", "medium", "large"];

const toDecree = (text: string, target: Target | "", scale: ScaleTagValue | ""): Decree => {
  const tags: DecreeTag[] = [];
  if (target !== "") tags.push({ kind: "target", value: target });
  if (scale !== "") tags.push({ kind: "scale", value: scale });
  return { text, tags };
};

const toIntent = (draft: IntentDraft): IntentDeclaration | null | "invalid" => {
  if (draft.param === "") return null;
  const declaration: IntentDeclaration = { targetParam: draft.param, direction: draft.direction, targetValue: Number(draft.value) };
  return draft.value !== "" && isValidIntentDeclaration(declaration) ? declaration : "invalid";
};

interface Props {
  readonly turn: number;
  /** 処理中・結果表示中は入力を止める */
  readonly busy: boolean;
  /** 参謀の解釈を待っている */
  readonly thinking: boolean;
  readonly canIssue: boolean;
  readonly hasAide: boolean;
  readonly onSubmit: (decree: Decree, intent: IntentDeclaration | null) => void;
}

export function DecreePanel({ turn, busy, thinking, canIssue, hasAide, onSubmit }: Props) {
  const t = messages.ui.decree;
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target | "">("");
  const [scale, setScale] = useState<ScaleTagValue | "">("");
  const [intent, setIntent] = useState<IntentDraft>(EMPTY_INTENT);
  const [stamping, setStamping] = useState(false);

  // 新しい年になったら紙を新しくする
  useEffect(() => {
    setText("");
    setTarget("");
    setScale("");
    setIntent(EMPTY_INTENT);
    setStamping(false);
  }, [turn]);

  // 検証エラーなどで差し戻されたら、押した判を消して書き直せるようにする
  useEffect(() => {
    if (!busy) setStamping(false);
  }, [busy]);

  const decree = toDecree(text, target, scale);
  const remaining = remainingChars(decree);
  const issue = validateDecree(decree);
  const declaration = toIntent(intent);
  const locked = busy || stamping;
  const ready = issue === null && declaration !== "invalid" && canIssue && !locked;
  const problem =
    text.trim() === "" ? null : issue !== null ? validationMessage(issue) : declaration === "invalid" ? messages.validation.invalidIntent : null;

  const stamp = () => {
    if (!ready) return;
    setStamping(true);
    window.setTimeout(() => onSubmit(decree, declaration), STAMP_ANIMATION_MS);
  };

  return (
    <section className="panel decree-panel" aria-label={messages.ui.panels.decree}>
      <h2 className="panel-title">{messages.ui.panels.decree}</h2>
      <div className={`paper scroll ${stamping ? "is-stamped" : ""}`}>
        <div className="scroll-body">
          <textarea
            className="decree-text"
            aria-label={messages.ui.panels.decree}
            placeholder={t.placeholder}
            value={text}
            disabled={locked}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                stamp();
              }
            }}
          />
          <div className={`remaining ${remaining < 0 ? "over" : ""}`} aria-live="polite" data-testid="remaining">
            {t.remaining(remaining)}
          </div>
          <div className="tags">
            <label>
              {t.tagTarget}
              <select value={target} disabled={locked} onChange={(e) => setTarget(e.target.value as Target | "")}>
                <option value="">{t.tagNone}</option>
                {TARGETS.map((value) => (
                  <option key={value} value={value}>
                    {messages.targets[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.tagScale}
              <select value={scale} disabled={locked} onChange={(e) => setScale(e.target.value as ScaleTagValue | "")}>
                <option value="">{t.tagNone}</option>
                {SCALES.map((value) => (
                  <option key={value} value={value}>
                    {messages.scaleTags[value]}
                  </option>
                ))}
              </select>
            </label>
            <span className="panel-note">{t.tagCost(TAG_CHAR_COST)}</span>
          </div>
          <IntentPanel draft={intent} onChange={setIntent} disabled={locked} />
        </div>
        <div className="stamp-area">
          <div className="seal-imprint" aria-hidden>
            {t.stamp}
          </div>
          <button className="seal-button" disabled={!ready} onClick={stamp} aria-label={t.stampLabel} data-testid="stamp">
            {t.stamp}
          </button>
          <span className="stamp-caption">{t.stampLabel}</span>
        </div>
      </div>
      <div className="decree-status">
        {thinking ? (
          <p className="thinking">{t.thinking}</p>
        ) : busy || stamping ? null : !hasAide ? (
          <p className="warning-text">{t.noAideWarning}</p>
        ) : !canIssue ? (
          <p className="warning-text">{t.noCapital}</p>
        ) : problem !== null ? (
          <p className="warning-text">{problem}</p>
        ) : (
          <p className="panel-note">{t.cost(DECREE_POLITICAL_COST, DECREE_BASE_COST)}</p>
        )}
      </div>
    </section>
  );
}
