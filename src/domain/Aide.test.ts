import { describe, expect, it } from "vitest";
import { computeAccuracy, INITIAL_AIDE_PROFILES, isFactionConflict, isSpecialtyMatch, makeAide, selectAide, type Aide } from "./Aide";

const [stewardProfile, merchantProfile] = INITIAL_AIDE_PROFILES;
if (!stewardProfile || !merchantProfile) throw new Error("初期側近が定義されていない");
const steward = makeAide(stewardProfile, 0);
const merchant = makeAide(merchantProfile, 0);

describe("初期側近（SPEC §7.5）", () => {
  it("A: 老練な代官 / B: 若い商人上がり", () => {
    expect(steward).toMatchObject({ loyalty: 80, ability: 60, ambition: 30, faction: "development", specialty: "infrastructure", trust: 70 });
    expect(merchant).toMatchObject({ loyalty: 60, ability: 75, ambition: 70, faction: "commerce", specialty: "economy", trust: 50 });
  });
});

describe("accuracy 式（SPEC §7.6 / A-04）", () => {
  it("初期の代官がインフラを担当すると 0.9（信頼70で >= ボーナスが効く）", () => {
    expect(computeAccuracy(steward, true, false)).toBeCloseTo(0.9);
  });
  it("代官が専門外なら 0.7", () => {
    expect(computeAccuracy(steward, false, false)).toBeCloseTo(0.7);
  });
  it("商人が経済系なら 0.875", () => {
    expect(computeAccuracy(merchant, true, false)).toBeCloseTo(0.875);
  });
  it("商人が増税（派閥対立・野心70で >= ペナルティが効く）なら 0.675", () => {
    expect(computeAccuracy(merchant, true, true)).toBeCloseTo(0.675);
  });
  it("信頼69ならボーナスなし、野心69ならペナルティなし", () => {
    expect(computeAccuracy({ ...steward, trust: 69 }, true, false)).toBeCloseTo(0.8);
    expect(computeAccuracy({ ...merchant, ambition: 69 }, true, true)).toBeCloseTo(0.875);
  });
  it("0〜1 に clamp される", () => {
    const genius: Aide = { ...steward, ability: 100, trust: 100 };
    expect(computeAccuracy(genius, true, false)).toBe(1);
    const fool: Aide = { ...merchant, ability: 0, ambition: 100, trust: 0 };
    expect(computeAccuracy(fool, false, true)).toBeCloseTo(0.1);
  });
});

describe("専門一致と派閥対立", () => {
  it("action=tax は経済の専門に一致する", () => {
    expect(isSpecialtyMatch(merchant, "tax", "road")).toBe(true);
    expect(isSpecialtyMatch(steward, "build", "road")).toBe(true);
    expect(isSpecialtyMatch(steward, "invest", "welfare")).toBe(false);
  });
  it("商業派は増税と治安に対立、開発派は縮小に対立", () => {
    expect(isFactionConflict(merchant, "tax", "tax", 30)).toBe(true);
    expect(isFactionConflict(merchant, "tax", "tax", -30)).toBe(false);
    expect(isFactionConflict(merchant, "reform", "security", 30)).toBe(true);
    expect(isFactionConflict(steward, "tax", "tax", -30)).toBe(true);
    expect(isFactionConflict(steward, "build", "road", 30)).toBe(false);
  });
});

describe("担当側近の自動選択（A-05）", () => {
  it("専門一致を優先する", () => {
    expect(selectAide([steward, merchant], "build", "road")).toEqual({ aide: steward, reason: "specialty" });
    expect(selectAide([steward, merchant], "tax", "tax")).toEqual({ aide: merchant, reason: "specialty" });
  });
  it("誰も一致しなければ信頼の高い方", () => {
    expect(selectAide([merchant, steward], "invest", "welfare")).toEqual({ aide: steward, reason: "offSpecialty" });
  });
  it("複数一致すれば信頼順（市場はインフラ・経済の両方に一致）", () => {
    expect(selectAide([merchant, steward], "build", "market")).toEqual({ aide: steward, reason: "trust" });
  });
  it("同点なら在任が長い方", () => {
    const newcomer = { ...steward, id: "x", appointedTurn: 5 };
    expect(selectAide([newcomer, steward], "build", "road")?.aide).toBe(steward);
  });
  it("側近がいなければ null", () => {
    expect(selectAide([], "build", "road")).toBeNull();
  });
});
