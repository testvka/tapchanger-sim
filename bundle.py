"""Single-file simulator: standalone.html = index.html with solver.mjs, explain.mjs, cgmes.mjs, scenarios.mjs and presets.json inlined (no module
import, no fetch). It runs where the multi-file page cannot: opened from disk (file://) or from a server that does
not serve .mjs as JavaScript.  Usage: python3 bundle.py

For beginners: a browser loads JavaScript modules (import ... from "./solver.mjs") and fetches JSON only over
http, not from a file opened from disk. This script pastes solver.mjs, explain.mjs and cgmes.mjs into the page, each inside
its own function (so their private names cannot clash), drops the "export" keywords, and replaces the fetch of
presets.json by the JSON text. Every assumption about the source files is checked with assert: an AssertionError
means a module now uses a form this script does not understand (e.g. "export default" or a second import line).
Run it after every change to index.html, solver.mjs, explain.mjs, cgmes.mjs or presets.json; it overwrites standalone.html.
Read first: main(), module(), imports().
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    """Text of a file in this folder."""
    return open(os.path.join(HERE, name), encoding="utf-8").read()


def safe(text: str) -> str:
    """Text placed inside a <script> element must not contain '</script'."""
    out = re.sub(r"</(script)", r"<\\/\1", text, flags=re.I)
    assert not re.search(r"</script", out, re.I)
    return out


def module(src: str, name: str):
    """Exported names and the body of a module without its export keywords.

    Example: "export const C = ..." gives the name "C" and the line "const C = ...". Raises AssertionError if an
    "export " is left that is not at the start of a line (outside // comments). Careful: the word "export" followed
    by a space inside a /* ... */ comment also trips this check, so JSDoc comments must not contain it.
    """
    names = re.findall(r"^export (?:const|let|function|class|async function) (\w+)", src, re.M)
    body = re.sub(r"^export ", "", src, flags=re.M)
    assert "export " not in re.sub(r"//.*", "", body), f"unhandled export form in {name}"
    return names, body


def imports(src: str, name: str):
    """The names one import line takes from ./<name>, and that line.

    Example: 'import { solve, C } from "./solver.mjs";' gives (["solve", "C"], that line). Raises AssertionError if
    there is no such line.
    """
    m = re.search(r'^import \{([^}]*)\} from "\./' + re.escape(name) + r'";$', src, re.M)
    assert m, f"import line of {name} not found"
    return [n.strip() for n in m.group(1).split(",") if n.strip()], m.group(0)


def main():
    """Build standalone.html (see the module docstring)."""
    html, solver, expl = read("index.html"), read("solver.mjs"), read("explain.mjs")
    cgmes = read("cgmes.mjs")
    presets = json.load(open(os.path.join(HERE, "presets.json"), encoding="utf-8"))
    assert not re.search(r"^\s*import\b", solver, re.M), "solver.mjs imports other modules"
    s_names, s_body = module(solver, "solver.mjs")
    e_wanted, e_line = imports(expl, "solver.mjs")
    assert all(n in s_names for n in e_wanted), set(e_wanted) - set(s_names)
    e_names, e_body = module(expl.replace(e_line, ""), "explain.mjs")
    assert not re.search(r"^\s*import\b", e_body, re.M), "explain.mjs has a second import"
    h_solver, h_solver_line = imports(html, "solver.mjs")
    h_expl, h_expl_line = imports(html, "explain.mjs")
    c_wanted, c_line = imports(cgmes, "solver.mjs")
    assert all(n in s_names for n in c_wanted), set(c_wanted) - set(s_names)
    c_names, c_body = module(cgmes.replace(c_line, ""), "cgmes.mjs")
    assert not re.search(r"^\s*import\b", c_body, re.M), "cgmes.mjs has a second import"
    h_cgmes, h_cgmes_line = imports(html, "cgmes.mjs")
    assert all(n in c_names for n in h_cgmes), set(h_cgmes) - set(c_names)
    scen = read("scenarios.mjs")
    sc_from = {m: imports(scen, m) for m in ("solver.mjs", "explain.mjs", "cgmes.mjs")}
    for mod, names in (("solver.mjs", s_names), ("explain.mjs", e_names), ("cgmes.mjs", c_names)):
        assert all(n in names for n in sc_from[mod][0]), (mod, set(sc_from[mod][0]) - set(names))
    sc_body = scen
    for _, line in sc_from.values():
        sc_body = sc_body.replace(line, "")
    sc_names, sc_body = module(sc_body, "scenarios.mjs")
    assert not re.search(r"^\s*import\b", sc_body, re.M), "scenarios.mjs has another import"
    h_scen, h_scen_line = imports(html, "scenarios.mjs")
    assert all(n in sc_names for n in h_scen), set(h_scen) - set(sc_names)
    # "presetModel as presetModelOf" -> {"presetModel": "presetModelOf"}; a plain name maps to None
    alias = dict(re.match(r"(\w+)(?:\s+as\s+(\w+))?$", n).groups() for n in h_expl)
    assert all(n in s_names for n in h_solver), set(h_solver) - set(s_names)
    assert all(n in e_names for n in alias), set(alias) - set(e_names)
    inline = ("// ---- solver.mjs, inlined by bundle.py (own scope, so its helpers do not clash) ----\n"
              "const __solver = (() => {\n" + s_body + "\nreturn { " + ", ".join(s_names) + " };\n})();\n"
              f"const {{ {', '.join(h_solver)} }} = __solver;\n"
              "// ---- explain.mjs, inlined ----\n"
              "const __explain = (() => {\n"
              f"const {{ {', '.join(e_wanted)} }} = __solver;\n" + e_body
              + "\nreturn { " + ", ".join(e_names) + " };\n})();\n"
              f"const {{ {', '.join(k + (': ' + v if v else '') for k, v in alias.items())} }} = __explain;\n"
              "// ---- cgmes.mjs, inlined ----\n"
              "const __cgmes = (() => {\n"
              f"const {{ {', '.join(c_wanted)} }} = __solver;\n" + c_body
              + "\nreturn { " + ", ".join(c_names) + " };\n})();\n"
              f"const {{ {', '.join(h_cgmes)} }} = __cgmes;\n"
              "// ---- scenarios.mjs, inlined ----\n"
              "const __scenarios = (() => {\n"
              + "".join(f"const {{ {', '.join(sc_from[m][0])} }} = {v};\n" for m, v in (("solver.mjs", "__solver"), ("explain.mjs", "__explain"), ("cgmes.mjs", "__cgmes")))
              + sc_body + "\nreturn { " + ", ".join(sc_names) + " };\n})();\n"
              f"const {{ {', '.join(h_scen)} }} = __scenarios;\n"
              "// ---- presets.json, inlined ----\n"
              f"const PRESETS_INLINE = {json.dumps(presets, separators=(',', ':'))};\n")
    html = html.replace(h_solver_line, safe(inline), 1).replace(h_expl_line + "\n", "", 1)
    html = html.replace(h_cgmes_line + "\n", "", 1).replace(h_scen_line + "\n", "", 1)
    assert h_expl_line not in html
    assert not re.search(r"^\s*import\b", html, re.M), "standalone page still imports a module"
    a = 'fetch("./presets.json").then((r) => r.json())'
    assert html.count(a) == 1, "presets fetch not found"
    html = html.replace(a, "Promise.resolve(PRESETS_INLINE)", 1)
    html = "<!-- generated by bundle.py from index.html + solver.mjs + explain.mjs + cgmes.mjs + presets.json; edit those, not this -->\n" + html
    out = os.path.join(HERE, "standalone.html")
    open(out, "w", encoding="utf-8").write(html)
    print(f"wrote {out} ({len(html) / 1024:.0f} kB, {len(presets)} presets, {len(s_names)} solver + {len(e_names)} explain + {len(c_names)} CGMES exports)")


if __name__ == "__main__":
    main()
