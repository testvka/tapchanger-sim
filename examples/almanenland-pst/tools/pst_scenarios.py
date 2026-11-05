"""AC load flows of the Almanenland PST scenarios (docs: ../PST_SCENARIOS.md).

Runs inside a GridLab checkout (needs backend.core and tools/almanenland_build.py):

    python tools/pst_scenarios.py --gridlab /opt/gridlab --out out --workers 30
    python tools/pst_scenarios.py --gridlab /opt/gridlab --out out --smoke     # one load flow per scenario

Every case is one AC load flow (core sparse-python, OLTC voltage control on, as in the day stamps) of a stamp of
the Almanenland days with changed PST steps and / or a line out. Writes:

    out/geometry.json   substations, 380 kV lines, ties, PSTs (tap tables) for the map and the phasor pictures
    out/cases.jsonl     one line per load flow: case key, settings, convergence, tie / PST / cut flows, line flows
    out/summary.json    the cases grouped by scenario (input of tools/build_page_data.py)

Phases: 1 = the operated stamp, +-3 steps of every PST (AC sensitivities), neutral settings, the tie outage;
2 = the settings that need the blocking direction of each PST (found in phase 1), the Slavania sweep and
GridLab's own PST controller (almanenland_build.pst_control) after the tie outage.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import json
import math
import multiprocessing as mp
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

CORE = "sparse-python"
STEP = 3                                  # sensitivity: +-3 steps
CUT_Y = 900.0                             # north / south cut through Almanenland (map y grows to the south)
TIE_PST_COUNTRY = {406: "Slavania", 407: "Slavania", 408: "Slavania", 409: "Slavania", 418: "Slavania",
                   420: "Slavania", 410: "Westonia", 411: "Westonia", 412: "Westonia", 413: "Westonia",
                   414: "Sudlandia", 415: "Sudlandia", 416: "Sudlandia", 417: "Sudlandia"}
INTERNAL_PSTS = [422, 423, 424, 425]
SLAVANIA = [p for p, c in TIE_PST_COUNTRY.items() if c == "Slavania"]

SCENARIOS = [
    {"key": "S1", "title": "Storm in the north: transit to the south, Slavania blocks the loop flow",
     "day": "winter_workday_storm", "time": "15:00"},
    {"key": "S2", "title": "Sunny and windy Sunday: export at the limit through the south-east tie",
     "day": "spring_sunday_sun_wind", "time": "12:00"},
    {"key": "S3", "title": "Dunkelflaute: import from Westonia and the nuclear transit",
     "day": "winter_dunkelflaute", "time": "18:00"},
    {"key": "S4", "title": "Storm + loss of the tie Alberg - Novgrad II: the PSTs re-step",
     "day": "winter_workday_storm", "time": "15:00", "outage": 1543},
    {"key": "S5", "title": "Large-angle PSTs inside Almanenland steer the north-south flow",
     "day": "winter_workday_storm", "time": "18:00"},
    {"key": "S6", "title": "Every neighbour blocks at once: the export cannot be blocked, only moved",
     "day": "winter_workday_storm", "time": "15:00"},
]

G = {}                                    # worker globals: doc, stamps, gridlab path


# ------------------------------------------------------------------ model
def load(gridlab: Path):
    sys.path.insert(0, str(gridlab))
    sys.path.insert(0, str(gridlab / "tools"))
    ex = gridlab / "examples" / "almanenland"
    doc = json.load(gzip.open(ex / "grid.json.gz"))
    doc["measurements"], doc["graphics"] = [], []
    stamps = {}
    for s in SCENARIOS:
        if (s["day"], s["time"]) in stamps:
            continue
        day = json.load(gzip.open(ex / f"day_{s['day']}.json.gz"))
        sc = next(x for x in day["scenarios"] if x["time"] == s["time"])
        stamps[(s["day"], s["time"])] = sc
    return doc, stamps


def init_worker(gridlab):
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    G["doc"], G["stamps"] = load(Path(gridlab))


def tap_models(tr):
    return tr["tap_models"][0]


def scenario_for(case):
    """the stamp with the case's PST steps and outages"""
    sc = copy.deepcopy(G["stamps"][(case["day"], case["time"])])
    sc["name"] = case["key"]
    for pid, step in case.get("steps", {}).items():
        key = f"trafo:{pid}"
        sc["overrides"][key] = {**sc["overrides"].get(key, {}), "tap_pos": int(step)}
    for lid in case.get("outages", []):
        sc["overrides"][f"line:{lid}"] = {**sc["overrides"].get(f"line:{lid}", {}), "in_service": False}
    return sc


