/**
 * 连续打四套 Windows 包（Win10+×2 + Win7/8×2），各用独立输出目录以免 clean 互相覆盖。
 * npm run dist:win:all4 / npm run dist:all4
 */
const { execSync } = require('child_process')

function run(script) {
  execSync(script, { stdio: 'inherit', env: process.env })
}

console.log('[dist-win-all4] 将依次构建：release-qwen → release → release-win7-qwen → release-win7\n')

run('npm run dist:win:ai')
run('npm run dist:win:noai')
run('npm run dist:win7:ai')
run('npm run dist:win7:noai')

console.log(`
[dist-win-all4] 完成。安装程序大致位置（文件名含版本号与架构）：

  • release-qwen\\            内置本地 Qwen 助手（后缀 _Qwen）
  • release\\                无本地 AI/GGUF（无前缀后缀）
  • release-win7-qwen\\       Win7/8 + Qwen（-Win7_Qwen）
  • release-win7\\            Win7/8，无 AI（-Win7）
`)
