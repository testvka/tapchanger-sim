// Automatic tap control of the simulator: RTC holds a voltage, PST holds active power, unreachable target -> limit.
// Usage: node test_control.mjs
import { defaultModel, solveWithControl } from "./solver.mjs";

let fails = 0;
function check(name, m, expect) {
  const r = solveWithControl(m);
  const st = r.controlState.map((s) => `${s.tap} ${s.status} at step ${s.step}: ${s.value.toFixed(2)} (target ${s.setpoint})`).join("; ");
  const ok = r.ok && r.controlState.every((s, i) => s.status === expect[i]);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${st}; ${r.controlLog.length} moves`);
}

let m = defaultModel(2);
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: "V:B2", value: 110, deadband: 1 } }];
check("RTC end 1 holds B2 at 110 ± 0.5 kV", m, ["held"]);

m = defaultModel(2);
m.taps = [{ end: 2, type: "RTC", low: 1, high: 17, neutral: 9, step: 9, svi: 1.5, control: { on: true, target: "V:B2", value: 112, deadband: 1.6 } }];
check("RTC end 2 holds B2 at 112 ± 0.8 kV", m, ["held"]);

m = defaultModel(2);
m.taps = [{ end: 1, type: "PTClin", low: 1, high: 25, neutral: 13, step: 13, deg: 1.5, control: { on: true, target: "P:TX", value: 150, deadband: 30 } }];
check("PST end 1 holds TX at 150 ± 15 MW", m, ["held"]);

m = defaultModel(2);
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: "V:B2", value: 140, deadband: 1 } }];
check("unreachable 140 kV", m, ["at limit"]);

m = defaultModel(3);
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: "V:B2", value: 111, deadband: 1 } },
          { end: 3, type: "RTC", low: 1, high: 5, neutral: 3, step: 3, svi: 2.5, control: { on: true, target: "V:B3", value: 20.5, deadband: 0.6 } }];
check("3W: RTC end 1 for B2 and RTC end 3 for B3", m, ["held", "held"]);

m = defaultModel(2);
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: "V:B2", value: 109, deadband: 1 } },
          { end: 1, type: "PTClin", low: 1, high: 25, neutral: 13, step: 13, deg: 1.5, control: { on: true, target: "P:TX", value: 60, deadband: 30 } }];
check("same end: RTC holds B2, PST holds TX power", m, ["held", "held"]);
m = defaultModel(2);
m.tp.on = false;            // without TP one 1.25 % step moves B2 by ~1.4 kV: a 1.0 kV band cannot be met
m.taps = [{ end: 1, type: "RTC", low: 1, high: 21, neutral: 11, step: 11, svi: 1.25, control: { on: true, target: "V:B2", value: 110.8, deadband: 1 } }];
check("hunting is stopped (band narrower than one step)", m, ["hunting"]);

m = defaultModel(2);
m.tp.on = false;            // no parallel path: the phase shifter cannot change the power
m.taps = [{ end: 1, type: "PTClin", low: 1, high: 25, neutral: 13, step: 13, deg: 1.5, control: { on: true, target: "P:TX", value: 150, deadband: 40 } }];
check("phase shifter without a parallel path has no effect", m, ["no effect"]);
process.exit(fails ? 1 : 0);
