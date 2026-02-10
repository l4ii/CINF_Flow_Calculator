const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const backendDir = path.join(__dirname, '..', 'backend')
const projectRoot = path.join(__dirname, '..')
const buildScript = path.join(backendDir, 'build_backend.py')

const venvPython = os.platform() === 'win32'
  ? path.join(projectRoot, 'build_env', 'Scripts', 'python.exe')
  : path.join(projectRoot, 'build_env', 'bin', 'python3')

let pythonCmd = fs.existsSync(venvPython) ? venvPython : (os.platform() === 'win32' ? 'python' : 'python3')
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
