import { useCallback, useEffect, useRef, useState } from "react";
import { BEFORE_RESULT, planSequence, type EndingStyle, type PlannedStep, type SequenceStep } from "./TurnSequence";

// ターン遷移シーケンスを時計で進める（SPEC_v3.3 §4.5）。
// 押印 → 執行（submit）→ 勅令用紙を既決箱へ →（結果が届くまで待つ）→ 窓の光 → 地図 → 配達 → 台帳（またはエンディングの演出）→ 終わり。
// クリック・Space で飛ばせる（結果がまだなら、届いたところで最後まで飛ぶ）。表示は step を読む側が行う。

export type SequencePhase = SequenceStep | "waiting";

export interface TurnSequence {
  /** 今の段（動いていなければ null） */
  readonly step: SequencePhase | null;
  /** 今の段の長さ（CSS の動きの長さに使う） */
  readonly stepMs: number;
  /** 直近に終わったシーケンスの合計（押印から終わりまで、実測） */
  readonly lastTotalMs: number | null;
  readonly start: (submit: () => void) => void;
  readonly skip: () => void;
  /** 執行が差し戻されたとき（検証エラー）：止めて受付に戻す */
  readonly cancel: () => void;
}

interface Options {
  readonly reduced: boolean;
  /** 開発用の演出の倍率（?seqscale） */
  readonly scale?: number;
  /** 結果が届いたか（届いた年のエンディングの演出の種類も） */
  readonly result: { readonly ready: boolean; readonly ending: EndingStyle | null };
  /** 段が替わるたび（音を鳴らすなど） */
  readonly onStep?: (step: SequencePhase) => void;
  /** 最後まで進んだ（飛ばした場合も） */
  readonly onDone: () => void;
}

export const useTurnSequence = ({ reduced, scale = 1, result, onStep, onDone }: Options): TurnSequence => {
  const [step, setStep] = useState<SequencePhase | null>(null);
  const [stepMs, setStepMs] = useState(0);
  const [lastTotalMs, setLastTotalMs] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const submitRef = useRef<(() => void) | null>(null);
  const plan = useRef<readonly PlannedStep[]>([]);
  const index = useRef(0);
  const skipping = useRef(false);
  const startedAt = useRef(0);
  const latest = useRef({ result, reduced, scale, onStep, onDone });
  latest.current = { result, reduced, scale, onStep, onDone };

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const finish = useCallback(() => {
    clear();
    plan.current = [];
    skipping.current = false;
    setStep(null);
    setLastTotalMs(performance.now() - startedAt.current);
    latest.current.onDone();
  }, []);

  const submitOnce = () => {
    const submit = submitRef.current;
    submitRef.current = null;
    submit?.();
  };

  const enter = useCallback(
    (i: number) => {
      clear();
      const planned = plan.current[i];
      if (planned === undefined) return finish();
      index.current = i;
      // 押印の後に執行し、勅令用紙を既決箱へ送ったら、結果が届くまで待つ
      if (planned.step === "file") submitOnce();
      if (!BEFORE_RESULT.includes(planned.step) && !latest.current.result.ready) {
        setStep("waiting");
        latest.current.onStep?.("waiting");
        return;
      }
      setStep(planned.step);
      setStepMs(planned.duration);
      latest.current.onStep?.(planned.step);
      timer.current = window.setTimeout(() => enter(i + 1), planned.duration);
    },
    [finish],
  );

  const start = useCallback(
    (submit: () => void) => {
      submitRef.current = submit;
      skipping.current = false;
      startedAt.current = performance.now();
      // エンディングかどうかは結果が届くまで分からないので、ひとまず通常の並びで始め、届いたら組み直す
      plan.current = planSequence({ reduced: latest.current.reduced, ending: null, scale: latest.current.scale });
      enter(0);
    },
    [enter],
  );

  // 結果が届いた：エンディングなら並びを組み直し、待っていたら先へ進む（飛ばしていたら最後まで）
  useEffect(() => {
    if (!result.ready || plan.current.length === 0) return;
    if (result.ending !== null) {
      const current = plan.current[index.current]?.step;
      plan.current = planSequence({ reduced: latest.current.reduced, ending: result.ending, scale: latest.current.scale });
      index.current = Math.max(0, plan.current.findIndex((p) => p.step === current));
    }
    if (skipping.current) return finish();
    if (step === "waiting") enter(index.current);
  }, [result.ready, result.ending, step, enter, finish]);

  const skip = useCallback(() => {
    if (plan.current.length === 0) return;
    submitOnce();
    skipping.current = true;
    if (latest.current.result.ready) finish();
    else {
      clear();
      setStep("waiting");
    }
  }, [finish]);

  const cancel = useCallback(() => {
    clear();
    plan.current = [];
    submitRef.current = null;
    skipping.current = false;
    setStep(null);
  }, []);

  useEffect(() => clear, []);

  return { step, stepMs, lastTotalMs, start, skip, cancel };
};
