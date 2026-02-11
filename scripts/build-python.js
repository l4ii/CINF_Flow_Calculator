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

function ensureBuildEnv() {
  if (fs.existsSync(venvPython)) {
    return venvPython
  }
  console.log('未检测到 build_env，正在创建专用虚拟环境（可避免 Anaconda pathlib 与 PyInstaller 冲突）...')
  try {
    execSync(`"${systemPython}" -m venv "${buildEnvDir}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
      windowsHide: true
    })
    const pip = os.platform() === 'win32'
      ? path.join(buildEnvDir, 'Scripts', 'pip.exe')
      : path.join(buildEnvDir, 'bin', 'pip')
    execSync(`"${pip}" install -r "${requirementsTxt}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
      windowsHide: true
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
