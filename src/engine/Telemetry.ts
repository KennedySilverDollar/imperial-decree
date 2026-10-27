import { Effect } from "effect";
import type { Target } from "../domain/Buildings";
import type { DecreeTag } from "../domain/Decree";
import type { Ending } from "../domain/Ending";
import type { TurnRecord } from "../domain/TurnRecord";
import { LogService } from "../services/LogService";

// プロト KPI の計測イベント（SPEC §15）。UI はここで型付けされたイベントだけを送る。
//  - 目標到達率・ゲームオーバー率・平均ターン数 → game.end
//  - 自発的な再プレイ率 → game.start（restartIndex）
//  - 意図宣言の使用率とボーナス獲得率 → turn.resolved（intentDeclared / intentAchieved）
//  - 勅令の文字数・タグ使用の変化 → turn.submitted（chars / tags）
//  - 判子押下前の平均熟考時間 → turn.submitted（deliberationMs）
//  - 3段表示のめくり回数 → result.closed（flips）
//  v3.2 §3.2（§3.3 の KPI）：
//  - 新聞の閲覧時間 → newspaper.read（号ごとに、紙面に視線（ポインタ・フォーカス）があった時間）
//  - 投書欄の参照 → newspaper.letters（号ごとに、投書欄の記事に一定時間とどまったら1回）
//  - 建物種別の使用 → target.used（執行された指示の target と結果。執行内容は TurnRecord から取る）

export type KpiEvent =
  | { readonly event: "session.start"; readonly data: { readonly sessionId: string; readonly llmMode: "proxy" | "mock" } }
  | {
      readonly event: "game.start";
      readonly data: { readonly sessionId: string; readonly gameId: string; readonly seed: number; readonly restartIndex: number; readonly resumed: boolean };
    }
  | {
      readonly event: "turn.submitted";
      readonly data: {
        readonly gameId: string;
        readonly turn: number;
        readonly chars: number;
        readonly tags: readonly DecreeTag["kind"][];
        readonly intentDeclared: boolean;
        readonly deliberationMs: number;
      };
    }
  | {
      readonly event: "turn.resolved";
      readonly data: {
        readonly gameId: string;
        readonly turn: number;
        readonly source: "llm" | "template" | null;
        readonly intentDeclared: boolean;
        readonly intentAchieved: boolean | null;
        readonly bonusHappiness: number;
      };
    }
  | { readonly event: "result.closed"; readonly data: { readonly gameId: string; readonly turn: number; readonly flips: number; readonly deepestSheet: number } }
  | { readonly event: "aide.appointed" | "aide.dismissed"; readonly data: { readonly gameId: string; readonly turn: number; readonly aideId: string } }
  | { readonly event: "game.end"; readonly data: { readonly gameId: string; readonly turns: number; readonly ending: Ending } }
  | { readonly event: "game.restart"; readonly data: { readonly gameId: string; readonly turn: number; readonly ended: boolean } }
  | {
      readonly event: "newspaper.read";
      readonly data: {
        readonly gameId: string;
        /** 号の年（創刊号は 0） */
        readonly issueTurn: number;
        readonly dwellMs: number;
        readonly articleCount: number;
        readonly hasLetters: boolean;
        /** 机の上の今の号か、既決箱から取り出した過去の号か（SPEC_v3.3 §3.2。無ければ机の上） */
        readonly context?: "desk" | "archive";
      };
    }
  | {
      /** 書類を手に取って置いた（SPEC_v3.3 §13.2：手に取った回数と手元での滞在時間） */
      readonly event: "desk.handled";
      readonly data: { readonly gameId: string; readonly turn: number; readonly object: string; readonly mode: "3d" | "flat"; readonly dwellMs: number };
    }
  | {
      /** 側近書簡の封蝋を割った（未読の書簡を開いた） */
      readonly event: "letter.opened";
      readonly data: { readonly gameId: string; readonly turn: number; readonly aideId: string };
    }
  | {
      /** メモをちぎった・留め先を変えた（SPEC_v3.3 §7・§13.2：作成数と留め先の分布） */
      readonly event: "note.created" | "note.attached";
      readonly data: { readonly gameId: string; readonly turn: number; readonly chars: number; readonly attachedTo: "none" | "article" | "aideReport" };
    }
  | {
      readonly event: "newspaper.letters";
      readonly data: { readonly gameId: string; readonly issueTurn: number; readonly articleIds: readonly string[]; readonly dwellMs: number };
    }
  | {
      readonly event: "target.used";
      readonly data: {
        readonly gameId: string;
        readonly turn: number;
        readonly target: Target;
        readonly outcome: TargetOutcome;
        /** 発注した棟数（発注以外は 0） */
        readonly count: number;
      };
    };

export type TargetOutcome = "ordered" | "repair" | "failed" | "policy" | "noop";

export interface TargetUsage {
  readonly target: Target;
  readonly outcome: TargetOutcome;
  readonly count: number;
}

/** その年に側近が実際に執り行った指示（歪み後の target）と結果。建物種別の使用分布の材料 */
export const targetUsageOf = (record: TurnRecord): readonly TargetUsage[] => {
  const target = record.aideAdjustment?.adjustedIntent.target ?? null;
  if (target === null) return [];
  return record.execution.notes.flatMap((note): TargetUsage[] => {
    switch (note.kind) {
      case "ordered":
        return [{ target: note.building, outcome: note.repair ? "repair" : "ordered", count: note.count }];
      case "orderFailed":
        return [{ target: note.building, outcome: "failed", count: 0 }];
      case "policyChanged":
        return [{ target: note.policy, outcome: "policy", count: 0 }];
      case "noop":
        return [{ target, outcome: "noop", count: 0 }];
      case "noAide":
        return [];
    }
  });
};

export const logKpi = (event: KpiEvent): Effect.Effect<void, never, LogService> =>
  Effect.flatMap(LogService, (logger) => logger.log(event));
