# 为什么根目录和 frontend 下都有 node_modules？

## 当前结构

```
Flow Cal/
├── node_modules/          ← 根目录（仅少量包）
│   ├── electron/          ← 打包时 electron-builder 要读版本，必须在这里
│   ├── electron-updater/  ← 主进程 require('electron-updater')，打包会打进安装包
│   └── ...
├── frontend/
│   └── node_modules/      ← 前端与打包工具（大部分依赖）
│       ├── react, vite, electron, electron-builder, ...
│       └── ...
├── electron/
├── backend/
└── package.json           ← 应用入口 main: electron/main.js
```

## 各用哪边的 node_modules？

| 场景 | 使用的 node_modules |
|------|----------------------|
| `npm run dev`（开发） | **frontend**：`npm run dev --prefix frontend` 在 frontend 里跑，Vite + Electron 都用 frontend 的包 |
| `npm run build`（前端构建） | **frontend**：Vite 在 frontend 里跑 |
| `npm run dist:win`（打安装包） | **两边都用**：先用到 frontend 的 electron-builder；electron-builder 执行时以**根目录为项目根**，会读根目录的 package.json 和根目录的 **electron** 包版本 |
| 打包后的 exe 运行时 | 安装包里带的是根目录 package.json 里声明的依赖（如 electron-updater），由 electron-builder 打进 asar |

所以：

- **根目录 node_modules**：给「以根目录为项目根」的 electron-builder 用（必须能在这里找到 `electron`），以及主进程依赖（如 `electron-updater`）会随根目录 package.json 被打进安装包。
- **frontend/node_modules**：开发、构建、以及直接调用的 electron-builder 可执行文件都在这里。

## 能否全部移到 frontend 下？

**不能只保留 frontend 的 node_modules、删掉根的。**

原因：

1. **electron-builder 的约定**：在项目根执行打包时，它会在**项目根**下找 `package.json` 和 `node_modules/electron` 来决定 Electron 版本。项目根 = 放 `electron/main.js` 的那一层（即本仓库根目录）。
2. 即使用 `--projectDir ..` 从 frontend 里执行，`--projectDir` 只是指定「项目根目录」，electron-builder 仍然会在**该目录**下找 `node_modules/electron`，不会用 frontend 的。
3. 安装包里的主进程依赖（如 electron-updater）来自**根目录**的 package.json，所以根目录必须声明这些依赖；通常也会在根目录 `npm install` 出一份 node_modules，供打包时使用。

因此：根目录保留少量依赖（如 `electron`、`electron-updater`）并保留根目录的 node_modules，是当前 electron-builder 工作方式下的必要结构。

## 建议做法

- **保持现状**：根目录只装必要依赖（electron、electron-updater），其余全部在 frontend。
- 根目录安装：在仓库根执行一次 `npm install`，只会有少量包。
- 日常开发：主要用 frontend 的依赖；打包前在根目录执行 `npm install` 确保根目录 node_modules 存在即可。

这样根目录 node_modules 体积小、职责清晰，又满足 electron-builder 和打包结果的要求。
