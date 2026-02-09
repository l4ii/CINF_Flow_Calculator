"""
Python后端打包脚本
使用PyInstaller将Python后端打包为可执行文件

使用方法：
1. 安装PyInstaller: pip install pyinstaller
2. 运行此脚本: python build_backend.py
3. 打包后的可执行文件在 dist/backend/ 目录
"""

import PyInstaller.__main__
import os
import sys

def build_backend():
    """打包Python后端为可执行文件"""
    
    # 确保在backend目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # PyInstaller参数
    args = [
        'app.py',
        '--name=backend_server',
        '--onefile',  # 打包为单个可执行文件
        '--hidden-import=flask',
        '--hidden-import=flask_cors',
        '--hidden-import=docx',
        '--hidden-import=calculation_engine',
        '--hidden-import=word_export',
        '--collect-all=flask',
        '--collect-all=flask_cors',
        '--collect-all=docx',
        '--distpath=../dist/backend',
        '--workpath=../build/backend',
        '--specpath=../build/backend',
        '--clean',
    ]
    
    # Windows特定配置
    if sys.platform == 'win32':
        args.extend([
            '--console',  # 显示控制台窗口（用于调试）
            # '--noconsole',  # 不显示控制台（生产环境）
        ])
    
    print('开始打包Python后端...')
    print(f'参数: {" ".join(args)}')
    
    try:
        PyInstaller.__main__.run(args)
        print('\n✅ 后端打包成功！')
        print(f'可执行文件位置: {os.path.join(script_dir, "../dist/backend/backend_server.exe")}')
    except Exception as e:
        print(f'\n❌ 打包失败: {e}')
        print('\n请确保已安装PyInstaller: pip install pyinstaller')
        sys.exit(1)

if __name__ == '__main__':
    build_backend()
