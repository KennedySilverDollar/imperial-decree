import type { IntentDirection } from "../../domain/IntentDeclaration";
import { PARAM_KEYS, type ParamKey } from "../../domain/Vocabulary";
import { messages } from "../../i18n/messages";

// 意図宣言（SPEC §6.2, §12.2）：勅令の余白に鉛筆で書き添える体裁。任意入力。

export interface IntentDraft {
  readonly param: ParamKey | "";
  readonly direction: IntentDirection;
  readonly value: string;
}

export const EMPTY_INTENT: IntentDraft = { param: "", direction: "increase", value: "" };

const DIRECTIONS: readonly IntentDirection[] = ["increase", "decrease", "absolute"];

export function IntentPanel({
  draft,
  onChange,
  disabled,
}: {
  readonly draft: IntentDraft;
  readonly onChange: (draft: IntentDraft) => void;
  readonly disabled: boolean;
}) {
  const t = messages.ui.decree;
  return (
    <div className="intent-margin">
      <span className="intent-label">{t.marginLabel}</span>
      <div className="intent-line">
        <span>{t.intentPrefix}</span>
        <select
          aria-label={t.marginLabel}
          value={draft.param}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, param: e.target.value as ParamKey | "" })}
        >
          <option value="">{t.intentNone}</option>
          {PARAM_KEYS.map((key) => (
            <option key={key} value={key}>
              {messages.params[key]}
            </option>
          ))}
        </select>
        {draft.param !== "" && (
          <>
            <span>{t.intentParticle}</span>
            <input
              className="intent-value"
              inputMode="numeric"
              placeholder={t.intentValuePlaceholder}
              value={draft.value}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, value: e.target.value.replace(/[^\d.]/g, "") })}
            />
            <select
              value={draft.direction}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, direction: e.target.value as IntentDirection })}
            >
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {messages.intentDirections[d]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
