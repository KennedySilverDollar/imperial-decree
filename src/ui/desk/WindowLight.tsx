import type { Weather } from "../transitions/weather";

// 窓の光（SPEC_v3.3 §3.4・§4.5-3）：机の右上から差す平行光。その年の新聞の天候欄（季節）で色と強さが変わり、雨の年は暗く、
// 雨筋の影が流れる（環境の微動。動きを減らす・性能の自動調整では止める）。色は desk.css の [data-season] / [data-sky]。
// 文字や情報は持たない飾り（aria-hidden）。

export function WindowLight({ weather }: { readonly weather: Weather }) {
  return (
    <div className="window-light" aria-hidden data-season={weather.season} data-sky={weather.sky} data-testid="window-light">
      <div className="window-light-rain" />
    </div>
  );
}
