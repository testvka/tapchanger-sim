// CGMES 2.4.15 / 3.0.0 snapshot of the simulator, packaged as EQ / SSH / TP / SV / DL XML in one ZIP.
// No browser APIs or dependencies: the same writer runs in Node tests and in the offline standalone page.
import { build, KV, TAP_TYPES } from "./solver.mjs";

const MD = "http://iec.ch/TC57/61970-552/ModelDescription/1#";
const FORMATS = {
  "3.0.0": { cim: "http://iec.ch/TC57/CIM100#", inService: true,
    profiles: Object.fromEntries(Object.entries({ EQ: "CoreEquipment", SSH: "SteadyStateHypothesis", TP: "Topology", SV: "StateVariables", DL: "DiagramLayout" })
      .map(([p, title]) => [p, `http://iec.ch/TC57/ns/CIM/${title}-EU/3.0`])),
    dependencies: { EQ: [], SSH: ["EQ"], TP: ["SSH"], SV: ["TP"], DL: ["EQ"] } },
  "2.4.15": { cim: "http://iec.ch/TC57/2013/CIM-schema-cim16#", inService: false,
    profiles: { EQ: "http://entsoe.eu/CIM/EquipmentCore/3/1", SSH: "http://entsoe.eu/CIM/SteadyStateHypothesis/1/1",
      TP: "http://entsoe.eu/CIM/Topology/4/1", SV: "http://entsoe.eu/CIM/StateVariables/4/1", DL: "http://entsoe.eu/CIM/DiagramLayout/3/1" },
    dependencies: { EQ: [], SSH: ["EQ"], TP: ["EQ"], SV: ["SSH", "TP"], DL: ["EQ"] } }
};
const xml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const resource = (uri) => ({ resource: uri });
const uuid = () => globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,
  (c) => { const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16); });

