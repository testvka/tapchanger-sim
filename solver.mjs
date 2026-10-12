// Load flow for the tap-configuration simulator: a slack bus B1, a two- or three-winding transformer TX with tap
// changers on any end, an optional plain parallel transformer TP (B1-B2) and loads at B2 / B3.
// Same model as tools/refpf.py, which produced the SVs of the 64 CGMES 3.0 test cases (checked by test_solver.mjs):
//  - every tap changer is an ideal transformer at its end's terminal: v_end = t * v_internal, t = ratio * e^(j angle);
//  - RTC: ratio = 1 + (n - n0) * stepVoltageIncrement / 100; PTC linear: angle = (n - n0) * stepPhaseShiftIncrement;
//    symmetrical: angle = 2 atan(n du / 2); asymmetrical: t = 1 + n du e^(j theta); tabular: table point;
//  - end2Rule "keep": every class describes its own winding; "invert": linear / tabular PTC on end 2/3 use 1/t
//    (the convention of ENTSO-E's CGMES 2.4.15 PST conformity cases);
//  - winding impedances on the internal side, magnetizing admittance split half/half (2W) or at the star point (3W);
//  - per unit on 100 MVA and the bus nominal voltages (= rated voltages); polar Newton-Raphson.

export const SBASE = 100;

// ---------------------------------------------------------------- complex numbers
export const C = (re, im = 0) => ({ re, im });
export const add = (a, b) => C(a.re + b.re, a.im + b.im);
export const sub = (a, b) => C(a.re - b.re, a.im - b.im);
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const conj = (a) => C(a.re, -a.im);
export const abs = (a) => Math.hypot(a.re, a.im);
export const arg = (a) => Math.atan2(a.im, a.re);
export const polar = (m, rad) => C(m * Math.cos(rad), m * Math.sin(rad));
export const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const scale = (a, k) => C(a.re * k, a.im * k);
const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- defaults (the data of the 64 test cases)
export const KV = { 1: 220, 2: 110, 3: 20 };
export function defaultModel(windings = 2) {
  return {
    windings,
    vSourceKv: 225,
    tx2: { S: 250, uk: 12, ur: 0.3, i0: 0, p0: 0 },
    tx3: { S: [250, 250, 60], uk12: 12, uk13: 6, uk23: 6, ur12: 0.30, ur13: 0.35, ur23: 0.35, i0: 0, p0: 0 },
    tp: { on: true, S: 250, uk: 12, ur: 0.3 },
    loads: { B2: { p: windings === 2 ? 200 : 160, q: windings === 2 ? 60 : 50 }, B3: { p: 30, q: 10 } },
    noLoad: false,
    end2Rule: "keep",
    taps: [],
  };
}

// ---------------------------------------------------------------- tap changers
export const TAP_TYPES = {
  RTC: "RatioTapChanger",
  PTClin: "PhaseTapChangerLinear",
  PTCsym: "PhaseTapChangerSymmetrical",
  PTCasym: "PhaseTapChangerAsymmetrical",
  PTCtab: "PhaseTapChangerTabular",
};

