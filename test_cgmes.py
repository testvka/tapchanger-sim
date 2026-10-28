"""Independent ZIP/XML checks for test_cgmes.mjs; Python standard library only."""
import json
import math
import sys
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
MD = "{http://iec.ch/TC57/61970-552/ModelDescription/1#}"
directory = Path(sys.argv[1])
manifest = json.loads((directory / "manifest.json").read_text())


def near(a, b, tol=1e-8):
    assert math.isfinite(float(a)) and abs(float(a) - float(b)) < tol, (a, b)


for case in manifest:
    model = case["model"]
    old = case["version"] == "2.4.15"
    cim = "{" + ("http://iec.ch/TC57/2013/CIM-schema-cim16#" if old else "http://iec.ch/TC57/CIM100#") + "}"
    with zipfile.ZipFile(directory / case["filename"]) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == 4
        roots = {name.split("_")[-2]: ET.fromstring(archive.read(name)) for name in archive.namelist()}
    assert set(roots) == {"EQ", "SSH", "TP", "SV"}
    definitions = {"#" + e.attrib[RDF + "ID"]: e for root in roots.values() for e in root if RDF + "ID" in e.attrib}
    header_ids = {p: root.find(MD + "FullModel").attrib[RDF + "about"] for p, root in roots.items()}
    for root in roots.values():
        for e in root:
            if RDF + "ID" in e.attrib:
                uuid.UUID(e.attrib[RDF + "ID"].removeprefix("_"))
            if e.tag != MD + "FullModel" and RDF + "about" in e.attrib:
                assert e.attrib[RDF + "about"] in definitions
            for prop in e:
                uri = prop.get(RDF + "resource", "")
                if uri.startswith("#"):
                    assert uri in definitions, (case["label"], uri)
                elif uri.startswith("urn:uuid:"):
                    assert uri in header_ids.values()
    expected_deps = {"EQ": [], "SSH": ["EQ"], "TP": ["EQ"] if old else ["SSH"], "SV": ["SSH", "TP"] if old else ["TP"]}
    for p, root in roots.items():
        header = root.find(MD + "FullModel")
        deps = [e.attrib[RDF + "resource"] for e in header.findall(MD + "Model.DependentOn")]
        assert deps == [header_ids[d] for d in expected_deps[p]]
        assert ' & <test> "ä"' in header.findtext(MD + "Model.description")
        expected_profile = ({"EQ": "EquipmentCore/3/1", "SSH": "SteadyStateHypothesis/1/1", "TP": "Topology/4/1", "SV": "StateVariables/4/1"}[p]
                            if old else {"EQ": "CoreEquipment", "SSH": "SteadyStateHypothesis", "TP": "Topology", "SV": "StateVariables"}[p] + "-EU/3.0")
        assert header.findtext(MD + "Model.profile") == ("http://entsoe.eu/CIM/" if old else "http://iec.ch/TC57/ns/CIM/") + expected_profile

    def elements(profile, name):
        return roots[profile].findall(cim + name)

    def text(e, key):
        value = e.findtext(cim + key)
        assert value is not None, (e.tag, key)
        return value

    def reference(e, key):
        return e.find(cim + key).attrib[RDF + "resource"]

    by_name = {e.findtext(cim + "IdentifiedObject.name"): e for e in definitions.values() if e.find(cim + "IdentifiedObject.name") is not None}
    assert len(elements("TP", "TopologicalNode")) == model["windings"]
    assert len(elements("EQ", "PowerTransformer")) == 1 + bool(model["tp"]["on"] and not model["noLoad"])
    assert len(elements("EQ", "EnergyConsumer")) == (0 if model["noLoad"] else model["windings"] - 1)
    assert bool(roots["SSH"].findall(".//" + cim + "Equipment.inService")) != old
    for v in elements("SV", "SvVoltage"):
        bus = definitions[reference(v, "SvVoltage.TopologicalNode")].findtext(cim + "IdentifiedObject.name")
        near(text(v, "SvVoltage.v"), case["buses"][bus]["vKv"])
        near(text(v, "SvVoltage.angle"), case["buses"][bus]["angleDeg"])

    # Each flow must reference the correct equipment terminal; total injected power at every bus must balance.
    balance = {}
    terminal_bus = {e.attrib[RDF + "about"]: reference(e, "Terminal.TopologicalNode") for e in elements("TP", "Terminal")}
    for flow in elements("SV", "SvPowerFlow"):
        term = reference(flow, "SvPowerFlow.Terminal")
        term_name = text(definitions[term], "IdentifiedObject.name")
        flow_name = term_name.removesuffix(" T1") if term_name.startswith(("Grid", "LD")) else term_name
        for field in ("p", "q"):
            value = float(text(flow, "SvPowerFlow." + field))
            near(value, case["flows"][flow_name][field])
            key = (terminal_bus[term], field)
            balance[key] = balance.get(key, 0) + value
    assert max(map(abs, balance.values())) < 1e-6

    # Compare nameplate impedances against the repository's independently generated CGMES examples.
    if case["label"] in ("TC08_2W_RTC1_PTClin2", "TC01_3W_RTC1_PTCtab2"):
        source = Path(__file__).parent / "examples" / case["label"] / (case["label"] + ".zip")
        with zipfile.ZipFile(source) as archive:
            root = ET.fromstring(archive.read(next(n for n in archive.namelist() if "_EQ_" in n)))
        ref_cim = "{http://iec.ch/TC57/CIM100#}"
        for e in root.findall(ref_cim + "PowerTransformerEnd"):
            target = by_name[e.findtext(ref_cim + "IdentifiedObject.name")]
            for field in ("r", "x", "g", "b", "ratedU", "ratedS"):
                near(text(target, "PowerTransformerEnd." + field), e.findtext(ref_cim + "PowerTransformerEnd." + field), 1e-7)

    for tc in model["taps"]:
        name = "TX " + ("RTC" if tc["type"] == "RTC" else "PTC") + str(tc["end"])
        e = by_name[name]
        key = "#" + e.attrib[RDF + "ID"]
        ssh = next(e for e in roots["SSH"] if e.get(RDF + "about") == key)
        near(text(ssh, "TapChanger.step"), tc["step"])
        sv = next(e for e in elements("SV", "SvTapStep") if reference(e, "SvTapStep.TapChanger") == key)
        near(text(sv, "SvTapStep.position"), tc["step"])
        end = definitions[reference(e, ("RatioTapChanger" if tc["type"] == "RTC" else "PhaseTapChanger") + ".TransformerEnd")]
        near(text(end, "TransformerEnd.endNumber"), tc["end"])
        inverse = model["end2Rule"] == "invert" and tc["end"] > 1
        if tc["type"] == "PTClin":
            near(text(e, "PhaseTapChangerLinear.stepPhaseShiftIncrement"), tc["deg"] * (-1 if inverse else 1))
        if tc["type"] == "PTCtab":
            table = reference(e, "PhaseTapChangerTabular.PhaseTapChangerTable")
            points = [p for p in elements("EQ", "PhaseTapChangerTablePoint") if reference(p, "PhaseTapChangerTablePoint.PhaseTapChangerTable") == table]
            assert len(points) == len(tc["table"])
            for p, original in zip(points, tc["table"]):
                near(text(p, "TapChangerTablePoint.ratio"), 1 / original["ratio"] if inverse else original["ratio"])
                near(text(p, "PhaseTapChangerTablePoint.angle"), original["angle"] * (-1 if inverse else 1))
        if tc.get("control", {}).get("target"):
            c = tc["control"]
            ctl = reference(e, "TapChanger.TapChangerControl")
            settings = next(e for e in elements("SSH", "TapChangerControl") if e.get(RDF + "about") == ctl)
            near(text(settings, "RegulatingControl.targetValue"), c["value"])
            near(text(settings, "RegulatingControl.targetDeadband"), c["deadband"])
            assert text(settings, "RegulatingControl.enabled") == str(c["on"]).lower()
            assert text(ssh, "TapChanger.controlEnabled") == str(c["on"]).lower()
            terminal = definitions[reference(definitions[ctl], "RegulatingControl.Terminal")]
            assert text(terminal, "IdentifiedObject.name") == ("TX T" + c["target"][-1] if c["target"].startswith("V:") else "TX T1")

print(f"{len(manifest)} CGMES archives checked: both versions, all presets/readings, edited grids and controllers; 0 failures")