def lf(doc, sc, core=CORE):
    from backend.core.engines import powerflow_cores
    return powerflow_cores.run_powerflow(doc, sc, {"core": core})


# ------------------------------------------------------------------ results
def _index(doc):
    if "_ix" not in G:
        bus = {b["id"]: b for b in doc["buses"]}
        ties, cut, l380 = [], [], []
        for l in doc["lines"]:
            a, b = bus[l["from_bus"]], bus[l["to_bus"]]
            if a["zone"] != b["zone"]:
                ties.append(l["id"])
            elif a["zone"] == "Almanenland" and (a["geo"]["y"] - CUT_Y) * (b["geo"]["y"] - CUT_Y) < 0:
                cut.append((l["id"], 1 if a["geo"]["y"] < CUT_Y else -1))     # +1: from end is the northern one
            if a["vn_kv"] >= 380:
                l380.append(l["id"])
        psts = [t["id"] for t in doc["trafos"] if t.get("pst") or t.get("series_with_pst")]
        G["_ix"] = {"bus": bus, "ties": ties, "cut": cut, "l380": set(l380), "psts": psts}
    return G["_ix"]


def summarize(doc, sc, r, case, seconds):
    ix = _index(doc)
    out = {"key": case["key"], "scenario": case["scenario"], "kind": case.get("kind"), "core": case.get("core", CORE),
           "frac": case.get("frac"), "pst_id": case.get("pst"), "steps": case.get("steps", {}),
           "outages": case.get("outages", []), "ok": bool(r.get("ok")), "seconds": round(seconds, 1)}
    if not r.get("ok"):
        out["error"] = str(r.get("error"))[:300]
        return out
    t = r["tables"]
    lines = {row["id"]: row for row in t.get("line") or []}
    trafos = {row["id"]: row for row in t.get("trafo") or []}
    buses = {row["id"]: row for row in t.get("bus") or []}
    bus = ix["bus"]
    num = lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    tie = {}
    exch = {}
    for lid in ix["ties"]:
        row = lines.get(lid) or {}
        l = next(x for x in doc["lines"] if x["id"] == lid) if "_lines" not in G else G["_lines"][lid]
        pf, pt = num(row.get("p_from_mw")), num(row.get("p_to_mw"))
        za, zb = bus[l["from_bus"]]["zone"], bus[l["to_bus"]]["zone"]
        tie[lid] = {"p": None if pf is None else round(pf, 1), "load": None if row.get("loading_percent") is None
                    else round(num(row["loading_percent"]), 1)}
        if pf is not None:
            exch[f"{za}>{zb}"] = exch.get(f"{za}>{zb}", 0.0) + pf
    pst = {}
    for tid in ix["psts"]:
        row = trafos.get(tid) or {}
        pst[tid] = {"p_hv": None if num(row.get("p_hv_mw")) is None else round(num(row["p_hv_mw"]), 1),
                    "q_hv": None if num(row.get("q_hv_mvar")) is None else round(num(row["q_hv_mvar"]), 1),
                    "load": None if num(row.get("loading_percent")) is None else round(num(row["loading_percent"]), 1)}
    cut = sum(sgn * (num((lines.get(lid) or {}).get("p_from_mw")) or 0.0) for lid, sgn in ix["cut"])
    l380 = {}
    worst = []
    for lid, row in lines.items():
        ld = num(row.get("loading_percent"))
        if lid in ix["l380"]:
            l380[lid] = [round(num(row.get("p_from_mw")) or 0.0), None if ld is None else round(ld)]
        if ld is not None:
            worst.append((ld, lid))
    worst.sort(reverse=True)
    vm = [num(b.get("vm_pu")) for b in buses.values() if num(b.get("vm_pu"))]
    va = {}
    for tid in ix["psts"]:
        tr = G["_trafos"][tid]
        a, b = buses.get(tr["hv_bus"]) or {}, buses.get(tr["lv_bus"]) or {}
        if a.get("va_degree") is not None and b.get("va_degree") is not None:
            va[tid] = [round(num(a["va_degree"]), 3), round(num(b["va_degree"]), 3),
                       round(num(a.get("vm_pu")) or 0, 4), round(num(b.get("vm_pu")) or 0, 4)]
    kp = r.get("kpis") or {}
    out.update({"tie": tie, "exchange": {k: round(v, 1) for k, v in exch.items()}, "pst": pst, "pst_bus": va,
                "cut_ns_mw": round(cut, 1), "lines380": l380,
                "worst": [[lid, round(ld, 1)] for ld, lid in worst[:15]],
                "n_over_100": sum(1 for ld, _ in worst if ld > 100), "n_over_90": sum(1 for ld, _ in worst if ld > 90),
                "vm_min": round(min(vm), 4) if vm else None, "vm_max": round(max(vm), 4) if vm else None,
                "kpis": {k: v for k, v in kp.items() if isinstance(v, (int, float, str, bool))}})
    return out


