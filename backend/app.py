from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from calculation_engine import CalculationEngine
from word_export import WordExporter
from datetime import datetime
import os

app = Flask(__name__)
# 配置CORS，允许所有来源（开发环境）
CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

calculation_engine = CalculationEngine()
word_exporter = WordExporter()

@app.route('/api/formulas', methods=['GET'])
def get_formulas():
    """获取所有可用的公式列表（按侧栏分组）"""
    formulas = {
        "临界流速计算": [
            {
                "id": "liu_dezhong",
                "name": "刘德忠公式",
                "formula": "Vc = 9.5 * [g*D*(Δρ/ρ)*ω]^(1/3) * Cv^(1/6) * (ω_s/ω)^(1/6)",
                "description": "本模型由刘德忠教授提出，是中国浆体管道设计中的主流经验公式之一。其核心思想基于浆体的整体沉降特性，通过引入加权平均沉速（$\\omega$）与静态界面沉速（$\\omega_s$）这两个关键实验参数，来综合反映固体颗粒群的干涉沉降行为。该公式尤其适用于细颗粒（如$d<2\\text{mm}$）含量较高、级配相对均匀的浆体，计算结果与中国工程实践贴合紧密。使用本公式的前提是需通过静态沉降柱试验获取可靠的$\\omega$与$\\omega_s$值。",
                "parameters": [
                    {"name": "D", "label": "$D$：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "omega", "label": "$\\omega$：速度参数，单位为 m/s", "unit": "m/s", "description": "速度参数", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "omega_s", "label": "$\\omega_s$：沉降速度，单位为 m/s", "unit": "m/s", "description": "沉降速度", },
                    {"name": "g", "label": "$g$：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_9_5", "label": "经验系数：默认值 9.5（无量纲）", "unit": "", "description": "经验系数", "default": 9.5}
                ]
            },
            {
                "id": "wasp",
                "name": "E.J.瓦斯普公式",
                "formula": "Vc = 3.113 * Cv^0.1858 * [2*g*D*(Δρ/ρ)]^(1/2) * (d85/D)^(1/6)",
                "description": "本模型由E.J.Wasp等人提出，是国际上分析宽级配、非均质流临界流速的经典理论公式。其理论基础为两相流扩散模型，公式结构清晰体现了悬浮能量消耗与颗粒沉降间的平衡。它通过体积浓度（$C_v$）和相对密度差（$\\frac{\\Delta\\rho}{\\rho}$）来表征输送难度，并首次引入特征粒径（$d_{85}$）来量化粗颗粒对床层形成的影响。该公式特别适合粒径分布范围广、存在显著非均质输送特性的浆体。",
                "parameters": [
                    {"name": "D", "label": "$D$：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "d85", "label": "$d_{85}$：特征粒径，单位为 m", "unit": "m", "description": "d85特征粒径", },
                    {"name": "g", "label": "$g$：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_3_113", "label": "经验系数：默认值 3.113（无量纲）", "unit": "", "description": "经验系数", "default": 3.113}
                ]
            },
            {
                "id": "fei_xiangjun",
                "name": "费祥俊公式",
                "formula": "Vc = (2.26/√λ) * [gD*(Δρ/ρ)*ω]^(1/2) * Cv^0.25 * (d90/D)^(1/3)",
                "description": "本模型由费祥俊教授建立，其显著特点是首次将管道沿程阻力系数（$\\lambda$）引入临界流速的计算，在理论上将输送能耗与维持颗粒悬浮的能耗进行了统一。公式采用特征粒径（$d_{90}$）来表征浆体颗粒群的粗细程度，并对浆体浓度（$C_v$）影响的刻画较为显著。该公式在理论上更为全面，尤其适合于长距离输送管道的水力坡降与系统设计。应用时，需根据管道材质、内壁状况及流态等条件合理确定或计算沿程阻力系数（$\\lambda$），此参数对计算结果有重要影响。",
                "parameters": [
                    {"name": "D", "label": "$D$：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "omega", "label": "$\\omega$：速度参数，单位为 m/s", "unit": "m/s", "description": "速度参数", },
                    {"name": "d90", "label": "$d_{90}$：特征粒径，单位为 m", "unit": "m", "description": "d90特征粒径", },
                    {"name": "lambda_coef", "label": "$\\lambda$：达西摩阻系数，无量纲", "unit": "", "description": "摩擦阻力系数", },
                    {"name": "g", "label": "$g$：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_2_26", "label": "经验系数：默认值 2.26（无量纲）", "unit": "", "description": "经验系数", "default": 2.26}
                ]
            },
            {
                "id": "kronodze_pressure",
                "name": "B.C.克诺罗兹法",
                "formula": "A) Qk=K·W·(1/ρg+G/W)；B) 按dp求DL；C) V_L=0.255β(1+2.48·³√(Cd)·⁴√(DL))",
                "description": "A) 计算矿浆流量。其中：【输出结果】Qk 矿浆流量，单位为 m³/s；K 波动系数：默认值 1.1；【用户输入】W 干尾矿重量，单位为 t/h；$\\rho_g$ 尾矿相对密度，单位为 t/m³；G 矿浆中水重，单位为 t/h。B) 计算临界管径。当 dp≤0.07 mm 与 0.07<dp≤0.15 mm 分别采用不同公式，由 Qk 反解。【用户选择】dp 尾矿加权平均粒径，单位为 mm；$\\beta$ 固体物料相对密度修正系数：默认值 1；【输出结果】DL 临界管径，单位为 mm；Cd 重量砂水比 = W/G×100。C) 计算临界流速。【输出结果】V_L 临界流速，单位为 m/s。适用于有压隧洞泥沙运输、固体密度<3、粒径<0.4 mm 的浆体；体积浓度>30% 时偏差较大。",
                "parameters": [
                    {"name": "K", "label": "$K$：波动系数，默认 1.1（无量纲）", "unit": "", "description": "波动系数", "default": 1.1},
                    {"name": "G", "label": "$G$：矿浆中水重，单位为 t/h", "unit": "t/h", "description": "矿浆中水重", },
                    {"name": "W", "label": "$W$：干尾矿重量，单位为 t/h", "unit": "t/h", "description": "干尾矿重量", },
                    {"name": "rho_g", "label": "$\\rho_g$：尾矿相对密度，单位为 t/m³", "unit": "t/m³", "description": "尾矿相对密度", },
                    {"name": "dp", "label": "$d_p$：尾矿加权平均粒径，单位为 mm", "unit": "mm", "description": "尾矿加权平均粒径；≤0.07 与 0.07～0.15 对应不同公式", },
                    {"name": "beta", "label": "$\\beta$：固体物料相对密度修正系数：默认值 1（无量纲）", "unit": "", "description": "固体物料相对密度修正系数", "default": 1.0}
                ]
            }
        ],
        "沿程摩阻损失": [
            {
                "id": "density_mixing",
                "name": "密度混合公式",
                "formula": "ρ_k = 1/(C_w/ρ_g + (1-C_w)/ρ_s)",
                "description": "本部分为沿程摩阻损失的前置计算，用于由固体质量浓度及液相、固相密度求得浆体当量密度 ρ_k。所得 ρ_k 将作为达西-魏斯巴赫型浆体摩阻损失公式的输入，可在侧栏「浆体摩阻损失」模块中使用。",
                "parameters": [
                    {"name": "C_w", "label": "$C_w$：固体质量浓度，无量纲（0～1）", "unit": "", "description": "固体质量浓度", },
                    {"name": "rho_g", "label": "$\\rho_g$：载体流体密度，t/m³", "unit": "t/m³", "description": "载体流体密度", },
                    {"name": "rho_s", "label": "$\\rho_s$：固体颗粒密度，t/m³", "unit": "t/m³", "description": "固体颗粒密度", }
                ]
            },
            {
                "id": "darcy_friction",
                "name": "达西摩阻系数",
                "formula": "A) ρ₁=ρg·C1v+(1-C1v)·ρs；B) ReB=(V·Dn·ρ₁)/η₁；C) λ",
                "description": "本部分用于计算管道内流体流动的沿程阻力系数 (λ)，该系数是计算管道摩阻损失、选择泵型和确定输送能耗的关键参数。",
                "parameters": [
                    {"name": "rho_1", "label": "$\\rho_1$：矿浆混合物密度（可由下方计算或直接输入）", "unit": "kg/m³", "description": "步骤 1 输出", },
                    {"name": "rho_g", "label": "$\\rho_g$：液相密度，kg/m³", "unit": "kg/m³", "description": "通常为水", },
                    {"name": "rho_s", "label": "$\\rho_s$：固体颗粒密度，kg/m³", "unit": "kg/m³", "description": "尾矿相对密度", },
                    {"name": "C1v", "label": "$C_{1v}$：液相体积浓度（小数 0～1）", "unit": "", "description": "液相体积分数", },
                    {"name": "Re_B", "label": "$Re_B$：雷诺数（可由下方计算或直接输入）", "unit": "", "description": "步骤 2 输出", },
                    {"name": "V", "label": "$V$：管道内矿浆平均流速，m/s", "unit": "m/s", "description": "平均流速", },
                    {"name": "D_n", "label": "$D_n$：管道内径，m", "unit": "m", "description": "管道内径", },
                    {"name": "eta_1", "label": "$\\eta_1$：矿浆动力粘度，Pa·s", "unit": "Pa·s", "description": "需实验测量或经验公式估算", },
                    {"name": "epsilon", "label": "$\\varepsilon$：管壁绝对粗糙度，m", "unit": "m", "description": "可查工程手册", "default": 0.0002}
                ]
            },
            {
                "id": "slurry_friction_loss",
                "name": "浆体摩阻损失",
                "formula": "i_k = λ·(V²·ρ_k)/(2gD·ρ_s)",
                "description": "基于达西-魏斯巴赫公式的浆体沿程摩阻损失计算。ρ_k 和 λ 为前置量：ρ_k 可由「密度混合公式」求得，λ 可由「达西摩阻系数」求得；若已知两者，亦可直接输入后计算。适用于似均质流态浆体管道水力计算。",
                "parameters": [
                    {"name": "rho_k", "label": "$\\rho_k$：浆体密度（可由「密度混合公式」计算或直接输入）", "unit": "t/m³", "description": "浆体当量密度", },
                    {"name": "lambda_coef", "label": "$\\lambda$：达西摩阻系数（可由「达西摩阻系数」计算或直接输入）", "unit": "", "description": "达西摩阻系数", },
                    {"name": "V", "label": "$V$：平均流速，单位为 m/s", "unit": "m/s", "description": "管道内平均流速", },
                    {"name": "D", "label": "$D$：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_s", "label": "$\\rho_s$：固体颗粒密度，t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "g", "label": "$g$：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81}
                ]
            }
        ],
        "浆体加速流及消能": [
            {
                "id": "slurry_accel_energy",
                "name": "浆体加速流",
                "formula": "(Z₁ + P₁/(ρkg)) - (Z₂ + P₂/(ρkg)) > iL",
                "description": "浆体加速流判据用于管道输送系统的工况校核，本质是比较两断面机械能差与沿程阻力耗散。计算中将高程项与压能项折算为水头，形成左侧总驱动水头差 $(Z_1+H_1)-(Z_2+H_2)$，并与右侧沿程摩阻损失项 $iL$ 对比；当左侧大于右侧时，可判定系统具备维持加速流的能量条件。该模型适用于泵站扬程分配、长距离管线分段校核与运行参数复核，建议结合现场压力与流量监测结果综合判断。",
                "parameters": [
                    {"name": "Z1", "label": "$Z_1$：起点位置水头，单位为 m", "unit": "m", "description": "浆体流动起点相对于基准面的垂直高度", },
                    {"name": "Z2", "label": "$Z_2$：终点位置水头，单位为 m", "unit": "m", "description": "浆体流动终点相对于基准面的垂直高度", },
                    {"name": "H1", "label": "$H_1$：起点压能浆体水头 $P_1/(\\rho_k g)$，单位为 m", "unit": "m", "description": "起点压力能转换的水头高度", },
                    {"name": "H2", "label": "$H_2$：终点压能浆体水头 $P_2/(\\rho_k g)$，单位为 m", "unit": "m", "description": "终点压力能转换的水头高度", },
                    {"name": "i", "label": "$i$：两点间沿程摩阻损失，单位为 m浆柱/m", "unit": "m浆柱/m", "description": "单位长度管道内的摩阻损失", },
                    {"name": "L", "label": "$L$：管道长度，单位为 m", "unit": "m", "description": "起点至终点的管道总长度", }
                ]
            },
            {
                "id": "slurry_dissipation",
                "name": "浆体消能",
                "formula": "步骤1：K_{QL}=\\frac{(6.3755\\times10^{-9})\\lambda_dL_s}{d^5}；步骤2：\\Delta h=K_{QL}Q^2",
                "description": "介绍：该公式是浆体输送工程中一个专用的工程计算式，其核心目的是计算沿程缩径增阻管道的流量消能系数。所谓“沿程缩径增阻管道”，是指在输送线路上，通过人为缩小管径、增加局部阻力来消耗浆体多余能量的管段或装置，例如孔板、文丘里管、锥形缩径段或专门的消能短管。计算出后，即可代入下方基本消能公式，快速求得特定流量下浆体通过该装置时的水头损失（消能量）。这在设计泵送系统、控制管道末端流速与压力、防止管道汽蚀与磨损等方面至关重要。",
                "parameters": [
                    {"name": "lambda_d", "label": "$\\lambda_d$：沿程缩径增阻管道达西摩阻系数", "unit": "", "description": "沿程缩径增阻管道达西摩阻系数"},
                    {"name": "L_s", "label": "$L_s$：沿程缩径增阻管道长度，单位为 m", "unit": "m", "description": "沿程缩径增阻管道长度"},
                    {"name": "d", "label": "$d$：消能管径内径，单位为 m", "unit": "m", "description": "消能管内径"},
                    {"name": "Q", "label": "$Q$：浆体流量，单位为 m³/h", "unit": "m³/h", "description": "浆体流量"},
                    {"name": "K_QL", "label": "$K_{QL}$：流量消能系数（可直接输入，单位 h²/m⁵）", "unit": "h²/m⁵", "description": "可由步骤1计算或直接输入"}
                ]
            }
        ]
    }
    # 供前端识别：apiVersion 3 为 临界流速计算/沿程摩阻损失/浆体加速流及消能
    out = {"apiVersion": 3, **formulas}
    return jsonify(out)

@app.route('/api/calculate', methods=['POST'])
def calculate():
    """执行计算"""
    try:
        data = request.json
        formula_id = data.get('formula_id')
        parameters = data.get('parameters', {})
        locked_vc = data.get('locked_vc')  # 锁定的临界流速
        
        result = calculation_engine.calculate(formula_id, parameters)
        
        # 如果有锁定的临界流速，计算动画类型
        animation_type = None
        velocity_ratio = None
        if locked_vc is not None and result.get('Vc') is not None:
            new_vc = result.get('Vc')
            velocity_ratio = new_vc / locked_vc
            
            # 根据比例判断动画类型
            if velocity_ratio < 0.3:
                animation_type = 'settle-30'
            elif velocity_ratio < 0.6:
                animation_type = 'settle-20'
            elif velocity_ratio < 0.9:
                animation_type = 'settle-10-flow'
            elif velocity_ratio <= 1.1:
                animation_type = 'still-flow'
            elif velocity_ratio <= 1.5:
                animation_type = 'medium-flow'
            else:
                animation_type = 'fast-flow'
        
        return jsonify({
            "success": True,
            "result": result,
            "formula_id": formula_id,
            "parameters": parameters,
            "animation_type": animation_type,
            "velocity_ratio": velocity_ratio
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400

@app.route('/api/export', methods=['POST', 'OPTIONS'])
def export_word():
    """导出Word文档"""
    # 处理CORS预检请求
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response
    
    try:
        data = request.json
        if not data:
            return jsonify({
                "success": False,
                "error": "请求数据为空"
            }), 400
            
        formula_id = data.get('formula_id')
        parameters = data.get('parameters', {})
        result = data.get('result')
        formula_info = data.get('formula_info', {})
        save_path = data.get('save_path')  # 用户指定路径时（另存为），后端直接写入该路径并返回 JSON
        
        if not formula_id or not formula_info or not result:
            return jsonify({
                "success": False,
                "error": "缺少必要的数据：formula_id, formula_info 或 result"
            }), 400
        
        file_path = word_exporter.export(formula_id, formula_info, parameters, result, save_path=save_path)
        
        if save_path:
            # 已保存到用户指定路径，只返回成功
            return jsonify({"success": True, "path": file_path})
        
        download_name = os.path.basename(file_path)
        response = send_file(
            file_path,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        response.headers['Content-Disposition'] = f'attachment; filename="{download_name}"'
        return response
    except PermissionError as e:
        import traceback
        error_msg = f"文件权限错误: {str(e)}\n\n可能原因：\n1. 文件正在被其他程序（如Word）打开\n2. 目录没有写权限\n3. 文件被锁定\n\n请关闭可能打开该文件的程序后重试。"
        print(f"导出Word文档失败: {error_msg}\n{traceback.format_exc()}")
        response = jsonify({
            "success": False,
            "error": error_msg
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 400
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"导出Word文档失败: {error_msg}")
        response = jsonify({
            "success": False,
            "error": str(e)
        })
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response, 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    # 仅当设置 FLASK_DEBUG=1 时开启 debug，避免打包后仍以开发服务器运行
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='127.0.0.1', port=port, debug=debug, use_reloader=debug)
