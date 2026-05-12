/**
 * 在 electron-builder 之前暂存「易被 gitignore 排除但必须打进安装包」的文件。
 * 当前：嵌入式助手 GGUF → build/pack-resources/backend/models/assistant.gguf
 *
 * 源路径：环境变量 CINF_ASSISTANT_GGUF，或 backend/models/assistant.gguf
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const src = path.resolve(process.env.CINF_ASSISTANT_GGUF || path.join(root, 'backend', 'models', 'assistant.gguf'))
const destDir = path.join(root, 'build', 'pack-resources', 'backend', 'models')
const dest = path.join(destDir, 'assistant.gguf')
const localAiEnabledRaw = String(process.env.CINF_PACK_LOCAL_AI || '1').trim().toLowerCase()
const localAiEnabled = !['0', 'false', 'off', 'no'].includes(localAiEnabledRaw)

fs.mkdirSync(destDir, { recursive: true })

if (!localAiEnabled) {
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest)
    } catch (_) {
      /* ignore */
    }
  }
  console.log('[stage-pack-resources] 已禁用本地 AI 部署资源打包（CINF_PACK_LOCAL_AI=0），跳过 GGUF。')
  process.exit(0)
}

if (!fs.existsSync(src)) {
  console.error(
    '[stage-pack-resources] 未找到嵌入式助手模型 GGUF，无法打入安装包。\n' +
      `  请将权重文件放到: ${path.join(root, 'backend', 'models', 'assistant.gguf')}\n` +
      '  或设置环境变量 CINF_ASSISTANT_GGUF 指向任意路径下的 .gguf 后再打包。\n' +
      '  （*.gguf 通常被 .gitignore 排除，构建机上仍需自备该文件；详见 backend/README_ASSISTANT_LLM.txt）'
  )
  process.exit(1)
}

fs.copyFileSync(src, dest)
console.log('[stage-pack-resources] 已复制助手模型:', dest)