def run_case(case):
    doc = G["doc"]
    G.setdefault("_lines", {l["id"]: l for l in doc["lines"]})
    G.setdefault("_trafos", {t["id"]: t for t in doc["trafos"]})
    t0 = time.time()
    if case.get("kind") == "pst_control":
        return run_pst_control(case, t0)
    sc = scenario_for(case)
    try:
        r = lf(doc, sc, case.get("core", CORE))
    except Exception as e:                                  # noqa: BLE001 - a failed case is a result
        r = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return summarize(doc, sc, r, case, time.time() - t0)


def run_pst_control(case, t0):
    """GridLab's own PST rule after the outage (tools/almanenland_build.py pst_control): each PST steps 3 at a time
    until its line is below 60 % of its rating or the PST is at its end; then a final load flow"""
    import almanenland_build as ab
    doc = G["doc"]
    sc = scenario_for(case)
    try:
        res = ab.pst_control(doc, sc)
        steps = {str(k): v[0] for k, v in res.items()}
        r = lf(doc, sc)
    except Exception as e:                                  # noqa: BLE001
        steps, r = {}, {"ok": False, "error": f"{type(e).__name__}: {e}"}
    case = {**case, "steps": steps}
    return summarize(doc, sc, r, case, time.time() - t0)


# ------------------------------------------------------------------ cases
def base_steps(doc, stamp):
    out = {}
    for t in doc["trafos"]:
        if t.get("pst"):
            out[str(t["id"])] = int(stamp["overrides"].get(f"trafo:{t['id']}", {}).get("tap_pos", tap_models(t)["step"]))
    return out


def phase1(doc, stamps, smoke=False):
    trafos = {t["id"]: t for t in doc["trafos"]}
    cases = []
    for s in SCENARIOS:
        st = stamps[(s["day"], s["time"])]
        op = base_steps(doc, st)
        common = {"scenario": s["key"], "day": s["day"], "time": s["time"]}
        outs = [s["outage"]] if s.get("outage") else []
        cases.append({**common, "key": f"{s['key']}.operated", "kind": "operated", "steps": op, "outages": outs})
        if s["key"] == "S1":                                 # cross-check of the operated stamp on a 2nd core
            cases.append({**common, "key": "S1.operated.pandapower", "kind": "xcheck", "core": "pandapower",
                          "steps": op, "outages": outs})
        if smoke:
            continue
        if s["key"] in ("S1", "S2", "S3", "S5"):
            for pid in [int(k) for k in op]:
                m = tap_models(trafos[pid])
                for d in (+1, -1):
                    stp = max(m["low"], min(m["high"], op[str(pid)] + d * STEP))
                    if stp != op[str(pid)]:
                        cases.append({**common, "key": f"{s['key']}.sens.{pid}.{'p' if d > 0 else 'm'}", "kind": "sens",
                                      "pst": pid, "steps": {**op, str(pid): stp}, "outages": outs})
        neutral = {k: 0 for k in op}
        if s["key"] in ("S1", "S2", "S3", "S6"):
            cases.append({**common, "key": f"{s['key']}.all_neutral", "kind": "variant", "steps": neutral})
        if s["key"] == "S1":
            cases.append({**common, "key": "S1.slavania_neutral", "kind": "variant",
                          "steps": {**op, **{str(p): 0 for p in SLAVANIA}}})
        if s["key"] == "S4":
            cases.append({**common, "key": "S4.intact", "kind": "variant", "steps": op, "outages": []})
        if s["key"] == "S5":
            cases.append({**common, "key": "S5.internal_neutral", "kind": "variant",
                          "steps": {**op, **{str(p): 0 for p in INTERNAL_PSTS}}})
            for frac in (0.25, 0.5, 0.75, 1.0):
                for sign, nm in ((+1, "up"), (-1, "down")):
                    stp = {str(p): int(round(sign * frac * tap_models(trafos[p])["high"])) for p in INTERNAL_PSTS}
                    cases.append({**common, "key": f"S5.internal_{nm}_{int(frac * 100)}", "kind": "variant",
                                  "steps": {**op, **stp}})
    return cases


