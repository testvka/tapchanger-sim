"""Turn the AC results of pst_scenarios.py into the data file of the page (simulator/pst_data.js).

    python3 tools/build_page_data.py results/summary.json results/geometry.json simulator/pst_data.js [grid.json.gz]

grid.json.gz (GridLab examples/almanenland) is optional: it gives the names of the 220 kV lines in the "most loaded" lists.

Keeps per case: tie flows, border exchanges, the north-south cut, PST flows and angles, the worst lines and the
P / loading of every 380 kV line (for the map). Per scenario with sensitivity runs: the AC change of every tie,
the cut and every 380 kV line per PST step (central difference of +-3 steps; one-sided at an end stop).
"""
import gzip
import json
import sys

LABELS = {
    "operated": "as operated (steps of the day stamp)",
    "operated.pandapower": "as operated, solved by pandapower (cross-check)",
    "all_neutral": "every PST on neutral (step 0)",
    "slavania_neutral": "Slavania's 6 PSTs on neutral, the others as operated",
    "slavania_block_max": "Slavania's 6 PSTs at their blocking end stop",
    "intact": "before the outage (tie in service)",
    "pst_control": "after the outage, PSTs re-stepped by GridLab's PST rule",
    "internal_neutral": "the 4 internal PSTs on neutral",
    "all_block_max": "all 14 tie PSTs at their blocking end stop",
    "all_block_half": "all 14 tie PSTs halfway to their blocking end stop",
    "slav_sud_block_max": "Slavania's and Sudlandia's PSTs at their blocking end stop",
    "westonia_high": "Westonia's 4 PSTs at their high end stop (+16)",
    "westonia_low": "Westonia's 4 PSTs at their low end stop (-16)",
}


def label(key):
    tail = key.split(".", 1)[1]
    if tail in LABELS:
        return LABELS[tail]
    if tail.startswith("sweep."):
        return f"Slavania sweep, {int(tail.split('.')[1]) * 12.5:g} % of the way to the end stop"
    if tail.startswith("internal_"):
        _, d, pct = tail.split("_")
        return f"the 4 internal PSTs at {pct} % of their {'+' if d == 'up' else '-'} range"
    return tail


def r1(x):
    return None if x is None else round(x, 1)


def case_out(c):
    if not c.get("ok"):
        return {"ok": False, "label": label(c["key"]), "error": c.get("error"), "steps": c.get("steps", {})}
    return {"ok": True, "label": label(c["key"]), "scenario": c["scenario"], "core": c.get("core"),
            "steps": {k: int(v) for k, v in (c.get("steps") or {}).items()}, "outages": c.get("outages", []),
            "tie": {k: [v["p"], v["load"]] for k, v in c["tie"].items()},
            "exch": c["exchange"], "cut": c["cut_ns_mw"],
            "pst": {k: [v["p_hv"], v["q_hv"], v["load"]] for k, v in c["pst"].items()},
            "pstBus": c.get("pst_bus", {}),
            "lines": c["lines380"], "worst": c["worst"][:10], "n100": c["n_over_100"], "n90": c["n_over_90"],
            "vmin": c["vm_min"], "vmax": c["vm_max"],
            "gen": round(c["kpis"].get("generation_mw", 0)), "load": round(c["kpis"].get("demand_mw", 0)),
            "frac": c.get("frac")}


def sensitivities(cases, scen):
    base = cases.get(f"{scen}.operated")
    if not base or not base.get("ok"):
        return None
    out = {}
    for pid in base["steps"]:
        p, m = cases.get(f"{scen}.sens.{pid}.p"), cases.get(f"{scen}.sens.{pid}.m")
        pairs = [(c, int(c["steps"][pid]) - int(base["steps"][pid])) for c in (p, m) if c and c.get("ok")]
        if not pairs:
            continue
        if len(pairs) == 2:
            (a, da), (b, db) = pairs
            d = lambda f: (f(a) - f(b)) / (da - db)
        else:
            (a, da), = pairs
            d = lambda f: (f(a) - f(base)) / da
        tie = {k: round(d(lambda c, k=k: c["tie"][k]["p"] or 0.0), 2) for k in base["tie"]}
        lines = {}
        for k in base["lines380"]:
            v = d(lambda c, k=k: (c["lines380"].get(k) or [0])[0])
            if abs(v) >= 0.5:
                lines[k] = round(v, 1)
        pst = {k: round(d(lambda c, k=k: c["pst"][k]["p_hv"] or 0.0), 2) for k in base["pst"]}
        out[pid] = {"tie": tie, "cut": round(d(lambda c: c["cut_ns_mw"]), 2), "lines": lines, "pst": pst}
    return out


def main(summary_path, geometry_path, out_path, grid_path=None):
    s = json.load(open(summary_path))
    g = json.load(open(geometry_path))
    cases = s["cases"]
    subs = g["substations"]
    six = {x["name"]: i for i, x in enumerate(subs)}
    data = {
        "core": s["core"],
        "subs": [[x["name"], x["zone"], round(x["x"], 1), round(x["y"], 1), int(x["kv"])] for x in subs],
        "lines": [[l["id"], six[l["a"]], six[l["b"]], l["mva"], 1 if l["tie"] else 0, l["name"], l["km"]]
                  for l in g["lines"]],
        "psts": [{**p, "taps": [{**t, "rows": [r[:3] for r in t["rows"]]} for t in p["taps"]]} for p in g["psts"]],
        "cutY": g["cut_y"],
        "blockDir": s.get("block_dir", {}),
        "scenarios": [],
        "cases": {},
    }
    for sc in s["scenarios"]:
        keys = sorted([k for k in cases if k.startswith(sc["key"] + ".") and ".sens." not in k],
                      key=lambda k: (k.split(".", 1)[1] != "operated", ".sweep." in k, k))
        sweep = sorted([k for k in keys if ".sweep." in k], key=lambda k: int(k.rsplit(".", 1)[1]))
        data["scenarios"].append({**sc, "desc": s["stamps"].get(f"{sc['day']}|{sc['time']}", ""),
                                  "cases": [k for k in keys if ".sweep." not in k], "sweep": sweep,
                                  "sens": sensitivities(cases, sc["key"])})
        for k in keys:
            data["cases"][k] = case_out(cases[k])
    known = {l[0] for l in data["lines"]}
    need = {lid for c in data["cases"].values() if c.get("ok") for lid, _ in c["worst"] if int(lid) not in known}
    data["otherLines"] = {}
    if grid_path:
        doc = json.load(gzip.open(grid_path))
        kv = {b["id"]: b["vn_kv"] for b in doc["buses"]}
        data["otherLines"] = {str(l["id"]): [l["name"], kv[l["from_bus"]]] for l in doc["lines"] if l["id"] in {int(x) for x in need}}
    with open(out_path, "w") as f:
        f.write("// generated by tools/build_page_data.py from the AC load flows of tools/pst_scenarios.py\n")
        f.write("window.PST_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(out_path, sum(len(json.dumps(v)) for v in data.values()) // 1024, "KB")


if __name__ == "__main__":
    main(*sys.argv[1:5])
