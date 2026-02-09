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
    """获取所有可用的公式列表"""
    formulas = {
        "似均质流态": [
            {
                "id": "liu_dezhong",
                "name": "刘德忠公式",
                "formula": "Vc = 9.5 * [g*D*(Δρ/ρ)*ω]^(1/3) * Cv^(1/6) * (ω_s/ω)^(1/6)",
                "description": "本模型由刘德忠教授提出，是中国浆体管道设计中的主流经验公式之一。其核心思想基于浆体的整体沉降特性，通过引入加权平均沉速（$\\omega$）与静态界面沉速（$\\omega_s$）这两个关键实验参数，来综合反映固体颗粒群的干涉沉降行为。该公式尤其适用于细颗粒（如$d<2\\text{mm}$）含量较高、级配相对均匀的浆体，计算结果与中国工程实践贴合紧密。使用本公式的前提是需通过静态沉降柱试验获取可靠的$\\omega$与$\\omega_s$值。",
                "parameters": [
                    {"name": "D", "label": "管道内径", "unit": "m", "description": "管道内径，单位：米（m）"},
                    {"name": "rho_g", "label": "固体颗粒密度", "unit": "kg/m³", "description": "固体颗粒密度，单位：千克每立方米（kg/m³）"},
                    {"name": "rho_k", "label": "载体液体密度", "unit": "kg/m³", "description": "载体液体密度，单位：千克每立方米（kg/m³）"},
                    {"name": "omega", "label": "速度参数", "unit": "m/s", "description": "速度参数ω，单位：米每秒（m/s）"},
                    {"name": "Cv", "label": "体积浓度", "unit": "decimal", "description": "体积浓度Cv，单位：小数（decimal）"},
                    {"name": "omega_s", "label": "沉降速度", "unit": "m/s", "description": "沉降速度ω_s，单位：米每秒（m/s）"},
                    {"name": "g", "label": "重力加速度", "unit": "m/s²", "description": "重力加速度，默认值9.81，单位：米每秒平方（m/s²）", "default": 9.81},
                    {"name": "coefficient_9_5", "label": "经验系数", "unit": "", "description": "经验系数，默认值9.5", "default": 9.5}
                ]
            },
            {
                "id": "wasp",
                "name": "E.J.瓦斯普公式",
                "formula": "Vc = 3.113 * Cv^0.1858 * [2*g*D*(Δρ/ρ)]^(1/2) * (d85/D)^(1/6)",
                "description": "本模型由E.J.Wasp等人提出，是国际上分析宽级配、非均质流临界流速的经典理论公式。其理论基础为两相流扩散模型，公式结构清晰体现了悬浮能量消耗与颗粒沉降间的平衡。它通过体积浓度（$C_v$）和相对密度差（$\\frac{\\Delta\\rho}{\\rho}$）来表征输送难度，并首次引入特征粒径（$d_{85}$）来量化粗颗粒对床层形成的影响。该公式特别适合粒径分布范围广、存在显著非均质输送特性的浆体。",
                "parameters": [
                    {"name": "D", "label": "管道内径", "unit": "m", "description": "管道内径，单位：米（m）"},
                    {"name": "rho_g", "label": "固体颗粒密度", "unit": "kg/m³", "description": "固体颗粒密度，单位：千克每立方米（kg/m³）"},
                    {"name": "rho_k", "label": "载体液体密度", "unit": "kg/m³", "description": "载体液体密度，单位：千克每立方米（kg/m³）"},
                    {"name": "Cv", "label": "体积浓度", "unit": "decimal", "description": "体积浓度Cv，单位：小数（decimal）"},
                    {"name": "d85", "label": "d85粒径", "unit": "m", "description": "d85特征粒径，单位：米（m）"},
                    {"name": "g", "label": "重力加速度", "unit": "m/s²", "description": "重力加速度，默认值9.81，单位：米每秒平方（m/s²）", "default": 9.81},
                    {"name": "coefficient_3_113", "label": "经验系数", "unit": "", "description": "经验系数，默认值3.113", "default": 3.113}
                ]
            },
            {
                "id": "fei_xiangjun",
                "name": "费祥俊公式",
                "formula": "Vc = (2.26/√λ) * [gD*(Δρ/ρ)*ω]^(1/2) * Cv^0.25 * (d90/D)^(1/3)",
                "description": "本模型由费祥俊教授建立，其显著特点是首次将管道沿程阻力系数（$\\lambda$）引入临界流速的计算，在理论上将输送能耗与维持颗粒悬浮的能耗进行了统一。公式采用特征粒径（$d_{90}$）来表征浆体颗粒群的粗细程度，并对浆体浓度（$C_v$）影响的刻画较为显著。该公式在理论上更为全面，尤其适合于长距离输送管道的水力坡降与系统设计。应用时，需根据管道材质、内壁状况及流态等条件合理确定或计算沿程阻力系数（$\\lambda$），此参数对计算结果有重要影响。",
                "parameters": [
                    {"name": "D", "label": "管道内径", "unit": "m", "description": "管道内径，单位：米（m）"},
                    {"name": "rho_g", "label": "固体颗粒密度", "unit": "kg/m³", "description": "固体颗粒密度，单位：千克每立方米（kg/m³）"},
                    {"name": "rho_k", "label": "载体液体密度", "unit": "kg/m³", "description": "载体液体密度，单位：千克每立方米（kg/m³）"},
                    {"name": "Cv", "label": "体积浓度", "unit": "decimal", "description": "体积浓度Cv，单位：小数（decimal）"},
                    {"name": "omega", "label": "速度参数", "unit": "m/s", "description": "速度参数omega，单位：米每秒（m/s）"},
                    {"name": "d90", "label": "d90粒径", "unit": "m", "description": "d90特征粒径，单位：米（m）"},
                    {"name": "lambda_coef", "label": "λ系数", "unit": "", "description": "摩擦阻力系数lambda，无量纲"},
                    {"name": "g", "label": "重力加速度", "unit": "m/s²", "description": "重力加速度，默认值9.81，单位：米每秒平方（m/s²）", "default": 9.81},
                    {"name": "coefficient_2_26", "label": "经验系数", "unit": "", "description": "经验系数，默认值2.26", "default": 2.26}
                ]
            }
        ],
        "非均质流态": [
            {
                "id": "kronodze_pressure",
                "name": "B.C.克诺罗兹法（压力流）",
                "formula": "Vc = C * sqrt(gD * (ps - pl)/pl)",
                "description": "B.C.克诺罗兹法适用于压力流条件下的非均质流态计算。该方法考虑了颗粒在管道中的分布特性，通过克诺罗兹系数（$C$）和相对密度差（$\\frac{p_s-p_l}{p_l}$）来表征输送特性，适用于大颗粒、低浓度的浆体输送。",
                "parameters": [
                    {"name": "D", "label": "管道内径", "unit": "m", "description": "管道内径，单位：米（m）"},
                    {"name": "ps", "label": "固体颗粒真实密度", "unit": "kg/m³", "description": "固体颗粒密度，单位：千克每立方米（kg/m³）"},
                    {"name": "pl", "label": "载体液体密度", "unit": "kg/m³", "description": "载体液体密度，单位：千克每立方米（kg/m³）"},
                    {"name": "C", "label": "克诺罗兹系数", "unit": "", "description": "克诺罗兹系数，无量纲"},
                    {"name": "g", "label": "重力加速度", "unit": "m/s²", "description": "重力加速度，默认值9.81，单位：米每秒平方（m/s²）", "default": 9.81}
                ]
            },
            {
                "id": "kronodze_gravity",
                "name": "B.C.克诺罗兹法（重力流）",
                "formula": "Vc = Cg * sqrt(gD * (ps - pl)/pl * sin(θ))",
                "description": "B.C.克诺罗兹法适用于重力流条件下的非均质流态计算。该方法考虑了管道倾角（$\\theta$）对临界流速的影响，通过重力流系数（$C_g$）和相对密度差（$\\frac{p_s-p_l}{p_l}$）来表征输送特性，适用于倾斜管道中的浆体输送。",
                "parameters": [
                    {"name": "D", "label": "管道内径", "unit": "m", "description": "管道内径，单位：米（m）"},
                    {"name": "ps", "label": "固体颗粒真实密度", "unit": "kg/m³", "description": "固体颗粒密度，单位：千克每立方米（kg/m³）"},
                    {"name": "pl", "label": "载体液体密度", "unit": "kg/m³", "description": "载体液体密度，单位：千克每立方米（kg/m³）"},
                    {"name": "Cg", "label": "重力流系数", "unit": "", "description": "重力流系数，无量纲"},
                    {"name": "theta", "label": "管道倾角", "unit": "度", "description": "管道倾角theta，单位：度"},
                    {"name": "g", "label": "重力加速度", "unit": "m/s²", "description": "重力加速度，默认值9.81，单位：米每秒平方（m/s²）", "default": 9.81}
                ]
            }
        ]
    }
    return jsonify(formulas)

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
        
        # 生成文件名
        timestamp = datetime.now().strftime("%Y%m%d")
        formula_name = formula_info.get("name", "unknown").replace(' ', '').replace('/', '_')
        download_name = f'长沙院浆体计算_{formula_name}_{timestamp}.docx'
        
        response = send_file(
            file_path,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        
        # 添加CORS头
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        
        return response
    except Exception as e:
        import traceback
        error_msg = f"{str(e)}\n{traceback.format_exc()}"
        print(f"导出Word文档失败: {error_msg}")
        response = jsonify({
            "success": False,
            "error": str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response, 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='127.0.0.1', port=port, debug=True)