/** ratio, angle (deg) and t of one tap changer at its step, in its own winding's reading (or inverted). */
export function tapValue(tc, end2Rule = "keep") {
  const n = tc.step - tc.neutral;
  let ratio = 1;
  let angle = 0;
  let formula = "";
  if (tc.type === "RTC") {
    ratio = 1 + (n * tc.svi) / 100;
    formula = `ratio = 1 + (${tc.step} − ${tc.neutral}) · ${tc.svi} / 100 = ${ratio.toFixed(4)}`;
  } else if (tc.type === "PTClin") {
    angle = n * tc.deg;
    formula = `angle = (${tc.step} − ${tc.neutral}) · ${tc.deg}° = ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCsym") {
    const du = (n * tc.vsi) / 100;
    angle = deg(2 * Math.atan(du / 2));
    formula = `du = ${du.toFixed(4)}; angle = 2·atan(du/2) = ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCasym") {
    const du = (n * tc.vsi) / 100;
    const c = C(1 + du * Math.cos(rad(tc.theta)), du * Math.sin(rad(tc.theta)));
    ratio = abs(c);
    angle = deg(arg(c));
    formula = `t = 1 + ${du.toFixed(4)}·e^(j${tc.theta}°) = ${c.re.toFixed(5)} + j${c.im.toFixed(5)}: ratio ${ratio.toFixed(5)}, angle ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCtab") {
    const p = tc.table.find((x) => x.step === tc.step) || { angle: 0, ratio: 1 };
    ratio = p.ratio;
    angle = p.angle;
    formula = `table point ${tc.step}: angle ${angle}°, ratio ${ratio}`;
  }
  let inverted = false;
  if (end2Rule === "invert" && tc.end > 1 && (tc.type === "PTClin" || tc.type === "PTCtab")) {
    ratio = 1 / ratio;
    angle = -angle;
    inverted = true;
  }
  return { ratio, angle, t: polar(ratio, rad(angle)), formula, inverted };
}

// ---------------------------------------------------------------- network
function stamp(Y, buses, y) {
  buses.forEach((bi, a) => buses.forEach((bj, b) => { Y[bi][bj] = add(Y[bi][bj], y[a][b]); }));
}

function terminalY(yint, a) {
  // Y = conj(A) * Yint * A with A = diag(a): currents into the element from its terminals
  return yint.map((row, i) => row.map((v, k) => mul(mul(conj(a[i]), v), a[k])));
}

export function build(model) {
  const w = model.windings;
  const names = w === 2 ? ["B1", "B2"] : ["B1", "B2", "B3"];
  const kv = names.map((b) => KV[+b[1]]);
  let nb = names.length;
  const tEnd = { 1: C(1), 2: C(1), 3: C(1) };
  const tapVals = model.taps.filter((tc) => tc.end <= w).map((tc) => ({ ...tc, ...tapValue(tc, model.end2Rule) }));
  tapVals.forEach((tv) => { tEnd[tv.end] = mul(tEnd[tv.end], tv.t); });
  const elements = [];
  // TX
  if (w === 2) {
    const d = model.tx2;
    const U1 = 220;
    const zOhm = (d.uk / 100) * (U1 * U1) / d.S;
    const r = (d.ur / 100) * (U1 * U1) / d.S;
    const x = Math.sqrt(Math.max(zOhm * zOhm - r * r, 1e-12));
    const zb = (U1 * U1) / SBASE;
    const z = C(r / zb, x / zb);
    const g = (d.p0 / 100) * d.S / (U1 * U1);
    const bm = -Math.sqrt(Math.max(d.i0 * d.i0 - d.p0 * d.p0, 0)) / 100 * d.S / (U1 * U1);
    const ym = scale(C(g, bm), zb);
    const y = div(C(1), z);
    const yint = [[add(y, scale(ym, 0.5)), scale(y, -1)], [scale(y, -1), add(y, scale(ym, 0.5))]];
    const a = [div(C(1), tEnd[1]), div(C(1), tEnd[2])];
    elements.push({ name: "TX", buses: [0, 1], terminals: ["TX T1", "TX T2"], Y: terminalY(yint, a),
                    data: { r_ohm: [r, 0], x_ohm: [x, 0], g_S: g, b_S: bm } });
  } else {
    const d = model.tx3;
    const [s1, s2, s3] = d.S;
    const u = [220, 110, 20];
    // exact pair impedances ur + j*sqrt(uk^2 - ur^2) on the smaller rating of the pair, then star (ohm per kV^2)
    const pair = (uk, ur, sa, sb) => C(ur / 100 / Math.min(sa, sb), Math.sqrt(Math.max(uk * uk - ur * ur, 0)) / 100 / Math.min(sa, sb));
    const z12 = pair(d.uk12, d.ur12, s1, s2), z13 = pair(d.uk13, d.ur13, s1, s3), z23 = pair(d.uk23, d.ur23, s2, s3);
    const zs = [scale(sub(add(z12, z13), z23), 0.5), scale(sub(add(z12, z23), z13), 0.5), scale(sub(add(z13, z23), z12), 0.5)];
    const star = nb++;
    const yint = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => C(0)));
    const rr = [], xx = [];
    for (let k = 0; k < 3; k++) {
      const r = zs[k].re * u[k] * u[k];
      const x = zs[k].im * u[k] * u[k];
      rr.push(r); xx.push(x);
      const zb = (u[k] * u[k]) / SBASE;
      const y = div(C(1), C(r / zb, x / zb));
      yint[k][k] = add(yint[k][k], y); yint[3][3] = add(yint[3][3], y);
      yint[k][3] = sub(yint[k][3], y); yint[3][k] = sub(yint[3][k], y);
    }
    const g = (d.p0 / 100) * s1 / (220 * 220);
    const bm = -Math.sqrt(Math.max(d.i0 * d.i0 - d.p0 * d.p0, 0)) / 100 * s1 / (220 * 220);
    yint[3][3] = add(yint[3][3], scale(C(g, bm), (220 * 220) / SBASE));
    const a = [div(C(1), tEnd[1]), div(C(1), tEnd[2]), div(C(1), tEnd[3]), C(1)];
    elements.push({ name: "TX", buses: [0, 1, 2, star], terminals: ["TX T1", "TX T2", "TX T3"], Y: terminalY(yint, a),
                    data: { r_ohm: rr, x_ohm: xx, g_S: g, b_S: bm, star_x_negative: zs.some((z) => z.im <= 0) } });
  }
  // TP
  if (model.tp.on && !model.noLoad) {
    const d = model.tp;
    const U1 = 220;
    const zOhm = (d.uk / 100) * (U1 * U1) / d.S;
    const r = (d.ur / 100) * (U1 * U1) / d.S;
    const x = Math.sqrt(Math.max(zOhm * zOhm - r * r, 1e-12));
    const zb = (U1 * U1) / SBASE;
    const y = div(C(1), C(r / zb, x / zb));
    elements.push({ name: "TP", buses: [0, 1], terminals: ["TP T1", "TP T2"], Y: [[y, scale(y, -1)], [scale(y, -1), y]] });
  }
  const Y = Array.from({ length: nb }, () => Array.from({ length: nb }, () => C(0)));
  elements.forEach((el) => stamp(Y, el.buses, el.Y));
  const load = Array.from({ length: nb }, () => C(0));
  if (!model.noLoad) {
    load[1] = C(model.loads.B2.p / SBASE, model.loads.B2.q / SBASE);
    if (w === 3) load[2] = C(model.loads.B3.p / SBASE, model.loads.B3.q / SBASE);
  }
  return { names, kv, nb, Y, load, elements, tapVals, tEnd, vs: model.vSourceKv / 220 };
}

// ---------------------------------------------------------------- Newton-Raphson
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error("singular Jacobian (island or zero impedance?)");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function solve(model, { tol = 1e-11, maxIter = 40 } = {}) {
  const net = build(model);
  const { nb, Y, load } = net;
  let V = Array.from({ length: nb }, () => C(1));
  V[0] = C(net.vs);
  const pq = [...Array(nb).keys()].slice(1);
  let it = 0;
  let mis = Infinity;
  for (; it < maxIter; it++) {
    const I = V.map((_, i) => Y[i].reduce((s, y, k) => add(s, mul(y, V[k])), C(0)));
    const S = V.map((v, i) => mul(v, conj(I[i])));
    const F = [...pq.map((i) => S[i].re + load[i].re), ...pq.map((i) => S[i].im + load[i].im)];
    mis = Math.max(...F.map(Math.abs));
    if (mis < tol) break;
    const m = pq.length;
    const J = Array.from({ length: 2 * m }, () => new Array(2 * m).fill(0));
    pq.forEach((i, a) => pq.forEach((k, b) => {
      const vn = div(V[k], C(abs(V[k])));
      const yv = mul(Y[i][k], V[k]);
      const dVa = mul(C(0, 1), mul(V[i], conj(sub(i === k ? I[i] : C(0), yv))));
      let dVm = mul(V[i], conj(mul(Y[i][k], vn)));
      if (i === k) dVm = add(dVm, mul(conj(I[i]), vn));
      J[a][b] = dVa.re; J[a][b + m] = dVm.re; J[a + m][b] = dVa.im; J[a + m][b + m] = dVm.im;
    }));
    const dx = solveLinear(J, F.map((f) => -f));
    pq.forEach((i, a) => {
      const vm = abs(V[i]) + dx[a + m];
      const va = arg(V[i]) + dx[a];
      V[i] = polar(vm, va);
    });
  }
  const ok = mis < 1e-8;
  return { ok, iterations: it, mismatchMva: mis * SBASE, ...results(model, net, V) };
}

function results(model, net, V) {
  const buses = {};
  net.names.forEach((b, i) => {
    buses[b] = { kvNominal: net.kv[i], vKv: abs(V[i]) * net.kv[i], vPu: abs(V[i]), angleDeg: deg(arg(V[i])), pu: V[i] };
  });
  const flows = {};
  const losses = {};
  net.elements.forEach((el) => {
    const vs = el.buses.map((b) => V[b]);
    let tot = C(0);
    el.terminals.forEach((t, a) => {
      const i = el.Y[a].reduce((s, y, k) => add(s, mul(y, vs[k])), C(0));
      const s = scale(mul(vs[a], conj(i)), SBASE);
      flows[t] = { p: s.re, q: s.im };
      tot = add(tot, s);
    });
    losses[el.name] = { p: tot.re, q: tot.im };
  });
  if (!model.noLoad) {
    flows["LD2"] = { p: model.loads.B2.p, q: model.loads.B2.q };
    if (model.windings === 3) flows["LD3"] = { p: model.loads.B3.p, q: model.loads.B3.q };
  }
  const atB1 = Object.entries(flows).filter(([k]) => k === "TX T1" || k === "TP T1");
  flows["Grid"] = { p: -atB1.reduce((s, [, f]) => s + f.p, 0), q: -atB1.reduce((s, [, f]) => s + f.q, 0) };
  return { buses, flows, losses, taps: net.tapVals, tEnd: net.tEnd, chains: chains(model, net, buses), elements: net.elements };
}

/** Contribution of each tap changer to the voltage of B2 (and B3): start V1 (no taps), / t1, * t_end, network. */
export function chains(model, net, buses) {
  // one step per tap changer: ÷ t for those on end 1, × t for those on end 2/3; two on one end: ratio first
  const v1 = buses.B1.pu;
  const out = [];
  const byEnd = {};
  net.tapVals.forEach((tv) => { (byEnd[tv.end] = byEnd[tv.end] || []).push(tv); });
  Object.values(byEnd).forEach((l) => l.sort((a, b) => (a.type !== "RTC") - (b.type !== "RTC")));
  const ends = model.windings === 2 ? [["B2", 2]] : [["B2", 2], ["B3", 3]];
  for (const [bus, end] of ends) {
    const steps = [];
    let z = v1;
    for (const e of [1, end]) {
      const lst = byEnd[e] || [];
      lst.forEach((tv, n) => {
        const nz = e === 1 ? div(z, tv.t) : mul(z, tv.t);
        steps.push({ no: e, sub: lst.length > 1 ? "ab"[n] : "", label: `${tv.type} end ${e}`,
                     kind: tv.type === "RTC" ? "rt" : "ph", op: e === 1 ? "÷ t" : "× t", a: z, b: nz });
        z = nz;
      });
    }
    steps.push({ no: 0, sub: "", label: model.noLoad ? "magnetizing current (no load)" : "network: load and parallel TP",
                 kind: "net", op: "", a: z, b: buses[bus].pu });
    out.push({ bus, kv: buses[bus].kvNominal, start: v1, steps });
  }
  return out;
}

// ---------------------------------------------------------------- automatic tap control
/** Value a controller looks at: "V:B2" / "V:B3" (kV) or "P:TX" (MW into TX at its 220 kV terminal). */
export function measured(result, target) {
  if (target.startsWith("V:")) return result.buses[target.slice(2)]?.vKv;
  return result.flows["TX T1"]?.p;
}

/**
 * Discrete tap control like a real controller: every round, each enabled controller whose value is outside
 * target ± deadband/2 moves its tap changer one step in the direction that reduces the error (found by a trial
 * step), until all values are inside their band or a tap changer reaches its limit. A controller stops when it
 * would move back to a step it just left after reversing (hunting: the band is narrower than one step's effect)
 * and does not move when one step does not change its value (e.g. a phase shifter without a parallel path).
 * Returns the final load flow, the moves and the state of each controller.
 */
export function solveWithControl(model, { maxRounds = 60 } = {}) {
  const ctl = model.taps.filter((t) => t.control && t.control.on);
  let r = solve(model);
  const log = [];
  const dir = new Map(), effect = new Map(), last = new Map(), stopped = new Map();
  for (let round = 0; round < maxRounds && r.ok; round++) {
    let moved = false;
    for (const tc of ctl) {
      const c = tc.control;
      const val = measured(r, c.target);
      if (val === undefined || stopped.has(tc) || Math.abs(val - c.value) <= c.deadband / 2) continue;
      if (!dir.has(tc)) {            // sensitivity: what does one step up do to the controlled value?
        const old = tc.step;
        tc.step = old < tc.high ? old + 1 : old - 1;
        const r2 = solve(model);
        const d = (measured(r2, c.target) - val) * (tc.step - old);
        tc.step = old;
        dir.set(tc, d > 0 ? 1 : -1);
        effect.set(tc, Math.abs(d));
        if (!(Math.abs(d) > 1e-6 * Math.max(1, Math.abs(val)))) { stopped.set(tc, "no effect"); continue; }
      }
      const want = val < c.value ? dir.get(tc) : -dir.get(tc);
      const next = Math.min(Math.max(tc.step + want, tc.low), tc.high);
      if (next === tc.step) continue;
      const prev = last.get(tc);
      if (prev && prev.want === -want && prev.reversed) { stopped.set(tc, "hunting"); continue; }   // second reversal
      last.set(tc, { want, reversed: prev ? prev.want === -want : false });
      log.push({ round, tap: `${tc.type} end ${tc.end}`, from: tc.step, to: next, value: val });
      tc.step = next;
      moved = true;
    }
    if (!moved) break;
    r = solve(model);
  }
  const state = ctl.map((tc) => {
    const val = measured(r, tc.control.target);
    const inside = Math.abs(val - tc.control.value) <= tc.control.deadband / 2;
    const why = stopped.get(tc);
    const status = inside ? "held" : why === "no effect" ? "no effect"
      : why === "hunting" ? "hunting" : (tc.step === tc.low || tc.step === tc.high ? "at limit" : "not held");
    return { tap: `${tc.type} end ${tc.end}`, target: tc.control.target, value: val, setpoint: tc.control.value,
             step: tc.step, status, stepEffect: effect.get(tc) };
  });
  return { ...r, controlLog: log, controlState: state };
}
