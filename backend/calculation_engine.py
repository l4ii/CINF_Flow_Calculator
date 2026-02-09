import math
import cmath

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
        elif formula_id == "kronodze_gravity":
            return self._calculate_kronodze_gravity(parameters, g)
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
        """B.C.克诺罗兹法（压力流）: Vc = C * sqrt(gD * (ps - pl)/pl)"""
        D = params.get('D')
        ps = params.get('ps')
        pl = params.get('pl')
        C = params.get('C')
        
        if None in [D, ps, pl, C]:
            raise ValueError("克诺罗兹法（压力流）需要所有参数")
        
        if pl == 0:
            raise ValueError("载体液体密度pl不能为0")
        
        if ps < pl:
            raise ValueError("固体颗粒密度ps必须大于载体液体密度pl")
        
        sqrt_value = g * D * (ps - pl) / pl
        if sqrt_value < 0:
            raise ValueError(f"开方项计算结果为负数: {sqrt_value}，请检查输入参数")
        
        Vc = C * math.sqrt(sqrt_value)
        
        return {
            "Vc": self._safe_round(Vc, 4),
            "unit": "m/s",
            "intermediate": {
                "density_ratio": self._safe_round((ps - pl) / pl, 6),
                "sqrt_term": self._safe_round(math.sqrt(sqrt_value), 6)
            }
        }
    
    def _calculate_kronodze_gravity(self, params, g):
        """B.C.克诺罗兹法（重力流）: Vc = Cg * sqrt(gD * (ps - pl)/pl * sin(θ))"""
        D = params.get('D')
        ps = params.get('ps')
        pl = params.get('pl')
        Cg = params.get('Cg')
        theta = params.get('theta')  # 角度（度）
        
        if None in [D, ps, pl, Cg, theta]:
            raise ValueError("克诺罗兹法（重力流）需要所有参数")
        
        if pl == 0:
            raise ValueError("载体液体密度pl不能为0")
        
        if ps < pl:
            raise ValueError("固体颗粒密度ps必须大于载体液体密度pl")
        
        # 将角度转换为弧度
        theta_rad = math.radians(theta)
        sin_theta = math.sin(theta_rad)
        
        if sin_theta < 0:
            raise ValueError("管道倾角theta应在0-180度之间")
        
        sqrt_value = g * D * (ps - pl) / pl * sin_theta
        if sqrt_value < 0:
            raise ValueError(f"开方项计算结果为负数: {sqrt_value}，请检查输入参数")
        
        Vc = Cg * math.sqrt(sqrt_value)
        
        return {
            "Vc": self._safe_round(Vc, 4),
            "unit": "m/s",
            "intermediate": {
                "density_ratio": self._safe_round((ps - pl) / pl, 6),
                "sin_theta": self._safe_round(sin_theta, 6),
                "sqrt_term": self._safe_round(math.sqrt(sqrt_value), 6)
            }
        }
