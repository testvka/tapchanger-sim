// CGMES import: reads a CGMES 2.4.15 / 3.0.0 package (EQ, SSH, TP, SV XML in a ZIP, or loose XML files) and rebuilds the
// simulator model, when the elements are the ones the simulator can represent: an external network injection at 220 kV,
// one power transformer TX with 2 or 3 windings of 220 / 110 / 20 kV and its ratio / phase tap changers, optionally a
// plain parallel transformer TP (220 / 110 kV) and energy consumers on the 110 / 20 kV buses. Anything else is reported
// and nothing is imported (no silent guessing). Files written by the exporter in cgmes.mjs come back unchanged.
// No browser APIs except DecompressionStream (for compressed ZIPs written by other tools).
import { defaultModel, solveWithControl, KV } from "./solver.mjs";

export class ImportError extends Error {
  constructor(problems) { super(problems.join(" ")); this.problems = problems; }
}

// ---------------------------------------------------------------- ZIP
/** Files of a ZIP as { name: Uint8Array }. Supports stored and deflated entries (no ZIP64, no encryption). */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new ImportError(["Not a ZIP archive (no end-of-directory record)."]);
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new ImportError(["Damaged ZIP central directory."]);
    const method = view.getUint16(p + 10, true), size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true), name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extra + comment;
    if (name.endsWith("/")) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out[name] = raw;
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new ImportError([`${name} is compressed and this browser cannot unpack it.`]);
      out[name] = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    } else throw new ImportError([`${name}: unsupported ZIP compression method ${method}.`]);
  }
  return out;
}

// ---------------------------------------------------------------- RDF/XML
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
});
/** One identifier form for "#_abc", "_abc" and "urn:uuid:abc". */
const norm = (s) => s.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^_/, "");

/** Objects of one CIM RDF/XML file: [{ type, id, props: { "Class.prop": [{ text } | { ref, raw }] } }], and the CIM namespace. */
function parseRdf(text) {
  const objects = [], tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const local = (n) => n.slice(n.indexOf(":") + 1);
  let depth = 0, cur = null, prop = null, cim = "", m;
  while ((m = tagRe.exec(text))) {
    const [, cdata, closing, tag, attrString, selfClosing, chars] = m;
    if (tag) {
      if (closing) {
        depth--;
        if (depth === 1) cur = null;
        else if (depth === 2) prop = null;
        continue;
      }
      const attrs = {};
      for (const a of (attrString || "").matchAll(attrRe)) attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
      if (depth === 0 && tag.endsWith("RDF")) {
        for (const [k, v] of Object.entries(attrs)) if (k.startsWith("xmlns") && /CIM|cim/.test(v) && !/ModelDescription/.test(v)) cim = cim || v;
      }
      if (depth === 1) {
        const id = attrs["rdf:ID"] ?? attrs["rdf:about"];
        cur = { type: local(tag), id: id === undefined ? undefined : norm(id), props: {} };
        objects.push(cur);
      } else if (depth === 2 && cur) {
        const entry = attrs["rdf:resource"] !== undefined ? { ref: norm(attrs["rdf:resource"]), raw: attrs["rdf:resource"] } : { text: "" };
        (cur.props[local(tag)] ||= []).push(entry);
        prop = entry;
      }
      if (!selfClosing) depth++;
      else if (depth === 2) prop = null;
    } else if (chars !== undefined && prop && "text" in prop) prop.text += unescapeXml(chars);
    else if (cdata !== undefined && prop && "text" in prop) prop.text += cdata;
  }
  return { objects, cim };
}

// ---------------------------------------------------------------- model from objects
const CONTAINERS = new Set(["FullModel"]);
/** Types the simulator reads or can safely ignore. Equipment (has Equipment.EquipmentContainer) of any other type is an error. */
const KNOWN_EQUIPMENT = new Set(["ExternalNetworkInjection", "PowerTransformer", "EnergyConsumer"]);
const TAP_KIND = { RatioTapChanger: "RTC", PhaseTapChangerLinear: "PTClin", PhaseTapChangerSymmetrical: "PTCsym", PhaseTapChangerAsymmetrical: "PTCasym", PhaseTapChangerTabular: "PTCtab" };

