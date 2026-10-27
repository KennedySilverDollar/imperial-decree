// ランプ（SPEC_v3.3 §3.2・§3.4）：操作はなく、照明の基準点。図形は CSS だけで描く。

export function Lamp() {
  return (
    <div className="lamp" aria-hidden>
      <div className="lamp-glow" />
      <div className="lamp-chimney" />
      <div className="lamp-body" />
      <div className="lamp-base" />
    </div>
  );
}
