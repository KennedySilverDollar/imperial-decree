import { describe, expect, it } from "vitest";
import { LOW_FPS_WINDOW_MS } from "../desk/deskConstants";
import { fpsOver, isSustainedLow } from "./fps";

describe("フレームレートの計測", () => {
  it("直近 1 秒の平均と最長フレームを出す", () => {
    const frames = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
    const { fps, worstFrameMs } = fpsOver(frames, 1000);
    expect(fps).toBeCloseTo(60, 0);
    expect(worstFrameMs).toBeCloseTo(16.7, 0);
  });

  it("1 秒より前のフレームは数えない・少なすぎれば 0", () => {
    const stutter = [0, 500, 1000, 1100, 1200, 2000];
    expect(fpsOver(stutter, 2000).worstFrameMs).toBe(800);
    expect(fpsOver([10], 20).fps).toBe(0);
  });

  it("しきい値未満が 3 秒続いたら「続いた」と判定する", () => {
    expect(isSustainedLow(null, 10_000)).toBe(false);
    expect(isSustainedLow(1000, 1000 + LOW_FPS_WINDOW_MS - 1)).toBe(false);
    expect(isSustainedLow(1000, 1000 + LOW_FPS_WINDOW_MS)).toBe(true);
  });
});
