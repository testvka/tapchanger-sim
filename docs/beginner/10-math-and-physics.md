# The math and physics, very simple

This page explains what you need to understand the code: voltage and power, transformers, tap changers, per unit,
complex numbers, the load flow and automatic control. Each idea comes with an everyday picture first, then the
formula, then a small example with real numbers.

**Where the numbers come from.** Every number in the examples is printed by
[`examples/worked_examples.py`](examples/worked_examples.py). That script also runs
[`examples/crosscheck.mjs`](examples/crosscheck.mjs), which computes the same things with the repository's own
simulator (`solver.mjs`), and it prints both values side by side. Run it yourself:

```bash
cd docs/beginner/examples
python3 worked_examples.py
```

The last line must say `0 cross-check(s) outside tolerance`.

## 1. Voltage, current, power

Think of a water pipe system:

| Electricity | Water picture | Unit |
|---|---|---|
| voltage U (or V) | water pressure | kV (kilovolt) |
| current I | how much water flows | A or kA |
| active power P | the useful work the water does | MW (megawatt) |
| reactive power Q | water that sloshes back and forth in the pipes; it does no work, but the pipes must carry it | Mvar |
| apparent power S | the total the pipe must carry | MVA |

In alternating current (AC) the voltage goes up and down 50 times per second. Two things describe it: its size
(for example 220 kV) and its **angle**, which says how early or late the wave is compared with a reference wave.
Angles are measured in degrees (°).

- **Active power flows from a bus with a larger angle to a bus with a smaller angle.** A bus is a node of the grid
  (here B1, B2, B3).
- **Reactive power mainly flows from a bus with a higher voltage to a bus with a lower voltage.**

These two rules explain almost everything the tap changers do in the test cases.

## 2. Complex numbers are arrows

A voltage with a size and an angle is drawn as an arrow (a "phasor"). The length is the size, the direction is the
angle. In the code an arrow is a complex number `re + j·im`:

- `re` = how far the arrow goes to the right, `im` = how far it goes up;
- `j` is the "imaginary unit" with `j·j = −1`; you can treat it as a label for the "up" part;
- length = `abs(z) = sqrt(re² + im²)`, angle = `arg(z) = atan2(im, re)`;
- an arrow with length m and angle φ is written `m·e^(jφ)` (read: "m at angle φ").

Two rules are all you need:

- **multiply** two arrows: the lengths multiply and the angles add;
- **divide**: the lengths divide and the angles subtract.

Example: `1.0375 · e^(j0°)` times `1 · e^(j4.5°)` = `1.0375 · e^(j4.5°)`.

In `solver.mjs` these are the small functions `C`, `add`, `mul`, `div`, `abs`, `arg`, `polar`.

## 3. Per unit (pu)

Engineers divide every value by a "base" value. Then 1.0 means "nominal" on every voltage level, and numbers from
the 220 kV side and the 110 kV side can be compared directly.

- voltage in pu = voltage in kV / nominal kV of the bus;
- power in pu = power in MW (or Mvar, MVA) / S_base, with **S_base = 100 MVA** in this repository;
- impedance base: `Z_base = U_base² / S_base` (ohm).

Example (script section 1): B1 is held at 225 kV on a 220 kV base: 225 / 220 = **1.02273 pu**.
`Z_base` = 220² / 100 = **484 ohm** at 220 kV and 110² / 100 = **121 ohm** at 110 kV.

## 4. The transformer

A transformer changes the voltage level, like a **gearbox** changes speed: 220 kV on one side become 110 kV on the
other side. The ratio of the "gears" is the ratio of the number of turns of the two windings. Each side is called an
**end**: end 1 = 220 kV, end 2 = 110 kV, and a three-winding transformer has end 3 = 20 kV.

A real transformer is not perfect. It behaves like a perfect gearbox plus a small **impedance** z = r + jx in
series (r = resistance, makes heat; x = reactance, the magnetic "inertia"). The nameplate gives it in percent:

- uk = short-circuit voltage in % (here 12 %): the size of z;
- ur = its resistive part in % (here 0.3 %).

Formulas (code: `solver.mjs: build`):

```
|z| = uk/100 · U² / S        r = ur/100 · U² / S        x = sqrt(|z|² − r²)
```

Example (section 2), 250 MVA, 220 kV: |z| = 0.12 · 220² / 250 = **23.232 ohm**, r = **0.5808 ohm**,
x = **23.2247 ohm**. In pu on 100 MVA: r = 0.0012, x = 0.04798 (that is uk · 100/250).

When the transformer runs without load it still draws a small magnetizing current (i0, a fraction of a percent)
and has iron losses (p0). The no-load cases (NL..) include them; that is why the simulator's open-circuit voltages
below differ from the simple formula by about 0.006 kV.

