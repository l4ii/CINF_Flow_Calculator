# 浆体管道临界流速计算工具

长沙有色冶金设计研究院有限公司开发的浆体管道临界流速计算专业工具。

## 功能特性

- 多种临界流速计算公式支持
- 实时计算和结果展示
- 可视化动画展示流动状态
- 计算书导出功能
- 暗色模式支持
- 自动更新功能

## 技术栈

- **前端**: React + TypeScript + Vite + TailwindCSS
- **后端**: Python Flask
- **桌面应用**: Electron

## 开发环境要求

- Node.js 16+
- Python 3.8+
- npm 或 yarn

## 安装和运行

### 安装依赖

```bash
# 安装前端依赖
npm install

# 安装 Python 依赖
pip install -r requirements.txt
```

### 开发模式

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

## 项目结构

```
├── src/              # 前端源代码
├── backend/          # Python 后端
├── electron/         # Electron 主进程
├── public/           # 静态资源（图片等）
├── assets/           # 资源文件
├── docs/             # 文档
└── build/            # 构建资源
```

## 文档

详细文档请查看 [docs](./docs/) 目录：

- [更新服务器配置指南](./docs/UPDATE_SERVER_GUIDE.md)

## 许可证

详见 [LICENSE.txt](./LICENSE.txt)

## 联系方式

长沙有色冶金设计研究院有限公司
