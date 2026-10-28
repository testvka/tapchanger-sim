// Generate both CGMES versions for every preset and reading, plus edited grids and automatic controls.
// Python's standard-library ZIP/XML readers independently check the archives (no npm packages required).
// Usage: node test_cgmes.mjs [--keep] (requires python3).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultModel, solveWithControl } from "./solver.mjs";
import { presetModel } from "./explain.mjs";
import { createCgmesExport } from "./cgmes.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
const directory = mkdtempSync(join(tmpdir(), "tapchanger-cgmes-")), manifest = [];
function check(label, model) {
  const result = solveWithControl(model);
  assert.ok(result.ok, label + " converges");
  const before = JSON.stringify(model);
  for (const version of ["2.4.15", "3.0.0"]) {
    const output = createCgmesExport(model, result, { version, now: new Date("2026-10-28T12:34:56Z"), name: label + ' & <test> "ä"' });
    assert.equal(JSON.stringify(model), before, "writing a snapshot must not move taps or change inputs");
    assert.ok(output.filename.endsWith(`CGMES${version.replaceAll(".", "")}.zip`));
    const filename = `${manifest.length}.zip`;
    writeFileSync(join(directory, filename), output.bytes);
    manifest.push(structuredClone({ filename, label, version, model, buses: result.buses, flows: result.flows }));
  }
}
try {
  for (const p of presets) for (const reading of ["keep", "invert"]) {
    const m = presetModel(p, defaultModel); m.end2Rule = reading;
    check(p.code, m);
  }
  for (const windings of [2, 3]) {
    const m = defaultModel(windings);
    m.vSourceKv = 231; m.tp.on = false;
    m.loads.B2 = { p: 85, q: 23 }; m.loads.B3 = { p: 17, q: -2 };
    m.tx2 = { S: 300, uk: 11, ur: 0.4, i0: 0, p0: 0 };
    m.tx3 = { S: [300, 220, 75], uk12: 11, uk13: 6.5, uk23: 6.2, ur12: 0.3, ur13: 0.4, ur23: 0.35, i0: 0, p0: 0 };
    check("edited grid " + windings, m);
    m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25,
      control: { on: true, target: windings === 2 ? "V:B2" : "V:B3", value: windings === 2 ? 112 : 20.5, deadband: 1 } }];
    check("automatic voltage " + windings, m);
  }
  const m = defaultModel(2);
  m.tp = { on: true, S: 180, uk: 10, ur: 0.4 };
  m.taps = [{ end: 1, type: "PTClin", low: 1, high: 25, neutral: 13, step: 13, deg: 1.5,
    control: { on: true, target: "P:TX", value: 150, deadband: 30 } }];
  check("automatic active power", m);
  m.taps[0].control.on = false;
  check("disabled controller", m);

  assert.throws(() => createCgmesExport(m, null), /converged/);
  assert.throws(() => createCgmesExport(m, { ok: false }), /converged/);
  const validResult = solveWithControl(m);
  assert.throws(() => createCgmesExport(m, validResult, { version: "1.0" }), /Unsupported/);
  m.taps[0].step = 1.5;
  assert.throws(() => createCgmesExport(m, validResult), /integers/);
  m.taps[0].step = 13; m.taps[0].deg = NaN;
  assert.throws(() => createCgmesExport(m, validResult), /Invalid CGMES value/);

  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const test = spawnSync("python3", [new URL("./test_cgmes.py", import.meta.url).pathname, directory], { encoding: "utf8" });
  process.stdout.write(test.stdout || ""); process.stderr.write(test.stderr || "");
  if (test.error) throw test.error;
  assert.equal(test.status, 0, "ZIP and XML checks");
  if (process.argv.includes("--keep")) console.log("Archives retained in " + directory);
} finally {
  if (!process.argv.includes("--keep")) rmSync(directory, { recursive: true, force: true });
}
