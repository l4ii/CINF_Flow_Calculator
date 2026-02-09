@echo off
chcp 65001 >nul
echo 正在启动浆体管道临界流速计算工具...
echo.

echo [1/3] 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Python环境，请先安装Python
    pause
    exit /b 1
)

echo [2/3] 检查Node.js环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Node.js环境，请先安装Node.js
    pause
    exit /b 1
)

echo [3/3] 启动应用...
echo.
echo 提示: 请保持此窗口打开，关闭窗口将停止后端服务
echo.

start "前端开发服务器" cmd /k "npm run dev:react"
timeout /t 3 /nobreak >nul
start "Electron应用" cmd /k "npm run dev:electron"
timeout /t 2 /nobreak >nul

echo 正在启动后端API服务器...
python backend/app.py

pause
