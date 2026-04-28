/**
 * 离线一机一证：设备指纹 + Ed25519 授权码，授权文件存 userData。
 * 公钥为 electron/license-public.pem（随安装包分发）；私钥仅用于 scripts/issue-offline-license.js，勿入仓库。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const LICENSE_BASENAME = 'offline-license.dat'
const TOKEN_PREFIX = 'CINF-LIC1.'

/**
 * 整行授权码在从微信/邮件复制时，常在「CINF-」与「LIC1.」之间被自动换行，导致验签失败；去掉空白并拼回前缀。
 */
function normalizeLicenseTokenInput(raw) {
  let s = String(raw).trim()
  s = s.replace(/\r\n/g, '\n')
  s = s.replace(/CINF-\s*[\r\n]+\s*LIC1/gi, 'CINF-LIC1')
  s = s.replace(/\s+/g, '')
  return s
}

let electronApp = null

function setElectronApp(app) {
  electronApp = app
}

function getUserDataPath() {
  if (!electronApp) throw new Error('license: Electron app not initialized')
  return electronApp.getPath('userData')
}

function getLicenseFilePath() {
  return path.join(getUserDataPath(), LICENSE_BASENAME)
}

function getPublicKeyPem() {
  const pubPath = path.join(__dirname, 'license-public.pem')
  if (!fs.existsSync(pubPath)) {
    return null
  }
  return fs.readFileSync(pubPath, 'utf8')
}

/** 收集 Windows 下相对稳定的信息并哈希为 64 位十六进制设备码 */
function collectMachineIdRaw() {
  const parts = []
  if (process.platform === 'win32') {
    try {
      // 使用 wmic 避免 asar 内 .ps1 无法作为 -File 执行；Win11 仍可用
      const run = (cmd) => {
        try {
          return execSync(cmd, { encoding: 'utf-8', timeout: 15000, windowsHide: true })
        } catch (e) {
          return ''
        }
      }
      const a = run('wmic csproduct get uuid /value')
      const b = run('wmic baseboard get serialnumber /value')
      const c = run('wmic bios get serialnumber /value')
      const t = [a, b, c]
        .join('\n')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      if (t) {
        parts.push('win', t)
      }
    } catch (e) {
      parts.push('win-fail', e && e.message ? String(e.message) : 'err')
    }
  }
  if (parts.length === 0) {
    parts.push(process.platform, os.hostname(), (os.userInfo() && os.userInfo().username) || '')
  }
  const raw = parts.join('\n|')
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
}

function buildPayloadObject(v, m, exp) {
  return { v, m, exp }
}

function payloadCanonicalString(p) {
  return JSON.stringify(buildPayloadObject(p.v, p.m, p.exp))
}

function parseAndVerifyToken(token, machineId, publicKeyPem) {
  if (!publicKeyPem || typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'bad_format' }
  }
  const rest = token.slice(TOKEN_PREFIX.length)
  const lastDot = rest.lastIndexOf('.')
  if (lastDot <= 0) return { ok: false, reason: 'bad_format' }
  const payloadB64 = rest.slice(0, lastDot)
  const sigB64 = rest.slice(lastDot + 1)
  let payload
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8')
    payload = JSON.parse(json)
  } catch (e) {
    return { ok: false, reason: 'bad_payload' }
  }
  if (payload.v !== 1 || typeof payload.m !== 'string' || !/^[0-9a-f]{64}$/i.test(payload.m)) {
    return { ok: false, reason: 'bad_payload' }
  }
  if (String(payload.m).toLowerCase() !== String(machineId).toLowerCase()) {
    return { ok: false, reason: 'machine_mismatch' }
  }
  if (payload.exp != null) {
    const exp = Number(payload.exp)
    if (Number.isFinite(exp) && exp * 1000 < Date.now()) {
      return { ok: false, reason: 'expired' }
    }
  }
  const msg = Buffer.from(payloadCanonicalString(payload), 'utf8')
  let keyObject
  try {
    keyObject = crypto.createPublicKey(publicKeyPem)
  } catch (e) {
    return { ok: false, reason: 'no_public_key' }
  }
  const sig = Buffer.from(sigB64, 'base64url')
  const valid = crypto.verify(null, msg, keyObject, sig)
  if (!valid) return { ok: false, reason: 'bad_signature' }
  return { ok: true, payload }
}

