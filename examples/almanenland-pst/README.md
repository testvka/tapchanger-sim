# example-PST: phase-shifting transformers in Almanenland

Six operating scenarios that show how the phase-shifting transformers (PSTs) of the synthetic 380 kV system
Almanenland and its neighbours Westonia, Slavania and Sudlandia are used. Every number is from an AC load flow of
the GridLab Almanenland model (181 load flows, all converged).

| File | Content |
|---|---|
| [`PST_SCENARIOS.md`](PST_SCENARIOS.md) | The scenarios in detail: situation, PST settings, AC results, what they mean, lessons |
| [`simulator/index.html`](simulator/index.html) | Interactive page: map, PST steps, phasor of each PST, two-path model, sweep chart. Open it in a browser (works from the file system) |
| `tools/pst_scenarios.py` | Runs the AC load flows (inside a GridLab checkout) |
| `tools/build_page_data.py` | Turns the results into `simulator/pst_data.js` |
| `tools/gcp/` | `run.sh` + `startup.sh`: the same run on a GCP spot VM through a bucket |
| `results/` | `summary.json.gz` (every case), `geometry.json` (stations, 380 kV lines, PSTs with tap tables) |

## The scenarios

| | Scenario | Stamp | What the PSTs do |
|---|---|---|---|
| S1 | Storm in the north, transit to the south, **Slavania blocks** | winter workday storm 15:00 | Slavania's 6 PSTs cut the transit to Sudlandia from 1,410 to 918 MW; Almanenland's own southern lines and its ties to Sudlandia take it back (+453 MW) |
| S2 | Sunny and windy Sunday, export at the limit | spring Sunday 12:00 | Brzinka 1 at −12 keeps itself below its rating (110 % on neutral → 93 %) |
| S3 | Dunkelflaute, 7.2 GW import from Westonia | winter Dunkelflaute 18:00 | Westonia's PSTs move the entry point of the import: the flow inside Almanenland changes by 1.1 GW |
| S4 | Storm + loss of the tie Alberg – Novgrad II | storm 15:00 | the PST on the parallel tie goes to 93 % while its line is at 52 %; GridLab's PST rule sees nothing to do |
| S5 | Large-angle PSTs (±60° / ±90°) inside Almanenland | storm 18:00 | useful up to about ±20°; beyond that they reverse their own lines and overload the parallel paths |
| S6 | Every neighbour blocks at once | storm 15:00 | the export cannot be blocked, only moved; Sudlandia's blocking cancels Slavania's; reactive power ×3 |

Model: GridLab main `f28e525`, `examples/almanenland` (2,742 nodes, 18 PSTs). The CGMES archives of the
`examples` repository (`almanenland/`) contain the same grid with its 14 tie PSTs (before the 4 internal ones).

All grids and names are synthetic. None of them describes a real network.
