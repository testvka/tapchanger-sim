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
//
// For beginners (see docs/beginner/ for the long version):
//  - Where it sits: index.html (the page) imports this module; test_solver.mjs / test_control.mjs call it from
//    Node.js. It imports nothing itself.
//  - Main steps: defaultModel() gives the input data -> build() turns it into the admittance matrix Y and the loads
//    -> solve() finds the bus voltages with Newton-Raphson -> results() turns voltages into flows and losses ->
//    chains() splits the voltage change into one step per tap changer. solveWithControl() repeats solve() and moves
//    tap steps like an automatic controller.
//  - Read first: tapValue(), build(), solve(), solveWithControl().
//  - Words: bus = a node of the grid (B1, B2, B3); pu = per unit (a value divided by its base value, so 1.0 pu =
//    nominal); slack bus = the bus with a fixed voltage that supplies whatever power is missing (here B1, the grid);
//    TX = the transformer under test, TP = a plain parallel transformer; 2W / 3W = two- / three-winding;
//    RTC = RatioTapChanger (changes the voltage size), PTC = PhaseTapChanger (changes the voltage angle);
//    n = tap step, n0 = neutral step (the step where the tap changer does nothing); SV = the solved state of a
//    CGMES case (its expected answer); Y = admittance matrix (1/impedance, how easily current flows between buses).
//  - Complex numbers are plain objects { re, im } (real and imaginary part). A voltage phasor is such a number:
//    its length abs() is the voltage size, its direction arg() is the voltage angle.

/** Base power of the per-unit system, in MVA: 1.0 pu of power = 100 MVA. */
export const SBASE = 100;

// ---------------------------------------------------------------- complex numbers
// Tiny complex-number library. A complex number is an "arrow" in the plane: re = x part, im = y part.

/** Make a complex number re + j*im (j is the imaginary unit, j*j = -1). Example: C(1, 0.5). */
export const C = (re, im = 0) => ({ re, im });
/** a + b. */
export const add = (a, b) => C(a.re + b.re, a.im + b.im);
/** a - b. */
export const sub = (a, b) => C(a.re - b.re, a.im - b.im);
/** a * b: (ar + j ai)(br + j bi) = (ar br - ai bi) + j (ar bi + ai br). Lengths multiply, angles add. */
export const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
/** Complex conjugate: mirror the arrow on the x axis (same length, angle -> -angle). */
export const conj = (a) => C(a.re, -a.im);
/** Length of the arrow (magnitude): sqrt(re^2 + im^2). */
export const abs = (a) => Math.hypot(a.re, a.im);
/** Angle of the arrow in radians (-pi..pi), measured from the positive x axis. */
export const arg = (a) => Math.atan2(a.im, a.re);
/** Arrow with length m and angle rad (radians): m * (cos rad + j sin rad) = m * e^(j rad). */
export const polar = (m, rad) => C(m * Math.cos(rad), m * Math.sin(rad));
/** a / b: multiply by conj(b) and divide by |b|^2. Lengths divide, angles subtract. */
export const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
/** a * k for a real number k (stretch the arrow). */
export const scale = (a, k) => C(a.re * k, a.im * k);
/** Radians to degrees. */
const deg = (rad) => (rad * 180) / Math.PI;
/** Degrees to radians. */
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------- defaults (the data of the 64 test cases)
/** Nominal voltage in kV of each transformer end (= of the bus it connects to): end 1 = B1, end 2 = B2, end 3 = B3. */
export const KV = { 1: 220, 2: 110, 3: 20 };

/**
 * Input data of a simulator case with the values of the 64 CGMES test cases, without tap changers.
 * @param {number} windings 2 (two-winding TX, buses B1-B2) or 3 (three-winding TX, buses B1-B2-B3).
 * @returns {object} model: vSourceKv = grid voltage at B1 in kV (225); tx2 / tx3 = transformer nameplate data
 *   (S = rated power in MVA, uk = short-circuit voltage in %, ur = resistive part in %, i0 = no-load current in %,
 *   p0 = no-load losses in %); tp = the parallel transformer TP; loads in MW / Mvar; noLoad = true opens the other
 *   windings (no load, no TP); end2Rule "keep" or "invert" (see tapValue); taps = list of tap changers (empty).
 */
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
/** Short tap-changer type codes used in the model -> CGMES class names. */
export const TAP_TYPES = {
  RTC: "RatioTapChanger",
  PTClin: "PhaseTapChangerLinear",
  PTCsym: "PhaseTapChangerSymmetrical",
  PTCasym: "PhaseTapChangerAsymmetrical",
  PTCtab: "PhaseTapChangerTabular",
};

