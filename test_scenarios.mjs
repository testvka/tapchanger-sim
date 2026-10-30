// Scenario generator: counts, unique ids, physical sanity of the solved scenarios, and the big ZIP (checked with
// Python's zipfile, including the nested CGMES archives). Usage: node test_scenarios.mjs (requires python3)
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultModel } from "./solver.mjs";
import { DEFAULT_OPTIONS, generateScenarios, evaluate, exportScenarios, loadFor, makeScenario } from "./scenarios.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
const list = generateScenarios(presets);
assert.equal(new Set(list.map((s) => s.id)).size, list.length, "ids are unique");
assert.equal(new Set(list.map((s) => s.combo)).size, 32, "all 32 combinations");
for (const s of list) {
  for (const t of s.model.taps) assert.ok(t.step >= t.low && t.step <= t.high && Math.abs(t.step - t.neutral) <= 12, s.id);
  if (s.kind === "open circuit") assert.ok(s.model.noLoad && !s.model.tp.on);
  if (s.model.tp.on) assert.ok(s.model.taps.some((t) => t.type !== "RTC"), "TP only with a phase shifter: " + s.id);
}
assert.ok(list.some((s) => s.model.tp.on) && list.some((s) => s.kind.startsWith("rated")));
// extremes are reached: PTClin on end 2 (steps 1..25, neutral 13) at -12 / +12
assert.ok(list.some((s) => s.combo.startsWith("TC12") && s.model.taps[0].step === 1) && list.some((s) => s.combo.startsWith("TC12") && s.model.taps[0].step === 25));
// a changer with a small range stops at its end and does not create duplicates
const rtc3 = list.filter((s) => s.combo.startsWith("TC02") && s.kind === "open circuit").map((s) => s.model.taps[0].step);
assert.deepEqual(rtc3, [1, 11, 21]);
// 100 % load: TX (+TP) carry their rating
const m = defaultModel(2); m.tp.on = true;
const l = loadFor(m, 100, 0.95);
assert.ok(Math.abs(Math.hypot(l.B2.p, l.B2.q) - 500) < 1e-9);

let bad = [];
for (const s of list) { evaluate(s); if (!s.summary.ok) bad.push(s.id); }
console.log(`${list.length} scenarios, ${bad.length} without a solution${bad.length ? ": " + bad.slice(0, 12).join(", ") : ""}`);
assert.ok(bad.length / list.length < 0.05, "at most 5 % unsolvable");
for (const s of list.filter((x) => x.summary.ok)) {
  const r = s.result, g = r.flows;
  const pIn = Object.entries(g).filter(([n]) => n === "Grid").reduce((a, [, f]) => a + f.p, 0);
  const lossP = Object.values(r.losses).reduce((a, x) => a + x.p, 0);
  assert.ok(lossP > -1e-9, "losses are not negative: " + s.id);
  assert.ok(Math.abs(-pIn - (s.model.noLoad ? 0 : Object.values(s.model.loads).reduce((a, x, i) => a + (i === 0 || s.model.windings === 3 ? x.p : 0), 0)) - lossP) < 1e-6, "power balance: " + s.id);
}

const directory = mkdtempSync(join(tmpdir(), "tapchanger-scn-"));
try {
  const chosen = list.filter((s) => s.summary.ok).slice(0, 12);
  const custom = makeScenario(defaultModel(3), { id: "my_custom", kind: "custom" }); evaluate(custom);
  chosen.push(custom);
  const out = await exportScenarios(chosen, { versions: ["3.0.0", "2.4.15"], now: new Date("2026-10-28T12:34:56Z") });
  assert.equal(out.exported, 13);
  writeFileSync(join(directory, "big.zip"), out.bytes);
  const py = `
import zipfile, io, sys
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names = z.namelist(); assert "scenarios.csv" in names
inner = [n for n in names if n.endswith(".zip")]
assert len(inner) == 26, len(inner)
for n in inner:
    zi = zipfile.ZipFile(io.BytesIO(z.read(n))); assert zi.testzip() is None
    assert len(zi.namelist()) == 5, (n, zi.namelist())
rows = z.read("scenarios.csv").decode().strip().split("\\n"); assert len(rows) == 14, len(rows)
print("big zip ok:", len(inner), "CGMES archives,", len(rows) - 1, "rows")
`;
  const t = spawnSync("python3", ["-c", py, join(directory, "big.zip")], { encoding: "utf8" });
  process.stdout.write(t.stdout || ""); process.stderr.write(t.stderr || "");
  assert.equal(t.status, 0);
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log("scenario tests passed; default options", JSON.stringify(DEFAULT_OPTIONS));
