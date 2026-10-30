// Automatic scenario generator: every tap-changer combination of the 32 test cases (presets.json) at several tap
// positions, at open circuit and at several loads, with and without the parallel transformer TP. Each scenario is a
// simulator model; it is solved on demand and exported as a CGMES ZIP, many of them in one big ZIP.
// No browser APIs: the same code runs in Node tests and in the page.
import { defaultModel, solveWithControl } from "./solver.mjs";
import { presetModel } from "./explain.mjs";
import { createCgmesExport, zip } from "./cgmes.mjs";

/** Generator settings (all can be overridden):
 *  offsets: steps from neutral, every tap changer is moved by this many steps (limited to its own low..high, so a
 *    changer with fewer steps stops at its end; duplicates that result are dropped). -12..+12 is the usual range.
 *  openCircuit: add the open-circuit test (TX alone, other ends open, magnetizing branch i0 0.10 %, p0 0.04 %).
 *  loads: load levels in % of the rated power S of the transformers (100 = the load at which uk is defined: rated
 *    current flows, voltage drop = uk).
 *  parallelTp: scenarios with a phase tap changer are also made with the parallel transformer TP switched on.
 *  powerFactor: cos(phi) of the loads (inductive). */
export const DEFAULT_OPTIONS = { offsets: [-12, 0, 12], openCircuit: true, loads: [50, 100], parallelTp: true, powerFactor: 0.95 };

const PHASE = ["PTClin", "PTCsym", "PTCasym", "PTCtab"];
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const sign = (k) => (k < 0 ? "m" : "p") + String(Math.abs(k)).padStart(2, "0");

/** Load in MW / Mvar for the given % of the rated power: TX, plus TP when it is on, supply B2 (three-winding: B3 takes
 *  the rating of winding 3, B2 the rest of winding 1). Example: 2W, TP off, 100 %, cos 0.95: 250 MVA = 237.5 MW + 78.06 Mvar. */
export function loadFor(model, percent, powerFactor = 0.95) {
  const tp = model.tp.on ? model.tp.S : 0, s = model.windings === 3 ? model.tx3.S : [model.tx2.S];
  const mva = model.windings === 3 ? { B2: Math.min(s[1], s[0] - s[2]) + tp, B3: s[2] } : { B2: s[0] + tp };
  const k = percent / 100, sin = Math.sqrt(1 - powerFactor * powerFactor);
  const out = { B2: { p: 0, q: 0 }, B3: { p: 0, q: 0 } };
  for (const [bus, v] of Object.entries(mva)) out[bus] = { p: v * k * powerFactor, q: v * k * sin };
  return out;
}

/** One scenario object from a model: { id, group, combo, kind, tp, offset, model, summary, result }. */
export function makeScenario(model, { id, group = "custom", combo = "", kind = "", offset = null } = {}) {
  return { id, group, combo, kind, offset, windings: model.windings, model: structuredClone(model), result: null, summary: null };
}

/** Scenarios of all combinations in presets.json (the loaded "TC" cases give the tap changers). Order: combination,
 *  tap position, open circuit, loads, TP off / on. Scenarios with the same tap steps, load and TP are listed once. */