/**
 * Ratio, angle (deg) and t of one tap changer at its step, in its own winding's reading (or inverted).
 * The tap changer works like an ideal transformer at its end: v_terminal = t * v_internal, t = ratio * e^(j angle).
 * @param {object} tc tap changer: { type: "RTC"|"PTClin"|"PTCsym"|"PTCasym"|"PTCtab", end: 1|2|3, step, neutral,
 *   svi (RTC: % per step, e.g. 1.25), deg (PTClin: degrees per step, e.g. 1.5), vsi (PTCsym/asym: % per step),
 *   theta (PTCasym: windingConnectionAngle in degrees, e.g. 60), table (PTCtab: [{step, angle, ratio}]) }.
 *   Example: { type: "RTC", end: 1, step: 14, neutral: 11, svi: 1.25 } gives ratio 1.0375.
 * @param {string} end2Rule "keep" (each tap changer describes its own winding) or "invert" (PTClin / PTCtab on
 *   end 2 or 3 use 1/ratio and -angle, an older convention).
 * @returns {{ratio:number, angle:number, t:object, formula:string, inverted:boolean}} ratio (no unit), angle in
 *   degrees, t as a complex number, the formula as text for the page, and whether the inversion was applied.
 */
export function tapValue(tc, end2Rule = "keep") {
  const n = tc.step - tc.neutral;          // steps away from neutral (0 = the tap changer does nothing)
  let ratio = 1;
  let angle = 0;
  let formula = "";
  if (tc.type === "RTC") {
    // Ratio tap changer: each step adds stepVoltageIncrement % to the voltage, no angle.
    ratio = 1 + (n * tc.svi) / 100;
    formula = `ratio = 1 + (${tc.step} − ${tc.neutral}) · ${tc.svi} / 100 = ${ratio.toFixed(4)}`;
  } else if (tc.type === "PTClin") {
    // Linear phase shifter: each step turns the voltage by a fixed angle, size unchanged.
    angle = n * tc.deg;
    formula = `angle = (${tc.step} − ${tc.neutral}) · ${tc.deg}° = ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCsym") {
    // Symmetrical phase shifter: an added voltage du at 90° to the voltage, split half on each side, so the
    // size stays the same and the angle is 2 * atan(du / 2).
    const du = (n * tc.vsi) / 100;
    angle = deg(2 * Math.atan(du / 2));
    formula = `du = ${du.toFixed(4)}; angle = 2·atan(du/2) = ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCasym") {
    // Asymmetrical phase shifter: an added voltage du at the fixed angle theta (windingConnectionAngle).
    // c = 1 + du * e^(j theta); both the size (ratio = |c|) and the angle (arg c) change.
    const du = (n * tc.vsi) / 100;
    const c = C(1 + du * Math.cos(rad(tc.theta)), du * Math.sin(rad(tc.theta)));
    ratio = abs(c);
    angle = deg(arg(c));
    formula = `c = 1 + ${du.toFixed(4)}·e^(j${tc.theta}°) = ${c.re.toFixed(5)} + j${c.im.toFixed(5)}: ratio ${ratio.toFixed(5)}, angle ${angle.toFixed(3)}°`;
  } else if (tc.type === "PTCtab") {
    // Tabular phase shifter: the angle and ratio are read from a table row (missing row -> no effect).
    const p = tc.table.find((x) => x.step === tc.step) || { angle: 0, ratio: 1 };
    ratio = p.ratio;
    angle = p.angle;
    formula = `table point ${tc.step}: angle ${angle}°, ratio ${ratio}`;
  }
  let inverted = false;
  // Optional old convention: linear / tabular phase shifters on end 2 or 3 are read "from the other side".
  if (end2Rule === "invert" && tc.end > 1 && (tc.type === "PTClin" || tc.type === "PTCtab")) {
    ratio = 1 / ratio;
    angle = -angle;
    inverted = true;
  }
  return { ratio, angle, t: polar(ratio, rad(angle)), formula, inverted };
}

