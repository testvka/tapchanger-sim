# Tap changer simulator

A browser page (plain JavaScript, no build step) for ratio and phase tap changers on a two- or three-winding
transformer. Per end you can place one RatioTapChanger and one PhaseTapChanger (Linear, Symmetrical, Asymmetrical or
Tabular), move the steps, change transformer and tap data, switch the parallel transformer TP, the loads and no-load
operation, and choose how linear/tabular phase tap changers on end 2 are read (on their own winding, as in ENTSO-E's
CGMES 3.0 data, or inverted, the convention of ENTSO-E's CGMES 2.4.15 conformity cases).

Choose **CGMES 2.4.15** or **CGMES 3.0.0** in the export version selector, then click **Export CGMES** to download
the current combination as a ZIP containing EQ, SSH, TP, SV and DL (diagram layout, a simple single-line diagram) XML files. The snapshot includes the source voltage,
loads, transformer nameplate data, active parallel transformer, every tap changer and its table, controller settings,
and the displayed voltages, power flows and tap positions after automatic control. At no load, loads and TP are
omitted. Export works offline in `standalone.html` and requires a converged load flow.

### Import

**Import CGMES** (left panel) reads a CGMES 2.4.15 or 3.0.0 ZIP, or loose XML files (select EQ, SSH, TP and SV together), and
opens it in the simulator. Several cases, such as a scenario archive from the export, are added to the scenario list
instead. Files from this simulator come back unchanged (same load flow to 1e-15 pu). Other files are accepted only when
all elements are ones the simulator models, otherwise nothing is imported and every problem is listed:
- one `ExternalNetworkInjection` at 220 kV (voltage from its regulating control, else from the SV voltage);
- one `PowerTransformer` TX with 2 or 3 windings of 220 / 110 / 20 kV, with ratedS, r, x, g, b (uk, ur, i0, p0 are
  recomputed); optionally a second 2-winding 220 / 110 kV transformer without tap changers as TP;
- `RatioTapChanger` and `PhaseTapChanger` Linear / Symmetrical / Asymmetrical / Tabular on TX (one of each kind per end,
  steps from SSH, tables complete), with optional `TapChangerControl` (voltage at a transformer bus, or active power at end 1);
- `EnergyConsumer` on the 110 / 20 kV buses (p, q from SSH);
- no other equipment, nothing out of service, no disconnected terminal.

If the file has an SV, its voltages are compared with the simulator's load flow of the imported grid and a difference
above 0.1 % of nominal is reported as a warning. Phase tap data are read in the CGMES own-winding reading. ZIPs
compressed by other tools need a browser with `DecompressionStream`.

### Scenario list (many CGMES cases at once)

The **Scenario list** panel generates scenarios for all 32 tap-changer combinations: every tap changer of a scenario is
moved by the same number of steps from neutral (default -12, 0, +12; any whole numbers from -12 to 12, limited to the
changer's own low..high range, duplicates dropped), as an **open-circuit test** (TX alone, i0 0.10 %, p0 0.04 %) and at
**50 % and 100 % load** (cos φ 0.95). 100 % is the rated power of the transformers (TX, plus TP when it is on; in the
three-winding grid B3 takes the rating of winding 3), the load at which uk is defined: rated current flows and the voltage
drop is uk. Scenarios with a phase shifter are also made with the parallel transformer TP switched on. With the defaults
this gives 438 scenarios. **Generate all scenarios** solves them in one click, the table lists tap steps, TP and the bus
voltages, and **Open** loads one into the simulator. **Add current simulator state** puts the state you built by hand on
the list. **Export selected / Export all** download one big ZIP with a folder per scenario holding the CGMES ZIP
(3.0.0, 2.4.15 or both), plus `scenarios.csv` as an overview. Scenarios without a load-flow solution are listed but not
exported. The list is not kept when the page is reloaded.

The selected phase-reading convention is preserved electrically: for an inverted linear/tabular phase tap changer
on end 2 or 3, the writer negates its phase increment or table angles and reciprocates its table ratios. The files
therefore describe the displayed state using the CGMES own-winding convention in either version; the original
reading is recorded in the model description. Selecting an export version does not change the simulator's reading.

The page shows the load flow (bus voltages, flows, losses), a single-line diagram, and a phasor chain with a waterfall
chart that splits the voltage change into the part caused by each tap changer and the part caused by the network.
Every tap changer can be put under automatic control: a ratio tap changer holds the voltage of B2 or B3, a phase
tap changer the active power into TX. The controller moves one step per round until the value is inside
setpoint ± deadband/2; it stops at a step limit, when it starts to oscillate between two steps, or when a step has no
effect.

Below the diagram, the page explains the current combination of tap changers in words, with the numbers of the
current load flow: what each tap changer does at its step and on its end, how the tap changers combine (the effective
ratio t_k / t_1 between B1 and each other bus), what the network makes of it (with load and the parallel TP: the
circulating active and reactive power compared with the same network without tap changers; at no load: the
open-circuit voltages), and what a program reading such a case must get right (end, sign convention, formula of the
phase tap changer type). The 64 example cases form 32 pairs with the same tap changers: TCnn with load and NLnn at no
load. For a combination that matches one of them the explanation shows both cases of the pair side by side, with
buttons to switch between them. `explanations.html` (and `EXPLANATIONS.md`) list the explanations of all 32 pairs;
`index.html#TC08_2W_RTC1_PTClin2` opens a case directly.

Open `standalone.html` directly in a browser. `index.html` is the same page as separate files; it needs a web server
(`python3 -m http.server` in this folder, then http://localhost:8000/), because browsers load JavaScript modules and
`presets.json` only over http.

New to power systems or to this code? Start with [docs/beginner/README.md](docs/beginner/README.md): the physics with
worked examples, a tour of the files, how one calculation runs, how to test and change it.

Files:
- `solver.mjs`: load flow with complex tap ratios (each tap changer is an ideal transformer at its end's terminal,
  v_terminal = t · v_internal; polar Newton-Raphson). Same model as the reference solver that computed the SVs of the
  64 CGMES 3.0 test cases. `solveWithControl()` adds the discrete tap control.
- `presets.json`: the 64 cases (tap data and expected bus voltages), written by the test-case tools (not part of this repository).
- `explain.mjs`: the explanation of a combination (`explain(model, result, presets)`), as HTML or Markdown.
- `cgmes.mjs`: dependency-free CGMES 2.4.15 / 3.0.0 XML and ZIP writer (`createCgmesExport(model, result, options)`).
- `cgmes_import.mjs`: CGMES reader (`importFiles`, `importCgmes`, `unzip`); `test_import.mjs` round-trips every preset, edited grid, controller and scenario and checks that invalid files are rejected.
- `scenarios.mjs`: scenario generator and big-ZIP export (`generateScenarios`, `evaluate`, `exportScenarios`).
- `explain_all.mjs`: `node explain_all.mjs` writes `EXPLANATIONS.md` and `explanations.html` for all 32 pairs.
- `standalone.html`: `python3 bundle.py` bundles it from index.html, solver.mjs, explain.mjs, cgmes.mjs, scenarios.mjs, cgmes_import.mjs and presets.json; do
  not edit it.
- `test_solver.mjs`: `node test_solver.mjs` solves every preset and compares it with the expected solution (78
  comparisons including the inverted readings; largest difference 1.1e-11 pu).
- `test_control.mjs`: `node test_control.mjs`, 8 tests of the automatic control.
- `test_cgmes.mjs`: `node test_cgmes.mjs` checks both export versions for all presets and readings, edited grids,
  controllers and invalid inputs. Uses Python 3's standard-library ZIP/XML readers to validate archives, references,
  profile dependencies, tap data, settings, voltages and power balance; compares impedances with the CGMES examples.
- `test_scenarios.mjs`: `node test_scenarios.mjs` checks the generator (32 combinations, ranges, TP only with phase shifters,
  rated load, power balance and non-negative losses of every scenario) and the big ZIP with Python's `zipfile`.
- `smoke_ui.mjs`: `node smoke_ui.mjs [standalone.html]` runs the page script against a minimal mock DOM and renders
  all presets, including their explanation.
- `test_explain.mjs`: `node test_explain.mjs` explains every preset (both readings, with and without TP), compares the
  pair table with the stored results, checks the physics the text states (no-load voltage = V_B1 · t_k / t_1, a pure
  phase shift moves active power in the direction of its angle, a pure ratio change mainly reactive power) and
  explains 2,000 random combinations.

## CGMES 3.0 example cases

`examples/` holds two of the 64 cases as CGMES 3.0 files (EQ, SSH, TP and SV in one zip), with their expected
solution. Both are loaded cases with a ratio tap changer on end 1 and a phase tap changer on end 2, the end where the
reading of the phase shift matters:

- `examples/TC08_2W_RTC1_PTClin2`: two-winding transformer, RatioTapChanger on end 1 + PhaseTapChangerLinear on
  end 2 (`index.html#TC08_2W_RTC1_PTClin2` opens it in the simulator).
- `examples/TC01_3W_RTC1_PTCtab2`: three-winding transformer, RatioTapChanger on end 1 + PhaseTapChangerTabular on
  end 2 (`index.html#TC01_3W_RTC1_PTCtab2`).

`python3 examples/check_examples.py` checks that the SV voltages of both cases (and of the inverted end-2 reading)
equal the expected values the simulator uses. See `examples/README.md`.
