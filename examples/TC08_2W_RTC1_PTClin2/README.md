# TC08_2W_RTC1_PTClin2: Two-winding transformer: RatioTapChanger on end 1 + PhaseTapChangerLinear on end 2

Configuration 8 of the 32 in the full test set: `RatioTapChanger | PhaseTapChangerLinear | – | 2 | 2-winding`.

**File:** [`TC08_2W_RTC1_PTClin2.zip`](TC08_2W_RTC1_PTClin2.zip) - CGMES 3.0 EQ, SSH, TP, SV (20261009T1030Z_1D_TC08-2W-RTC1-PTClin2_EQ_001.xml, 20261009T1030Z_1D_TC08-2W-RTC1-PTClin2_SSH_001.xml, 20261009T1030Z_1D_TC08-2W-RTC1-PTClin2_TP_001.xml, 20261009T1030Z_1D_TC08-2W-RTC1-PTClin2_SV_001.xml). Expected solution also in [`solution.json`](solution.json), PowSyBl cross-check in [`validation.json`](validation.json).

**SV profile as a separate file:** [`TC08_2W_RTC1_PTClin2_SV.xml`](TC08_2W_RTC1_PTClin2_SV.xml); SV of the inverted end-2 reading: [`TC08_2W_RTC1_PTClin2_SV_end2-inverted.xml`](TC08_2W_RTC1_PTClin2_SV_end2-inverted.xml).

**ENTSO-E CGMES 3.0 rules** (official SHACL shapes, calibrated on ENTSO-E's PST cases): 0 violations, 1 warning, 1 info (Info: The EQ does not have reference to EQBD. The file header dependencies cardinalities and types for EQ profile are not according to PROF10.; Warning: The model has either one Substation or a Substation per VoltageLevel. Number of Substation-s: 1. Number of VoltageLevel-s: 2.).

## Grid

```
  B1 220 kV ──┬──────────────────┬── Grid (ExternalNetworkInjection, slack, holds 225 kV)
              │ end 1            │
             TX  [RTC end 1, PTClin end 2]
              │ end 2           TP (no tap changer)
  B2 110 kV ──┴──────────────────┴── LD2 200 MW / 60 Mvar
```

| Element | CGMES class | Data |
|---|---|---|
| Grid | ExternalNetworkInjection | slack, referencePriority 1, RegulatingControl voltage 225 kV at B1; SSH p / q = the solved infeed -200.466 MW / -78.645 Mvar (load sign, as in ENTSO-E's PST cases) |
| TX | PowerTransformer, 2 ends | 220/110 kV, 250 MVA, uk 12 %, ur 0.3 % (end 1 220 kV: r 0.5808 / x 23.2247 ohm, end 2 110 kV: r 0.0000 / x 0.0000 ohm), g = b = 0 |
| TP | PowerTransformer, 2 ends | same as a two-winding TX, no tap changer (parallel path B1-B2) |
| LD2 | EnergyConsumer | 200 MW / 60 Mvar at B2 |

## Tap changers (fixed steps, no TapChangerControl, controlEnabled false)

- RatioTapChanger on end 1: steps 1..21, neutral 11, stepVoltageIncrement 1.25 %, step 14 -> ratio 1.0375
- PhaseTapChangerLinear on end 2: steps 1..25, neutral 13, stepPhaseShiftIncrement 1.5 deg, xMin = xMax = end 2's own PowerTransformerEnd.x = 0 ohm (the two-winding impedance sits on end 1), step 16 -> +4.5000 deg

Value used in the solution. Each tap changer acts on its own winding: the voltage at its terminal is t times the voltage inside the transformer, v_terminal = t · v_internal with t = ratio · e^(j·angle). Seen from B1, a tap changer on end 1 therefore divides and one on end 2 or 3 multiplies.

| Tap changer | Class | End | Step | Ratio | Angle (deg) |
|---|---|---:|---:|---:|---:|
| TX RTC1 | RatioTapChanger | 1 | 14 | 1.037500 | +0.0000 |
| TX PTC2 | PhaseTapChangerLinear | 2 | 16 | 1.000000 | +4.5000 |

## Expected solution (= the SV in the archive)

| Bus | Nominal kV | V (kV) | V (pu) | Angle (deg) |
|---|---:|---:|---:|---:|
| B1 | 220 | 225.0000 | 1.022727 | +0.0000 |
| B2 | 110 | 108.5149 | 0.986499 | -0.5490 |

| Terminal | P (MW) | Q (Mvar) |
|---|---:|---:|
| Grid T1 | -200.466 | -78.645 |
| TX T1 | 178.401 | 1.886 |
| TX T2 | -178.008 | 13.833 |
| TP T1 | 22.065 | 76.759 |
| TP T2 | -21.992 | -73.833 |
| LD2 T1 | 200.000 | 60.000 |

Load sign convention (positive = from the bus into the equipment). Solved by the reference load flow of the test set (own Newton-Raphson from the written EQ/SSH/TP, 4 iterations, max mismatch 1e-12 MVA).

## The inverted end-2 reading (CGMES 2.4.15 convention)

This case has a linear or tabular phase tap changer on end 2. It acts on its own winding, like one on end 1 (SV above; CGMES 2.4.15 Implementation Guide section 9.2 "a positive phase shift from the winding where the tap is located to the other winding"; PowSyBl). ENTSO-E's own CGMES 3.0 test data use this reading: in the PowerFlow case (tabular phase tap changer on end 2) and in RealGrid 3.0 (four in-service two-winding transformers with a tabular phase tap changer on end 2) the power flows computed from the SV voltages match the SV to 0.01-1.8 MVA with this reading and are 190-3,600 MVA off with the inverted one. ENTSO-E's older CGMES 2.4.15 PST conformity cases (PST_PTChLin_PTE2, PST_PTChTab_PTE2, ExplicitLoadFlow 2.4.15) need the inverted reading (ratio 1/r, angle -a), and some programs apply it to every file. A program that follows that convention gives:

| Bus | V (kV) | Angle (deg) |
|---|---:|---:|
| B1 | 225.0000 | +0.0000 |
| B2 | 108.5149 | -4.9661 |

TX T1: P 16.440 MW, Q -1.860 Mvar (SV: 178.401 MW, 1.886 Mvar).

## Cross-check with PowSyBl

| Program | max dV vs SV (pu) | max d angle vs SV (deg) | max dP TX/TP terminals (MW) | vs inverted reading | verdict and reason |
|---|---:|---:|---:|---|---|
| pypowsybl 1.16.1 + OpenLoadFlow (taps fixed, single slack) | 9.9e-10 | 1.7e-07 | 4.9e-07 | 8.1e-14 pu, 4.4e+00 deg | matches: matches the SV |

Note: xMin = xMax = 0 on the end-2 phase tap changer is not a mistake: ENTSO-E's rule C:301 (valueRangePair) requires xMin = the tapped end's PowerTransformerEnd.x, and a two-winding transformer keeps its impedance on end 1, so end 2 has x = 0. ENTSO-E's own PST cases never meet this (their phase tap changers are all on end 1). The value is meant as 'no change of the reactance'; a program that divides by xMin or uses it as a reactance curve has to handle 0.