function readSavedToken() {
  try {
    const p = getLicenseFilePath()
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p, 'utf8').trim()
  } catch (e) {
    return null
  }
}

function saveLicenseToken(token) {
  const p = getLicenseFilePath()
  fs.writeFileSync(p, token, 'utf8')
}

function clearLicense() {
  try {
    const p = getLicenseFilePath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch (e) {
    /* ignore */
  }
}

/**
 * isDev: 开发不校验
 * 无公钥文件：生产环境阻断激活，避免发布包缺少验签材料仍继续使用。
 */
function getLicenseStatus(isDev) {
  const machineId = collectMachineIdRaw()
  if (isDev) {
    return { ok: true, machineId, reason: 'dev', expiresAtMs: null }
  }
  const publicKeyPem = getPublicKeyPem()
  if (!publicKeyPem) {
    return { ok: false, machineId, reason: 'no_public_key_file' }
  }
  const token = readSavedToken()
  if (!token) {
    return { ok: false, machineId, reason: 'no_license' }
  }
  const v = parseAndVerifyToken(normalizeLicenseTokenInput(token), machineId, publicKeyPem)
  if (v.ok) {
    let expiresAtMs = null
    if (v.payload && v.payload.exp != null) {
      const sec = Number(v.payload.exp)
      if (Number.isFinite(sec)) expiresAtMs = Math.floor(sec * 1000)
    }
    return { ok: true, machineId, reason: 'licensed', expiresAtMs }
  }
  return { ok: false, machineId, reason: v.reason || 'invalid' }
}

function activateWithToken(isDev, token) {
  const machineId = collectMachineIdRaw()
  if (isDev) {
    return { ok: true, machineId }
  }
  const publicKeyPem = getPublicKeyPem()
  if (!publicKeyPem) {
    return { ok: false, error: '未找到公钥（license-public.pem），无法激活。' }
  }
  if (!token || !String(token).trim()) {
    return { ok: false, error: '请粘贴完整授权码。' }
  }
  const rawInput = String(token).trim()
  // 常见误操作：把 license-public.pem 当授权码粘贴（公钥已内置在程序里，不能当授权码用）
  if (/-----BEGIN\s+(PUBLIC|PRIVATE)\s+KEY-----/i.test(rawInput) || /BEGIN\s+CERTIFICATE/i.test(rawInput)) {
    return {
      ok: false,
      error:
        '您粘贴的是公钥/证书（PEM）内容。公钥已随安装包内置，这里不用填。' +
        ' 请让发布方用「本机设备码」运行 issue-offline-license.js 生成一行以 CINF-LIC1. 开头的授权码发给您，再整行粘贴到此处。',
    }
  }
  const trimmed = normalizeLicenseTokenInput(rawInput)
  const v = parseAndVerifyToken(trimmed, machineId, publicKeyPem)
  if (!v.ok) {
    const map = {
      bad_format: '授权码格式不正确。',
      bad_payload: '授权码内容无法解析。',
      machine_mismatch: '授权码与当前设备不匹配，请使用本机设备码向发布方申请授权。',
      expired: '授权已过期。',
      bad_signature:
        '授权码签名无效。请确认发布方用当前安装包对应私钥签发；若从微信/邮件复制，勿在 CINF-LIC1 中间断行，可粘贴到「记事本」删换行后整行再复制。',
    }
    return { ok: false, error: map[v.reason] || '授权码无效。' }
  }
  saveLicenseToken(trimmed)
  return { ok: true, machineId }
}

module.exports = {
  setElectronApp,
  getLicenseStatus,
  activateWithToken,
  clearLicense,
  collectMachineIdRaw,
  LICENSE_BASENAME,
  TOKEN_PREFIX,
}
