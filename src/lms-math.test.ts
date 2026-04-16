import { describe, it, expect } from "vitest";
import { CDC } from "./cdc-data.js";
import {
  lmsInterpolate, measurementToZ, zToMeasurement,
  zToPercentile, findAgeForMeasurement, fmtMonths,
  ageMonthsBetween, dateAtAge, fmtDate, weightedZAvg, weightedZSD,
} from "./lms-math.js";

describe("lmsInterpolate", () => {
  const table = CDC.boys.height;

  it("clamps to first row for age before table start", () => {
    const [, M] = lmsInterpolate(table, -5);
    expect(M).toBeCloseTo(49.8842);
  });

  it("clamps to last row for age past table end", () => {
    const [, M] = lmsInterpolate(table, 999);
    expect(M).toBeCloseTo(172.2);
  });

  it("returns exact values at a table entry", () => {
    const [L, M, S] = lmsInterpolate(table, 0);
    expect(L).toBeCloseTo(1);
    expect(M).toBeCloseTo(49.8842);
    expect(S).toBeCloseTo(0.03795);
  });

  it("interpolates linearly between adjacent entries", () => {
    // Between age 0 (M=49.8842) and age 1 (M=54.7244), midpoint t=0.5
    const [, M] = lmsInterpolate(table, 0.5);
    expect(M).toBeCloseTo((49.8842 + 54.7244) / 2);
  });
});

describe("measurementToZ / zToMeasurement", () => {
  it("z-score is 0 when v equals M (non-zero L)", () => {
    expect(measurementToZ(10, 1, 10, 0.15)).toBeCloseTo(0);
  });

  it("z-score is 0 when v equals M (near-zero L)", () => {
    expect(measurementToZ(10, 0, 10, 0.15)).toBeCloseTo(0);
  });

  it("round-trips with non-zero L", () => {
    const [L, M, S] = [1.5, 15.0, 0.12];
    const v = 17.5;
    expect(zToMeasurement(measurementToZ(v, L, M, S), L, M, S)).toBeCloseTo(v, 5);
  });

  it("round-trips with near-zero L", () => {
    const [L, M, S] = [0, 20.0, 0.15];
    const v = 22.0;
    expect(zToMeasurement(measurementToZ(v, L, M, S), L, M, S)).toBeCloseTo(v, 5);
  });
});

describe("zToPercentile", () => {
  it("z=0 yields 50th percentile", () => {
    expect(zToPercentile(0)).toBeCloseTo(0.5);
  });

  it("is symmetric: p(z) + p(-z) = 1", () => {
    expect(zToPercentile(1) + zToPercentile(-1)).toBeCloseTo(1);
    expect(zToPercentile(2) + zToPercentile(-2)).toBeCloseTo(1);
  });

  it("z=1.645 yields ~95th percentile", () => {
    expect(zToPercentile(1.645)).toBeCloseTo(0.95, 2);
  });
});

describe("findAgeForMeasurement", () => {
  const table = CDC.boys.height;

  it("finds age ~0 for the 50th-pct newborn height", () => {
    // Median at birth is 49.8842; looking up z=0 should return ageMonths ≈ 0
    const ageM = findAgeForMeasurement(table, 49.8842, 0);
    expect(ageM).not.toBeNull();
    expect(ageM!).toBeCloseTo(0, 0);
  });

  it("returns null for value below the minimum range", () => {
    expect(findAgeForMeasurement(table, 1, 0)).toBeNull();
  });

  it("returns null for value above the maximum range", () => {
    expect(findAgeForMeasurement(table, 999, 0)).toBeNull();
  });

  it("round-trips: value at computed age matches the target", () => {
    // At 60 months, 50th pct height for boys is 111.162 cm
    const targetValue = 111.162;
    const ageM = findAgeForMeasurement(table, targetValue, 0);
    expect(ageM).not.toBeNull();
    const [L, M, S] = lmsInterpolate(table, ageM!);
    expect(zToMeasurement(0, L, M, S)).toBeCloseTo(targetValue, 1);
  });
});

describe("ageMonthsBetween", () => {
  it("same date is 0 months", () => {
    expect(ageMonthsBetween("2020-01-01", "2020-01-01")).toBeCloseTo(0);
  });

  it("exactly one year apart is ~12 months", () => {
    expect(ageMonthsBetween("2020-03-15", "2021-03-15")).toBeCloseTo(12);
  });

  it("one month apart is ~1 month", () => {
    expect(ageMonthsBetween("2020-01-15", "2020-02-15")).toBeCloseTo(1);
  });

  it("returns negative for dates before birthday", () => {
    expect(ageMonthsBetween("2020-06-01", "2020-01-01")).toBeLessThan(0);
  });
});

