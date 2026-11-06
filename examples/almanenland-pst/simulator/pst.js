// PST Simulator · Almanenland. Plain script (no modules, no build step): works from file:// and from any web server.
// Data: window.PST_DATA from pst_data.js (tools/build_page_data.py, AC load flows of tools/pst_scenarios.py).
(function () {
  "use strict";
  const D = window.PST_DATA;
  const $ = (id) => document.getElementById(id);
  const U_KV = 380;
  const ZONES = ["Almanenland", "Westonia", "Slavania", "Sudlandia"];
  const BORDERS = [["Almanenland", "Slavania"], ["Slavania", "Sudlandia"], ["Almanenland", "Sudlandia"],
                   ["Almanenland", "Westonia"], ["Westonia", "Sudlandia"]];
  const SLAVANIA = D.psts.filter((p) => p.zone === "Slavania" && p.kind !== "series_ratio").map((p) => p.id);
  const DEFAULT_PST = { S1: 407, S2: 406, S3: 411, S4: 418, S5: 425, S6: 408 };
  const SHORT = { asym_ratio: "asymmetrical 70° + ratio", symmetrical: "symmetrical", tabular: "tabular",
                  asym_series: "asymmetrical 70°, in series with a ratio unit" };

  const lineById = new Map(D.lines.map((l) => [l[0], l]));
  const pstById = new Map(D.psts.map((p) => [p.id, p]));
  const subByName = new Map(D.subs.map((s, i) => [s[0], i]));
  const scenByKey = new Map(D.scenarios.map((s) => [s.key, s]));
  const tieZones = new Map(D.lines.filter((l) => l[4]).map((l) => [l[0], [D.subs[l[1]][1], D.subs[l[2]][1]]]));

  const st = { scen: null, caseKey: null, steps: {}, pst: null, mapMode: "load" };

  // ------------------------------------------------------------ formatting
  const fmt = (x, n = 0) => (x == null || !isFinite(x) ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n }));
  const sgn = (x, n = 0) => (x == null || !isFinite(x) ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "±") + fmt(Math.abs(x), n));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pstShort = (p) => p.name.replace(/^PST /, "").replace(/ \(.*$/, "");

  // ------------------------------------------------------------ tap tables
  function tapRow(p, step) {
    const t = p.taps[0];
    const r = t.rows.find((x) => x[0] === step);
    return r ? { step, ratio: r[1], angle: r[2] } : { step, ratio: 1, angle: 0 };
  }
  function blockEnd(p) {
    const t = p.taps[0], d = D.blockDir[String(p.id)];
    return d > 0 ? t.high : t.low;
  }

  // ------------------------------------------------------------ state -> flows
  const baseCase = () => D.cases[st.caseKey];
  const sameSteps = (a, b) => Object.keys(a).every((k) => +a[k] === +b[k]);
  const sameOut = (a, b) => (a || []).join(",") === (b || []).join(",");

  function findExact() {
    const b = baseCase();
    if (sameSteps(b.steps, st.steps)) return st.caseKey;
    const keys = [...st.scen.cases, ...st.scen.sweep];
    return keys.find((k) => D.cases[k].ok && sameOut(D.cases[k].outages, b.outages) && sameSteps(D.cases[k].steps, st.steps)) || null;
  }

  function state() {
    const exact = findExact();
    if (exact) return { mode: "ac", key: exact, ...D.cases[exact] };
    const b = baseCase(), sens = st.scen.sens;
    const delta = {};
    for (const k of Object.keys(b.steps)) if (+st.steps[k] !== +b.steps[k]) delta[k] = st.steps[k] - b.steps[k];
    if (!sens) return { mode: "none", key: st.caseKey, ...b };
    const tie = {}, lines = {}, pst = {};
    let cut = b.cut;
    for (const [lid, v] of Object.entries(b.tie)) tie[lid] = [v[0] ?? 0, v[1]];
    for (const [lid, v] of Object.entries(b.lines)) lines[lid] = [v[0], v[1]];
    for (const [pid, v] of Object.entries(b.pst)) pst[pid] = [v[0], v[1], v[2]];
    for (const [pid, d] of Object.entries(delta)) {
      const s = sens[pid];
      if (!s) continue;
      cut += d * s.cut;
      for (const [lid, k] of Object.entries(s.tie)) if (tie[lid]) tie[lid][0] += d * k;
      for (const [lid, k] of Object.entries(s.lines)) if (lines[lid]) lines[lid][0] += d * k;
      for (const [q, k] of Object.entries(s.pst)) if (pst[q]) pst[q][0] += d * k;
    }
    const scaleLoad = (v0, v) => (v0[1] == null ? null : Math.abs(v0[0]) > 1 ? v0[1] * Math.abs(v[0]) / Math.abs(v0[0]) : v0[1]);
    for (const lid of Object.keys(tie)) tie[lid][1] = scaleLoad(b.tie[lid], tie[lid]);
    for (const lid of Object.keys(lines)) lines[lid][1] = scaleLoad(b.lines[lid], lines[lid]);
    for (const pid of Object.keys(pst)) pst[pid][2] = scaleLoad([b.pst[pid][0], b.pst[pid][2]], pst[pid]);
    const exch = {};
    for (const [lid, v] of Object.entries(tie)) {
      const z = tieZones.get(+lid);
      if (z) exch[z[0] + ">" + z[1]] = (exch[z[0] + ">" + z[1]] || 0) + v[0];
    }
    const worst = Object.entries(lines).filter(([, v]) => v[1] != null).sort((a, b2) => b2[1][1] - a[1][1]).slice(0, 10).map(([lid, v]) => [+lid, v[1]]);
    const n100 = Object.values(lines).filter((v) => v[1] > 100).length;
    return { mode: "est", key: st.caseKey, ...b, tie, lines, pst, cut, exch, worst, n100, delta };
  }

  function exchange(s, a, b) {
    const f = s.exch[a + ">" + b], r = s.exch[b + ">" + a];
    return f != null ? f : r != null ? -r : 0;
  }

  // ------------------------------------------------------------ controls
  function fillScenarios() {
    $("scen").innerHTML = D.scenarios.map((s) => `<option value="${s.key}">${s.key} · ${esc(s.title)}</option>`).join("");
    $("scen").addEventListener("change", () => setScenario($("scen").value));
    $("case").addEventListener("change", () => setCase($("case").value));
    $("pst").innerHTML = ZONES.map((z) => {
      const ps = D.psts.filter((p) => p.zone === z && p.kind !== "series_ratio");
      return ps.length ? `<optgroup label="${z}">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
    $("pst").addEventListener("change", () => { st.pst = +$("pst").value; render(); });
    $("bNeutral").onclick = () => { st.steps[st.pst] = 0; render(); };
    $("bBlock").onclick = () => { st.steps[st.pst] = blockEnd(pstById.get(st.pst)); render(); };
    $("bCase").onclick = () => { st.steps[st.pst] = baseCase().steps[st.pst]; render(); };
    $("bSlav0").onclick = () => { SLAVANIA.forEach((p) => { st.steps[p] = 0; }); render(); };
    $("bSlavB").onclick = () => { SLAVANIA.forEach((p) => { st.steps[p] = blockEnd(pstById.get(p)); }); render(); };
    $("bReset").onclick = () => { st.steps = { ...baseCase().steps }; render(); };
    ["mT", "mXA", "mXB"].forEach((id) => $(id).addEventListener("input", renderModel));
  }

  function setScenario(key) {
    st.scen = scenByKey.get(key);
    $("scen").value = key;
    $("case").innerHTML = st.scen.cases.filter((k) => D.cases[k].ok).map((k) => `<option value="${k}">${esc(D.cases[k].label)}</option>`).join("");
    st.pst = DEFAULT_PST[key] || D.psts[0].id;
    setCase(st.scen.cases[0]);
  }
  function setCase(key) {
    st.caseKey = key;
    $("case").value = key;
    st.steps = { ...D.cases[key].steps };
    render();
  }

  function renderPstBox() {
    const p = pstById.get(st.pst), t = p.taps[0], s = st.steps[p.id], row = tapRow(p, s);
    $("pst").value = String(p.id);
    const series = D.psts.find((q) => q.series_with === p.id);
    const others = p.taps.slice(1).map((x) => x.class).concat(series ? [`separate 380/380 kV unit with a RatioTapChanger (${pstShort(series)})`] : []);
    const line = lineById.get(p.line);
    $("pstbox").innerHTML = `<h3>${esc(p.name)}</h3>
      <div class="hint">${p.zone} · ${t.class} · ${t.low}…${t.high} · ${fmt(p.sn_mva)} MVA, vk ${p.vk} %${others.length ? " · plus " + esc(others.join(", ")) : ""}<br>
      in series with <b>${esc(line ? line[5] : "line " + p.line)}</b> (${line ? fmt(line[3]) + " MVA" : ""})</div>
      <label>Step <span>${s} (case: ${baseCase().steps[p.id]}, blocking end ${blockEnd(p)})</span>
      <input type="range" id="stepr" min="${t.low}" max="${t.high}" value="${s}"></label>
      <div class="readout">α = ${sgn(row.angle, 2)}°   ratio = ${row.ratio.toFixed(4)}</div>`;
    $("stepr").addEventListener("input", (e) => { st.steps[p.id] = +e.target.value; render(); });
  }

  // ------------------------------------------------------------ map
  const W = 1000;
  const bx = { x0: Math.min(...D.subs.map((s) => s[2])) - 40, x1: Math.max(...D.subs.map((s) => s[2])) + 40,
               y0: Math.min(...D.subs.map((s) => s[3])) - 40, y1: Math.max(...D.subs.map((s) => s[3])) + 40 };
  const k = W / (bx.x1 - bx.x0), H = Math.round((bx.y1 - bx.y0) * k);
  const X = (x) => (x - bx.x0) * k, Y = (y) => (y - bx.y0) * k;

  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const HULLS = ZONES.map((z) => {
    const pts = D.subs.filter((s) => s[1] === z).map((s) => [X(s[2]), Y(s[3])]);
    const h = hull(pts);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return { z, h, cx, cy };
  });

  function loadClass(ld) {
    if (ld == null) return ["var(--l0)", 1];
    if (ld >= 100) return ["var(--crit)", 3.6];
    if (ld >= 80) return ["var(--l3)", 2.6];
    if (ld >= 50) return ["var(--l1)", 1.8];
    return ["var(--l0)", 1.1];
  }

  function renderMap(s, ref) {
    const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Almanenland and its neighbours with the 380 kV lines, tie flows and PSTs">`,
      `<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="mk-ink"/></marker></defs>`];
    for (const h of HULLS) out.push(`<polygon points="${h.h.map((p) => p.join(",")).join(" ")}" fill="var(--z-${h.z})" fill-opacity=".07" stroke="var(--z-${h.z})" stroke-opacity=".45" stroke-width="1.2" stroke-linejoin="round"/>`);
    const delta = st.mapMode === "delta";
    const drawn = [];
    for (const l of D.lines) {
      const a = D.subs[l[1]], b = D.subs[l[2]];
      const v = l[4] ? s.tie[l[0]] : s.lines[l[0]];
      const r = l[4] ? ref.tie[l[0]] : ref.lines[l[0]];
      const p = v ? v[0] : null, ld = v ? v[1] : null;
      let col, wd;
      if (delta) {
        const d = p != null && r ? Math.abs(p) - Math.abs(r[0] ?? 0) : 0;
        col = Math.abs(d) < 15 ? "var(--l0)" : d > 0 ? "var(--s2)" : "var(--s1)";
        wd = Math.abs(d) < 15 ? 1 : Math.min(6, 1.4 + Math.abs(d) / 60);
      } else [col, wd] = loadClass(ld);
      if (l[4]) wd = Math.max(wd, 2.6);
      const out1 = s.outages && s.outages.includes(l[0]);
      const tip = `${l[5]}\n${out1 ? "OUT OF SERVICE" : `P ${fmt(p)} MW (from ${a[0]})\nloading ${fmt(ld, 1)} %`}` +
        (r && !out1 ? `\nreference: P ${fmt(r[0])} MW, ${fmt(r[1], 1)} %` : "") + `\n${fmt(l[3])} MVA, ${fmt(l[6], 1)} km`;
      drawn.push([Math.abs(delta ? wd : ld || 0), `<g data-tip="${esc(tip)}"><line x1="${X(a[2]).toFixed(1)}" y1="${Y(a[3]).toFixed(1)}" x2="${X(b[2]).toFixed(1)}" y2="${Y(b[3]).toFixed(1)}" stroke="transparent" stroke-width="9"/>` +
        `<line x1="${X(a[2]).toFixed(1)}" y1="${Y(a[3]).toFixed(1)}" x2="${X(b[2]).toFixed(1)}" y2="${Y(b[3]).toFixed(1)}" stroke="${out1 ? "var(--bad)" : col}" stroke-width="${wd}" stroke-linecap="round"${out1 ? ' stroke-dasharray="5 4"' : ""}/></g>`]);
    }
    drawn.sort((a, b) => a[0] - b[0]).forEach((d) => out.push(d[1]));
    // tie arrows + labels for the ties with a PST
    for (const p of D.psts) {
      if (p.kind === "series_ratio") continue;
      const l = lineById.get(p.line);
      if (!l) continue;
      const a = D.subs[l[1]], b = D.subs[l[2]];
      const v = l[4] ? s.tie[l[0]] : s.lines[l[0]];
      if (!v || v[0] == null || (s.outages || []).includes(l[0])) continue;
      const [x1, y1, x2, y2] = v[0] >= 0 ? [X(a[2]), Y(a[3]), X(b[2]), Y(b[3])] : [X(b[2]), Y(b[3]), X(a[2]), Y(a[3])];
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ux = (x2 - x1), uy = (y2 - y1), n = Math.hypot(ux, uy) || 1;
      out.push(`<line x1="${(mx - ux / n * 6).toFixed(1)}" y1="${(my - uy / n * 6).toFixed(1)}" x2="${(mx + ux / n * 6).toFixed(1)}" y2="${(my + uy / n * 6).toFixed(1)}" stroke="var(--ink)" stroke-width="1.6" marker-end="url(#arr)"/>`);
    }
    // north-south cut
    const ax = D.subs.filter((x) => x[1] === "Almanenland").map((x) => x[2]);
    const cx0 = X(Math.min(...ax)), cx1 = X(Math.max(...ax)), cy = Y(D.cutY);
    out.push(`<line x1="${cx0}" y1="${cy}" x2="${cx1}" y2="${cy}" class="axis"/>`);
    out.push(`<text x="${cx0 + 4}" y="${cy - 6}" class="halo">north → south cut ${fmt(s.cut)} MW${s.mode === "est" ? " (est.)" : ""}</text>`);
    // PSTs
    const byStation = {};
    for (const p of D.psts) {
      if (p.kind === "series_ratio") continue;
      const i = subByName.get(p.station);
      const sx = X(D.subs[i][2]), sy = Y(D.subs[i][3]);
      const n = (byStation[p.station] = (byStation[p.station] || 0) + 1) - 1;
      const x = sx + 11 * n, y = sy;
      const step = st.steps[p.id], row = tapRow(p, step), pf = s.pst[p.id];
      const sel = p.id === st.pst, changed = +step !== +baseCase().steps[p.id];
      const tip = `${p.name}\nstep ${step} (case ${baseCase().steps[p.id]}) · α ${sgn(row.angle, 2)}° · ratio ${row.ratio.toFixed(4)}\n` +
        (pf ? `P ${fmt(pf[0])} MW · Q ${fmt(pf[1])} Mvar · ${fmt(pf[2], 1)} % of ${fmt(p.sn_mva)} MVA` : "") + "\nclick: select";
      out.push(`<g data-tip="${esc(tip)}" data-pst="${p.id}" style="cursor:pointer"><rect x="${x - 9}" y="${y - 9}" width="18" height="18" fill="transparent"/>` +
        `<path d="M${x},${y - (sel ? 8 : 6)} L${x + (sel ? 8 : 6)},${y} L${x},${y + (sel ? 8 : 6)} L${x - (sel ? 8 : 6)},${y} z" fill="var(--ph)" stroke="var(--bg)" stroke-width="2"${changed ? ' stroke-dasharray="2 1"' : ""}/>` +
        (sel ? `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="var(--ph)" stroke-width="1.6"/>` : "") + `</g>`);
      if (sel || changed || n === 0) out.push(`<text x="${x + 10}" y="${y + (n % 2 ? 14 : -8)}" class="halo" style="font-size:10px">${esc(pstShort(p))} ${step}</text>`);
    }
    for (const h of HULLS) out.push(`<text x="${h.cx.toFixed(0)}" y="${h.cy.toFixed(0)}" class="zn halo" text-anchor="middle" fill="var(--ink)">${h.z}</text>`);
    out.push("</svg>");
    $("map").innerHTML = out.join("");
    $("map").querySelectorAll("[data-pst]").forEach((g) => g.addEventListener("click", () => { st.pst = +g.dataset.pst; render(); }));
    $("maplegend").innerHTML = (delta
      ? `<span><i style="background:var(--s2)"></i>|P| higher than as operated</span><span><i style="background:var(--s1)"></i>|P| lower</span><span><i style="background:var(--l0)"></i>change below 15 MW</span>`
      : `<span>380 kV lines:</span><span><i style="background:var(--l0)"></i>below 50 %</span><span><i style="background:var(--l1)"></i>50–80 %</span><span><i style="background:var(--l3)"></i>80–100 %</span><span><i style="background:var(--crit)"></i>above 100 % (overload)</span>`) +
      `<span><b style="background:var(--ph);transform:rotate(45deg)"></b>PST (dashed edge: step moved)</span>` +
      `<span class="seg"><button type="button" data-m="load" aria-pressed="${!delta}">Loading</button><button type="button" data-m="delta" aria-pressed="${delta}">Change vs. as operated</button></span>`;
    $("maplegend").querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { st.mapMode = b.dataset.m; render(); }));
  }

  // ------------------------------------------------------------ schematic area flows
  // Almanenland is split at the cut: a tie belongs to North or South by the map y of its Almanenland station.
  const AREA_BOX = {   // x, y, w, h in a 960 x 560 canvas, laid out like the map
    W: { x: 30, y: 170, w: 210, h: 150, zone: "Westonia", name: "Westonia" },
    AN: { x: 375, y: 40, w: 230, h: 130, zone: "Almanenland", name: "Almanenland North" },
    AS: { x: 375, y: 270, w: 230, h: 130, zone: "Almanenland", name: "Almanenland South" },
    SL: { x: 730, y: 120, w: 200, h: 170, zone: "Slavania", name: "Slavania" },
    SU: { x: 375, y: 470, w: 555, h: 72, zone: "Sudlandia", name: "Sudlandia" },
  };
  // [from area, to area, start anchor (fraction of the box), end anchor]
  const AREA_EDGES = [
    ["AN", "W", [0, 0.55], [1, 0.25]], ["AS", "W", [0, 0.45], [1, 0.8]],
    ["AN", "SL", [1, 0.4], [0, 0.3]], ["AS", "SL", [1, 0.35], [0, 0.85]],
    ["AN", "AS", [0.5, 1], [0.5, 0]], ["AS", "SU", [0.3, 1], [0.084, 0]],
    ["AN", "SU", [0.85, 1], [0.3, 0]], ["SL", "SU", [0.5, 1], [0.8, 0]], ["W", "SU", [0.6, 1], [0, 0.5]],
  ];
  const ZONE_AREA = { Westonia: "W", Slavania: "SL", Sudlandia: "SU" };
  function areaOf(subIdx) {
    const sb = D.subs[subIdx];
    return sb[1] === "Almanenland" ? (sb[3] < D.cutY ? "AN" : "AS") : ZONE_AREA[sb[1]];
  }
  function areaFlows(s) {
    const f = {}, ties = {};
    for (const l of D.lines) {
      if (!l[4]) continue;
      const a = areaOf(l[1]), b = areaOf(l[2]), v = s.tie[l[0]];
      const p = v && v[0] != null ? v[0] : 0;
      const k = a + ">" + b;
      f[k] = (f[k] || 0) + p;
      (ties[k] = ties[k] || []).push([l[5], p]);
    }
    f["AN>AS"] = s.cut;
    const get = (a, b) => (f[a + ">" + b] || 0) - (f[b + ">" + a] || 0);
    const tl = (a, b) => (ties[a + ">" + b] || []).concat((ties[b + ">" + a] || []).map(([n, p]) => [n, -p]));
    return { get, tl };
  }

  function arrowPath(x1, y1, x2, y2, w) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const hl = Math.min(L * 0.45, 12 + w * 0.9), hw = w / 2 + 7, sw = w / 2;
    const bx = x2 - ux * hl, by = y2 - uy * hl;
    const pt = (x, y) => x.toFixed(1) + "," + y.toFixed(1);
    return `M${pt(x1 + nx * sw, y1 + ny * sw)} L${pt(bx + nx * sw, by + ny * sw)} L${pt(bx + nx * hw, by + ny * hw)} L${pt(x2, y2)} ` +
      `L${pt(bx - nx * hw, by - ny * hw)} L${pt(bx - nx * sw, by - ny * sw)} L${pt(x1 - nx * sw, y1 - ny * sw)} z`;
  }

  function renderAreas(s, ref) {
    const A = areaFlows(s), R = areaFlows(ref);
    const W2 = 960, H2 = 560;
    const at = (k, fr) => [AREA_BOX[k].x + fr[0] * AREA_BOX[k].w, AREA_BOX[k].y + fr[1] * AREA_BOX[k].h];
    const o = [`<svg viewBox="0 0 ${W2} ${H2}" role="img" aria-label="Schematic power flows between Westonia, Almanenland North, Almanenland South, Slavania and Sudlandia">`];
    // net position of each area = sum of its outflows on the drawn edges
    const net = {};
    for (const [a, b] of AREA_EDGES) { const v = A.get(a, b); net[a] = (net[a] || 0) + v; net[b] = (net[b] || 0) - v; }
    for (const [k, bx] of Object.entries(AREA_BOX)) {
      const n = net[k] || 0;
      o.push(`<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="10" fill="var(--z-${bx.zone})" fill-opacity=".13" stroke="var(--z-${bx.zone})" stroke-width="2"/>`);
      const cy = bx.y + bx.h / 2;
      o.push(`<text x="${bx.x + bx.w / 2}" y="${cy - 4}" text-anchor="middle" class="an">${bx.name}</text>`);
      o.push(`<text x="${bx.x + bx.w / 2}" y="${cy + 16}" text-anchor="middle" class="anet">${Math.abs(n) < 50 ? "balanced" : (n > 0 ? "sends out " : "takes in ") + fmt(Math.abs(n) / 1000, 2) + " GW"}</text>`);
    }
    const labels = [];
    for (const [a, b, fa, fb] of AREA_EDGES) {
      const v = A.get(a, b), r = R.get(a, b);
      if (Math.abs(v) < 1 && Math.abs(r) < 1) continue;
      let [p1, p2] = [at(a, fa), at(b, fb)];
      if (v < 0) [p1, p2] = [p2, p1];
      const w = Math.max(2.5, Math.min(30, Math.abs(v) / 120));
      const from = v >= 0 ? AREA_BOX[a].name : AREA_BOX[b].name, to = v >= 0 ? AREA_BOX[b].name : AREA_BOX[a].name;
      const isCut = a === "AN" && b === "AS";
      const tl = isCut ? [] : A.tl(a, b);
      const tip = `${from} → ${to}: ${fmt(Math.abs(v))} MW\nas operated: ${fmt(Math.abs(r))} MW ${r * v < 0 ? "(other direction)" : ""}\n` +
        (isCut ? "the north → south cut inside Almanenland (all lines crossing it)" :
          tl.map(([nm, p]) => `  ${nm.replace(" (tie)", "")}: ${fmt(v >= 0 ? p : -p)} MW`).join("\n"));
      const op = Math.abs(v) < 50 ? 0.45 : 1;
      o.push(`<g data-tip="${esc(tip)}"><path d="${arrowPath(p1[0], p1[1], p2[0], p2[1], w)}" fill="var(--s1)" fill-opacity="${op}" stroke="var(--bg)" stroke-width="1.5"/></g>`);
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy) || 1;
      const d = Math.abs(v) - Math.abs(r);
      const t1 = `${fmt(Math.abs(v))} MW`;
      const t2 = `${Math.abs(d) < 0.5 ? "= as operated" : (d > 0 ? "▲ " : "▼ ") + fmt(Math.abs(d)) + " vs op."}${isCut ? " · north → south" : a === "SL" && b === "SU" ? " · transit" : ""}`;
      const lw = Math.max(t1.length * 10, t2.length * 6.7), lh = 32;
      // try both sides of the arrow; keep the one that hits no box and stays on the canvas
      let best = null;
      for (const [fr, sgn2] of [[0.5, 1], [0.5, -1], [0.38, 1], [0.38, -1], [0.62, 1], [0.62, -1]]) {
        const mx = p1[0] + dx * fr, my = p1[1] + dy * fr;
        const nx = (-dy / L) * sgn2, ny = (dx / L) * sgn2, off = w / 2 + 8;
        const ax = mx + nx * off, ay = my + ny * off;
        const x0 = nx > 0.35 ? ax : nx < -0.35 ? ax - lw : ax - lw / 2;
        const y0 = ny > 0.35 ? ay : ny < -0.35 ? ay - lh : ay - lh / 2;
        const hit = Object.values(AREA_BOX).reduce((n, bx) => n + (x0 < bx.x + bx.w && x0 + lw > bx.x && y0 < bx.y + bx.h && y0 + lh > bx.y ? 1 : 0), 0) +
          (x0 < 4 || x0 + lw > W2 - 4 || y0 < 4 || y0 + lh > H2 - 4 ? 2 : 0);
        if (!best || hit < best.hit) best = { hit, x0, y0 };
      }
      labels.push(`<text x="${best.x0.toFixed(0)}" y="${(best.y0 + 15).toFixed(0)}" class="amw halo">${t1}</text>` +
        `<text x="${best.x0.toFixed(0)}" y="${(best.y0 + 29).toFixed(0)}" class="adl halo">${t2}</text>`);
    }
    o.push(...labels, "</svg>");
    $("areas").innerHTML = o.join("");
  }

  // ------------------------------------------------------------ tables + KPIs
  function renderTables(s, ref) {
    const rows = BORDERS.map(([a, b]) => {
      const v = exchange(s, a, b), r = exchange(ref, a, b);
      return `<tr><td>${a} → ${b}</td><td class="n">${fmt(v)}</td><td class="n">${fmt(r)}</td><td class="n">${sgn(v - r)}</td></tr>`;
    });
    rows.push(`<tr><td>Almanenland north → south (cut)</td><td class="n">${fmt(s.cut)}</td><td class="n">${fmt(ref.cut)}</td><td class="n">${sgn(s.cut - ref.cut)}</td></tr>`);
    $("tborder").innerHTML = `<table><thead><tr><th>Border (sum of the tie lines)</th><th class="n">MW</th><th class="n">as operated</th><th class="n">Δ</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    const w = (s.worst || []).slice(0, 8).map(([lid, ld]) => {
      const l = lineById.get(+lid), v = l ? (l[4] ? s.tie[lid] : s.lines[lid]) : null, o = (D.otherLines || {})[lid];
      const name = l ? l[5] : o ? `${o[0]}` : "line " + lid;
      return `<tr><td>${esc(name)}</td><td class="n">${l ? fmt(v ? v[0] : null) : o ? fmt(o[1]) + " kV" : "–"}</td><td class="n">${fmt(ld, 1)}</td></tr>`;
    });
    $("tworst").innerHTML = `<table><thead><tr><th>Most loaded lines</th><th class="n">P MW</th><th class="n">%</th></tr></thead><tbody>${w.join("")}</tbody></table>`;
    const tr = D.lines.filter((l) => l[4]).map((l) => {
      const p = D.psts.find((q) => q.line === l[0]), v = s.tie[l[0]] || [];
      const step = p ? st.steps[p.id] : null, row = p ? tapRow(p, step) : null, pf = p ? s.pst[p.id] : null;
      return `<tr${p && p.id === st.pst ? ' class="sel"' : ""}><td>${esc(l[5])}</td><td>${p ? esc(pstShort(p)) : ""}</td><td class="n">${p ? step : ""}</td><td class="n">${row ? sgn(row.angle, 1) + "°" : ""}</td>` +
        `<td class="n">${fmt(v[0])}</td><td class="n">${fmt(v[1], 1)}</td><td class="n">${pf ? fmt(pf[2], 1) : ""}</td></tr>`;
    });
    $("tties").innerHTML = `<table><thead><tr><th>Tie line (P from the first station)</th><th>PST</th><th class="n">step</th><th class="n">α</th><th class="n">P MW</th><th class="n">line %</th><th class="n">PST %</th></tr></thead><tbody>${tr.join("")}</tbody></table>`;
    const sumQ = Object.entries(s.pst).reduce((a, [pid, v]) => a + (pstById.get(+pid).kind !== "series_ratio" ? Math.abs(v[1] || 0) : 0), 0);
    const sumQr = Object.entries(ref.pst).reduce((a, [pid, v]) => a + (pstById.get(+pid).kind !== "series_ratio" ? Math.abs(v[1] || 0) : 0), 0);
    const maxPst = Object.entries(s.pst).filter(([pid]) => pstById.get(+pid).kind !== "series_ratio").sort((a, b) => (b[1][2] || 0) - (a[1][2] || 0))[0];
    const kpi = (v, kk, d) => `<div class="kpi"><div class="v">${v}</div><div class="k">${kk}</div><div class="d">${d}</div></div>`;
    const top = (s.worst || [])[0];
    $("kpis").innerHTML =
      kpi(fmt(exchange(s, "Slavania", "Sudlandia")) + " MW", "transit Slavania → Sudlandia", "as operated " + fmt(exchange(ref, "Slavania", "Sudlandia")) + " · Δ " + sgn(exchange(s, "Slavania", "Sudlandia") - exchange(ref, "Slavania", "Sudlandia"))) +
      kpi(fmt(s.cut) + " MW", "north → south in Almanenland", "as operated " + fmt(ref.cut) + " · Δ " + sgn(s.cut - ref.cut)) +
      kpi(top ? fmt(top[1], 1) + " %" : "–", "highest line loading", top ? esc((lineById.get(+top[0]) || [])[5] || ((D.otherLines || {})[top[0]] || [""])[0]) : "") +
      kpi(maxPst ? fmt(maxPst[1][2], 1) + " %" : "–", "most loaded PST (of its MVA)", maxPst ? esc(pstShort(pstById.get(+maxPst[0]))) : "") +
      kpi(fmt(sumQ) + " Mvar", "reactive power through the PSTs (Σ|Q|)", "as operated " + fmt(sumQr));
  }

  // ------------------------------------------------------------ phasor of the selected PST
  function renderPhasor() {
    const p = pstById.get(st.pst), t = p.taps[0], s = st.steps[p.id], row = tapRow(p, s);
    const pts = t.rows.map((r) => [r[1] * Math.cos(r[2] * Math.PI / 180), r[1] * Math.sin(r[2] * Math.PI / 180), r[0]]);
    const xs = pts.map((q) => q[0]).concat([0, 1]), ys = pts.map((q) => q[1]).concat([0]);
    const w = 460, h = 300, pad = 40;
    const sx = (w - 2 * pad) / (Math.max(...xs) - Math.min(0, ...xs)), sy = (h - 2 * pad) / (Math.max(...ys) - Math.min(...ys) || 1);
    const sc = Math.min(sx, sy, 330);
    const ox = pad - Math.min(0, ...xs) * sc, oy = h / 2 + (Math.max(...ys) + Math.min(...ys)) / 2 * sc;
    const P = (x, y) => [(ox + x * sc).toFixed(1), (oy - y * sc).toFixed(1)];
    const vout = [row.ratio * Math.cos(row.angle * Math.PI / 180), row.ratio * Math.sin(row.angle * Math.PI / 180)];
    const o = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Phasor diagram of the selected PST"><defs>` +
      `<marker id="pa1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="mk-ink"/></marker>` +
      `<marker id="pa2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="mk-ph"/></marker>` +
      `<marker id="pa3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="mk-rt"/></marker></defs>`];
    o.push(`<line x1="${P(0, 0)[0]}" y1="${P(0, 0)[1]}" x2="${w - 6}" y2="${P(0, 0)[1]}" class="axis"/>`);
    o.push(`<polyline points="${pts.map((q) => P(q[0], q[1]).join(",")).join(" ")}" fill="none" class="ray"/>`);
    for (const q of pts) o.push(`<circle cx="${P(q[0], q[1])[0]}" cy="${P(q[0], q[1])[1]}" r="${q[2] === s ? 4.5 : 2}" fill="${q[2] === s ? "var(--ph)" : "var(--muted)"}"/>`);
    o.push(`<line x1="${P(0, 0)[0]}" y1="${P(0, 0)[1]}" x2="${P(1, 0)[0]}" y2="${P(1, 0)[1]}" stroke="var(--ink)" stroke-width="2.2" marker-end="url(#pa1)"/>`);
    o.push(`<line x1="${P(0, 0)[0]}" y1="${P(0, 0)[1]}" x2="${P(...vout)[0]}" y2="${P(...vout)[1]}" stroke="var(--rt)" stroke-width="2.2" marker-end="url(#pa3)"/>`);
    if (Math.hypot(vout[0] - 1, vout[1]) > 0.004) o.push(`<line x1="${P(1, 0)[0]}" y1="${P(1, 0)[1]}" x2="${P(...vout)[0]}" y2="${P(...vout)[1]}" stroke="var(--ph)" stroke-width="2.6" marker-end="url(#pa2)"/>`);
    const ar = 0.32, a1 = row.angle * Math.PI / 180;
    if (Math.abs(row.angle) > 0.3) o.push(`<path d="M${P(ar, 0).join(",")} A${ar * sc},${ar * sc} 0 0 ${a1 > 0 ? 0 : 1} ${P(ar * Math.cos(a1), ar * Math.sin(a1)).join(",")}" fill="none" stroke="var(--ph)" stroke-width="1.4"/>`);
    o.push(`<text x="${+P(1, 0)[0] - 8}" y="${+P(1, 0)[1] + (vout[1] >= 0 ? 16 : -8)}" text-anchor="end" class="halo">U in (1 pu)</text>`);
    o.push(`<text x="${+P(...vout)[0] - 8}" y="${+P(...vout)[1] + (vout[1] >= 0 ? -8 : 16)}" text-anchor="end" class="halo" style="fill:var(--rt)">U out = ${row.ratio.toFixed(3)} ∠ ${sgn(row.angle, 2)}°</text>`);
    o.push(`<text x="${P(ar + 0.02, 0)[0]}" y="${+P(0, 0)[1] + (a1 > 0 ? -6 : 14)}" style="fill:var(--ph)">α</text>`);
    o.push(`<text x="8" y="16" class="lb">dots: the ${t.high - t.low + 1} steps of the tap table</text><text x="8" y="30" class="lb" style="fill:var(--ph)">orange: booster voltage ΔU = U out − U in</text></svg>`);
    $("phasor").innerHTML = o.join("");
    let f = "";
    if (t.class === "PhaseTapChangerSymmetrical") f = `symmetrical: du = n · ${(+t.voltage_step_increment).toFixed(3)} % ; α = 2·atan(du/2); |U out| = |U in|`;
    else if (t.class === "PhaseTapChangerAsymmetrical") f = `asymmetrical: U out = U in · (1 + n · ${(+t.voltage_step_increment).toFixed(3)} % · e^(j${t.winding_connection_angle}°)) — angle AND magnitude change`;
    else if (t.class === "PhaseTapChangerTabular") f = "tabular: angle, ratio (and reactance) per step from the table";
    const sens = st.scen.sens && st.scen.sens[p.id];
    const l = lineById.get(p.line);
    $("phtxt").textContent = `${f}\nstep ${s}: α = ${sgn(row.angle, 3)}°, ratio ${row.ratio.toFixed(5)}` +
      (sens ? `\nAC sensitivity in ${st.scen.key} (per step): own line ${sgn(l && l[4] ? sens.tie[p.line] : (sens.lines[p.line] || 0), 1)} MW, ` +
        `Slavania→Sudlandia ${sgn(slavSudSens(sens), 1)} MW, north→south cut ${sgn(sens.cut, 1)} MW` : "\n(no sensitivity runs for this scenario: pick one of the AC cases)") +
      `\nblocking direction: towards step ${blockEnd(p)} (found by AC load flow in S1)`;
  }
  function slavSudSens(sens) {
    let v = 0;
    for (const [lid, k] of Object.entries(sens.tie)) {
      const z = tieZones.get(+lid);
      if (z && z[0] === "Slavania" && z[1] === "Sudlandia") v += k;
      if (z && z[1] === "Slavania" && z[0] === "Sudlandia") v -= k;
    }
    return v;
  }

  // ------------------------------------------------------------ two-path model
  function renderModel() {
    const p = pstById.get(st.pst), row = tapRow(p, st.steps[p.id]);
    const T = +$("mT").value, XA = Math.max(1, +$("mXA").value), XB = Math.max(1, +$("mXB").value);
    const solve = (alpha, r) => {
      const f = (d) => U_KV * U_KV / XA * Math.sin(d) + r * U_KV * U_KV / XB * Math.sin(d + alpha) - T;
      let lo = -80 * Math.PI / 180, hi = 80 * Math.PI / 180;
      if (f(lo) > 0 || f(hi) < 0) return null;
      for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; (f(m) > 0 ? (hi = m) : (lo = m)); }
      const d = (lo + hi) / 2;
      return { d, PA: U_KV * U_KV / XA * Math.sin(d), PB: r * U_KV * U_KV / XB * Math.sin(d + alpha) };
    };
    const a = row.angle * Math.PI / 180, r0 = solve(0, 1), r1 = solve(a, row.ratio);
    const w = 460, h = 240;
    if (!r0 || !r1) {
      $("model").innerHTML = `<svg viewBox="0 0 ${w} 60"><text x="10" y="34">The two paths cannot carry ${fmt(T)} MW at this angle (|δ| > 80°).</text></svg>`;
      $("modeltxt").textContent = "Lower the transfer or the reactances.";
      return;
    }
    const bw = (P) => Math.max(1.5, Math.min(26, Math.abs(P) / Math.max(T, 1) * 26));
    const yA = 84, yB = 170, xN = 40, xS = w - 40;
    const o = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Two parallel paths with a PST in path B">`];
    o.push(`<line x1="${xN}" y1="40" x2="${xN}" y2="${h - 30}" stroke="var(--ink)" stroke-width="5"/><line x1="${xS}" y1="40" x2="${xS}" y2="${h - 30}" stroke="var(--ink)" stroke-width="5"/>`);
    o.push(`<text x="${xN - 6}" y="30" class="nm">North</text><text x="${xS - 40}" y="30" class="nm">South</text>`);
    o.push(`<line x1="${xN}" y1="${yA}" x2="${xS}" y2="${yA}" stroke="var(--s1)" stroke-width="${bw(r1.PA)}" stroke-linecap="butt"/>`);
    o.push(`<line x1="${xN}" y1="${yB}" x2="${xS}" y2="${yB}" stroke="var(--s2)" stroke-width="${bw(r1.PB)}" stroke-linecap="butt"/>`);
    o.push(`<line x1="${xN}" y1="${yA}" x2="${xS}" y2="${yA}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/><line x1="${xN}" y1="${yB}" x2="${xS}" y2="${yB}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>`);
    const cx = (xN + xS) / 2;
    o.push(`<circle cx="${cx - 8}" cy="${yB}" r="13" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.6"/><circle cx="${cx + 8}" cy="${yB}" r="13" fill="none" stroke="var(--ink)" stroke-width="1.6"/>` +
      `<line x1="${cx - 22}" y1="${yB + 16}" x2="${cx + 22}" y2="${yB - 16}" stroke="var(--ph)" stroke-width="2" marker-end="url(#pa2)"/>`);
    o.push(`<text x="${xN + 10}" y="${yA - 30}" class="halo">path A, inside the country, X ${XA} Ω</text><text x="${xN + 10}" y="${yA - 16}" class="halo num" style="font-family:var(--body);font-weight:700">${fmt(r1.PA)} MW  (no PST: ${fmt(r0.PA)})</text>`);
    o.push(`<text x="${xN + 10}" y="${yB - 36}" class="halo">path B, through the neighbour, X ${XB} Ω</text><text x="${xN + 10}" y="${yB - 22}" class="halo" style="font-family:var(--body);font-weight:700">${fmt(r1.PB)} MW  (no PST: ${fmt(r0.PB)})</text>`);
    o.push(`<text x="${cx - 40}" y="${yB + 34}" style="fill:var(--ph)">α ${sgn(row.angle, 2)}°, ratio ${row.ratio.toFixed(3)}</text>`);
    o.push(`<text x="${xN + 10}" y="${h - 8}" class="lb">δ between the busbars: ${(r1.d * 180 / Math.PI).toFixed(2)}° (without PST ${(r0.d * 180 / Math.PI).toFixed(2)}°)</text></svg>`);
    $("model").innerHTML = o.join("");
    const dc = -U_KV * U_KV / (XA + XB) * a;
    $("modeltxt").textContent = `The PST moves ${fmt(Math.abs(r1.PB - r0.PB))} MW from path ${r1.PB < r0.PB ? "B to A" : "A to B"}; the total stays ${fmt(T)} MW.\n` +
      `DC rule of thumb: ΔP_B ≈ U²/(X_A+X_B) · α = ${fmt(U_KV * U_KV / (XA + XB))} MW/rad · ${(a).toFixed(4)} rad = ${sgn(-dc)} MW.\n` +
      `A PST never creates or removes power: it only decides which path carries the transfer.`;
  }

  // ------------------------------------------------------------ sweep chart
  function renderSweep(s) {
    const sw = st.scen.sweep;
    $("sweeppanel").hidden = !sw.length;
    if (!sw.length) return;
    const base = D.cases[sw[0]];
    const series = [
      { name: "Almanenland → Slavania", col: "var(--s1)", f: (c) => exchange(c, "Almanenland", "Slavania") },
      { name: "Slavania → Sudlandia", col: "var(--s2)", f: (c) => exchange(c, "Slavania", "Sudlandia") },
      { name: "Almanenland → Sudlandia", col: "var(--s3)", f: (c) => exchange(c, "Almanenland", "Sudlandia") },
      { name: "north → south cut", col: "var(--s4)", f: (c) => c.cut },
    ];
    const xsV = sw.map((kk) => (D.cases[kk].frac ?? 0) * 100);
    const val = series.map((se) => sw.map((kk) => se.f(D.cases[kk]) - se.f(base)));
    const all = val.flat(), lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const w = 900, h = 300, l = 64, r = 250, t = 16, b = 36;
    const X2 = (x) => l + x / 100 * (w - l - r), Y2 = (y) => t + (hi - y) / (hi - lo || 1) * (h - t - b);
    const o = [`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Change of the border flows while Slavania's PSTs step towards their end stops">`];
    const step = niceStep((hi - lo) / 5);
    for (let y = Math.ceil(lo / step) * step; y <= hi + 1e-9; y += step)
      o.push(`<line x1="${l}" x2="${w - r}" y1="${Y2(y)}" y2="${Y2(y)}" class="grid"/><text x="${l - 6}" y="${Y2(y) + 4}" text-anchor="end" class="lb">${sgn(y)}</text>`);
    o.push(`<line x1="${l}" x2="${w - r}" y1="${Y2(0)}" y2="${Y2(0)}" stroke="var(--muted)" stroke-width="1"/>`);
    for (let x = 0; x <= 100; x += 25) o.push(`<text x="${X2(x)}" y="${h - b + 16}" text-anchor="middle" class="lb">${x} %</text>`);
    o.push(`<text x="${(l + w - r) / 2}" y="${h - 4}" text-anchor="middle" class="lb">Slavania's 6 PSTs: share of the way from neutral to the blocking end stop</text>`);
    o.push(`<text x="${l - 50}" y="${t + 4}" class="lb" transform="rotate(-90 ${l - 50} ${t + 4})" text-anchor="end">change vs. neutral, MW</text>`);
    const ends = [];
    series.forEach((se, i) => {
      o.push(`<polyline points="${val[i].map((v, j) => X2(xsV[j]) + "," + Y2(v)).join(" ")}" fill="none" stroke="${se.col}" stroke-width="2" stroke-linejoin="round"/>`);
      val[i].forEach((v, j) => o.push(`<circle cx="${X2(xsV[j])}" cy="${Y2(v)}" r="4" fill="${se.col}" stroke="var(--bg)" stroke-width="2"/>`));
      ends.push({ y: Y2(val[i][val[i].length - 1]), txt: `${se.name} ${sgn(val[i][val[i].length - 1])}`, col: se.col });
    });
    ends.sort((a, b2) => a.y - b2.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach((e) => o.push(`<text x="${w - r + 8}" y="${e.y + 4}">${esc(e.txt)}</text>`));
    const cur = sw.indexOf(s.key);
    if (cur >= 0) o.push(`<line x1="${X2(xsV[cur])}" x2="${X2(xsV[cur])}" y1="${t}" y2="${h - b}" stroke="var(--ph)" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    o.push(`<line id="xh" x1="0" x2="0" y1="${t}" y2="${h - b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`);
    o.push(`<rect id="sweephit" x="${l}" y="${t}" width="${w - l - r}" height="${h - t - b}" fill="transparent"/></svg>`);
    $("sweep").innerHTML = o.join("");
    $("sweeplegend").innerHTML = series.map((se) => `<span><i style="background:${se.col}"></i>${esc(se.name)}</span>`).join("") + `<span>· click a point to load that AC case</span>`;
    $("sweephint").textContent = `${st.scen.key}: 9 AC load flows; all of Slavania's PSTs step together from neutral (0 %) to their blocking end stops (100 %), every other PST as operated. ` +
      `At 100 %: transit to Sudlandia ${fmt(exchange(D.cases[sw[sw.length - 1]], "Slavania", "Sudlandia"))} MW instead of ${fmt(exchange(base, "Slavania", "Sudlandia"))} MW.`;
    const svg = $("sweep").querySelector("svg"), hit = $("sweephit"), xh = $("xh");
    const near = (ev) => {
      const pt = svg.createSVGPoint ? svg.createSVGPoint() : null;
      let x;
      if (pt && svg.getScreenCTM()) { pt.x = ev.clientX; pt.y = ev.clientY; x = pt.matrixTransform(svg.getScreenCTM().inverse()).x; }
      else x = ev.offsetX;
      let best = 0;
      xsV.forEach((v, j) => { if (Math.abs(X2(v) - x) < Math.abs(X2(xsV[best]) - x)) best = j; });
      return best;
    };
    hit.addEventListener("mousemove", (ev) => {
      const j = near(ev);
      xh.setAttribute("x1", X2(xsV[j])); xh.setAttribute("x2", X2(xsV[j])); xh.setAttribute("visibility", "visible");
      showTip(ev, `${fmt(xsV[j], 1)} % of the way to the end stop\n` + series.map((se, i) => `${se.name}: ${sgn(val[i][j])} MW (${fmt(se.f(D.cases[sw[j]]))})`).join("\n"));
    });
    hit.addEventListener("mouseleave", () => { xh.setAttribute("visibility", "hidden"); hideTip(); });
    hit.addEventListener("click", (ev) => { st.steps = { ...D.cases[sw[near(ev)]].steps }; render(); });
    $("tsweep").innerHTML = `<table><thead><tr><th>share</th>${series.map((se) => `<th class="n">${esc(se.name)} MW</th>`).join("")}<th class="n">highest loading %</th></tr></thead><tbody>` +
      sw.map((kk, j) => `<tr><td>${fmt(xsV[j], 1)} %</td>${series.map((se) => `<td class="n">${fmt(se.f(D.cases[kk]))}</td>`).join("")}<td class="n">${fmt((D.cases[kk].worst[0] || [0, 0])[1], 1)}</td></tr>`).join("") + "</tbody></table>";
  }
  function niceStep(x) {
    const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9)))), m = x / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
  }

  // ------------------------------------------------------------ tooltip
  const tip = $("tip");
  function showTip(ev, text) {
    tip.textContent = text; tip.style.display = "block";
    const x = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8), y = Math.min(ev.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.style.display = "none"; }
  $("map").addEventListener("mousemove", (ev) => {
    const g = ev.target.closest && ev.target.closest("[data-tip]");
    if (g) showTip(ev, g.dataset.tip); else hideTip();
  });
  $("map").addEventListener("mouseleave", hideTip);
  $("areas").addEventListener("mousemove", (ev) => {
    const g = ev.target.closest && ev.target.closest("[data-tip]");
    if (g) showTip(ev, g.dataset.tip); else hideTip();
  });
  $("areas").addEventListener("mouseleave", hideTip);

  // ------------------------------------------------------------ render
  function render() {
    const s = state(), ref = D.cases[st.scen.cases[0]];      // reference: the stamp as operated
    renderPstBox();
    const badge = $("badge"), status = $("status");
    if (s.mode === "ac") {
      badge.className = "badge ac"; badge.textContent = "AC load flow";
      status.className = "status ok";
      status.textContent = `${D.cases[s.key].label} · converged (${s.core}) · ${fmt(s.gen)} MW generation, ${fmt(s.load)} MW load · U ${fmt(s.vmin, 3)}–${fmt(s.vmax, 3)} pu`;
    } else if (s.mode === "est") {
      badge.className = "badge est"; badge.textContent = "estimate";
      status.className = "status est";
      status.textContent = `${Object.keys(s.delta).length} PST step(s) changed from “${baseCase().label}”: flows estimated from the AC sensitivities (±3 steps) of ${st.scen.key}; voltages are those of the AC case`;
    } else {
      badge.className = "badge"; badge.textContent = "not computed";
      status.className = "status bad";
      status.textContent = `${st.scen.key} has no sensitivity runs: these steps are not an AC case. Showing “${baseCase().label}”. Use the case list or the buttons.`;
    }
    $("scdesc").textContent = `${st.scen.day.replace(/_/g, " ")}, ${st.scen.time}: ${st.scen.desc.split(" · ").slice(1).join(" · ")}`;
    $("casehint").textContent = `${st.scen.cases.length + st.scen.sweep.length} AC cases in this scenario${st.scen.sens ? ", plus ±3-step sensitivity runs of every PST" : ""}.` +
      (baseCase().outages && baseCase().outages.length ? ` Out of service: ${baseCase().outages.map((x) => (lineById.get(x) || [])[5] || x).join(", ")}.` : "");
    $("pstnote").textContent = "Move a step: the map, the tables and the two pictures follow. Click a PST on the map to select it.";
    renderAreas(s, ref);
    renderMap(s, ref);
    renderTables(s, ref);
    renderPhasor();
    renderModel();
    renderSweep(s);
  }

  fillScenarios();
  setScenario(D.scenarios[0].key);
  window.PST_SIM = { st, state, setScenario, setCase, render };
})();