export function generateScenarios(presets, options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options }, list = [];
  for (const p of presets.filter((x) => !x.noload)) {
    const seen = new Set();
    for (const k of o.offsets) {
      const base = presetModel(p, defaultModel);
      for (const t of base.taps) t.step = clamp(t.neutral + k, t.low, t.high);
      const steps = base.taps.map((t) => t.step).join(",");
      const hasPst = base.taps.some((t) => PHASE.includes(t.type));
      const tag = `${p.code}_${sign(k)}`;
      const variants = [];
      if (o.openCircuit) variants.push({ kind: "open circuit", short: "OC", noLoad: true, tp: false });
      for (const pct of o.loads) for (const tp of hasPst && o.parallelTp ? [false, true] : [false]) {
        variants.push({ kind: pct === 100 ? "rated load (uk basis)" : `${pct} % load`, short: `L${pct}`, noLoad: false, tp, pct });
      }
      for (const v of variants) {
        const key = `${steps}|${v.short}|${v.tp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = structuredClone(base);
        m.noLoad = v.noLoad;
        m.tp.on = v.tp;
        if (v.noLoad) for (const t of [m.tx2, m.tx3]) { t.i0 = 0.10; t.p0 = 0.04; }
        else Object.assign(m.loads, loadFor(m, v.pct, o.powerFactor));
        list.push(makeScenario(m, { id: `${tag}_${v.short}${v.tp ? "_TP" : ""}`, group: "generated", combo: p.code, kind: v.kind, offset: k }));
      }
    }
  }
  return list;
}

/** Solve one scenario (tap steps of automatic controllers move) and store result and summary. Returns the scenario. */
export function evaluate(s) {
  try { s.result = solveWithControl(s.model); } catch (err) { s.result = { ok: false, error: err.message }; }
  const r = s.result;
  s.summary = r.ok ? { ok: true, buses: Object.fromEntries(Object.entries(r.buses).map(([n, b]) => [n, { kv: b.vKv, deg: b.angleDeg }])),
    pTx: r.flows["TX T1"]?.p, iterations: r.iterations } : { ok: false };
  return s;
}

/** "B2 109.21 kV -0.55°, B3 ..." for lists. */
export function describeBuses(s) {
  if (!s.summary) return "not solved";
  if (!s.summary.ok) return "no solution";
  return Object.entries(s.summary.buses).filter(([n]) => n !== "B1")
    .map(([n, b]) => `${n} ${b.kv.toFixed(2)} kV ${b.deg >= 0 ? "+" : ""}${b.deg.toFixed(2)}°`).join(", ");
}

/** Tap steps as text: "RTC end 1: 14, PTClin end 2: 16". */
export const stepsText = (s) => s.model.taps.map((t) => `${t.type} end ${t.end}: ${t.step}`).join(", ");

const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const wait = () => new Promise((r) => setTimeout(r, 0));

/** The selected scenarios as one big ZIP: <id>/<CGMES zip> for each version, plus scenarios.csv (an overview, also of
 *  the scenarios that could not be solved and are not in the archive). Solves scenarios that were not solved yet.
 *  @param {object[]} list scenarios. @param {{versions?:string[], now?:Date, onProgress?:function}} opts
 *  @returns {Promise<{filename:string, bytes:Uint8Array, exported:number, skipped:string[]}>} */
export async function exportScenarios(list, { versions = ["3.0.0"], now = new Date(), onProgress } = {}) {
  const files = {}, rows = [["id", "combination", "kind", "windings", "tap steps", "parallel TP", "status", "B2 kV", "B2 deg", "B3 kV", "B3 deg", "P into TX at B1 MW"]];
  const skipped = [];
  let exported = 0;
  for (const [i, s] of list.entries()) {
    if (!s.summary) evaluate(s);
    const b = s.summary.buses || {};
    rows.push([s.id, s.combo, s.kind, s.windings, stepsText(s), s.model.tp.on && !s.model.noLoad ? "on" : "off",
      s.summary.ok ? "ok" : "no solution - not exported", b.B2 ? b.B2.kv : "", b.B2 ? b.B2.deg : "", b.B3 ? b.B3.kv : "", b.B3 ? b.B3.deg : "", s.summary.pTx ?? ""]);
    if (s.summary.ok) {
      for (const version of versions) {
        const out = createCgmesExport(s.model, s.result, { version, now, name: s.id });
        files[`${s.id}/${out.filename}`] = out.bytes;
      }
      exported++;
    } else skipped.push(s.id);
    if (i % 10 === 9) { onProgress?.(i + 1, list.length); await wait(); }
  }
  files["scenarios.csv"] = rows.map((r) => r.map(csv).join(",")).join("\n") + "\n";
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z";
  return { filename: `tapchanger_scenarios_${stamp}_${exported}.zip`, bytes: zip(files), exported, skipped };
}
