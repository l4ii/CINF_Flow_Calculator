const { execSync, exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const backendDir = path.join(__dirname, '..', 'backend')
const projectRoot = path.join(__dirname, '..')
const buildScript = path.join(backendDir, 'build_backend.py')
const buildEnvDir = path.join(projectRoot, 'build_env')
const venvPython = os.platform() === 'win32'
  ? path.join(buildEnvDir, 'Scripts', 'python.exe')
  : path.join(buildEnvDir, 'bin', 'python3')
const requirementsTxt = path.join(projectRoot, 'requirements.txt')
const systemPython = os.platform() === 'win32' ? 'python' : 'python3'

/** Windows：py -3 可能指向已损坏或缺失的 Python313；依次尝试 3.11 / 3.10 / python */
function createVenvWindows() {
  const cmds = [
    `py -3.11 -m venv "${buildEnvDir}"`,
    `py -3.10 -m venv "${buildEnvDir}"`,
    `python -m venv "${buildEnvDir}"`,
  ]
  let lastErr
  for (const cmd of cmds) {
    try {
      execSync(cmd, {
        stdio: 'inherit',
        cwd: projectRoot,
        windowsHide: true,
        shell: true,
      })
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function ensureBuildEnv() {
  if (fs.existsSync(venvPython)) {
    return venvPython
  }
  console.log('未检测到 build_env，正在创建专用虚拟环境（可避免 Anaconda pathlib 与 PyInstaller 冲突）...')
  try {
    if (os.platform() === 'win32') {
      createVenvWindows()
    } else {
      execSync(`"${systemPython}" -m venv "${buildEnvDir}"`, {
        stdio: 'inherit',
        cwd: projectRoot,
        windowsHide: true,
      })
    }
    // 使用 python -m pip，避免移动项目目录后 pip.exe 启动器仍指向旧路径
    execSync(`"${venvPython}" -m pip install -r "${requirementsTxt}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
      windowsHide: true,
    })
    console.log('build_env 已就绪。')
  } catch (e) {
    console.error('创建 build_env 失败:', e.message)
    process.exit(1)
  }
  return venvPython
}

const pythonCmd = fs.existsSync(venvPython) ? venvPython : ensureBuildEnv()
console.log('Python:', pythonCmd)
console.log('工作目录:', backendDir)

if (!fs.existsSync(buildScript)) {
  console.error('构建脚本不存在:', buildScript)
  process.exit(1)
}

const proc = exec(`"${pythonCmd}" "${buildScript}"`, { cwd: backendDir, encoding: 'utf8' }, (err, stdout, stderr) => {
  if (err) {
    console.error('构建失败:', err.message)
    if (stderr) console.error(stderr)
    process.exit(err.code || 1)
  }
})
proc.stdout.on('data', (d) => process.stdout.write(d))
proc.stderr.on('data', (d) => process.stderr.write(d))
proc.on('close', (code) => {
  if (code === 0) console.log('Python 后端构建完成')
  else process.exit(code)
})
