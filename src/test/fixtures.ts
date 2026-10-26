// テスト用の共通部品
import { Effect, Layer } from "effect";
import { INITIAL_AIDE_PROFILES, makeAide, type Aide } from "../domain/Aide";
import type { DecreeIntent } from "../domain/DecreeIntent";
import { LLMServiceMock } from "../services/LLMService";
import { LogServiceSilent } from "../services/LogService";
import { RngLive } from "../services/Rng";
import { SaveServiceInMemory } from "../services/SaveService";

const [stewardProfile, merchantProfile] = INITIAL_AIDE_PROFILES;
if (!stewardProfile || !merchantProfile) throw new Error("initial aide profiles are not defined");
export const steward: Aide = makeAide(stewardProfile, 0);
export const merchant: Aide = makeAide(merchantProfile, 0);

export const intentOf = (partial: Partial<DecreeIntent> = {}): DecreeIntent => ({
  action: "build",
  target: "road",
  magnitude: 50,
  budget: 0,
  confidence: 1,
  ...partial,
});

/** LLM 以外のサービス */
export const baseLayer = (seed = 1) => Layer.mergeAll(LogServiceSilent, SaveServiceInMemory, RngLive(seed));

/** 常に同じ DecreeIntent を返す参謀＋その他のサービス */
export const fixedLLMLayer = (intent: Partial<DecreeIntent> = {}, seed = 1) =>
  Layer.merge(LLMServiceMock(() => Effect.succeed(intentOf(intent))), baseLayer(seed));
