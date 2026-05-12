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
const localAiEnabledRaw = String(process.env.CINF_PACK_LOCAL_AI || '1').trim().toLowerCase()
const localAiEnabled = !['0', 'false', 'off', 'no'].includes(localAiEnabledRaw)
const requirementsTxt = path.join(projectRoot, localAiEnabled ? 'requirements.txt' : 'requirements.noai.txt')
const systemPython = os.platform() === 'win32' ? 'python' : 'python3'

/** Windows 上仅凭 PyPI 常无 llama-cpp-python 预编译 wheel，需上游索引避免源码编译失败 */
const LLAMA_CPP_EXTRA_INDEX = 'https://abetlen.github.io/llama-cpp-python/whl/cpu'
const PYINSTALLER_MODE = (process.env.CINF_PYINSTALLER_MODE || 'onefile').trim()

function pipEnvWithLlamaIndex() {
  if (!localAiEnabled) return { ...process.env }
  return {
    ...process.env,
    PIP_EXTRA_INDEX_URL: LLAMA_CPP_EXTRA_INDEX,
  }
}
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
    // 本地 AI 版：先装 llama-cpp-python（abetlen CPU wheel），再装其余依赖，避免 pip 对 llama 走源码构建（需 MSVC/CMake）
    if (localAiEnabled) {
      execSync(
        `"${venvPython}" -m pip install "llama-cpp-python>=0.3.0" --upgrade --prefer-binary --extra-index-url ${LLAMA_CPP_EXTRA_INDEX}`,
        {
          stdio: 'inherit',
          cwd: projectRoot,
          windowsHide: true,
          env: pipEnvWithLlamaIndex(),
        }
      )
    }
    execSync(`"${venvPython}" -m pip install -r "${requirementsTxt}" --prefer-binary`, {
      stdio: 'inherit',
      cwd: projectRoot,
      windowsHide: true,
      env: pipEnvWithLlamaIndex(),
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
console.log('PyInstaller 模式:', PYINSTALLER_MODE)
console.log('本地 AI 部署:', localAiEnabled ? '启用' : '禁用')
console.log('依赖文件:', requirementsTxt)

/**
 * 每次打包前同步依赖：旧版 build_env 可能从未装上 llama_cpp；
 * 且仅靠 requirements.txt 在 Windows 上常会走源码编译失败，须追加 abetlen CPU wheel 索引。
 */
function ensurePythonDepsForPackaging(pythonExe) {
  const env = pipEnvWithLlamaIndex()
  if (localAiEnabled) {
    console.log('[build-python] llama-cpp-python（优先 abetlen CPU wheel）…')
    execSync(
      `"${pythonExe}" -m pip install "llama-cpp-python>=0.3.0" --upgrade --prefer-binary --extra-index-url ${LLAMA_CPP_EXTRA_INDEX}`,
      {
        cwd: projectRoot,
        stdio: 'inherit',
        windowsHide: true,
        env,
      }
    )
  }
  console.log(`[build-python] pip install -r ${path.basename(requirementsTxt)} …`)
  execSync(`"${pythonExe}" -m pip install -r "${requirementsTxt}" --prefer-binary`, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
    env,
  })
}

try {
  ensurePythonDepsForPackaging(pythonCmd)
} catch (e) {
  console.error('[build-python] 依赖安装失败:', e.message)
  process.exit(1)
}

if (localAiEnabled) {
  try {
    execSync(`"${pythonCmd}" -c "import llama_cpp; print('llama_cpp import ok')"`, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    })
  } catch (e) {
    console.error(
      '[build-python] 仍无法导入 llama_cpp。请检查本机 Python 版本是否有对应 wheel，或参阅 backend/README_ASSISTANT_LLM.txt。\n' +
        '可手动执行：\n' +
        `  "${pythonCmd}" -m pip install "llama-cpp-python>=0.3.0" --upgrade --extra-index-url ${LLAMA_CPP_EXTRA_INDEX}`
    )
    process.exit(1)
  }
}

if (!fs.existsSync(buildScript)) {
  console.error('构建脚本不存在:', buildScript)
  process.exit(1)
}

const buildEnv = {
  ...process.env,
  CINF_PYINSTALLER_MODE: PYINSTALLER_MODE,
  CINF_PACK_LOCAL_AI: localAiEnabled ? '1' : '0',
}
const proc = exec(`"${pythonCmd}" "${buildScript}"`, { cwd: backendDir, encoding: 'utf8', env: buildEnv }, (err, stdout, stderr) => {
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
