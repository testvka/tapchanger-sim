# Tap changer simulator

A browser page (plain JavaScript, no build step) for ratio and phase tap changers on a two- or three-winding
transformer. Per end you can place one RatioTapChanger and one PhaseTapChanger (Linear, Symmetrical, Asymmetrical or
Tabular), move the steps, change transformer and tap data, switch the parallel transformer TP, the loads and no-load
operation, and choose how linear/tabular phase tap changers on end 2 are read (on their own winding, as in ENTSO-E's
CGMES 3.0 data, or inverted, the convention of ENTSO-E's CGMES 2.4.15 conformity cases).

The page shows the load flow (bus voltages, flows, losses), a single-line diagram, and a phasor chain with a waterfall
chart that splits the voltage change into the part caused by each tap changer and the part caused by the network.
Every tap changer can be put under automatic control: a ratio tap changer holds the voltage of B2 or B3, a phase
tap changer the active power into TX. The controller moves one step per round until the value is inside
setpoint ± deadband/2; it stops at a step limit, when it starts to oscillate between two steps, or when a step has no
effect.

Under each tap-changer menu a short note says what the chosen class does, with its formula (n = step − neutral).

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

Files:
- `solver.mjs`: load flow with complex tap ratios (each tap changer is an ideal transformer at its end's terminal,
  v_terminal = t · v_internal; polar Newton-Raphson). Same model as the reference solver that computed the SVs of the
  64 CGMES 3.0 test cases. `solveWithControl()` adds the discrete tap control.
- `presets.json`: the 64 cases (tap data and expected bus voltages), written by the test-case tools (not part of this repository).
- `explain.mjs`: the explanation of a combination (`explain(model, result, presets)`), as HTML or Markdown.
- `explain_all.mjs`: `node explain_all.mjs` writes `EXPLANATIONS.md` and `explanations.html` for all 32 pairs.
- `standalone.html`: `python3 bundle.py` bundles it from index.html, solver.mjs, explain.mjs and presets.json; do
  not edit it.
- `test_solver.mjs`: `node test_solver.mjs` solves every preset and compares it with the expected solution (78
  comparisons including the inverted readings; largest difference 1.1e-11 pu).
- `test_control.mjs`: `node test_control.mjs`, 8 tests of the automatic control.
- `smoke_ui.mjs`: `node smoke_ui.mjs [standalone.html]` runs the page script against a minimal mock DOM and renders
  all presets, including their explanation.
- `test_explain.mjs`: `node test_explain.mjs` explains every preset (both readings, with and without TP), compares the
  pair table with the stored results, checks the physics the text states (no-load voltage = V_B1 · t_k / t_1, a pure
  phase shift moves active power in the direction of its angle, a pure ratio change mainly reactive power) and
  explains 2,000 random combinations.

## License

MIT, see [LICENSE](LICENSE): you may use, change and share the simulator, also commercially, as long as the copyright and licence notice stays with them.
