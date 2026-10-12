# How one calculation runs, step by step

This page follows what happens when you pick the preset **TC08_2W_RTC1_PTClin2** (a two-winding transformer with a
ratio tap changer on end 1 and a linear phase tap changer on end 2) in the page. Names are given as
`file: function`.

```
 click on the preset list
   │
   ▼
 index.html  openPreset(code) -> presetModel(p) -> setModel(model)
   │            draws the inputs: renderEnds(), renderTxData(), syncNetwork()
   ▼
 index.html  run()
   │
   ├─► solver.mjs  solveWithControl(model)
   │      ├─ solve(model)
   │      │    ├─ build(model): tapValue() per tap changer, transformer matrices, Y, loads
   │      │    ├─ Newton-Raphson loop (solveLinear for each step)
   │      │    └─ results(): kV, degrees, MW, Mvar; chains(): one step per tap changer
   │      └─ (only if a tap changer has "automatic control" on) move steps, solve again ...
   │
   ├─► index.html  sldSvg(r), phasorSvg(r.chains), waterfallSvg(r.chains), tables
   └─► explain.mjs explain(model, r, presets) -> renderHtml() -> the "Explanation" panel
```

## 1. From the preset to the model

`presets.json` holds for TC08: `windings: 2`, `noload: false`, and two tap changers, e.g.
`{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 14, svi: 1.25 }` and
`{ end: 2, type: "PTClin", low: 1, high: 25, neutral: 13, step: 16, deg: 1.5 }`.

`explain.mjs: presetModel(p, defaultModel)` starts from `solver.mjs: defaultModel(2)` (the data of the test cases:
grid at 225 kV, TX and TP 250 MVA uk 12 %, load 200 MW / 60 Mvar) and copies the tap changers in. For no-load
presets it also sets the magnetizing data (i0 0.10 %, p0 0.04 %).

`index.html: setModel(m)` stores the model in the variable `model`, draws the input panels and calls `run()`.
Every later input change edits `model` directly (`onEnd`, `renderTxData`'s handlers, the network switches) and calls
`run()` again.

## 2. Building the network: `solver.mjs: build`

1. `tapValue(tc, end2Rule)` for each tap changer: the RTC gives ratio 1 + 3 · 1.25/100 = 1.0375, the linear PTC gives
   angle (16 − 13) · 1.5 = +4.5° (see [10-math-and-physics.md](10-math-and-physics.md), section 5). The complex
   factors of each end are multiplied: `tEnd[1]` = 1.0375, `tEnd[2]` = 1 at +4.5°.
2. TX: from uk / ur the series impedance in pu; the small 2 x 2 matrix of a pi model; then `terminalY` moves it
   to the bus side with a = 1 / t of each end.
3. TP: the same impedance, no tap changer.
4. `stamp` adds the element matrices into the bus matrix Y (2 x 2 here; 4 x 4 for three windings, with the hidden
   star point).
5. The loads in pu (200 MW -> 2.0 pu).

## 3. Solving: `solver.mjs: solve`

Flat start (all voltages 1.0 pu, 0°; B1 at 225/220 = 1.0227 pu). Each round:

1. currents `I = Y · V` and powers `S = V · conj(I)`;
2. mismatch: network power + load at every bus except B1 (must become 0);
3. the Jacobian J (slopes) and `solveLinear(J, −mismatch)` (Gaussian elimination);
4. add the corrections to angles and sizes.

It stops when the largest mismatch is below 1e−11 pu (1e−9 MVA); for TC08 that takes 3 rounds (the status line says
"converged in 3 Newton iterations"). `results()` then
computes the flows into every element terminal (load sign: positive = from the bus into the element), the losses
and `chains()`: the voltage of B2 split into "start V1 · U2/U1", one step per tap changer (÷ t on end 1, × t on end
2) and the network part.

Result for TC08 (also in the test-case table): B2 = 108.515 kV at −0.549°; TX takes 178.4 MW at B1 because the
+4.5° on end 2 pulls active power into TX.

## 4. Automatic control: `solver.mjs: solveWithControl`

Only when a tap changer has `control.on` (the "automatic control" checkbox). Each round, every controller whose value
is outside target ± deadband/2 first tries one step to learn which direction helps, then moves one step that way,
and the load flow is solved again. It stops when all values are inside their bands, a step limit is reached,
hunting is detected, or a step has no effect. `controlLog` lists the moves, `controlState` the final status per
controller.

## 5. Drawing and explaining: `index.html: run`

`run()` fills the status line, the step read-outs, the single-line diagram (`sldSvg`), the phasor chain and the
waterfall (`phasorSvg`, `waterfallSvg`), the tables, and the explanation:

`explain.mjs: explain(model, r, presets, defaultModel)` finds the matching pair of example cases (`findPair`, by the
key "2W:1RTC+2PTClin"), and builds sections: this combination, what each tap changer does (`tapItem`), how they
combine (`interaction`), what the network makes of it (`network`, which solves the same model once more without tap
changers to show the circulating flow), the pair table, and what a program reading the case must get right
(`reading`). `renderHtml` turns the sections into HTML.

## 6. The same code without a browser

- `explain_all.mjs` calls `presetModel`, `solveWithControl` and `explain` for both cases of each of the 32 pairs
  and writes `EXPLANATIONS.md` and `explanations.html`.
- `test_solver.mjs`, `test_control.mjs`, `test_explain.mjs` import the modules in Node.js.
- `smoke_ui.mjs` cuts the page script out of `index.html` (or `standalone.html`), gives it a fake `document`, and
  opens every preset through the preset list's change handler.
