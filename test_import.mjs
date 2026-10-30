// Round trip: export every preset / edited grid / scenario with cgmes.mjs, import it again and compare the load flows;
// plus invalid inputs, compressed ZIPs and the scenario archive. Usage: node test_import.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { defaultModel, solveWithControl } from "./solver.mjs";
import { presetModel } from "./explain.mjs";
import { createCgmesExport, zip } from "./cgmes.mjs";
import { generateScenarios, evaluate, exportScenarios } from "./scenarios.mjs";
import { importFiles, importCgmes, unzip } from "./cgmes_import.mjs";

const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
let n = 0, worst = 0;
async function roundTrip(label, model) {
  const r = solveWithControl(model);
  assert.ok(r.ok, label);
  for (const version of ["3.0.0", "2.4.15"]) {
    const out = createCgmesExport(model, r, { version, now: new Date("2026-10-28T12:00:00Z") });
    const { cases, errors } = await importFiles([{ name: out.filename, bytes: out.bytes }]);
    assert.deepEqual(errors, [], label + " " + version);
    const [c] = cases, r2 = solveWithControl(structuredClone(c.model));
    assert.ok(r2.ok, label);
    assert.equal(c.version, version);
    assert.equal(c.model.windings, model.windings); assert.equal(c.model.noLoad, model.noLoad);
    for (const b of Object.keys(r.buses)) {
      const d = Math.abs(r.buses[b].vKv - r2.buses[b].vKv) / r.buses[b].kvNominal ?? 1, a = Math.abs(r.buses[b].angleDeg - r2.buses[b].angleDeg);
      worst = Math.max(worst, d || 0); assert.ok((d || 0) < 1e-9 && a < 1e-7, `${label} ${version} ${b}: ${d} ${a}`);
    }
    for (const tc of model.taps) assert.equal(c.model.taps.find((t) => t.end === tc.end && (t.type === "RTC") === (tc.type === "RTC")).step, r.taps ? tc.step : tc.step);
    assert.ok(c.svDeviation < 1e-9, `${label}: SV of the file matches the imported grid (${c.svDeviation})`);
    n++;
  }
}
for (const p of presets) for (const rule of ["keep", "invert"]) { const m = presetModel(p, defaultModel); m.end2Rule = rule; await roundTrip(p.code + " " + rule, m); }
for (const w of [2, 3]) {
  const m = defaultModel(w); m.vSourceKv = 231; m.tp.on = false; m.loads.B2 = { p: 85, q: 23 };
  m.tx2 = { S: 300, uk: 11, ur: 0.4, i0: 0.3, p0: 0.1 };
  m.tx3 = { S: [300, 220, 75], uk12: 11, uk13: 6.5, uk23: 6.2, ur12: 0.3, ur13: 0.4, ur23: 0.35, i0: 0.2, p0: 0.05 };
  await roundTrip("edited " + w, m);
  m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: w === 2 ? "V:B2" : "V:B3", value: w === 2 ? 112 : 20.5, deadband: 1 } }];
  await roundTrip("controlled " + w, m);
}
const mp = defaultModel(2); mp.tp = { on: true, S: 180, uk: 10, ur: 0.4 };
mp.taps = [{ end: 1, type: "PTClin", low: 1, high: 25, neutral: 13, step: 13, deg: 1.5, control: { on: true, target: "P:TX", value: 150, deadband: 30 } }];
await roundTrip("power control", mp);
const scn = generateScenarios(presets, { offsets: [-12, 12] });
for (const s of scn.filter((_, i) => i % 7 === 0)) await roundTrip(s.id, s.model);
console.log(`${n} round trips, worst voltage difference ${worst.toExponential(1)} pu`);

// compressed ZIP written by another tool, and loose XML files
const base = defaultModel(2); base.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 14, svi: 1.25 }];
const r0 = solveWithControl(base), out0 = createCgmesExport(base, r0, { version: "3.0.0" });
const entries = await unzip(out0.bytes);
assert.equal(Object.keys(entries).length, 5);
function deflatedZip(files) {   // minimal ZIP writer with method 8
  const parts = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name), comp = deflateRawSync(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, nb, comp); central.push(c, nb); offset += 30 + nb.length + comp.length;
  }
  const dir = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(dir.length, 12); e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, e]));
}
const packed = await importFiles([{ name: "deflated.zip", bytes: deflatedZip(entries) }]);
assert.equal(packed.errors.length, 0); assert.equal(packed.cases[0].model.taps[0].step, 14);
const loose = await importFiles(Object.entries(entries).map(([name, bytes]) => ({ name, bytes })));
assert.equal(loose.cases.length, 1); assert.equal(loose.cases[0].model.taps[0].step, 14);

// scenario archive: every scenario once (3.0.0 preferred)
const some = scn.slice(0, 6); some.forEach(evaluate);
const big = await exportScenarios(some, { versions: ["2.4.15", "3.0.0"] });
const back = await importFiles([{ name: big.filename, bytes: big.bytes }]);
assert.equal(back.errors.length, 0); assert.deepEqual(back.cases.map((c) => c.name), some.map((s) => s.id)); assert.ok(back.cases.every((c) => c.version === "3.0.0"));

// elements that are not correct are rejected with reasons
const text = (name) => Buffer.from(entries[Object.keys(entries).find((k) => k.includes("_" + name + "_"))]).toString();
const tx = (f) => importCgmes(["EQ", "SSH", "TP", "SV"].map((p) => (p === "EQ" ? f(text("EQ")) : text(p))));
const fails = (f, re) => assert.throws(() => tx(f), (e) => re.test(e.message));
fails((x) => x.replace(/<cim:PowerTransformerEnd.ratedU>110</, "<cim:PowerTransformerEnd.ratedU>132<"), /132 kV/);
fails((x) => x.replace(/<cim:ExternalNetworkInjection /, '<cim:SynchronousMachine ').replace("</cim:ExternalNetworkInjection>", "</cim:SynchronousMachine>"), /Unsupported equipment SynchronousMachine|external network/);
fails((x) => x.replace("</rdf:RDF>", '<cim:ACLineSegment rdf:ID="_x"><cim:Equipment.EquipmentContainer rdf:resource="#_y"/></cim:ACLineSegment></rdf:RDF>'), /Unsupported equipment ACLineSegment/);
fails((x) => x.replace(/<cim:RatioTapChanger.stepVoltageIncrement>[^<]*<\/cim:RatioTapChanger.stepVoltageIncrement>/, ""), /svi missing/);
fails((x) => x.replace(/<cim:TapChanger.highStep>21</, "<cim:TapChanger.highStep>9<"), /steps must be whole numbers/);
assert.throws(() => importCgmes(["<rdf:RDF xmlns:rdf='x'></rdf:RDF>"]), /neither the CIM100/);
const junk = await importFiles([{ name: "junk.zip", bytes: new Uint8Array([0x50, 0x4b, 1, 2, 3]) }]);
assert.equal(junk.cases.length, 0); assert.equal(junk.errors.length, 1);
console.log("import tests passed");
