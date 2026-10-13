# Your first change: a new test and a changed sentence

This walkthrough makes two small changes and shows what to run afterwards. It was tried on a copy of the repository
on 2026-10-12; the outputs below are from that run.

## Change 1: add a control test

Goal: check that a ratio tap changer on end 3 of a three-winding transformer can hold the voltage of B3 by itself.

Open `test_control.mjs`. Each test builds a model, switches on the control of a tap changer and states the expected
final status. Add these lines just before the last line (`process.exit(...)`):

```js
m = defaultModel(3);
m.taps = [{ end: 3, type: "RTC", low: 1, high: 5, neutral: 3, step: 3, svi: 2.5,
            control: { on: true, target: "V:B3", value: 20.5, deadband: 0.6 } }];
check("3W: RTC end 3 alone holds B3 at 20.5 ± 0.3 kV", m, ["held"]);
```

What the fields mean: the tap changer has steps 1..5, neutral 3, 2.5 % per step (the off-load tap changer of the
test cases); it starts at neutral; the controller should hold B3 at 20.5 kV with a 0.6 kV deadband, so the band is
20.2 .. 20.8 kV (see [10-math-and-physics.md](10-math-and-physics.md), section 9).

Run it:

```bash
node test_control.mjs
```

New last line:

```
ok   3W: RTC end 3 alone holds B3 at 20.5 ± 0.3 kV: RTC end 3 held at step 4: 20.59 (target 20.5); 1 moves
```

One step up (2.5 %) brought B3 into the band. If you expect `"at limit"` instead of `"held"`, the line starts with
`FAIL` and the exit code is 1.

## Change 2: change a sentence of the explanation

The texts are template strings in `explain.mjs`. For example the constant `KIND` holds one sentence per tap-changer
type. Change the RTC sentence:

```js
RTC: "A ratio tap changer (the 'gear switch' of the winding) scales the winding voltage in phase: ...",
```

**Watch the quotes.** The string is written in double quotes, so use single quotes inside it. The first try of this
walkthrough used double quotes inside and every Node.js command failed with
`SyntaxError: Unexpected identifier 'gear'`, while `python3 bundle.py` still "succeeded" (it does not check the
JavaScript). Always run the tests.

Then regenerate and test:

```bash
node explain_all.mjs            # wrote EXPLANATIONS.md (130 kB) and explanations.html (158 kB) for 32 configurations
python3 bundle.py               # wrote standalone.html (122 kB, 64 presets, 20 solver + 6 explain exports)
node test_solver.mjs            # 78 comparisons, 0 failures, worst 1.05e-11 pu
node test_explain.mjs           # 2329 checks (...), 0 failures
node smoke_ui.mjs standalone.html   # 64 presets rendered, 0 failures
```

`git status` then shows: `explain.mjs`, `test_control.mjs` (your edits) and the three generated files
`EXPLANATIONS.md`, `explanations.html`, `standalone.html`. Commit all of them together, so the generated files match
the source.

## Other typical changes

| You want to... | Change | Then |
|---|---|---|
| change the default data of a new tap changer | `DEF` in `index.html` | `python3 bundle.py`, `node smoke_ui.mjs standalone.html` |
| change a formula of the physics | `solver.mjs` (`tapValue`, `build`) | all tests; `test_solver.mjs` must still match the 64 cases - if not, the formula is wrong or the test cases must be rebuilt in the test-case repository |
| add an output to the page | `run()` in `index.html` (and an element with an `id` in the HTML part) | `bundle.py`, `smoke_ui.mjs` |
| change the control rules | `solveWithControl` in `solver.mjs` | `node test_control.mjs` |