/** Current inputs and a converged solution -> { filename, bytes, files }. Does not move any tap steps. */
export function createCgmesExport(model, result, { version = "3.0.0", now = new Date(), name = "Tap changer simulator" } = {}) {
  const format = FORMATS[version];
  if (!format) throw new Error(`Unsupported CGMES version: ${version}.`);
  if (!result?.ok) throw new Error("A converged load flow is required for CGMES export.");
  const CIM = format.cim, kind = (value) => resource(CIM + value);
  const net = build(model), tx = net.elements.find((e) => e.name === "TX").data;
  const ids = new Map(), parts = { EQ: [], SSH: [], TP: [], SV: [], DL: [] };
  const id = (key) => { if (!ids.has(key)) ids.set(key, "_" + uuid()); return ids.get(key); };
  const ref = (key) => resource("#" + id(key));
  const timestamp = now.toISOString();
  const description = `${name}; ${model.windings} windings; ${model.noLoad ? "no load" : "with load"}; end-2/3 reading: ${model.end2Rule}.`
    + (model.end2Rule === "invert" ? " Inverted linear/tabular phase tap data converted to the CGMES own-winding reading." : "");

  function properties(props) {
    return Object.entries(props).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((v) => {
      if (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v))) throw new Error(`Invalid CGMES value for ${key}.`);
      return v && typeof v === "object"
        ? `    <${key} rdf:resource="${xml(v.resource)}"/>`
        : `    <${key}>${xml(v)}</${key}>`;
    })).join("\n");
  }
  function object(profile, type, key, props, label) {
    const define = profile === "EQ" || profile === "SV" || profile === "DL" || (profile === "TP" && type === "TopologicalNode");
    const identified = label === undefined ? {} : { "cim:IdentifiedObject.mRID": id(key).slice(1), "cim:IdentifiedObject.name": label };
    parts[profile].push(`  <cim:${type} rdf:${define ? "ID" : "about"}="${define ? id(key) : "#" + id(key)}">\n`
      + properties({ ...identified, ...props }) + `\n  </cim:${type}>`);
  }
  function equipment(type, key, label, container, eq = {}, ssh = {}) {
    object("EQ", type, key, { "cim:Equipment.EquipmentContainer": ref(container), ...eq }, label);
    if (format.inService || Object.keys(ssh).length) object("SSH", type, key, { ...(format.inService ? { "cim:Equipment.inService": true } : {}), ...ssh });
    // CGMES 3.0 carries the status in SSH (Equipment.inService); its SV constraints allow SvStatus only for converters.
    if (!format.inService) object("SV", "SvStatus", "status " + key, { "cim:SvStatus.ConductingEquipment": ref(key), "cim:SvStatus.inService": true });
  }
  function terminal(key, label, owner, end, bus, flow) {
    object("EQ", "Terminal", key, { "cim:ACDCTerminal.sequenceNumber": end, "cim:Terminal.ConductingEquipment": ref(owner),
      "cim:Terminal.ConnectivityNode": ref("CN " + bus) }, label);
    object("SSH", "Terminal", key, { "cim:ACDCTerminal.connected": true });
    object("TP", "Terminal", key, { "cim:Terminal.TopologicalNode": ref(bus) });
    object("SV", "SvPowerFlow", "flow " + key, { "cim:SvPowerFlow.Terminal": ref(key),
      "cim:SvPowerFlow.p": flow.p, "cim:SvPowerFlow.q": flow.q });
  }
  function control(type, key, label, targetTerminal, voltage, enabled, value, deadband) {
    object("EQ", type, key, { "cim:RegulatingControl.Terminal": ref(targetTerminal),
      "cim:RegulatingControl.mode": kind("RegulatingControlModeKind." + (voltage ? "voltage" : "activePower")) }, label);
    object("SSH", type, key, { "cim:RegulatingControl.discrete": type === "TapChangerControl", "cim:RegulatingControl.enabled": enabled,
      "cim:RegulatingControl.targetValue": value, "cim:RegulatingControl.targetValueUnitMultiplier": kind("UnitMultiplier." + (voltage ? "k" : "M")),
      ...(type === "TapChangerControl" ? { "cim:RegulatingControl.targetDeadband": deadband } : {}) });
  }

  object("EQ", "GeographicalRegion", "region", {}, "Simulator region");
  object("EQ", "SubGeographicalRegion", "subregion", { "cim:SubGeographicalRegion.Region": ref("region") }, "Simulator subregion");
  object("EQ", "Substation", "station", { "cim:Substation.Region": ref("subregion") }, "S1");
  for (let end = 1; end <= model.windings; end++) {
    const bus = "B" + end, kv = KV[end];
    object("EQ", "BaseVoltage", "BV " + bus, { "cim:BaseVoltage.nominalVoltage": kv }, `${kv} kV`);
    object("EQ", "VoltageLevel", "VL " + bus, { "cim:VoltageLevel.Substation": ref("station"),
      "cim:VoltageLevel.BaseVoltage": ref("BV " + bus), "cim:VoltageLevel.lowVoltageLimit": kv * 0.9,
      "cim:VoltageLevel.highVoltageLimit": kv * 1.1 }, `S1 ${kv} kV`);
    object("EQ", "ConnectivityNode", "CN " + bus, { "cim:ConnectivityNode.ConnectivityNodeContainer": ref("VL " + bus) }, bus);
    object("TP", "TopologicalNode", bus, { "cim:TopologicalNode.BaseVoltage": ref("BV " + bus),
      "cim:TopologicalNode.ConnectivityNodeContainer": ref("VL " + bus) }, bus);
    object("TP", "ConnectivityNode", "CN " + bus, { "cim:ConnectivityNode.TopologicalNode": ref(bus) });
    object("SV", "SvVoltage", "voltage " + bus, { "cim:SvVoltage.TopologicalNode": ref(bus),
      "cim:SvVoltage.v": result.buses[bus].vKv, "cim:SvVoltage.angle": result.buses[bus].angleDeg });
  }
  equipment("ExternalNetworkInjection", "Grid", "Grid", "VL B1", {
    "cim:RegulatingCondEq.RegulatingControl": ref("Grid control"), "cim:ExternalNetworkInjection.governorSCD": 0,
    "cim:ExternalNetworkInjection.minP": -Math.max(5000, Math.abs(result.flows.Grid.p)),
    "cim:ExternalNetworkInjection.maxP": Math.max(5000, Math.abs(result.flows.Grid.p)),
    "cim:ExternalNetworkInjection.minQ": -Math.max(9999, Math.abs(result.flows.Grid.q)),
    "cim:ExternalNetworkInjection.maxQ": Math.max(9999, Math.abs(result.flows.Grid.q))
  }, { "cim:RegulatingCondEq.controlEnabled": true, "cim:ExternalNetworkInjection.referencePriority": 1,
    "cim:ExternalNetworkInjection.p": result.flows.Grid.p, "cim:ExternalNetworkInjection.q": result.flows.Grid.q });
  terminal("Grid T1", "Grid T1", "Grid", 1, "B1", result.flows.Grid);
  control("RegulatingControl", "Grid control", "Grid voltage", "Grid T1", true, true, model.vSourceKv);

  function transformer(key, windings, ratings, data) {
    equipment("PowerTransformer", key, key, "station");
    for (let end = 1; end <= windings; end++) {
      const bus = "B" + end, term = `${key} T${end}`;
      terminal(term, term, key, end, bus, result.flows[term]);
      object("EQ", "PowerTransformerEnd", `${key} end ${end}`, {
        "cim:TransformerEnd.endNumber": end, "cim:TransformerEnd.Terminal": ref(term), "cim:TransformerEnd.BaseVoltage": ref("BV " + bus),
        "cim:PowerTransformerEnd.PowerTransformer": ref(key), "cim:PowerTransformerEnd.ratedU": KV[end],
        "cim:PowerTransformerEnd.ratedS": ratings[end - 1], "cim:PowerTransformerEnd.r": data.r_ohm[end - 1],
        "cim:PowerTransformerEnd.x": data.x_ohm[end - 1], "cim:PowerTransformerEnd.g": end === 1 ? data.g_S : 0,
        "cim:PowerTransformerEnd.b": end === 1 ? data.b_S : 0, "cim:PowerTransformerEnd.connectionKind": kind("WindingConnection.Y")
      }, `${key} end ${end}`);
    }
  }
  transformer("TX", model.windings, model.windings === 2 ? [model.tx2.S, model.tx2.S] : model.tx3.S, tx);
  if (model.tp.on && !model.noLoad) {
    const d = model.tp, z = d.uk / 100 * KV[1] ** 2 / d.S, r = d.ur / 100 * KV[1] ** 2 / d.S;
    transformer("TP", 2, [d.S, d.S], { r_ohm: [r, 0], x_ohm: [Math.sqrt(Math.max(z * z - r * r, 1e-12)), 0], g_S: 0, b_S: 0 });
  }
  if (!model.noLoad) {
    for (let end = 2; end <= model.windings; end++) {
      const key = "LD" + end, flow = model.loads["B" + end];
      equipment("EnergyConsumer", key, key, "VL B" + end, {}, { "cim:EnergyConsumer.p": flow.p, "cim:EnergyConsumer.q": flow.q });
      terminal(key + " T1", key + " T1", key, 1, "B" + end, flow);
    }
  }

  for (const tc of model.taps.filter((t) => t.end <= model.windings)) {
    if (!TAP_TYPES[tc.type] || !Number.isInteger(tc.end) || tc.end < 1) throw new Error("Invalid tap changer type or end.");
    if (![tc.low, tc.high, tc.neutral, tc.step].every(Number.isInteger)
      || tc.low > tc.high || tc.step < tc.low || tc.step > tc.high || tc.neutral < tc.low || tc.neutral > tc.high) {
      throw new Error("Tap steps must be integers within the low/high limits.");
    }
    const type = TAP_TYPES[tc.type], ratio = tc.type === "RTC", key = `TX ${ratio ? "RTC" : "PTC"}${tc.end}`;
    const inverted = model.end2Rule === "invert" && tc.end > 1 && ["PTClin", "PTCtab"].includes(tc.type);
    const props = { "cim:TapChanger.lowStep": tc.low, "cim:TapChanger.highStep": tc.high, "cim:TapChanger.neutralStep": tc.neutral,
      "cim:TapChanger.normalStep": tc.step, "cim:TapChanger.neutralU": KV[tc.end], "cim:TapChanger.ltcFlag": true,
      [`cim:${ratio ? "RatioTapChanger" : "PhaseTapChanger"}.TransformerEnd`]: ref("TX end " + tc.end) };
    if (ratio) props["cim:RatioTapChanger.stepVoltageIncrement"] = tc.svi;
    else if (tc.type === "PTClin") props["cim:PhaseTapChangerLinear.stepPhaseShiftIncrement"] = (inverted ? -1 : 1) * tc.deg;
    else if (tc.type === "PTCsym" || tc.type === "PTCasym") {
      props["cim:PhaseTapChangerNonLinear.voltageStepIncrement"] = tc.vsi;
      if (tc.type === "PTCasym") props["cim:PhaseTapChangerAsymmetrical.windingConnectionAngle"] = tc.theta;
    } else {
      props["cim:PhaseTapChangerTabular.PhaseTapChangerTable"] = ref(key + " table");
      object("EQ", "PhaseTapChangerTable", key + " table", {}, key + " table");
      for (let step = tc.low; step <= tc.high; step++) {
        const point = tc.table.find((p) => p.step === step);
        if (!point || !(point.ratio > 0)) throw new Error(`Missing or invalid phase tap table point ${step}.`);
        object("EQ", "PhaseTapChangerTablePoint", `${key} point ${step}`, {
          "cim:PhaseTapChangerTablePoint.PhaseTapChangerTable": ref(key + " table"), "cim:TapChangerTablePoint.step": step,
          "cim:TapChangerTablePoint.ratio": inverted ? 1 / point.ratio : point.ratio,
          "cim:PhaseTapChangerTablePoint.angle": (inverted ? -1 : 1) * point.angle,
          "cim:TapChangerTablePoint.r": 0, "cim:TapChangerTablePoint.x": 0, "cim:TapChangerTablePoint.g": 0, "cim:TapChangerTablePoint.b": 0
        });
      }
    }
    if (!ratio && tc.type !== "PTCtab") {
      const base = tc.type === "PTClin" ? "PhaseTapChangerLinear" : "PhaseTapChangerNonLinear";
      props[`cim:${base}.xMin`] = tx.x_ohm[tc.end - 1];
      props[`cim:${base}.xMax`] = tx.x_ohm[tc.end - 1];
    }
    const c = tc.control;
    if (c?.target) {
      const voltage = c.target.startsWith("V:"), bus = c.target.slice(2);
      if (voltage && !net.names.includes(bus)) throw new Error(`Control target ${bus} is not in this network.`);
      const term = voltage ? `TX T${bus.slice(1)}` : "TX T1";
      props["cim:TapChanger.TapChangerControl"] = ref(key + " control");
      control("TapChangerControl", key + " control", key + " control", term, voltage, !!c.on, c.value, c.deadband);
    }
    object("EQ", type, key, props, key);
    object("SSH", type, key, { "cim:TapChanger.step": tc.step, "cim:TapChanger.controlEnabled": !!c?.on });
    object("SV", "SvTapStep", "step " + key, { "cim:SvTapStep.TapChanger": ref(key), "cim:SvTapStep.position": tc.step });
  }
  object("SV", "TopologicalIsland", "island", { "cim:TopologicalIsland.TopologicalNodes": net.names.map(ref),
    "cim:TopologicalIsland.AngleRefTopologicalNode": ref("B1") }, "Simulator island");

  // Diagram layout: a single-line diagram, y pointing down. Buses are horizontal lines, equipment single points.
  const n = model.windings, hasTp = model.tp.on && !model.noLoad, tpX = n === 2 ? 400 : 150;
  const bus = n === 2 ? [[[150, 150], [450, 150]], [[150, 350], [450, 350]]]
    : [[[100, 150], [500, 150]], [[100, 350], [280, 350]], [[320, 350], [500, 350]]];
  const loadX = n === 2 ? [300] : [190, 410];
  object("DL", "Diagram", "diagram", { "cim:Diagram.orientation": kind("OrientationKind.negative"),
    "cim:Diagram.x1InitialView": 0, "cim:Diagram.y1InitialView": 0, "cim:Diagram.x2InitialView": 600, "cim:Diagram.y2InitialView": 550 },
    "Single-line diagram");
  function place(key, label, points, order) {
    object("DL", "DiagramObject", "diagram object " + key, { "cim:DiagramObject.Diagram": ref("diagram"),
      "cim:DiagramObject.IdentifiedObject": ref(key), "cim:DiagramObject.drawingOrder": order }, label);
    points.forEach(([x, y], i) => object("DL", "DiagramObjectPoint", `diagram point ${key} ${i + 1}`, {
      "cim:DiagramObjectPoint.DiagramObject": ref("diagram object " + key), "cim:DiagramObjectPoint.sequenceNumber": i + 1,
      "cim:DiagramObjectPoint.xPosition": x, "cim:DiagramObjectPoint.yPosition": y }));
  }
  bus.forEach((points, i) => place("CN B" + (i + 1), "B" + (i + 1), points, 1));
  place("Grid", "Grid", [[300, 50]], 2);
  place("TX", "TX", [[300, 250]], 2);
  if (hasTp) place("TP", "TP", [[tpX, 250]], 2);
  if (!model.noLoad) loadX.forEach((x, i) => place("LD" + (i + 2), "LD" + (i + 2), [[x, 450]], 2));

  const headerIds = Object.fromEntries(Object.keys(parts).map((p) => [p, "urn:uuid:" + uuid()]));
  const files = {};
  const prefix = timestamp.replace(/[-:]/g, "").slice(0, 13) + "Z_1D_TapChanger";
  for (const [profile, profileUri] of Object.entries(format.profiles)) {
    const header = properties({ "md:Model.created": timestamp, "md:Model.scenarioTime": timestamp,
      "md:Model.description": description, "md:Model.modelingAuthoritySet": "https://github.com/testvka/tapchanger-sim",
      "md:Model.profile": profileUri, "md:Model.version": 1,
      "md:Model.DependentOn": format.dependencies[profile].map((p) => resource(headerIds[p])) });
    files[`${prefix}_${profile}_001.xml`] = `<?xml version="1.0" encoding="utf-8"?>\n`
      + `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="${CIM}" xmlns:md="${MD}">\n`
      + `  <md:FullModel rdf:about="${headerIds[profile]}">\n${header}\n  </md:FullModel>\n${parts[profile].join("\n")}\n</rdf:RDF>\n`;
  }
  return { filename: `${prefix}_${model.windings}W_CGMES${version.replaceAll(".", "")}.zip`, files, bytes: zip(files) };
}