/** Rebuild the simulator model from the texts of the XML files of one CGMES package.
 *  @param {string[]} texts RDF/XML contents. @returns {{model:object, version:string, warnings:string[], svDeviation:number|null}}
 *  @throws {ImportError} with every problem found (the list is in .problems). */
export function importCgmes(texts) {
  const problems = [], warnings = [], byId = new Map(), all = [];
  let cim = "";
  for (const text of texts) {
    const parsed = parseRdf(text);
    cim = cim || parsed.cim;
    for (const o of parsed.objects) {
      if (CONTAINERS.has(o.type) || o.id === undefined) continue;
      let t = byId.get(o.id);
      if (!t) { t = { type: o.type, id: o.id, props: {} }; byId.set(o.id, t); all.push(t); }
      for (const [k, v] of Object.entries(o.props)) (t.props[k] ||= []).push(...v);
    }
  }
  const version = /CIM100/.test(cim) ? "3.0.0" : /cim16/.test(cim) ? "2.4.15" : "";
  if (!version) throw new ImportError(["No CGMES data found: the files use neither the CIM100 (CGMES 3.0) nor the cim16 (CGMES 2.4.15) namespace."]);
  const ofType = (...types) => all.filter((o) => types.includes(o.type));
  const find = (o, suffix) => { for (const k of Object.keys(o.props)) if (k.endsWith("." + suffix)) return o.props[k][0]; return undefined; };
  const num = (o, s) => { const v = find(o, s); return v && v.text !== undefined && v.text.trim() !== "" ? +v.text : undefined; };
  const bool = (o, s) => { const v = find(o, s); return v && v.text !== undefined ? v.text.trim() === "true" : undefined; };
  const ref = (o, s) => { const v = find(o, s); return v && v.ref ? byId.get(v.ref) : undefined; };
  const enumOf = (o, s) => { const v = find(o, s); return v && v.raw ? v.raw.slice(v.raw.lastIndexOf(".") + 1) : undefined; };
  const label = (o) => (find(o, "name") ? find(o, "name").text : o.id);
  const bad = (m) => problems.push(m);

  // equipment the simulator cannot represent
  for (const o of all) {
    if (find(o, "EquipmentContainer") && !KNOWN_EQUIPMENT.has(o.type)) bad(`Unsupported equipment ${o.type} "${label(o)}": the simulator has one transformer, one parallel transformer, loads and the grid.`);
    if (bool(o, "inService") === false) bad(`${o.type} "${label(o)}" is out of service.`);
    if (o.type === "SvStatus" && bool(o, "inService") === false) bad(`${label(ref(o, "ConductingEquipment") || o)} is out of service (SvStatus).`);
    if (o.type === "Terminal" && bool(o, "connected") === false) bad(`Terminal "${label(o)}" is not connected.`);
  }

  // which bus (1 = 220 kV, 2 = 110, 3 = 20) a terminal is at: from the base voltage of its connectivity node / topological node
  const busNumber = (kv) => [1, 2, 3].find((n) => Math.abs(kv - KV[n]) < 0.5);
  const kvOfTerminal = (t) => {
    const cn = ref(t, "ConnectivityNode"), tn = ref(t, "TopologicalNode");
    const viaCn = cn && ref(cn, "ConnectivityNodeContainer");
    const bv = (viaCn && ref(viaCn, "BaseVoltage")) || (tn && ref(tn, "BaseVoltage"));
    return bv ? num(bv, "nominalVoltage") : undefined;
  };
  const terminalsOf = (eq) => ofType("Terminal").filter((t) => ref(t, "ConductingEquipment") === eq);
  const busOfTerminal = (t) => { const kv = kvOfTerminal(t); return kv === undefined ? undefined : busNumber(kv); };

  // transformers
  const power = ofType("PowerTransformer");
  const endsOf = (pt) => ofType("PowerTransformerEnd").filter((e) => ref(e, "PowerTransformer") === pt).sort((a, b) => num(a, "endNumber") - num(b, "endNumber"));
  const tapsAll = ofType(...Object.keys(TAP_KIND), "PhaseTapChanger", "PhaseTapChangerNonLinear", "TapChanger");
  const hasTaps = (pt) => tapsAll.some((t) => endsOf(pt).includes(ref(t, "TransformerEnd")));
  let tx, tp;
  if (!power.length) bad("No PowerTransformer found.");
  else if (power.length === 1) tx = power[0];
  else if (power.length === 2) {
    const named = power.find((p) => label(p) === "TX");
    tx = power.find((p) => endsOf(p).length === 3) || power.find(hasTaps) || named;
    tp = power.find((p) => p !== tx);
    if (!tx) bad("Cannot tell which of the two transformers is TX: give the main transformer the name TX, or tap changers.");
  } else bad(`${power.length} power transformers found; the simulator has TX and at most one parallel transformer TP.`);

  const model = defaultModel(2);
  model.end2Rule = "keep";
  const txEnds = tx ? endsOf(tx) : [];
  if (tx && ![2, 3].includes(txEnds.length)) bad(`Transformer "${label(tx)}" has ${txEnds.length} windings; the simulator supports 2 or 3.`);
  if (tx && [2, 3].includes(txEnds.length)) {
    model.windings = txEnds.length;
    const w = txEnds.length, d = defaultModel(w);
    Object.assign(model, { tx2: d.tx2, tx3: d.tx3, loads: d.loads });
    const ends = txEnds.map((e, i) => {
      const o = { r: num(e, "r") ?? 0, x: num(e, "x") ?? 0, g: num(e, "g") ?? 0, b: num(e, "b") ?? 0, u: num(e, "ratedU"), s: num(e, "ratedS") };
      if (num(e, "endNumber") !== i + 1) bad(`${label(tx)}: winding numbers must be 1..${w}.`);
      if (!(Math.abs(o.u - KV[i + 1]) < 0.01 * KV[i + 1])) bad(`${label(tx)} winding ${i + 1}: rated voltage ${o.u} kV; the simulator uses ${KV[i + 1]} kV.`);
      if (!(o.s > 0)) bad(`${label(tx)} winding ${i + 1}: ratedS is missing.`);
      const term = ref(e, "Terminal"), n = term && busOfTerminal(term);
      if (n !== undefined && n !== i + 1) bad(`${label(tx)} winding ${i + 1} is connected to a ${KV[n]} kV node; expected ${KV[i + 1]} kV.`);
      return o;
    });
    if (!problems.length) {
      const u1 = 220;
      // magnetizing branch referred to 220 kV and S of winding 1: g = p0/100 S/U^2, b = -sqrt(i0^2 - p0^2)/100 S/U^2
      const g = ends.reduce((a, e, i) => a + e.g * (e.u / u1) ** 2, 0), b = ends.reduce((a, e) => a + e.b * (e.u / u1) ** 2, 0);
      const p0 = g * u1 * u1 / ends[0].s * 100, i0 = Math.hypot(b * u1 * u1 / ends[0].s * 100, p0);
      if (w === 2) {
        // series impedance referred to 220 kV
        const k = (u1 / ends[1].u) ** 2, r = ends[0].r + ends[1].r * k, x = ends[0].x + ends[1].x * k, S = ends[0].s;
        const base = u1 * u1 / S;
        Object.assign(model.tx2, { S, uk: Math.hypot(r, x) / base * 100, ur: r / base * 100, i0, p0 });
        if (Math.abs(ends[1].s - S) > 1e-6 * S) warnings.push("The ratings of the two windings differ; the rating of winding 1 is used.");
      } else {
        // star impedances per kV^2 -> pair impedances on the smaller rating of the pair -> uk, ur
        const z = ends.map((e) => [e.r / (e.u * e.u), e.x / (e.u * e.u)]);
        const pair = (a, b2, sa, sb) => { const re = z[a][0] + z[b2][0], im = z[a][1] + z[b2][1], m = Math.min(sa, sb);
          return { uk: Math.hypot(re, im) * m * 100, ur: re * m * 100 }; };
        const S = ends.map((e) => e.s), p12 = pair(0, 1, S[0], S[1]), p13 = pair(0, 2, S[0], S[2]), p23 = pair(1, 2, S[1], S[2]);
        Object.assign(model.tx3, { S, uk12: p12.uk, uk13: p13.uk, uk23: p23.uk, ur12: p12.ur, ur13: p13.ur, ur23: p23.ur, i0, p0 });
      }
    }
  }

  // parallel transformer
  if (tp) {
    const ends = endsOf(tp);
    const ok = ends.length === 2 && ends.every((e, i) => num(e, "endNumber") === i + 1 && Math.abs(num(e, "ratedU") - KV[i + 1]) < 0.01 * KV[i + 1]);
    if (!ok) bad(`Transformer "${label(tp)}" must have 2 windings of 220 / 110 kV to be the parallel transformer TP.`);
    else if (hasTaps(tp)) bad(`The parallel transformer "${label(tp)}" has a tap changer; only TX can have tap changers.`);
    else {
      const k = (220 / num(ends[1], "ratedU")) ** 2, r = (num(ends[0], "r") ?? 0) + (num(ends[1], "r") ?? 0) * k, x = (num(ends[0], "x") ?? 0) + (num(ends[1], "x") ?? 0) * k;
      const S = num(ends[0], "ratedS"), base = 220 * 220 / S;
      Object.assign(model.tp, { on: true, S, uk: Math.hypot(r, x) / base * 100, ur: r / base * 100 });
    }
  } else model.tp.on = false;

  // grid: external network injection at 220 kV, voltage from its regulating control (or from the SV of B1)
  const grids = ofType("ExternalNetworkInjection");
  if (grids.length !== 1) bad(`${grids.length} external network injections found; the simulator needs exactly one (the grid at 220 kV).`);
  else {
    const t = terminalsOf(grids[0])[0];
    if (!t || busOfTerminal(t) !== 1) bad("The external network injection must be at the 220 kV node.");
    const rc = ref(grids[0], "RegulatingControl");
    let kv = rc && num(rc, "targetValue");
    if (rc && kv !== undefined && enumOf(rc, "targetValueUnitMultiplier") === "M") kv = undefined;
    if (kv === undefined) {
      const sv = ofType("SvVoltage").find((v) => { const n = ref(v, "TopologicalNode"); const bv = n && ref(n, "BaseVoltage"); return bv && Math.abs(num(bv, "nominalVoltage") - 220) < 0.5; });
      kv = sv && num(sv, "v");
      if (kv !== undefined) warnings.push("The grid has no voltage regulating control; the source voltage is taken from the SV voltage at 220 kV.");
    }
    if (!(kv > 0)) bad("The source voltage (regulating control target of the grid, or SV voltage at 220 kV) is missing.");
    else model.vSourceKv = kv;
  }

  // loads
  const consumers = ofType("EnergyConsumer");
  model.loads = { B2: { p: 0, q: 0 }, B3: { p: 0, q: 0 } };
  for (const c of consumers) {
    const t = terminalsOf(c)[0], n = t && busOfTerminal(t);
    if (n === undefined || n < 2 || n > model.windings) bad(`Load "${label(c)}" must be at the 110 kV bus${model.windings === 3 ? " or the 20 kV bus" : ""}.`);
    else if (num(c, "p") === undefined || num(c, "q") === undefined) bad(`Load "${label(c)}" has no p / q (SSH).`);
    else { model.loads["B" + n].p += num(c, "p"); model.loads["B" + n].q += num(c, "q"); }
  }
  model.noLoad = !consumers.length && !tp;
  if (model.noLoad) for (const t of [model.tx2, model.tx3]) t.autoMag = false;

  // tap changers
  model.taps = [];
  for (const o of tapsAll) {
    const end = ref(o, "TransformerEnd");
    if (!end) { bad(`Tap changer "${label(o)}" has no transformer end.`); continue; }
    if (!txEnds.includes(end)) { if (tp && endsOf(tp).includes(end)) continue; bad(`Tap changer "${label(o)}" is on a transformer the simulator does not model.`); continue; }
    const type = TAP_KIND[o.type];
    if (!type) { bad(`Tap changer type ${o.type} ("${label(o)}") is not supported; use ratio, linear, symmetrical, asymmetrical or tabular.`); continue; }
    const tc = { end: num(end, "endNumber"), type, low: num(o, "lowStep"), high: num(o, "highStep"), neutral: num(o, "neutralStep") };
    tc.step = num(o, "step") ?? num(o, "normalStep");
    if (![tc.low, tc.high, tc.neutral, tc.step].every(Number.isInteger) || tc.low > tc.high || tc.step < tc.low || tc.step > tc.high || tc.neutral < tc.low || tc.neutral > tc.high) {
      bad(`Tap changer "${label(o)}": steps must be whole numbers with low <= neutral, step <= high.`); continue;
    }
    if (type === "RTC") tc.svi = num(o, "stepVoltageIncrement");
    else if (type === "PTClin") tc.deg = num(o, "stepPhaseShiftIncrement");
    else if (type === "PTCsym" || type === "PTCasym") { tc.vsi = num(o, "voltageStepIncrement"); if (type === "PTCasym") tc.theta = num(o, "windingConnectionAngle"); }
    else {
      const table = ref(o, "PhaseTapChangerTable");
      const points = table ? ofType("PhaseTapChangerTablePoint").filter((p) => ref(p, "PhaseTapChangerTable") === table) : [];
      tc.table = points.map((p) => ({ step: num(p, "step"), angle: num(p, "angle"), ratio: num(p, "ratio") })).sort((a, b) => a.step - b.step);
      for (let s = tc.low; s <= tc.high; s++) if (!tc.table.some((p) => p.step === s && p.ratio > 0 && Number.isFinite(p.angle))) { bad(`Tap changer "${label(o)}": the table has no valid point for step ${s}.`); break; }
    }
    const needed = { RTC: ["svi"], PTClin: ["deg"], PTCsym: ["vsi"], PTCasym: ["vsi", "theta"], PTCtab: [] }[type];
    if (needed.some((k) => !Number.isFinite(tc[k]))) { bad(`Tap changer "${label(o)}": ${needed.join(", ")} missing.`); continue; }
    if (model.taps.some((x) => x.end === tc.end && (x.type === "RTC") === (type === "RTC"))) { bad(`End ${tc.end} has two ${type === "RTC" ? "ratio" : "phase"} tap changers.`); continue; }
    const control = ref(o, "TapChangerControl");
    if (control) {
      const voltage = enumOf(control, "mode") === "voltage", power = enumOf(control, "mode") === "activePower", t = ref(control, "Terminal");
      const txTerm = t && txEnds.map((e) => ref(e, "Terminal")).indexOf(t), n = t && (txTerm >= 0 ? txTerm + 1 : busOfTerminal(t));
      const value = num(control, "targetValue"), deadband = num(control, "targetDeadband") ?? 0;
      if (voltage && n >= 1 && n <= model.windings && value > 0) tc.control = { on: !!(bool(control, "enabled") && bool(o, "controlEnabled") !== false), target: "V:B" + n, value, deadband };
      else if (power && txTerm === 0 && Number.isFinite(value)) tc.control = { on: !!(bool(control, "enabled") && bool(o, "controlEnabled") !== false), target: "P:TX", value, deadband };
      else bad(`Tap changer control of "${label(o)}" is not supported: voltage at a transformer bus or active power into TX end 1 only.`);
    }
    model.taps.push(tc);
  }
  model.taps.sort((a, b) => a.end - b.end || (a.type === "RTC" ? -1 : 1));
  if (problems.length) throw new ImportError(problems);

  // compare with the SV of the file
  let svDeviation = null;
  try {
    const r = solveWithControl(structuredClone(model));
    if (!r.ok) warnings.push("The imported grid has no load-flow solution.");
    else for (const v of ofType("SvVoltage")) {
      const n = ref(v, "TopologicalNode"), bv = n && ref(n, "BaseVoltage"), kv = bv && num(bv, "nominalVoltage"), b = kv && busNumber(kv);
      if (!b || !r.buses["B" + b]) continue;
      svDeviation = Math.max(svDeviation ?? 0, Math.abs(r.buses["B" + b].vKv - num(v, "v")) / KV[b]);
    }
  } catch (err) { warnings.push("Load flow failed: " + err.message); }
  if (svDeviation !== null && svDeviation > 1e-3) warnings.push(`The voltages in the file's SV differ from the simulator's load flow by up to ${(svDeviation * 100).toFixed(2)} % of nominal.`);
  return { model, version, warnings, svDeviation };
}

