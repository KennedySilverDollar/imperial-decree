import { DECREE_BASE_COST, DECREE_POLITICAL_COST, TAG_CHAR_COST } from "../../domain/constants";
import { DEADLINE_TAG_VALUES, PRIORITY_TAG_VALUES, SCALE_TAG_VALUES } from "../../domain/Decree";
import { TARGETS } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";
import type { DecreeDraft, DraftCheck } from "../desk/decreeDraft";
import { validationMessage } from "../validation";
import { IntentPanel } from "./IntentPanel";

// 勅令用紙（SPEC §6.1 / DECISIONS I-30 / SPEC_v3.3 §4.2）：残り文字数の常時表示、タグ（対象・規模・期限・優先度、1つ5文字）。
// 書きかけは机の UI ストアが持つ（手に取る／置くをまたいで残る）。入力欄は手元（変形なし）でだけ出し、
// 俯瞰では同じ内容を読むだけの紙として描く（不変条件25）。判は判子（StampObject）が押す。

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

/** 俯瞰の紙に書かれて見えるタグ（選んでいないものは書かない） */
const tagLines = (draft: DecreeDraft): string[] => {
  const t = messages.ui.decree;
  const { target, scale, deadline, priority } = draft.tags;
  return [
    target !== "" ? t.tagLine(t.tagTarget, messages.targets[target]) : null,
    scale !== "" ? t.tagLine(t.tagScale, messages.scaleTags[scale]) : null,
    deadline !== "" ? t.tagLine(t.tagDeadline, messages.deadlineTags[deadline]) : null,
    priority !== "" ? t.tagLine(t.tagPriority, messages.priorityTags[priority]) : null,
  ].filter((line): line is string => line !== null);
};

const intentLine = (draft: DecreeDraft): string | null => {
  const { param, direction, value } = draft.intent;
  if (param === "") return null;
  return messages.ui.decree.intentLine(messages.params[param], value, messages.intentDirections[direction]);
};

interface Props {
  readonly draft: DecreeDraft;
  readonly check: DraftCheck;
  readonly onDraft: (draft: DecreeDraft) => void;
  /** 手元にある（入力できる）か。俯瞰では読むだけ */
  readonly interactive: boolean;
  /** 処理中・結果表示中・押印中は入力を止める */
  readonly locked: boolean;
  readonly stamping: boolean;
  /** 参謀の解釈を待っている */
  readonly thinking: boolean;
  readonly canIssue: boolean;
  readonly hasAide: boolean;
  readonly error: string | null;
  /** 本文の欄で Enter：判を押す */
  readonly onEnter: () => void;
}

export function DecreePanel({ draft, check, onDraft, interactive, locked, stamping, thinking, canIssue, hasAide, error, onEnter }: Props) {
  const t = messages.ui.decree;
  const { text, tags } = draft;
  const problem =
    text.trim() === ""
      ? null
      : check.issue !== null
        ? validationMessage(check.issue)
        : check.declaration === "invalid"
          ? messages.validation.invalidIntent
          : null;
  const setTags = (patch: Partial<DecreeDraft["tags"]>) => onDraft({ ...draft, tags: { ...tags, ...patch } });

  return (
    <section className="panel decree-panel" aria-label={messages.ui.panels.decree}>
      <h2 className="panel-title">{messages.ui.panels.decree}</h2>
      <div className={`paper scroll ${stamping ? "is-stamped" : ""}`}>
        <div className="scroll-body">
          {interactive ? (
            <textarea
              className="decree-text"
              aria-label={messages.ui.panels.decree}
              placeholder={t.placeholder}
              value={text}
              disabled={locked}
              rows={2}
              onChange={(e) => onDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onEnter();
                }
              }}
            />
          ) : (
            <p className={`decree-preview ${text === "" ? "is-blank" : ""}`} data-testid="decree-preview">
              {text === "" ? t.blankSheet : text}
            </p>
          )}
          <div className={`remaining ${check.remaining < 0 ? "over" : ""}`} aria-live="polite" data-testid="remaining">
            {t.remaining(check.remaining)}
          </div>
          {interactive ? (
            <>
              <div className="tags">
                <TagSelect label={t.tagTarget} value={tags.target} options={TARGETS} names={messages.targets} disabled={locked} onChange={(target) => setTags({ target })} />
                <TagSelect label={t.tagScale} value={tags.scale} options={SCALE_TAG_VALUES} names={messages.scaleTags} disabled={locked} onChange={(scale) => setTags({ scale })} />
                <TagSelect label={t.tagDeadline} value={tags.deadline} options={DEADLINE_TAG_VALUES} names={messages.deadlineTags} disabled={locked} onChange={(deadline) => setTags({ deadline })} />
                <TagSelect label={t.tagPriority} value={tags.priority} options={PRIORITY_TAG_VALUES} names={messages.priorityTags} disabled={locked} onChange={(priority) => setTags({ priority })} />
                <span className="panel-note">{t.tagCost(TAG_CHAR_COST)}</span>
                <span className="panel-note">{t.tagHintNote}</span>
              </div>
              <IntentPanel draft={draft.intent} onChange={(intent) => onDraft({ ...draft, intent })} disabled={locked} />
            </>
          ) : (
            <>
              <ul className="tags tags-preview">
                {tagLines(draft).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {intentLine(draft) !== null && <p className="intent-margin intent-preview">{intentLine(draft)}</p>}
            </>
          )}
        </div>
        <div className="seal-imprint" aria-hidden>
          {t.stamp}
        </div>
      </div>
      <div className="decree-status">
        {thinking ? (
          <p className="thinking">{t.thinking}</p>
        ) : locked ? null : !hasAide ? (
          <p className="warning-text">{t.noAideWarning}</p>
        ) : !canIssue ? (
          <p className="warning-text">{t.noCapital}</p>
        ) : problem !== null ? (
          <p className="warning-text">{problem}</p>
        ) : (
          <p className="panel-note">{t.cost(DECREE_POLITICAL_COST, DECREE_BASE_COST)}</p>
        )}
        {error !== null && <p className="warning-text">{error}</p>}
      </div>
    </section>
  );
}
