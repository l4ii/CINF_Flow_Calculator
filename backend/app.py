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
                    {"name": "D", "label": "D：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "omega", "label": "$\\omega$：速度参数，单位为 m/s", "unit": "m/s", "description": "速度参数", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "omega_s", "label": "$\\omega_s$：沉降速度，单位为 m/s", "unit": "m/s", "description": "沉降速度", },
                    {"name": "g", "label": "g：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_9_5", "label": "经验系数：默认值 9.5（无量纲）", "unit": "", "description": "经验系数", "default": 9.5}
                ]
            },
            {
                "id": "wasp",
                "name": "E.J.瓦斯普公式",
                "formula": "Vc = 3.113 * Cv^0.1858 * [2*g*D*(Δρ/ρ)]^(1/2) * (d85/D)^(1/6)",
                "description": "本模型由E.J.Wasp等人提出，是国际上分析宽级配、非均质流临界流速的经典理论公式。其理论基础为两相流扩散模型，公式结构清晰体现了悬浮能量消耗与颗粒沉降间的平衡。它通过体积浓度（$C_v$）和相对密度差（$\\frac{\\Delta\\rho}{\\rho}$）来表征输送难度，并首次引入特征粒径（$d_{85}$）来量化粗颗粒对床层形成的影响。该公式特别适合粒径分布范围广、存在显著非均质输送特性的浆体。",
                "parameters": [
                    {"name": "D", "label": "D：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "d85", "label": "$d_{85}$：特征粒径，单位为 m", "unit": "m", "description": "d85特征粒径", },
                    {"name": "g", "label": "g：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_3_113", "label": "经验系数：默认值 3.113（无量纲）", "unit": "", "description": "经验系数", "default": 3.113}
                ]
            },
            {
                "id": "fei_xiangjun",
                "name": "费祥俊公式",
                "formula": "Vc = (2.26/√λ) * [gD*(Δρ/ρ)*ω]^(1/2) * Cv^0.25 * (d90/D)^(1/3)",
                "description": "本模型由费祥俊教授建立，其显著特点是首次将管道沿程阻力系数（$\\lambda$）引入临界流速的计算，在理论上将输送能耗与维持颗粒悬浮的能耗进行了统一。公式采用特征粒径（$d_{90}$）来表征浆体颗粒群的粗细程度，并对浆体浓度（$C_v$）影响的刻画较为显著。该公式在理论上更为全面，尤其适合于长距离输送管道的水力坡降与系统设计。应用时，需根据管道材质、内壁状况及流态等条件合理确定或计算沿程阻力系数（$\\lambda$），此参数对计算结果有重要影响。",
                "parameters": [
                    {"name": "D", "label": "D：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_g", "label": "$\\rho_g$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "rho_k", "label": "$\\rho_k$：载体液体密度，单位为 t/m³", "unit": "t/m³", "description": "载体液体密度", },
                    {"name": "Cv", "label": "$C_v$：体积浓度，单位为 decimal", "unit": "decimal", "description": "体积浓度", },
                    {"name": "omega", "label": "$\\omega$：速度参数，单位为 m/s", "unit": "m/s", "description": "速度参数", },
                    {"name": "d90", "label": "$d_{90}$：特征粒径，单位为 m", "unit": "m", "description": "d90特征粒径", },
                    {"name": "lambda_coef", "label": "$\\lambda$：达西摩阻系数，无量纲", "unit": "", "description": "摩擦阻力系数", },
                    {"name": "g", "label": "g：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81},
                    {"name": "coefficient_2_26", "label": "经验系数：默认值 2.26（无量纲）", "unit": "", "description": "经验系数", "default": 2.26}
                ]
            },
            {
                "id": "kronodze_pressure",
                "name": "B.C.克诺罗兹法",
                "formula": "A) Qk=K·W·(1/ρg+G/W)；B) 按dp求DL；C) V_L=0.255β(1+2.48·³√(Cd)·⁴√(DL))",
                "description": "A) 计算矿浆流量。其中：【输出结果】Qk 矿浆流量，单位为 m³/s；K 波动系数：默认值 1.1；【用户输入】G 干尾矿重量，单位为 t/h；$\\rho_g$ 尾矿相对密度，无量纲；W 矿浆中水重，单位为 t/h。B) 计算临界管径。当 dp≤0.07 mm 与 0.07<dp≤0.15 mm 分别采用不同公式，由 Qk 反解。【用户选择】dp 尾矿加权平均粒径，单位为 mm；$\\beta$ 固体物料相对密度修正系数：默认值 1；【输出结果】DL 临界管径，单位为 mm；Cd 重量砂水比 = G/W×100。C) 计算临界流速。【输出结果】V_L 临界流速，单位为 m/s。适用于有压隧洞泥沙运输、固体密度<3、粒径<0.4 mm 的浆体；体积浓度>30% 时偏差较大。",
                "parameters": [
                    {"name": "K", "label": "K：波动系数：默认值 1.1（无量纲）", "unit": "", "description": "波动系数", "default": 1.1},
                    {"name": "G", "label": "G：干尾矿重量，单位为 t/h", "unit": "t/h", "description": "干尾矿重量", },
                    {"name": "W", "label": "W：矿浆中水重，单位为 t/h", "unit": "t/h", "description": "矿浆中水重", },
                    {"name": "rho_g", "label": "$\\rho_g$：尾矿相对密度，无量纲", "unit": "", "description": "尾矿相对密度", },
                    {"name": "dp", "label": "dp：尾矿加权平均粒径，单位为 mm", "unit": "mm", "description": "尾矿加权平均粒径；≤0.07 与 0.07～0.15 对应不同公式", },
                    {"name": "beta", "label": "$\\beta$：固体物料相对密度修正系数：默认值 1（无量纲）", "unit": "", "description": "固体物料相对密度修正系数", "default": 1.0}
                ]
            }
        ],
        "沿程摩阻损失": [
            {
                "id": "darcy_friction",
                "name": "达西摩阻系数公式",
                "formula": "λ = 64/Re（层流）或 Colebrook-White（湍流）",
                "description": "达西摩阻系数 $\\lambda$ 反映管道阻力特性。层流时 $\\lambda = 64/Re$；湍流时可采用 Colebrook-White 公式或 Swamee-Jain 公式计算。本公式待完善实现。",
                "parameters": [
                    {"name": "Re", "label": "Re：雷诺数，无量纲", "unit": "", "description": "雷诺数", },
                    {"name": "epsilon", "label": "ε：管道当量粗糙度，单位为 m", "unit": "m", "description": "管道壁面粗糙度", "default": 0.0002},
                    {"name": "D", "label": "D：管道内径，单位为 m", "unit": "m", "description": "管道内径", }
                ]
            },
            {
                "id": "friction_loss",
                "name": "沿程摩阻损失",
                "formula": "i_k = λ·(V²·ρ_k)/(2gD·ρ_s)",
                "description": "本公式用于计算似均质流态下浆体管道的沿程摩阻损失，是管道水力坡降与泵送扬程设计的基础。公式中 $i_k$ 为浆体沿程摩阻损失（mH₂O/m），$\\lambda$ 为达西摩阻系数，$V$ 为管道平均流速，$\\rho_k$ 为浆体密度，$D$ 为管道内径，$\\rho_s$ 为固体颗粒密度，$g$ 为重力加速度。适用于可视为似均质流的浆体管道水力计算。",
                "parameters": [
                    {"name": "lambda_coef", "label": "$\\lambda$：达西摩阻系数，无量纲", "unit": "", "description": "达西摩阻系数", },
                    {"name": "V", "label": "V：平均流速，单位为 m/s", "unit": "m/s", "description": "管道内平均流速", },
                    {"name": "rho_k", "label": "$\\rho_k$：浆体密度，单位为 t/m³", "unit": "t/m³", "description": "浆体密度", },
                    {"name": "D", "label": "D：管道内径，单位为 m", "unit": "m", "description": "管道内径", },
                    {"name": "rho_s", "label": "$\\rho_s$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", },
                    {"name": "g", "label": "g：重力加速度，单位为 m/s²", "unit": "m/s²", "description": "重力加速度", "default": 9.81}
                ]
            },
            {
                "id": "density_mixing",
                "name": "密度混合公式",
                "formula": "ρ_k = 1/(C_w/ρ_g + (1-C_w)/ρ_s)",
                "description": "本公式根据固体与载体的质量浓度和密度计算浆体密度，用于浆体管道水力计算中的密度参数确定。公式中 $\\rho_k$ 为浆体密度，$C_w$ 为固体质量浓度（0～1 小数），$\\rho_g$ 为载体流体密度（如水的密度），$\\rho_s$ 为固体颗粒密度。已知固体与载体密度及质量浓度时，可直接求得浆体密度。",
                "parameters": [
                    {"name": "C_w", "label": "$C_w$：固体质量浓度，无量纲（0～1）", "unit": "", "description": "固体质量浓度", },
                    {"name": "rho_g", "label": "$\\rho_g$：载体流体密度，单位为 t/m³", "unit": "t/m³", "description": "载体流体密度", },
                    {"name": "rho_s", "label": "$\\rho_s$：固体颗粒密度，单位为 t/m³", "unit": "t/m³", "description": "固体颗粒密度", }
                ]
            }
        ],
        "浆体加速流及消能": [
            {
                "id": "slurry_accel_energy",
                "name": "浆体加速流及消能",
                "formula": "(Z₁ + P₁/(ρkg)) - (Z₂ + P₂/(ρkg)) > iL",
                "description": "浆体加速流及消能计算工具用于分析浆体在管道中流动时的能量平衡状态。基于水头平衡原理，比较浆体在流动过程中总机械能的差值（左侧）与沿程摩阻损失（右侧）的大小。若左侧 > 右侧，则满足加速流及消能条件；否则不满足。适用于管道输送、泵站设计、流体动力学分析等领域，用于评估浆体输送系统的运行状态和效率。",
                "parameters": [
                    {"name": "Z1", "label": "Z₁：起点位置水头，单位为 m", "unit": "m", "description": "浆体流动起点相对于基准面的垂直高度", },
                    {"name": "Z2", "label": "Z₂：终点位置水头，单位为 m", "unit": "m", "description": "浆体流动终点相对于基准面的垂直高度", },
                    {"name": "H1", "label": "H₁：起点压能浆体水头 P₁/(ρkg)，单位为 m", "unit": "m", "description": "起点压力能转换的水头高度", },
                    {"name": "H2", "label": "H₂：终点压能浆体水头 P₂/(ρkg)，单位为 m", "unit": "m", "description": "终点压力能转换的水头高度", },
                    {"name": "i", "label": "i：两点间沿程摩阻损失，单位为 m浆柱/m", "unit": "m浆柱/m", "description": "单位长度管道内的摩阻损失", },
                    {"name": "L", "label": "L：管道长度，单位为 m", "unit": "m", "description": "起点至终点的管道总长度", }
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
        
        # 验证必要数据
        if not formula_id or not formula_info or not result:
            return jsonify({
                "success": False,
                "error": "缺少必要的数据：formula_id, formula_info 或 result"
            }), 400
        
        file_path = word_exporter.export(formula_id, formula_info, parameters, result)
        
        # 从文件路径中提取文件名（包含序号）
        download_name = os.path.basename(file_path)
        
        response = send_file(
            file_path,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        
        # 添加CORS头
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        # 确保文件名正确编码
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
