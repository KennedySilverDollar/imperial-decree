import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BUILDING_IDS } from "./Buildings";
import { ADMIN_ACCURACY_MAX, ADMIN_ACCURACY_PER_POINT, POLICY_LEVEL_MAX, SCHOOL_ADMIN_DELAY_TURNS } from "./constants";
import { adminAccuracyBonus, computeDerived, laborForce, type BuildingInstance } from "./DerivedStats";

const buildingArb: fc.Arbitrary<BuildingInstance> = fc.record({
  serial: fc.nat(),
  kind: fc.constantFrom(...BUILDING_IDS),
  builtTurn: fc.integer({ min: 0, max: 60 }),
  hollow: fc.boolean(),
  disclosed: fc.boolean(),
  tile: fc.constant(null),
});

describe("派生指標（v3.2 §2.5 / X-04）", () => {
  it("どんな建物の組合せ・人口・政策でも、すべて0以上（property-based）", () => {
    fc.assert(
      fc.property(
        fc.array(buildingArb, { maxLength: 60 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: -POLICY_LEVEL_MAX, max: POLICY_LEVEL_MAX }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 60 }),
        (buildings, population, securityPolicyLevel, foodFactor, turn) => {
          const d = computeDerived({ population, buildings, securityPolicyLevel, foodFactor, turn });
          for (const value of Object.values(d)) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("空洞の建物は効果を持たない", () => {
    const solid: BuildingInstance = { serial: 1, kind: "well", builtTurn: 0, hollow: false, disclosed: false, tile: null };
    const input = { population: 100, securityPolicyLevel: 0, foodFactor: 1, turn: 10 };
    const a = computeDerived({ ...input, buildings: [solid] });
    const b = computeDerived({ ...input, buildings: [{ ...solid, hollow: true }] });
    expect(a.sanitation).toBeGreaterThan(b.sanitation);
  });

  it("学校は建ってから5年経つまで行政能力にならない", () => {
    const school: BuildingInstance = { serial: 1, kind: "school", builtTurn: 3, hollow: false, disclosed: false, tile: null };
    const input = { population: 100, securityPolicyLevel: 0, foodFactor: 1, buildings: [school] };
    expect(computeDerived({ ...input, turn: 3 + SCHOOL_ADMIN_DELAY_TURNS - 1 }).admin).toBe(0);
    expect(computeDerived({ ...input, turn: 3 + SCHOOL_ADMIN_DELAY_TURNS }).admin).toBeGreaterThan(0);
  });

  it("行政能力は精度に +0.05×admin、上限 +0.15", () => {
    expect(adminAccuracyBonus(0)).toBe(0);
    expect(adminAccuracyBonus(1)).toBeCloseTo(ADMIN_ACCURACY_PER_POINT);
    expect(adminAccuracyBonus(100)).toBe(ADMIN_ACCURACY_MAX);
  });

  it("労働人口は floor(人口×0.5)", () => {
    expect(laborForce(121)).toBe(60);
    expect(laborForce(0)).toBe(0);
  });
});
