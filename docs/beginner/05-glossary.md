# Glossary

Short explanations of the words and abbreviations used in the code and the documents. Section numbers point to
[10-math-and-physics.md](10-math-and-physics.md).

| Word | Meaning |
|---|---|
| admittance (y, Y) | 1 / impedance: how easily current flows. Unit siemens (S). The **admittance matrix Y** of a grid lists it between every pair of buses (§7). |
| angle (voltage angle) | how early or late a bus's AC voltage wave is compared with the reference bus B1, in degrees. Active power flows from a larger to a smaller angle (§1). |
| apparent power S | total power a device must carry: S = P + jQ, unit MVA. |
| asymmetrical phase shifter | PhaseTapChangerAsymmetrical: adds a voltage du at the windingConnectionAngle θ; changes angle and ratio (§5.2). |
| B1, B2, B3 | the buses of the test grids: 220 kV (grid side), 110 kV, 20 kV. |
| bus | a node of the grid where equipment is connected (in CGMES: TopologicalNode). |
| CGMES | Common Grid Model Exchange Standard (IEC 61970-600): how European grid operators exchange grid models as XML files. Version 3.0 here. |
| complex number, phasor | an arrow with a length and an angle, written re + j·im (§2). |
| controlEnabled | SSH flag: is the tap changer allowed to move by itself? false in all 64 test cases; in the simulator the "automatic control" checkbox. |
| deadband | full width of the "do nothing" zone around a control target; band = target ± deadband/2 (§9). |
| end (transformer end) | one winding side of a transformer: PowerTransformerEnd with endNumber 1, 2 (or 3). |
| end-2 rule ("keep" / "invert") | how linear and tabular phase tap changers on end 2 or 3 are read: on their own winding (keep, used for the SVs) or inverted (an older convention) (§6). |
| ENTSO-E | European Network of Transmission System Operators for Electricity; publishes the CGMES rules and test data. |
| EQ, SSH, TP, SV | the CGMES profiles (files): equipment, steady-state hypothesis (settings), topology, state variables (solved state). The simulator does not read CGMES files; its presets were made from the SVs of the 64 test cases. |
| hunting | a controller jumping back and forth because one step is larger than its band (§9). |
| impedance (z) | resistance r + reactance x, in ohm: how strongly a device resists current. |
| Jacobian | table of slopes used by Newton-Raphson: how each mismatch changes with each unknown (§7.2). |
| kV, MW, Mvar, MVA | kilovolt; megawatt (active power); megavolt-ampere reactive (reactive power); megavolt-ampere (apparent power). |
| load flow (power flow) | computing all bus voltages from the loads and the grid data (§7). |
| load sign convention | power is positive when it flows from the bus into the equipment. A load has positive P; a generator negative. Used in SvPowerFlow and the flow tables. |
| magnetizing branch (g, b; i0, p0) | the small current a transformer draws even without load; i0 no-load current and p0 iron losses in % of the rating (§4). |
| neutralStep | the tap step where the tap changer has no effect (ratio 1, angle 0) (§5). |
| Newton-Raphson | the method that solves the load flow: follow the tangent to the zero, repeat (§7.1). |
| NL / TC | no-load case (TX alone, other ends open) / loaded case ("tap configuration", with TP and loads). |
| normalStep, step, SvTapStep | the tap step in EQ (normal value), in SSH (this moment) and in SV (used in the solution); all equal here. |
| per unit (pu) | value divided by its base value; 1.0 pu = nominal (§3). |
| phase tap changer (PTC), phase shifter, PST | a tap changer that turns the voltage angle; steers active power (§5.2). |
| PowSyBl | an open-source grid library; it was used to cross-check the SVs of the test cases. |
| PQ bus | a bus whose P and Q are known (a load bus); its voltage is computed. |
| PTClin / PTCsym / PTCasym / PTCtab | PhaseTapChangerLinear / Symmetrical / Asymmetrical / Tabular (§5.2). |
| ratio tap changer (RTC) | RatioTapChanger: changes the voltage size in steps of stepVoltageIncrement % (§5.1). |
| ratedU, ratedS | rated voltage (kV) and rated power (MVA) of a transformer end. |
| reactive power Q | power that oscillates between devices; needed to keep voltages up; steered by voltage differences (§1). |
| slack bus | the bus with a fixed voltage that supplies the missing power (here B1, the grid infeed "Grid") (§7). |
| star point | hidden middle node of a three-winding transformer model (§10). |
| stepVoltageIncrement, stepPhaseShiftIncrement, voltageStepIncrement | % per step (RTC), degrees per step (linear PTC), % per step (symmetrical / asymmetrical PTC). |
| symmetrical phase shifter | PhaseTapChangerSymmetrical: angle = 2·atan(du/2), size unchanged (§5.2). |
| t (complex tap ratio) | t = ratio · e^(j·angle); the tap changer is a perfect transformer with v_terminal = t · v_inside (§5). |
| tabular phase shifter | PhaseTapChangerTabular: angle and ratio from a table, one row per step (§5.2). |
| TP (equipment) | the plain transformer in parallel with TX (switch "parallel transformer TP"; not to be confused with the TP profile). |
| TX | the transformer under test, the one that carries the tap changers. |
| uk, ur | short-circuit voltage and its resistive part, in % of the rating: the transformer's series impedance (§4). |
| windingConnectionAngle (θ) | the angle at which an asymmetrical phase shifter adds its voltage, e.g. 60° (§5.2). |
| xMin, xMax | reactance of a phase tap changer at the neutral step and at the largest angle; here xMin = xMax = the tapped end's own x. |
| 2W / 3W | two-winding / three-winding transformer. |
