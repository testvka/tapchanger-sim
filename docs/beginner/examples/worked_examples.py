"""Worked examples of docs/beginner/10-math-and-physics.md, computed by hand formulas (plain Python, no numpy).

Every number in the text comes from this script. At the end it runs crosscheck.mjs (the repository's own simulator,
solver.mjs) on the same examples and prints both values side by side, so you can see that the simple
formulas and the real load flow agree (or by how much they differ, and why).

Usage:  python3 worked_examples.py        (Python 3.8+; Node.js 18+ for the cross-check, otherwise it is skipped)
Exit code 1 if a cross-check is outside its tolerance.
"""
import cmath
import json
import math
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SBASE = 100.0                     # MVA: base power of the per-unit system used by the solvers
hand = {}                         # name -> value, compared with the simulator at the end


def title(text):
    """Print a section heading."""
    print("\n== " + text)


# ------------------------------------------------------------------ 1. per unit
title("1. Per unit")
u_base = 220.0                    # kV, nominal voltage of bus B1
z_base = u_base ** 2 / SBASE      # ohm: Z_base = U_base^2 / S_base
print(f"B1 holds 225 kV on a 220 kV base: {225 / 220:.5f} pu")
print(f"Z_base at 220 kV, 100 MVA: 220^2 / 100 = {z_base:.0f} ohm; at 110 kV: {110 ** 2 / SBASE:.0f} ohm")

# ------------------------------------------------------------------ 2. transformer from its nameplate
title("2. Transformer impedance from the nameplate (uk 12 %, ur 0.3 %, 250 MVA, 220 kV)")
uk, ur, s_rated = 12.0, 0.3, 250.0
z_ohm = uk / 100 * u_base ** 2 / s_rated          # |z| = uk/100 * U^2 / S
r_ohm = ur / 100 * u_base ** 2 / s_rated          # r = ur/100 * U^2 / S
x_ohm = math.sqrt(z_ohm ** 2 - r_ohm ** 2)        # x = sqrt(|z|^2 - r^2)
print(f"|z| = 0.12 * 220^2 / 250 = {z_ohm:.3f} ohm, r = {r_ohm:.4f} ohm, x = {x_ohm:.4f} ohm")
print(f"in pu on 100 MVA: r = {r_ohm / z_base:.5f}, x = {x_ohm / z_base:.5f}  (= uk * 100/250 = {0.12 * 100 / 250:.3f})")

# ------------------------------------------------------------------ 3. the five tap-changer classes
title("3. Tap-changer values at the steps of the test cases")
n = 14 - 11
rtc1 = 1 + n * 1.25 / 100                          # RatioTapChanger: 1 + (n - n0) * svi / 100
print(f"RTC end 1: step 14, neutral 11, 1.25 %/step: n = {n}, ratio = 1 + 3 * 1.25/100 = {rtc1:.4f}")
rtc2 = 1 + (6 - 9) * 1.5 / 100
print(f"RTC end 2: step 6, neutral 9, 1.5 %/step: ratio = 1 - 3 * 1.5/100 = {rtc2:.4f}")
lin = (16 - 13) * 1.5                              # PhaseTapChangerLinear: (n - n0) * degrees per step
print(f"PTC linear: step 16, neutral 13, 1.5 deg/step: angle = {lin:+.3f} deg, ratio 1")
du = (9 - 13) * 1.6 / 100                          # PhaseTapChangerSymmetrical: du = (n - n0) * vsi / 100
sym = math.degrees(2 * math.atan(du / 2))          # angle = 2 atan(du / 2)
print(f"PTC symmetrical: step 9, neutral 13, 1.6 %/step: du = {du:+.3f}, angle = 2 atan(du/2) = {sym:+.4f} deg"
      f" (small-angle guess du in degrees = {math.degrees(du):+.4f} deg)")
du_a = (18 - 13) * 1.5 / 100                       # PhaseTapChangerAsymmetrical: t = 1 + du * e^(j theta)
c = 1 + du_a * cmath.exp(1j * math.radians(60))
asym = (abs(c), math.degrees(cmath.phase(c)))
print(f"PTC asymmetrical: step 18, neutral 13, 1.5 %/step, theta 60 deg: du = {du_a:.3f}, "
      f"t = 1 + 0.075 e^(j60) = {c.real:.5f} + j{c.imag:.5f} -> ratio {asym[0]:.6f}, angle {asym[1]:+.4f} deg")
print("PTC tabular: step 9 of the 13-point table -> angle +5.5 deg, ratio 1.010 (read from the table, no formula)")
hand.update(rtc1=[rtc1, 0.0], rtc2=[rtc2, 0.0], ptclin=[1.0, lin], ptcsym=[1.0, sym], ptcasym=list(asym))

