# -*- coding: utf-8 -*-
"""
计算书 Markdown 正文（含 LaTeX 数学公式），供 Pandoc 转为 Word OMML 公式。
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional


def escape_table_cell(text: str) -> str:
    """管道表格单元格内转义 | 与换行。"""
    if text is None:
        return ""
    s = str(text).replace("\n", " ").replace("\r", " ")
    return s.replace("|", "\\|")


def _rewrite_inline_math_in_segment(seg: str) -> str:
    """
    将正文中的 $...$ 转为 \\(...\\)（Pandoc/Word 更稳），并压缩数学片段内多余反斜杠。
    避免 $\\rho_k$ 等在表格单元格中被 Markdown 下划线误解析。
    不处理 $$...$$ 显示公式块。
    """

    def fix_inner(inner: str) -> str:
        inner = inner.strip()
        inner = re.sub(r"\\{2,}(?=[a-zA-Z\{])", r"\\", inner)
        return inner

    def repl(m: re.Match) -> str:
        return "\\(" + fix_inner(m.group(1)) + "\\)"

    return re.sub(r"\$([^\$\n]+?)\$", repl, seg)


def finalize_export_markdown(md: str) -> str:
    """仅处理 YAML 之后的正文，保留 front matter 不变。"""
    if md.startswith("---"):
        m = re.match(r"^---\n.*?\n---\n", md, re.DOTALL)
        if m:
            return m.group(0) + _rewrite_inline_math_in_segment(md[m.end() :])
    return _rewrite_inline_math_in_segment(md)


def program_formula_to_latex(expr: str) -> str:
    """
    将后端 formula 字段（程序用 ASCII）转为 LaTeX 片段（不含外层 $）。
    若已有 formula_latex 字段则由调用方优先使用。
    """
    if not expr or not str(expr).strip():
        return ""
    t = str(expr).strip()
    if t.startswith("$") and t.endswith("$"):
        return t[1:-1].strip()
    # 已为 LaTeX 片段（含 \frac、\Delta 等）时不再做 ASCII 替换
    if "\\frac" in t or "\\Delta" in t or "\\lambda" in t or "\\times" in t:
        return t
    # 长 token 优先，避免 omega 吃掉 omega_s 的一部分
    tokens = [
        ("omega_s", r"\omega_s"),
        ("rho_w", r"\rho_w"),
        ("rho_k", r"\rho_k"),
        ("rho_g", r"\rho_g"),
        ("rho_s", r"\rho_s"),
        ("i_w", r"i_w"),
        ("i_k", r"i_k"),
        ("d90", r"d_{90}"),
        ("d85", r"d_{85}"),
        ("Cv", r"C_v"),
        ("Vc", r"V_c"),
        ("omega", r"\omega"),
        ("Delta", r"\Delta"),
        ("lambda", r"\lambda"),
        ("epsilon", r"\varepsilon"),
        ("eps_D", r"\varepsilon/D"),
    ]
    out = t
    for ascii_tok, latex_tok in sorted(tokens, key=lambda x: -len(x[0])):
        # 替换串含 \omega 等，不能用普通 repl 字符串（re 会解析 \o 等转义）
        out = re.sub(
            r"\b" + re.escape(ascii_tok) + r"\b",
            lambda _m, lt=latex_tok: lt,
            out,
        )
    out = re.sub(r"\s*\*\s*", r" \\cdot ", out)
    out = re.sub(r"\s+/\s+", r" / ", out)
    return out.strip()


def get_unit(param_name: str) -> str:
    units = {
        "D": "m",
        "ps": "t/m³",
        "pl": "t/m³",
        "ws": "m/s",
        "Cs": "decimal",
        "w0": "m/s",
        "phi": "",
        "FL": "",
        "K": "",
        "C": "",
        "Cg": "",
        "theta": "度",
        "g": "m/s²",
        "G": "",
        "W": "",
        "rho_g": "t/m³",
        "rho_s": "t/m³",
        "rho_k": "t/m³",
        "rho_w": "t/m³",
        "dp": "mm",
        "beta": "",
        "lambda_coef": "",
        "V": "m/s",
        "C_w": "",
        "lambda_d": "",
        "L_s": "m",
        "K_QL": "h²/m⁵",
        "Q": "m³/h",
        "H": "m",
        "L": "m",
        "P_j": "kPa",
        "P_n": "kPa",
        "P_z": "kPa",
        "eta_1": "Pa·s",
        "D_n": "m",
        "Z1": "m",
        "Z2": "m",
        "H1": "m",
        "H2": "m",
        "i": "m/m",
        "d": "m",
        "C1v": "",
    }
    return units.get(param_name, "")


def intermediate_label_md(key: str) -> str:
    """中间项名称：尽量使用 $...$ 包裹公式符号。"""
    labels = {
        "delta_rho_ratio": r"相对密度差 $\Delta\rho/\rho$",
        "density_ratio": r"密度比 $(\rho_s-\rho_l)/\rho_l$",
        "core_term": r"核心项 $[g D (\Delta\rho/\rho) \omega]^{1/3}$",
        "concentration_term": r"浓度修正项 $C_v^{1/6}$",
        "velocity_ratio_term": r"速度比修正项 $(\omega_s/\omega)^{1/6}$",
        "bracket_term": r"核心项 $[2 g D (\Delta\rho/\rho)]^{1/2}$",
        "size_ratio_term": r"粒径比修正项 $(d_{85}/D)^{1/6}$",
        "conc_term": r"浓度修正项 $C_v^{0.25}$",
        "size_term": r"粒径比修正项 $(d_{90}/D)^{1/3}$",
        "leading_coef": r"核心系数 $2.26/\sqrt{\lambda}$",
        "sqrt_term": "平方根项",
        "sin_theta": r"$\sin\theta$",
        "coefficient": "经验系数",
        "coefficient_9_5": r"经验系数 $9.5$",
        "coefficient_3_113": r"经验系数 $3.113$",
        "coefficient_2_26": r"经验系数 $2.26$",
        "g": r"重力加速度 $g$",
        "numerator": r"流速平方与浆体密度项 $V^2 \rho_k$",
        "denominator": r"重力与管径项 $2 g D \rho_s$",
        "denom": r"浓度与密度加权倒数项 $C_w/\rho_g+(1-C_w)/\rho_s$",
        "step_A_Qk": r"步骤 A 矿浆流量 $Q_k$",
        "step_B_DL_mm": r"步骤 B 临界管径 $D_L$ (mm)",
        "Cd": r"重量砂水比 $C_d$",
        "step_C_V_L": r"步骤 C 临界流速 $V_L$",
        "Re": r"雷诺数 $\mathrm{Re}$",
        "flow_regime": "流态",
        "eps_D": r"相对粗糙度 $\varepsilon/D$",
        "head_diff": r"左侧总水头差 $(Z_1+H_1)-(Z_2+H_2)$",
        "friction_loss_total": r"右侧摩阻损失 $i L$",
        "step_1_kql": r"步骤 1 流量消能系数 $K_{QL}$",
        "step_2_delta_h": r"步骤 2 消能水头 $\Delta h$",
        "kql_numerator": r"中间项分子 $(6.3755\times 10^{-9})\lambda_d L_s$",
        "kql_denominator_d5": r"分母 $d^5$",
        "Q_squared": r"$Q^2$",
        "gravity_pressure": r"静压项（重力势能）$\rho g H$ 分量",
        "friction_pressure": r"沿程摩阻项 $\rho g i L$ 分量",
    }
    return labels.get(key, escape_table_cell(key))


def _fmt_num(value: Any) -> str:
    if isinstance(value, (int, float)):
        if abs(value) < 0.001:
            return f"{value:.6e}"
        if abs(value) < 1:
            return f"{value:.6f}".rstrip("0").rstrip(".")
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def _md_parameters_table(
    parameters: Dict[str, Any], formula_info: Dict[str, Any]
) -> List[str]:
    formula_params = formula_info.get("parameters") or []
    valid_params = {k: v for k, v in parameters.items() if k != "g" or v != 9.81}
    formula_param_names = {p.get("name") for p in formula_params}
    formula_params_count = sum(1 for n in formula_param_names if n in valid_params)
    other_params_count = sum(1 for n in valid_params if n not in formula_param_names)
    total_rows = formula_params_count + other_params_count
    lines: List[str] = []
    lines.append("## 三、输入条件与参数")
    lines.append("")
    if total_rows == 0:
        lines.append("*（本节无独立输入项。）*")
        lines.append("")
        return lines
    lines.append("*表 2　输入参数一览*")
    lines.append("")
    lines.append("| 参数（符号及含义） | 取值 | 单位 |")
    lines.append("| --- | --- | --- |")
    row_done = set()
    for param_def in formula_params:
        name = param_def.get("name")
        if name not in valid_params:
            continue
        label = param_def.get("label") or name
        value = valid_params[name]
        unit = param_def.get("unit") or get_unit(name)
        val_s = _fmt_num(value) if isinstance(value, (int, float)) else str(value)
        lines.append(
            f"| {escape_table_cell(label)} | {escape_table_cell(val_s)} | {escape_table_cell(unit)} |"
        )
        row_done.add(name)
    for key, value in valid_params.items():
        if key in row_done:
            continue
        val_s = _fmt_num(value) if isinstance(value, (int, float)) else str(value)
        lines.append(
            f"| {escape_table_cell(key)} | {escape_table_cell(val_s)} | {escape_table_cell(get_unit(key))} |"
        )
    lines.append("")
    return lines


def _md_intermediate(result: Dict[str, Any]) -> List[str]:
    intermediate = result.get("intermediate") or {}
    if not intermediate:
        return []
    lines: List[str] = ["## 四、中间计算量", ""]
    lines.append("*表 3　中间量汇总*")
    lines.append("")
    lines.append("| 项目 | 数值 |")
    lines.append("| --- | --- |")
    for key, value in intermediate.items():
        lab = intermediate_label_md(key)
        val_s = _fmt_num(value) if isinstance(value, (int, float)) else str(value)
        lines.append(f"| {escape_table_cell(lab)} | {escape_table_cell(val_s)} |")
    lines.append("")
    return lines


def _md_result_section(formula_id: str, result: Dict[str, Any]) -> List[str]:
    lines = ["## 五、计算成果", ""]
    intermediate = result.get("intermediate") or {}
    unit_suffix = result.get("unit", "") or ""
    if formula_id in ("slurry_total_head", "clear_water_total_head") and not unit_suffix:
        unit_suffix = "kPa"
    if formula_id == "friction_loss":
        item = r"沿程摩阻损失 $i_k$"
        value = result.get("i_k", "N/A")
    elif formula_id == "density_mixing":
        item = r"浆体密度 $\rho_k$"
        value = result.get("rho_k", "N/A")
    elif formula_id == "darcy_friction":
        item = r"达西摩阻系数 $\lambda$"
        rho_1 = result.get("rho_1", "N/A")
        re_b = result.get("Re_B", "N/A")
        lam = result.get("lambda_coef", "N/A")
        fr = intermediate.get("flow_regime", "")
        value = rf"$\rho_1$={rho_1} kg/m³，$\mathrm{{Re}}_B$={re_b}，$\lambda$={lam}"
        if fr:
            value += f"（{fr}）"
    elif formula_id == "slurry_accel_energy":
        item = "浆体加速流条件"
        value = "满足" if result.get("condition_met") else "不满足"
    elif formula_id in ("slurry_dissipation", "slurry_energy_dissipation"):
        item = r"浆体消能水头 $\Delta h$"
        delta_h = result.get(
            "delta_h", intermediate.get("step_2_delta_h", "N/A")
        )
        kql = result.get("K_QL", intermediate.get("step_1_kql", "N/A"))
        value = rf"$\Delta h = {delta_h}$ m，$K_{{QL}} = {kql}$ h²/m⁵"
    elif formula_id == "slurry_friction_loss":
        item = "浆体摩阻损失"
        rho_k = result.get("rho_k", "N/A")
        i_k = result.get("i_k", "N/A")
        value = rf"$\rho_k = {rho_k}$ t/m³，$i_k = {i_k}$ mH₂O/m"
    elif formula_id == "slurry_total_head":
        item = r"浆体管道输送压力 $P_k$"
        value = result.get("H_total", "N/A")
    elif formula_id == "clear_water_total_head":
        item = r"清水管道输送压力 $P_w$"
        value = result.get("H_total", "N/A")
    else:
        item = r"临界流速 $V_c$"
        value = result.get("Vc", "N/A")

    if isinstance(value, (int, float)):
        value_s = f"{value:.4f}".rstrip("0").rstrip(".")
        if formula_id not in (
            "slurry_friction_loss",
            "darcy_friction",
            "slurry_dissipation",
            "slurry_energy_dissipation",
        ):
            if unit_suffix:
                value_s = f"{value_s} {unit_suffix}".strip()
    else:
        value_s = str(value)

    lines.append("*表 4　主要输出*")
    lines.append("")
    lines.append("| 输出项 | 数值 |")
    lines.append("| --- | --- |")
    lines.append(f"| {escape_table_cell(item)} | {escape_table_cell(value_s)} |")
    lines.append(
        "| **编制说明** | 上表数值依据所选计算模型与第三节输入条件由程序自动核算，**仅供设计参考与技术校核**；不作为经审定的设计依据。工程实施须符合现行国家、行业及地方规范，并结合勘察、施工与运行条件综合论证。 |"
    )
    lines.append("")
    return lines


def _calc_process_md(
    formula_id: str,
    parameters: Dict[str, Any],
    result: Dict[str, Any],
) -> List[str]:
    lines: List[str] = [
        "## 六、计算过程推演",
        "",
        "以下按选用公式逐条代入、汇总，形成与第五节成果相对应的过程记录。",
        "",
    ]
    im = result.get("intermediate") or {}

    if formula_id == "liu_dezhong":
        rho_g = parameters.get("rho_g", "N/A")
        rho_k = parameters.get("rho_k", "N/A")
        coef = im.get("coefficient", parameters.get("coefficient_9_5", 9.5))
        lines.extend(
            [
                rf"1. 计算相对密度差：$\Delta\rho/\rho = ({rho_g} - {rho_k})/{rho_k} = {im.get('delta_rho_ratio', 'N/A')}$",
                rf"2. 计算核心项：$[g D (\Delta\rho/\rho) \omega]^{{1/3}} = {im.get('core_term', 'N/A')}$",
                rf"3. 计算浓度修正项：$C_v^{{1/6}} = {im.get('concentration_term', 'N/A')}$",
                rf"4. 计算速度比修正项：$(\omega_s/\omega)^{{1/6}} = {im.get('velocity_ratio_term', 'N/A')}$",
                rf"5. 计算临界流速：$V_c = {coef} \times {im.get('core_term', 'N/A')} \times {im.get('concentration_term', 'N/A')} \times {im.get('velocity_ratio_term', 'N/A')}$",
                rf"6. $V_c = {result.get('Vc', 'N/A')}$ m/s",
                "",
            ]
        )
    elif formula_id == "wasp":
        rho_g = parameters.get("rho_g", "N/A")
        rho_k = parameters.get("rho_k", "N/A")
        coef = im.get("coefficient", parameters.get("coefficient_3_113", 3.113))
        lines.extend(
            [
                rf"1. 计算相对密度差：$\Delta\rho/\rho = ({rho_g} - {rho_k})/{rho_k} = {im.get('delta_rho_ratio', 'N/A')}$",
                rf"2. 计算核心项：$[2 g D (\Delta\rho/\rho)]^{{1/2}} = {im.get('bracket_term', 'N/A')}$",
                rf"3. 浓度修正项：$C_v^{{0.1858}} = {im.get('concentration_term', 'N/A')}$",
                rf"4. 粒径比修正项：$(d_{{85}}/D)^{{1/6}} = {im.get('size_ratio_term', 'N/A')}$",
                rf"5. $V_c = {coef} \times {im.get('concentration_term', 'N/A')} \times {im.get('bracket_term', 'N/A')} \times {im.get('size_ratio_term', 'N/A')} = {result.get('Vc', 'N/A')}$ m/s",
                "",
            ]
        )
    elif formula_id == "fei_xiangjun":
        rho_g = parameters.get("rho_g", "N/A")
        rho_k = parameters.get("rho_k", "N/A")
        lam = parameters.get("lambda_coef", "N/A")
        c26 = im.get("coefficient_2_26", parameters.get("coefficient_2_26", 2.26))
        lines.extend(
            [
                rf"1. $\Delta\rho/\rho = ({rho_g} - {rho_k})/{rho_k} = {im.get('delta_rho_ratio', 'N/A')}$",
                rf"2. $2.26/\sqrt{{\lambda}} = {c26}/\sqrt{{{lam}}} = {im.get('leading_coef', 'N/A')}$",
                rf"3. $[g D (\Delta\rho/\rho) \omega]^{{1/2}} = {im.get('bracket_term', 'N/A')}$",
                rf"4. $C_v^{{0.25}} = {im.get('conc_term', 'N/A')}$",
                rf"5. $(d_{{90}}/D)^{{1/3}} = {im.get('size_term', 'N/A')}$",
                rf"6. $V_c = {im.get('leading_coef', 'N/A')} \times {im.get('bracket_term', 'N/A')} \times {im.get('conc_term', 'N/A')} \times {im.get('size_term', 'N/A')} = {result.get('Vc', 'N/A')}$ m/s",
                "",
            ]
        )
    elif formula_id == "kronodze_pressure":
        K = parameters.get("K", 1.1)
        G = parameters.get("G", "N/A")
        W = parameters.get("W", "N/A")
        rho_g = parameters.get("rho_g", "N/A")
        dp = parameters.get("dp", "N/A")
        beta = parameters.get("beta", 1.0)
        Qk = im.get("step_A_Qk", "N/A")
        DL = im.get("step_B_DL_mm", "N/A")
        Cd = im.get("Cd", "N/A")
        lines.extend(
            [
                r"A) 矿浆流量 $Q_k$：",
                rf"$Q_k = K W (1/\rho_g + G/W) = {K}\times{W}\times(1/{rho_g} + {G}/{W}) = {Qk}$",
                r"B) 临界管径 $D_L$（由 $Q_k$ 反解）：",
                rf"$d_p = {dp}$ mm，$C_d = W/G\times 100 = {Cd}$，$D_L = {DL}$ mm",
                r"C) 临界流速 $V_L$：",
                rf"$V_L = 0.255\beta(1 + 2.48\sqrt[3]{{C_d}}\sqrt[4]{{D_L}}) = {result.get('Vc', 'N/A')}$ m/s",
                "",
            ]
        )
    elif formula_id == "friction_loss":
        lam = parameters.get("lambda_coef", "N/A")
        V = parameters.get("V", "N/A")
        rho_k = parameters.get("rho_k", "N/A")
        D = parameters.get("D", "N/A")
        rho_s = parameters.get("rho_s", "N/A")
        g = parameters.get("g", 9.81)
        i_k = result.get("i_k", "N/A")
        lines.extend(
            [
                r"公式 (4.3.1-1)：$i_k = \lambda (V^2 \rho_k)/(2 g D \rho_s)$",
                rf"代入 $\lambda={lam}$，$V={V}$，$\rho_k={rho_k}$，$D={D}$，$\rho_s={rho_s}$，$g={g}$",
                rf"$i_k = {i_k}$ mH₂O/m",
                "",
            ]
        )
    elif formula_id == "density_mixing":
        C_w = parameters.get("C_w", "N/A")
        rho_g = parameters.get("rho_g", "N/A")
        rho_s = parameters.get("rho_s", "N/A")
        rho_k = result.get("rho_k", "N/A")
        lines.extend(
            [
                r"公式 (4.3.1-2)：$\rho_k = 1/(C_w/\rho_g + (1-C_w)/\rho_s)$",
                rf"代入 $C_w={C_w}$，$\rho_g={rho_g}$，$\rho_s={rho_s}$",
                rf"$\rho_k = {rho_k}$ t/m³",
                "",
            ]
        )
    elif formula_id == "darcy_friction":
        rho_1 = im.get("step_A_rho_1", result.get("rho_1", "N/A"))
        re_b = im.get("step_B_Re_B", result.get("Re_B", "N/A"))
        lam = result.get("lambda_coef", "N/A")
        fr = im.get("flow_regime", "N/A")
        rho_g, rho_s, c1v = parameters.get("rho_g"), parameters.get("rho_s"), parameters.get("C1v")
        if rho_g is not None and rho_s is not None and c1v is not None:
            lines.append(
                rf"步骤 A：$\rho_1 = \rho_g C_{{1v}} + (1-C_{{1v}})\rho_s$，代入得 $\rho_1 = {rho_1}$ kg/m³"
            )
        else:
            lines.append(rf"步骤 A：用户给定 $\rho_1 = {rho_1}$ kg/m³")
        V, D_n, eta_1 = parameters.get("V"), parameters.get("D_n"), parameters.get("eta_1")
        if V is not None and D_n is not None and eta_1 is not None:
            lines.append(
                rf"步骤 B：$\mathrm{{Re}}_B = (V D_n \rho_1)/\eta_1$ → $\mathrm{{Re}}_B = {re_b}$"
            )
        else:
            lines.append(rf"步骤 B：用户给定 $\mathrm{{Re}}_B = {re_b}$")
        epsilon = parameters.get("epsilon", 0.0002)
        lines.append(
            rf"步骤 C：$\lambda = {lam}$（流态：{fr}），$\varepsilon={epsilon}$，$D_n={D_n}$"
        )
        lines.append("")
    elif formula_id == "slurry_accel_energy":
        Z1, Z2 = parameters.get("Z1", "N/A"), parameters.get("Z2", "N/A")
        H1, H2 = parameters.get("H1", "N/A"), parameters.get("H2", "N/A")
        i, L = parameters.get("i", "N/A"), parameters.get("L", "N/A")
        hd = im.get("head_diff", "N/A")
        fl = im.get("friction_loss_total", "N/A")
        ok = result.get("condition_met", False)
        lines.extend(
            [
                r"公式 (6)：$(Z_1 + P_1/(\rho_k g)) - (Z_2 + P_2/(\rho_k g)) > i L$",
                rf"左侧 $(Z_1+H_1)-(Z_2+H_2) = {hd}$ m",
                rf"右侧 $i L = {fl}$ m",
                rf"判断：{'成立' if ok else '不成立'}",
                "",
            ]
        )
    elif formula_id in ("slurry_dissipation", "slurry_energy_dissipation"):
        ld = parameters.get("lambda_d", "N/A")
        Ls = parameters.get("L_s", "N/A")
        d = parameters.get("d", "N/A")
        Q = parameters.get("Q", "N/A")
        kql = result.get("K_QL", im.get("step_1_kql", "N/A"))
        dh = result.get("delta_h", im.get("step_2_delta_h", "N/A"))
        num, den = im.get("kql_numerator"), im.get("kql_denominator_d5")
        q2 = im.get("Q_squared")
        lines.extend(
            [
                r"步骤 1：$K_{QL} = (6.3755\times 10^{-9}) \lambda_d L_s / d^5$",
            ]
        )
        if num is not None and den is not None:
            lines.append(rf"中间项：分子 $= {num}$，$d^5 = {den}$")
        lines.append(rf"代入得 $K_{{QL}} = {kql}$ h²/m⁵")
        lines.append(r"步骤 2：$\Delta h = K_{QL} Q^2$")
        if q2 is not None:
            lines.append(rf"$Q^2 = {q2}$")
        lines.append(rf"$\Delta h = {dh}$ m")
        lines.append("")
    elif formula_id == "slurry_friction_loss":
        rho_k = parameters.get("rho_k", result.get("rho_k", "N/A"))
        rho_s = parameters.get("rho_s", "N/A")
        lam = parameters.get("lambda_coef", "N/A")
        V = parameters.get("V", "N/A")
        D = parameters.get("D", "N/A")
        g = parameters.get("g", 9.81)
        i_k = result.get("i_k", "N/A")
        lines.extend(
            [
                r"达西–魏斯巴赫：$i_k = \lambda (V^2 \rho_k)/(2 g D \rho_s)$",
                rf"代入 $\lambda={lam}$，$V={V}$，$\rho_k={rho_k}$，$D={D}$，$\rho_s={rho_s}$，$g={g}$",
                rf"$i_k = {i_k}$ mH₂O/m",
                "",
            ]
        )
    elif formula_id == "slurry_total_head":
        rho_k = parameters.get("rho_k", "N/A")
        g = parameters.get("g", 9.81)
        H = parameters.get("H", "N/A")
        rho_s = parameters.get("rho_s", "N/A")
        ik = parameters.get("i_k", "N/A")
        L = parameters.get("L", "N/A")
        P_j = parameters.get("P_j", 0)
        P_n = parameters.get("P_n", 0)
        P_z = parameters.get("P_z", 0)
        lines.extend(
            [
                r"$P_k = \rho_k g H + \rho_s g i_k L + P_j + P_n + P_z$",
                rf"1. $\rho_k g H = {im.get('gravity_pressure', 'N/A')}$ kPa",
                rf"2. $\rho_s g i_k L = {im.get('friction_pressure', 'N/A')}$ kPa",
                rf"3. $P_j={P_j}$，$P_n={P_n}$，$P_z={P_z}$ kPa",
                rf"4. $P_k = {result.get('H_total', 'N/A')}$ kPa",
                "",
            ]
        )
    elif formula_id == "clear_water_total_head":
        rho_w = parameters.get("rho_w", 1)
        g = parameters.get("g", 9.81)
        H = parameters.get("H", "N/A")
        iw = parameters.get("i_w", "N/A")
        L = parameters.get("L", "N/A")
        P_j = parameters.get("P_j", 0)
        P_n = parameters.get("P_n", 0)
        P_z = parameters.get("P_z", 0)
        lines.extend(
            [
                r"$P_w = \rho_w g (H + i_w L) + P_j + P_n + P_z$",
                r"（清水：$\rho_k=\rho_s=\rho_w$；$\rho_w g H$ 与 $\rho_w g i_w L$ 合并为 $\rho_w g (H + i_w L)$）",
                rf"1. $\rho_w g H = {im.get('gravity_pressure', 'N/A')}$ kPa",
                rf"2. $\rho_w g i_w L = {im.get('friction_pressure', 'N/A')}$ kPa",
                rf"3. $P_j={P_j}$，$P_n={P_n}$，$P_z={P_z}$ kPa",
                rf"4. $P_w = {result.get('H_total', 'N/A')}$ kPa",
                "",
            ]
        )
    else:
        lines.append(
            "*（本模型未单独编排分步推演，主要结论以第五节为准。）*"
        )
        lines.append("")

    return lines


def compose_markdown(
    formula_id: str,
    formula_info: Dict[str, Any],
    parameters: Dict[str, Any],
    result: Dict[str, Any],
    chart_paths: Optional[Dict[str, str]] = None,
) -> str:
    chart_paths = chart_paths or {}
    now = datetime.now()
    date_iso = now.strftime("%Y-%m-%d")
    date_cn = now.strftime("%Y年%m月%d日 %H:%M")
    chunks: List[str] = []

    # Word 文档属性（Pandoc 元数据）
    chunks.append("---")
    chunks.append('title: "浆体管道水力计算书"')
    chunks.append('subtitle: "程序自动生成稿"')
    chunks.append("author: 长沙有色冶金设计研究院有限公司")
    chunks.append(f"date: {date_iso}")
    chunks.append("lang: zh-CN")
    chunks.append("---")
    chunks.append("")
    chunks.append("## 软件说明")
    chunks.append("")
    chunks.append("#### 概况与定位")
    chunks.append("")
    chunks.append(
        "「浆体管道临界流速计算工具」由**长沙有色冶金设计研究院有限公司**组织开发，面向浆体与有压流体的管道输送、水力核算与方案比选。"
        "软件将常用经验公式、半经验关系及设计习惯做法封装为可重复计算流程，便于在可研、初设及施工配合阶段快速形成量化结论。"
    )
    chunks.append("")
    chunks.append("#### 主要功能")
    chunks.append("")
    chunks.append(
        "当前版本在统一界面下提供（但不限于）下列能力：临界流速与相关流态判别、浆体与清水沿程摩阻与密度混合、"
        "达西型摩阻系数分步核算、浆体加速流与消能、浆体/清水总扬程（输送压力）及特性曲线示意等。"
        "用户完成参数输入与计算后，可导出版式结构完整、公式可复核的技术计算书，便于内部校核与资料归档。"
    )
    chunks.append("")
    chunks.append("#### 编制声明与效力")
    chunks.append("")
    chunks.append(
        "本计算书由上述软件根据用户当次输入**自动生成**，仅反映所选模型在该组数据下的数值结果。"
        "适用于方案论证、专业协调与内部审查前的自检，**不构成**经注册执业人员签署、经有权机构审定的正式设计成品。"
        "与项目正式设计文件、审查意见或现场条件不一致时，应以审定成果及现行国家、行业、地方工程建设标准为准。"
    )
    chunks.append("")
    chunks.append("# 浆体管道水力计算书")
    chunks.append("")
    chunks.append(
        f"*编制单位：长沙有色冶金设计研究院有限公司　·　生成时间：{escape_table_cell(date_cn)}*"
    )
    chunks.append("")

    chunks.append("## 一、计算概况")
    chunks.append("")
    chunks.append("*表 1　计算概况*")
    chunks.append("")
    chunks.append("| 条目 | 说明 |")
    chunks.append("| --- | --- |")
    chunks.append(
        f"| 采用计算模型 | {escape_table_cell(formula_info.get('name', '—'))} |"
    )
    chunks.append(f"| 成果生成时刻 | {escape_table_cell(date_cn)} |")
    chunks.append("")

    chunks.append("## 二、计算依据")
    chunks.append("")
    chunks.append("### 2.1 计算模型")
    chunks.append("")
    chunks.append(f"**{formula_info.get('name', '未知模型')}**")
    chunks.append("")
    chunks.append("### 2.2 控制方程")
    chunks.append("")
    latex_main = (formula_info.get("formula_latex") or "").strip()
    if not latex_main:
        latex_main = program_formula_to_latex(formula_info.get("formula", "") or "")
    if latex_main:
        chunks.append("$$")
        chunks.append(latex_main)
        chunks.append("$$")
        chunks.append("")
    else:
        chunks.append("*（本模型控制方程见技术说明或规范条文。）*")
        chunks.append("")
    desc = (formula_info.get("description") or "").strip()
    if desc:
        chunks.append("### 2.3 模型与符号说明")
        chunks.append("")
        chunks.append(desc)
        chunks.append("")

    chunks.extend(_md_parameters_table(parameters, formula_info))
    chunks.extend(_md_intermediate(result))
    chunks.extend(_md_result_section(formula_id, result))
    chunks.extend(_calc_process_md(formula_id, parameters, result))

    pk = chart_paths.get("pk")
    if pk:
        chunks.append("## 七、附图")
        chunks.append("")
        chunks.append(rf"![图 1　浆体管道输送压力 $P_k$ 沿管长 $L$ 的变化曲线]({pk})")
        chunks.append("")
        chunks.append(
            r"*图 1　浆体管道输送压力 $P_k$ 与累计管长 $L$ 的关系曲线（程序根据当前参数绘制，坐标单位见图中标注。）*"
        )
        chunks.append("")
    pw = chart_paths.get("pw")
    if pw:
        if not pk:
            chunks.append("## 七、附图")
            chunks.append("")
        chunks.append(rf"![图 {'2' if pk else '1'}　清水管道输送压力 $P_w$ 沿管长 $L$ 的变化曲线]({pw})")
        chunks.append("")
        chunks.append(
            r"*图 "
            + ("2" if pk else "1")
            + r"　清水管道输送压力 $P_w$ 与累计管长 $L$ 的关系曲线（程序根据当前参数绘制。）*"
        )
        chunks.append("")

    chunks.append("")
    chunks.append("---")
    chunks.append("")
    chunks.append("## 附录 A　软件信息、使用边界与声明")
    chunks.append("")
    chunks.append("#### 软件标识")
    chunks.append("")
    chunks.append(
        "**正式名称**：长沙院浆体管道临界流速计算工具。"
        "**成果类型**：本文件为程序「导出计算书」功能生成的电子文档，与软件主程序版本对应关系以安装包或软件内「关于」信息为准。"
    )
    chunks.append("")
    chunks.append("#### 技术特点与排版")
    chunks.append("")
    chunks.append(
        "计算书正文中的公式按 LaTeX 数学环境编写，经转换进入 Microsoft Word 后一般为**可编辑公式（OMML）**，"
        "便于按单位模板统一字体、字号与行距，也可在报审前由专业人员做符号与量纲复核。"
        "插图（若有）为根据当前输入参数即时绘制的示意曲线，坐标与单位以图中标注为准。"
    )
    chunks.append("")
    chunks.append("#### 适用边界")
    chunks.append("")
    chunks.append(
        "各内置模型均有明确的经验适用范围与假定条件（见第二节说明及相应规范、文献）。"
        "当物性参数、流态、粒径级配或固体浓度超出模型推荐区间时，结果偏差可能显著增大，须结合试验、类比工程或专项研究另行论证。"
        "本软件**不替代**现场踏勘、工艺专业提资及系统安全评估。"
    )
    chunks.append("")
    chunks.append("#### 效力与责任")
    chunks.append("")
    chunks.append(
        "本计算书**仅供技术参考与内部质量管理**，不具有对外法律效力；**不得单独作为**竣工验收、事故鉴定或合同结算的唯一依据。"
        "对外提交的设计产品应以符合资质管理规定的责任主体签章文本为准。使用本软件所产生的技术判断与决策后果，由使用单位在各自职责范围内承担。"
    )
    chunks.append("")
    chunks.append("#### 知识产权与引用")
    chunks.append("")
    chunks.append(
        "软件及随附文档的著作权及相关知识产权归开发单位所有；未经书面许可，不得对程序进行反向工程、破解或用于与本软件构成直接竞争的商业再发行。"
        "在论文、报告或设计说明中引用本工具名称或计算结果时，建议注明软件名称、版本及生成日期，便于第三方复核。"
    )
    chunks.append("")

    return finalize_export_markdown("\n".join(chunks))
