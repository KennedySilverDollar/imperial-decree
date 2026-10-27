// ランプ（SPEC_v3.3 §3.2・§3.4）：操作はなく、照明の基準点。図形は CSS だけで描く。
// 炎はわずかに揺らぐ（環境の微動。動きを減らす・性能の自動調整では止める）。ゲームオーバーの年は消える（§4.5）。

export function Lamp({ out = false }: { readonly out?: boolean }) {
  return (
    <div className={`lamp ${out ? "is-out" : ""}`} aria-hidden>
      <div className="lamp-glow" />
      <div className="lamp-chimney" />
      <div className="lamp-body" />
      <div className="lamp-base" />
    </div>
  );
}
