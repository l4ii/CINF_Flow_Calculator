import math

class CalculationEngine:
    
    def _safe_round(self, value, decimals=12):
        """安全地四舍五入（默认保留较多小数位，便于工程计算复核），处理复数和无效值"""
        if isinstance(value, complex):
            # 如果是复数，检查虚部是否接近0
            if abs(value.imag) < 1e-10:
                return round(value.real, decimals)
            else:
                raise ValueError(f"计算结果为复数: {value}，请检查输入参数是否合理")
        if math.isnan(value) or math.isinf(value):
            raise ValueError(f"计算结果无效: {value}，请检查输入参数")
        return round(value, decimals)
    """计算引擎，实现各种临界流速计算公式"""
    
    def calculate(self, formula_id, parameters):
        """根据公式ID和参数计算临界流速Vc"""
        
        # 确保g有默认值
        g = parameters.get('g', 9.81)
        
        if formula_id == "liu_dezhong":
            return self._calculate_liu_dezhong(parameters, g)
        elif formula_id == "wasp":
            return self._calculate_wasp(parameters, g)
        elif formula_id == "fei_xiangjun":
            return self._calculate_fei_xiangjun(parameters, g)
        elif formula_id == "kronodze_pressure":
            return self._calculate_kronodze_pressure(parameters, g)
        elif formula_id == "friction_loss":
            return self._calculate_friction_loss(parameters, g)
        elif formula_id == "density_mixing":
            return self._calculate_density_mixing(parameters, g)
        elif formula_id == "darcy_friction":
            return self._calculate_darcy_friction(parameters)
        elif formula_id == "darcy_friction_step1_rho1":
            return self._calculate_darcy_friction_step1_rho1(parameters)
        elif formula_id == "darcy_friction_step2_re":
            return self._calculate_darcy_friction_step2_re(parameters)
        elif formula_id == "darcy_friction_step3_lambda":
            return self._calculate_darcy_friction_step3_lambda(parameters)
        elif formula_id == "slurry_accel_energy":
            return self._calculate_slurry_accel_energy(parameters)
        elif formula_id in ("slurry_dissipation", "slurry_energy_dissipation"):
            return self._calculate_slurry_dissipation(parameters)
        elif formula_id == "slurry_friction_loss":
            return self._calculate_slurry_friction_loss(parameters, g)
        elif formula_id == "clear_water_friction_loss":
            return self._calculate_clear_water_friction_loss(parameters, g)
        elif formula_id == "slurry_total_head":
            return self._calculate_total_head(parameters, "slurry")
        elif formula_id == "clear_water_total_head":
            return self._calculate_clear_water_total_head(parameters)
        elif formula_id == "centrifugal_pump_total_head":
            step = parameters.get("calculation_step", 1)
            try:
                step = int(step)
            except (TypeError, ValueError):
                step = 1
            if step == 3:
                return self._calculate_centrifugal_pump_motor_power(parameters)
            if step == 2:
                return self._calculate_centrifugal_pump_hb(parameters)
            return self._calculate_centrifugal_pump_kp(parameters)
        elif formula_id == "positive_displacement_pump_outlet_pressure":
            step = parameters.get("calculation_step", 1)
            try:
                step = int(step)
            except (TypeError, ValueError):
                step = 1
            if step == 2:
                return self._calculate_positive_displacement_motor_power(parameters)
            return self._calculate_positive_displacement_pump_total_head(parameters)
        elif formula_id == "slurry_dissipation_orifice":
            return self._calculate_slurry_dissipation_orifice(parameters)
        elif formula_id == "slurry_friction_workflow":
            raise ValueError("浆体摩阻损失为分步计算，请在界面内分别执行步骤 1～5 的计算按钮。")
        else:
            raise ValueError(f"未知的公式ID: {formula_id}")
    
    def _calculate_liu_dezhong(self, params, g):
        """刘德忠公式: Vc = 9.5 * [g*D*(Δρ/ρ)*ω]^(1/3) * Cv^(1/6) * (ω_s/ω)^(1/6)"""
        D = params.get('D')
        rho_g = params.get('rho_g')  # 固体颗粒密度
        rho_k = params.get('rho_k')  # 载体液体密度
        omega = params.get('omega')
        Cv = params.get('Cv')  # 体积浓度
        omega_s = params.get('omega_s')  # 沉降速度
        
        # 获取重力加速度和经验系数（优先使用前端传入的值，否则使用默认值）
        g = params.get('g', g)  # 重力加速度，优先使用前端传入的值，否则使用传入的默认值
        coefficient = params.get('coefficient_9_5', 9.5)  # 经验系数，默认9.5
        
        if None in [D, rho_g, rho_k, omega, Cv, omega_s]:
            raise ValueError("刘德忠公式需要所有参数：D, rho_g, rho_k, omega, Cv, omega_s")
        
        if omega == 0:
            raise ValueError("omega不能为0")
        
        if rho_k == 0:
            raise ValueError("载体液体密度rho_k不能为0")
        
        if rho_g < rho_k:
            raise ValueError("固体颗粒密度rho_g必须大于载体液体密度rho_k")
        
        if Cv < 0 or Cv > 1:
            raise ValueError("体积浓度Cv必须在0-1之间")
        
        if omega_s < 0:
            raise ValueError("沉降速度omega_s不能为负数")
        
        # 计算相对密度差
        delta_rho_ratio = (rho_g - rho_k) / rho_k
        
        # 计算核心项[g*D*(Δρ/ρ)*ω]^(1/3)
        core_value = g * D * delta_rho_ratio * omega
        if core_value < 0:
            raise ValueError(f"核心项计算结果为负数: {core_value}，请检查输入参数（D、g、omega必须为正数，且rho_g > rho_k）")
        core_term = core_value ** (1/3)
        
        # 计算浓度修正项Cv^(1/6)
        concentration_term = Cv ** (1/6)
        
        # 计算沉降速度比修正项(ω_s/ω)^(1/6)
        velocity_ratio_term = (omega_s / omega) ** (1/6)
        
        # 综合计算Vc = coefficient * core * conc * ratio
        Vc = coefficient * core_term * concentration_term * velocity_ratio_term
        
        return {
            "Vc": self._safe_round(Vc, 12),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 12),
                "core_term": self._safe_round(core_term, 12),
                "concentration_term": self._safe_round(concentration_term, 12),
                "velocity_ratio_term": self._safe_round(velocity_ratio_term, 12),
                "coefficient": self._safe_round(coefficient, 12),
                "g": self._safe_round(g, 12)
            }
        }
    
    def _calculate_wasp(self, params, g):
        """E.J.瓦斯普公式: Vc = 3.113 * Cv^0.1858 * [2*g*D*(Δρ/ρ)]^(1/2) * (d85/D)^(1/6)"""
        D = params.get('D')
        rho_g = params.get('rho_g')  # 固体颗粒密度
        rho_k = params.get('rho_k')  # 载体液体密度
        Cv = params.get('Cv')  # 体积浓度
        d85 = params.get('d85')  # d85粒径
        
        # 获取重力加速度和经验系数（优先使用前端传入的值，否则使用默认值）
        g = params.get('g', g)  # 重力加速度，优先使用前端传入的值，否则使用传入的默认值
        coefficient = params.get('coefficient_3_113', 3.113)  # 经验系数，默认3.113
        
        if None in [D, rho_g, rho_k, Cv, d85]:
            raise ValueError("E.J.瓦斯普公式需要所有参数：D, rho_g, rho_k, Cv, d85")
        
        if D == 0:
            raise ValueError("D不能为0")
        
        if rho_k == 0:
            raise ValueError("载体液体密度rho_k不能为0")
        
        if rho_g < rho_k:
            raise ValueError("固体颗粒密度rho_g必须大于载体液体密度rho_k")
        
        if Cv < 0 or Cv > 1:
            raise ValueError("体积浓度Cv必须在0-1之间")
        
        if d85 < 0:
            raise ValueError("d85粒径不能为负数")
        
        # 计算相对密度差
        delta_rho_ratio = (rho_g - rho_k) / rho_k
        
        # 计算核心项[2*g*D*(Δρ/ρ)]^(1/2) - 注意：根据标准公式，括号内不包含ω
        bracket_value = 2 * g * D * delta_rho_ratio
        if bracket_value < 0:
            raise ValueError(f"核心项计算结果为负数: {bracket_value}，请检查输入参数（D、g必须为正数，且rho_g > rho_k）")
        bracket_term = bracket_value ** 0.5
        
        # 计算浓度修正项Cv^0.1858
        concentration_term = Cv ** 0.1858
        
        # 计算粒径比修正项(d85/D)^(1/6)
        size_ratio_term = (d85 / D) ** (1/6)
        
        # 综合计算Vc = coefficient * conc * bracket * size
        # 注意：omega参数虽然被接收，但根据标准E.J. Wasp公式，不参与计算
        Vc = coefficient * concentration_term * bracket_term * size_ratio_term
        
        return {
            "Vc": self._safe_round(Vc, 12),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 12),
                "bracket_term": self._safe_round(bracket_term, 12),
                "concentration_term": self._safe_round(concentration_term, 12),
                "size_ratio_term": self._safe_round(size_ratio_term, 12),
                "coefficient": self._safe_round(coefficient, 12),
                "g": self._safe_round(g, 12)
            }
        }
    
    def _calculate_fei_xiangjun(self, params, g):
        """费祥俊公式: Vc = (2.26/√λ) * [gD*(Δρ/ρ)*ω]^(1/2) * Cv^0.25 * (d90/D)^(1/3)"""
        D = params.get('D')
        rho_g = params.get('rho_g')  # 固体颗粒密度
        rho_k = params.get('rho_k')  # 载体液体密度
        Cv = params.get('Cv')  # 体积浓度
        omega = params.get('omega')
        d90 = params.get('d90')  # d90粒径
        lambda_coef = params.get('lambda_coef')  # λ系数
        
        # 获取重力加速度和经验系数（优先使用前端传入的值，否则使用默认值）
        g = params.get('g', g)  # 重力加速度，优先使用前端传入的值，否则使用传入的默认值
        coefficient_2_26 = params.get('coefficient_2_26', 2.26)  # 经验系数，默认2.26
        
        if None in [D, rho_g, rho_k, Cv, omega, d90, lambda_coef]:
            raise ValueError("费祥俊公式需要所有参数：D, rho_g, rho_k, Cv, omega, d90, lambda_coef")
        
        if D == 0:
            raise ValueError("D不能为0")
        
        if lambda_coef <= 0:
            raise ValueError("lambda_coef必须大于0")
        
        if rho_k == 0:
            raise ValueError("载体液体密度rho_k不能为0")
        
        if rho_g < rho_k:
            raise ValueError("固体颗粒密度rho_g必须大于载体液体密度rho_k")
        
        if Cv < 0 or Cv > 1:
            raise ValueError("体积浓度Cv必须在0-1之间")
        
        if omega < 0:
            raise ValueError("速度参数omega不能为负数")
        
        if d90 < 0:
            raise ValueError("d90粒径不能为负数")
        
        # 1.计算相对密度差
        delta_rho_ratio = (rho_g - rho_k) / rho_k
        
        # 2.计算中括号内部分 [gD*(Δρ/ρ)*ω]，然后开方（1/2次方）
        bracket_value = g * D * delta_rho_ratio * omega
        if bracket_value < 0:
            raise ValueError(f"核心项计算结果为负数: {bracket_value}，请检查输入参数（D、g、omega必须为正数，且rho_g > rho_k）")
        bracket_term = bracket_value ** 0.5
        
        # 3.计算浓度修正项
        conc_term = Cv ** 0.25
        
        # 4.计算粒径比修正项
        size_term = (d90 / D) ** (1/3)
        
        # 5.计算核心系数coefficient_2_26/√λ
        leading_coef = coefficient_2_26 / (lambda_coef ** 0.5)
        
        # 6.综合计算
        Vc = leading_coef * bracket_term * conc_term * size_term
        
        return {
            "Vc": self._safe_round(Vc, 12),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 12),
                "bracket_term": self._safe_round(bracket_term, 12),
                "conc_term": self._safe_round(conc_term, 12),
                "size_term": self._safe_round(size_term, 12),
                "leading_coef": self._safe_round(leading_coef, 12),
                "coefficient_2_26": self._safe_round(coefficient_2_26, 12),
                "lambda_coef": self._safe_round(lambda_coef, 12),
                "g": self._safe_round(g, 12)
            }
        }
    
    def _calculate_kronodze_pressure(self, params, g):
        """B.C.克诺罗兹法三步计算，每步可独立计算：
        A) 矿浆流量 Qk = K*W*(1/ρg + G/W)，仅需 K、G、W、ρg，不需 dp
        B) 临界管径 DL：需 dp、β 及步骤 A 的 Qk；当 dp≤0.07 与 0.07<dp≤0.15 两套公式
        C) 临界流速 V_L：由 A、B 结果及 β 计算
        """
        K = params.get('K', 1.1)  # 波动系数
        G = params.get('G')       # 矿浆中水重
        W = params.get('W')       # 干尾矿重量
        rho_g = params.get('rho_g')  # 尾矿相对密度
        dp_raw = params.get('dp')    # 尾矿加权平均粒径，mm（步骤2 才需要）
        beta = params.get('beta', 1.0)  # 固体物料相对密度修正系数

        # 步骤 A 仅需 G、W、ρg（K 有默认值）
        if G is None or W is None or rho_g is None:
            raise ValueError("步骤1 需要参数：G（矿浆中水重）、W（干尾矿重量）、ρg（尾矿相对密度）")
        if W == 0:
            raise ValueError("干尾矿重量 W 不能为0")
        if G == 0:
            raise ValueError("矿浆中水重 G 不能为0")
        if rho_g <= 0:
            raise ValueError("尾矿相对密度 ρg 必须大于0")

        # ---------- Step A: 矿浆流量 Qk = K*W*(1/ρg + G/W) ----------
        Qk = K * W * (1.0 / rho_g + G / W)
        if Qk <= 0:
            raise ValueError("矿浆流量 Qk 计算结果应大于0，请检查 G、W、ρg")
        Cd = (W / G) * 100.0  # 重量砂水比（砂重/水重×100）

        # 若未填写 dp 或 dp 无效，只返回步骤 A 结果（第一步独立计算）
        dp = None
        if dp_raw is not None:
            try:
                dp = float(dp_raw)
            except (TypeError, ValueError):
                pass
        if dp is None or not (0 < dp <= 0.15):
            return {
                "Vc": None,
                "unit": "m/s",
                "intermediate": {
                    "step_A_Qk": self._safe_round(Qk, 12),
                    "Cd": self._safe_round(Cd, 12),
                }
            }

        # ---------- Step B: 临界管径 DL（由 Qk 反解，数值求解）----------
        if dp <= 0.07:
            def eq_dl_small(dl):
                if dl <= 0:
                    return -Qk
                inner = Cd * (dl ** 0.15)
                if inner <= 0:
                    return -Qk
                return 0.157 * beta * dl * (1.0 + 3.434 * (inner ** 0.25)) - Qk
            DL = self._solve_dl_bisection(eq_dl_small, 1e-6, 5000.0, max_iter=200)
        elif dp <= 0.15:
            def eq_dl_medium(dl):
                if dl <= 0:
                    return -Qk
                inner = Cd * (dl ** 0.25)
                if inner <= 0:
                    return -Qk
                return 0.2 * beta * dl * (1.0 + 2.48 * (inner ** (1.0/3.0))) - Qk
            DL = self._solve_dl_bisection(eq_dl_medium, 1e-6, 5000.0, max_iter=200)
        else:
            raise ValueError("尾矿加权平均粒径 dp 应 ≤0.15mm，当前为 %.3f mm" % dp)

        if DL is None or DL <= 0:
            raise ValueError("无法求解临界管径 DL，请检查输入参数是否合理")

        # ---------- Step C: 临界流速 V_L = 0.255*β*(1 + 2.48*³√(Cd)*⁴√(DL)) ----------
        if Cd <= 0:
            raise ValueError("重量砂水比 Cd 应大于0")
        term_cd = Cd ** (1.0/3.0)       # 浓度修正项 ³√(Cd)
        term_dl = (DL ** 0.25)          # 管径修正项 ⁴√(D_L)
        bracket_term = 1.0 + 2.48 * term_cd * term_dl
        Vc = 0.255 * beta * bracket_term

        return {
            "Vc": self._safe_round(Vc, 12),
            "unit": "m/s",
            "intermediate": {
                "term_cd": self._safe_round(term_cd, 12),
                "term_dl": self._safe_round(term_dl, 12),
                "bracket_term": self._safe_round(bracket_term, 12),
                "step_A_Qk": self._safe_round(Qk, 12),
                "step_B_DL_mm": self._safe_round(DL, 12),
                "Cd": self._safe_round(Cd, 12),
                "step_C_V_L": self._safe_round(Vc, 12),
            }
        }

    def _solve_dl_bisection(self, func, lo, hi, tol=1e-6, max_iter=200):
        """在 [lo, hi] 上对 func(DL)=0 做二分法求 DL"""
        f_lo = func(lo)
        f_hi = func(hi)
        if f_lo * f_hi > 0:
            return None
        for _ in range(max_iter):
            mid = (lo + hi) * 0.5
            f_mid = func(mid)
            if abs(f_mid) < tol or (hi - lo) < tol:
                return mid
            if f_lo * f_mid < 0:
                hi = mid
                f_hi = f_mid
            else:
                lo = mid
                f_lo = f_mid
        return (lo + hi) * 0.5
    
    def _calculate_friction_loss(self, params, g):
        """4.3.1-1 似均质流态浆体管道沿程摩阻损失: i_k = λ·(V²·ρ_k)/(2gD·ρ_s)，单位 mH₂O/m"""
        lambda_coef = params.get('lambda_coef')
        V = params.get('V')
        rho_k = params.get('rho_k')
        D = params.get('D')
        rho_s = params.get('rho_s')
        g_val = params.get('g', g)
        if None in [lambda_coef, V, rho_k, D, rho_s]:
            raise ValueError("沿程摩阻损失需要参数：λ、V、ρ_k、D、ρ_s")
        if D == 0 or rho_s == 0 or g_val == 0:
            raise ValueError("D、ρ_s、g 不能为0")
        # i_k = λ * (V^2 * ρ_k) / (2*g*D*ρ_s)
        i_k = lambda_coef * (V ** 2 * rho_k) / (2 * g_val * D * rho_s)
        if i_k < 0:
            raise ValueError("沿程摩阻损失计算结果为负，请检查输入")
        return {
            "i_k": self._safe_round(i_k, 12),
            "unit": "mH₂O/m",
            "intermediate": {
                "numerator": self._safe_round(V ** 2 * rho_k, 12),
                "denominator": self._safe_round(2 * g_val * D * rho_s, 12),
            }
        }

    def _calculate_slurry_friction_loss(self, params, g):
        """浆体摩阻损失（达西-魏斯巴赫公式）：仅计算 i_k，ρ_k 和 λ 由前置模块或用户直接输入"""
        rho_k_val = params.get("rho_k")
        if rho_k_val is None or not (isinstance(rho_k_val, (int, float)) and rho_k_val > 0 and not math.isnan(rho_k_val)):
            raise ValueError("浆体摩阻损失需要 ρ_k。请先在「密度混合公式」中计算，或直接输入 ρ_k。")
        r2 = self._calculate_friction_loss(params, g)
        return {
            "rho_k": float(rho_k_val),
            "i_k": r2["i_k"],
            "unit": r2["unit"],
            "intermediate": {
                "step_B_i_k": r2["i_k"],
                **r2.get("intermediate", {}),
            }
        }

    def _calculate_density_mixing(self, params, g):
        """4.3.1-2 浆体密度混合公式: ρ_k = 1/(C_w/ρ_g + (1-C_w)/ρ_s)，单位 t/m³"""
        C_w = params.get('C_w')
        rho_g = params.get('rho_g')  # 载体流体密度（如水）
        rho_s = params.get('rho_s')  # 固体颗粒密度
        if None in [C_w, rho_g, rho_s]:
            raise ValueError("密度混合公式需要参数：C_w、ρ_g、ρ_s")
        if rho_g == 0 or rho_s == 0:
            raise ValueError("ρ_g、ρ_s 不能为0")
        if C_w < 0 or C_w > 1:
            raise ValueError("C_w 须在 0～1 之间（小数，如 0.35）")
        # ρ_k = 1 / (C_w/ρ_g + (1-C_w)/ρ_s)
        denom = C_w / rho_g + (1.0 - C_w) / rho_s
        if denom <= 0:
            raise ValueError("密度混合公式分母应大于0")
        rho_k = 1.0 / denom
        return {
            "rho_k": self._safe_round(rho_k, 12),
            "unit": "t/m³",
            "intermediate": {
                "denom": self._safe_round(denom, 12),
            }
        }

    def _darcy_lambda_from_re(self, Re_B: float, epsilon: float, D_n: float):
        """由 Re_B、ε、D_n 求 λ 及流态标签。"""
        if Re_B < 2000:
            lam = 64.0 / Re_B
            flow_regime = "层流"
        else:
            eps_term = (epsilon / (3.7 * D_n)) if epsilon else 1e-10
            re_term = 5.7385 / (Re_B ** 0.9)
            inner = eps_term + re_term
            if inner <= 0:
                raise ValueError("达西摩阻系数计算项无效")
            lam = 1.33036 / (math.log(inner) ** 2)
            flow_regime = "湍流"
        return lam, flow_regime

    def _calculate_darcy_friction_step1_rho1(self, params):
        """仅算混合物密度 ρ₁（t/m³）：直填 ρ₁ 或由 ρ_g、ρ_s、C1v 推算。"""
        rho_1_val = params.get('rho_1')
        if rho_1_val is not None and isinstance(rho_1_val, (int, float)) and rho_1_val > 0 and not math.isnan(rho_1_val):
            rho_1_t = float(rho_1_val)
            return {
                "rho_1": self._safe_round(rho_1_t, 12),
                "unit": "t/m³",
                "intermediate": {
                    "step_A_rho_1": rho_1_t,
                    "rho1_input_mode": "direct",
                },
            }
        rho_g = params.get('rho_g')
        rho_s = params.get('rho_s')
        C1v = params.get('C1v')
        if None in [rho_g, rho_s, C1v]:
            raise ValueError("请提供 ρ₁，或填写 ρ_g、ρ_s、C1v")
        if rho_g <= 0 or rho_s <= 0:
            raise ValueError("ρ_g、ρ_s 必须大于 0")
        if C1v < 0 or C1v > 1:
            raise ValueError("液相体积浓度 C1v 应在 0～1 之间")
        term_liquid = rho_g * C1v
        term_solid = (1.0 - C1v) * rho_s
        rho_1_t = term_liquid + term_solid
        return {
            "rho_1": self._safe_round(rho_1_t, 12),
            "unit": "t/m³",
            "intermediate": {
                "step_A_rho_1": rho_1_t,
                "rho1_input_mode": "mixture",
                "term_rho_g_C1v": self._safe_round(term_liquid, 12),
                "term_1minusC1v_rho_s": self._safe_round(term_solid, 12),
            },
        }

    def _calculate_darcy_friction_step2_re(self, params):
        """仅算雷诺数 Re_B：直填 Re_B 或由 V、D_n、η₁ 与 ρ₁（t/m³）推算。"""
        rho_1_val = params.get('rho_1')
        if rho_1_val is None or not isinstance(rho_1_val, (int, float)) or rho_1_val <= 0 or math.isnan(rho_1_val):
            raise ValueError("本步需要混合物密度 ρ₁（t/m³）。请先完成「计算 ρ₁」或在本步直接填写。")
        rho_1_t = float(rho_1_val)
        rho_1_kg_m3 = rho_1_t * 1000.0
        Re_B_val = params.get('Re_B')
        if Re_B_val is not None and isinstance(Re_B_val, (int, float)) and Re_B_val > 0 and not math.isnan(Re_B_val):
            Re_B = float(Re_B_val)
            return {
                "Re_B": self._safe_round(Re_B, 12),
                "rho_1": self._safe_round(rho_1_t, 12),
                "unit": "",
                "intermediate": {
                    "step_B_Re_B": Re_B,
                    "rho_1_kg_m3": self._safe_round(rho_1_kg_m3, 12),
                    "re_input_mode": "direct",
                },
            }
        V = params.get('V')
        D_n = params.get('D_n')
        eta_1 = params.get('eta_1')
        if None in [V, D_n, eta_1]:
            raise ValueError("请提供 Re_B，或填写 V、D_n、η₁")
        if D_n <= 0 or eta_1 <= 0:
            raise ValueError("D_n、η₁ 必须大于 0")
        num = V * D_n * rho_1_kg_m3
        Re_B = num / eta_1
        return {
            "Re_B": self._safe_round(Re_B, 12),
            "rho_1": self._safe_round(rho_1_t, 12),
            "unit": "",
            "intermediate": {
                "step_B_Re_B": Re_B,
                "rho_1_kg_m3": self._safe_round(rho_1_kg_m3, 12),
                "re_numerator_V_D_rho_kg": self._safe_round(num, 12),
                "re_input_mode": "computed",
            },
        }

    def _calculate_darcy_friction_step3_lambda(self, params):
        """仅算达西摩阻系数 λ：需要 D_n、ε、Re_B。"""
        epsilon = params.get('epsilon', 0.0002)
        D_n = params.get('D_n')
        Re_B_val = params.get('Re_B')
        if D_n is None or D_n <= 0:
            raise ValueError("本步需要管道内径 D_n")
        if Re_B_val is None or not isinstance(Re_B_val, (int, float)) or Re_B_val <= 0 or math.isnan(Re_B_val):
            raise ValueError("本步需要雷诺数 Re_B。请先完成上一步或在本步直接填写。")
        Re_B = float(Re_B_val)
        lam, flow_regime = self._darcy_lambda_from_re(Re_B, float(epsilon or 0.0002), float(D_n))
        return {
            "lambda_coef": self._safe_round(lam, 12),
            "Re_B": self._safe_round(Re_B, 12),
            "unit": "",
            "intermediate": {
                "flow_regime": flow_regime,
                "step_C_lambda": lam,
            },
        }

    def _calculate_darcy_friction(self, params):
        """达西摩阻系数（一步算完）：与分步逻辑一致，ρ 为 t/m³。"""
        r1 = self._calculate_darcy_friction_step1_rho1(params)
        rho_1_num = float(r1["rho_1"])
        p2 = dict(params)
        p2["rho_1"] = rho_1_num
        r2 = self._calculate_darcy_friction_step2_re(p2)
        p3 = dict(p2)
        p3["Re_B"] = float(r2["Re_B"])
        r3 = self._calculate_darcy_friction_step3_lambda(p3)
        im = {
            "step_A_rho_1": r1["intermediate"]["step_A_rho_1"],
            "step_B_Re_B": float(r2["Re_B"]),
            "flow_regime": r3["intermediate"]["flow_regime"],
        }
        for src in (r1["intermediate"], r2["intermediate"]):
            for k, v in src.items():
                if k not in im:
                    im[k] = v
        return {
            "lambda_coef": r3["lambda_coef"],
            "rho_1": r1["rho_1"],
            "Re_B": r2["Re_B"],
            "unit": "",
            "intermediate": im,
        }

    def _calculate_slurry_accel_energy(self, params):
        """浆体加速流及消能：(Z₁+P₁/(ρkg))-(Z₂+P₂/(ρkg)) > iL；判断不等式是否成立"""
        Z1 = params.get('Z1')
        Z2 = params.get('Z2')
        H1 = params.get('H1')  # P1/(ρkg)
        H2 = params.get('H2')  # P2/(ρkg)
        i = params.get('i')
        L = params.get('L')
        if None in [Z1, Z2, H1, H2, i, L]:
            raise ValueError("浆体加速流需要参数：Z₁、Z₂、H₁、H₂、i、L")
        if L < 0:
            raise ValueError("管道长度 L 不能为负")
        # 左侧：总水头差
        head_diff = (Z1 + H1) - (Z2 + H2)
        # 右侧：沿程摩阻损失
        friction_loss_total = i * L
        condition_met = head_diff > friction_loss_total
        return {
            "condition_met": condition_met,
            "unit": "",
            "intermediate": {
                "head_diff": self._safe_round(head_diff, 12),
                "friction_loss_total": self._safe_round(friction_loss_total, 12),
            }
        }

    def _calculate_slurry_dissipation_orifice(self, params):
        """孔板消能分步计算（与前端 step 联动）：
        1) β = d/D（d 孔板开孔直径 m，D 管道内径 m）
        2) K_Qk = 6.3755×10^-9 · (1-β²)(1.142-β²) / d^4，单位 h²/m⁵
        3) Δh = K_Qk · Q²，Q 为 m³/h，Δh 为 m
        """
        step_raw = params.get("step")
        if step_raw is None:
            raise ValueError("孔板消能为分步计算：请在参数中传入 step=1、2 或 3。")
        step = int(step_raw)

        if step == 1:
            d = float(params["d"])
            D = float(params["D"])
            if d <= 0 or D <= 0:
                raise ValueError("孔板开孔直径 d 与管道内径 D 必须大于 0。")
            if d > D:
                raise ValueError("孔板开孔直径 d 不应大于管道内径 D。")
            beta = d / D
            return {
                "beta": self._safe_round(beta, 14),
                "unit": "—",
                "intermediate": {"orifice_step": 1},
            }

        if step == 2:
            d = float(params["d"])
            beta = float(params["beta"])
            if d <= 0:
                raise ValueError("孔板开孔直径 d 必须大于 0。")
            if beta <= 0 or beta > 1:
                raise ValueError("孔径比 β 应在 (0, 1]。")
            b2 = beta * beta
            numer = (1.0 - b2) * (1.142 - b2)
            K_Qk = 6.3755e-9 * numer / (d ** 4)
            return {
                "K_Qk": self._safe_round(K_Qk, 14),
                "unit": "h²/m⁵",
                "intermediate": {
                    "orifice_step": 2,
                    "orifice_numer": self._safe_round(numer, 14),
                },
            }

        if step == 3:
            K_Qk = float(params["K_Qk"])
            Q = float(params["Q"])
            if K_Qk < 0:
                raise ValueError("孔板流量消能系数 K_Qk 不能为负。")
            if Q < 0:
                raise ValueError("浆体流量 Q（m³/h）不能为负。")
            delta_h = K_Qk * (Q ** 2)
            return {
                "delta_h": self._safe_round(delta_h, 14),
                "unit": "m",
                "intermediate": {
                    "orifice_step": 3,
                    "Q_squared": self._safe_round(Q * Q, 14),
                },
            }

        raise ValueError("step 必须为 1、2 或 3。")

    def _calculate_slurry_dissipation(self, params):
        """浆体消能两步计算：
        1) K_QL = (6.3755×10^-9 * λ_d * L_s) / d^5
        2) Δh = K_QL * Q^2
        支持跳过步骤1直接输入 K_QL。
        """
        lambda_d = params.get('lambda_d')
        L_s = params.get('L_s')
        d = params.get('d')
        Q = params.get('Q')
        K_QL_input = params.get('K_QL')

        K_QL = None
        kql_numerator = None
        kql_denominator_d5 = None
        use_direct_kql = isinstance(K_QL_input, (int, float)) and not math.isnan(K_QL_input)
        if use_direct_kql:
            if K_QL_input <= 0:
                raise ValueError("K_QL 必须大于 0")
            K_QL = float(K_QL_input)
        else:
            if None in [lambda_d, L_s, d]:
                raise ValueError("请先完成步骤1（填写 λ_d、L_s、d），或直接输入 K_QL")
            if d <= 0:
                raise ValueError("消能管内径 d 必须大于 0")
            if L_s < 0:
                raise ValueError("沿程缩径增阻管道长度 L_s 不能为负")
            if lambda_d <= 0:
                raise ValueError("沿程缩径增阻管道达西摩系数 λ_d 必须大于 0")
            kql_numerator = 6.3755e-9 * lambda_d * L_s
            kql_denominator_d5 = d ** 5
            K_QL = kql_numerator / kql_denominator_d5

        intermediate = {
            "step_1_kql": self._safe_round(K_QL, 14),
            "kql_from_direct_input": use_direct_kql,
        }
        if kql_numerator is not None and kql_denominator_d5 is not None:
            intermediate["kql_numerator"] = self._safe_round(kql_numerator, 14)
            intermediate["kql_denominator_d5"] = self._safe_round(kql_denominator_d5, 14)

        out = {
            "K_QL": self._safe_round(K_QL, 14),
            "unit": "m",
            "intermediate": intermediate,
        }

        # Step 2 允许在拥有 K_QL 后单独执行
        if Q is not None:
            if Q <= 0:
                raise ValueError("浆体流量 Q 必须大于 0")
            Q_squared = Q ** 2
            delta_h = K_QL * Q_squared
            # round(x,6) 为「小数点后 6 位」，10^-6 量级会误成 1e-6，故提高小数位
            out["delta_h"] = self._safe_round(delta_h, 14)
            out["intermediate"]["Q_squared"] = self._safe_round(Q_squared, 14)
            out["intermediate"]["step_2_delta_h"] = self._safe_round(delta_h, 14)

        return out

    def _calculate_clear_water_friction_loss(self, params, g):
        """清水沿程摩阻：海澄–威廉形式；书写为 105·C_h^(-1.85)·…，计算用 K_hw（默认 105），单位 kPa/m"""
        Ch = params.get("C_h")
        dj = params.get("d_j")
        qg = params.get("q_g")
        if Ch is None or dj is None or qg is None:
            raise ValueError("需要参数：C_h、d_j、q_g")
        Ch = float(Ch)
        dj = float(dj)
        qg = float(qg)
        K_hw_raw = params.get("K_hw", 105)
        if K_hw_raw is None:
            K_hw = 105.0
        else:
            K_hw = float(K_hw_raw)
        if Ch <= 0:
            raise ValueError("海澄-威廉系数 C_h 必须大于 0")
        if K_hw <= 0:
            raise ValueError("式前系数 K_hw 必须大于 0")
        if dj <= 0:
            raise ValueError("管道计算内径 d_j 必须大于 0")
        if qg <= 0:
            raise ValueError("给水设计流量 q_g 必须大于 0")

        ch_pow = Ch ** (-1.85)
        dj_pow = dj ** (-4.87)
        qg_pow = qg ** 1.85
        i_kpa_m = K_hw * ch_pow * dj_pow * qg_pow

        return {
            "i": self._safe_round(i_kpa_m, 12),
            "unit": "kPa/m",
            "intermediate": {
                "clear_hw_ch_pow": self._safe_round(ch_pow, 14),
                "clear_hw_dj_pow": self._safe_round(dj_pow, 14),
                "clear_hw_qg_pow": self._safe_round(qg_pow, 14),
            },
        }

    def _calculate_total_head(self, params, fluid_type):
        """总扬程计算。
        浆体: P_k = ρ_k·g·H + ρ_s·g·i_k·L + P_j + P_n + P_z  (kPa)；ρ_k、ρ_s 单位为 t/m³。
        清水: 请使用 clear_water_total_head。
        同时生成 P_k-L 曲线数据点。
        """
        if fluid_type == 'water':
            raise ValueError("请使用 clear_water_total_head 接口")

        rho_k = params.get('rho_k')
        g = params.get('g', 9.81)
        H = params.get('H')
        rho_s = params.get('rho_s')
        i_k = params.get('i_k')
        L = params.get('L')
        P_j = params.get('P_j', 0)
        P_n = params.get('P_n', 0)
        P_z = params.get('P_z', 0)

        if None in [rho_k, H, rho_s, i_k, L]:
            raise ValueError("浆体总扬程需要参数：ρ_k、H、ρ_s、i_k、L")
        if rho_k <= 0:
            raise ValueError("浆体密度 ρ_k 必须大于 0")
        if rho_s <= 0:
            raise ValueError("固体颗粒密度 ρ_s 必须大于 0")
        if L <= 0:
            raise ValueError("管道总长度 L 必须大于 0")

        # ρ_k、ρ_s 单位为 t/m³，P(kPa) = ρ(t/m³) × g × H（与 kg/m³ 时除以 1000 等价）
        gravity_pressure = rho_k * g * H
        friction_pressure = rho_s * g * i_k * L
        P_k = gravity_pressure + friction_pressure + P_j + P_n + P_z

        # Pk–L 曲线与前端损失图一致：按管长 L 等分为 10 段，共 11 个采样点（步长 L/10）
        num_segments = 10
        hl_curve = []
        for idx in range(num_segments + 1):
            l_pt = L * idx / num_segments
            fric_pt = rho_s * g * i_k * l_pt
            pj_pt = P_j * (l_pt / L) if L > 0 else 0
            pk_pt = gravity_pressure + fric_pt + pj_pt + P_n + P_z
            hl_curve.append({"L": self._safe_round(l_pt, 2), "H": self._safe_round(pk_pt, 4)})

        return {
            "H_total": self._safe_round(P_k, 6),
            "unit": "kPa",
            "intermediate": {
                "gravity_pressure": self._safe_round(gravity_pressure, 6),
                "friction_pressure": self._safe_round(friction_pressure, 6),
                "P_j": P_j,
                "P_n": P_n,
                "P_z": P_z,
            },
            "hl_curve": hl_curve
        }

    def _calculate_clear_water_total_head(self, params):
        """清水总扬程: P_w = rho_w*g*(H + i_w*L) + P_j + P_n + P_z  (kPa)
        与浆体公式结构相同，但 rho_k=rho_s=rho_w；ρ_w 单位为 t/m³（默认 1，即 1000 kg/m³）"""
        rho_w = params.get('rho_w', 1)
        g = params.get('g', 9.81)
        H = params.get('H')
        i_w = params.get('i_w')
        L = params.get('L')
        P_j = params.get('P_j', 0)
        P_n = params.get('P_n', 0)
        P_z = params.get('P_z', 0)

        if None in [H, i_w, L]:
            raise ValueError("清水总扬程需要参数：H、i_w、L")
        if rho_w <= 0:
            raise ValueError("清水密度 rho_w 必须大于 0")
        if L <= 0:
            raise ValueError("管道总长度 L 必须大于 0")

        gravity_pressure = rho_w * g * H
        friction_pressure = rho_w * g * i_w * L
        P_w = gravity_pressure + friction_pressure + P_j + P_n + P_z

        num_points = min(max(int(L / 10), 20), 200)
        step = L / num_points
        hl_curve = []
        for idx in range(num_points + 1):
            l_pt = idx * step
            fric_pt = rho_w * g * i_w * l_pt
            pj_pt = P_j * (l_pt / L) if L > 0 else 0
            pw_pt = gravity_pressure + fric_pt + pj_pt + P_n + P_z
            hl_curve.append({"L": self._safe_round(l_pt, 2), "H": self._safe_round(pw_pt, 4)})

        return {
            "H_total": self._safe_round(P_w, 6),
            "unit": "kPa",
            "intermediate": {
                "gravity_pressure": self._safe_round(gravity_pressure, 6),
                "friction_pressure": self._safe_round(friction_pressure, 6),
                "P_j": P_j,
                "P_n": P_n,
                "P_z": P_z,
            },
            "hl_curve": hl_curve
        }

    def _calculate_centrifugal_pump_kp(self, params):
        """步骤1：K_p = 1 - 0.25·C_w（主泵输送浆体时的扬程降低率，无量纲）"""
        cw_raw = params.get("C_w")
        if cw_raw is None:
            raise ValueError("步骤1 需要浆体重量浓度 C_w")
        try:
            cw = float(cw_raw)
        except (TypeError, ValueError):
            raise ValueError("C_w 无效")
        if cw < 0 or cw > 1:
            raise ValueError("C_w 须为 0～1 之间的小数（如 0.35）")
        term = 0.25 * cw
        kp = 1.0 - term
        if kp <= 0:
            raise ValueError("K_p = 1 - 0.25·C_w 须大于 0，请检查 C_w")
        return {
            "K_p": self._safe_round(kp, 12),
            "unit": "无量纲",
            "intermediate": {},
        }

    def _calculate_centrifugal_pump_hb(self, params):
        """步骤2：H_b = ΣH_s / (K_p·K_m)，结果与输入均为液柱扬程（m）；Sigma_H_s 表示 ΣH_s（m）。"""
        s = params.get("Sigma_H_s")
        kp = params.get("K_p")
        km = params.get("K_m")
        if s is None:
            raise ValueError("步骤2 需要 ΣH_s（装置所需压力累计，液柱高度 m）")
        if kp is None:
            raise ValueError("步骤2 需要 K_p")
        if km is None:
            raise ValueError("步骤2 需要 K_m")
        s = float(s)
        kp = float(kp)
        km = float(km)
        if s <= 0:
            raise ValueError("ΣH_s 须大于 0")
        if kp <= 0:
            raise ValueError("K_p 须大于 0")
        if km <= 0:
            raise ValueError("K_m 须大于 0")
        if km < 0.85 or km > 0.98:
            raise ValueError("K_m 须在 0.85～0.98 之间")
        denom = kp * km
        hb = s / denom
        im = {
            "Sigma_H_s": self._safe_round(s, 12),
            "K_p": self._safe_round(kp, 12),
            "K_m": self._safe_round(km, 12),
            "K_p_K_m": self._safe_round(denom, 12),
            "H_b": self._safe_round(hb, 6),
        }
        return {
            "H_total": self._safe_round(hb, 6),
            "unit": "m",
            "intermediate": im,
        }

    def _calculate_positive_displacement_pump_total_head(self, params):
        """容积式泵：P_b = P_k / K_f（kPa）。P_k 为浆体管道输送压力；K_f 为压力富余系数。"""
        pk = params.get("P_k")
        kf = params.get("K_f")
        if pk is None:
            raise ValueError("需要浆体管道输送压力 P_k（kPa）")
        if kf is None:
            raise ValueError("需要泵的压力富余系数 K_f")
        pk = float(pk)
        kf = float(kf)
        if pk <= 0:
            raise ValueError("P_k 须大于 0")
        if kf <= 0:
            raise ValueError("K_f 须大于 0")
        if kf > 1.0:
            raise ValueError("K_f 宜不大于 1.0，请检查是否误填")
        pb = pk / kf
        return {
            "P_b": self._safe_round(pb, 6),
            "H_total": self._safe_round(pb, 6),
            "unit": "kPa",
            "intermediate": {
                "P_k": self._safe_round(pk, 6),
                "K_f": self._safe_round(kf, 12),
            },
        }

    def _calculate_positive_displacement_motor_power(self, params):
        """步骤2：N = K_1·Q_k·P_b / (η_v·η_c)，kW。Q_k：m³/s；P_b：kPa。"""
        pb = params.get("P_b")
        qk = params.get("Q_k")
        k1 = params.get("K_1")
        eta_v = params.get("eta_v")
        eta_c = params.get("eta_c")
        if pb is None:
            raise ValueError("步骤2 需要 P_b（kPa）")
        if qk is None:
            raise ValueError("步骤2 需要浆体计算流量 Q_k（m³/s）")
        if k1 is None:
            raise ValueError("步骤2 需要电机功率富余系数 K_1")
        if eta_v is None or eta_c is None:
            raise ValueError("步骤2 需要容积效率 η_v 与总机械效率 η_c")
        pb = float(pb)
        qk = float(qk)
        k1 = float(k1)
        eta_v = float(eta_v)
        eta_c = float(eta_c)
        if pb <= 0 or qk <= 0:
            raise ValueError("P_b、Q_k 须大于 0")
        if k1 <= 0 or eta_v <= 0 or eta_c <= 0:
            raise ValueError("K_1、η_v、η_c 须大于 0")
        denom = eta_v * eta_c
        n_kw = k1 * qk * pb / denom
        return {
            "N": self._safe_round(n_kw, 6),
            "unit": "kW",
            "intermediate": {
                "P_b": self._safe_round(pb, 6),
                "Q_k": self._safe_round(qk, 12),
                "K_1": self._safe_round(k1, 12),
                "eta_v": self._safe_round(eta_v, 12),
                "eta_c": self._safe_round(eta_c, 12),
                "numerator_K1_Q_Pb": self._safe_round(k1 * qk * pb, 12),
                "denom_eta_v_eta_c": self._safe_round(denom, 12),
            },
        }

    def _calculate_centrifugal_pump_motor_power(self, params):
        """步骤3：N = K_1·ρ_k(kg/m³)·g·Q_k·H_b / (1000·η_j·η_b)，kW。
        H_b 为步骤2 给出的主泵扬送清水总扬程（液柱 m）；程序内记 H_m = H_b 写入中间量。"""
        hb_m = params.get("H_b")
        if hb_m is None:
            raise ValueError("步骤3 需要 H_b（液柱扬程 m）")
        rho_t = params.get("rho_k")
        if rho_t is None:
            raise ValueError("步骤3 需要浆体密度 ρ_k（t/m³）")
        g = float(params.get("g", 9.81))
        qk = params.get("Q_k")
        k1 = params.get("K_1")
        eta_j = params.get("eta_j")
        eta_b = params.get("eta_b")
        if qk is None:
            raise ValueError("步骤3 需要浆体计算流量 Q_k（m³/s）")
        if k1 is None:
            raise ValueError("步骤3 需要电机功率富余系数 K_1")
        if eta_j is None or eta_b is None:
            raise ValueError("步骤3 需要传动效率 η_j 与泵效率 η_b")
        hb_m = float(hb_m)
        rho_t = float(rho_t)
        qk = float(qk)
        k1 = float(k1)
        eta_j = float(eta_j)
        eta_b = float(eta_b)
        if rho_t <= 0 or g <= 0:
            raise ValueError("ρ_k、g 须大于 0")
        if hb_m <= 0 or qk <= 0:
            raise ValueError("H_b、Q_k 须大于 0")
        if k1 < 1.1 or k1 > 1.2:
            raise ValueError("K_1 须在 1.1～1.2 之间")
        if eta_j <= 0 or eta_j > 1:
            raise ValueError("η_j 须为大于 0 且不大于 1 的实数")
        if eta_b <= 0 or eta_b > 1:
            raise ValueError("η_b 须为大于 0 且不大于 1 的实数")
        h_m = hb_m
        rho_si = rho_t * 1000.0
        n_kw = k1 * rho_si * g * qk * h_m / 1000.0 / eta_j / eta_b
        return {
            "N": self._safe_round(n_kw, 6),
            "unit": "kW",
            "intermediate": {
                "H_b_m": self._safe_round(hb_m, 6),
                "H_m": self._safe_round(h_m, 12),
                "rho_k_t_m3": self._safe_round(rho_t, 12),
                "Q_k": self._safe_round(qk, 12),
                "K_1": self._safe_round(k1, 12),
                "eta_j": self._safe_round(eta_j, 12),
                "eta_b": self._safe_round(eta_b, 12),
                "rho_si_kg_m3": self._safe_round(rho_si, 6),
            },
        }
