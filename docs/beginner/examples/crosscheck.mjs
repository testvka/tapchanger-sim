// Cross-check of the worked examples: computes the same quantities with the repository's own simulator
// (solver.mjs) and prints them as one JSON object. worked_examples.py runs this file and compares.
// Usage: node crosscheck.mjs        (Node.js 18 or newer; no packages needed)
import { readFileSync } from "node:fs";
import { defaultModel, solve, solveWithControl, tapValue } from "../../../solver.mjs";

const presets = JSON.parse(readFileSync(new URL("../../../presets.json", import.meta.url)));

/** Model of a preset (same as the simulator page does it). */
function presetModel(code) {
  const p = presets.find((x) => x.code === code);
  const m = defaultModel(p.windings);
  m.noLoad = p.noload;
  if (p.noload) { m.tx2.i0 = 0.10; m.tx2.p0 = 0.04; m.tx3.i0 = 0.10; m.tx3.p0 = 0.04; }
  m.taps = p.taps.map((t) => structuredClone(t));
  return m;
}

const out = {};
// 1. tap values of the five classes at the steps of the test cases
const tap = (t) => { const v = tapValue(t); return [v.ratio, v.angle]; };
out.rtc1 = tap({ type: "RTC", end: 1, step: 14, neutral: 11, svi: 1.25 });
out.rtc2 = tap({ type: "RTC", end: 2, step: 6, neutral: 9, svi: 1.5 });
out.ptclin = tap({ type: "PTClin", end: 1, step: 16, neutral: 13, deg: 1.5 });
out.ptcsym = tap({ type: "PTCsym", end: 1, step: 9, neutral: 13, vsi: 1.6 });
out.ptcasym = tap({ type: "PTCasym", end: 1, step: 18, neutral: 13, vsi: 1.5, theta: 60 });
// 2. no-load cases: open-circuit voltage of B2 (kV, degrees)
for (const code of ["NL07_2W_RTC1", "NL18_2W_RTC2", "NL12_2W_PTClin1", "NL19_2W_PTClin2", "NL14_2W_PTCasym1",
                    "NL22_2W_PTCsym2", "NL24_2W_RTC1_PTClin1", "NL05_2W_RTC1_RTC2"]) {
  const r = solve(presetModel(code));
  out[code] = [r.buses.B2.vKv, r.buses.B2.angleDeg];
}
// 3. loaded two-winding grid without tap changers, and with one tap changer: TX power at B1 (MW, Mvar)
const base = defaultModel(2);
const rb = solve(base);
out.base = { b2: [rb.buses.B2.vKv, rb.buses.B2.angleDeg], tx: [rb.flows["TX T1"].p, rb.flows["TX T1"].q],
             tp: [rb.flows["TP T1"].p, rb.flows["TP T1"].q], iterations: rb.iterations };
for (const code of ["TC12_2W_PTClin1", "TC07_2W_RTC1"]) {
  const r = solve(presetModel(code));
  out[code] = { tx: [r.flows["TX T1"].p, r.flows["TX T1"].q], tp: [r.flows["TP T1"].p, r.flows["TP T1"].q] };
}
// 4. automatic control: ratio tap changer on end 1 holds B2 at 110 kV +- 0.5 kV, start at the neutral step
let m = defaultModel(2);
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25,
            control: { on: true, target: "V:B2", value: 110, deadband: 1 } }];
let r = solveWithControl(m);
out.control = { b2_start: solve(defaultModel(2)).buses.B2.vKv, final_step: m.taps[0].step,
                 b2_final: r.buses.B2.vKv, moves: r.controlLog.map((x) => [x.from, x.to, x.value]),
                 status: r.controlState[0].status };
// 5. the same with a band narrower than one step and without the parallel TP: hunting
m = defaultModel(2);
m.tp.on = false;
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25,
            control: { on: true, target: "V:B2", value: 110.8, deadband: 1 } }];
r = solveWithControl(m);
out.hunting = { status: r.controlState[0].status, step_effect_kv: r.controlState[0].stepEffect,
                moves: r.controlLog.map((x) => [x.from, x.to, x.value]) };
console.log(JSON.stringify(out));
