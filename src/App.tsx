import { useState, useMemo, useEffect } from "react";
import { CDC } from "./cdc-data.js";
import {
  lmsInterpolate, measurementToZ, zToMeasurement, zToPercentile,
  findAgeForMeasurement, fmtMonths, fmtDate, ageMonthsBetween, dateAtAge, weightedZAvg, weightedZSD, PCTS,
} from "./lms-math.js";
import { loadData, saveData, type Measurement, type StoredData } from "./storage.js";

type Sex = "boys" | "girls";
type Unit = "metric" | "imperial";
type QueryMode = "age" | "height" | "weight";
type SaveStatus = "error" | null;

const cmToIn = (v: number) => (v / 2.54).toFixed(1);
const inToCm = (v: number) => v * 2.54;
const kgToLb = (v: number) => (v * 2.20462).toFixed(1);
const lbToKg = (v: number) => v / 2.20462;

// Convert a stored metric string to the current display unit.
// Strips trailing ".0" so inputs don't show unnecessary decimals.
const fmt = (n: number, decimals: number) => String(parseFloat(n.toFixed(decimals)));
const toDisplayH = (storedCm: string, unit: Unit) => {
  const n = parseFloat(storedCm);
  return isNaN(n) ? storedCm : unit === "imperial" ? fmt(n / 2.54, 1) : storedCm;
};
const toDisplayW = (storedKg: string, unit: Unit) => {
  const n = parseFloat(storedKg);
  return isNaN(n) ? storedKg : unit === "imperial" ? fmt(n * 2.20462, 1) : storedKg;
};

const EMPTY_MEASUREMENT: Measurement = { date: "", height: "", weight: "" };