// ---------------------------------------------------------------- files
const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;
const decode = (b) => new TextDecoder().decode(b);
const stem = (n) => n.replace(/^.*[\\/]/, "").replace(/\.(zip|xml)$/i, "");

/** Imports selected files: CGMES ZIPs, loose XML files (together they are one case), or an archive of scenario ZIPs as
 *  written by the scenario exporter (every nested ZIP is a case; where a scenario has both versions, 3.0.0 is used).
 *  @param {{name:string, bytes:Uint8Array}[]} inputs
 *  @returns {Promise<{cases:{name:string, model:object, version:string, warnings:string[], svDeviation:number|null}[], errors:{name:string, problems:string[]}[]}>} */
export async function importFiles(inputs) {
  const cases = [], errors = [], loose = [];
  const pack = (name, texts) => {
    try { cases.push({ name, ...importCgmes(texts) }); }
    catch (err) { errors.push({ name, problems: err instanceof ImportError ? err.problems : [err.message] }); }
  };
  async function archive(name, bytes, depth) {
    let files;
    try { files = await unzip(bytes); } catch (err) { errors.push({ name, problems: err.problems || [err.message] }); return; }
    const xml = Object.entries(files).filter(([n]) => /\.xml$/i.test(n)), nested = Object.entries(files).filter(([n]) => /\.zip$/i.test(n));
    if (xml.length) pack(name, xml.map(([, b]) => decode(b)));
    else if (nested.length && depth < 2) {
      const before = cases.length;
      for (const [n, b] of nested) {
        const parts = n.split("/");
        await archive(parts.length > 1 ? parts[parts.length - 2] : stem(parts[0]), b, depth + 1);
      }
      // one scenario folder holding several versions: keep 3.0.0
      const added = cases.splice(before);
      for (const c of added) if (c.version === "3.0.0" || !added.some((d) => d.name === c.name && d.version === "3.0.0")) cases.push(c);
    } else errors.push({ name, problems: ["The ZIP contains no CGMES XML files."] });
  }
  for (const { name, bytes } of inputs) {
    if (isZip(bytes)) await archive(name, bytes, 0);
    else loose.push({ name, text: decode(bytes) });
  }
  if (loose.length) pack(loose.length === 1 ? stem(loose[0].name) : stem(loose[0].name).replace(/_(EQ|SSH|TP|SV|DL)_\d+$/, ""), loose.map((l) => l.text));
  return { cases, errors };
}