// ---------------------------------------------------------------- network
/**
 * Add ("stamp") the small matrix y of one element into the big bus matrix Y, in place.
 * @param {object[][]} Y bus admittance matrix (complex, pu), changed in place.
 * @param {number[]} buses bus index of each element terminal, e.g. [0, 1].
 * @param {object[][]} y element admittance matrix, same order as buses.
 */
function stamp(Y, buses, y) {
  // same as: for a, for b: Y[buses[a]][buses[b]] += y[a][b]
  buses.forEach((bi, a) => buses.forEach((bj, b) => { Y[bi][bj] = add(Y[bi][bj], y[a][b]); }));
}

/**
 * Move an element matrix from the internal side of the ideal tap transformers to the bus terminals.
 * @param {object[][]} yint admittance matrix between the internal nodes (pu).
 * @param {object[]} a per terminal: internal voltage = a * bus voltage (a = 1 / t).
 * @returns {object[][]} Y_terminal[i][k] = conj(a_i) * yint[i][k] * a_k.
 */
function terminalY(yint, a) {
  // Y = conj(A) * Yint * A with A = diag(a): currents into the element from its terminals
  // Why: v_internal = a * v_bus, and an ideal transformer keeps power, so i_bus = conj(a) * i_internal.
  return yint.map((row, i) => row.map((v, k) => mul(mul(conj(a[i]), v), a[k])));
}

/**
 * Turn the model into network data: bus list, admittance matrix Y, loads and the element matrices.
 * @param {object} model see defaultModel(); model.taps lists the tap changers (tapValue() for the fields).
 * @returns {object} { names: ["B1","B2"(,"B3")], kv: nominal kV per bus, nb: number of nodes (3W adds a hidden
 *   star point), Y: nb x nb complex matrix in pu, load: complex load per node in pu (P + jQ, consumed),
 *   elements: [{ name, buses, terminals, Y, data }], tapVals: tap changers with ratio/angle/t, tEnd: product of the
 *   t of all tap changers per end, vs: B1 voltage in pu }.
 */
