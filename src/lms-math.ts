import type { LMSRow } from "./cdc-data.js";

/** [L, M, S] triple from a CDC table row */
export type LMS = [number, number, number];

export function lmsInterpolate(table: LMSRow[], ageMonths: number): LMS {
  if (ageMonths <= table[0][0]) return [table[0][1], table[0][2], table[0][3]];
  if (ageMonths >= table[table.length - 1][0]) {
    const last = table[table.length - 1];
    return [last[1], last[2], last[3]];
  }
  for (let i = 0; i < table.length - 1; i++) {
    if (table[i][0] <= ageMonths && table[i + 1][0] >= ageMonths) {
      const t = (ageMonths - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return [
        table[i][1] + t * (table[i + 1][1] - table[i][1]),
        table[i][2] + t * (table[i + 1][2] - table[i][2]),
        table[i][3] + t * (table[i + 1][3] - table[i][3]),
      ];
    }
  }
  const last = table[table.length - 1];
  return [last[1], last[2], last[3]];
}

export function measurementToZ(v: number, L: number, M: number, S: number): number {
  return Math.abs(L) < 1e-6
    ? Math.log(v / M) / S
    : (Math.pow(v / M, L) - 1) / (L * S);
}

export function zToMeasurement(z: number, L: number, M: number, S: number): number {
  return Math.abs(L) < 1e-6
    ? M * Math.exp(S * z)
    : M * Math.pow(1 + L * S * z, 1 / L);
}

export function zToPercentile(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/**
 * Binary-search for the age (months) at which the percentile curve for targetZ
 * passes through targetValue. Returns null if targetValue is outside the table range.
 */
export function findAgeForMeasurement(
  table: LMSRow[],
  targetValue: number,
  targetZ: number,
): number | null {
  const minAge = table[0][0];
  const maxAge = table[table.length - 1][0];
  const valAt = (am: number) => zToMeasurement(targetZ, ...lmsInterpolate(table, am));

  if (targetValue < valAt(minAge) || targetValue > valAt(maxAge)) return null;

  let lo = minAge, hi = maxAge;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (valAt(mid) < targetValue) lo = mid; else hi = mid;
    if (hi - lo < 0.01) break;
  }
  return (lo + hi) / 2;
}

export function fmtMonths(months: number): string {
  const y = Math.floor(months / 12), m = Math.round(months % 12);
  if (y === 0) return `${m} month${m !== 1 ? "s" : ""}`;
  if (m === 0) return `${y} year${y !== 1 ? "s" : ""}`;
  return `${y}y ${m}mo`;
}

// Parse "YYYY-MM-DD" as local midnight to avoid UTC-offset display issues.
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Age in fractional months between two ISO date strings. */
export function ageMonthsBetween(birthISO: string, dateISO: string): number {
  const b = parseLocalDate(birthISO), d = parseLocalDate(dateISO);
  return (
    (d.getFullYear() - b.getFullYear()) * 12 +
    (d.getMonth()   - b.getMonth()) +
    (d.getDate()    - b.getDate()) / 30.4375
  );
}

/** Calendar date when a child born on birthISO will be ageMonths old. */
export function dateAtAge(birthISO: string, ageMonths: number): Date {
  const b = parseLocalDate(birthISO);
  const whole = Math.floor(ageMonths);
  const days  = Math.round((ageMonths - whole) * 30.4375);
  // Date constructor normalises month/day overflow automatically.
  return new Date(b.getFullYear(), b.getMonth() + whole, b.getDate() + days);
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Weight halves every HALF_LIFE_MONTHS. At 6 months a measurement is worth 50%
// of a fresh one; at 12 months, 25%. This keeps recent data dominant while
// still letting a cluster of older measurements collectively reduce noise.
const HALF_LIFE_MONTHS = 6;
const DECAY_RATE = Math.log(2) / HALF_LIFE_MONTHS;

/**
 * Exponentially recency-weighted average of z-scores.
 * Weights are relative to the most recent entry (which always gets weight 1).
 * Returns null when the input is empty.
 */
export function weightedZAvg(entries: { z: number; ageMonths: number }[]): number | null {
  if (entries.length === 0) return null;
  const maxAge = Math.max(...entries.map(e => e.ageMonths));
  let weightedSum = 0, totalWeight = 0;
  for (const { z, ageMonths } of entries) {
    const w = Math.exp(-DECAY_RATE * (maxAge - ageMonths));
    weightedSum += z * w;
    totalWeight += w;
  }
  return weightedSum / totalWeight;
}

/**
 * Exponentially recency-weighted standard deviation of z-scores.
 * Requires 2+ entries; returns null otherwise.
 */
export function weightedZSD(
  entries: { z: number; ageMonths: number }[],
  mean: number,
): number | null {
  if (entries.length < 2) return null;
  const maxAge = Math.max(...entries.map(e => e.ageMonths));
  let totalWeight = 0, weightedSumSq = 0;
  for (const { z, ageMonths } of entries) {
    const w = Math.exp(-DECAY_RATE * (maxAge - ageMonths));
    weightedSumSq += w * (z - mean) ** 2;
    totalWeight += w;
  }
  return Math.sqrt(weightedSumSq / totalWeight);
}

export const PCTS = [
  { z: -1.881, label: "3rd" },
  { z: -1.282, label: "10th" },
  { z: -0.674, label: "25th" },
  { z:  0,     label: "50th" },
  { z:  0.674, label: "75th" },
  { z:  1.282, label: "90th" },
  { z:  1.881, label: "97th" },
] as const;
