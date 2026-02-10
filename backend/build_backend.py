"""
构建 Python 后端为可执行文件
使用 PyInstaller 将 Flask 应用打包成独立的可执行文件
"""
import os
import sys
import glob

# 当前 Python 的所有 site-packages 目录（可能有多个）
def get_site_packages_dirs():
    import site
    dirs = []
    for sp in site.getsitepackages():
        sp = os.path.abspath(sp)
        if os.path.isdir(sp):
            dirs.append(sp)
    if site.USER_SITE and os.path.isdir(site.USER_SITE):
        dirs.append(os.path.abspath(site.USER_SITE))
    if not dirs:
        # fallback: 与 sys.executable 同级的 ../Lib/site-packages
        sp = os.path.join(os.path.dirname(sys.executable), "..", "Lib", "site-packages")
        sp = os.path.abspath(sp)
        if os.path.isdir(sp):
            dirs.append(sp)
    return dirs

# 在 site-packages 里查找并临时重命名所有 pathlib 相关项（backport），打包后再恢复
def hide_pathlib_backport(site_packages):
    renamed = []
    # pathlib.py
    p = os.path.join(site_packages, "pathlib.py")
    if os.path.isfile(p):
        bak = p + ".pyinstaller_bak"
        try:
            os.rename(p, bak)
            renamed.append((p, bak))
        except Exception as e:
            print(f"WARNING: 无法重命名 {p}: {e}")
    # pathlib 目录（若存在）
    pdir = os.path.join(site_packages, "pathlib")
    if os.path.isdir(pdir):
        bak = pdir + ".pyinstaller_bak"
        try:
            os.rename(pdir, bak)
            renamed.append((pdir, bak))
        except Exception as e:
            print(f"WARNING: 无法重命名目录 {pdir}: {e}")
    # pathlib-*.dist-info
    for d in glob.glob(os.path.join(site_packages, "pathlib-*.dist-info")):
        bak = d + ".pyinstaller_bak"
        try:
            os.rename(d, bak)
            renamed.append((d, bak))
        except Exception as e:
            print(f"WARNING: 无法重命名 {d}: {e}")
    return renamed

def restore_pathlib_backport(renamed):
    for orig, bak in reversed(renamed):
        try:
            if os.path.exists(bak):
                os.rename(bak, orig)
        except Exception as e:
            print(f"WARNING: 无法恢复 {bak} -> {orig}: {e}")

def main():
    # 若曾误把 Anaconda lib 下的 pathlib.py 改名为 pathlib.py.backup，先提示恢复
    anaconda_lib = r"C:\ProgramData\anaconda3\lib"
    lib_backup = os.path.join(anaconda_lib, "pathlib.py.backup")
    lib_pathlib = os.path.join(anaconda_lib, "pathlib.py")
    if os.path.exists(lib_backup) and not os.path.exists(lib_pathlib):
        print("ERROR: 检测到 Anaconda 标准库 pathlib 已被重命名为 pathlib.py.backup。")
        print("请先恢复：以管理员身份在命令行执行：")
        print(f'  ren "{lib_backup}" "pathlib.py"')
        sys.exit(1)

    site_dirs = get_site_packages_dirs()
    if not site_dirs:
        print("ERROR: 无法确定 site-packages 目录")
        sys.exit(1)

    # 在所有 site-packages 中临时隐藏 pathlib backport，避免 PyInstaller 报错
    renamed = []
    pathlib_needs_exclude = False
    
    # 先检查是否存在 pathlib backport（特别是系统级的）
    for site_packages in site_dirs:
        pathlib_files = []
        pathlib_files.extend(glob.glob(os.path.join(site_packages, 'pathlib.py')))
        pathlib_files.extend(glob.glob(os.path.join(site_packages, 'pathlib')))
        pathlib_files.extend(glob.glob(os.path.join(site_packages, 'pathlib-*.dist-info')))
        
        if pathlib_files:
            # 尝试重命名
            result = hide_pathlib_backport(site_packages)
            renamed.extend(result)
            
            # 如果 pathlib 文件仍然存在（重命名失败），且是系统级目录，需要排除
            remaining = []
            remaining.extend(glob.glob(os.path.join(site_packages, 'pathlib.py')))
            remaining.extend(glob.glob(os.path.join(site_packages, 'pathlib')))
            remaining.extend(glob.glob(os.path.join(site_packages, 'pathlib-*.dist-info')))
            
            if remaining and ('ProgramData' in site_packages or 'Program Files' in site_packages):
                pathlib_needs_exclude = True
                print(f"\n警告: 检测到系统级 pathlib backport ({site_packages})，但无法重命名（需要管理员权限）。")
                print("将使用 PyInstaller 的 --exclude-module 参数来排除 pathlib。")
    
    if renamed:
        print("已临时隐藏 site-packages 中的 pathlib 包，打包完成后会自动恢复。")

    try:
        import PyInstaller.__main__
    except ImportError as e:
        restore_pathlib_backport(renamed)
        print(f"ERROR: 无法导入 PyInstaller: {e}")
        print("请安装: pip install pyinstaller")
        sys.exit(1)

    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)

    args = [
        'app.py',
        '--name=backend',
        '--onefile',
        '--clean',
        '--noconsole',
        '--hidden-import=flask',
        '--hidden-import=flask_cors',
        '--hidden-import=python_docx',
        '--hidden-import=docx',
        '--hidden-import=numpy',
        '--hidden-import=calculation_engine',
        '--hidden-import=word_export',
        '--collect-all=flask',
        '--collect-all=flask_cors',
    ]
    
    # 如果无法重命名 pathlib（权限问题），使用 --exclude-module 排除它
    # Python 3.4+ 内置了 pathlib，不需要 backport
    if pathlib_needs_exclude:
        args.append('--exclude-module=pathlib')
        print("已添加 --exclude-module=pathlib 参数")
    
    if sys.platform == 'win32':
        args.append('--icon=NONE')

    print('\n开始打包 Python 后端...')
    print(f'工作目录: {current_dir}')

    try:
        PyInstaller.__main__.run(args)
        print('\nSUCCESS: Python 后端打包完成！')
        exe_name = 'backend.exe' if sys.platform == 'win32' else 'backend'
        exe_path = os.path.join(current_dir, 'dist', exe_name)
        if os.path.exists(exe_path):
            size_mb = os.path.getsize(exe_path) / 1024 / 1024
            print(f'可执行文件: {exe_path}')
            print(f'文件大小: {size_mb:.2f} MB')
        else:
            print(f'WARNING: 未找到可执行文件: {exe_path}')
    except Exception as e:
        print(f'\nERROR: 打包失败: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        restore_pathlib_backport(renamed)
        if renamed:
            print("已恢复 site-packages 中的 pathlib 包。")

if __name__ == "__main__":
    main()