const inputCls = "border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-full";
const btnCls = "px-4 py-2 rounded-lg text-sm font-medium transition-colors";

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [birthday, setBirthday] = useState("");
  const [sex, setSex] = useState<Sex>("boys");
  const [measurements, setMeasurements] = useState<Measurement[]>([{ ...EMPTY_MEASUREMENT }]);
  const [unit, setUnit] = useState<Unit>("metric");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(null);
  const [queryMode, setQueryMode] = useState<QueryMode>("age");
  const [queryAge, setQueryAge] = useState("");
  const [queryHeight, setQueryHeight] = useState("");
  const [queryWeight, setQueryWeight] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await loadData();
        if (d) {
          if (d.birthday)           setBirthday(d.birthday);
          if (d.sex)                setSex(d.sex as Sex);
          if (d.unit)               setUnit(d.unit as Unit);
          if (d.measurements?.length) setMeasurements(d.measurements);
          if (d.queryAge)           setQueryAge(d.queryAge);
          if (d.queryHeight)        setQueryHeight(d.queryHeight);
          if (d.queryWeight)        setQueryWeight(d.queryWeight);
          if (d.queryMode)          setQueryMode(d.queryMode as QueryMode);
        }
      } catch { /* ignore */ }
      finally { setLoaded(true); }
    })();
  }, []);

  const persist = async (updates: Partial<StoredData> = {}) => {
    try {
      await saveData({ birthday, sex, unit, measurements, queryAge, queryHeight, queryWeight, queryMode, ...updates });
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const handleBirthday    = (val: string)    => { setBirthday(val);      persist({ birthday: val }); };
  const handleSex         = (val: Sex)       => { setSex(val);           persist({ sex: val }); };
  const handleUnit        = (val: Unit)      => { setUnit(val);          persist({ unit: val }); };
  const handleQueryMode   = (val: QueryMode) => { setQueryMode(val);     persist({ queryMode: val }); };
  const handleQueryAge    = (val: string)    => { setQueryAge(val);      persist({ queryAge: val }); };
  const handleQueryHeight = (val: string)    => { setQueryHeight(val);   persist({ queryHeight: val }); };
  const handleQueryWeight = (val: string)    => { setQueryWeight(val);   persist({ queryWeight: val }); };

  const addRow = () => {
    const m = [...measurements, { ...EMPTY_MEASUREMENT }];
    setMeasurements(m); persist({ measurements: m });
  };
  const updateRow = (i: number, field: keyof Measurement, val: string) => {
    let stored = val;
    const n = parseFloat(val);
    if (!isNaN(n)) {
      if (field === "height" && unit === "imperial") stored = String(inToCm(n));
      if (field === "weight" && unit === "imperial") stored = String(lbToKg(n));
    }
    const m = [...measurements]; m[i] = { ...m[i], [field]: stored };
    setMeasurements(m); persist({ measurements: m });
  };
  const removeRow = (i: number) => {
    const m = measurements.filter((_, idx) => idx !== i);
    setMeasurements(m); persist({ measurements: m });
  };

  // Age is derived from birthday + measurement date. Height and weight are kept
  // independently nullable so a measurement with only one is still useful.
  const metricM = useMemo(() => {
    if (!birthday) return [];
    return measurements.flatMap(m => {
      if (!m.date) return [];
      const ageMonths = ageMonthsBetween(birthday, m.date);
      if (ageMonths < 0) return [];
      const height = parseFloat(m.height);
      const weight = parseFloat(m.weight);
      const h = isNaN(height) ? null : height;
      const w = isNaN(weight) ? null : weight;
      if (h === null && w === null) return [];
      return [{ ageMonths, height: h, weight: w, date: m.date }];
    });
  }, [measurements, birthday]);

  const zScores = useMemo(() => metricM.map(m => {
    const hZ = m.height !== null ? measurementToZ(m.height, ...lmsInterpolate(CDC[sex].height, m.ageMonths)) : null;
    const wZ = m.weight !== null ? measurementToZ(m.weight, ...lmsInterpolate(CDC[sex].weight, m.ageMonths)) : null;
    return {
      date: m.date,
      ageMonths: m.ageMonths,
      hZ, wZ,
      hPct: hZ !== null ? (zToPercentile(hZ) * 100).toFixed(1) : null,
      wPct: wZ !== null ? (zToPercentile(wZ) * 100).toFixed(1) : null,
    };
  }), [metricM, sex]);

  const hEntries = zScores.flatMap(z => z.hZ !== null ? [{ z: z.hZ, ageMonths: z.ageMonths }] : []);
  const wEntries = zScores.flatMap(z => z.wZ !== null ? [{ z: z.wZ, ageMonths: z.ageMonths }] : []);
  const avgHZ = weightedZAvg(hEntries);
  const avgWZ = weightedZAvg(wEntries);
  const sdHZ  = avgHZ !== null ? weightedZSD(hEntries, avgHZ) : null;
  const sdWZ  = avgWZ !== null ? weightedZSD(wEntries, avgWZ) : null;

  const fmtH = (cm: number) => unit === "imperial" ? `${cmToIn(cm)}"` : `${cm.toFixed(1)} cm`;
  const fmtW = (kg: number) => unit === "imperial" ? `${kgToLb(kg)} lb` : `${kg.toFixed(1)} kg`;

  const birthdayProjections = useMemo(() => {
    if (!birthday || (avgHZ === null && avgWZ === null)) return null;
    const today = new Date();
    const hTable = CDC[sex].height, wTable = CDC[sex].weight;
    const maxAge = Math.max(hTable[hTable.length - 1][0], wTable[wTable.length - 1][0]);
    const rows = [];
    for (let year = 1; year * 12 <= maxAge; year++) {
      const ageMonths = year * 12;
      const date = dateAtAge(birthday, ageMonths);
      if (date <= today) continue;
      const hLMS = lmsInterpolate(hTable, ageMonths);
      const wLMS = lmsInterpolate(wTable, ageMonths);
      const estH = avgHZ !== null ? zToMeasurement(avgHZ, ...hLMS) : null;
      const estW = avgWZ !== null ? zToMeasurement(avgWZ, ...wLMS) : null;
      const hUncert = estH !== null && sdHZ !== null
        ? (zToMeasurement(avgHZ! + sdHZ, ...hLMS) - zToMeasurement(avgHZ! - sdHZ, ...hLMS)) / 2
        : null;
      const wUncert = estW !== null && sdWZ !== null
        ? (zToMeasurement(avgWZ! + sdWZ, ...wLMS) - zToMeasurement(avgWZ! - sdWZ, ...wLMS)) / 2
        : null;
      rows.push({ year, date, estH, estW, hUncert, wUncert });
    }
    return rows.length > 0 ? rows : null;
  }, [birthday, sex, avgHZ, avgWZ, sdHZ, sdWZ]);

  const ageProjection = useMemo(() => {
    if (queryMode !== "age") return null;
    const qa = parseFloat(queryAge);
    if (isNaN(qa)) return null;
    const am = qa * 12;
    const hLMS = lmsInterpolate(CDC[sex].height, am);
    const wLMS = lmsInterpolate(CDC[sex].weight, am);
    const rows = PCTS.map(({ z, label }) => ({
      label,
      h: unit === "imperial" ? `${cmToIn(zToMeasurement(z, ...hLMS))}"` : `${zToMeasurement(z, ...hLMS).toFixed(1)} cm`,
      w: unit === "imperial" ? `${kgToLb(zToMeasurement(z, ...wLMS))} lb` : `${zToMeasurement(z, ...wLMS).toFixed(1)} kg`,
    }));
    let childRow = null;
    if (avgHZ !== null && avgWZ !== null) {
      const estH = zToMeasurement(avgHZ, ...hLMS), estW = zToMeasurement(avgWZ, ...wLMS);
      // ±1 weighted SD in z-space, converted to measurement half-width
      const hUncert = sdHZ !== null
        ? (zToMeasurement(avgHZ + sdHZ, ...hLMS) - zToMeasurement(avgHZ - sdHZ, ...hLMS)) / 2
        : null;
      const wUncert = sdWZ !== null
        ? (zToMeasurement(avgWZ + sdWZ, ...wLMS) - zToMeasurement(avgWZ - sdWZ, ...wLMS)) / 2
        : null;
      childRow = {
        estH: fmtH(estH),
        estW: fmtW(estW),
        estHUncert: hUncert !== null ? fmtH(hUncert) : null,
        estWUncert: wUncert !== null ? fmtW(wUncert) : null,
        hPct: (zToPercentile(avgHZ) * 100).toFixed(1),
        wPct: (zToPercentile(avgWZ) * 100).toFixed(1),
      };
    }
    const queryDate = birthday ? fmtDate(dateAtAge(birthday, am)) : null;
    return { rows, childRow, queryDate };
  }, [queryMode, queryAge, sex, avgHZ, avgWZ, sdHZ, sdWZ, unit, birthday]);

  const heightProjection = useMemo(() => {
    if (queryMode !== "height") return null;
    const hCm = parseFloat(queryHeight);
    if (isNaN(hCm)) return null;
    const rows = PCTS.map(({ z, label }) => {
      const ageM = findAgeForMeasurement(CDC[sex].height, hCm, z);
      return {
        label,
        age:  ageM === null ? null : fmtMonths(ageM),
        date: ageM !== null && birthday ? fmtDate(dateAtAge(birthday, ageM)) : null,
      };
    });
    const childRow = avgHZ !== null ? (() => {
      const ageM     = findAgeForMeasurement(CDC[sex].height, hCm, avgHZ);
      const ageEarly = sdHZ !== null ? findAgeForMeasurement(CDC[sex].height, hCm, avgHZ + sdHZ) : null;
      const ageLate  = sdHZ !== null ? findAgeForMeasurement(CDC[sex].height, hCm, avgHZ - sdHZ) : null;
      return {
        age:       ageM     === null ? "outside chart range" : fmtMonths(ageM),
        ageEarly:  ageEarly !== null ? fmtMonths(ageEarly) : null,
        ageLate:   ageLate  !== null ? fmtMonths(ageLate)  : null,
        date:      ageM     !== null && birthday ? fmtDate(dateAtAge(birthday, ageM))     : null,
        dateEarly: ageEarly !== null && birthday ? fmtDate(dateAtAge(birthday, ageEarly)) : null,
        dateLate:  ageLate  !== null && birthday ? fmtDate(dateAtAge(birthday, ageLate))  : null,
      };
    })() : null;
    return { rows, childRow };
  }, [queryMode, queryHeight, sex, avgHZ, sdHZ, birthday]);

  const weightProjection = useMemo(() => {
    if (queryMode !== "weight") return null;
    const wKg = parseFloat(queryWeight);
    if (isNaN(wKg)) return null;
    const rows = PCTS.map(({ z, label }) => {
      const ageM = findAgeForMeasurement(CDC[sex].weight, wKg, z);
      return {
        label,
        age:  ageM === null ? null : fmtMonths(ageM),
        date: ageM !== null && birthday ? fmtDate(dateAtAge(birthday, ageM)) : null,
      };
    });
    const childRow = avgWZ !== null ? (() => {
      const ageM     = findAgeForMeasurement(CDC[sex].weight, wKg, avgWZ);
      const ageEarly = sdWZ !== null ? findAgeForMeasurement(CDC[sex].weight, wKg, avgWZ + sdWZ) : null;
      const ageLate  = sdWZ !== null ? findAgeForMeasurement(CDC[sex].weight, wKg, avgWZ - sdWZ) : null;
      return {
        age:       ageM     === null ? "outside chart range" : fmtMonths(ageM),
        ageEarly:  ageEarly !== null ? fmtMonths(ageEarly) : null,
        ageLate:   ageLate  !== null ? fmtMonths(ageLate)  : null,
        date:      ageM     !== null && birthday ? fmtDate(dateAtAge(birthday, ageM))     : null,
        dateEarly: ageEarly !== null && birthday ? fmtDate(dateAtAge(birthday, ageEarly)) : null,
        dateLate:  ageLate  !== null && birthday ? fmtDate(dateAtAge(birthday, ageLate))  : null,
      };
    })() : null;
    return { rows, childRow };
  }, [queryMode, queryWeight, sex, avgWZ, sdWZ, birthday]);

  if (!loaded) return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center">
      <p className="text-indigo-400 text-sm">Loading saved data…</p>
    </div>
  );

  const hUnit = unit === "imperial" ? "in" : "cm";
  const wUnit = unit === "imperial" ? "lb" : "kg";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-2xl mx-auto space-y-5">

        <div className="text-center pt-4">
          <h1 className="text-2xl font-bold text-indigo-800">Child Growth Tracker</h1>

          {saveStatus === "error" && (
            <p className="text-xs mt-1 text-red-400">⚠ Save failed</p>
          )}
        </div>

        {/* Settings */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Settings</h2>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Birthday</label>
            <input className={inputCls} type="date" value={birthday}
              onChange={e => handleBirthday(e.target.value)} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Sex</label>
              <div className="flex gap-2">
                {(["boys", "girls"] as Sex[]).map(s => (
                  <button key={s} onClick={() => handleSex(s)}
                    className={`${btnCls} flex-1 ${sex === s ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {s === "boys" ? "Boy" : "Girl"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Units</label>
              <div className="flex gap-2">
                {([["metric", "cm / kg"], ["imperial", "in / lb"]] as [Unit, string][]).map(([u, l]) => (
                  <button key={u} onClick={() => handleUnit(u)}
                    className={`${btnCls} flex-1 ${unit === u ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Measurements */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-gray-700">Measurements</h2>
          <div className="grid grid-cols-3 gap-2 text-xs text-gray-400 font-medium px-1">
            <span>Date</span><span>Weight ({wUnit})</span><span>Height ({hUnit})</span>
          </div>
          {measurements.map((m, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 items-start">
              <div>
                <input className={inputCls} type="date" value={m.date}
                  onChange={e => updateRow(i, "date", e.target.value)} />
                {birthday && m.date && (
                  <p className="text-xs text-gray-400 mt-1 px-1">
                    {fmtMonths(ageMonthsBetween(birthday, m.date))}
                  </p>
                )}
              </div>
              <input className={inputCls} type="number" placeholder={unit === "imperial" ? "e.g. 35" : "e.g. 16"}
                value={toDisplayW(m.weight, unit)} onChange={e => updateRow(i, "weight", e.target.value)} />
              <div className="flex gap-1">
                <input className={inputCls} type="number" placeholder={unit === "imperial" ? "e.g. 39" : "e.g. 99"}
                  value={toDisplayH(m.height, unit)} onChange={e => updateRow(i, "height", e.target.value)} />
                {measurements.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 px-1 text-lg leading-none mt-2">×</button>
                )}
              </div>
            </div>
          ))}
          <button onClick={addRow} className={`${btnCls} bg-indigo-50 text-indigo-600 hover:bg-indigo-100 w-full mt-1`}>
            + Add measurement
          </button>
        </div>

        {/* Percentiles summary */}
        {zScores.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Estimated Percentiles from Your Data</h2>
            <div className="space-y-2">
              {zScores.map((z, i) => (
                <div key={i} className="text-sm grid grid-cols-3 gap-2 text-gray-600 items-center">
                  <div>
                    <div className="font-medium">{fmtDate(dateAtAge(birthday, z.ageMonths))}</div>
                    <div className="text-xs text-gray-400">{fmtMonths(z.ageMonths)}</div>
                  </div>
                  <span>Weight: {z.wPct !== null ? <span className="text-indigo-600 font-semibold">{z.wPct}th pct</span> : <span className="text-gray-300">—</span>}</span>
                  <span>Height: {z.hPct !== null ? <span className="text-indigo-600 font-semibold">{z.hPct}th pct</span> : <span className="text-gray-300">—</span>}</span>
                </div>
              ))}
              {zScores.length > 1 && (avgHZ !== null || avgWZ !== null) && (
                <div className="text-sm grid grid-cols-3 gap-2 text-gray-600 border-t pt-2 mt-1">
                  <span className="font-medium">Weighted avg</span>
                  <span>Weight: {avgWZ !== null ? <span className="text-indigo-700 font-bold">{(zToPercentile(avgWZ) * 100).toFixed(1)}th pct</span> : <span className="text-gray-300">—</span>}</span>
                  <span>Height: {avgHZ !== null ? <span className="text-indigo-700 font-bold">{(zToPercentile(avgHZ) * 100).toFixed(1)}th pct</span> : <span className="text-gray-300">—</span>}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Query panel */}
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Lookup</h2>

          <div className="flex gap-2">
            {([["age", "By Age → Weight/Height"], ["weight", "By Weight → Age"], ["height", "By Height → Age"]] as [QueryMode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => handleQueryMode(m)}
                className={`${btnCls} flex-1 text-xs ${queryMode === m ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {l}
              </button>
            ))}
          </div>

          {queryMode === "age" && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Age (years)</label>
              <input className={inputCls} type="number" placeholder="e.g. 5" value={queryAge}
                onChange={e => handleQueryAge(e.target.value)} />
            </div>
          )}
          {queryMode === "weight" && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Weight ({wUnit})</label>
              <input className={inputCls} type="number" placeholder={unit === "imperial" ? "e.g. 40" : "e.g. 18"}
                value={toDisplayW(queryWeight, unit)}
                onChange={e => {
                  const n = parseFloat(e.target.value);
                  handleQueryWeight(!isNaN(n) && unit === "imperial" ? String(lbToKg(n)) : e.target.value);
                }} />
            </div>
          )}
          {queryMode === "height" && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Height ({hUnit})</label>
              <input className={inputCls} type="number" placeholder={unit === "imperial" ? "e.g. 45" : "e.g. 114"}
                value={toDisplayH(queryHeight, unit)}
                onChange={e => {
                  const n = parseFloat(e.target.value);
                  handleQueryHeight(!isNaN(n) && unit === "imperial" ? String(inToCm(n)) : e.target.value);
                }} />
            </div>
          )}

          {ageProjection && (
            <div className="space-y-3">
              {ageProjection.childRow && (
                <div className="bg-indigo-50 rounded-xl p-4">
                  <p className="text-sm font-semibold text-indigo-800 mb-1">
                    Your child's estimated values at age {queryAge}y
                    {ageProjection.queryDate && (
                      <span className="font-normal text-indigo-500"> · {ageProjection.queryDate}</span>
                    )}
                  </p>
                  <div className="flex gap-6 text-sm text-indigo-700">
                    <span>Weight: <strong>{ageProjection.childRow.estW}</strong>{ageProjection.childRow.estWUncert && <> ± {ageProjection.childRow.estWUncert}</>} ({ageProjection.childRow.wPct}th pct)</span>
                    <span>Height: <strong>{ageProjection.childRow.estH}</strong>{ageProjection.childRow.estHUncert && <> ± {ageProjection.childRow.estHUncert}</>} ({ageProjection.childRow.hPct}th pct)</span>
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">
                  CDC population ranges at age {queryAge}y
                  {ageProjection.queryDate && ` (${ageProjection.queryDate})`}
                </p>
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr><th className="text-left py-2 px-3">Percentile</th><th className="text-left py-2 px-3">Weight</th><th className="text-left py-2 px-3">Height</th></tr>
                    </thead>
                    <tbody>
                      {ageProjection.rows.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          <td className="py-2 px-3 font-medium text-gray-600">{r.label}</td>
                          <td className="py-2 px-3 text-gray-700">{r.w}</td>
                          <td className="py-2 px-3 text-gray-700">{r.h}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {weightProjection && (
            <div className="space-y-3">
              {weightProjection.childRow && (
                <div className="bg-indigo-50 rounded-xl p-4">
                  <p className="text-sm font-semibold text-indigo-800 mb-1">Your child's estimated age to reach {toDisplayW(queryWeight, unit)} {wUnit}</p>
                  <p className="text-sm text-indigo-700">
                    Expected around: <strong>{weightProjection.childRow.age}</strong>
                    {weightProjection.childRow.date && <span className="text-indigo-500"> ({weightProjection.childRow.date})</span>}
                  </p>
                  {weightProjection.childRow.ageEarly && weightProjection.childRow.ageLate && (
                    <p className="text-xs text-indigo-400 mt-1">
                      Range: {weightProjection.childRow.ageEarly} – {weightProjection.childRow.ageLate}
                      {weightProjection.childRow.dateEarly && weightProjection.childRow.dateLate &&
                        ` (${weightProjection.childRow.dateEarly} – ${weightProjection.childRow.dateLate})`}
                    </p>
                  )}
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">CDC: Age to reach {queryWeight} {wUnit} by percentile</p>
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr><th className="text-left py-2 px-3">Percentile</th><th className="text-left py-2 px-3">Age reached</th></tr>
                    </thead>
                    <tbody>
                      {weightProjection.rows.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          <td className="py-2 px-3 font-medium text-gray-600">{r.label}</td>
                          <td className="py-2 px-3 text-gray-700">
                            {r.age
                              ? <>{r.age}{r.date && <span className="text-gray-400 text-xs"> · {r.date}</span>}</>
                              : <span className="text-gray-400 italic">outside range</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {heightProjection && (
            <div className="space-y-3">
              {heightProjection.childRow && (
                <div className="bg-indigo-50 rounded-xl p-4">
                  <p className="text-sm font-semibold text-indigo-800 mb-1">Your child's estimated age to reach {toDisplayH(queryHeight, unit)} {hUnit}</p>
                  <p className="text-sm text-indigo-700">
                    Expected around: <strong>{heightProjection.childRow.age}</strong>
                    {heightProjection.childRow.date && <span className="text-indigo-500"> ({heightProjection.childRow.date})</span>}
                  </p>
                  {heightProjection.childRow.ageEarly && heightProjection.childRow.ageLate && (
                    <p className="text-xs text-indigo-400 mt-1">
                      Range: {heightProjection.childRow.ageEarly} – {heightProjection.childRow.ageLate}
                      {heightProjection.childRow.dateEarly && heightProjection.childRow.dateLate &&
                        ` (${heightProjection.childRow.dateEarly} – ${heightProjection.childRow.dateLate})`}
                    </p>
                  )}
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">CDC: Age to reach {queryHeight} {hUnit} by percentile</p>
                <div className="overflow-hidden rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs">
                      <tr><th className="text-left py-2 px-3">Percentile</th><th className="text-left py-2 px-3">Age reached</th></tr>
                    </thead>
                    <tbody>
                      {heightProjection.rows.map((r, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          <td className="py-2 px-3 font-medium text-gray-600">{r.label}</td>
                          <td className="py-2 px-3 text-gray-700">
                            {r.age
                              ? <>{r.age}{r.date && <span className="text-gray-400 text-xs"> · {r.date}</span>}</>
                              : <span className="text-gray-400 italic">outside range</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {birthdayProjections && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h2 className="font-semibold text-gray-700 mb-3">Future Birthday Projections</h2>
            <div className="overflow-hidden rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left py-2 px-3">Age</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Weight</th>
                    <th className="text-left py-2 px-3">Height</th>
                  </tr>
                </thead>
                <tbody>
                  {birthdayProjections.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="py-2 px-3 font-medium text-gray-600">{r.year} {r.year === 1 ? "year" : "years"}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs">{fmtDate(r.date)}</td>
                      <td className="py-2 px-3 text-gray-700">
                        {r.estW !== null
                          ? <><strong>{fmtW(r.estW)}</strong>{r.wUncert !== null && <span className="text-gray-400"> ± {fmtW(r.wUncert)}</span>}</>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 px-3 text-gray-700">
                        {r.estH !== null
                          ? <><strong>{fmtH(r.estH)}</strong>{r.hUncert !== null && <span className="text-gray-400"> ± {fmtH(r.hUncert)}</span>}</>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pb-4">Estimates based on CDC 2000 Growth Charts. For informational purposes only — always consult your pediatrician. Data is stored in local storage only; no data leaves your computer.</p>
      </div>
    </div>
  );
}
