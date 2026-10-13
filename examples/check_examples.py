"""Check the example cases against the simulator's presets.

For each example folder: the SV profile inside the zip is the same file as the separate *_SV.xml, and the bus
voltages of the SV (and of the *_SV_end2-inverted.xml) equal the expected values in ../presets.json.

Run: python3 check_examples.py   (standard library only)
"""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
CIM = "{http://iec.ch/TC57/CIM100#}"
RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
TOL_KV, TOL_DEG = 1e-6, 1e-6


def node_names(tp_xml):
    names = {}
    for node in ET.fromstring(tp_xml).iter(CIM + "TopologicalNode"):
        mrid = node.get(RDF + "ID") or node.get(RDF + "about").lstrip("#")
        names[mrid.lstrip("_")] = node.find(CIM + "IdentifiedObject.name").text
    return names


def sv_voltages(sv_xml, names):
    buses = {}
    for sv in ET.fromstring(sv_xml).iter(CIM + "SvVoltage"):
        ref = sv.find(CIM + "SvVoltage.TopologicalNode").get(RDF + "resource").lstrip("#").lstrip("_")
        buses[names[ref]] = (float(sv.find(CIM + "SvVoltage.v").text), float(sv.find(CIM + "SvVoltage.angle").text))
    return buses


def compare(label, got, expected):
    bad = 0
    for bus, (v_kv, angle) in expected.items():
        dv, da = abs(got[bus][0] - v_kv), abs(got[bus][1] - angle)
        if dv > TOL_KV or da > TOL_DEG:
            print(f"  FAIL {label} {bus}: {got[bus]} vs {v_kv}, {angle}")
            bad += 1
    print(f"  {label}: {len(expected)} buses, {'ok' if not bad else f'{bad} differ'}")
    return bad


def main():
    presets = {p["code"]: p for p in json.loads((HERE.parent / "presets.json").read_text())}
    failures = 0
    for folder in sorted(p for p in HERE.iterdir() if p.is_dir()):
        code = folder.name
        print(code)
        with zipfile.ZipFile(folder / f"{code}.zip") as z:
            members = {n.rsplit("_", 2)[-2]: z.read(n) for n in z.namelist()}
        names = node_names(members["TP"])
        if members["SV"] != (folder / f"{code}_SV.xml").read_bytes():
            print("  FAIL the SV in the zip differs from the separate SV file")
            failures += 1
        failures += compare("SV", sv_voltages(members["SV"], names), presets[code]["expected"])
        inverted = folder / f"{code}_SV_end2-inverted.xml"
        if inverted.exists():
            failures += compare("SV end2-inverted", sv_voltages(inverted.read_bytes(), names),
                                presets[code]["expected_inverted"])
    print("all ok" if not failures else f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
