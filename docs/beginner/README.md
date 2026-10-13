# Start here

These pages are for a programmer who knows basic JavaScript or Python (loops, functions, objects) but not power
systems or complex numbers in practice. Short sentences, many small examples.

## What this repository is

A **browser simulator** for tap changers. A tap changer is the "gear switch" of a transformer: it changes the voltage
ratio (ratio tap changer) or turns the voltage angle (phase tap changer). You choose tap changers on the ends of a
two- or three-winding transformer, move their steps, and the page computes the load flow (all voltages and power
flows), draws a diagram and explains in words what each tap changer does. It contains the 64 test cases of the
companion repository "CGMES 3.0 tap changer test cases" as presets, and it reproduces their expected results.

Who uses it: people who learn how tap changers work, and developers who check their own grid software against the
test cases.

## Reading order

| # | Page | You learn |
|---|---|---|
| 1 | [10-math-and-physics.md](10-math-and-physics.md) | voltage and power, per unit, complex numbers, transformers, the five tap-changer kinds, which end matters, the load flow, control with deadband - with worked numbers |
| 2 | [01-tour.md](01-tour.md) | every file: what it is and who writes it |
| 3 | [02-how-a-calculation-runs.md](02-how-a-calculation-runs.md) | the path of one click through the code, function by function |
| 4 | [03-run-and-test.md](03-run-and-test.md) | open the page, run the tests, regenerate the generated files |
| 5 | [04-first-change.md](04-first-change.md) | a tried walkthrough: add a test, change a text |
| 6 | [05-glossary.md](05-glossary.md) | all words and abbreviations |

Then read the code in this order: `solver.mjs` (top to bottom) -> the page script at the end of `index.html` ->
`explain.mjs`. Every file starts with a "For beginners" comment, and every function has a comment that says what it
does, with units and examples.

## The worked examples

[`examples/worked_examples.py`](examples/worked_examples.py) computes every number of the math page with plain
formulas and compares them with `solver.mjs` ([`examples/crosscheck.mjs`](examples/crosscheck.mjs)):

```bash
cd docs/beginner/examples
python3 worked_examples.py       # needs Node.js; last line: 0 cross-check(s) outside tolerance
```

## Three things to remember

1. **A tap changer on end 1 divides, one on end 2 multiplies** (seen from the grid side B1). The same setting on
   the wrong end has the opposite effect.
2. **An angle moves active power (MW), a ratio moves reactive power (Mvar).** Switch the parallel transformer TP on
   and off to see it.
3. **`standalone.html`, `EXPLANATIONS.md` and `explanations.html` are generated.** Edit the sources and run
   `python3 bundle.py` / `node explain_all.mjs`.