# ------------------------------------------------------------------ 4. which side: open-circuit voltages
title("4. Open-circuit voltage of B2 (no load): E2 = V1 * (U2/U1) * t2 / t1")
v1 = 225.0
e0 = v1 * 110 / 220
print(f"without tap changers: E2 = 225 * 110/220 = {e0:.2f} kV")


def e2(t1=1 + 0j, t2=1 + 0j):
    """Open-circuit B2 voltage (kV, degrees) for the complex tap factors of end 1 and end 2."""
    e = v1 * 110 / 220 * t2 / t1
    return [abs(e), math.degrees(cmath.phase(e))]


def t(ratio, angle_deg):
    """Complex tap factor t = ratio * e^(j angle)."""
    return cmath.rect(ratio, math.radians(angle_deg))


cases = {
    "NL07_2W_RTC1": e2(t1=t(rtc1, 0)),
    "NL18_2W_RTC2": e2(t2=t(rtc2, 0)),
    "NL12_2W_PTClin1": e2(t1=t(1, lin)),
    "NL19_2W_PTClin2": e2(t2=t(1, lin)),
    "NL14_2W_PTCasym1": e2(t1=c),
    "NL22_2W_PTCsym2": e2(t2=t(1, sym)),
    "NL24_2W_RTC1_PTClin1": e2(t1=t(rtc1, 0) * t(1, lin)),
    "NL05_2W_RTC1_RTC2": e2(t1=t(rtc1, 0), t2=t(rtc2, 0)),
}
for code, (v, a) in cases.items():
    print(f"{code:22s} E2 = {v:8.3f} kV at {a:+7.3f} deg")
hand.update(cases)

# ------------------------------------------------------------------ 5. Newton-Raphson, first in one dimension
title("5. Newton-Raphson in one dimension: find x with f(x) = x^2 - 2 = 0")
x = 1.0
for it in range(5):
    f, df = x * x - 2, 2 * x                       # value and slope of f at x
    print(f"iteration {it}: x = {x:.10f}, f(x) = {f:+.2e}")
    x = x - f / df                                 # follow the tangent to where it crosses zero
print(f"result x = {x:.10f} (sqrt(2) = {math.sqrt(2):.10f})")

# ------------------------------------------------------------------ 6. the loaded two-winding grid by hand
title("6. Load flow by hand: B1 (slack, 225 kV) -> TX || TP -> B2 with 200 MW + 60 Mvar")
z_pu = complex(r_ohm, x_ohm) / z_base              # one transformer in pu on 100 MVA
y = 2 / z_pu                                       # TX and TP in parallel: twice the admittance
g, b = y.real, y.imag
vs = 225 / 220                                     # slack voltage in pu, angle 0
p_load, q_load = 2.0, 0.6                          # 200 MW, 60 Mvar in pu
th, vm = 0.0, 1.0                                  # unknowns of B2: angle (rad), size (pu); flat start
print(f"one transformer z = {z_pu.real:.5f} + j{z_pu.imag:.5f} pu; both in parallel: y = {g:.4f} {b:+.4f}j pu")
for it in range(10):
    # power injected at B2 by the network: S2 = V2 * conj(y * (V2 - V1))
    v2c = cmath.rect(vm, th)
    s2 = v2c * (y * (v2c - vs)).conjugate()
    mis = [s2.real + p_load, s2.imag + q_load]     # must be zero: injection = -load
    print(f"iteration {it}: |V2| = {vm:.8f} pu, angle {math.degrees(th):+.6f} deg, mismatch "
          f"{max(abs(mis[0]), abs(mis[1])) * SBASE:.2e} MVA")
    if max(abs(mis[0]), abs(mis[1])) < 1e-11:
        break
    # Jacobian (slopes) of P2 and Q2 with respect to angle and size of V2:
    # P2 = vm^2 g - vm vs (g cos th + b sin th), Q2 = -vm^2 b - vm vs (g sin th - b cos th)
    dp_dth = vm * vs * (g * math.sin(th) - b * math.cos(th))
    dp_dv = 2 * vm * g - vs * (g * math.cos(th) + b * math.sin(th))
    dq_dth = -vm * vs * (g * math.cos(th) + b * math.sin(th))
    dq_dv = -2 * vm * b - vs * (g * math.sin(th) - b * math.cos(th))
    det = dp_dth * dq_dv - dp_dv * dq_dth          # solve the 2 x 2 system J * d = -mis (Cramer's rule)
    d_th = (-mis[0] * dq_dv + mis[1] * dp_dv) / det
    d_v = (-mis[1] * dp_dth + mis[0] * dq_dth) / det
    th, vm = th + d_th, vm + d_v