export function build(model) {
  const w = model.windings;
  const names = w === 2 ? ["B1", "B2"] : ["B1", "B2", "B3"];
  const kv = names.map((b) => KV[+b[1]]);      // "B2" -> KV[2] = 110
  let nb = names.length;
  // Total tap factor per end. Two tap changers on one end act one after the other, so their t multiply.
  const tEnd = { 1: C(1), 2: C(1), 3: C(1) };
  const tapVals = model.taps.filter((tc) => tc.end <= w).map((tc) => ({ ...tc, ...tapValue(tc, model.end2Rule) }));
  tapVals.forEach((tv) => { tEnd[tv.end] = mul(tEnd[tv.end], tv.t); });
  const elements = [];
  // TX
  if (w === 2) {
    const d = model.tx2;
    const U1 = 220;
    // Nameplate -> ohm on the 220 kV side: |z| = uk/100 * U^2 / S, r = ur/100 * U^2 / S, x = sqrt(|z|^2 - r^2).
    // Example: uk 12 %, ur 0.3 %, S 250 MVA: |z| = 0.12 * 220^2 / 250 = 23.232 ohm, r = 0.5808 ohm, x = 23.225 ohm.
    const zOhm = (d.uk / 100) * (U1 * U1) / d.S;
    const r = (d.ur / 100) * (U1 * U1) / d.S;
    const x = Math.sqrt(Math.max(zOhm * zOhm - r * r, 1e-12));
    const zb = (U1 * U1) / SBASE;               // base impedance in ohm: U^2 / Sbase = 484 ohm
    const z = C(r / zb, x / zb);                // series impedance in pu
    // Magnetizing branch (no-load data): g = p0/100 * S / U^2 (siemens, iron losses),
    // b = -sqrt(i0^2 - p0^2)/100 * S / U^2 (siemens, negative = inductive, the core draws reactive power).
    const g = (d.p0 / 100) * d.S / (U1 * U1);
    const bm = -Math.sqrt(Math.max(d.i0 * d.i0 - d.p0 * d.p0, 0)) / 100 * d.S / (U1 * U1);
    const ym = scale(C(g, bm), zb);             // siemens -> pu: multiply by the base impedance
    const y = div(C(1), z);                     // series admittance y = 1 / z
    // Pi model between the two internal nodes: y in series, half of the magnetizing admittance at each side.
    const yint = [[add(y, scale(ym, 0.5)), scale(y, -1)], [scale(y, -1), add(y, scale(ym, 0.5))]];
    // v_internal = v_bus / t_end, so a = 1 / t.
    const a = [div(C(1), tEnd[1]), div(C(1), tEnd[2])];
    elements.push({ name: "TX", buses: [0, 1], terminals: ["TX T1", "TX T2"], Y: terminalY(yint, a),
                    data: { r_ohm: [r, 0], x_ohm: [x, 0], g_S: g, b_S: bm } });
  } else {
    const d = model.tx3;
    const [s1, s2, s3] = d.S;
    const u = [220, 110, 20];
    // exact pair impedances ur + j*sqrt(uk^2 - ur^2) on the smaller rating of the pair, then star (ohm per kV^2)
    // A 3-winding transformer is measured in pairs (1-2, 1-3, 2-3). The star (T) equivalent has one impedance per
    // winding joined at a hidden star point: z1 = (z12 + z13 - z23) / 2, z2 = (z12 + z23 - z13) / 2,
    // z3 = (z13 + z23 - z12) / 2. Here z is in "ohm per kV^2", so z * U^2 gives ohm on each winding's voltage.
    const pair = (uk, ur, sa, sb) => C(ur / 100 / Math.min(sa, sb), Math.sqrt(Math.max(uk * uk - ur * ur, 0)) / 100 / Math.min(sa, sb));
    const z12 = pair(d.uk12, d.ur12, s1, s2), z13 = pair(d.uk13, d.ur13, s1, s3), z23 = pair(d.uk23, d.ur23, s2, s3);
    const zs = [scale(sub(add(z12, z13), z23), 0.5), scale(sub(add(z12, z23), z13), 0.5), scale(sub(add(z13, z23), z12), 0.5)];
    const star = nb++;                          // the star point becomes an extra (hidden) node
    const yint = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => C(0)));
    const rr = [], xx = [];
    for (let k = 0; k < 3; k++) {
      const r = zs[k].re * u[k] * u[k];         // ohm on winding k's rated voltage
      const x = zs[k].im * u[k] * u[k];
      rr.push(r); xx.push(x);
      const zb = (u[k] * u[k]) / SBASE;
      const y = div(C(1), C(r / zb, x / zb));
      // branch between internal node k and the star point (index 3)
      yint[k][k] = add(yint[k][k], y); yint[3][3] = add(yint[3][3], y);
      yint[k][3] = sub(yint[k][3], y); yint[3][k] = sub(yint[3][k], y);
    }
    // magnetizing admittance (see the 2W case) at the star point, on the 220 kV base and S1
    const g = (d.p0 / 100) * s1 / (220 * 220);
    const bm = -Math.sqrt(Math.max(d.i0 * d.i0 - d.p0 * d.p0, 0)) / 100 * s1 / (220 * 220);
    yint[3][3] = add(yint[3][3], scale(C(g, bm), (220 * 220) / SBASE));
    // the star point has no tap changer: a = 1
    const a = [div(C(1), tEnd[1]), div(C(1), tEnd[2]), div(C(1), tEnd[3]), C(1)];
    elements.push({ name: "TX", buses: [0, 1, 2, star], terminals: ["TX T1", "TX T2", "TX T3"], Y: terminalY(yint, a),
                    data: { r_ohm: rr, x_ohm: xx, g_S: g, b_S: bm, star_x_negative: zs.some((z) => z.im <= 0) } });
  }
  // TP
  // The plain parallel transformer B1-B2 (no tap changer). It is left out at no load (B2 is open there).
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
  // Bus admittance matrix: the sum of all element matrices.
  const Y = Array.from({ length: nb }, () => Array.from({ length: nb }, () => C(0)));
  elements.forEach((el) => stamp(Y, el.buses, el.Y));
  // Loads in pu (MW / 100, Mvar / 100); positive = consumed.
  const load = Array.from({ length: nb }, () => C(0));
  if (!model.noLoad) {
    load[1] = C(model.loads.B2.p / SBASE, model.loads.B2.q / SBASE);
    if (w === 3) load[2] = C(model.loads.B3.p / SBASE, model.loads.B3.q / SBASE);
  }
  return { names, kv, nb, Y, load, elements, tapVals, tEnd, vs: model.vSourceKv / 220 };
}