## 5. The tap changer

A **tap changer** is a switch that selects how many turns of a winding are used. Picture a **water tap**: each
click turns it a little more open or closed. Each click is a **step**.

- `lowStep` .. `highStep`: the steps that exist, e.g. 1..21;
- `neutralStep`: the step where the tap changer does nothing (ratio 1, angle 0), e.g. 11;
- `step`: the current step (from the SSH file), e.g. 14;
- n − n0 = step − neutralStep: how many clicks away from neutral, e.g. 3.

The tap changer is modelled as a perfect extra gearbox at its end of the transformer with a **complex ratio**

```
t = ratio · e^(j·angle)        v_terminal = t · v_inside
```

"v_terminal" is the voltage at the transformer's connection to the bus, "v_inside" the voltage inside the
transformer (before the impedance). Code: `solver.mjs: tapValue`.

### 5.1 Ratio tap changer (RatioTapChanger, RTC)

Changes only the size of the voltage, like the gearbox ratio. Each step adds `stepVoltageIncrement` percent:

```
ratio = 1 + (step − neutralStep) · stepVoltageIncrement / 100        angle = 0
```

Example (section 3): end 1, step 14, neutral 11, 1.25 %/step: ratio = 1 + 3 · 1.25/100 = **1.0375**.
End 2, step 6, neutral 9, 1.5 %/step: ratio = 1 − 3 · 1.5/100 = **0.955**.

### 5.2 Phase tap changers (PhaseTapChanger, PTC)

A phase tap changer (also called phase shifter or PST, phase-shifting transformer) turns the voltage arrow. It
changes the **angle**, and some kinds also the size. CGMES describes four kinds:

| Kind | What it does | Formula | Example (section 3) |
|---|---|---|---|
| Linear | equal angle per step, size stays 1 | angle = (n − n0) · stepPhaseShiftIncrement | step 16, neutral 13, 1.5°: **+4.5°** |
| Symmetrical | adds a voltage du at 90°, half on each side, so the size stays 1 | du = (n − n0) · voltageStepIncrement / 100, angle = 2·atan(du/2) | step 9, neutral 13, 1.6 %: du = −0.064, **−3.6657°** |
| Asymmetrical | adds a voltage du at the fixed angle θ = windingConnectionAngle; size and angle both change | t = 1 + du · e^(jθ) | step 18, neutral 13, 1.5 %, θ = 60°: t = 1.0375 + j0.06495, ratio **1.039531**, angle **+3.5823°** |
| Tabular | angle and ratio are read from a table, one row per step | table lookup | step 9: **+5.5°**, ratio **1.010** |

**Symmetrical vs asymmetrical in pictures.** Draw the voltage as an arrow of length 1 pointing right.

- *Symmetrical*: a small extra arrow du is added at a right angle, split in two halves so that the result keeps
  length 1. The tip moves along the circle. For small steps angle ≈ du (in radians): −0.064 rad = −3.6669°,
  close to the exact −3.6657°.
- *Asymmetrical*: the extra arrow du is added at the angle θ (here 60°). Its part along the voltage
  (du · cos θ = 0.0375) makes the arrow longer, its part across (du · sin θ = 0.06495) turns it. That is why an
  asymmetrical phase shifter also changes the ratio (here 1.0395).

**Why the resulting angle is usually far from θ.** θ (windingConnectionAngle) is a fixed design value — it only
sets the *direction* the small step arrow du points in, not the angle the transformer ends up turning the voltage
by. That angle is arg(t), and

```
t = 1 + du · e^(jθ) = (1 + du·cosθ) + j·du·sinθ          arg(t) = atan2(du·sinθ, 1 + du·cosθ)
```

The "1" is a fixed-length baseline; du is normally small (a few percent per step), so the step arrow is short next
to it and only turns the sum by a small amount — arg(t) only grows to θ itself as |du| → ∞ (du ≫ 1, i.e. an
unrealistically large step). One checkpoint does not depend on how big θ is: by the half-angle identity
sinθ / (1 + cosθ) = tan(θ/2), at |du| = 1 the angle is exactly θ/2, whatever θ is.

