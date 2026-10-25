import { useEffect, useState } from "react";
import { DECREE_BASE_COST, DECREE_POLITICAL_COST, STAMP_ANIMATION_MS, TAG_CHAR_COST } from "../../domain/constants";
import {
  DEADLINE_TAG_VALUES,
  PRIORITY_TAG_VALUES,
  remainingChars,
  SCALE_TAG_VALUES,
  validateDecree,
  type DeadlineTagValue,
  type Decree,
  type DecreeTag,
  type PriorityTagValue,
  type ScaleTagValue,
} from "../../domain/Decree";
import { isValidIntentDeclaration, type IntentDeclaration } from "../../domain/IntentDeclaration";
import { TARGETS, type Target } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";
import { EMPTY_INTENT, IntentPanel, type IntentDraft } from "./IntentPanel";
import { validationMessage } from "../validation";

// 勅令入力（SPEC §6.1 / DECISIONS I-30）：残り文字数の常時表示、タグ（対象・規模・期限・優先度、1つ5文字）、超過時は判を押せない。

interface TagDraft {
  readonly target: Target | "";
  readonly scale: ScaleTagValue | "";
  readonly deadline: DeadlineTagValue | "";
  readonly priority: PriorityTagValue | "";
}

const EMPTY_TAGS: TagDraft = { target: "", scale: "", deadline: "", priority: "" };

const toDecree = (text: string, draft: TagDraft): Decree => {
  const tags: DecreeTag[] = [];
  if (draft.target !== "") tags.push({ kind: "target", value: draft.target });
  if (draft.scale !== "") tags.push({ kind: "scale", value: draft.scale });
  if (draft.deadline !== "") tags.push({ kind: "deadline", value: draft.deadline });
  if (draft.priority !== "") tags.push({ kind: "priority", value: draft.priority });
  return { text, tags };
};

function TagSelect<V extends string>(props: {
  readonly label: string;
  readonly value: V | "";
  readonly options: readonly V[];
  readonly names: Readonly<Record<V, string>>;
  readonly disabled: boolean;
  readonly onChange: (value: V | "") => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as V | "")}>
        <option value="">{messages.ui.decree.tagNone}</option>
        {props.options.map((value) => (
          <option key={value} value={value}>
            {props.names[value]}
          </option>
        ))}
      </select>
    </label>
  );
}

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
  const [tags, setTags] = useState<TagDraft>(EMPTY_TAGS);
  const [intent, setIntent] = useState<IntentDraft>(EMPTY_INTENT);
  const [stamping, setStamping] = useState(false);

  // 新しい年になったら紙を新しくする
  useEffect(() => {
    setText("");
    setTags(EMPTY_TAGS);
    setIntent(EMPTY_INTENT);
    setStamping(false);
  }, [turn]);

  // 検証エラーなどで差し戻されたら、押した判を消して書き直せるようにする
  useEffect(() => {
    if (!busy) setStamping(false);
  }, [busy]);

  const decree = toDecree(text, tags);
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
            <TagSelect label={t.tagTarget} value={tags.target} options={TARGETS} names={messages.targets} disabled={locked} onChange={(target) => setTags({ ...tags, target })} />
            <TagSelect label={t.tagScale} value={tags.scale} options={SCALE_TAG_VALUES} names={messages.scaleTags} disabled={locked} onChange={(scale) => setTags({ ...tags, scale })} />
            <TagSelect label={t.tagDeadline} value={tags.deadline} options={DEADLINE_TAG_VALUES} names={messages.deadlineTags} disabled={locked} onChange={(deadline) => setTags({ ...tags, deadline })} />
            <TagSelect label={t.tagPriority} value={tags.priority} options={PRIORITY_TAG_VALUES} names={messages.priorityTags} disabled={locked} onChange={(priority) => setTags({ ...tags, priority })} />
            <span className="panel-note">{t.tagCost(TAG_CHAR_COST)}</span>
            <span className="panel-note">{t.tagHintNote}</span>
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