// Stored (uncompressed) ZIP, with CRC-32 and a central directory. XML snapshots are small; this keeps the page
// offline and avoids a ZIP dependency or CompressionStream (whose raw-deflate support differs by browser).
export function zip(files) {
  const encoder = new TextEncoder(), entries = [], chunks = [];
  let offset = 0;
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  function header(length, fields) {
    const data = new Uint8Array(length), view = new DataView(data.buffer);
    fields.forEach(([position, value, size = 2]) => size === 4 ? view.setUint32(position, value, true) : view.setUint16(position, value, true));
    return data;
  }
  for (const [filename, content] of Object.entries(files)) {
    const name = encoder.encode(filename), data = typeof content === "string" ? encoder.encode(content) : content, crc = crc32(data);
    const local = header(30, [[0, 0x04034b50, 4], [4, 20], [6, 0x800], [12, 33], [14, crc, 4],
      [18, data.length, 4], [22, data.length, 4], [26, name.length]]);
    chunks.push(local, name, data);
    entries.push(header(46, [[0, 0x02014b50, 4], [4, 20], [6, 20], [8, 0x800], [14, 33], [16, crc, 4],
      [20, data.length, 4], [24, data.length, 4], [28, name.length], [42, offset, 4]]), name);
    offset += local.length + name.length + data.length;
  }
  const directorySize = entries.reduce((n, data) => n + data.length, 0);
  chunks.push(...entries, header(22, [[0, 0x06054b50, 4], [8, Object.keys(files).length], [10, Object.keys(files).length],
    [12, directorySize, 4], [16, offset, 4]]));
  const bytes = new Uint8Array(offset + directorySize + 22);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return bytes;
}