// ---------------------------------------------------------------- Newton-Raphson
/**
 * Solve the linear system A x = b (real numbers) by Gaussian elimination with row pivoting.
 * @param {number[][]} A square matrix (the Jacobian), not changed.
 * @param {number[]} b right-hand side.
 * @returns {number[]} x.
 * @throws {Error} "singular Jacobian ..." when a pivot is (almost) zero, e.g. a bus with no connection.
 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);   // augmented matrix [A | b]
  for (let c = 0; c < n; c++) {
    // pivoting: use the row with the largest value in column c (better accuracy)
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error("singular Jacobian (island or zero impedance?)");
    [M[c], M[p]] = [M[p], M[c]];
    // eliminate column c from all rows below
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  // back substitution: solve from the last row upwards
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Load flow: find the bus voltages for which every bus (except the slack B1) gets exactly its load.
 * Newton-Raphson in polar form: unknowns are angle and size of each voltage; repeat "compute mismatch, linearise
 * (Jacobian), solve for a correction" until the mismatch is below tol.
 * @param {object} model see defaultModel().
 * @param {{tol?:number, maxIter?:number}} opts tol = largest allowed power mismatch in pu (1e-11 pu = 1e-9 MVA).
 * @returns {object} { ok: converged (mismatch < 1e-8 pu), iterations, mismatchMva, buses, flows, losses, taps,
 *   tEnd, chains, elements } (see results()). Does not throw when it does not converge; ok is then false.
 * @throws {Error} from solveLinear() when the Jacobian is singular.
 */
export function solve(model, { tol = 1e-11, maxIter = 40 } = {}) {
  const net = build(model);
  const { nb, Y, load } = net;
  // flat start: every voltage 1.0 pu at 0 degrees, B1 at the source voltage
  let V = Array.from({ length: nb }, () => C(1));
  V[0] = C(net.vs);
  const pq = [...Array(nb).keys()].slice(1);     // all nodes except the slack B1 (index 0) are unknown (PQ buses)
  let it = 0;
  let mis = Infinity;
  for (; it < maxIter; it++) {
    // I = Y V (current injected at each node), S = V conj(I) (complex power injected, P + jQ in pu)
    const I = V.map((_, i) => Y[i].reduce((s, y, k) => add(s, mul(y, V[k])), C(0)));
    const S = V.map((v, i) => mul(v, conj(I[i])));
    // mismatch: injected power + load must be 0 at every PQ node (first all P rows, then all Q rows)
    const F = [...pq.map((i) => S[i].re + load[i].re), ...pq.map((i) => S[i].im + load[i].im)];
    mis = Math.max(...F.map(Math.abs));
    if (mis < tol) break;
    const m = pq.length;
    // Jacobian J = d(mismatch) / d(angles, sizes), 2m x 2m. Complex derivatives of S_i:
    //   dS_i/dtheta_k = j V_i conj(delta_ik I_i - Y_ik V_k)
    //   dS_i/d|V_k|   = V_i conj(Y_ik V_k/|V_k|) + delta_ik conj(I_i) V_k/|V_k|   (delta_ik = 1 if i = k, else 0)
    // Real parts go to the P rows, imaginary parts to the Q rows.
    const J = Array.from({ length: 2 * m }, () => new Array(2 * m).fill(0));
    pq.forEach((i, a) => pq.forEach((k, b) => {
      const vn = div(V[k], C(abs(V[k])));
      const yv = mul(Y[i][k], V[k]);
      const dVa = mul(C(0, 1), mul(V[i], conj(sub(i === k ? I[i] : C(0), yv))));
      let dVm = mul(V[i], conj(mul(Y[i][k], vn)));
      if (i === k) dVm = add(dVm, mul(conj(I[i]), vn));
      J[a][b] = dVa.re; J[a][b + m] = dVm.re; J[a + m][b] = dVa.im; J[a + m][b + m] = dVm.im;
    }));
    // Newton step: J dx = -F, then angle += dx[angle part], size += dx[size part]
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

/**
 * Turn the solved voltages into the numbers shown on the page.
 * @param {object} model the input model. @param {object} net output of build(). @param {object[]} V voltages (pu).
 * @returns {object} buses: { B1: { kvNominal, vKv (kV), vPu, angleDeg, pu (complex) }, ... };
 *   flows: { "TX T1": { p (MW), q (Mvar) }, ... } = power flowing INTO the element at that terminal
 *   (load sign), plus LD2/LD3 (loads) and Grid (power the grid at B1 delivers); losses: per element, MW / Mvar
 *   (sum of the terminal flows); taps, tEnd, chains (see chains()), elements.
 */
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
      // current into the element at terminal a: i = sum_k Y[a][k] * v_k; power s = v * conj(i) * 100 MVA
      const i = el.Y[a].reduce((s, y, k) => add(s, mul(y, vs[k])), C(0));
      const s = scale(mul(vs[a], conj(i)), SBASE);
      flows[t] = { p: s.re, q: s.im };
      tot = add(tot, s);                          // what goes in at all terminals together = losses
    });
    losses[el.name] = { p: tot.re, q: tot.im };
  });
  if (!model.noLoad) {
    flows["LD2"] = { p: model.loads.B2.p, q: model.loads.B2.q };
    if (model.windings === 3) flows["LD3"] = { p: model.loads.B3.p, q: model.loads.B3.q };
  }
  // the grid at B1 supplies what TX and TP take at B1 (sign flipped: positive = delivered to B1's elements)
  const atB1 = Object.entries(flows).filter(([k]) => k === "TX T1" || k === "TP T1");
  flows["Grid"] = { p: -atB1.reduce((s, [, f]) => s + f.p, 0), q: -atB1.reduce((s, [, f]) => s + f.q, 0) };
  return { buses, flows, losses, taps: net.tapVals, tEnd: net.tEnd, chains: chains(model, net, buses), elements: net.elements };
}

