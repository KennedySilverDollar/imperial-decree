// 筆で書いた文字の濃淡（SPEC_v3.3 §4.2「インクのわずかな滲みと濃淡」）。
// 文字の位置だけで決まる見た目の揺らぎで、ゲームの乱数ではない（同じ文面なら毎回同じ濃さ。Rng は使わない）。

const fract = (x: number) => x - Math.floor(x);

/** i 文字目の墨の濃さ（0.74〜1）。筆を継いだ直後（数文字ごと）は濃く、続けて書くと少しかすれる */
export const inkDensity = (i: number): number => {
  const stroke = (i % 5) / 5;
  const grain = fract(Math.sin((i + 1) * 12.9898) * 43758.5453);
  return Math.round((1 - stroke * 0.12 - grain * 0.14) * 100) / 100;
};

/** 文面を、濃さつきの文字に分ける（サロゲートペアも1字） */
export const inkGlyphs = (text: string): readonly { readonly ch: string; readonly density: number }[] =>
  [...text].map((ch, i) => ({ ch, density: inkDensity(i) }));
