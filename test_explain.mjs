// Checks explain.mjs: every preset (both readings, with and without TP) gets a complete explanation with its pair and
// the pair's stored results; the physics the text states holds for the presets; 2,000 random combinations explain
// without errors. Usage: node test_explain.mjs
//
// For beginners: three parts. (1) every preset in both readings, with and without TP: the text is complete, finds
// its pair and shows the stored B2 voltage. (2) the physics the text claims: at no load V_k = V_B1 * (U_k / 220) *
// |t_k / t_1| and the angle of t_k / t_1; with load a pure phase shift changes the TX active power in the direction
// of its angle, a pure ratio change mostly the reactive power. (3) 2,000 random models from a fixed seed (the same
// models on every run) must be explained without an error. Exit code 1 when any check failed.
import { readFileSync } from "node:fs";
import { defaultModel, solveWithControl, abs, arg, div } from "./solver.mjs";
import { explain, presetModel, renderHtml, renderMarkdown, configKey } from "./explain.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
let fails = 0, n = 0;
/** Count and print one failure. */
const fail = (msg) => { fails++; console.log("FAIL", msg); };
/** True if a text shows a broken number (NaN, undefined, Infinity, null). */
const bad = (s) => /NaN|undefined|Infinity|null/.test(s);

/** Solve, explain and render one model; record failures. Returns { r, ex }. Throws if the solver throws. */
function check(model, label) {
  const r = solveWithControl(model);
  const ex = explain(model, r, presets, defaultModel);
  const text = renderHtml(ex) + renderMarkdown(ex);
  n++;
  if (bad(text)) fail(`${label}: NaN/undefined in the text`);
  if (!ex.sections.some((s) => s.id === "network")) fail(`${label}: no network section`);
  if (model.taps.length && !ex.sections.some((s) => s.id === "taps")) fail(`${label}: no tap section`);
  return { r, ex };
}

// 1. presets: pair, stored values, both readings, TP on/off
for (const p of presets) {
  for (const rule of ["keep", "invert"]) {
    for (const tp of [true, false]) {
      const m = presetModel(p, defaultModel);
      m.end2Rule = rule;
      m.tp.on = tp;
      const { ex } = check(m, `${p.code} ${rule} tp=${tp}`);
      const pair = ex.pair;
      if (!pair || !pair.tc || !pair.nl || pair.row !== p.row) { fail(`${p.code}: pair not found`); continue; }
      const sec = ex.sections.find((s) => s.id === "pair");
      const cell = sec.table.rows[0][p.noload ? 2 : 1];
      if (!cell.startsWith(p.expected.B2[0].toFixed(3))) fail(`${p.code}: pair table B2 ${cell} vs ${p.expected.B2[0]}`);
      const changed = ex.sections[0].paras.some((x) => x.startsWith("You have changed"));
      if (changed !== (rule !== "keep" || !tp)) fail(`${p.code} ${rule} tp=${tp}: "changed" note ${changed}`);
    }
  }
}