describe("dateAtAge", () => {
  it("0 months returns the birthday", () => {
    const d = dateAtAge("2020-03-15", 0);
    expect(d.getFullYear()).toBe(2020);
    expect(d.getMonth()).toBe(2); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  it("12 months returns approximately one year later", () => {
    const d = dateAtAge("2020-03-15", 12);
    expect(d.getFullYear()).toBe(2021);
    expect(d.getMonth()).toBe(2);
  });

  it("round-trips with ageMonthsBetween", () => {
    const birth = "2019-07-04";
    const months = 27.5;
    const d = dateAtAge(birth, months);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(ageMonthsBetween(birth, iso)).toBeCloseTo(months, 0);
  });
});

describe("weightedZAvg", () => {
  it("returns null for empty input", () => {
    expect(weightedZAvg([])).toBeNull();
  });

  it("returns the single value unchanged", () => {
    expect(weightedZAvg([{ z: 1.5, ageMonths: 24 }])).toBeCloseTo(1.5);
  });

  it("result is closer to the more recent entry", () => {
    // old=-2, recent=+2; result should be positive (pulled toward recent)
    const result = weightedZAvg([
      { z: -2, ageMonths: 0  },
      { z:  2, ageMonths: 36 },
    ]);
    expect(result!).toBeGreaterThan(0);
  });

  it("equal-age entries produce a plain average", () => {
    const result = weightedZAvg([
      { z: 1.0, ageMonths: 12 },
      { z: 2.0, ageMonths: 12 },
      { z: 3.0, ageMonths: 12 },
    ]);
    expect(result!).toBeCloseTo(2.0);
  });

  it("entry 6 months older gets roughly half the weight", () => {
    // z=0 at 12mo, z=1 at 18mo (6 months newer = half-life apart)
    // weightedAvg ≈ (0 * 0.5 + 1 * 1.0) / 1.5 ≈ 0.667
    const result = weightedZAvg([
      { z: 0, ageMonths: 12 },
      { z: 1, ageMonths: 18 },
    ]);
    expect(result!).toBeCloseTo(2 / 3, 2);
  });
});

describe("weightedZSD", () => {
  it("returns null for empty input", () => {
    expect(weightedZSD([], 0)).toBeNull();
  });

  it("returns null for a single entry", () => {
    expect(weightedZSD([{ z: 1.5, ageMonths: 12 }], 1.5)).toBeNull();
  });

  it("equal-age entries yield unweighted SD", () => {
    // Values 1, 2, 3 → mean 2, variance = (1+0+1)/3, SD = sqrt(2/3)
    const entries = [
      { z: 1, ageMonths: 12 },
      { z: 2, ageMonths: 12 },
      { z: 3, ageMonths: 12 },
    ];
    expect(weightedZSD(entries, 2)).toBeCloseTo(Math.sqrt(2 / 3), 5);
  });

  it("older entries contribute less to SD", () => {
    // Identical z-values 6 months apart: old entry gets half weight.
    // Both are distance 1 from mean=0, but old counts half as much.
    // Weighted variance = (0.5*1 + 1.0*1) / 1.5 = 1.0; SD = 1.0
    const entries = [
      { z: -1, ageMonths: 12 },
      { z:  1, ageMonths: 18 },
    ];
    expect(weightedZSD(entries, 0)).toBeCloseTo(1.0, 3);
  });
});

describe("fmtDate", () => {
  it("formats a date in readable US format", () => {
    const d = new Date(2025, 2, 15); // Mar 15, 2025 (local)
    expect(fmtDate(d)).toBe("Mar 15, 2025");
  });
});

describe("fmtMonths", () => {
  it.each([
    [0,    "0 months"],
    [1,    "1 month"],
    [2,    "2 months"],
    [12,   "1y"],
    [24,   "2y"],
    [13,   "1y 1mo"],
    [25,   "2y 1mo"],
    [47.9, "4y"],  // rounds up to 12mo → normalises to next year
  ])("fmtMonths(%i) → %s", (months, expected) => {
    expect(fmtMonths(months)).toBe(expected);
  });
});
