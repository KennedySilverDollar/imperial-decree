import { useEffect, useRef, useState } from "react";
import type { Gazetteer } from "../../engine/Gazetteer";
import { MAP_PX } from "./mapConstants";
import type { Ctx2D } from "./pictograms";
import { canvasAvailable, loadSurvey, type SurveyBase } from "./surveyLoader";
import type { SurveyModel } from "./surveyModel";
import { renderSurvey, surveyTexts } from "./SurveyRenderer";

// 測量図を手元に用意する：地形（Worker）を待ち、書体を読み込んでから、毎年のレイヤを Canvas に描き込む。
// 描き終えるたびに version が進む（Phaser のテクスチャと俯瞰の静止画を更新する合図）。

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
}

const waitFonts = async (texts: readonly { font: string; text: string }[]) => {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(texts.map(({ font, text }) => document.fonts.load(font, text).catch(() => [])));
};

export const useSurvey = (saveId: string, model: SurveyModel, gazetteer: Gazetteer): SurveyCanvas => {
  const [base, setBase] = useState<SurveyBase | null>(null);
  const [status, setStatus] = useState<SurveyStatus>(canvasAvailable() ? "loading" : "unavailable");
  const [version, setVersion] = useState(0);
  const [drawMs, setDrawMs] = useState(0);
  const [firstReadyMs, setFirstReadyMs] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
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
      renderSurvey(ctx, { base: base.base, terrain: base.terrain, model, gazetteer });
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
  }, [base, signature, saveId]);

  return { status, canvas: canvas.current, base, version, drawMs, firstReadyMs };
};