def block_dir(rows, scen, doc):
    """per PST of a scenario: the step direction (+1 / -1) that lowers |P| on its own line (tie or pst_line)"""
    trafos = {t["id"]: t for t in doc["trafos"]}
    base = next(r for r in rows if r["key"] == f"{scen}.operated")
    out = {}
    for pid in [int(k) for k in base["steps"]]:
        line = trafos[pid].get("pst_tie_line") or trafos[pid].get("pst_line")
        flow = lambda r: abs(((r.get("tie") or {}).get(line) or {}).get("p") or
                             ((r.get("lines380") or {}).get(line) or [0])[0] or 0.0)
        best = None
        for suf, d in (("p", +1), ("m", -1)):
            r = next((x for x in rows if x["key"] == f"{scen}.sens.{pid}.{suf}" and x.get("ok")), None)
            if r is not None:
                f = flow(r) - flow(base)
                if best is None or f < best[0]:
                    best = (f, d)
        # the only free side raises the flow: the PST already sits at its end stop in the blocking direction
        out[pid] = (best[1] if best[0] < 0 else -best[1]) if best else -1
    return out


def phase2(doc, stamps, rows):
    trafos = {t["id"]: t for t in doc["trafos"]}
    dirs = block_dir(rows, "S1", doc)
    end = lambda p: tap_models(trafos[p])["high"] if dirs[p] > 0 else tap_models(trafos[p])["low"]
    cases = []
    for s in SCENARIOS:
        st = stamps[(s["day"], s["time"])]
        op = base_steps(doc, st)
        common = {"scenario": s["key"], "day": s["day"], "time": s["time"]}
        if s["key"] == "S1":
            cases.append({**common, "key": "S1.slavania_block_max", "kind": "variant",
                          "steps": {**op, **{str(p): end(p) for p in SLAVANIA}}})
            for i in range(9):                                   # 0 = neutral ... 8 = end stop
                f = i / 8
                cases.append({**common, "key": f"S1.sweep.{i}", "kind": "sweep", "frac": f,
                              "steps": {**op, **{str(p): int(round(f * end(p))) for p in SLAVANIA}}})
        if s["key"] == "S6":
            cases.append({**common, "key": "S6.all_block_max", "kind": "variant",
                          "steps": {**op, **{str(p): end(p) for p in TIE_PST_COUNTRY}}})
            cases.append({**common, "key": "S6.all_block_half", "kind": "variant",
                          "steps": {**op, **{str(p): int(round(end(p) / 2)) for p in TIE_PST_COUNTRY}}})
            cases.append({**common, "key": "S6.slav_sud_block_max", "kind": "variant",
                          "steps": {**op, **{str(p): end(p) for p, c in TIE_PST_COUNTRY.items()
                                             if c in ("Slavania", "Sudlandia")}}})
        if s["key"] == "S3":                                     # Westonia's 4 PSTs at either end stop
            west = [p for p, c in TIE_PST_COUNTRY.items() if c == "Westonia"]
            for nm, f in (("westonia_high", "high"), ("westonia_low", "low")):
                cases.append({**common, "key": f"S3.{nm}", "kind": "variant",
                              "steps": {**op, **{str(p): tap_models(trafos[p])[f] for p in west}}})
        if s["key"] == "S4":
            cases.append({**common, "key": "S4.pst_control", "kind": "pst_control", "steps": op,
                          "outages": [s["outage"]]})
            cases.append({**common, "key": "S4.slavania_block_max", "kind": "variant", "outages": [s["outage"]],
                          "steps": {**op, **{str(p): end(p) for p in SLAVANIA}}})
    for c in cases:
        c.setdefault("outages", [])
    return cases, {str(k): v for k, v in dirs.items()}


