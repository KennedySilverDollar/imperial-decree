import { useState } from "react";
import { DECREE_BASE_COST, DECREE_POLITICAL_COST, TAG_CHAR_COST } from "../../domain/constants";
import { DEADLINE_TAG_VALUES, PRIORITY_TAG_VALUES, SCALE_TAG_VALUES } from "../../domain/Decree";
import { TARGETS } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";
import type { DecreeDraft, DraftCheck, TagDraft } from "../desk/decreeDraft";
import { inkGlyphs } from "../desk/ink";
import { validationMessage } from "../validation";
import { IntentPanel } from "./IntentPanel";

// 勅令用紙（SPEC §6.1 / DECISIONS I-30 / SPEC_v3.3 §4.2）。
// 本文は筆の書体で、文字ごとの墨の濃淡と滲みを付けて描く（入力そのものは textarea。上に重ねた写しで見せる）。
// タグは用紙の上辺に貼る付箋（1枚 TAG_CHAR_COST 字）。残り字数は右下に朱で記す。意図は余白に鉛筆で書き添える。
// 書きかけは机の UI ストアが持つ（手に取る／置くをまたいで残る）。入力欄は手元（変形なし）でだけ出し、
// 俯瞰では同じ内容を読むだけの紙として描く（不変条件25）。判は判子（StampObject）が押す。

type TagKind = keyof TagDraft;

const TAG_KINDS: readonly TagKind[] = ["target", "scale", "deadline", "priority"];

const tagLabel = (kind: TagKind): string => {
  const t = messages.ui.decree;
  return { target: t.tagTarget, scale: t.tagScale, deadline: t.tagDeadline, priority: t.tagPriority }[kind];
};

const tagValueName = (draft: TagDraft, kind: TagKind): string | null => {
  switch (kind) {
    case "target":
      return draft.target === "" ? null : messages.targets[draft.target];
    case "scale":
      return draft.scale === "" ? null : messages.scaleTags[draft.scale];
    case "deadline":
      return draft.deadline === "" ? null : messages.deadlineTags[draft.deadline];
    case "priority":
      return draft.priority === "" ? null : messages.priorityTags[draft.priority];
  }
};

/** 付箋1枚：選んでいなければ用紙の縁に薄く控え、選ぶと貼られて字数を TAG_CHAR_COST 消費する */
function StickyTag<V extends string>(props: {
  readonly kind: TagKind;
  readonly value: V | "";
  readonly options: readonly V[];
  readonly names: Readonly<Record<V, string>>;
  readonly disabled: boolean;
  readonly onChange: (value: V | "") => void;
}) {
  return (
    <label className={`sticky sticky-${props.kind} ${props.value === "" ? "" : "is-stuck"}`}>
      <span className="sticky-label">{tagLabel(props.kind)}</span>
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

/** 墨で書いた文字の写し（濃淡と滲み）。文字ごとの濃さは位置で決まる */
function InkText({ text }: { readonly text: string }) {
  return (
    <>
      {inkGlyphs(text).map((g, i) => (
        <span key={i} className="ink-glyph" style={{ ["--ink-density" as string]: g.density }}>
          {g.ch}
        </span>
      ))}
    </>
  );
}

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
  const [composing, setComposing] = useState(false);
  const over = check.remaining < 0;
  const problem =
    text.trim() === ""
      ? null
      : check.issue !== null
        ? validationMessage(check.issue)
        : check.declaration === "invalid"
          ? messages.validation.invalidIntent
          : null;
  const setTags = (patch: Partial<TagDraft>) => onDraft({ ...draft, tags: { ...tags, ...patch } });
  const stuck = TAG_KINDS.filter((kind) => tagValueName(tags, kind) !== null);

  return (
    <section className="panel decree-panel" aria-label={messages.ui.panels.decree}>
      <h2 className="panel-title">{messages.ui.panels.decree}</h2>
      <div className={`paper scroll decree-sheet ${stamping ? "is-stamped" : ""}`}>
        {/* 上辺の付箋（タグ） */}
        {interactive ? (
          <div className="tags sticky-row">
            <StickyTag kind="target" value={tags.target} options={TARGETS} names={messages.targets} disabled={locked} onChange={(target) => setTags({ target })} />
            <StickyTag kind="scale" value={tags.scale} options={SCALE_TAG_VALUES} names={messages.scaleTags} disabled={locked} onChange={(scale) => setTags({ scale })} />
            <StickyTag kind="deadline" value={tags.deadline} options={DEADLINE_TAG_VALUES} names={messages.deadlineTags} disabled={locked} onChange={(deadline) => setTags({ deadline })} />
            <StickyTag kind="priority" value={tags.priority} options={PRIORITY_TAG_VALUES} names={messages.priorityTags} disabled={locked} onChange={(priority) => setTags({ priority })} />
          </div>
        ) : (
          <ul className="tags sticky-row tags-preview">
            {stuck.map((kind) => (
              <li key={kind} className={`sticky sticky-${kind} is-stuck`}>
                {t.tagLine(tagLabel(kind), tagValueName(tags, kind) ?? "")}
              </li>
            ))}
          </ul>
        )}

        <div className="scroll-body">
          {interactive ? (
            <div className={`ink-field ${composing ? "is-composing" : ""}`}>
              <div className="ink-text ink-mirror" aria-hidden>
                <InkText text={text} />
                {"​"}
              </div>
              <textarea
                className="decree-text ink-input"
                aria-label={messages.ui.panels.decree}
                placeholder={t.placeholder}
                value={text}
                disabled={locked}
                rows={3}
                onChange={(e) => onDraft({ ...draft, text: e.target.value })}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onEnter();
                  }
                }}
              />
            </div>
          ) : (
            <p className={`ink-text decree-preview ${text === "" ? "is-blank" : ""}`} data-testid="decree-preview">
              {text === "" ? t.blankSheet : <InkText text={text} />}
            </p>
          )}
          {interactive ? (
            <IntentPanel draft={draft.intent} onChange={(intent) => onDraft({ ...draft, intent })} disabled={locked} />
          ) : (
            intentLine(draft) !== null && <p className="intent-margin intent-preview">{intentLine(draft)}</p>
          )}
          {interactive && (
            <p className="sheet-hints">
              <span className="panel-note">{t.tagCost(TAG_CHAR_COST)}</span>
              <span className="panel-note">{t.tagHintNote}</span>
            </p>
          )}
        </div>

        {/* 残り字数は用紙の右下に朱で。超えたら「超過」と書き、下線を引く（色だけに頼らない） */}
        <div className={`remaining ${over ? "over" : ""}`} aria-live="polite" data-testid="remaining">
          {t.remaining(check.remaining)}
          {over && <span className="remaining-over">{t.overLimit}</span>}
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
