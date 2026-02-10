from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore
from docx.oxml.ns import qn
from docx.oxml import parse_xml
from datetime import datetime
import os
import re

class WordExporter:
    """Word文档导出器"""
    
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
    
    def export(self, formula_id, formula_info, parameters, result):
        """导出计算书到Word文档"""
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
            
            # 添加最终结果
            self._add_result_section(doc, result)
            
            # 添加计算过程
            self._add_calculation_process(doc, formula_id, formula_info, parameters, result)
            
            # 添加软件推广信息
            self._add_software_promotion(doc)
            
            # 保存文件
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
        """添加软件介绍"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        title_run = p.add_run('长沙院浆体管道临界流速计算软件')
        title_run.bold = True
        title_run.font.size = Pt(16)
        self._set_font(title_run)
        
        doc.add_paragraph()
        intro_p = doc.add_paragraph()
        intro_run = intro_p.add_run('本计算书由长沙院浆体管道临界流速计算软件自动生成。该软件是长沙有色冶金设计研究院有限公司开发的专业计算工具，用于计算浆体管道输送系统的临界流速。')
        self._set_font(intro_run)
        intro_p.paragraph_format.first_line_indent = Pt(24)  # 首行缩进
        
        doc.add_paragraph()
        features_p = doc.add_paragraph()
        features_run = features_p.add_run('软件特点：')
        features_run.bold = True
        self._set_font(features_run)
        
        features_list = [
            '支持多种流态下的临界流速计算方法',
            '提供详细的中间计算过程和最终结果',
            '自动生成规范的计算书文档',
            '计算结果准确可靠，符合工程实践'
        ]
        for feature in features_list:
            p = doc.add_paragraph(feature, style='List Bullet')
            for run in p.runs:
                self._set_font(run)
            p.paragraph_format.left_indent = Pt(24)
        
        doc.add_paragraph()
    
    def _add_basic_info(self, doc, formula_info):
        """添加基本信息"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('一、基本信息')
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        info_table = doc.add_table(rows=2, cols=2)
        info_table.style = 'Light Grid Accent 1'
        
        info_table.cell(0, 0).text = '计算公式'
        info_table.cell(0, 1).text = formula_info.get('name', '未知公式')
        for cell in info_table.rows[0].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
        
        info_table.cell(1, 0).text = '计算时间'
        info_table.cell(1, 1).text = datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
        for cell in info_table.rows[1].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
    
    def _add_formula_section(self, doc, formula_info):
        """添加计算公式部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('二、使用的计算公式')
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        # 添加公式名称
        formula_name_p = doc.add_paragraph()
        formula_name_run = formula_name_p.add_run(f'公式名称：{formula_info.get("name", "未知公式")}')
        formula_name_run.bold = True
        self._set_font(formula_name_run)
        
        doc.add_paragraph()
        
        # 添加公式（使用文本格式，后续可根据样本文档优化）
        formula_text = formula_info.get('formula', '')
        formula_p = doc.add_paragraph()
        formula_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # 暂时使用文本格式，等样本文档后再优化为数学公式对象
        formula_run = formula_p.add_run(formula_text)
        formula_run.font.size = Pt(14)
        formula_run.font.name = 'Times New Roman'
        self._set_font(formula_run)
        
        # 添加公式说明
        if formula_info.get('description'):
            doc.add_paragraph()
            desc_p = doc.add_paragraph(formula_info.get('description'))
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
        """添加输入参数部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('三、输入参数')
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
        
        # 表头
        header_cells = param_table.rows[0].cells
        header_cells[0].text = '参数名称'
        header_cells[1].text = '数值'
        header_cells[2].text = '单位'
        
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
                param_table.cell(row, 0).text = param_def.get('label', param_name)
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
        run = p.add_run('四、中间计算结果')
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
        # 创建中间结果表格
        intermediate_table = doc.add_table(rows=len(intermediate) + 1, cols=2)
        intermediate_table.style = 'Light Grid Accent 1'
        
        # 表头
        header_cells = intermediate_table.rows[0].cells
        header_cells[0].text = '中间计算项'
        header_cells[1].text = '计算结果'
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
            'g': '重力加速度 g'
        }
        return labels.get(key, key)
    
    def _add_result_section(self, doc, result):
        """添加最终结果部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('五、最终计算结果')
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
        
        # 临界流速
        vc_value = result.get('Vc', 'N/A')
        if isinstance(vc_value, (int, float)):
            vc_display = f"{vc_value:.4f}".rstrip('0').rstrip('.')
        else:
            vc_display = str(vc_value)
        
        result_table.cell(1, 0).text = '临界流速 Vc'
        result_table.cell(1, 1).text = f"{vc_display} {result.get('unit', 'm/s')}"
        # 设置该行所有单元格的字体
        for cell in result_table.rows[1].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
        
        # 备注
        result_table.cell(2, 0).text = '备注'
        result_table.cell(2, 1).text = '计算结果仅供参考，实际应用需结合工程实际情况进行验证。'
        # 设置该行所有单元格的字体
        for cell in result_table.rows[2].cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    self._set_font(run)
    
    def _add_calculation_process(self, doc, formula_id, formula_info, parameters, result):
        """添加计算过程"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('六、详细计算过程')
        run.bold = True
        run.font.size = Pt(14)
        self._set_font(run)
        
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
            f"   dp = {dp} mm，重量砂水比 Cd = G/W×100 = {Cd}，得 DL = {DL} mm",
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
    
    def _add_software_promotion(self, doc):
        """添加软件推广信息"""
        doc.add_page_break()
        p = doc.add_paragraph()
        run = p.add_run('软件信息')
        run.bold = True
        run.font.size = Pt(16)
        self._set_font(run)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        doc.add_paragraph()
        promotion_paragraphs = [
            '本计算书由"长沙院浆体管道临界流速计算工具"生成。',
            '该软件提供了多种流态下的临界流速计算方法，包括：',
            '• 似均质流态：刘德忠公式、E.J.瓦斯普公式、费祥俊公式',
            '• 非均质流态：B.C.克诺罗兹法、B.C.克诺罗兹法（重力流）',
            '',
            '软件特点：',
            '✓ 界面现代化，操作简便',
            '✓ 支持多种计算公式，满足不同工程需求',
            '✓ 自动生成详细计算书，便于存档和审核',
            '✓ 计算结果准确可靠，符合工程实践',
            '',
            '感谢使用本软件！'
        ]
        for text in promotion_paragraphs:
            p = doc.add_paragraph(text, style='List Paragraph')
            for run in p.runs:
                self._set_font(run)
    
    def _get_unit(self, param_name):
        """根据参数名获取单位"""
        units = {
            'D': 'm',
            'ps': 't/m³',
            'pl': 't/m³',
            'ws': 'm/s',
            'Cs': 'decimal',
            'w0': 'm/s',
            'phi': '',
            'FL': '',
            'K': '',
            'C': '',
            'Cg': '',
            'theta': '度',
            'g': 'm/s²',
            'G': '',
            'W': '',
            'rho_g': 't/m³',
            'rho_s': 't/m³',
            'rho_k': 't/m³',
            'dp': 'mm',
            'beta': '',
            'lambda_coef': '',
            'V': 'm/s',
            'C_w': ''
        }
        return units.get(param_name, '')
