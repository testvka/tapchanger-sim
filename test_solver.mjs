// Checks the browser solver against the SVs of the 64 CGMES 3.0 test cases (tools/refpf.py, cross-checked with
// PowSyBl). Usage: node test_solver.mjs
//
// For beginners: presets.json holds, for every test case, the tap changers and the expected bus voltages (from the
// case's SV). For each case (and, where it exists, also for the inverted end-2 reading) this script builds the
// simulator model, solves it with solver.mjs and compares every bus: voltage difference in pu (|dV| / nominal kV)
// and angle difference in radians. A case passes when the solver converged and both are below 1e-7. It prints the
// failures and the inverted-reading cases, then a summary line; exit code 1 when anything failed.
import { readFileSync } from "node:fs";
import { defaultModel, solve } from "./solver.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
/**
 * Simulator model of one preset (same data as the CGMES case).
 * @param {object} p one entry of presets.json ({ windings, noload, taps, ... }).
 * @param {string} end2Rule "keep" or "invert" (how linear / tabular phase tap changers on end 2 or 3 are read).
 * @returns {object} model for solve(); no-load presets get the magnetizing data i0 0.10 %, p0 0.04 %.
 */
export function modelOf(p, end2Rule = "keep") {
  const m = defaultModel(p.windings);
  m.noLoad = p.noload;
  if (p.noload) { m.tx2.i0 = 0.10; m.tx2.p0 = 0.04; m.tx3.i0 = 0.10; m.tx3.p0 = 0.04; }
  m.taps = p.taps.map((t) => ({ ...t }));
  m.end2Rule = end2Rule;
  return m;
}
let worst = 0, fails = 0, n = 0;     // largest difference seen, failed comparisons, number of comparisons
for (const p of presets) {
  for (const [rule, exp] of [["keep", p.expected], ["invert", p.expected_inverted]]) {
    if (!exp) continue;
    const r = solve(modelOf(p, rule));
    let dv = 0;
    for (const [b, [v, a]] of Object.entries(exp)) {
      const g = r.buses[b];
      dv = Math.max(dv, Math.abs(g.vKv - v) / g.kvNominal, Math.abs(g.angleDeg - a) * Math.PI / 180);
    }
    n++;
    worst = Math.max(worst, dv);
    const ok = r.ok && dv < 1e-7;
    if (!ok) fails++;
    if (!ok || rule === "invert") console.log(`${p.code.padEnd(26)} ${rule.padEnd(6)} it ${r.iterations} max |dV|,|dθ| ${dv.toExponential(1)} ${ok ? "ok" : "FAIL"}`);
  }
}
console.log(`${n} comparisons, ${fails} failures, worst ${worst.toExponential(2)} pu`);
process.exit(fails ? 1 : 0);
