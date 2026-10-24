import { Effect } from "effect";
import type { DecreeTag } from "../domain/Decree";
import type { Ending } from "../domain/Ending";
import { LogService } from "../services/LogService";

// プロト KPI の計測イベント（SPEC §15）。UI はここで型付けされたイベントだけを送る。
//  - 目標到達率・ゲームオーバー率・平均ターン数 → game.end
//  - 自発的な再プレイ率 → game.start（restartIndex）
//  - 意図宣言の使用率とボーナス獲得率 → turn.resolved（intentDeclared / intentAchieved）
//  - 勅令の文字数・タグ使用の変化 → turn.submitted（chars / tags）
//  - 判子押下前の平均熟考時間 → turn.submitted（deliberationMs）
//  - 3段表示のめくり回数 → result.closed（flips）

export type KpiEvent =
  | { readonly event: "session.start"; readonly data: { readonly sessionId: string } }
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
  | { readonly event: "game.restart"; readonly data: { readonly gameId: string; readonly turn: number; readonly ended: boolean } };

export const logKpi = (event: KpiEvent): Effect.Effect<void, never, LogService> =>
  Effect.flatMap(LogService, (logger) => logger.log(event));
