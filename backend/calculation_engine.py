import math

class CalculationEngine:
    
    def _safe_round(self, value, decimals=6):
        """安全地四舍五入，处理复数和无效值"""
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
        elif formula_id == "slurry_accel_energy":
            return self._calculate_slurry_accel_energy(parameters)
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
            "Vc": self._safe_round(Vc, 6),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 6),
                "core_term": self._safe_round(core_term, 6),
                "concentration_term": self._safe_round(concentration_term, 6),
                "velocity_ratio_term": self._safe_round(velocity_ratio_term, 6),
                "coefficient": self._safe_round(coefficient, 2),
                "g": self._safe_round(g, 2)
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
            "Vc": self._safe_round(Vc, 6),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 6),
                "bracket_term": self._safe_round(bracket_term, 6),
                "concentration_term": self._safe_round(concentration_term, 6),
                "size_ratio_term": self._safe_round(size_ratio_term, 6),
                "coefficient": self._safe_round(coefficient, 3),
                "g": self._safe_round(g, 2)
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
            "Vc": self._safe_round(Vc, 6),
            "unit": "m/s",
            "intermediate": {
                "delta_rho_ratio": self._safe_round(delta_rho_ratio, 6),
                "bracket_term": self._safe_round(bracket_term, 6),
                "conc_term": self._safe_round(conc_term, 6),
                "size_term": self._safe_round(size_term, 6),
                "leading_coef": self._safe_round(leading_coef, 6),
                "coefficient_2_26": self._safe_round(coefficient_2_26, 2),
                "lambda_coef": self._safe_round(lambda_coef, 6),
                "g": self._safe_round(g, 2)
            }
        }
    
    def _calculate_kronodze_pressure(self, params, g):
        """B.C.克诺罗兹法三步计算，每步可独立计算：
        A) 矿浆流量 Qk = K*W*(1/ρg + G/W)，仅需 K、G、W、ρg，不需 dp
        B) 临界管径 DL：需 dp、β 及步骤 A 的 Qk；当 dp≤0.07 与 0.07<dp≤0.15 两套公式
        C) 临界流速 V_L：由 A、B 结果及 β 计算
        """
        K = params.get('K', 1.1)  # 波动系数
        G = params.get('G')       # 干尾矿重量
        W = params.get('W')       # 矿浆中水重
        rho_g = params.get('rho_g')  # 尾矿相对密度
        dp_raw = params.get('dp')    # 尾矿加权平均粒径，mm（步骤2 才需要）
        beta = params.get('beta', 1.0)  # 固体物料相对密度修正系数

        # 步骤 A 仅需 G、W、ρg（K 有默认值）
        if G is None or W is None or rho_g is None:
            raise ValueError("步骤1 需要参数：G（干尾矿重量）、W（矿浆中水重）、ρg（尾矿相对密度）")
        if W == 0:
            raise ValueError("矿浆中水重 W 不能为0")
        if rho_g <= 0:
            raise ValueError("尾矿相对密度 ρg 必须大于0")

        # ---------- Step A: 矿浆流量 Qk = K*W*(1/ρg + G/W) ----------
        Qk = K * W * (1.0 / rho_g + G / W)
        if Qk <= 0:
            raise ValueError("矿浆流量 Qk 计算结果应大于0，请检查 G、W、ρg")
        Cd = (G / W) * 100.0  # 重量砂水比（砂重/水重×100）

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
                    "step_A_Qk": self._safe_round(Qk, 6),
                    "Cd": self._safe_round(Cd, 6),
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
        term_cd = Cd ** (1.0/3.0)
        term_dl = (DL ** 0.25)
        Vc = 0.255 * beta * (1.0 + 2.48 * term_cd * term_dl)

        return {
            "Vc": self._safe_round(Vc, 6),
            "unit": "m/s",
            "intermediate": {
                "step_A_Qk": self._safe_round(Qk, 6),
                "step_B_DL_mm": self._safe_round(DL, 4),
                "Cd": self._safe_round(Cd, 6),
                "step_C_V_L": self._safe_round(Vc, 6),
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
            "i_k": self._safe_round(i_k, 6),
            "unit": "mH₂O/m",
            "intermediate": {
                "numerator": self._safe_round(V ** 2 * rho_k, 6),
                "denominator": self._safe_round(2 * g_val * D * rho_s, 6),
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
            raise ValueError("质量浓度 C_w 应在 0～1 之间")
        # ρ_k = 1 / (C_w/ρ_g + (1-C_w)/ρ_s)
        denom = C_w / rho_g + (1.0 - C_w) / rho_s
        if denom <= 0:
            raise ValueError("密度混合公式分母应大于0")
        rho_k = 1.0 / denom
        return {
            "rho_k": self._safe_round(rho_k, 6),
            "unit": "t/m³",
            "intermediate": {
                "denom": self._safe_round(denom, 6),
            }
        }

    def _calculate_darcy_friction(self, params):
        """达西摩阻系数：层流 λ=64/Re；湍流采用 Swamee-Jain 近似"""
        Re = params.get('Re')
        epsilon = params.get('epsilon', 0.0002)  # 当量粗糙度 m
        D = params.get('D')
        if Re is None or Re <= 0:
            raise ValueError("达西摩阻系数公式需要参数：Re（雷诺数）且 Re > 0")
        if Re < 2300:
            # 层流：λ = 64/Re
            lam = 64.0 / Re
            return {
                "lambda_coef": self._safe_round(lam, 6),
                "unit": "",
                "intermediate": {
                    "Re": self._safe_round(Re, 4),
                    "flow_regime": "层流"
                }
            }
        # 湍流：Swamee-Jain 近似 λ = 0.25 / [log10(ε/(3.7D) + 5.74/Re^0.9)]^2
        if D is None or D <= 0:
            raise ValueError("湍流时需提供管道内径 D")
        eps_D = epsilon / D if epsilon is not None else 0.0001
        eps_D = max(eps_D, 1e-10)
        term = eps_D / 3.7 + 5.74 / (Re ** 0.9)
        if term <= 0:
            raise ValueError("达西摩阻系数计算项无效")
        lam = 0.25 / (math.log10(term) ** 2)
        return {
            "lambda_coef": self._safe_round(lam, 6),
            "unit": "",
            "intermediate": {
                "Re": self._safe_round(Re, 4),
                "eps_D": self._safe_round(eps_D, 6),
                "flow_regime": "湍流"
            }
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
            raise ValueError("浆体加速流及消能需要参数：Z₁、Z₂、H₁、H₂、i、L")
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
                "head_diff": self._safe_round(head_diff, 6),
                "friction_loss_total": self._safe_round(friction_loss_total, 6),
            }
        }
