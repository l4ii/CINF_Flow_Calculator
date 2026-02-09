from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from datetime import datetime
import os

class WordExporter:
    """Word文档导出器"""
    
    def __init__(self):
        self.output_dir = "exports"
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
    
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
            filename = f"长沙院浆体计算_{formula_name}_{timestamp}.docx"
            file_path = os.path.join(self.output_dir, filename)
            doc.save(file_path)
            
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
        font.name = '宋体'
        font.size = Pt(12)
    
    def _add_software_intro(self, doc):
        """添加软件介绍"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        title_run = p.add_run('长沙院浆体管道临界流速计算软件')
        title_run.bold = True
        title_run.font.size = Pt(16)
        
        doc.add_paragraph()
        intro_p = doc.add_paragraph()
        intro_p.add_run('本计算书由长沙院浆体管道临界流速计算软件自动生成。该软件是长沙有色冶金设计研究院有限公司开发的专业计算工具，用于计算浆体管道输送系统的临界流速。')
        intro_p.paragraph_format.first_line_indent = Pt(24)  # 首行缩进
        
        doc.add_paragraph()
        features_p = doc.add_paragraph()
        features_run = features_p.add_run('软件特点：')
        features_run.bold = True
        
        features_list = [
            '支持多种流态下的临界流速计算方法',
            '提供详细的中间计算过程和最终结果',
            '自动生成规范的计算书文档',
            '计算结果准确可靠，符合工程实践'
        ]
        for feature in features_list:
            p = doc.add_paragraph(feature, style='List Bullet')
            p.paragraph_format.left_indent = Pt(24)
        
        doc.add_paragraph()
    
    def _add_basic_info(self, doc, formula_info):
        """添加基本信息"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('一、基本信息')
        run.bold = True
        run.font.size = Pt(14)
        
        info_table = doc.add_table(rows=2, cols=2)
        info_table.style = 'Light Grid Accent 1'
        
        info_table.cell(0, 0).text = '计算公式'
        info_table.cell(0, 1).text = formula_info.get('name', '未知公式')
        
        info_table.cell(1, 0).text = '计算时间'
        info_table.cell(1, 1).text = datetime.now().strftime("%Y年%m月%d日 %H:%M:%S")
    
    def _add_formula_section(self, doc, formula_info):
        """添加计算公式部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('二、使用的计算公式')
        run.bold = True
        run.font.size = Pt(14)
        
        # 添加公式名称
        formula_name_p = doc.add_paragraph()
        formula_name_p.add_run(f'公式名称：{formula_info.get("name", "未知公式")}').bold = True
        
        doc.add_paragraph()
        
        # 添加公式（使用数学符号）
        formula_text = formula_info.get('formula', '')
        formula_p = doc.add_paragraph()
        formula_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # 转换公式为更易读的格式
        formula_display = self._format_formula_for_word(formula_text)
        formula_run = formula_p.add_run(formula_display)
        formula_run.font.size = Pt(14)
        formula_run.font.name = 'Cambria Math'  # Word数学字体
        
        # 添加公式说明
        if formula_info.get('description'):
            doc.add_paragraph()
            desc_p = doc.add_paragraph(formula_info.get('description'))
            desc_p.paragraph_format.first_line_indent = Pt(24)
    
    def _format_formula_for_word(self, formula):
        """格式化公式以便在Word中显示"""
        # 替换数学符号
        replacements = {
            'Δρ': 'Δρ',
            'ρ': 'ρ',
            'ω': 'ω',
            'λ': 'λ',
            '√': '√',
            '^': '^',
            'Cv': 'Cv',
            'd85': 'd₈₅',
            'd90': 'd₉₀',
            'Vc': 'Vc',
            'D': 'D',
            'g': 'g',
            'Cs': 'Cs',
            'ω_s': 'ωs',
            'ωs': 'ωs',
            '*': '·',
            '/': '/',
            '(': '(',
            ')': ')',
            '[': '[',
            ']': ']',
            '=': '='
        }
        
        result = formula
        for old, new in replacements.items():
            result = result.replace(old, new)
        
        return result
    
    def _add_parameters_section(self, doc, parameters, formula_info):
        """添加输入参数部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('三、输入参数')
        run.bold = True
        run.font.size = Pt(14)
        
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
            doc.add_paragraph('无输入参数')
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
            row += 1
    
    def _get_intermediate_label(self, key):
        """获取中间计算项的中文标签"""
        labels = {
            'density_ratio': '密度比 (ρs-ρl)/ρl',
            'Ds_D': '当量直径比 Ds/D',
            'sqrt_term': '根号项',
            'sin_theta': 'sin(θ)',
            'Cv_power': 'Cv的幂次项',
            'omega_ratio': 'ωs/ω',
            'gD_term': 'gD项',
            'FL_term': 'FL项',
            'K_term': 'K项',
            'C_term': 'C项',
            'Cg_term': 'Cg项'
        }
        return labels.get(key, key)
    
    def _add_result_section(self, doc, result):
        """添加最终结果部分"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('五、最终计算结果')
        run.bold = True
        run.font.size = Pt(14)
        
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
        
        # 临界流速
        vc_value = result.get('Vc', 'N/A')
        if isinstance(vc_value, (int, float)):
            vc_display = f"{vc_value:.4f}".rstrip('0').rstrip('.')
        else:
            vc_display = str(vc_value)
        
        result_table.cell(1, 0).text = '临界流速 Vc'
        result_table.cell(1, 1).text = f"{vc_display} {result.get('unit', 'm/s')}"
        
        # 备注
        result_table.cell(2, 0).text = '备注'
        result_table.cell(2, 1).text = '计算结果仅供参考，实际应用需结合工程实际情况进行验证。'
    
    def _add_calculation_process(self, doc, formula_id, formula_info, parameters, result):
        """添加计算过程"""
        doc.add_paragraph()
        p = doc.add_paragraph()
        run = p.add_run('六、详细计算过程')
        run.bold = True
        run.font.size = Pt(14)
        
        # 根据公式ID添加详细计算步骤
        if formula_id == "liu_dezhong":
            self._add_liu_dezhong_process(doc, parameters, result)
        elif formula_id == "wasp":
            self._add_wasp_process(doc, parameters, result)
        elif formula_id == "fei_xiangjun":
            self._add_fei_xiangjun_process(doc, parameters, result)
        elif formula_id == "kronodze_pressure":
            self._add_kronodze_pressure_process(doc, parameters, result)
        elif formula_id == "kronodze_gravity":
            self._add_kronodze_gravity_process(doc, parameters, result)
    
    def _add_liu_dezhong_process(self, doc, parameters, result):
        """添加刘德忠公式计算过程"""
        intermediate = result.get('intermediate', {})
        
        doc.add_paragraph(f"1. 计算密度比: (ρs - ρl)/ρl = ({parameters.get('ps')} - {parameters.get('pl')})/{parameters.get('pl')} = {intermediate.get('density_ratio', 'N/A')}")
        doc.add_paragraph(f"2. 计算当量直径比: Ds/D = {intermediate.get('Ds_D', 'N/A')}")
        doc.add_paragraph(f"3. 计算根号项: √(2gD·Cs) = {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"4. 计算临界流速: Vc = φ × √(Ds/D) × (ρs-ρl)/ρl × √(2gD·Cs)")
        doc.add_paragraph(f"   Vc = {parameters.get('phi')} × {intermediate.get('Ds_D', 'N/A')} × {intermediate.get('density_ratio', 'N/A')} × {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"   Vc = {result.get('Vc', 'N/A')} m/s")
    
    def _add_wasp_process(self, doc, parameters, result):
        """添加瓦斯普公式计算过程"""
        intermediate = result.get('intermediate', {})
        doc.add_paragraph(f"1. 计算密度比: (ρs - ρl)/ρl = {intermediate.get('density_ratio', 'N/A')}")
        doc.add_paragraph(f"2. 计算根号项: √(2gD·(ρs-ρl)/ρl) = {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"3. 计算临界流速: Vc = FL × √(2gD·(ρs-ρl)/ρl) = {parameters.get('FL')} × {intermediate.get('sqrt_term', 'N/A')} = {result.get('Vc', 'N/A')} m/s")
    
    def _add_fei_xiangjun_process(self, doc, parameters, result):
        """添加费祥俊公式计算过程"""
        intermediate = result.get('intermediate', {})
        doc.add_paragraph(f"1. 计算密度比: (ρs - ρl)/ρl = {intermediate.get('density_ratio', 'N/A')}")
        doc.add_paragraph(f"2. 计算根号项: √(gD·(ρs-ρl)/ρl·Cs) = {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"3. 计算临界流速: Vc = K × √(gD·(ρs-ρl)/ρl·Cs) = {parameters.get('K')} × {intermediate.get('sqrt_term', 'N/A')} = {result.get('Vc', 'N/A')} m/s")
    
    def _add_kronodze_pressure_process(self, doc, parameters, result):
        """添加克诺罗兹法（压力流）计算过程"""
        intermediate = result.get('intermediate', {})
        doc.add_paragraph(f"1. 计算密度比: (ρs - ρl)/ρl = {intermediate.get('density_ratio', 'N/A')}")
        doc.add_paragraph(f"2. 计算根号项: √(gD·(ρs-ρl)/ρl) = {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"3. 计算临界流速: Vc = C × √(gD·(ρs-ρl)/ρl) = {parameters.get('C')} × {intermediate.get('sqrt_term', 'N/A')} = {result.get('Vc', 'N/A')} m/s")
    
    def _add_kronodze_gravity_process(self, doc, parameters, result):
        """添加克诺罗兹法（重力流）计算过程"""
        intermediate = result.get('intermediate', {})
        doc.add_paragraph(f"1. 计算密度比: (ρs - ρl)/ρl = {intermediate.get('density_ratio', 'N/A')}")
        doc.add_paragraph(f"2. 计算sin(θ): sin({parameters.get('theta')}°) = {intermediate.get('sin_theta', 'N/A')}")
        doc.add_paragraph(f"3. 计算根号项: √(gD·(ρs-ρl)/ρl·sin(θ)) = {intermediate.get('sqrt_term', 'N/A')}")
        doc.add_paragraph(f"4. 计算临界流速: Vc = Cg × √(gD·(ρs-ρl)/ρl·sin(θ)) = {parameters.get('Cg')} × {intermediate.get('sqrt_term', 'N/A')} = {result.get('Vc', 'N/A')} m/s")
    
    def _add_software_promotion(self, doc):
        """添加软件推广信息"""
        doc.add_page_break()
        p = doc.add_paragraph()
        run = p.add_run('软件信息')
        run.bold = True
        run.font.size = Pt(16)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        doc.add_paragraph()
        doc.add_paragraph('本计算书由"长沙院浆体管道临界流速计算工具"生成。', style='List Paragraph')
        doc.add_paragraph('该软件提供了多种流态下的临界流速计算方法，包括：', style='List Paragraph')
        doc.add_paragraph('• 似均质流态：刘德忠公式、E.J.瓦斯普公式、费祥俊公式', style='List Paragraph')
        doc.add_paragraph('• 非均质流态：B.C.克诺罗兹法（压力流）、B.C.克诺罗兹法（重力流）', style='List Paragraph')
        doc.add_paragraph()
        doc.add_paragraph('软件特点：', style='List Paragraph')
        doc.add_paragraph('✓ 界面现代化，操作简便', style='List Paragraph')
        doc.add_paragraph('✓ 支持多种计算公式，满足不同工程需求', style='List Paragraph')
        doc.add_paragraph('✓ 自动生成详细计算书，便于存档和审核', style='List Paragraph')
        doc.add_paragraph('✓ 计算结果准确可靠，符合工程实践', style='List Paragraph')
        doc.add_paragraph()
        doc.add_paragraph('感谢使用本软件！', style='List Paragraph')
    
    def _get_unit(self, param_name):
        """根据参数名获取单位"""
        units = {
            'D': 'm',
            'ps': 'kg/m³',
            'pl': 'kg/m³',
            'ws': 'm/s',
            'Cs': 'decimal',
            'w0': 'm/s',
            'phi': '',
            'FL': '',
            'K': '',
            'C': '',
            'Cg': '',
            'theta': '度',
            'g': 'm/s²'
        }
        return units.get(param_name, '')
