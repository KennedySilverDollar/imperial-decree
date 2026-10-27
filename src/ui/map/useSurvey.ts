import { useEffect, useRef, useState } from "react";
import type { Gazetteer } from "../../engine/Gazetteer";
import { MAP_PX, MAP_SNAPSHOT } from "./mapConstants";
import type { Ctx2D } from "./pictograms";
import { canvasAvailable, loadSurvey, type SurveyBase } from "./surveyLoader";
import type { SurveyModel } from "./surveyModel";
import { lostBetween, renderSurvey, surveyTexts, type LostMark, type SurveyArt } from "./SurveyRenderer";

// 測量図を手元に用意する：地形（Worker）を待ち、書体を読み込んでから、毎年のレイヤを Canvas に描き込む。
// 描き終えるたびに version が進む（Phaser のテクスチャと俯瞰の静止画を更新する合図）。
// 遷移の演出（§4.5）の間は hold で前の年のまま止め、「地図の更新」の段で描き直す。そのとき、直近の1年の描き込みを抜いた
// 下地（inkBase、静止画の大きさ）も作り、描き込みの演出（§5.7）に使う。失われた建物は前に描いた年と比べて見つけ、二重線で残す。

export type SurveyStatus = "loading" | "ready" | "unavailable";

export interface SurveyCanvas {
  readonly status: SurveyStatus;
  readonly canvas: HTMLCanvasElement | null;
  readonly base: SurveyBase | null;
  readonly version: number;
  /** 直近に描き込んだ時間（ミリ秒） */
  readonly drawMs: number;
  /** saveId を受け取ってから最初の測量図が描けるまで（地形の生成・描画・書体・描き込みの合計） */
  readonly firstReadyMs: number | null;
  /** 描き込みの演出の下地（直近の1年を抜いた測量図、MAP_SNAPSHOT 四方）と、その上に重ねる中身 */
  readonly ink: { readonly base: HTMLCanvasElement; readonly art: SurveyArt } | null;
}

const waitFonts = async (texts: readonly { font: string; text: string }[]) => {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(texts.map(({ font, text }) => document.fonts.load(font, text).catch(() => [])));
};

export const useSurvey = (saveId: string, model: SurveyModel, gazetteer: Gazetteer, hold = false): SurveyCanvas => {
  const [base, setBase] = useState<SurveyBase | null>(null);
  const [status, setStatus] = useState<SurveyStatus>(canvasAvailable() ? "loading" : "unavailable");
  const [version, setVersion] = useState(0);
  const [drawMs, setDrawMs] = useState(0);
  const [firstReadyMs, setFirstReadyMs] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const inkBase = useRef<HTMLCanvasElement | null>(null);
  const [ink, setInk] = useState<SurveyCanvas["ink"]>(null);
  const shown = useRef<{ saveId: string; model: SurveyModel } | null>(null);
  const lost = useRef<readonly LostMark[]>([]);
  const requested = useRef<{ saveId: string; at: number } | null>(null);

  useEffect(() => {
    if (!canvasAvailable()) return;
    let alive = true;
    requested.current = { saveId, at: performance.now() };
    setStatus("loading");
    setFirstReadyMs(null);
    loadSurvey(saveId).then((loaded) => {
      if (!alive) return;
      setBase(loaded);
      setStatus(loaded === null ? "unavailable" : "ready");
    });
    return () => {
      alive = false;
    };
  }, [saveId]);

  // 毎年のレイヤ：中身が変わったときだけ描き直す。書体の読み込みは地形の生成と並べて始める
  const signature = JSON.stringify(model);
  const fonts = useRef<{ key: string; ready: Promise<void> } | null>(null);
  if (canvasAvailable() && fonts.current?.key !== signature) fonts.current = { key: signature, ready: waitFonts(surveyTexts(gazetteer, model)) };
  useEffect(() => {
    if (base === null || base.saveId !== saveId) return;
    // 遷移の途中は前の年のまま（一度も描いていなければ描く）
    if (hold && shown.current?.saveId === saveId) return;
    let alive = true;
    void (fonts.current?.ready ?? Promise.resolve()).then(() => {
      if (!alive) return;
      const started = performance.now();
      if (!canvas.current) {
        canvas.current = document.createElement("canvas");
        canvas.current.width = MAP_PX;
        canvas.current.height = MAP_PX;
      }
      const ctx = canvas.current.getContext("2d") as Ctx2D | null;
      if (!ctx) return;
      // 失われた建物：前に描いた年と比べる（前の年の失われた印は古いインクに）
      const before = shown.current?.saveId === saveId ? shown.current.model : null;
      if (shown.current?.saveId !== saveId) lost.current = [];
      if (before !== null && JSON.stringify(before) !== signature) {
        lost.current = [...lost.current.map((m) => ({ ...m, fresh: false })), ...lostBetween(before, model)];
      }
      shown.current = { saveId, model };
      const art: SurveyArt = { base: base.base, terrain: base.terrain, model, gazetteer, lost: lost.current };
      renderSurvey(ctx, art);
      // 描き込みの演出の下地：直近の1年を抜いて、静止画の大きさで
      if (!inkBase.current) {
        inkBase.current = document.createElement("canvas");
        inkBase.current.width = MAP_SNAPSHOT;
        inkBase.current.height = MAP_SNAPSHOT;
      }
      const ictx = inkBase.current.getContext("2d") as Ctx2D | null;
      if (ictx) {
        ictx.save();
        ictx.setTransform(MAP_SNAPSHOT / MAP_PX, 0, 0, MAP_SNAPSHOT / MAP_PX, 0, 0);
        renderSurvey(ictx, art, { omitFresh: true });
        ictx.restore();
        setInk({ base: inkBase.current, art });
      }
      const done = performance.now();
      setDrawMs(done - started);
      if (requested.current?.saveId === saveId) {
        setFirstReadyMs(done - requested.current.at);
        requested.current = null;
      }
      setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
    // 中身（signature）が同じなら描き直さない（model と gazetteer は signature と saveId で決まる）
  }, [base, signature, saveId, hold]);

  return { status, canvas: canvas.current, base, version, drawMs, firstReadyMs, ink };
};
