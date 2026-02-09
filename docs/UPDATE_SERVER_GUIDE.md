# 自动更新服务器配置指�?
## 概述

Electron 应用支持自动更新功能。应用会在启动时自动检查更新，用户也可以在设置页面手动检查更新�?
## 更新服务器选项

### 选项1: GitHub Releases (推荐，免�?

如果你有 GitHub 仓库，可以使�?GitHub Releases 作为更新服务器�?
#### 配置步骤�?
1. **修改 `electron-builder.yml`**:
```yaml
publish:
  provider: github
  owner: your-username
  repo: your-repo-name
```

2. **设置 GitHub Token**:
   - 创建 GitHub Personal Access Token (需�?`repo` 权限)
   - 设置环境变量: `export GH_TOKEN=your_token` (Linux/Mac) �?`set GH_TOKEN=your_token` (Windows)

3. **打包并发�?*:
```bash
npm run build:win
# electron-builder 会自动上传到 GitHub Releases
```

#### 优点�?- 免费
- 自动生成更新文件
- 支持版本管理
- 无需自己搭建服务�?
### 选项2: 通用 HTTP 服务�?
使用自己�?HTTP 服务器托管更新文件�?
#### 服务器文件结构：

```
updates/
├── latest.yml                    # Windows/Linux 更新清单
├── latest-mac.yml               # macOS 更新清单
├── 浆体管道临界流速计算工�?1.0.1-x64.exe  # Windows 安装�?├── 浆体管道临界流速计算工�?1.0.1-x64.exe.blockmap
└── ...
```

#### 配置步骤�?
1. **修改 `electron-builder.yml`**:
```yaml
publish:
  provider: generic
  url: https://your-server.com/updates
```

2. **打包应用**:
```bash
npm run build:win
```

3. **上传文件到服务器**:
   - �?`release` 目录中的文件上传到服务器�?`updates` 目录
   - 确保服务器支�?HTTPS（推荐）�?HTTP

#### 服务器要求：

- 支持静态文件服�?- 支持 HTTPS（推荐）�?HTTP
- 正确设置 CORS 头（如果需要）
- 文件访问权限正确

### 选项3: 本地/内网服务�?
如果应用仅在内网使用，可以使用内网服务器�?
#### 配置示例�?
```yaml
publish:
  provider: generic
  url: http://192.168.1.100:8080/updates
```

## 更新文件说明

electron-builder 会自动生成以下文件：

- **latest.yml** (Windows/Linux): 包含最新版本信息、下载链接、文件哈希等
- **latest-mac.yml** (macOS): macOS 版本的更新清�?- **安装包文�?*: 实际的安装程�?- **blockmap 文件**: 用于增量更新的文件块映射

## 版本号管�?
更新基于 `package.json` 中的 `version` 字段�?
```json
{
  "version": "1.0.1"
}
```

每次发布新版本时，需要：
1. 更新 `package.json` 中的版本�?2. 重新打包应用
3. 上传到更新服务器

## 测试更新功能

### 开发环境测试：

1. 修改 `package.json` 版本号为更高版本（如 `1.0.1`�?2. 打包应用: `npm run build:win`
3. 将更新文件上传到服务�?4. 运行旧版本应用，点击"检查更�?

### 注意事项�?
- 开发环�?(`npm run dev`) 不会检查更�?- 只有打包后的应用才会检查更�?- 确保更新服务器的 URL 可以从客户端访问

## 更新流程

1. **应用启动**: 延迟 5 秒后自动检查更新（不阻塞启动）
2. **手动检�?*: 用户在设置页面点�?检查更�?
3. **发现更新**: 显示新版本信息和下载按钮
4. **下载更新**: 显示下载进度
5. **安装更新**: 下载完成后，用户点击"立即重启并安�?
6. **自动安装**: 应用退出时自动安装更新（如果已下载�?
## 故障排除

### 更新检查失败：

1. 检查网络连�?2. 检查更新服务器 URL 是否正确
3. 检查服务器是否可访�?4. 查看控制台错误信�?
### 更新下载失败�?
1. 检查服务器文件是否存在
2. 检查文件权�?3. 检查网络连�?4. 检查磁盘空�?
### 更新安装失败�?
1. 确保应用有管理员权限（Windows�?2. 检查防病毒软件是否阻止
3. 确保旧版本应用已完全关闭

## 安全建议

1. **使用 HTTPS**: 确保更新服务器使�?HTTPS
2. **签名验证**: electron-builder 会自动验证更新文件签�?3. **版本验证**: 确保版本号递增
4. **文件完整�?*: blockmap 文件用于验证文件完整�?
## 示例：使�?Nginx 作为更新服务�?
```nginx
server {
    listen 443 ssl;
    server_name updates.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location /updates {
        alias /path/to/updates;
        add_header Access-Control-Allow-Origin *;
        add_header Content-Type application/octet-stream;
    }
}
```

## 更多信息

- [electron-updater 文档](https://www.electron.build/auto-update)
- [electron-builder 发布配置](https://www.electron.build/configuration/publish)

