# Phase-shifting transformers in Almanenland: six scenarios

How the phase-shifting transformers (PSTs) of Almanenland and its neighbours are used, in six operating scenarios.
Every number below comes from an **AC load flow** of the GridLab Almanenland model. There are 181 load flows in all
(sparse-python core, OLTC voltage control on, as in the day stamps). The interactive page
[`simulator/index.html`](simulator/index.html) shows every case as a schematic of the flows between the areas and on a
map of the 380 kV grid, and lets you move the steps yourself.

All grids and names are synthetic. None of them describes a real network.

## Contents

1. [What a PST does](#1-what-a-pst-does)
2. [The PSTs of Almanenland](#2-the-psts-of-almanenland)
3. [Scenario S1 – storm in the north, transit to the south, Slavania blocks](#s1--storm-in-the-north-transit-to-the-south-slavania-blocks) (the main scenario)
4. [Scenario S2 – sunny and windy Sunday: the PST that protects itself](#s2--sunny-and-windy-sunday-the-pst-that-protects-itself)
5. [Scenario S3 – Dunkelflaute: Westonia's PSTs decide where the import enters](#s3--dunkelflaute-westonias-psts-decide-where-the-import-enters)
6. [Scenario S4 – storm plus the loss of a tie: the PST is the bottleneck](#s4--storm-plus-the-loss-of-a-tie-the-pst-is-the-bottleneck)
7. [Scenario S5 – large-angle PSTs inside Almanenland](#s5--large-angle-psts-inside-almanenland)
8. [Scenario S6 – every neighbour blocks at once](#s6--every-neighbour-blocks-at-once)
9. [Lessons](#lessons)
10. [How the numbers were made](#how-the-numbers-were-made)

---

## 1. What a PST does

A meshed grid splits a transfer between all parallel paths in inverse proportion to their reactance:

    P_path ≈ (U² / X_path) · sin(δ)          δ = voltage angle between the two ends

A wind surplus in the north of Almanenland that has to reach the load in the south (and in Sudlandia) therefore
does not stay on Almanenland's own north–south lines. A part of it takes the path through the neighbour
Slavania and enters Sudlandia from the east. That part is a **loop flow** (transit) for Slavania. Slavania did not
schedule it, yet it loads Slavania's lines and uses up their margin.

A PST adds a controllable angle α in series with one path:

    P_B ≈ (U · U' / X_B) · sin(δ + α)

* With α < 0 (in the blocking direction), path B carries less. The other paths carry the difference.
* **The total transfer does not change.** A PST creates no power and removes none. It only decides which path
  carries the power. The DC rule of thumb is ΔP_B ≈ −U²/(X_A + X_B) · α.
* The angle comes from a booster voltage ΔU added in quadrature (or at an angle θ) to the line voltage. The three
  CGMES types used in Almanenland differ in how they make it:

| Type (CGMES class) | Booster | Angle at step n | Voltage magnitude |
|---|---|---|---|
| PhaseTapChangerSymmetrical | two half boosters, ±90° | α = 2·atan(n·du/2) | unchanged (ratio 1) |
| PhaseTapChangerAsymmetrical | one booster at the winding angle θ (70° here) | t = 1 + n·du·e^(jθ) | changes with the step (0.947 … 1.097) |
| PhaseTapChangerTabular | measured table | angle, ratio and reactance per step | as in the table |

The page draws this for the selected PST from its real tap table (phasor panel). It also has an exact AC two-path
model: path A inside the country, path B through the neighbour with the PST. Move the step and watch the split
change.

**Reactive power.** An asymmetrical PST changes the voltage magnitude as well as the angle. A large angle also
drives a large current through the PST's own reactance. Both raise the reactive power through the PSTs: in S1 it
is 1,343 Mvar with every PST on neutral and 2,877 Mvar when Slavania blocks (Σ|Q| over the 18 PSTs).

## 2. The PSTs of Almanenland

18 PSTs, all 380/380 kV. The tie PSTs stand at the **neighbour's** end of its shortest ties from Almanenland
(1,500 MVA, vk 11 %). The four large-angle units are inside Almanenland (2,400 MVA, vk 12 %, added 2026-10-23).
The tap-changer types differ on purpose (GridLab rule 2026-10-21).

| PST | Country | Tap changer | Steps | Angle at the end step | Tie / line in series |
|---|---|---|---|---:|---|
| Brzinka 1 | Slavania | asymmetrical 70° + ratio (LV) | −16…16 | ±12.8° | Grosheide – Brzinka (tie) |
| Kosice 2 | Slavania | symmetrical, 1.6 % per step | −20…20 | ±18.2° | Gartal – Kosice (tie) |
| Radov 3 | Slavania | tabular (angle, ratio, x per step) | −12…12 | ±19.7° | Helau – Radov (tie) |
| Novgrad II 4 | Slavania | asymmetrical 70° + ratio | −16…16 | ±12.8° | Alberg – Novgrad II (tie) |
| Novgrad II 13 | Slavania | asymmetrical 70°, in series with a separate ratio unit | −16…16 | ±12.8° | Grosmar – Novgrad II (tie) |
| Ostrec A 14 | Slavania | asymmetrical 70°, in series with a separate ratio unit | −16…16 | ±12.8° | Tannborn – Ostrec A (tie) |
| Marmont 5, Chalval 6–8 | Westonia | asymmetrical 70° + ratio | −16…16 | ±12.8° | four ties from the north-west and west |
| Montino 9–10, Casalp B 11–12 | Sudlandia | symmetrical | −20…20 | ±18.2° | four ties from the south |
| Helhausen 15 | Almanenland | symmetrical, 3.85 % per step | −30…30 | ±60° | Helhausen – Fallingen (west) |
| Barhof 16 | Almanenland | asymmetrical 90° (quadrature booster) + ratio | −30…30 | ±60° | Barhof – Lanwang (centre-west) |
| Halfurt 17 | Almanenland | tabular, 2.5° per step | −36…36 | ±90° | Halfurt – Falholz (centre) |
| Alborn 18 | Almanenland | symmetrical, x up to 2.5× | −40…40 | ±90° | Burberg – Alborn (east) |

The day stamps step each PST with the rule in `tools/almanenland_build.py` `pst_control`. A PST whose line is
above 60 % of the **line** rating moves 3 steps at a time until the line is below 60 % or the PST reaches its end
stop. A PST below that limit takes the ±2 step that carries less (a PST in service is never left on neutral).

The **blocking direction** of each PST is the step direction that lowers the flow on its own line. It was found
by AC load flow in S1: negative steps for the Slavanian and Sudlandian units and for Marmont 5, positive for
Chalval 6–8. The direction depends on how the unit is connected.

---

## S1 – Storm in the north, transit to the south, Slavania blocks

**The situation.** Winter workday with a storm front, stamp 15:00 (`almanenland_winter_workday_storm`).

| | |
|---|---|
| Load | 119.2 GW in the four countries, Almanenland 60.0 GW |
| Renewables | 75.0 GW, most of it wind in the north of Almanenland; 13.7 GW curtailed |
| Almanenland's export | +15.0 GW (Westonia 40 %, Slavania 30 %, Sudlandia 30 % by schedule) |
| Redispatch | 13.6 GW (already in the stamp) |
| North → south through Almanenland | 9.8 GW across the cut at map y = 900 km |

The wind sits in the north, the load in the south. The power does not only flow down Almanenland's own 380 kV
corridors. A part enters Slavania on its six northern and eastern ties and leaves it again on the three
Slavania – Sudlandia ties: **transit**. Slavania's net import is set by the schedule (about 3.9 GW). Everything
above that on its ties from Almanenland is power that only passes through.

**What Slavania does.** Its six PSTs step in the blocking direction, i.e. negative steps: Kosice 2 to −12
(−11.0°), Radov 3 to −6 (−9.9°), Ostrec A 14 to −16 (−12.8°, already its end stop), the others −2.

**AC results** (MW; P on a border is the sum over its tie lines; "cut" = north → south inside Almanenland):

| Case | Alm → Slavania | **Slavania → Sudlandia (transit)** | Alm → Sudlandia | Westonia → Alm | North → south cut | Highest line loading |
|---|---:|---:|---:|---:|---:|---|
| Every PST on neutral | 5,270 | 1,344 | 3,976 | 1,618 | 9,828 | 69.3 % Halfurt – Marborn |
| Slavania's PSTs on neutral, the others as operated | 5,349 | **1,410** | 3,867 | 1,545 | 9,590 | 79.5 % Halfurt – Birrode |
| **As operated** (stamp) | 5,168 | **1,266** | 3,987 | 1,511 | 9,798 | 80.6 % Halfurt – Birrode |
| **Slavania blocks**: all six at the blocking end stop | 4,803 | **918** | 4,320 | 1,482 | 9,855 | 80.8 % Halfurt – Birrode |

**What it means.**

* Slavania's blocking cuts the transit from 1,410 MW to 918 MW (**−492 MW, −35 %**). As operated, the cut is
  −144 MW.
* The blocked power does not disappear. **It comes back to Almanenland**: +453 MW on Almanenland's own ties to
  Sudlandia and +266 MW across Almanenland's north → south cut. On the map ("Change vs. as operated") the lines
  in Slavania and on the Slavania – Sudlandia ties turn blue (less), the lines in the south of Almanenland and its
  ties to Sudlandia turn orange (more).
* Slavania's net import stays at 3.9 GW (5,349 − 1,410 neutral, 4,803 − 918 blocked). The PSTs touch only the
  transit.
* In this stamp no line goes above 81 %: the redispatch of the stamp already made room. Whoever pays for that
  room is the point of the conflict. Every MW Slavania blocks must be carried, or redispatched, by Almanenland.
* **The PST rating, not the tie, is the tight limit.** Kosice 2 carries 1,195 MW (79 % of its 1,500 MVA) on
  neutral while its 4 kA tie is at 45 %.
* **Not every PST is equally useful.** AC sensitivity per step (S1, as operated):

| PST | Own tie per step | Transit per step | Cut per step |
|---|---:|---:|---:|
| Brzinka 1 (south-east) | 29.7 MW | **15.1 MW** | 14.4 MW |
| Radov 3 (tabular) | 103.4 MW | 5.6 MW | −11.3 MW |
| Kosice 2 | 32.7 MW | 2.9 MW | −5.6 MW |
| Novgrad II 4 / 13 | 40.6 / 42.1 MW | 2.4 / 1.9 MW | −6.7 / −4.7 MW |
| Ostrec A 14 | 45.7 MW | 2.6 MW | −4.8 MW |

  The northern PSTs mostly push flow from one Slavanian tie to the next. Only Brzinka 1, the tie closest to
  Sudlandia, moves much of the transit itself.
* Ostrec A 14 is at its end stop already in the stamp. When the others block, the flow they push off moves to
  its tie: 685 → 1,196 MW, the PST at 79.6 %. A PST at its end stop has no reserve left.
* Losses rise from 3,176 MW (all neutral) to 3,323 MW (Slavania blocks). The reactive power through the PSTs
  rises from 1,343 to 2,877 Mvar.

**Step by step.** The sweep (9 AC load flows, all six Slavanian PSTs together from neutral to their end stops)
is almost linear. Each eighth of the way removes about 60 MW of transit (chart on the page). The linear
estimate from the ±3-step sensitivities gives 936 MW for "Slavania blocks"; the AC load flow gives 918 MW.

## S2 – Sunny and windy Sunday: the PST that protects itself

**The situation.** Spring Sunday, 12:00 (`almanenland_spring_sunday_sun_wind`). Load 90.0 GW (Almanenland
45.3 GW), renewables 82.9 GW, export +17.0 GW at its limit, 24 GW curtailed. PV is strongest in the south, so the
north → south flow is small (3.0 GW). The export leaves on every border at once.

**PST in action.** Brzinka 1, on the south-eastern tie Grosheide – Brzinka (2,369 MVA), is at step −12 (−9.5°,
ratio 0.956). The other PSTs are at ±2.

| Case | Grosheide – Brzinka | PST Brzinka 1 | Alm → Slavania | Sudlandia → Slavania | Alm → Sudlandia | Cut |
|---|---:|---:|---:|---:|---:|---:|
| Every PST on neutral | 1,658 MW (69.8 %) | **110.2 %** | 5,297 | 187 | 4,936 | 3,140 |
| As operated (Brzinka −12) | 1,363 MW (57.4 %) | **92.7 %** | 5,150 | 336 | 5,058 | 2,977 |

* On neutral the tie itself would be fine (70 %), but **the PST would be overloaded (110 %)**. The 1,500 MVA PST
  is weaker than its 2,369 MVA line.
* Stepping to −12 moves 295 MW off the tie: 147 MW less into Slavania, 122 MW more on Almanenland's ties to
  Sudlandia, and Sudlandia now sends 149 MW more into Slavania from the south.
* The stepping rule (60 % of the **line** rating, i.e. 1,421 MW) stopped at 1,363 MW. That is 92.7 % of the
  PST. A rule that watched the PST's own rating would have stepped further.

## S3 – Dunkelflaute: Westonia's PSTs decide where the import enters

**The situation.** Winter Dunkelflaute, 18:00 (`almanenland_winter_dunkelflaute`). Load 129.0 GW (Almanenland
64.9 GW), renewables 11.5 GW. Almanenland **imports** 7.2 GW, mostly Westonian nuclear. The flow inside
Almanenland reverses: 1.4 GW south → north. All ties are lightly loaded, so every PST sits at ±2. Every PST on
neutral changes no border by more than 35 MW.

**Westonia's four PSTs at either end stop** (Marmont 5 in the north-west, Chalval 6–8 in the west, 11.1° at
ratio 1.097 at +16):

| Case | Westonia → Alm | Westonia → Sudlandia | Cut (north → south) | Marmont tie | Kleemoor – Chalval (no PST) | Highest loading |
|---|---:|---:|---:|---:|---:|---|
| Westonia's PSTs at −16 | 7,328 | 2,993 | **−2,117** | 1,149 MW in | 206 MW in | 63.2 % Heleck – Heihausen |
| As operated (±2) | 7,218 | 3,128 | −1,408 | 380 MW in | 749 MW in | 68.4 % Grosau – Courmont (tie) |
| Westonia's PSTs at +16 | 7,085 | 3,220 | **−977** | 134 MW **out** | 1,100 MW in | 77.3 % Grosau – Courmont (tie) |

* The border sums move by only ±120 MW. **The point of entry moves a lot more**: the ties with a PST give
  power to the ties without one (Verfort, Roslac A, Courmont, Kleemoor), and the south → north flow inside
  Almanenland changes by 1,140 MW. The Marmont tie even reverses at +16.
* So Westonia's PSTs are a lever on Almanenland's **internal** flows. In a Dunkelflaute that matters more than
  the border: they decide whether the import enters in the north-west (close to the load of Rheinruhrstadt) or
  further south.
* The asymmetrical units at +16 run 1.097 ratio. They draw 320–460 Mvar each: in a cold, windless evening this
  is a voltage question as much as a flow question.

## S4 – Storm plus the loss of a tie: the PST is the bottleneck

**The situation.** As S1 (storm, 15:00), then the tie **Alberg – Novgrad II** (979 MW) trips. PST Novgrad II 4
on that tie idles. Its neighbour at the same station, Novgrad II 13 (asymmetrical, in series with a separate
ratio unit), stands on the parallel tie Grosmar – Novgrad II.

| Case | Grosmar – Novgrad II tie | **PST Novgrad II 13** | Kosice 2 | Radov 3 | Ostrec A 14 | Transit | Cut |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before the outage | 1,002 MW (36.8 %) | 65.6 % | 68.3 % | 51.0 % | 46.0 % | 1,266 | 9,798 |
| After the outage, steps as before | 1,424 MW (52.2 %) | **93.3 %** | 73.6 % | 62.9 % | 55.2 % | 1,205 | 9,943 |
| After the outage, GridLab's PST rule run again | same: **no step changes** | 93.3 % | | | | | |
| After the outage, Slavania blocks (end stops) | 1,208 MW | 84.5 % | 71.2 % | 54.0 % | **87.0 %** | 867 | 9,975 |

* After the outage the parallel tie picks up 422 MW. The line is at only 52 %, but **the PST in series is at
  93 %** of its 1,500 MVA.
* GridLab's PST rule (`pst_control`, run again on the outage case) changes **no** step, because every tie is
  below 60 % of its line rating. The rule watches the wrong element: the PST, not the line, is what would trip.
* If Slavania blocks during the outage, Novgrad II 13 is relieved (84.5 %), but the flow moves to Ostrec A 14
  (87 %), which is already at its end stop.

## S5 – Large-angle PSTs inside Almanenland

**The situation.** Storm, 18:00 (`almanenland_winter_workday_storm`, evening peak 129.7 GW, export 15 GW,
redispatch 20.2 GW). The four internal PSTs (±60° / ±90°) stand in series with single north – south 380 kV lines
at their northern stations. As operated: Helhausen 15 at +6 (13.2°), Barhof 16 at +6 (19.1°), Halfurt 17 at +9
(22.5°), Alborn 18 at +3 (8.6°).

| Case | Flow on the 4 PST lines (MW) | Cut | Westonia → Sudlandia | Lines > 100 % | U min | Worst line |
|---|---|---:|---:|---:|---:|---|
| Internal PSTs on neutral | 821 / 1,064 / 973 / 856 | 10,240 | 1,328 | 0 | 0.982 | 72.1 % |
| **As operated** (13–23°) | 328 / 38 / −34 / 186 | 9,784 | 1,361 | 0 | 0.982 | 83.6 % Halfurt – Birrode |
| 25 % of the + range (17–28°) | 155 / −267 / 5 / **−1,295** | 9,607 | 1,380 | 0 | 0.982 | 94.2 % Holberg – Alborn |
| 50 % of the + range (32–53°) | −407 / −916 / −894 / −2,581 | 8,891 | 1,426 | **8** | 0.874 | 129 % Holberg – Alborn, Burberg – Alborn |
| 100 % (60° / 90°) | −1,386 / −1,112 / −1,962 / −3,093 | 7,692 | 1,490 | **12** | 0.630 | 189 % Burberg – Alborn |
| 25 % of the − range | 1,476 / 2,139 / 1,866 / 2,879 | 10,478 | 1,290 | 1 | 0.965 | 136 % Burberg – Alborn |

* As operated, the four PSTs take about 3.2 GW off their own lines (3,714 → 518 MW in sum). The north → south cut drops by 456 MW; the rest
  of the transfer moves to the parallel lines and, a little, **into Westonia** (+33 MW Westonia → Sudlandia).
  An internal PST also makes loop flows for the neighbours.
* **Overshoot.** At 25 % of its range, Alborn 18 (28°) no longer relieves its line. It reverses it: −1,295 MW
  from south to north, and the parallel line Holberg – Alborn reaches 94 %. Past ~20–25° every unit makes more
  problems than it solves.
* At half range there are 8 overloads and the voltage falls to 0.87 pu. At the end stops (60°/90°) there are 12
  overloads and 0.63 pu: the load flow still converges, but no operator would run it. The useful band of these
  "±60° / ±90°" units in this grid is about ±20°. The large range is for stress tests.

## S6 – Every neighbour blocks at once

**The situation.** As S1 (storm, 15:00, export 15 GW). Now all three neighbours drive their 14 tie PSTs to
their blocking end stops.

| Case | Alm → Slavania | Alm → Sudlandia | Westonia → Alm | Slavania → Sudlandia | Westonia → Sudlandia | Cut | Σ\|Q\| PSTs | Losses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Every PST on neutral | 5,270 | 3,976 | 1,618 | 1,344 | 1,414 | 9,828 | 1,343 Mvar | 3,176 |
| As operated | 5,168 | 3,987 | 1,511 | 1,266 | 1,485 | 9,798 | 1,690 Mvar | 3,306 |
| Slavania alone blocks (S1) | 4,803 | 4,320 | 1,482 | **918** | 1,510 | 9,855 | 2,877 Mvar | 3,323 |
| Slavania and Sudlandia block | 5,260 | 3,840 | 1,379 | **1,339** | 1,597 | 9,673 | 2,901 Mvar | 3,329 |
| All 14 tie PSTs block | 5,250 | 3,766 | 1,256 | **1,331** | 1,679 | 10,074 | 4,248 Mvar | 3,370 |

* **The export cannot be blocked.** Almanenland's scheduled 15 GW leaves the country in every case. Blocking only
  rearranges where it goes.
* When Sudlandia blocks too, its PSTs push back what Slavania pushed towards it. **Slavania's blocking is
  cancelled:** the transit stays at 1,339 MW instead of 918 MW. The two neighbours spend their PST range against
  each other.
* With all 14 PSTs at their end stops: reactive power through the PSTs ×3, losses +194 MW over neutral, and
  Westonia's direct flow to Sudlandia +265 MW. That transit is now Westonia's problem. Almanenland's internal
  north → south flow goes **up** by 246 MW.
* This is why real PSTs on a border are coordinated: a common target, a shared optimisation, or a rule on who
  steps first. A "PST war" costs everyone losses and reactive power and moves the problem to whoever has no PST.

---

## Lessons

1. **A PST moves power between paths; it does not change the exchange.** Slavania's net import, Almanenland's
   export and every schedule stay the same. Only the transit and loop flows move (S1, S6).
2. **What one neighbour blocks, another one carries.** In S1, Almanenland's own southern lines take the blocked
   transit. In S6, Westonia's lines take it.
3. **Position beats size.** The tie closest to the destination (Brzinka 1) moves 15 MW of transit per step; the
   northern ones move 2–6 MW (S1).
4. **Watch the PST rating, not only the line rating.** A 1,500 MVA PST on a 2,400–2,600 MVA line is the first
   element to overload (S2: 110 % on neutral; S4: 93 % after an outage while GridLab's stepping rule saw nothing
   to do).
5. **End stops matter.** A PST at its end stop has no reserve and becomes the sink for its neighbours' flows (Ostrec A
   14 in S1, S4).
6. **Asymmetrical PSTs move voltage too.** At ±16 their ratio is 0.947 / 1.097 and they draw 300–460 Mvar each
   (S3).
7. **Large angles overshoot.** Past ~20–25° an internal PST reverses its own line and overloads its parallel paths
   (S5).
8. **Uncoordinated blocking cancels out** and costs losses and reactive power (S6).

## How the numbers were made

| Item | |
|---|---|
| Model | GridLab Almanenland (`examples/almanenland/grid.json.gz`, GridLab main `f28e525`): 2,742 nodes, 1,561 lines, 425 two-winding + 406 three-winding transformers, 18 PSTs |
| Stamps | the day files `examples/almanenland/day_<day>.json.gz`: winter_workday_storm 15:00 and 18:00, spring_sunday_sun_wind 12:00, winter_dunkelflaute 18:00 |
| Load flow | AC, GridLab core `sparse-python`, OLTC voltage control on (`powerflow_cores.run_powerflow`); S1 as operated also on `pandapower` (identical tie flows to 0.1 MW) |
| Cases | 181 load flows, all converged: 6 operated stamps (+1 pandapower cross-check), 142 sensitivity runs (±3 steps of every PST in S1/S2/S3/S5), 22 variants, the S1 sweep (9) and GridLab's `pst_control` after the S4 outage |
| Blocking direction | from the S1 sensitivities: the direction that lowers \|P\| on the PST's own line; a PST that is already at its end stop in that direction stays there |
| North → south cut | Σ P on Almanenland's lines that cross map y = 900 km, counted from north to south |
| Compute | GCP spot VM `c2d-standard-32`, europe-west4, 30 workers, about 1 minute per run (2026-11-05); the VM and its bucket were deleted afterwards |
| Tools | [`tools/pst_scenarios.py`](tools/pst_scenarios.py) (runs in a GridLab checkout), [`tools/build_page_data.py`](tools/build_page_data.py) (page data), [`tools/gcp/startup.sh`](tools/gcp/startup.sh) (VM) |
| Results | [`results/summary.json.gz`](results/summary.json.gz) (every case: ties, borders, PSTs, 380 kV lines, worst lines), [`results/geometry.json`](results/geometry.json) |

**Model notes.**

* The CGMES archives in the examples repository (`almanenland/*.zip`, exported 2026-10-22) have the 14 tie
  PSTs. The 4 internal large-angle PSTs (S5) were added on 2026-10-23 and are only in the GridLab model.
* The stamps already contain the redispatch of the day generator, so the base cases have no overloads. The
  scenarios show what the PSTs do on top of that, not an unsecured market result.
* The page's "estimate" mode is linear in the steps around the selected AC case. It is close for the tie PSTs
  (S1: 936 MW estimated vs 918 MW AC for "Slavania blocks"). It is not reliable for the large-angle units far
  from their operating steps: use the AC cases there.

Re-run:

```bash
cd /path/to/gridlab                                  # a GridLab checkout with its .venv
.venv/bin/python /path/to/example-PST/tools/pst_scenarios.py --gridlab . --out /tmp/pst --workers 8
python3 /path/to/example-PST/tools/build_page_data.py /tmp/pst/summary.json /tmp/pst/geometry.json \
    /path/to/example-PST/simulator/pst_data.js examples/almanenland/grid.json.gz
```

One Almanenland AC load flow takes about 3 s and 0.5 GB of RAM per worker; with 8 workers the 181 cases take
about 2 minutes.
