// Checks the browser solver against the SVs of the 64 CGMES 3.0 test cases (tools/refpf.py, cross-checked with
// PowSyBl). Usage: node test_solver.mjs
import { readFileSync } from "node:fs";
import { defaultModel, solve } from "./solver.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
export function modelOf(p, end2Rule = "keep") {
  const m = defaultModel(p.windings);
  m.noLoad = p.noload;
  if (p.noload) { m.tx2.i0 = 0.10; m.tx2.p0 = 0.04; m.tx3.i0 = 0.10; m.tx3.p0 = 0.04; }
  m.taps = p.taps.map((t) => ({ ...t }));
  m.end2Rule = end2Rule;
  return m;
}
let worst = 0, fails = 0, n = 0;
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
