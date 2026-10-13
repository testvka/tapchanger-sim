# Two CGMES 3.0 transformer examples

Two of the 64 test cases behind the simulator, as CGMES 3.0 files. Each folder holds:

- `<case>.zip`: the EQ, SSH, TP and SV profiles of the case;
- `<case>_SV.xml`: the same SV profile as a separate file;
- `<case>_SV_end2-inverted.xml`: the SV a program gets if it reads the end-2 phase tap changer the other way round
  (ratio 1/r, angle -a; the convention of ENTSO-E's CGMES 2.4.15 PST conformity cases);
- `solution.json`: tap data and the expected bus voltages and flows;
- `validation.json`: the cross-check with PowSyBl (pypowsybl 1.16.1 + OpenLoadFlow);
- `README.md`: the grid, the tap changers, the expected solution and the inverted reading, in words and tables.

| Case | Transformer | Tap changers | B2 (kV, deg) | B2 inverted reading (kV, deg) |
|---|---|---|---|---|
| `TC08_2W_RTC1_PTClin2` | two-winding 220/110 kV | RatioTapChanger end 1 step 14, PhaseTapChangerLinear end 2 step 16 (+4.5°) | 108.5149, -0.549 | 108.5149, -4.966 |
| `TC01_3W_RTC1_PTCtab2` | three-winding 220/110/20 kV | RatioTapChanger end 1 step 14, PhaseTapChangerTabular end 2 step 9 (+5.5°) | 109.2097, +0.273 | 108.0878, -5.124 |

The grid is the same in both: B1 220 kV with the slack infeed held at 225 kV, the transformer TX with the tap
changers, a parallel transformer TP without tap changers, and the load on B2 (and B3). The solution was computed
with a Newton-Raphson load flow from the EQ/SSH/TP and agrees with PowSyBl within 4e-9 pu (TC08 9.9e-10, TC01 3.6e-09). Both cases pass the
ENTSO-E CGMES 3.0 SHACL rules with 0 violations.

`python3 check_examples.py` (standard library only) checks that the SV in each zip is the same as the separate SV
file and that the bus voltages of the SV and of the inverted SV equal the expected values in `../presets.json`.