# ------------------------------------------------------------------ geometry
def geometry(doc):
    bus = {b["id"]: b for b in doc["buses"]}
    subs = {}
    for b in doc["buses"]:
        s = subs.setdefault(b["substation"], {"name": b["substation"], "zone": b["zone"], "x": b["geo"]["x"],
                                              "y": b["geo"]["y"], "kv": 0})
        s["kv"] = max(s["kv"], b["vn_kv"])
    lines = []
    for l in doc["lines"]:
        a, b = bus[l["from_bus"]], bus[l["to_bus"]]
        if a["vn_kv"] < 380:
            continue
        lines.append({"id": l["id"], "name": l["name"], "a": a["substation"], "b": b["substation"],
                      "tie": a["zone"] != b["zone"], "mva": round(math.sqrt(3) * 380 * l["max_i_ka"] * l.get("parallel", 1)),
                      "km": l["length_km"]})
    psts = []
    for t in doc["trafos"]:
        if not (t.get("pst") or t.get("series_with_pst")):
            continue
        hv = bus[t["hv_bus"]]
        psts.append({"id": t["id"], "name": t["name"], "station": hv["substation"], "zone": hv["zone"],
                     "kind": t.get("pst") or "series_ratio", "line": t.get("pst_tie_line") or t.get("pst_line"),
                     "series_with": t.get("series_with_pst"), "sn_mva": t["sn_mva"], "vk": t["vk_percent"],
                     "taps": [{k: m.get(k) for k in ("class", "low", "high", "neutral", "voltage_step_increment",
                                                      "step_voltage_increment", "winding_connection_angle", "name")}
                              | {"rows": [[r[0], round(r[1], 5), round(r[2], 4), r[3], r[4]] for r in m.get("rows") or []]}
                              for m in t["tap_models"]]})
    return {"substations": list(subs.values()), "lines": lines, "psts": psts, "cut_y": CUT_Y,
            "scenarios": SCENARIOS}


# ------------------------------------------------------------------ main
def run(cases, workers, gridlab, sink):
    rows = []
    ctx = mp.get_context("fork")
    with ProcessPoolExecutor(workers, mp_context=ctx, initializer=init_worker, initargs=(str(gridlab),)) as ex:
        futs = {ex.submit(run_case, c): c for c in cases}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                r = f.result()
            except Exception as e:                          # noqa: BLE001 - a dead worker is a result too
                c = futs[f]
                r = {"key": c["key"], "scenario": c["scenario"], "ok": False, "error": f"{type(e).__name__}: {e}"}
            rows.append(r)
            sink.write(json.dumps(r) + "\n")
            sink.flush()
            print(f"[{time.strftime('%H:%M:%S')}] {i}/{len(cases)} {r['key']} ok={r['ok']} {r.get('seconds')} s",
                  flush=True)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gridlab", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--smoke", action="store_true")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    doc, stamps = load(a.gridlab)
    json.dump(geometry(doc), open(a.out / "geometry.json", "w"), ensure_ascii=False)
    stamp_info = {f"{d}|{t}": sc["description"] for (d, t), sc in stamps.items()}
    with open(a.out / "cases.jsonl", "w") as sink:
        c1 = phase1(doc, stamps, smoke=a.smoke)
        rows = run(c1, a.workers, a.gridlab, sink)
        dirs = {}
        if not a.smoke:
            c2, dirs = phase2(doc, stamps, rows)
            rows += run(c2, a.workers, a.gridlab, sink)
    summary = {"core": CORE, "stamps": stamp_info, "block_dir": dirs, "scenarios": SCENARIOS,
               "cases": {r["key"]: r for r in rows}}
    json.dump(summary, open(a.out / "summary.json", "w"), ensure_ascii=False)
    bad = [r["key"] for r in rows if not r["ok"]]
    print(f"done: {len(rows)} load flows, {len(bad)} failed {bad[:20]}")


if __name__ == "__main__":
    main()