// 2. physics stated in the text
for (const p of presets) {
  const m = presetModel(p, defaultModel);
  const r = solveWithControl(m);
  const q = div(r.tEnd[2], r.tEnd[1]);
  if (p.noload) {
    // open-circuit voltage = V_B1 · (U_k / 220) · t_k / t_1 (up to the magnetizing current)
    for (let k = 2; k <= p.windings; k++) {
      const qk = div(r.tEnd[k], r.tEnd[1]);
      const v = r.buses.B1.vKv * ({ 2: 110, 3: 20 }[k] / 220) * abs(qk);
      const dv = Math.abs(v - r.buses[`B${k}`].vKv) / ({ 2: 110, 3: 20 }[k]);
      const da = Math.abs(arg(qk) * 180 / Math.PI - r.buses[`B${k}`].angleDeg);
      n++;
      if (dv > 2e-4 || da > 0.01) fail(`${p.code}: no-load formula off by ${dv.toExponential(1)} pu / ${da.toFixed(4)}°`);
    }
    continue;
  }
  const m0 = presetModel(p, defaultModel); m0.taps = [];
  const r0 = solveWithControl(m0);
  const dP = r.flows["TX T1"].p - r0.flows["TX T1"].p, dQ = r.flows["TX T1"].q - r0.flows["TX T1"].q;
  const ang = arg(q) * 180 / Math.PI, mag = abs(q);
  n++;
  if (Math.abs(mag - 1) < 1e-9 && Math.abs(ang) > 1e-6 && Math.sign(dP) !== Math.sign(ang)) fail(`${p.code}: pure phase shift ${ang.toFixed(2)}° but ΔP ${dP.toFixed(1)}`);
  if (Math.abs(ang) < 1e-9 && Math.abs(mag - 1) > 1e-9 && Math.abs(dQ) < 3 * Math.abs(dP)) fail(`${p.code}: pure ratio change but ΔQ ${dQ.toFixed(1)} not ≫ ΔP ${dP.toFixed(1)}`);
}

// 3. random combinations
const TYPES = ["PTClin", "PTCsym", "PTCasym", "PTCtab"];
const tab = presets.find((p) => p.taps.some((t) => t.type === "PTCtab")).taps.find((t) => t.type === "PTCtab");
const proto = { RTC: { low: 1, high: 21, neutral: 11, svi: 1.25 }, PTClin: { low: 1, high: 25, neutral: 13, deg: 1.5 },
  PTCsym: { low: 1, high: 25, neutral: 13, vsi: 1.6 }, PTCasym: { low: 1, high: 25, neutral: 13, vsi: 1.5, theta: 60 }, PTCtab: tab };
let seed = 12345;
/** Tiny pseudo-random generator (linear congruential), so every run tests the same 2,000 models. Returns 0..1. */
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
/** A random element of array a. */
const pick = (a) => a[Math.floor(rnd() * a.length)];
let nr = 0, nosol = 0, keys = new Set();
for (let i = 0; i < 2000; i++) {
  const w = pick([2, 3]);
  const m = defaultModel(w);
  for (let e = 1; e <= w; e++) {
    if (rnd() < 0.4) m.taps.push({ end: e, type: "RTC", ...structuredClone(proto.RTC) });
    if (rnd() < 0.4) { const t = pick(TYPES); m.taps.push({ end: e, type: t, ...structuredClone(proto[t]) }); }
  }
  for (const t of m.taps) t.step = t.low + Math.floor(rnd() * (t.high - t.low + 1));
  m.noLoad = rnd() < 0.3;
  if (m.noLoad) { m.tx2.i0 = m.tx3.i0 = 0.10; m.tx2.p0 = m.tx3.p0 = 0.04; }
  m.tp.on = rnd() < 0.8;
  m.end2Rule = pick(["keep", "invert"]);
  // the solver itself may find no solution (Newton from a flat start); the page then shows that instead of a text
  try { solveWithControl(m); } catch (err) { nosol++; console.log(`no solution (solver, not explain): ${err.message}; ${JSON.stringify({ w, noLoad: m.noLoad, rule: m.end2Rule, taps: m.taps.map((t) => [t.end, t.type, t.step]) })}`); continue; }
  try { check(m, `random ${i} ${configKey(w, m.taps)}`); nr++; keys.add(configKey(w, m.taps)); } catch (err) { fail(`random ${i}: ${err.message}; ${JSON.stringify({ w, noLoad: m.noLoad, tp: m.tp.on, rule: m.end2Rule, taps: m.taps.map((t) => [t.end, t.type, t.step]) })}`); }
}
console.log(`${n} checks (${nr} random models explained, ${keys.size} different combinations; ${nosol} without a load-flow solution), ${fails} failures`);
process.exit(fails ? 1 : 0);
