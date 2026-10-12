# A tour of the files

The repository is one web page plus the JavaScript behind it, a few tests and two generated documents. There is no
build step: the browser runs the `.mjs` files directly.

| File | What it is | Made by | Read it when |
|---|---|---|---|
| `README.md` | what the simulator does, how to open it, the files | by hand | first |
| `index.html` | **the page**: HTML for the inputs and panels, CSS, and the page script (inputs -> model -> `run()` -> drawings) | by hand | you change what the page shows |
| `solver.mjs` | **the load flow**: complex numbers, tap values (`tapValue`), the network (`build`), Newton-Raphson (`solve`), results, contribution chains, automatic control (`solveWithControl`) | by hand | you want the physics in code |
| `explain.mjs` | **the explanation text** of a combination of tap changers (`explain`), as HTML (`renderHtml`) or Markdown (`renderMarkdown`) | by hand | you change the texts |
| `presets.json` | the 64 test cases: tap data and expected results | the tools of the test-case repository (not part of this repository) | you add a test |
| `standalone.html` | `index.html` with `solver.mjs`, `explain.mjs` and `presets.json` pasted in; opens from disk | `python3 bundle.py` | never edit |
| `bundle.py` | writes `standalone.html` | by hand | you add a module or an import |
| `explain_all.mjs` | writes `EXPLANATIONS.md` and `explanations.html` (all 32 combinations) | by hand | |
| `EXPLANATIONS.md`, `explanations.html` | the explanation of every combination, with both cases of its pair | `node explain_all.mjs` | you want to read, not click |
| `test_solver.mjs` | checks the solver against the 64 cases (78 comparisons) | by hand | |
| `test_control.mjs` | tests of the automatic tap control | by hand | you change `solveWithControl` |
| `test_explain.mjs` | checks the explanations: completeness, the physics they claim, 2,000 random models | by hand | you change `explain.mjs` |
| `smoke_ui.mjs` | runs the page script with a fake browser and opens every preset | by hand | you change `index.html` |
| `.nojekyll` | tells GitHub Pages to serve the files as they are | | |
| `docs/beginner/` | these pages and the worked examples | by hand | you are new |

## How the parts fit together

```
 index.html (page script)
   │ import
   ├────────► solver.mjs ◄──────── test_solver.mjs, test_control.mjs
   │            ▲
   │ import     │ import
   └────────► explain.mjs ◄─────── test_explain.mjs, explain_all.mjs ──► EXPLANATIONS.md, explanations.html
                                    smoke_ui.mjs runs the page script in Node.js
 bundle.py: index.html + solver.mjs + explain.mjs + presets.json ──► standalone.html
```

`solver.mjs` imports nothing. `explain.mjs` imports only `solver.mjs`. The page imports both. This simple shape is
what `bundle.py` relies on when it pastes the modules into one file.

## Where the numbers come from

`presets.json` was written by the test-case repository (CGMES 3.0 tap changer test cases): every case's tap data and
its expected bus voltages from the case's SV, which a separate reference solver (Python) computed from the CGMES
files and PowSyBl cross-checked. `test_solver.mjs` shows that `solver.mjs` reproduces all of them to about 1e−11 pu.
