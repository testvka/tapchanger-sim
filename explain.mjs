// Explanation of a tap-changer combination: what each tap changer does, how they combine, what the network makes of
// it, and the matching pair of example cases (loaded TCnn / no load NLnn). Used by index.html (live, for the current
// model) and by explain_all.mjs (EXPLANATIONS.md and explanations.html for all 32 configurations).
//
// For beginners: explain(model, result) builds the explanation as data (sections with paragraphs, list items, a
// table and buttons); renderHtml() / renderMarkdown() turn that data into HTML or Markdown. Every sentence is a
// template filled with numbers of the current load flow, so the text always matches what the page shows.
// Main steps of explain(): describe the combination -> tapItem() per tap changer (formula, kind, end) ->
// interaction() (how ends combine: only t_k / t_1 matters between buses) -> network() (what load and the parallel
// TP make of it, compared with the same network without tap changers) -> the pair table (TCnn / NLnn) ->
// reading() (what a program reading such a case must get right).
// Read first: explain(), network(), interaction(), renderHtml().
// Words: t = complex tap factor ratio * e^(j angle); TX / TP = transformer under test / plain parallel transformer;
// TC / NL = loaded / no-load case; RTC / PTC = ratio / phase tap changer; n = step - neutral; du = voltage step.
// Do not change the text templates lightly: EXPLANATIONS.md and explanations.html are generated from them and
// test_explain.mjs checks parts of the wording (e.g. the pair heading).
import { solve, solveWithControl, tapValue, TAP_TYPES, abs, arg, div } from "./solver.mjs";

