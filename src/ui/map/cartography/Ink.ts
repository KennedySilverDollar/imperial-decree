// 紙の経年とインクの描き込み（SPEC_v3.4 §8.3・§8.4）。純関数。
// 今年描き込んだ線は濃い新しい墨、それより前の線は褪せた墨。完成した建物は「外形 → 屋根 → 着彩」の順に一度だけ描き込む。
// これは完成した年の一度きりの演出で、工事の進捗の表現ではない（普請中の印は一様のまま）。動きを減らす設定では即時。

export const INK_FRESH = "#24170a";
export const INK_OLD = "#6e5c48";
export const INK_DRAW_MS = 1400;
/** 紙の経年が最大になる年数（可読性は落とさない：色を少し黄ばませ、縁を少し焼くだけ） */
export const PAPER_FULL_AGE_YEARS = 50;

/** 紙の古び具合（0..1）。年が進むほど大きい */
export const paperAge = (turn: number): number => Math.max(0, Math.min(1, (turn - 1) / PAPER_FULL_AGE_YEARS));

/** 紙の黄ばみ（乗算の色と濃さ）と縁の焼け */
export const paperTint = (turn: number): { readonly color: string; readonly alpha: number; readonly edgeAlpha: number } => {
  const age = paperAge(turn);
  return { color: "rgb(214,190,140)", alpha: 0.05 + 0.13 * age, edgeAlpha: 0.12 + 0.18 * age };
};

/** その年に描き込まれた線か（今年の線は新しい墨） */
export const isFresh = (madeTurn: number, currentTurn: number): boolean => madeTurn >= currentTurn - 1;

/** 描き込みの進み（0..1）。動きを減らす設定では常に 1 */
export const drawProgress = (elapsedMs: number, reduced: boolean): number => (reduced ? 1 : Math.max(0, Math.min(1, elapsedMs / INK_DRAW_MS)));

/** 建物の描き込みの3段階：外形 0〜0.4、屋根 0.4〜0.7、着彩 0.7〜1 */
export const inkPhases = (progress: number): { readonly outline: number; readonly roof: number; readonly fill: number } => {
  const seg = (a: number, b: number) => Math.max(0, Math.min(1, (progress - a) / (b - a)));
  return { outline: seg(0, 0.4), roof: seg(0.4, 0.7), fill: seg(0.7, 1) };
};
