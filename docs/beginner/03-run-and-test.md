# Run and test

## What you need

| For | Install |
|---|---|
| using the simulator | a web browser |
| the tests and the generated documents | Node.js 18 or newer (no npm packages) |
| `bundle.py` and the worked examples | Python 3 (standard library only) |

## Open the simulator

- **`standalone.html`**: double-click it. Everything is inside one file, so it also works offline.
- **`index.html`**: the same page as separate files. Browsers load JavaScript modules and `presets.json` only over
  http, so start a small web server in the repository folder first:

  ```bash
  python3 -m http.server 8000        # then open http://localhost:8000/
  ```

- `index.html#TC08_2W_RTC1_PTClin2` opens a case directly; `explanations.html` lists all 32 combinations.

## Run the tests

From the repository folder:

| Command | What it checks | Good result |
|---|---|---|
| `node test_solver.mjs` | the solver against the expected voltages of all 64 cases, both end-2 readings | `78 comparisons, 0 failures, worst 1.05e-11 pu` |
| `node test_control.mjs` | the automatic tap control (held, at limit, hunting, no effect) | every line starts with `ok` |
| `node test_explain.mjs` | the explanations: complete, correct pair values, the physics they state, 2,000 random models | `... 0 failures` |
| `node smoke_ui.mjs standalone.html` | the page script with a fake browser, every preset | `64 presets rendered, 0 failures` |
| `node smoke_ui.mjs` | the same for `index.html` | same |
| `python3 docs/beginner/examples/worked_examples.py` | the numbers of the math page | `0 cross-check(s) outside tolerance` |

`test_explain.mjs` prints two lines "no solution (solver, not explain): singular Jacobian ..." for a three-winding
no-load model (the random generator draws the same model twice): the Newton-Raphson solver fails from its flat start
there. This is a known
limitation of the solver, not a test failure (the summary still says 0 failures).

## After a change: regenerate

| You changed | Run |
|---|---|
| `index.html`, `solver.mjs`, `explain.mjs` or `presets.json` | `python3 bundle.py` (rewrites `standalone.html`) |
| `explain.mjs` or `solver.mjs` | `node explain_all.mjs` (rewrites `EXPLANATIONS.md` and `explanations.html`) |
| anything | all tests above |

Both generators are deterministic: run on an unchanged repository they write byte-identical files (checked
2026-10-12). `bundle.py` checks its assumptions with `assert` but does **not** check JavaScript syntax: a broken
`solver.mjs` still gets bundled, so always run the tests afterwards.