const KVE = { 1: 220, 2: 110, 3: 20 };    // rated kV per end
const DEG = 180 / Math.PI;                // radians -> degrees
/** x, or 0 when it would print as -0.000 with n decimals. */
const z = (x, n) => (Math.abs(x) < 0.5 * 10 ** -n ? 0 : x);                // no "-0.000"
/** Fixed-point text with n decimals, e.g. fx(1.23456) = "1.235". */
const fx = (x, n = 3) => z(x, n).toFixed(n);
/** Same with a sign, e.g. sg(4.5) = "+4.500". */
const sg = (x, n = 3) => (z(x, n) >= 0 ? "+" : "") + z(x, n).toFixed(n);
/** Angle in degrees wrapped to -180 .. +180. */
const wrap = (d) => ((d + 540) % 360) - 180;
/** English list: ["a"] -> "a", ["a","b"] -> "a and b", ["a","b","c"] -> "a, b and c". */
const lst = (a) => (a.length < 3 ? a.join(" and ") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
/** Sort order of tap changers: by end, ratio tap changer first. */
const order = (a, b) => a.end - b.end || (a.type === "RTC" ? -1 : 1);
/** True for a phase tap changer (any type except RTC). */
const isPhase = (t) => t.type !== "RTC";

/** Configuration key: windings + tap changer types per end (steps and data do not count).
 * Example: configKey(2, [{ end: 2, type: "PTClin" }, { end: 1, type: "RTC" }]) = "2W:1RTC+2PTClin". */
export function configKey(windings, taps) {
  return `${windings}W:` + taps.map((t) => `${t.end}${t.type}`).sort().join("+");
}

/** The model of an example case, as the page loads it.
 * @param {object} p one entry of presets.json. @param {Function} defaultModel from solver.mjs (passed in, so this
 * file needs only what it imports). @returns {object} model; no-load cases get i0 0.10 %, p0 0.04 %. */
export function presetModel(p, defaultModel) {
  const m = defaultModel(p.windings);
  m.noLoad = p.noload;
  if (p.noload) { m.tx2.i0 = 0.10; m.tx2.p0 = 0.04; m.tx3.i0 = 0.10; m.tx3.p0 = 0.04; }
  m.taps = p.taps.map((t) => structuredClone(t));
  return m;
}

/** The pair of example cases (loaded TC, no load NL) with the same combination, or null.
 * @returns {{row:number, tc:object|undefined, nl:object|undefined}|null} */
export function findPair(model, presets) {
  const key = configKey(model.windings, model.taps);
  const tc = presets.find((p) => !p.noload && configKey(p.windings, p.taps) === key);
  const nl = presets.find((p) => p.noload && configKey(p.windings, p.taps) === key);
  return tc || nl ? { row: (tc || nl).row, tc, nl } : null;
}

/** The model as a JSON string without control settings and helper flags, to compare two models. */
function normalized(m) {
  const c = structuredClone(m);
  for (const t of [c.tx2, c.tx3]) delete t.autoMag;
  c.taps = c.taps.map(({ control, ...t }) => t).sort(order);
  return JSON.stringify(c);
}

/** How much one tap changer moves each bus: [{ bus, dv (kV), da (degrees) }] from the result's chains. */
function contributions(r, tc) {
  const label = `${tc.type} end ${tc.end}`;
  const out = [];
  for (const c of r.chains) {
    for (const s of c.steps) {
      if (s.label !== label) continue;
      out.push({ bus: c.bus, dv: (abs(s.b) - abs(s.a)) * c.kv, da: wrap((arg(s.b) - arg(s.a)) * DEG) });
    }
  }
  return out;
}

// one sentence per tap-changer type: what it does and its formula
const KIND = {
  RTC: "A ratio tap changer scales the winding voltage in phase: t = 1 + n · stepVoltageIncrement / 100 with n = step − neutral; the angle stays 0°.",
  PTClin: "A linear phase tap changer turns the voltage by n · stepPhaseShiftIncrement and leaves the magnitude at 1. CGMES describes it only by the angle per step, not by a winding design.",
  PTCsym: "A symmetrical phase shifter adds two equal series voltages, so the magnitude stays 1 and the angle is 2 · atan(n · du / 2) with du = voltageStepIncrement: slightly smaller in size than n · du (in radians) and not linear in the step.",
  PTCasym: "An asymmetrical phase shifter (booster) adds n · du at the windingConnectionAngle θ: t = 1 + n · du · e^(jθ). It turns the angle and changes the magnitude at the same time; because that step is added to a fixed length-1 baseline, arg(t) is normally far below θ itself.",
  PTCtab: "A tabular phase tap changer takes angle and ratio of every step from its table. The points need not be equidistant, so no formula converts a step into an angle.",
};

/**
 * Extra sentence for an asymmetrical phase shifter: the cos/sin split of the step and why arg(t) is usually far
 * from θ (windingConnectionAngle). t = 1 + du · e^(jθ) adds a step of length |du| to a fixed length-1 baseline, so
 * arg(t) = atan2(du·sinθ, 1 + du·cosθ) reaches θ only as |du| → ∞; the half-angle identity gives the one point that
 * does not depend on θ's size: at |du| = 1, arg(t) = θ/2 exactly.
 * @param {object} tc the PTCasym tap changer (needs step, neutral, vsi, theta). @param {object} v tapValue(tc).
 */
function asymExtra(tc, v) {
  const n = tc.step - tc.neutral;
  if (n === 0) return ` Here θ = ${tc.theta}°; at neutral (n = 0) the step has length 0, so t = 1 whatever θ is.`;
  const du = (n * tc.vsi) / 100;
  const th = (tc.theta * Math.PI) / 180;
  const re = 1 + du * Math.cos(th), im = du * Math.sin(th);
  const half = wrap(tc.theta / 2);
  return ` Here θ = ${tc.theta}°, du = n · ${tc.vsi} / 100 = ${fx(du, 4)}, so t = (1 + du·cosθ) + j·du·sinθ = `
    + `${fx(re, 5)} + j${fx(im, 5)}: ratio ${fx(v.ratio, 5)}, angle ${sg(v.angle)}°, not θ — the step (length `
    + `${fx(Math.abs(du), 3)}) is added to a fixed length-1 baseline, so by arg(t) = atan2(du·sinθ, 1 + du·cosθ) `
    + `the angle reaches only θ/2 = ${fx(half, 1)}° when |du| = 1 and approaches θ itself only as |du| → ∞; it is `
    + `never exactly θ for a finite step.`;
}

/** One sentence on what the end of a tap changer means (end 1 divides, end 2 / 3 multiply). w = windings. */
function place(tc, w) {
  const e = tc.end;
  const what = tc.type === "RTC" ? "a ratio above 1 lowers it"
    : tc.type === "PTCasym" || tc.type === "PTCtab" ? "a positive angle turns it back and a ratio above 1 lowers it"
    : "a positive angle turns it back";
  const whatUp = tc.type === "RTC" ? "a ratio above 1 raises it"
    : tc.type === "PTCasym" || tc.type === "PTCtab" ? "a positive angle turns it forward and a ratio above 1 raises it"
    : "a positive angle turns it forward";
  if (e === 1) {
    return `On end 1, the 220 kV side fed by the grid, the voltage behind the tap changer is V / t, so it acts on ${w === 3 ? "both B2 and B3" : "B2"} against its own value: ${what}.`;
  }
  if (e === 2) return `On end 2 (110 kV) it multiplies the voltage at B2 by t: ${whatUp}${w === 3 ? "; B3 does not see it" : ""}.`;
  return `On end 3 (20 kV) it multiplies the voltage at B3 by t and acts on B3 only: ${whatUp}.`
    + (isPhase(tc) ? " B3 is fed only through TX, so the phase shift turns B3's angle but cannot steer any power." : "");
}

/** The full list item for one tap changer: formula with numbers, kind, end and its effect in this load flow. */
function tapItem(model, r, tc) {
  const v = tapValue(tc, model.end2Rule);
  const head = `${TAP_TYPES[tc.type]} on end ${tc.end} (${KVE[tc.end]} kV), step ${tc.step} (neutral ${tc.neutral}): ${v.formula}.`;
  const inv = v.inverted ? ` Read inverted (CGMES 2.4.15 conformity-case convention): ratio ${fx(v.ratio, 5)}, angle ${sg(v.angle)}°.` : "";
  const extra = tc.type === "PTCasym" ? asymExtra(tc, v) : "";
  const c = contributions(r, tc);
  const here = c.length
    ? " Here it changes " + lst(c.map((x) => `${x.bus} by ${sg(x.dv)} kV` + (isPhase(tc) || Math.abs(x.da) > 5e-4 ? ` and ${sg(x.da)}°` : ""))) + "."
    : "";
  return head + inv + " " + KIND[tc.type] + extra + " " + place(tc, model.windings) + here;
}

/** Effective ratio from B1 to each other bus as text: "B1 → B2: t2 / t1 = 0.96386 at +0.000°". */
function pathText(model, r) {
  const t1 = r.tEnd[1];
  const out = [];
  for (let k = 2; k <= model.windings; k++) {
    const q = div(r.tEnd[k], t1);
    out.push(`B1 → B${k}: t${k} / t1 = ${fx(abs(q), 5)} at ${sg(arg(q) * DEG)}°`);
  }
  return out;
}

/** Paragraphs on how the tap changers combine (product per end, end 1 against the others, three-winding paths). */
function interaction(model, r) {
  const taps = model.taps;
  const paras = [];
  const ends = [...new Set(taps.map((t) => t.end))].sort();
  paras.push("Between the buses only the product of each end's tap changers counts, divided by end 1's: "
    + pathText(model, r).join("; ") + " (1 at 0° would be the plain transformer).");
  for (const e of ends) {
    const on = taps.filter((t) => t.end === e);
    if (on.length < 2) continue;
    const t = r.tEnd[e];
    paras.push(`End ${e} carries a ratio and a phase tap changer. Their complex ratios multiply: t${e} = t_ratio · t_phase = ${fx(abs(t), 5)} at ${sg(arg(t) * DEG)}°. Both must be applied to the same end: dropping one, or putting one on another end, changes the result.`);
  }
  if (ends.includes(1) && ends.some((e) => e > 1)) {
    paras.push("End 1 works against the other ends on the path from B1: the same value on end 1 and on end k cancels (t_k / t_1 = 1). A program that puts a tap changer on the wrong end therefore inverts its effect.");
  }
  if (model.windings === 3) {
    paras.push(ends.includes(1)
      ? "Three-winding transformer: end 1 is common to both paths, so its tap changers move B2 and B3 together; tap changers on end 2 or end 3 act only on their own bus."
      : `Three-winding transformer: the tap changers sit on ${ends.map((e) => "end " + e).join(" and ")} only, so they act on ${ends.map((e) => "B" + e).join(" and ")} only; ${[2, 3].filter((k) => !ends.includes(k)).map((k) => "B" + k + " keeps t" + k + " / t1 = 1").join(", ") || "end 1 has none"}.`);
  }
  return paras;
}

/**
 * What the network makes of the tap changers: at no load the open-circuit voltages; with load and TP the
 * circulating flow, found by solving the same model once more without tap changers and taking the difference.
 * @returns {{title:string, paras:string[]}}
 */
function network(model, r) {
  const w = model.windings;
  const f = r.flows;
  if (model.noLoad) {
    const v1 = r.buses.B1.vKv;
    const paras = [`TX alone, energized from B1 at ${fx(v1, 1)} kV with ${w === 2 ? "B2" : "B2 and B3"} open. No load current flows, so the open-circuit voltages show the tap configuration directly: V_k = V_B1 · (U_k / 220 kV) · t_k / t_1.`];
    const rows = [];
    for (let k = 2; k <= w; k++) {
      const q = div(r.tEnd[k], r.tEnd[1]);
      const b = r.buses[`B${k}`];
      rows.push(`B${k}: ${fx(b.vKv)} kV at ${sg(b.angleDeg)}° (the formula gives ${fx(v1 * KVE[k] / 220 * abs(q))} kV at ${sg(arg(q) * DEG)}°; the small rest is the magnetizing current)`);
    }
    paras.push(rows.join("; ") + ".");
    paras.push(`Only the magnetizing branch on end 1 draws power: ${fx(f["TX T1"].p, 4)} MW and ${fx(f["TX T1"].q, 4)} Mvar.`
      + (model.taps.some(isPhase) ? " A phase shifter steers nothing here (no load, no parallel path): its angle appears directly as the angle of the open bus." : ""));
    return { title: "No load", paras };
  }
  const load = `Load ${model.loads.B2.p} MW / ${model.loads.B2.q} Mvar at B2` + (w === 3 ? ` and ${model.loads.B3.p} MW / ${model.loads.B3.q} Mvar at B3` : "");
  if (!model.tp.on) {
    return { title: "With load, no parallel transformer", paras: [`${load}. TP is switched off, so there is no parallel path: the load alone decides the power through TX (${fx(f["TX T1"].p, 1)} MW at B1). The tap changers only move the voltages; a phase shifter only turns the angle at B2 and steers no power.`] };
  }
  const m0 = structuredClone(model);
  m0.taps = [];
  const r0 = solve(m0);
  const paras = [`${load}; the plain transformer TP (no tap changer) is in parallel with TX between B1 and B2.`];
  if (!r0.ok) return { title: "With load and parallel TP", paras };
  const tx = f["TX T1"], tp = f["TP T1"], tx0 = r0.flows["TX T1"], tp0 = r0.flows["TP T1"];
  paras.push(`Without tap changers TX would take ${fx(tx0.p, 1)} MW / ${fx(tx0.q, 1)} Mvar at B1 and TP ${fx(tp0.p, 1)} MW / ${fx(tp0.q, 1)} Mvar`
    + (w === 2 ? " (two equal transformers share the load evenly)" : " (TX also feeds B3, so the two do not share evenly even without taps)")
    + `. With these steps TX takes ${fx(tx.p, 1)} MW / ${fx(tx.q, 1)} Mvar and TP ${fx(tp.p, 1)} MW / ${fx(tp.q, 1)} Mvar.`);
  const q = div(r.tEnd[2], r.tEnd[1]);
  const dP = tx.p - tx0.p, dQ = tx.q - tx0.q;
  if (Math.abs(abs(q) - 1) < 1e-9 && Math.abs(arg(q)) < 1e-9) {
    paras.push("The tap changers leave the path B1 → B2 unchanged (t2 / t1 = 1), so the loop TX – TP sees nothing" + (w === 3 ? "; only B3's voltage moves." : "."));
  } else {
    paras.push(`So ${fx(Math.abs(dP), 1)} MW and ${fx(Math.abs(dQ), 1)} Mvar circulate in the loop B1 – TX – B2 – TP: TX takes ${dP >= 0 ? "more" : "less"} active and ${dQ >= 0 ? "more" : "less"} reactive power than without tap changers. `
      + `The angle of t2 / t1 (${sg(arg(q) * DEG)}°) drives the active part, its magnitude (${fx(abs(q), 5)}) the reactive part: a phase shifter steers active power, a ratio tap changer reactive power. `
      + "That is why a wrong angle or ratio in a program shows up as a wrong split between TX and TP.");
  }
  return { title: "With load and parallel TP", paras };
}

/** List items: the typical mistakes a program reading this case can make, with the numbers of this case. */
function reading(model, r) {
  const items = [];
  const w = model.windings;
  for (const tc of [...model.taps].sort(order)) {
    const v = tapValue(tc, model.end2Rule);
    const n = tc.step - tc.neutral;
    if (tc.type === "RTC" && tc.end === 1) items.push(`RatioTapChanger on end 1: ${w === 3 ? "B2 and B3 get" : "B2 gets"} 1 / t = ${fx(1 / v.ratio, 5)}, not t = ${fx(v.ratio, 5)}.`);
    if (tc.type === "RTC" && tc.end > 1) items.push(`RatioTapChanger on end ${tc.end}: t = ${fx(v.ratio, 5)} multiplies B${tc.end}; moved to end 1 it would act the other way.`);
    if (tc.type === "PTCsym") items.push(`Symmetrical: angle = 2 · atan(n · du / 2) = ${sg(v.angle)}°, not the small-angle value n · du = ${sg(n * tc.vsi / 100 * DEG)}°; magnitude 1.`);
    if (tc.type === "PTCasym") items.push(`Asymmetrical: keep the in-phase part of the booster: ratio ${fx(v.ratio, 5)} (not 1) with ${sg(v.angle)}°.`);
    if (tc.type === "PTCtab") items.push(`Tabular: take point ${tc.step} of the table (${sg(v.angle, 1)}°, ratio ${fx(v.ratio, 3)}); do not interpolate a linear law.`);
    if ((tc.type === "PTClin" || tc.type === "PTCtab") && tc.end > 1) {
      // solve once more with the other end-2 reading, to show what the wrong sign would give
      const alt = structuredClone(model);
      alt.end2Rule = model.end2Rule === "invert" ? "keep" : "invert";
      let ra = null;
      try { ra = solveWithControl(alt); } catch { ra = null; }
      const b = `B${tc.end}`;
      const now = r.buses[b], other = ra && ra.ok ? ra.buses[b] : null;
      items.push(`Sign on end ${tc.end}: ENTSO-E's CGMES 3.0 data read the angle of a ${tc.type === "PTClin" ? "linear" : "tabular"} phase tap changer on its own winding; ENTSO-E's CGMES 2.4.15 conformity cases read it inverted, seen from end 1. This page uses the ${model.end2Rule === "invert" ? "inverted" : "own-winding"} reading`
        + (other ? `: ${b} is ${fx(now.vKv)} kV at ${sg(now.angleDeg)}°; read the other way it would be ${fx(other.vKv)} kV at ${sg(other.angleDeg)}°.` : "."));
    }
  }
  const ends = [...new Set(model.taps.map((t) => t.end))];
  for (const e of ends) if (model.taps.filter((t) => t.end === e).length > 1) items.push(`Two tap changers on end ${e}: multiply their ratios; neither may be dropped.`);
  if (w === 3 && model.taps.length) items.push("Three-winding transformer: every tap changer belongs to its own PowerTransformerEnd; attached to another end it would move the wrong bus.");
  return items;
}

/**
 * Explanation of the current model and its load-flow result r (solveWithControl). Returns
 * { key, pair, sections: [{ id, title, paras?, items?, table?, actions? }] } with plain-text strings.
 * @param {object} model the simulator model (see defaultModel in solver.mjs).
 * @param {object} r its result from solveWithControl().
 * @param {object[]} presets presets.json (to find the matching pair of example cases); [] = no pair section.
 * @param {Function|null} defaultModel from solver.mjs; needed to tell whether the user changed the preset.
 * @throws {Error} only if solve() throws for the comparison model without tap changers.
 */
export function explain(model, r, presets = [], defaultModel = null) {
  const w = model.windings;
  const taps = [...model.taps].sort(order);
  const pair = findPair(model, presets);
  const sections = [];
  const names = taps.map((t) => `a ${TAP_TYPES[t.type]} on end ${t.end} (${KVE[t.end]} kV)`);
  const combo = [`${w === 2 ? "Two-winding 220/110 kV" : "Three-winding 220/110/20 kV"} transformer TX with ${taps.length ? lst(names) : "no tap changer"}.`];
  const nr = taps.filter((t) => !isPhase(t)).length, np = taps.length - nr;
  if (!taps.length) combo.push("Without tap changers TX is a plain transformer: " + (w === 2 ? "it shares the load evenly with TP." : "all voltages follow from the rated voltages and the load."));
  else if (!np) combo.push(`Only ratio tap changer${nr > 1 ? "s" : ""}: ${nr > 1 ? "they change" : "it changes"} voltage magnitudes, never angles.`);
  else if (!nr) {
    const mag = taps.some((t) => t.type === "PTCasym" || t.type === "PTCtab");
    combo.push(`Only phase tap changer${np > 1 ? "s" : ""}: ${np > 1 ? "they turn" : "it turns"} the voltage angle`
      + (mag ? `, and the asymmetrical or tabular type also ${np > 1 ? "changes" : "changes"} the magnitude.` : "; the magnitude stays."));
  }
  else {
    const ne = new Set(taps.map((t) => t.end)).size;
    combo.push(`Ratio and phase tap changers together: magnitude and angle change at the same time, ${ne === 1 ? "on the same end" : ne < taps.length ? "partly on the same end" : "on different ends"}.`);
  }
  if (pair) {
    combo.push(`This is configuration ${pair.row} of the 32 example configurations; it comes as a pair: ${pair.tc ? pair.tc.code + " (with load)" : ""}${pair.tc && pair.nl ? " and " : ""}${pair.nl ? pair.nl.code + " (no load)" : ""}.`);
    const cur = model.noLoad ? pair.nl : pair.tc;
    if (cur && defaultModel && normalized(model) !== normalized(presetModel(cur, defaultModel))) {
      combo.push(`You have changed steps or data since ${cur.code}: the text below uses the current values, the pair table the case's values.`);
    }
  } else if (taps.length) {
    combo.push("No example case has exactly this combination; the explanation is built from the parts.");
  }
  sections.push({ id: "combo", title: "This combination", paras: combo });
  if (taps.length) sections.push({ id: "taps", title: "What each tap changer does", items: taps.map((t) => tapItem(model, r, t)) });
  if (taps.length) sections.push({ id: "combine", title: taps.length > 1 ? "How they combine" : "Effective ratio", paras: interaction(model, r) });
  const net = network(model, r);
  sections.push({ id: "network", title: net.title, paras: net.paras });
  if (pair) {
    const cases = [pair.tc, pair.nl].filter(Boolean);
    const buses = w === 2 ? ["B2"] : ["B2", "B3"];
    const rows = buses.map((b) => [`${b} (V, angle)`, ...cases.map((p) => `${fx(p.expected[b][0])} kV, ${sg(p.expected[b][1])}°`)]);
    if (cases.some((p) => p.expected_inverted)) {
      for (const b of buses) rows.push([`${b} if end 2/3 is read inverted`, ...cases.map((p) => (p.expected_inverted ? `${fx(p.expected_inverted[b][0])} kV, ${sg(p.expected_inverted[b][1])}°` : "same"))]);
    }
    rows.push(["P into TX at B1", ...cases.map((p) => `${fx(p.expected_tx_p1, p.noload ? 4 : 1)} MW`)]);
    const paras = ["Both cases have the same tap changers at the same steps. The no-load case isolates the tap changers: TX alone, the other ends open, so the open-circuit voltages are exactly the tap configuration. The loaded case adds the load and the parallel TP: the same configuration now shows as a circulating flow, where a wrong ratio or angle becomes many MW or Mvar."];
    if (pair.tc && pair.nl) {
      const [vt, at] = pair.tc.expected.B2, [vn, an] = pair.nl.expected.B2;
      paras.push(`At no load B2 is at ${fx(vn)} kV and ${sg(an)}°, with load at ${fx(vt)} kV and ${sg(at)}°: load and TP add ${sg(at - an)}° and ${sg(vt - vn)} kV to what the tap changers alone give.`);
    }
    sections.push({ id: "pair", title: `The pair: ${cases.map((p) => p.code).join(" / ")}`, paras,
      table: { head: ["", ...cases.map((p) => p.code)], rows },
      actions: cases.map((p) => ({ code: p.code, label: `Open ${p.code} (${p.noload ? "no load" : "with load"})`, current: !!(model.noLoad === p.noload) })) });
  }
  const rd = reading(model, r);
  if (rd.length) sections.push({ id: "reading", title: "What a program reading this case must get right", items: rd });
  return { key: configKey(w, model.taps), pair, sections };
}

/** Escape text for HTML (&, <, >, "). */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML for the page; actions become buttons (live page) or links to the simulator (static page).
 * @param {object} ex result of explain(). @param {{links?:boolean}} opts links: true for explanations.html. */
export function renderHtml(ex, { links = false } = {}) {
  return ex.sections.map((s) => {
    let h = `<h3>${esc(s.title)}</h3>`;
    if (s.paras) h += s.paras.map((p) => `<p>${esc(p)}</p>`).join("");
    if (s.items) h += `<ul class="contrib">${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (s.table) {
      h += `<div class="scroll"><table><thead><tr>${s.table.head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`
        + s.table.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
    }
    if (s.actions) {
      h += `<p class="seg">` + s.actions.map((a) => (links
        ? `<a href="index.html#${esc(a.code)}">${esc(a.label)} in the simulator</a>`
        : `<button type="button" data-open="${esc(a.code)}" aria-pressed="${a.current}">${esc(a.label)}</button>`)).join(links ? " · " : "") + "</p>";
    }
    return `<section data-id="${s.id}">${h}</section>`;
  }).join("");
}

/** Markdown for EXPLANATIONS.md. @param {object} ex result of explain(). @param {number} level heading level. */
export function renderMarkdown(ex, level = 3) {
  const hh = "#".repeat(level);
  return ex.sections.map((s) => {
    let m = `${hh} ${s.title}\n\n`;
    if (s.paras) m += s.paras.join("\n\n") + "\n\n";
    if (s.items) m += s.items.map((i) => `- ${i}`).join("\n") + "\n\n";
    if (s.table) {
      m += `| ${s.table.head.join(" | ")} |\n|${s.table.head.map(() => "---").join("|")}|\n`
        + s.table.rows.map((row) => `| ${row.join(" | ")} |`).join("\n") + "\n\n";
    }
    return m;
  }).join("");
}
