# -*- coding: utf-8 -*-
"""
计算书导出：纯 python-docx 生成 Word，不依赖 Pandoc。
公式与含 LaTeX 的说明在文档中转为易读 Unicode/普通文本，可在 Word 内用公式编辑器再排版。
"""
from datetime import datetime
import json
import os
import re
import tempfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from export_markdown import program_formula_to_latex


def _matplotlib_stack_for_export():
    """非交互后端 (Agg) 下的 pyplot 与 rcParams；未安装 matplotlib 时抛出 ImportError。"""
    import matplotlib as _mpl  # pyright: ignore[reportMissingImports]
    _mpl.use("Agg")
    import matplotlib.pyplot as _plt  # pyright: ignore[reportMissingImports]
    return _plt, _mpl.rcParams


class WordExporter:
    """Word 文档导出器（python-docx，无外部转换依赖）"""
    
    # 类变量：存储每天的导出次数 {日期字符串: 次数}
    _daily_export_count = {}
    _current_date = None
    
    def __init__(self):
        # 获取当前文件所在目录（backend目录）
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # 获取项目根目录（backend的父目录）
        project_root = os.path.dirname(current_dir)
        # exports目录放在项目根目录
        self.output_dir = os.path.join(project_root, "exports")
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)

    def _tex_ish_to_plain(self, s: str) -> str:
        """将 API 中带 $…$、\\rho 等的字符串转为 Word 中易读的 Unicode 文本（非 OMML 公式对象）。"""
        if s is None:
            return ""
        t = str(s)
        t = re.sub(r"\\text\{([^}]*)\}", r"\1", t)
        t = t.replace("\\quad", " ").replace("\\,", " ")
        seq = [
            ("\\omega_s", "ωs"),
            ("\\rho_w", "ρw"),
            ("\\rho_k", "ρk"),
            ("\\rho_g", "ρg"),
            ("\\rho_s", "ρs"),
            ("\\Delta", "Δ"),
            ("\\omega", "ω"),
            ("\\lambda", "λ"),
            ("\\varepsilon", "ε"),
            ("\\cdot", "·"),
            ("\\times", "×"),
            ("\\approx", "≈"),
            ("\\mathrm", ""),
            ("\\text", ""),
        ]
        for a, b in seq:
            t = t.replace(a, b)
        t = re.sub(r"\\frac\{([^}]*)\}\{([^}]*)\}", r"(\1)/(\2)", t)
        t = t.replace("$", "")
        t = re.sub(r"[{}]", "", t)
        t = t.replace("\\", "")
        return re.sub(r"\s+", " ", t).strip()

    def _get_app_title_version(self):
        title = (os.environ.get("FLOW_CALC_APP_TITLE") or "").strip()
        version = (os.environ.get("FLOW_CALC_APP_VERSION") or "").strip()
        if title and version:
            return title, version
        here = os.path.dirname(os.path.abspath(__file__))
        for rel in ("..", os.path.join("..", "..")):
            pkg_path = os.path.normpath(os.path.join(here, rel, "package.json"))
            if not os.path.isfile(pkg_path):
                continue
            try:
                with open(pkg_path, encoding="utf-8") as f:
                    data = json.load(f)
                t = (data.get("description") or data.get("name") or "").strip()
                v = (data.get("version") or "").strip()
                if t and v:
                    return t, v
                if v:
                    return t or "长沙院浆体管道计算工具", v
            except (OSError, json.JSONDecodeError):
                continue
        return "长沙院浆体管道计算工具", version or "—"

    def _apply_docx_header_to_document(self, doc: Document) -> None:
        title, ver = self._get_app_title_version()
        line = f"{title}　　版本 {ver}"
        for section in doc.sections:
            hdr = section.header
            hp = hdr.paragraphs[0] if hdr.paragraphs else hdr.add_paragraph()
            hp.text = line
            hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in hp.runs:
                run.font.size = Pt(9)
                run.font.name = "宋体"
                try:
                    run.font._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
                except (AttributeError, TypeError):
                    pass

    def _get_export_count(self):
        """获取当天的导出次数并递增"""
        today = datetime.now().strftime("%Y%m%d")
        
        # 如果是新的一天，重置计数器
        if WordExporter._current_date != today:
            WordExporter._current_date = today
            WordExporter._daily_export_count[today] = 0
        
        # 递增计数器
        WordExporter._daily_export_count[today] += 1
        return WordExporter._daily_export_count[today]
    
    def export(self, formula_id, formula_info, parameters, result, save_path=None):
        """导出计算书到Word文档。save_path 为 None 时保存到 exports 目录；否则保存到用户指定路径。"""
        try:
            doc = Document()
            
            # 设置文档样式
            self._setup_document_style(doc)
            
            # 添加软件介绍
            self._add_software_intro(doc)
            
            # 添加标题
            title = doc.add_heading('浆体管道临界流速计算书', 0)
            title.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # 添加基本信息
            self._add_basic_info(doc, formula_info)
            
            # 添加计算公式（带数学公式格式）
            self._add_formula_section(doc, formula_info)
            
            # 添加输入参数
            self._add_parameters_section(doc, parameters, formula_info)
            
            # 添加中间结果
            self._add_intermediate_results(doc, result)
            
            # 添加最终结果（需 formula_id 区分 Vc/i_k/rho_k）
            self._add_result_section(doc, result, formula_id)
            
            # 添加计算过程
            self._add_calculation_process(doc, formula_id, formula_info, parameters, result)
            
            # 添加软件推广信息
            self._add_software_promotion(doc)

            self._apply_docx_header_to_document(doc)

            if save_path:
                # 用户指定路径（另存为）：直接保存到该路径
                save_path = os.path.abspath(save_path)
                parent = os.path.dirname(save_path)
                if parent and not os.path.exists(parent):
                    os.makedirs(parent, exist_ok=True)
                doc.save(save_path)
                return save_path
            
            # 保存到 exports 目录（兼容旧逻辑）
            timestamp = datetime.now().strftime("%Y%m%d")
            formula_name = formula_info.get('name', 'unknown').replace(' ', '').replace('/', '_')
            export_count = self._get_export_count()
            filename = f"长沙院浆体计算_{formula_name}_{timestamp}_{export_count:03d}.docx"
            file_path = os.path.join(self.output_dir, filename)
            
            # 如果文件已存在，尝试删除或重命名
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except PermissionError:
                    # 如果无法删除（可能被打开），尝试使用带时间戳的文件名
                    import time
                    timestamp_ms = int(time.time() * 1000) % 10000
                    filename = f"长沙院浆体计算_{formula_name}_{timestamp}_{export_count:03d}_{timestamp_ms}.docx"
                    file_path = os.path.join(self.output_dir, filename)
            
            # 确保目录存在且有写权限
            if not os.path.exists(self.output_dir):
                os.makedirs(self.output_dir, exist_ok=True)
            
            # 保存文件，如果失败则重试
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    doc.save(file_path)
                    break
                except PermissionError as e:
                    if attempt < max_retries - 1:
                        # 如果文件被占用，尝试使用不同的文件名
                        import time
                        timestamp_ms = int(time.time() * 1000) % 10000
                        filename = f"长沙院浆体计算_{formula_name}_{timestamp}_{export_count:03d}_{timestamp_ms}.docx"
                        file_path = os.path.join(self.output_dir, filename)
                        time.sleep(0.5)  # 等待0.5秒后重试
                    else:
                        raise Exception(f"无法保存文件，可能文件正在被其他程序打开: {file_path}")
            
            return file_path
        except Exception as e:
            import traceback
            error_msg = f"导出Word文档时出错: {str(e)}\n{traceback.format_exc()}"
            print(error_msg)
            raise Exception(f"导出失败: {str(e)}")
    
    def _setup_document_style(self, doc):
        """设置文档样式"""
        style = doc.styles['Normal']
        font = style.font
        # 设置西文字体为Times New Roman，中文字体为仿宋
        font.name = 'Times New Roman'
        font._element.set(qn('w:eastAsia'), '仿宋')
        font.size = Pt(12)
    
    def _set_font(self, run, chinese_font='仿宋', english_font='Times New Roman'):
        """设置run的字体：中文用指定中文字体，英文用指定英文字体"""
        run.font.name = english_font
        # 设置中文字体（eastAsia）
        run.font._element.set(qn('w:eastAsia'), chinese_font)
    
    def _add_software_intro(self, doc):
        """添加软件说明（封面式引言）"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title_run = p.add_run("长沙院浆体管道水力计算工具")
        title_run.bold = True
        title_run.font.size = Pt(16)
        self._set_font(title_run)

        doc.add_paragraph()
        intro_p = doc.add_paragraph()
        intro_run = intro_p.add_run(
            "本计算书由长沙有色冶金设计研究院有限公司开发的浆体管道水力计算工具自动生成，"
            "面向浆体与清水管道输送中的临界流速、摩阻与扬程等工程计算，便于校核与归档。"
        )
        self._set_font(intro_run)
        intro_p.paragraph_format.first_line_indent = Pt(24)

        doc.add_paragraph()
        features_p = doc.add_paragraph()
        features_run = features_p.add_run("主要能力：")
        features_run.bold = True
        self._set_font(features_run)
        features_list = [
            "多种临界流速经验公式与浆体密度、摩阻系数等配套计算",
            "浆体总扬程、清水总扬程及 P–L 特性曲线示意（需 matplotlib）",
            "中间量与分步推演写入同一文档，便于审查",
            "公式与符号在 Word 中以可读 Unicode/文本呈现，可在 Word 内用公式编辑器进一步排版",
        ]
        for feature in features_list:
            bp = doc.add_paragraph(feature, style="List Bullet")
            for run in bp.runs:
                self._set_font(run)
            bp.paragraph_format.left_indent = Pt(24)
        doc.add_paragraph()
    
    def _add_basic_info(self, doc, formula_info):
        """添加计算概况"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("一、计算概况")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)

        info_table = doc.add_table(rows=2, cols=2)
        info_table.style = "Light Grid Accent 1"

        info_table.cell(0, 0).text = "条目"
        info_table.cell(0, 1).text = "说明"
        for cell in info_table.rows[0].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
        
        info_table.cell(1, 0).text = "所选计算模块"
        info_table.cell(1, 1).text = formula_info.get("name", "未知公式")
        for cell in info_table.rows[1].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)

        row_calc = info_table.add_row()
        row_calc.cells[0].text = "导出时间"
        row_calc.cells[1].text = datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
        for cell in row_calc.cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
    
    def _add_formula_section(self, doc, formula_info):
        """添加计算公式（程序式 → 可读文本）与说明"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("二、计算公式与说明")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)

        formula_name_p = doc.add_paragraph()
        formula_name_run = formula_name_p.add_run(f"模块名称：{formula_info.get('name', '未知')}")
        formula_name_run.bold = True
        self._set_font(formula_name_run)

        doc.add_paragraph()
        raw = formula_info.get("formula") or ""
        latex_frag = (formula_info.get("formula_latex") or "").strip() or program_formula_to_latex(raw)
        formula_display = self._tex_ish_to_plain(f"${latex_frag}$") if latex_frag else str(raw)

        formula_p = doc.add_paragraph()
        formula_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        formula_run = formula_p.add_run(formula_display)
        formula_run.font.size = Pt(14)
        formula_run.font.name = "Times New Roman"
        self._set_font(formula_run)

        desc = formula_info.get("description")
        if desc:
            doc.add_paragraph()
            for block in str(desc).split("\n\n"):
                block = block.strip()
                if not block:
                    continue
                desc_p = doc.add_paragraph(self._tex_ish_to_plain(block))
                for run in desc_p.runs:
                    self._set_font(run)
                desc_p.paragraph_format.first_line_indent = Pt(24)
    
    def _insert_math_formula(self, paragraph, formula):
        """使用OMML格式插入Word数学公式"""
        # 将公式转换为OMML格式
        omml_xml = self._convert_to_omml(formula)
        try:
            omml_element = parse_xml(omml_xml)
            paragraph._p.append(omml_element)
        except Exception as e:
            # 如果OMML插入失败，回退到文本格式
            print(f"插入数学公式失败，使用文本格式: {e}")
            formula_run = paragraph.add_run(formula)
            formula_run.font.size = Pt(14)
            formula_run.font.name = 'Cambria Math'
            self._set_font(formula_run)
    
    def _convert_to_omml(self, formula):
        """将公式字符串转换为OMML XML格式"""
        # 解析公式并转换为OMML格式
        # 这是一个简化的转换，可以根据样本文档进一步优化
        
        # 处理变量下标：Vc -> V_c, Cv -> C_v, d85 -> d_85, d90 -> d_90
        formula = re.sub(r'Vc', 'V_c', formula)
        formula = re.sub(r'Cv', 'C_v', formula)
        formula = re.sub(r'd85', 'd_85', formula)
        formula = re.sub(r'd90', 'd_90', formula)
        formula = re.sub(r'ω_s', 'ω_s', formula)
        formula = re.sub(r'rho_g', 'ρ_g', formula)
        formula = re.sub(r'rho_k', 'ρ_k', formula)
        
        # 构建OMML XML
        # 这里先创建一个基本的OMML结构，具体格式可以根据样本文档调整
        omml_parts = []
        
        # 分割公式为各个部分
        parts = re.split(r'(\s*=\s*|\s*\*\s*|\s*\[\s*|\s*\]\s*|\s*\(\s*|\s*\)\s*|\s*\^\s*|\s*/\s*)', formula)
        
        omml_xml = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
        
        # 简化处理：先使用文本格式，等样本文档后再优化
        # 将公式转换为Unicode数学符号格式
        formula_display = formula.replace('*', '·').replace('^', '^')
        
        # 创建文本run
        omml_xml += '<m:r><m:t xml:space="preserve">' + self._escape_xml(formula_display) + '</m:t></m:r>'
        
        omml_xml += '</m:oMath>'
        
        return omml_xml
    
    def _escape_xml(self, text):
        """转义XML特殊字符"""
        return (text.replace('&', '&amp;')
                   .replace('<', '&lt;')
                   .replace('>', '&gt;')
                   .replace('"', '&quot;')
                   .replace("'", '&apos;'))
    
    def _add_parameters_section(self, doc, parameters, formula_info):
        """添加输入条件与参数"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("三、输入条件与参数")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        # 获取公式的参数定义
        formula_params = formula_info.get('parameters', [])
        
        # 创建参数表格
        valid_params = {k: v for k, v in parameters.items() 
                       if k != 'g' or v != 9.81}  # 排除默认的重力加速度
        
        # 计算实际需要的行数（公式中定义的参数 + 其他参数）
        formula_param_names = {p.get('name') for p in formula_params}
        formula_params_count = sum(1 for name in formula_param_names if name in valid_params)
        other_params_count = sum(1 for name in valid_params.keys() if name not in formula_param_names)
        total_rows = formula_params_count + other_params_count
        
        if total_rows == 0:
            no_params_p = doc.add_paragraph('无输入参数')
            for run in no_params_p.runs:
                self._set_font(run)
            return
        
        param_table = doc.add_table(rows=total_rows + 1, cols=3)
        param_table.style = 'Light Grid Accent 1'
        
        header_cells = param_table.rows[0].cells
        header_cells[0].text = "参数（符号及含义）"
        header_cells[1].text = "取值"
        header_cells[2].text = "单位"
        
        # 设置表头样式
        for cell in header_cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True
                    self._set_font(run)
                    self._set_font(run)
        
        # 填充参数（按公式定义的顺序）
        row = 1
        # 先添加公式中定义的参数
        for param_def in formula_params:
            param_name = param_def.get('name')
            if param_name in valid_params:
                if row >= len(param_table.rows):
                    break
                param_table.cell(row, 0).text = self._tex_ish_to_plain(
                    param_def.get("label", param_name)
                )
                value = valid_params[param_name]
                if isinstance(value, (int, float)):
                    param_table.cell(row, 1).text = f"{value:.6f}".rstrip('0').rstrip('.')
                else:
                    param_table.cell(row, 1).text = str(value)
                param_table.cell(row, 2).text = param_def.get('unit', self._get_unit(param_name))
                # 设置该行所有单元格的字体
                for cell in param_table.rows[row].cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            self._set_font(run)
                row += 1
        
        # 添加其他参数（如果有）
        for key, value in valid_params.items():
            if key not in formula_param_names:
                if row >= len(param_table.rows):
                    break
                param_table.cell(row, 0).text = key
                if isinstance(value, (int, float)):
                    param_table.cell(row, 1).text = f"{value:.6f}".rstrip('0').rstrip('.')
                else:
                    param_table.cell(row, 1).text = str(value)
                param_table.cell(row, 2).text = self._get_unit(key)
                # 设置该行所有单元格的字体
                for cell in param_table.rows[row].cells:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs:
                            self._set_font(run)
                row += 1
    
    def _add_intermediate_results(self, doc, result):
        """添加中间结果部分"""
        intermediate = result.get('intermediate', {})
        if not intermediate:
            return
        
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("四、中间计算量")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        # 创建中间结果表格
        intermediate_table = doc.add_table(rows=len(intermediate) + 1, cols=2)
        intermediate_table.style = 'Light Grid Accent 1'
        
        # 表头
        header_cells = intermediate_table.rows[0].cells
        header_cells[0].text = "项目"
        header_cells[1].text = "数值"
        for cell in header_cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True
                    self._set_font(run)
        
        # 填充中间结果
        row = 1
        for key, value in intermediate.items():
            # 格式化键名（转换为中文标签）
            label = self._get_intermediate_label(key)
            intermediate_table.cell(row, 0).text = label
            
            # 格式化数值
            if isinstance(value, (int, float)):
                if abs(value) < 0.001:
                    value_str = f"{value:.6e}"
                elif abs(value) < 1:
                    value_str = f"{value:.6f}".rstrip('0').rstrip('.')
                else:
                    value_str = f"{value:.4f}".rstrip('0').rstrip('.')
            else:
                value_str = str(value)
            
            intermediate_table.cell(row, 1).text = value_str
            # 设置该行所有单元格的字体
            for cell in intermediate_table.rows[row].cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        self._set_font(run)
            row += 1
    
    def _get_intermediate_label(self, key):
        """获取中间计算项的中文标签"""
        labels = {
            'delta_rho_ratio': '相对密度差 Δρ/ρ',
            'density_ratio': '密度比 (ps-pl)/pl',
            'core_term': '核心项 [g·D·(Δρ/ρ)·ω]^(1/3)',
            'concentration_term': '浓度修正项 Cv^(1/6)',
            'velocity_ratio_term': '速度比修正项 (ω_s/ω)^(1/6)',
            'bracket_term': '核心项 [2·g·D·(Δρ/ρ)]^(1/2)',
            'size_ratio_term': '粒径比修正项 (d85/D)^(1/6)',
            'conc_term': '浓度修正项 Cv^0.25',
            'size_term': '粒径比修正项 (d90/D)^(1/3)',
            'leading_coef': '核心系数 2.26/√λ',
            'sqrt_term': '平方根项',
            'sin_theta': 'sin(θ)',
            'coefficient': '经验系数',
            'coefficient_9_5': '经验系数 9.5',
            'coefficient_3_113': '经验系数 3.113',
            'coefficient_2_26': '经验系数 2.26',
            'g': '重力加速度 g',
            # 沿程摩阻损失（4.3.1-1）
            'numerator': '流速平方与浆体密度项 V²·ρ_k',
            'denominator': '重力与管径项 2gD·ρ_s',
            # 密度混合公式（4.3.1-2）
            'denom': '浓度与密度加权倒数项 C_w/ρ_g+(1-C_w)/ρ_s',
            # B.C.克诺罗兹法
            'step_A_Qk': '步骤A 矿浆流量 Qk',
            'step_B_DL_mm': '步骤B 临界管径 DL (mm)',
            'Cd': '重量砂水比 Cd',
            'step_C_V_L': '步骤C 临界流速 V_L',
            # 达西摩阻系数公式
            'Re': '雷诺数 Re',
            'flow_regime': '流态',
            'eps_D': '相对粗糙度 ε/D',
            # 浆体加速流及消能
            'head_diff': '左侧总水头差 (Z₁+H₁)-(Z₂+H₂)',
            'friction_loss_total': '右侧摩阻损失 iL',
            "step_1_kql": "步骤1 流量消能系数 K_QL",
            "step_2_delta_h": "步骤2 消能水头 Δh",
            "kql_numerator": "K_QL 分子项 (6.3755×10⁻⁹)·λ_d·L_s",
            "kql_denominator_d5": "K_QL 分母项 d⁵",
            "Q_squared": "Q²",
            "gravity_pressure": "重力势能压力项",
            "friction_pressure": "沿程摩擦压力项",
            "orifice_step": "孔板计算子步序号",
            "orifice_numer": "K_Qk 分子项 (1-β²)(1.142-β²)",
            "orifice_beta": "步骤1 孔径比 β",
            "orifice_K_Qk_step2": "步骤2 孔板流量消能系数 K_Qk",
        }
        return labels.get(key, key)
    
    def _add_result_section(self, doc, result, formula_id=None):
        """添加最终结果部分。根据 formula_id 显示 Vc（临界流速）、i_k（沿程摩阻损失）或 rho_k（浆体密度）"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("五、计算成果")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        result_table = doc.add_table(rows=3, cols=2)
        result_table.style = 'Light Grid Accent 1'
        
        # 设置表头样式
        header_cells = result_table.rows[0].cells
        header_cells[0].text = '项目'
        header_cells[1].text = '结果'
        for cell in header_cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True
                    self._set_font(run)
        
        # 根据公式类型显示对应结果
        if formula_id == 'friction_loss':
            item_label = '沿程摩阻损失 i_k'
            value = result.get('i_k', 'N/A')
        elif formula_id == 'density_mixing':
            item_label = '浆体密度 ρ_k'
            value = result.get('rho_k', 'N/A')
        elif formula_id == 'darcy_friction':
            item_label = '达西摩阻系数'
            rho_1 = result.get('rho_1', 'N/A')
            Re_B = result.get('Re_B', 'N/A')
            lam = result.get('lambda_coef', 'N/A')
            flow_regime = result.get('intermediate', {}).get('flow_regime', '')
            value = f"ρ₁={rho_1} t/m³，ReB={Re_B}，λ={lam}" + (f"（{flow_regime}）" if flow_regime else "")
        elif formula_id == 'slurry_accel_energy':
            item_label = '浆体加速流条件'
            value = '满足' if result.get('condition_met') else '不满足'
        elif formula_id in ('slurry_dissipation', 'slurry_energy_dissipation'):
            item_label = '浆体消能水头 Δh'
            delta_h = result.get('delta_h', result.get('intermediate', {}).get('step_2_delta_h', 'N/A'))
            kql = result.get('K_QL', result.get('intermediate', {}).get('step_1_kql', 'N/A'))
            value = f"Δh = {delta_h} m，K_QL = {kql} h²/m⁵"
        elif formula_id == 'slurry_dissipation_orifice':
            item_label = '孔板消能水头 Δh'
            delta_h = result.get('delta_h', 'N/A')
            value = f"Δh = {delta_h} m（K_Qk、Q 见第三节输入参数表）"
        elif formula_id == 'slurry_friction_loss':
            item_label = '浆体摩阻损失'
            rho_k = result.get('rho_k', 'N/A')
            i_k = result.get('i_k', 'N/A')
            value = f"ρ_k = {rho_k} t/m³，i_k = {i_k} mH₂O/m"
        elif formula_id == 'slurry_friction_workflow':
            item_label = '浆体摩阻损失（分步）'
            rho_k = result.get('rho_k', 'N/A')
            i_k = result.get('i_k', 'N/A')
            value = f"ρ_k = {rho_k} t/m³，i_k = {i_k} mH₂O/m"
        elif formula_id == 'slurry_total_head':
            item_label = '浆体管道输送压力 Pk'
            value = result.get('H_total', 'N/A')
            unit_suffix = 'kPa'
        elif formula_id == 'clear_water_total_head':
            item_label = '清水管道输送压力 Pw'
            value = result.get('H_total', 'N/A')
            unit_suffix = 'kPa'
        elif formula_id == 'clear_water_friction_loss':
            item_label = '单位长度水头损失 i'
            i_val = result.get('i', 'N/A')
            if isinstance(i_val, (int, float)):
                value = f"{i_val} kPa/m"
            else:
                value = str(i_val)
        else:
            item_label = '临界流速 Vc'
            value = result.get('Vc', 'N/A')
        
        if isinstance(value, (int, float)):
            value_display = f"{value:.4f}".rstrip('0').rstrip('.')
        else:
            value_display = str(value)
        
        result_table.cell(1, 0).text = item_label
        unit_suffix = result.get('unit', '')
        # slurry_friction_loss、darcy_friction 的 value 已包含单位，不再追加
        if formula_id in ('slurry_friction_loss', 'slurry_friction_workflow', 'darcy_friction', 'slurry_dissipation', 'slurry_energy_dissipation', 'slurry_dissipation_orifice', 'slurry_total_head', 'clear_water_total_head', 'clear_water_friction_loss'):
            result_table.cell(1, 1).text = value_display
        else:
            result_table.cell(1, 1).text = f"{value_display} {unit_suffix}".strip() if unit_suffix else value_display
        # 设置该行所有单元格的字体
        for cell in result_table.rows[1].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
        
        # 备注
        result_table.cell(2, 0).text = "备注"
        result_table.cell(2, 1).text = (
            "本表数值由当前输入与所选公式按程序逻辑计算得出，用于设计辅助与资料整理；"
            "实施阶段请结合现场条件、规范及专业判断复核。"
        )
        # 设置该行所有单元格的字体
        for cell in result_table.rows[2].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
    
    def _add_calculation_process(self, doc, formula_id, formula_info, parameters, result):
        """添加计算过程"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run("六、计算过程推演")
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)

        intro = doc.add_paragraph(
            "以下按本模块常用书写顺序列出主要代入关系与中间量，与上方「中间计算量」表中的键值一致。"
        )
        for run in intro.runs:
            self._set_font(run)
        intro.paragraph_format.first_line_indent = Pt(24)

        # 根据公式ID添加详细计算步骤
        if formula_id == "liu_dezhong":
            self._add_liu_dezhong_process(doc, parameters, result)
        elif formula_id == "wasp":
            self._add_wasp_process(doc, parameters, result)
        elif formula_id == "fei_xiangjun":
            self._add_fei_xiangjun_process(doc, parameters, result)
        elif formula_id == "kronodze_pressure":
            self._add_kronodze_pressure_process(doc, parameters, result)
        elif formula_id == "friction_loss":
            self._add_friction_loss_process(doc, parameters, result)
        elif formula_id == "density_mixing":
            self._add_density_mixing_process(doc, parameters, result)
        elif formula_id == "darcy_friction":
            self._add_darcy_friction_process(doc, parameters, result)
        elif formula_id == "slurry_accel_energy":
            self._add_slurry_accel_energy_process(doc, parameters, result)
        elif formula_id in ("slurry_dissipation", "slurry_energy_dissipation"):
            self._add_slurry_dissipation_process(doc, parameters, result)
        elif formula_id == "slurry_dissipation_orifice":
            self._add_slurry_dissipation_orifice_process(doc, parameters, result)
        elif formula_id == "slurry_friction_loss":
            self._add_slurry_friction_loss_process(doc, parameters, result)
        elif formula_id == "slurry_friction_workflow":
            intro_wf = doc.add_paragraph(
                "以下对应界面内分步完成的浆体摩阻流程：浆体当量密度 ρ_k、混合物密度 ρ₁、雷诺数 Re_B、达西系数 λ 与沿程水力坡降 i_k；主要代入关系见本节。"
            )
            for run in intro_wf.runs:
                self._set_font(run)
            intro_wf.paragraph_format.first_line_indent = Pt(24)
            self._add_slurry_friction_loss_process(doc, parameters, result)
        elif formula_id == "slurry_total_head":
            self._add_slurry_total_head_process(doc, parameters, result)
        elif formula_id == "clear_water_total_head":
            self._add_clear_water_total_head_process(doc, parameters, result)
        elif formula_id == "clear_water_friction_loss":
            self._add_clear_water_friction_loss_process(doc, parameters, result)
    
    def _add_clear_water_friction_loss_process(self, doc, parameters, result):
        """清水海澄–威廉沿程摩阻：书写为 105·C_h^(-1.85)·…，计算用参数 K_hw（默认 105）"""
        intermediate = result.get("intermediate", {}) or {}
        ch = parameters.get("C_h", "N/A")
        k_hw = parameters.get("K_hw", 105)
        dj = parameters.get("d_j", "N/A")
        qg = parameters.get("q_g", "N/A")
        process_texts = [
            f"1. 输入：K_hw = {k_hw}，C_h = {ch}，d_j = {dj} m，q_g = {qg} m³/s",
            f"2. C_h^(-1.85) = {intermediate.get('clear_hw_ch_pow', 'N/A')}",
            f"3. d_j^(-4.87) = {intermediate.get('clear_hw_dj_pow', 'N/A')}",
            f"4. q_g^1.85 = {intermediate.get('clear_hw_qg_pow', 'N/A')}",
            f"5. i = {k_hw} × 以上三项之积（式中常数 105 对应参数 K_hw）= {result.get('i', 'N/A')} kPa/m",
        ]
        for text in process_texts:
            para = doc.add_paragraph(text)
            for run in para.runs:
                self._set_font(run)

    def _add_liu_dezhong_process(self, doc, parameters, result):
        """添加刘德忠公式计算过程"""
        intermediate = result.get('intermediate', {})
        rho_g = parameters.get('rho_g', 'N/A')
        rho_k = parameters.get('rho_k', 'N/A')
        coefficient = intermediate.get('coefficient', parameters.get('coefficient_9_5', 9.5))
        
        process_texts = [
            f"1. 计算相对密度差: Δρ/ρ = ({rho_g} - {rho_k})/{rho_k} = {intermediate.get('delta_rho_ratio', 'N/A')}",
            f"2. 计算核心项: [g·D·(Δρ/ρ)·ω]^(1/3) = {intermediate.get('core_term', 'N/A')}",
            f"3. 计算浓度修正项: Cv^(1/6) = {intermediate.get('concentration_term', 'N/A')}",
            f"4. 计算速度比修正项: (ω_s/ω)^(1/6) = {intermediate.get('velocity_ratio_term', 'N/A')}",
            f"5. 计算临界流速: Vc = {coefficient} × {intermediate.get('core_term', 'N/A')} × {intermediate.get('concentration_term', 'N/A')} × {intermediate.get('velocity_ratio_term', 'N/A')}",
            f"   Vc = {result.get('Vc', 'N/A')} m/s"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_wasp_process(self, doc, parameters, result):
        """添加瓦斯普公式计算过程"""
        intermediate = result.get('intermediate', {})
        coefficient = intermediate.get('coefficient', parameters.get('coefficient_3_113', 3.113))
        rho_g = parameters.get('rho_g', 'N/A')
        rho_k = parameters.get('rho_k', 'N/A')
        
        process_texts = [
            f"1. 计算相对密度差: Δρ/ρ = ({rho_g} - {rho_k})/{rho_k} = {intermediate.get('delta_rho_ratio', 'N/A')}",
            f"2. 计算核心项: [2·g·D·(Δρ/ρ)]^(1/2) = {intermediate.get('bracket_term', 'N/A')}",
            f"3. 计算浓度修正项: Cv^0.1858 = {intermediate.get('concentration_term', 'N/A')}",
            f"4. 计算粒径比修正项: (d85/D)^(1/6) = {intermediate.get('size_ratio_term', 'N/A')}",
            f"5. 计算临界流速: Vc = {coefficient} × {intermediate.get('concentration_term', 'N/A')} × {intermediate.get('bracket_term', 'N/A')} × {intermediate.get('size_ratio_term', 'N/A')}",
            f"   Vc = {result.get('Vc', 'N/A')} m/s"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_fei_xiangjun_process(self, doc, parameters, result):
        """添加费祥俊公式计算过程"""
        intermediate = result.get('intermediate', {})
        rho_g = parameters.get('rho_g', 'N/A')
        rho_k = parameters.get('rho_k', 'N/A')
        lambda_coef = parameters.get('lambda_coef', 'N/A')
        coefficient = intermediate.get('coefficient_2_26', parameters.get('coefficient_2_26', 2.26))
        
        process_texts = [
            f"1. 计算相对密度差: Δρ/ρ = ({rho_g} - {rho_k})/{rho_k} = {intermediate.get('delta_rho_ratio', 'N/A')}",
            f"2. 计算核心系数: 2.26/√λ = {coefficient}/√{lambda_coef} = {intermediate.get('leading_coef', 'N/A')}",
            f"3. 计算核心项: [g·D·(Δρ/ρ)·ω]^(1/2) = {intermediate.get('bracket_term', 'N/A')}",
            f"4. 计算浓度修正项: Cv^0.25 = {intermediate.get('conc_term', 'N/A')}",
            f"5. 计算粒径比修正项: (d90/D)^(1/3) = {intermediate.get('size_term', 'N/A')}",
            f"6. 计算临界流速: Vc = {intermediate.get('leading_coef', 'N/A')} × {intermediate.get('bracket_term', 'N/A')} × {intermediate.get('conc_term', 'N/A')} × {intermediate.get('size_term', 'N/A')}",
            f"   Vc = {result.get('Vc', 'N/A')} m/s"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_kronodze_pressure_process(self, doc, parameters, result):
        """添加 B.C.克诺罗兹法 三步计算过程"""
        intermediate = result.get('intermediate', {})
        K = parameters.get('K', 1.1)
        G = parameters.get('G', 'N/A')
        W = parameters.get('W', 'N/A')
        rho_g = parameters.get('rho_g', 'N/A')
        dp = parameters.get('dp', 'N/A')
        beta = parameters.get('beta', 1.0)
        Qk = intermediate.get('step_A_Qk', 'N/A')
        DL = intermediate.get('step_B_DL_mm', 'N/A')
        Cd = intermediate.get('Cd', 'N/A')
        process_texts = [
            "A) 计算矿浆流量 Qk：",
            f"   Qk = K·W·(1/ρg + G/W) = {K}×{W}×(1/{rho_g} + {G}/{W}) = {Qk}",
            "B) 计算临界管径 DL（按尾矿加权平均粒径 dp 选用公式，由 Qk 反解）：",
            f"   dp = {dp} mm，重量砂水比 Cd = W/G×100 = {Cd}，得 DL = {DL} mm",
            "C) 计算临界流速 V_L：",
            f"   V_L = 0.255β(1 + 2.48·³√(Cd)·⁴√(DL)) = {result.get('Vc', 'N/A')} m/s"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_friction_loss_process(self, doc, parameters, result):
        """添加沿程摩阻损失(4.3.1-1)计算过程"""
        lambda_coef = parameters.get('lambda_coef', 'N/A')
        V = parameters.get('V', 'N/A')
        rho_k = parameters.get('rho_k', 'N/A')
        D = parameters.get('D', 'N/A')
        rho_s = parameters.get('rho_s', 'N/A')
        g = parameters.get('g', 9.81)
        i_k = result.get('i_k', 'N/A')
        process_texts = [
            f"公式(4.3.1-1): i_k = λ·(V²·ρ_k)/(2gD·ρ_s)",
            f"1. 代入: λ={lambda_coef}, V={V} m/s, ρ_k={rho_k} t/m³, D={D} m, ρ_s={rho_s} t/m³, g={g} m/s²",
            f"2. 沿程摩阻损失: i_k = {i_k} mH₂O/m"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_density_mixing_process(self, doc, parameters, result):
        """添加密度混合公式(4.3.1-2)计算过程"""
        C_w = parameters.get('C_w', 'N/A')
        rho_g = parameters.get('rho_g', 'N/A')
        rho_s = parameters.get('rho_s', 'N/A')
        rho_k = result.get('rho_k', 'N/A')
        process_texts = [
            f"公式(4.3.1-2): ρ_k = 1/(C_w/ρ_g + (1-C_w)/ρ_s)",
            f"1. 代入: C_w={C_w}, ρ_g={rho_g} t/m³, ρ_s={rho_s} t/m³",
            f"2. 浆体密度: ρ_k = {rho_k} t/m³"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

    def _add_darcy_friction_process(self, doc, parameters, result):
        """添加达西摩阻系数（三步）计算过程"""
        intermediate = result.get('intermediate', {})
        rho_1 = intermediate.get('step_A_rho_1', result.get('rho_1', 'N/A'))
        Re_B = intermediate.get('step_B_Re_B', result.get('Re_B', 'N/A'))
        lam = result.get('lambda_coef', 'N/A')
        flow_regime = intermediate.get('flow_regime', 'N/A')
        rho_g, rho_s, C1v = parameters.get('rho_g'), parameters.get('rho_s'), parameters.get('C1v')
        if rho_g is not None and rho_s is not None and C1v is not None:
            step_a = [f"步骤 A: ρ₁ = ρg·C1v + (1-C1v)·ρs（t/m³）", f"代入 ρg={rho_g}, ρs={rho_s}, C1v={C1v} → ρ₁ = {rho_1} t/m³"]
        else:
            step_a = [f"步骤 A: 用户直接输入 ρ₁ = {rho_1} t/m³"]
        V, D_n, eta_1 = parameters.get('V'), parameters.get('D_n'), parameters.get('eta_1')
        if V is not None and D_n is not None and eta_1 is not None:
            step_b = ["", "步骤 B: ReB = (V·Dn·1000·ρ₁)/η₁（ρ₁ 为 t/m³）", f"代入 V={V}, Dn={D_n}, ρ₁={rho_1}, η₁={eta_1} → ReB = {Re_B}"]
        else:
            step_b = ["", f"步骤 B: 用户直接输入 ReB = {Re_B}"]
        epsilon = parameters.get('epsilon', 0.0002)
        step_c = ["", "步骤 C: 达西摩阻系数 λ", f"ReB={Re_B}，流态：{flow_regime}", f"ε={epsilon}, Dn={D_n}", f"λ = {lam}"]
        for text in step_a + step_b + step_c:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

    def _add_slurry_accel_energy_process(self, doc, parameters, result):
        """添加浆体加速流/消能计算过程"""
        intermediate = result.get('intermediate', {})
        Z1, Z2 = parameters.get('Z1', 'N/A'), parameters.get('Z2', 'N/A')
        H1, H2 = parameters.get('H1', 'N/A'), parameters.get('H2', 'N/A')
        i, L = parameters.get('i', 'N/A'), parameters.get('L', 'N/A')
        head_diff = intermediate.get('head_diff', 'N/A')
        friction_loss_total = intermediate.get('friction_loss_total', 'N/A')
        condition_met = result.get('condition_met', False)
        conclusion = '满足' if condition_met else '不满足'
        process_texts = [
            "公式(6): (Z₁ + P₁/(ρkg)) - (Z₂ + P₂/(ρkg)) > iL",
            f"1. 左侧总水头差 = (Z₁+H₁)-(Z₂+H₂) = ({Z1}+{H1})-({Z2}+{H2}) = {head_diff} m",
            f"2. 右侧摩阻损失 = i×L = {i}×{L} = {friction_loss_total} m",
            f"3. 判断: {head_diff} {'>' if condition_met else '≤'} {friction_loss_total}，条件{conclusion}"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

    def _add_slurry_dissipation_process(self, doc, parameters, result):
        """添加浆体消能两步计算过程"""
        intermediate = result.get('intermediate', {})
        lambda_d = parameters.get('lambda_d', 'N/A')
        L_s = parameters.get('L_s', 'N/A')
        d = parameters.get('d', 'N/A')
        Q = parameters.get('Q', 'N/A')
        K_QL = result.get('K_QL', intermediate.get('step_1_kql', parameters.get('K_QL', 'N/A')))
        delta_h = result.get('delta_h', intermediate.get('step_2_delta_h', 'N/A'))
        num = intermediate.get('kql_numerator')
        den = intermediate.get('kql_denominator_d5')
        Q2 = intermediate.get('Q_squared')

        process_texts = [
            "步骤1：计算沿程缩径增阻管道流量消能系数",
            "K_QL = (6.3755×10^-9)·λ_d·L_s / d^5",
        ]
        if num is not None and den is not None:
            process_texts.append(f"中间项：分子 (6.3755×10^-9)·λ_d·L_s = {num}；分母 d^5 = {den}")
        process_texts.append(f"代入 λ_d={lambda_d}, L_s={L_s}, d={d}，得到 K_QL = {K_QL} h²/m⁵")
        process_texts.extend([
            "步骤2：计算消能水头",
            "Δh = K_QL·Q²",
        ])
        if Q2 is not None:
            process_texts.append(f"中间项：Q² = {Q2}")
        process_texts.append(f"代入 K_QL={K_QL}, Q={Q}，得到 Δh = {delta_h} m")
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

    def _add_slurry_dissipation_orifice_process(self, doc, parameters, result):
        """孔板消能三步分算：按输入表中出现的量整理推演说明（允许跳过前两步仅做第 3 步）。"""
        intermediate = result.get('intermediate', {}) or {}
        d = parameters.get('d', 'N/A')
        D = parameters.get('D', 'N/A')
        beta = parameters.get('beta', intermediate.get('orifice_beta', 'N/A'))
        K_Qk_in = parameters.get('K_Qk', 'N/A')
        Q = parameters.get('Q', 'N/A')
        delta_h = result.get('delta_h', 'N/A')
        Q2 = intermediate.get('Q_squared')
        kqk2 = intermediate.get('orifice_K_Qk_step2')

        lines = [
            "孔板（节流件）局部消能：β = d/D；K_Qk = 6.3755×10^-9·(1-β²)(1.142-β²)/d⁴；Δh = K_Qk·Q²（Q 单位 m³/h，Δh 单位 m）。",
        ]
        if d != 'N/A' and D != 'N/A':
            lines.append(f"步骤1（若适用）：由 d={d} m、D={D} m 得孔径比 β = d/D = {beta}。")
        elif beta != 'N/A':
            lines.append(f"孔径比 β = {beta}（由用户直接给定或自其他途径取得）。")
        if kqk2 is not None:
            lines.append(f"步骤2（若适用）：由 β 与 d 得孔板流量消能系数 K_Qk = {kqk2} h²/m⁵。")
        lines.append(f"步骤3：代入 K_Qk = {K_Qk_in} h²/m⁵、Q = {Q} m³/h。")
        if Q2 is not None:
            lines.append(f"中间量 Q² = {Q2} (m³/h)²。")
        lines.append(f"消能水头 Δh = K_Qk·Q² = {delta_h} m。")
        for text in lines:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

    def _add_slurry_friction_loss_process(self, doc, parameters, result):
        """添加浆体摩阻损失（达西-魏斯巴赫公式）计算过程"""
        rho_k = parameters.get('rho_k', result.get('rho_k', 'N/A'))
        rho_s = parameters.get('rho_s', 'N/A')
        lambda_coef = parameters.get('lambda_coef', 'N/A')
        V = parameters.get('V', 'N/A')
        D = parameters.get('D', 'N/A')
        g = parameters.get('g', 9.81)
        i_k = result.get('i_k', 'N/A')
        process_texts = [
            "达西-魏斯巴赫公式(4.3.1-1): i_k = λ·(V²·ρ_k)/(2gD·ρ_s)",
            f"1. 代入: λ={lambda_coef}, V={V} m/s, ρ_k={rho_k} t/m³, D={D} m, ρ_s={rho_s} t/m³, g={g} m/s²",
            f"2. 沿程摩阻损失: i_k = {i_k} mH₂O/m"
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)
    
    def _add_slurry_total_head_process(self, doc, parameters, result):
        """浆体总扬程计算过程 + Pk-L 曲线图"""
        intermediate = result.get('intermediate', {})
        rho_k = parameters.get('rho_k', 'N/A')
        g = parameters.get('g', 9.81)
        H = parameters.get('H', 'N/A')
        rho_s = parameters.get('rho_s', 'N/A')
        i_k = parameters.get('i_k', 'N/A')
        L = parameters.get('L', 'N/A')
        P_j = parameters.get('P_j', 0)
        P_n = parameters.get('P_n', 0)
        P_z = parameters.get('P_z', 0)

        process_texts = [
            "公式: Pk = ρk·g·H + ρs·g·ik·L + Pj + Pn + Pz",
            f"1. 重力势能压力: ρk·g·H = {rho_k}×{g}×{H} = {intermediate.get('gravity_pressure', 'N/A')} kPa（ρ 单位 t/m³）",
            f"2. 沿程摩擦损失: ρs·g·ik·L = {rho_s}×{g}×{i_k}×{L} = {intermediate.get('friction_pressure', 'N/A')} kPa",
            f"3. 局部摩阻损失: Pj = {P_j} kPa",
            f"4. 泵站零件损失: Pn = {P_n} kPa",
            f"5. 出口余压: Pz = {P_z} kPa",
            f"6. 总输送压力: Pk = {intermediate.get('gravity_pressure', 0)} + {intermediate.get('friction_pressure', 0)} + {P_j} + {P_n} + {P_z} = {result.get('H_total', 'N/A')} kPa",
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

        hl_curve = result.get('hl_curve')
        if hl_curve and len(hl_curve) > 1:
            self._add_pk_l_chart(doc, hl_curve, parameters)

    def _add_pk_l_chart(self, doc, hl_curve, parameters):
        """用 matplotlib 生成 Pk-L 曲线并嵌入 Word"""
        try:
            plt, rcParams = _matplotlib_stack_for_export()
            rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial']
            rcParams['axes.unicode_minus'] = False

            ls = [pt['L'] for pt in hl_curve]
            pks = [pt['H'] for pt in hl_curve]

            fig, ax = plt.subplots(figsize=(7.5, 4.2), dpi=150)
            ax.plot(ls, pks, color='#D97706', linewidth=2, label='$P_k$')
            ax.fill_between(ls, pks, alpha=0.08, color='#D97706')
            ax.set_xlabel('$L$ (m)', fontsize=11, fontstyle='italic')
            ax.set_ylabel('$P_k$ (kPa)', fontsize=11, fontstyle='italic')
            ax.set_title('$P_k$–$L$ Characteristic Curve', fontsize=13, fontweight='bold', pad=12)
            ax.grid(True, linestyle='--', alpha=0.4)
            ax.legend(fontsize=10, loc='upper left')

            info_parts = []
            if parameters.get('rho_k') is not None:
                info_parts.append(f"$\\rho_k$={parameters['rho_k']} t/m³")
            if parameters.get('i_k') is not None:
                info_parts.append(f"$i_k$={parameters['i_k']}")
            if parameters.get('H') is not None:
                info_parts.append(f"$H$={parameters['H']} m")
            if info_parts:
                ax.annotate('  '.join(info_parts), xy=(0.5, -0.18),
                            xycoords='axes fraction', ha='center', fontsize=8, color='#6B7280')

            fig.tight_layout(rect=[0, 0.05, 1, 1])

            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            tmp_path = tmp.name
            tmp.close()
            fig.savefig(tmp_path, dpi=150, bbox_inches='tight')
            plt.close(fig)

            doc.add_paragraph()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run()
            run.add_picture(tmp_path, width=Inches(5.8))

            caption = doc.add_paragraph('图：浆体管道输送压力 Pk 随管长 L 的变化关系')
            caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in caption.runs:
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
                self._set_font(run)

            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        except ImportError:
            p = doc.add_paragraph('(Pk-L 曲线图需要安装 matplotlib: pip install matplotlib)')
            for run in p.runs:
                self._set_font(run)

    def _add_clear_water_total_head_process(self, doc, parameters, result):
        """清水总扬程计算过程 + Pw-L 曲线图"""
        intermediate = result.get('intermediate', {})
        rho_w = parameters.get('rho_w', 1)
        g = parameters.get('g', 9.81)
        H = parameters.get('H', 'N/A')
        i_w = parameters.get('i_w', 'N/A')
        L = parameters.get('L', 'N/A')
        P_j = parameters.get('P_j', 0)
        P_n = parameters.get('P_n', 0)
        P_z = parameters.get('P_z', 0)

        process_texts = [
            "公式: Pw = ρw·g·(H + i_w·L) + Pj + Pn + Pz",
            "注: 与分项 ρw·g·H + ρw·g·i_w·L 等价；ρk、ρs 在清水工况均取 ρw；沿程采用清水摩阻系数 i_w。",
            f"1. 重力势能压力: ρw·g·H = {rho_w}×{g}×{H} = {intermediate.get('gravity_pressure', 'N/A')} kPa（ρw 单位 t/m³）",
            f"2. 沿程摩擦损失: ρw·g·i_w·L = {rho_w}×{g}×{i_w}×{L} = {intermediate.get('friction_pressure', 'N/A')} kPa",
            f"3. 局部摩阻损失: Pj = {P_j} kPa",
            f"4. 泵站零件损失: Pn = {P_n} kPa",
            f"5. 出口余压: Pz = {P_z} kPa",
            f"6. 总输送压力: Pw = {intermediate.get('gravity_pressure', 0)} + {intermediate.get('friction_pressure', 0)} + {P_j} + {P_n} + {P_z} = {result.get('H_total', 'N/A')} kPa",
        ]
        for text in process_texts:
            p = doc.add_paragraph(text)
            for run in p.runs:
                self._set_font(run)

        hl_curve = result.get('hl_curve')
        if hl_curve and len(hl_curve) > 1:
            self._add_pw_l_chart(doc, hl_curve, parameters)

    def _add_pw_l_chart(self, doc, hl_curve, parameters):
        """用 matplotlib 生成清水 Pw-L 曲线并嵌入 Word"""
        try:
            plt, rcParams = _matplotlib_stack_for_export()
            rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'Arial']
            rcParams['axes.unicode_minus'] = False

            ls = [pt['L'] for pt in hl_curve]
            pws = [pt['H'] for pt in hl_curve]

            fig, ax = plt.subplots(figsize=(7.5, 4.2), dpi=150)
            ax.plot(ls, pws, color='#2563EB', linewidth=2, label='$P_w$')
            ax.fill_between(ls, pws, alpha=0.06, color='#2563EB')
            ax.set_xlabel('$L$ (m)', fontsize=11, fontstyle='italic')
            ax.set_ylabel('$P_w$ (kPa)', fontsize=11, fontstyle='italic')
            ax.set_title('$P_w$\u2013$L$ Characteristic Curve (Clear Water)', fontsize=13, fontweight='bold', pad=12)
            ax.grid(True, linestyle='--', alpha=0.4)
            ax.legend(fontsize=10, loc='upper left')

            info_parts = []
            if parameters.get('rho_w') is not None:
                info_parts.append(f"$\\rho_w$={parameters['rho_w']} t/m³")
            if parameters.get('i_w') is not None:
                info_parts.append(f"$i_w$={parameters['i_w']}")
            if parameters.get('H') is not None:
                info_parts.append(f"$H$={parameters['H']} m")
            if info_parts:
                ax.annotate('  '.join(info_parts), xy=(0.5, -0.18),
                            xycoords='axes fraction', ha='center', fontsize=8, color='#6B7280')

            fig.tight_layout(rect=[0, 0.05, 1, 1])

            tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
            tmp_path = tmp.name
            tmp.close()
            fig.savefig(tmp_path, dpi=150, bbox_inches='tight')
            plt.close(fig)

            doc.add_paragraph()
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run()
            run.add_picture(tmp_path, width=Inches(5.8))

            caption = doc.add_paragraph('Fig: Clear water pipeline delivery pressure Pw vs pipe length L')
            caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in caption.runs:
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
                self._set_font(run)

            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        except ImportError:
            p = doc.add_paragraph('(Pw-L chart requires matplotlib: pip install matplotlib)')
            for run in p.runs:
                self._set_font(run)

    def _add_software_promotion(self, doc):
        """附录：软件与文档说明"""
        doc.add_page_break()
        p = doc.add_paragraph()
        run = p.add_run("附录 A　软件与导出说明")
        run.bold = True
        run.font.size = Pt(16)
        self._set_font(run)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER

        doc.add_paragraph()
        blocks = [
            (
                "关于本工具",
                [
                    "本程序由长沙有色冶金设计研究院有限公司提供，用于浆体与清水管道相关水力计算辅助。",
                    "导出文件为标准 .docx，由 Word 或 WPS 等可直接打开，无需安装 Pandoc 等外部转换工具。",
                ],
            ),
            (
                "文档中公式与符号的呈现方式",
                [
                    "为兼容各类办公环境，计算书中的公式主行与说明文字以 Unicode 数学符号与普通文本为主；",
                    "若需期刊或标准格式的公式排版，可在 Word 中选中相应内容后使用「插入 → 公式」自行转换。",
                ],
            ),
            (
                "功能范围（摘要）",
                [
                    "临界流速：刘德忠、E.J.瓦斯普、费祥俊、B.C.克诺罗兹法等；",
                    "浆体密度混合、沿程摩阻、达西摩阻系数；浆体加速流与消能、浆体/清水总扬程及特性曲线示意等。",
                ],
            ),
        ]
        for sub_title, lines in blocks:
            h = doc.add_paragraph()
            hr = h.add_run(sub_title)
            hr.bold = True
            self._set_font(hr)
            for line in lines:
                lp = doc.add_paragraph(line)
                for run in lp.runs:
                    self._set_font(run)
                lp.paragraph_format.first_line_indent = Pt(24)
            doc.add_paragraph()

        thanks = doc.add_paragraph("感谢使用。")
        for run in thanks.runs:
            self._set_font(run)
    
    def _get_unit(self, param_name):
        """根据参数名获取单位（与前端/API 常用字段对齐）"""
        units = {
            "D": "m",
            "D_n": "m",
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
            "C1v": "",
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
            "L": "m",
            "H": "m",
            "i": "mH₂O/m",
            "i_w": "",
            "i_k": "mH₂O/m",
            "K_QL": "h²/m⁵",
            "Q": "m³/h",
            "P_j": "kPa",
            "P_n": "kPa",
            "P_z": "kPa",
            "Z1": "m",
            "Z2": "m",
            "H1": "m",
            "H2": "m",
            "d": "m",
            "eta_1": "Pa·s",
            "epsilon": "m",
        }
        return units.get(param_name, "")
