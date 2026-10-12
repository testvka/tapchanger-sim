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

Open `standalone.html` directly in a browser. `index.html` is the same page as separate files; it needs a web server
(`python3 -m http.server` in this folder, then http://localhost:8000/), because browsers load JavaScript modules and
`presets.json` only over http.

Files:
- `solver.mjs`: load flow with complex tap ratios (each tap changer is an ideal transformer at its end's terminal,
  v_terminal = t · v_internal; polar Newton-Raphson). Same model as the reference solver that computed the SVs of the
  64 CGMES 3.0 test cases. `solveWithControl()` adds the discrete tap control.
- `presets.json`: the 64 cases (tap data and expected bus voltages), written by the test-case tools (not part of this repository).
- `standalone.html`: bundled from index.html, solver.mjs and presets.json by the test-case tools; do not edit it.
- `test_solver.mjs`: `node test_solver.mjs` solves every preset and compares it with the expected solution (78
  comparisons including the inverted readings; largest difference 1.1e-11 pu).
- `test_control.mjs`: `node test_control.mjs`, 8 tests of the automatic control.
- `smoke_ui.mjs`: `node smoke_ui.mjs [standalone.html]` runs the page script against a minimal mock DOM and renders
  all presets.
