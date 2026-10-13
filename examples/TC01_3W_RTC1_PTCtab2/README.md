# TC01_3W_RTC1_PTCtab2: Three-winding transformer: RatioTapChanger on end 1 + PhaseTapChangerTabular on end 2

Configuration 1 of the 32 in the full test set: `RatioTapChanger | PhaseTapChangerTabular | – | 2 | 3-winding`.

**File:** [`TC01_3W_RTC1_PTCtab2.zip`](TC01_3W_RTC1_PTCtab2.zip) - CGMES 3.0 EQ, SSH, TP, SV (20261009T1030Z_1D_TC01-3W-RTC1-PTCtab2_EQ_001.xml, 20261009T1030Z_1D_TC01-3W-RTC1-PTCtab2_SSH_001.xml, 20261009T1030Z_1D_TC01-3W-RTC1-PTCtab2_TP_001.xml, 20261009T1030Z_1D_TC01-3W-RTC1-PTCtab2_SV_001.xml). Expected solution also in [`solution.json`](solution.json), PowSyBl cross-check in [`validation.json`](validation.json).

**SV profile as a separate file:** [`TC01_3W_RTC1_PTCtab2_SV.xml`](TC01_3W_RTC1_PTCtab2_SV.xml); SV of the inverted end-2 reading: [`TC01_3W_RTC1_PTCtab2_SV_end2-inverted.xml`](TC01_3W_RTC1_PTCtab2_SV_end2-inverted.xml).

**ENTSO-E CGMES 3.0 rules** (official SHACL shapes, calibrated on ENTSO-E's PST cases): 0 violations, 1 warning, 1 info (Info: The EQ does not have reference to EQBD. The file header dependencies cardinalities and types for EQ profile are not according to PROF10.; Warning: The model has either one Substation or a Substation per VoltageLevel. Number of Substation-s: 1. Number of VoltageLevel-s: 3.).

## Grid

```
  B1 220 kV ──┬──────────────────┬── Grid (ExternalNetworkInjection, slack, holds 225 kV)
              │ end 1            │
             TX (3 windings)  [RTC end 1, PTCtab end 2]
        end 2 │    │ end 3      TP (no tap changer)
  B2 110 kV ──┴────┼─────────────┴── LD2 160 MW / 50 Mvar
                   │
  B3  20 kV ───────┴──────────────── LD3 30 MW / 10 Mvar
```

| Element | CGMES class | Data |
|---|---|---|
| Grid | ExternalNetworkInjection | slack, referencePriority 1, RegulatingControl voltage 225 kV at B1; SSH p / q = the solved infeed -190.526 MW / -79.641 Mvar (load sign, as in ENTSO-E's PST cases) |
| TX | PowerTransformer, 3 ends | 220/110/20 kV, 250/250/60 MVA, uk12 12 % / ur12 0.30 % (on 250 MVA), uk13 = uk23 = 6 % / ur 0.35 % (on 60 MVA), star impedances on each end's ratedU (end 1 220 kV: r 0.2904 / x 11.6124 ohm, end 2 110 kV: r 0.0726 / x 2.9031 ohm, end 3 20 kV: r 0.0209 / x 0.3033 ohm), g = b = 0 |
| TP | PowerTransformer, 2 ends | same as a two-winding TX, no tap changer (parallel path B1-B2) |
| LD2 | EnergyConsumer | 160 MW / 50 Mvar at B2 |
| LD3 | EnergyConsumer | 30 MW / 10 Mvar at B3 |

## Tap changers (fixed steps, no TapChangerControl, controlEnabled false)

- RatioTapChanger on end 1: steps 1..21, neutral 11, stepVoltageIncrement 1.25 %, step 14 -> ratio 1.0375
- PhaseTapChangerTabular on end 2: 13-point non-equidistant table (angle -24..+24 deg, ratio 0.960..1.044, r/x/g/b 0 %), neutral 7, step 9 -> +5.5 deg, ratio 1.010

Value used in the solution. Each tap changer acts on its own winding: the voltage at its terminal is t times the voltage inside the transformer, v_terminal = t · v_internal with t = ratio · e^(j·angle). Seen from B1, a tap changer on end 1 therefore divides and one on end 2 or 3 multiplies.

| Tap changer | Class | End | Step | Ratio | Angle (deg) |
|---|---|---:|---:|---:|---:|
| TX RTC1 | RatioTapChanger | 1 | 14 | 1.037500 | +0.0000 |
| TX PTC2 | PhaseTapChangerTabular | 2 | 9 | 1.010000 | +5.5000 |

## Expected solution (= the SV in the archive)

| Bus | Nominal kV | V (kV) | V (pu) | Angle (deg) |
|---|---:|---:|---:|---:|
| B1 | 220 | 225.0000 | 1.022727 | +0.0000 |
| B2 | 110 | 109.2097 | 0.992815 | +0.2730 |
| B3 | 20 | 19.4450 | 0.972250 | -4.1560 |

| Terminal | P (MW) | Q (Mvar) |
|---|---:|---:|
| Grid T1 | -190.526 | -79.641 |
| TX T1 | 199.007 | 15.652 |
| TX T2 | -168.528 | 12.078 |
| TX T3 | -30.000 | -10.000 |
| TP T1 | -8.481 | 63.989 |
| TP T2 | 8.528 | -62.078 |
| LD2 T1 | 160.000 | 50.000 |
| LD3 T1 | 30.000 | 10.000 |

Load sign convention (positive = from the bus into the equipment). Solved by the reference load flow of the test set (own Newton-Raphson from the written EQ/SSH/TP, 4 iterations, max mismatch 3e-12 MVA).

## The inverted end-2 reading (CGMES 2.4.15 convention)

This case has a linear or tabular phase tap changer on end 2. It acts on its own winding, like one on end 1 (SV above; CGMES 2.4.15 Implementation Guide section 9.2 "a positive phase shift from the winding where the tap is located to the other winding"; PowSyBl). ENTSO-E's own CGMES 3.0 test data use this reading: in the PowerFlow case (tabular phase tap changer on end 2) and in RealGrid 3.0 (four in-service two-winding transformers with a tabular phase tap changer on end 2) the power flows computed from the SV voltages match the SV to 0.01-1.8 MVA with this reading and are 190-3,600 MVA off with the inverted one. ENTSO-E's older CGMES 2.4.15 PST conformity cases (PST_PTChLin_PTE2, PST_PTChTab_PTE2, ExplicitLoadFlow 2.4.15) need the inverted reading (ratio 1/r, angle -a), and some programs apply it to every file. A program that follows that convention gives:

| Bus | V (kV) | Angle (deg) |
|---|---:|---:|
| B1 | 225.0000 | +0.0000 |
| B2 | 108.0878 | -5.1241 |
| B3 | 19.5613 | -1.3394 |

TX T1: P 1.287 MW, Q -7.948 Mvar (SV: 199.007 MW, 15.652 Mvar).

## Cross-check with PowSyBl

| Program | max dV vs SV (pu) | max d angle vs SV (deg) | max dP TX/TP terminals (MW) | vs inverted reading | verdict and reason |
|---|---:|---:|---:|---|---|
| pypowsybl 1.16.1 + OpenLoadFlow (taps fixed, single slack) | 3.6e-09 | 3.9e-07 | 3.7e-07 | 1.0e-02 pu, 5.4e+00 deg | matches: matches the SV |
