"""似均质流态判别（手册 §5：公式 4-3～4-8、4-14、4-16 及迭代）。独立于临界流速公式。"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple


def _fanning_f_l(Re_B: float, epsilon_m: float, D_m: float) -> float:
    """刘德忠 Fanning 摩阻系数 f_L（式 4-6）；层流取 Fanning f = 16/Re_B。"""
    if Re_B <= 0:
        raise ValueError("雷诺数 Re_B 须为正")
    if Re_B < 2000:
        return 16.0 / Re_B
    eps_term = epsilon_m / (3.7 * D_m) if D_m > 0 else 1e-10
    re_term = 5.7385 / (Re_B ** 0.9)
    inner = eps_term + re_term
    if inner <= 0:
        raise ValueError("摩阻系数对数项无效，请检查管径与粗糙度")
    ln_inner = math.log(inner)
    return 0.33259 / (ln_inner ** 2)


def _mixture_density_rho_l(rho_g: float, rho_s: float, c1v: float) -> float:
    """式 4-8：ρ_l = ρ_g·C_{1V} + (1−C_{1V})·ρ_s（ρ 单位 kg/m³，C_{1V} 为小数）。"""
    return rho_g * c1v + (1.0 - c1v) * rho_s


def _stokes_settling_velocity(rho_g: float, rho_s: float, g: float, d_m: float, mu_fluid: float) -> float:
    """斯托克斯沉速 ω = (ρ_g−ρ_s)g d²/(18μ)，用于未给出 ω_i 时近似。"""
    if mu_fluid <= 0:
        raise ValueError("流体动力粘度 μ 须大于 0")
    return (rho_g - rho_s) * g * (d_m ** 2) / (18.0 * mu_fluid)


def _cca_ratio(omega_i: float, K: float, beta: float, U: float) -> float:
    """式 4-4：(C/C_A)_i = 10^(−1.8 ω_i / (K β U))"""
    if U <= 0:
        raise ValueError("摩阻流速 U 须为正")
    denom = K * beta * U
    exp_arg = -1.8 * omega_i / denom
    return 10.0 ** exp_arg


def _interpolate_cc_over_ca_at_d95(
    rows_by_d: List[Tuple[float, float, float]]
) -> float:
    """
    累计筛余质量分数达 95% 处，对相邻粒径档的 (C/C_A) 线性插值。
    rows_by_d: [(d_i, delta_P_i, (C/C_A)_i), ...] 已按 d 升序。
    """
    if not rows_by_d:
        raise ValueError("粒径级配行为空")
    target = 0.95
    cum = 0.0
    for i, (_d_i, dp_i, cc_i) in enumerate(rows_by_d):
        cum_next = cum + dp_i
        if cum_next >= target:
            if i == 0:
                return cc_i
            cc_prev = rows_by_d[i - 1][2]
            t = (target - cum) / dp_i if dp_i > 1e-30 else 1.0
            t = max(0.0, min(1.0, t))
            return cc_prev * (1.0 - t) + cc_i * t
        cum = cum_next
    return rows_by_d[-1][2]


def classify_cca_flow_regime(C_over_CA: float, CC_d95: float) -> Tuple[str, bool]:
    """三类流态与 condition_met（仅似均质为 True）。与手册分列条件一致：先非均质，再似均质，再复合分区，其余归入复合。"""
    R = float(C_over_CA)
    Rd = float(CC_d95)
    if R <= 0.1:
        return "heterogeneous", False
    if R >= 0.8 and Rd >= 0.5:
        return "pseudo_homogeneous", True
    if 0.1 < R < 0.8 and Rd > 0.5:
        return "composite", False
    return "composite", False


def calculate_pseudo_cca_step_rho_mixture(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """手册式 4-8：ρ₁（界面键名 rho_l / rho_1）= ρ_g·C_{1V}+(1−C_{1V})·ρ_s"""

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            v = float(x)
            return v if math.isfinite(v) else None
        except (TypeError, ValueError):
            return default

    rho_g = _num("rho_g")
    rho_s = _num("rho_s")
    c1v = _num("C1v") or _num("C_lv") or _num("Clv")
    if None in (rho_g, rho_s, c1v):
        raise ValueError("式 4-8：请填写 ρ_g、ρ_s 与档内体积浓度 C_{1V}")
    if rho_g <= rho_s:
        raise ValueError("固体密度 ρ_g 应大于液相密度 ρ_s")
    if c1v < 0 or c1v > 1:
        raise ValueError("C_{1V} 须在 [0,1]（小数）")
    rho_1 = _mixture_density_rho_l(rho_g, rho_s, float(c1v))
    return {
        "unit": "kg/m³",
        "rho_l": round(float(rho_1), 12),
        "rho_1": round(float(rho_1), 12),
        "intermediate": {"formula_manual_ref": "4-8"},
    }


def calculate_pseudo_cca_step_Re_B(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """宾汉姆雷诺数 Re_B = v D ρ₁ / η（η 为混合物动力粘度，手册式 4-7 形式）"""

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            v = float(x)
            return v if math.isfinite(v) else None
        except (TypeError, ValueError):
            return default

    v = _num("v")
    D = _num("D") or _num("D_n")
    eta = _num("eta") or _num("eta_1")
    rho_1 = _num("rho_1") or _num("rho_l")
    if None in (v, D, eta, rho_1):
        raise ValueError("请填写 v、D、浆体密度 ρ₁ 以及混合物动力粘度 η（Pa·s）")
    if eta <= 0:
        raise ValueError("刚度系数 η 须大于 0")
    if D <= 0:
        raise ValueError("管径须大于 0")
    re_b = float(v) * float(D) * float(rho_1) / float(eta)
    return {
        "unit": "",
        "Re_B": round(float(re_b), 12),
        "intermediate": {"formula_manual_ref": "4-7"},
    }


def calculate_pseudo_cca_step_fanning_f_L(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """手册式 4-6：Fanning f_L（湍流 Swamee–Jain/Colebrook 近似；层流取 16/Re）"""

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            v = float(x)
            return v if math.isfinite(v) else None
        except (TypeError, ValueError):
            return default

    Re_B = _num("Re_B")
    D = _num("D") or _num("D_n")
    epsilon_mm = _num("epsilon") if parameters.get("epsilon") is not None else _num("epsilon_mm")
    if None in (Re_B, D):
        raise ValueError("式 4-6：请填写 Re_B 与管内径 D")
    if epsilon_mm is None:
        epsilon_mm = 0.053
    if float(Re_B) <= 0:
        raise ValueError("Re_B 须为正")
    if float(D) <= 0:
        raise ValueError("管内径须为正")
    eps_m = float(epsilon_mm) / 1000.0
    fl = _fanning_f_l(float(Re_B), eps_m, float(D))
    return {
        "unit": "",
        "f_L": round(float(fl), 12),
        "intermediate": {"formula_manual_ref": "4-6"},
    }


def calculate_pseudo_cca_step_friction_velocity_u(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """手册式 4-5：U = v √(f_L/2)"""

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            val = float(x)
            return val if math.isfinite(val) else None
        except (TypeError, ValueError):
            return default

    v = _num("v")
    f_L = _num("f_L")
    if None in (v, f_L):
        raise ValueError("式 4-5：请填写 v 与 Fanning f_L（上一步）")
    if float(f_L) <= 0:
        raise ValueError("f_L 须大于 0")
    U = float(v) * math.sqrt(float(f_L) / 2.0)
    return {
        "unit": "m/s",
        "friction_velocity_U": round(U, 12),
        "intermediate": {"formula_manual_ref": "4-5"},
    }


def calculate_pseudo_cca_step_ratio_i(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """手册式 4-4：单粒径档 (C/C_A)_i"""

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            val = float(x)
            return val if math.isfinite(val) else None
        except (TypeError, ValueError):
            return default

    omega_i = (
        _num("omega_i")
        if parameters.get("omega_i") is not None else _num("omega")
    )
    U = (
        _num("U")
        if parameters.get("U") is not None else _num("friction_velocity_U")
    )
    K = _num("K_karman", 0.36)
    beta = _num("beta_ismail", 1.0)
    if omega_i is None:
        raise ValueError("式 4-4：请填写档内沉降速度 ωᵢ（或键名 ω_i）")
    if omega_i < 0:
        raise ValueError("ωᵢ 不能为负")
    if None in (U, K, beta):
        raise ValueError("式 4-4：请填写摩阻流速 U（上一步）与 K、β")
    ratio = _cca_ratio(float(omega_i), float(K), float(beta), float(U))
    return {
        "unit": "",
        "intermediate": {
            "formula_manual_ref": "4-4",
            "c_over_ca_i": round(float(ratio), 12),
        },
    }


def summarize_manual_cca_ratios(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """由用户分步得到的各档 (C/C_A)ᵢ 与级配 ΔPᵢ 汇总式 4-3，并插值 (C/C_A)d95、判别流态。"""
    fr_raw = parameters.get("particle_fractions")
    if not isinstance(fr_raw, list) or len(fr_raw) == 0:
        raise ValueError("请提供 particle_fractions（各行须含 d、ΔP、c_over_ca_i）")

    rows_: List[Tuple[float, float, float]] = []
    for i, row in enumerate(fr_raw):
        if not isinstance(row, dict):
            raise ValueError(f"particle_fractions[{i}] 须为对象")
        try:
            d_m = float(row["d"])
            dp = float(row.get("delta_P") or row["delta_p"])
            cci = float(row["c_over_ca_i"])
        except (KeyError, TypeError, ValueError) as ex:
            raise ValueError(f"第 {i+1} 行须含有效 d、ΔP、c_over_ca_i") from ex
        if d_m <= 0 or dp <= 0:
            raise ValueError(f"第 {i+1} 行须满足 d>0、ΔP>0")
        rows_.append((d_m, dp, cci))

    sum_dp = sum(r[1] for r in rows_)
    if sum_dp <= 0:
        raise ValueError("各级 ΔP 之和须为正")
    rows_norm = [(d, dp / sum_dp, cc) for d, dp, cc in rows_]
    C_over_CA = sum(cc * dp_n for _, dp_n, cc in rows_norm)
    rows_sorted = sorted(rows_norm, key=lambda x: x[0])
    CC_d95 = _interpolate_cc_over_ca_at_d95([(d, dp, cc) for d, dp, cc in rows_sorted])

    flow_regime, condition_met = classify_cca_flow_regime(float(C_over_CA), float(CC_d95))
    heterogeneous = float(C_over_CA) <= 0.1
    crit1 = float(C_over_CA) >= 0.8
    crit2 = float(CC_d95) >= 0.5

    return {
        "condition_met": condition_met,
        "flow_regime": flow_regime,
        "unit": "",
        "C_over_CA": round(float(C_over_CA), 12),
        "C_CA_d95": round(float(CC_d95), 12),
        "intermediate": {
            "formula_manual_sum": "4-3",
            "criteria_C_over_CA_le_0_1_heterogeneous": heterogeneous,
            "criteria_formula_4_1_ge_0_8": crit1,
            "criteria_formula_4_2_d95_ge_0_5": crit2,
            "sum_delta_P_normalized": round(sum(dp for _, dp, _ in rows_sorted), 12),
            "rows_manual": [{"d_m": round(d, 12), "delta_P": round(dp, 12), "c_over_ca_i": round(cc, 12)} for d, dp, cc in sorted(rows_norm, key=lambda x: x[0])],
        },
    }


def calculate_pseudo_homogeneous_flow_judgment(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    输入 parameters：
      - v, D, epsilon(mm), rho_g, rho_s, Cv, eta (混合物动力粘度 Pa·s)
      - K_karman 默认 0.36；beta_ismail 默认 1
      - g 默认 9.81；mu_fluid 默认 1e-3（斯托克斯估算 ω_i 用）
      - particle_fractions: [{ "d": m, "delta_P": 小数, "omega": m/s 可选 }, ...]
    """

    def _num(key: str, default: Optional[float] = None) -> Optional[float]:
        x = parameters.get(key)
        if x is None:
            return default
        if isinstance(x, bool):
            return default
        try:
            v = float(x)
            return v if math.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    v = _num("v")
    D = _num("D")
    epsilon_mm = _num("epsilon")
    rho_g = _num("rho_g")
    rho_s = _num("rho_s")
    Cv = _num("Cv")
    eta = _num("eta")
    K = _num("K_karman", 0.36)
    beta = _num("beta_ismail", 1.0)
    g = _num("g", 9.81)
    mu_fluid = _num("mu_fluid", 1e-3)

    if None in (v, D, epsilon_mm, rho_g, rho_s, Cv, eta) or K is None or beta is None:
        raise ValueError("须填写：设计流速 v、管径 D、粗糙度 ε(mm)、ρ_g、ρ_s、体积浓度 C_V、混合物动力粘度 η")
    if v <= 0 or D <= 0 or epsilon_mm < 0 or eta <= 0:
        raise ValueError("v、D、η 须为正；ε 须非负")
    if Cv <= 0 or Cv > 1:
        raise ValueError("体积浓度 C_V 须在 (0, 1]（小数）")
    if K <= 0 or beta <= 0:
        raise ValueError("K、β 须为正")
    if rho_g <= rho_s:
        raise ValueError("固体密度 ρ_g 应大于液相密度 ρ_s（斯托克斯项须为正浮力）")

    fr_raw = parameters.get("particle_fractions")
    if not isinstance(fr_raw, list) or len(fr_raw) == 0:
        raise ValueError("请提供粒径级配 particle_fractions（各档粒径 d、m，质量权重 ΔP、小数）")

    fractions: List[Dict[str, Any]] = []
    for i, row in enumerate(fr_raw):
        if not isinstance(row, dict):
            raise ValueError(f"particle_fractions[{i}] 须为对象")
        d_val = row.get("d")
        if d_val is None:
            d_val = row.get("d_i") or row.get("diameter")
        dp_val = row.get("delta_P")
        if dp_val is None:
            dp_val = row.get("delta_p") or row.get("Delta_P")
        try:
            d_m = float(d_val)
            dp = float(dp_val)
        except (TypeError, ValueError) as ex:
            raise ValueError(f"第 {i+1} 行粒径或 ΔP 无效") from ex
        if d_m <= 0 or dp <= 0:
            raise ValueError(f"第 {i+1} 行须满足 d>0、ΔP>0")
        om_raw = row.get("omega")
        omega_m_s: Optional[float] = None
        if om_raw is not None:
            try:
                omega_m_s = float(om_raw)
            except (TypeError, ValueError):
                omega_m_s = None
            if omega_m_s is not None and omega_m_s < 0:
                raise ValueError(f"第 {i+1} 行沉速 ω 不能为负")
        fractions.append({"d": d_m, "delta_P": dp, "omega": omega_m_s})

    sum_dp = sum(float(f["delta_P"]) for f in fractions)
    if sum_dp <= 0:
        raise ValueError("各级 ΔP 之和须为正")
    if abs(sum_dp - 1.0) > 0.05:
        raise ValueError(f"各级 ΔP 权重之和应为 1（±0.05），当前为 {sum_dp:.6f}")

    for f in fractions:
        f["delta_P"] = float(f["delta_P"]) / sum_dp

    cv_i = [Cv * float(f["delta_P"]) for f in fractions]

    omega_i: List[float] = []
    mf = float(mu_fluid)
    for i, f in enumerate(fractions):
        if f["omega"] is not None:
            omega_i.append(float(f["omega"]))
        else:
            omega_i.append(_stokes_settling_velocity(rho_g, rho_s, float(g), float(f["d"]), mf))

    epsilon_m = float(epsilon_mm) / 1000.0

    c1v_i = list(cv_i)
    max_iter = 300
    rtol = 1e-5

    last_cca: List[float] = []
    it_used = 0

    for it in range(max_iter):
        new_c1v: List[float] = []
        cca_row: List[float] = []
        for idx in range(len(fractions)):
            rho_li = _mixture_density_rho_l(float(rho_g), float(rho_s), c1v_i[idx])
            Re_B = float(v) * float(D) * rho_li / float(eta)
            f_L = _fanning_f_l(Re_B, epsilon_m, float(D))
            U = float(v) * math.sqrt(f_L / 2.0)
            cca = _cca_ratio(omega_i[idx], float(K), float(beta), U)
            cca_row.append(cca)
            new_c1v.append(cv_i[idx] * cca)
        ok = True
        for a, b in zip(c1v_i, new_c1v):
            denom = max(abs(a), abs(b), 1e-30)
            if abs(a - b) / denom > rtol:
                ok = False
                break
        c1v_i = new_c1v
        last_cca = cca_row
        it_used = it + 1
        if ok:
            break
    else:
        raise ValueError("迭代未收敛，请检查流速、粘度与级配是否合理")

    C1v_final = sum(c1v_i)
    rho_l_final = _mixture_density_rho_l(float(rho_g), float(rho_s), C1v_final)

    C_over_CA = sum(
        last_cca[j] * float(fractions[j]["delta_P"]) for j in range(len(fractions))
    )

    rows_sorted = sorted(
        zip([float(f["d"]) for f in fractions], [float(f["delta_P"]) for f in fractions], last_cca),
        key=lambda x: x[0],
    )
    CC_d95 = _interpolate_cc_over_ca_at_d95(list(rows_sorted))

    crit1 = C_over_CA >= 0.8
    crit2 = CC_d95 >= 0.5
    heterogeneous = C_over_CA <= 0.1
    flow_regime, condition_met = classify_cca_flow_regime(float(C_over_CA), float(CC_d95))

    Re_bulk = float(v) * float(D) * rho_l_final / float(eta)
    f_L_bulk = _fanning_f_l(Re_bulk, epsilon_m, float(D))
    U_bulk = float(v) * math.sqrt(f_L_bulk / 2.0)

    row_details = []
    for j, f in enumerate(fractions):
        rho_li = _mixture_density_rho_l(float(rho_g), float(rho_s), c1v_i[j])
        Re_j = float(v) * float(D) * rho_li / float(eta)
        fLj = _fanning_f_l(Re_j, epsilon_m, float(D))
        Uj = float(v) * math.sqrt(fLj / 2.0)
        row_details.append(
            {
                "index": j + 1,
                "d_m": round(float(f["d"]), 12),
                "delta_P": round(float(f["delta_P"]), 12),
                "omega_m_s": round(omega_i[j], 12),
                "Cv_i": round(cv_i[j], 12),
                "C1V_i": round(c1v_i[j], 12),
                "rho_li_kg_m3": round(rho_li, 12),
                "Re_B_i": round(Re_j, 12),
                "f_L_i": round(fLj, 12),
                "U_m_s": round(Uj, 12),
                "C_over_CA_i": round(last_cca[j], 12),
            }
        )

    return {
        "condition_met": condition_met,
        "flow_regime": flow_regime,
        "unit": "",
        "C_over_CA": round(C_over_CA, 12),
        "C_CA_d95": round(CC_d95, 12),
        "C1v": round(C1v_final, 12),
        "rho_l": round(rho_l_final, 12),
        "Re_B": round(Re_bulk, 12),
        "f_L": round(f_L_bulk, 12),
        "friction_velocity_U": round(U_bulk, 12),
        "intermediate": {
            "iterations_used": it_used,
            "flow_regime": flow_regime,
            "criteria_C_over_CA_le_0_1_heterogeneous": heterogeneous,
            "criteria_formula_4_1_ge_0_8": crit1,
            "criteria_formula_4_2_d95_ge_0_5": crit2,
            "K_karman": float(K),
            "beta_ismail": float(beta),
            "sum_delta_P_normalized": round(
                sum(float(f["delta_P"]) for f in fractions), 12
            ),
            "rows_final": row_details,
        },
    }
