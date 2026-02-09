# 浆体管道临界流速计算工具

长沙有色冶金设计研究院有限公司开发的浆体管道临界流速计算专业工具。

## 📋 项目简介

这是一个基于 Electron + React + Python Flask 开发的桌面应用程序，用于计算浆体管道临界流速。支持多种国际标准公式，提供可视化动画展示，并可导出计算书。

## ✨ 功能特性

- 🔢 **多种计算公式支持**：支持 E.J.瓦斯普公式等多种临界流速计算公式
- 📊 **实时计算**：参数输入后实时计算并显示结果
- 🎬 **可视化动画**：根据计算结果动态展示管道内颗粒流动状态
- 📄 **计算书导出**：支持导出 Word 格式的计算文档
- 🌙 **暗色模式**：支持浅色/暗色主题切换
- 🔄 **自动更新**：内置更新检查功能，支持自动更新
- 🌐 **多语言支持**：支持中文和英文界面

## 🛠️ 技术栈

- **前端**: React 18 + TypeScript + Vite + TailwindCSS
- **后端**: Python 3.8+ + Flask
- **桌面应用**: Electron 28
- **数学渲染**: KaTeX
- **文档生成**: python-docx

## 📦 安装和运行

### 环境要求

- Node.js 16+
- Python 3.8+
- npm 或 yarn

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装 Python 依赖
pip install -r requirements.txt
```

### 开发模式运行

```bash
# 启动开发服务器（同时启动前端和 Electron）
npm run dev
```

### 打包应用

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

打包后的安装程序位于 `release` 目录。

## 📁 项目结构

```
├── src/              # 前端源代码
│   ├── components/  # React 组件
│   ├── config/      # 配置文件
│   └── types.ts     # TypeScript 类型定义
├── backend/         # Python 后端
│   ├── app.py       # Flask 应用入口
│   ├── calculation_engine.py  # 计算引擎
│   └── word_export.py         # Word 文档导出
├── electron/        # Electron 主进程
│   ├── main.js      # 主进程文件
│   └── preload.js   # 预加载脚本
├── public/          # 静态资源（图片等）
├── assets/           # 资源文件
├── docs/            # 文档目录
└── build/           # 构建资源
```

## 📚 文档

- [更新服务器配置指南](./docs/UPDATE_SERVER_GUIDE.md) - 如何配置自动更新功能

## 🔧 开发说明

### 启动后端服务器

```bash
npm run start:backend
# 或
python backend/app.py
```

后端服务默认运行在 `http://127.0.0.1:5000`

### 前端开发

```bash
npm run dev:react
```

前端开发服务器运行在 `http://localhost:5173`

## 📝 使用说明

1. 选择计算公式
2. 输入相关参数（管径、流速、浓度等）
3. 点击"开始运算"进行计算
4. 查看计算结果和可视化动画
5. 可选择导出计算书（Word 格式）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 [MIT License](./LICENSE.txt)

## 👥 开发团队

长沙有色冶金设计研究院有限公司

## 📮 联系方式

- 公司网站: https://cinf.chinalco.com.cn/
- 联系地址: 湖南省长沙市雨花区木莲东路299号
- 邮政编码: 410019

---

**注意**: 首次运行需要确保 Python 环境已正确配置，并且已安装所有依赖。