Worked example at the extreme case θ = 90° (a pure quadrature booster), step 14, neutral 13, 10 %/step
(du = 1 · 0.10 = 0.10, the simulator's "theta=90" preset):

```
t = 1 + 0.10 · e^(j90°) = 1 + j0.10 = 1.00499∠5.711°
```

Not 90° — even at θ = 90° the angle is only 5.711°, because du = 0.10 is far from the |du| = 1 checkpoint
(which itself would give only θ/2 = 45°, still not 90°). Only for du ≫ 1 does arg(t) approach 90°: du = 1 gives
45°, du = 10 gives 84.3°, du = 1000 gives 89.4° — the limit is reached only asymptotically, never exactly.

**Two tap changers on one end** act one after the other, so their t multiply: an RTC 1.0375 and a linear PTC
+4.5° on end 1 give t = 1.0375 · e^(j4.5°) (code: `build` in `solver.mjs`, the `tEnd` products).

## 6. Which end the tap changer is on, and why it matters

The voltage comes from the grid at B1 (end 1) and goes out at B2 (end 2). Seen from B1:

- a tap changer on **end 1 divides**: the voltage inside the transformer is v1 / t1;
- a tap changer on **end 2 (or 3) multiplies**: the voltage at B2 is t2 times the voltage inside.

So, without load (no current, no voltage drop), the open-circuit voltage of B2 is

```
E2 = V1 · (U2 / U1) · t2 / t1
```

Without tap changers: E2 = 225 · 110/220 = **112.5 kV**. Examples (section 4, compare with the no-load cases):

| Case | Tap changer | Formula | E2 (formula) | Simulator (with magnetizing) |
|---|---|---|---|---|
| NL07 | RTC 1.0375 on end 1 | 112.5 / 1.0375 | 108.434 kV, 0° | 108.428 kV, −0.001° |
| NL18 | RTC 0.955 on end 2 | 112.5 · 0.955 | 107.438 kV, 0° | 107.432 kV, −0.001° |
| NL12 | PTC +4.5° on end 1 | 112.5 / e^(j4.5°) | 112.500 kV, **−4.5°** | 112.494 kV, −4.501° |
| NL19 | PTC +4.5° on end 2 | 112.5 · e^(j4.5°) | 112.500 kV, **+4.5°** | 112.494 kV, +4.499° |
| NL14 | asymmetrical on end 1 | 112.5 / 1.039531∠3.58° | 108.222 kV, −3.582° | 108.216 kV, −3.584° |
| NL24 | RTC + PTC linear, both end 1 | 112.5 / (1.0375∠4.5°) | 108.434 kV, −4.5° | 108.428 kV, −4.501° |
| NL05 | RTC on end 1 and on end 2 | 112.5 · 0.955 / 1.0375 | 103.554 kV | 103.548 kV |

The same positive angle gives −4.5° on end 1 and +4.5° on end 2: **putting a tap changer on the wrong end inverts
its effect.** And the same value on end 1 and end 2 cancels (t2 / t1 = 1). This is the main thing a program that
reads these files must get right.

**The end-2 sign question.** Each tap changer describes its own winding, on every end (CGMES 2.4.15 Implementation
Guide, section 9.2; ENTSO-E's CGMES 3.0 test data). Some programs read linear and tabular phase tap changers on end 2
"inverted" (1/ratio and −angle), the convention of ENTSO-E's older CGMES 2.4.15 conformity cases. For the cases with
such a tap changer `presets.json` holds both expected results (`expected` and `expected_inverted`), and the
simulator has a switch for it (`end2Rule = "invert"`, the "Linear / tabular phase tap changer on end 2 or 3" selector).

## 7. The load flow

A **load flow** (power flow) computes the voltage (size and angle) of every bus, given what each bus consumes or
produces. Here:

- B1 is the **slack bus**: the grid connection. Its voltage is fixed (225 kV, angle 0) and it supplies whatever
  power the rest needs (like a big water tank that keeps the pressure).
- B2 (and B3) are **PQ buses**: their consumption P and Q is known (the loads), their voltage is unknown.

The grid is described by the **admittance matrix Y** (admittance y = 1 / impedance: how easily current flows).
The current flowing out of each bus is `I = Y · V`, and the power is `S = V · conj(I)` (conj = mirror the arrow).
The load flow searches the voltages V for which, at every PQ bus, the power the network delivers equals the load.

### 7.1 Newton-Raphson, first in one dimension

Problem: find x with f(x) = 0. Newton's idea: stand at a guess x, look at the slope f'(x) (the tangent), and follow
the tangent down to where it crosses zero: `x_new = x − f(x) / f'(x)`. Repeat.

Example (section 5): f(x) = x² − 2, start at x = 1:

| Iteration | x | f(x) |
|---:|---|---|
| 0 | 1.0000000000 | −1.0 |
| 1 | 1.5000000000 | +0.25 |
| 2 | 1.4166666667 | +6.9e−3 |
| 3 | 1.4142156863 | +6.0e−6 |
| 4 | 1.4142135624 | +4.5e−12 |

The error is squared every round (1e−3 → 1e−6 → 1e−12): that is why the solvers need only 3-5 iterations.

### 7.2 Newton-Raphson for the grid

The load flow does the same with more unknowns: two per PQ bus (angle and size). The "slope" becomes a table of
slopes, the **Jacobian matrix** J (how each power mismatch changes when each unknown changes a little). Each
round solves `J · correction = −mismatch` and adds the correction.

Example (section 6): B1 at 1.02273 pu, B2 with 200 MW + 60 Mvar, fed by TX and TP in parallel (each
z = 0.0012 + j0.04798 pu). Start at B2 = 1.0 pu, 0°:

| Iteration | V2 (pu) | angle (°) | mismatch (MVA) |
|---:|---|---|---|
| 0 | 1.00000000 | 0.000000 | 198 |
| 1 | 1.00729763 | −2.668073 | 4.9 |
| 2 | 1.00613223 | −2.652777 | 5.9e−3 |
| 3 | 1.00613082 | −2.652763 | 8.5e−9 |

Result: B2 = **110.6744 kV at −2.6528°**, the same as the simulator to 3e−14 kV. Code: `solver.mjs: solve`
(the general version, with `solveLinear` for the matrix equation).

## 8. What a tap changer does to the flows: the parallel transformer

In the loaded cases (TC..) the transformer under test TX runs in parallel with a plain transformer TP. Without tap
changers both carry the same: 100 MW each. A tap changer on TX makes a **circulating flow** around the loop
B1 → TX → B2 → TP → B1, like a pump in one of two parallel pipes:

- an **angle** pushes **active power** (rule from section 1): P_circ ≈ angle (in radians) / x_loop;
- a **ratio** pushes **reactive power**: Q_circ ≈ voltage difference (pu) / x_loop.

x_loop = 2 · 0.04798 = 0.09597 pu (the reactance of the whole loop). Examples (section 7):

- linear PTC +4.5° on end 1 (TC12): P_circ ≈ 0.07854 / 0.09597 = **81.8 MW**, so TX carries about
  100 − 81.8 = 18.2 MW. The full load flow gives **16.1 MW** (the formula is a straight-line approximation).
- RTC 1.0375 on end 1 (TC07): ΔV = 1 − 1/1.0375 = 0.03614 pu, Q_circ ≈ **37.7 Mvar**. The full load flow: TX takes
  **38.4 Mvar** less reactive power at B1 than without the tap changer.

So a wrong ratio or angle in a program shows up as tens of MW or Mvar in the wrong transformer, much more visible
than in the bus voltages. That is why the loaded cases have the parallel TP.

## 9. Automatic voltage control with a deadband

A tap changer can move by itself to hold a value, like a thermostat:

- `target` (setpoint), e.g. 110 kV at B2;
- `deadband` (full width), e.g. 1 kV. The **band** is target ± deadband/2 = **109.5 .. 110.5 kV**. Inside the band
  the controller does nothing; outside it moves one step towards the band, then looks again.

Why a deadband? Each step changes the voltage by a fixed amount. If the band is narrower than one step, the
controller jumps over the band and back forever ("hunting"), and it would wear out the switch.

Examples (section 8 and the cross-check, code `solver.mjs: solveWithControl`):

- RTC on end 1, start at neutral step 11: B2 = 110.674 kV is above the band. The controller moves 11 → 12 and B2
  becomes **109.967 kV**: inside the band, status "held". One 1.25 % step changes the open-circuit voltage by
  about 112.5 · (1 − 1/1.0125) = 1.39 kV; with the parallel TP only about half of it (0.71 kV) reaches B2.
- Without TP and with target 110.8 kV ± 0.5: one step moves B2 by **1.46 kV**, more than the 1 kV band. The
  controller moves 11 → 10 → 9 → 10 and then stops with status **"hunting"**.

A **phase** tap changer can hold active power instead (target "P:TX"). It needs a parallel path: without TP all
power must go through TX anyway, and the controller reports "no effect" (test in `test_control.mjs`).

In the 64 CGMES test cases the presets come from, the tap changers do **not** control (`controlEnabled` false,
fixed steps); the control exists only in the simulator.

## 10. Three-winding transformers

A three-winding transformer has three ends (220, 110 and 20 kV). It is modelled as a **star**: one impedance per
winding, all joined at a hidden middle point (the star point). The nameplate gives impedances between pairs of
windings (z12, z13, z23); the star impedances follow from

```
z1 = (z12 + z13 − z23) / 2      z2 = (z12 + z23 − z13) / 2      z3 = (z13 + z23 − z12) / 2
```

(code: `solver.mjs: build`). A tap changer on end 1 moves both B2 and B3;
one on end 2 or end 3 moves only its own bus.

## Where to go next

- [`02-how-a-calculation-runs.md`](02-how-a-calculation-runs.md): how these formulas run in the code, from a click to
  the drawings.
- `EXPLANATIONS.md` explains each of the 32 tap-changer combinations with the numbers of its pair of cases.
- The simulator (`standalone.html`) lets you move every step and watch the numbers change.