hand["base_b2"] = [vm * 110, math.degrees(th)]
print(f"B2 = {vm * 110:.4f} kV at {math.degrees(th):+.4f} deg; each transformer carries half: "
      f"{p_load / 2 * 100:.0f} MW to the load")

# ------------------------------------------------------------------ 7. what a tap changer does to the split TX / TP
title("7. Circulating power between TX and TP (simple estimate)")
x_loop = 2 * z_pu.imag                             # around the loop B1 - TX - B2 - TP - B1 (pu)
p_circ = math.radians(lin) / x_loop * SBASE        # P = angle / x (DC approximation)
print(f"phase shift {lin} deg on end 1: P_circ = angle / x_loop = {math.radians(lin):.5f} / {x_loop:.5f} pu "
      f"= {p_circ:.1f} MW -> TX takes about 100 - {p_circ:.1f} = {100 - p_circ:.1f} MW")
dv = (1 - 1 / rtc1)                                # voltage step of the ratio 1.0375 on end 1, pu
q_circ = dv / x_loop * SBASE                       # Q = dV / x
print(f"ratio {rtc1} on end 1: dV = 1 - 1/1.0375 = {dv:.5f} pu -> Q_circ = dV / x_loop = {q_circ:.1f} Mvar "
      "flows from TP through B2 into TX's 110 kV side (TX takes that much less reactive power at B1)")
hand["p_circ"] = p_circ
hand["q_circ"] = q_circ

# ------------------------------------------------------------------ 8. control band
title("8. Automatic voltage control with a deadband")
target, deadband = 110.0, 1.0
print(f"target {target} kV, deadband {deadband} kV (full width): band = {target - deadband / 2} .. "
      f"{target + deadband / 2} kV; inside the band the controller does nothing")
step_kv = 112.5 * (1 - 1 / 1.0125)                 # one 1.25 % step on end 1, at no load
print(f"one 1.25 % step on end 1 changes the open-circuit B2 voltage by about 112.5 * (1 - 1/1.0125) = "
      f"{step_kv:.2f} kV; with the parallel TP only about half of it reaches B2")

# ------------------------------------------------------------------ cross-check with the simulator
title("Cross-check with the repository's simulator (crosscheck.mjs -> solver.mjs)")
if not shutil.which("node"):
    print("node not found: cross-check skipped")
    sys.exit(0)
sim = json.loads(subprocess.run(["node", os.path.join(HERE, "crosscheck.mjs")], capture_output=True, text=True,
                                check=True).stdout)
bad = 0


def compare(name, h, s, tol, why=""):
    """Print hand value h and simulator value s; count it as bad if they differ by more than tol."""
    global bad
    hs = h if isinstance(h, list) else [h]
    ss = s if isinstance(s, list) else [s]
    d = max(abs(a - b) for a, b in zip(hs, ss))
    ok = d <= tol
    bad += not ok
    fmt = lambda v: "[" + ", ".join(f"{x:.6f}" for x in v) + "]"     # noqa: E731
    print(f"{'ok  ' if ok else 'DIFF'} {name:22s} hand {fmt(hs)}  simulator {fmt(ss)}  diff {d:.1e} {why}")


for k in ("rtc1", "rtc2", "ptclin", "ptcsym", "ptcasym"):
    compare(k, hand[k], sim[k], 1e-12)
for k in cases:
    compare(k, hand[k], sim[k], 0.02, "(simulator includes the small magnetizing current)")
compare("base B2 (kV, deg)", hand["base_b2"], sim["base"]["b2"], 1e-6)
tc12 = sim["TC12_2W_PTClin1"]["tx"][0]
compare("TX P with PTClin end 1", 100 - hand["p_circ"], tc12, 3.0, "(estimate: straight-line formula)")
q_drop = sim["base"]["tx"][1] - sim["TC07_2W_RTC1"]["tx"][1]
compare("TX Q drop with RTC end 1", hand["q_circ"], q_drop, 3.0, "(estimate: straight-line formula)")
ctl = sim["control"]
print(f"control: B2 starts at {ctl['b2_start']:.3f} kV, moves {[(a, b_) for a, b_, _ in ctl['moves']]}, ends at step "
      f"{ctl['final_step']} with B2 = {ctl['b2_final']:.3f} kV ({ctl['status']})")
hu = sim["hunting"]
print(f"hunting example (no TP, band 110.3..111.3 kV): one step moves B2 by {hu['step_effect_kv']:.2f} kV > band 1 kV "
      f"-> status '{hu['status']}' after moves {[(a, b_) for a, b_, _ in hu['moves']]}")
print(f"\n{bad} cross-check(s) outside tolerance")
sys.exit(1 if bad else 0)