/**
 * Contribution of each tap changer to the voltage of B2 (and B3): start V1 (no taps), / t1, * t_end, network.
 * Used for the phasor chain and the waterfall chart on the page.
 * @param {object} model the input model. @param {object} net output of build(). @param {object} buses from results().
 * @returns {object[]} per bus B2 (and B3): { bus, kv, start: V1 (complex pu), steps: [{ label, op, kind
 *   ("rt" ratio / "ph" phase / "net" network), a: phasor before, b: phasor after }] }. The last step is the
 *   network part: from the ideal no-impedance voltage to the solved voltage.
 */
export function chains(model, net, buses) {
  // one step per tap changer: ÷ t for those on end 1, × t for those on end 2/3; two on one end: ratio first
  // Why: the ideal open-circuit voltage at end k is E_k = V1 * t_k / t_1 (in pu), so a tap changer on end 1
  // divides and one on end 2 or 3 multiplies.
  const v1 = buses.B1.pu;
  const out = [];
  const byEnd = {};
  net.tapVals.forEach((tv) => { (byEnd[tv.end] = byEnd[tv.end] || []).push(tv); });
  // sort so that the RTC (ratio) comes before the PTC on the same end (false - true = -1)
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
/**
 * Value a controller looks at: "V:B2" / "V:B3" (kV) or "P:TX" (MW into TX at its 220 kV terminal).
 * @param {object} result output of solve(). @param {string} target e.g. "V:B2".
 * @returns {number|undefined} kV or MW; undefined if the bus does not exist.
 */
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
 * @param {object} model see defaultModel(); a tap changer with control: { on: true, target: "V:B2"|"V:B3"|"P:TX",
 *   value: setpoint (kV or MW), deadband (kV or MW, full width) } and step limits low / high is controlled.
 *   Side effect: tc.step of the controlled tap changers is changed in place (the final steps).
 * @param {{maxRounds?:number}} opts at most this many rounds (60).
 * @returns {object} solve() result plus controlLog: [{ round, tap, from, to, value }] and controlState:
 *   [{ tap, target, value, setpoint, step, status: "held"|"no effect"|"hunting"|"at limit"|"not held", stepEffect }].
 */
export function solveWithControl(model, { maxRounds = 60 } = {}) {
  const ctl = model.taps.filter((t) => t.control && t.control.on);
  let r = solve(model);
  const log = [];
  // per controlled tap changer: dir = +1/-1 (which step direction raises the value), effect = size of one step,
  // last = the previous move, stopped = reason why it no longer moves
  const dir = new Map(), effect = new Map(), last = new Map(), stopped = new Map();
  for (let round = 0; round < maxRounds && r.ok; round++) {
    let moved = false;
    for (const tc of ctl) {
      const c = tc.control;
      const val = measured(r, c.target);
      // inside the deadband (|value - setpoint| <= deadband / 2): nothing to do
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
      // value too low -> step in the direction that raises it, too high -> the other way; stay within low..high
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
    r = solve(model);                // new load flow with the new steps, then the next round
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
