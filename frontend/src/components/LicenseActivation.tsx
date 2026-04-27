import { useState, useEffect } from 'react'
import { APP_TAGLINE_MAIN_EN, APP_TAGLINE_ZH } from '../constants/appCopy'

type LicenseApi = {
  getStatus: () => Promise<{
    ok: boolean
    machineId?: string
    reason?: string
  }>
  activate: (token: string) => Promise<{ ok: boolean; error?: string; machineId?: string }>
}

const copy = {
  zh: {
    title: '产品激活',
    desc: '使用本软件前需完成许可激活。请复制下方「设备标识」并发送至授权方；取得「许可密钥」后粘贴至下方，单击「激活」。许可与当前设备绑定。',
    deviceLabel: '设备标识',
    copy: '复制',
    copied: '已复制',
    licenseLabel: '许可密钥',
    placeholder: '粘贴完整许可密钥（单行；以 CINF-LIC1. 开头。若自通讯工具复制时断行，请先粘贴至记事本合并为一行）',
    activate: '激活',
    activating: '正在激活…',
    success: '激活成功',
    needElectron: '请在已安装的桌面版中完成激活。浏览器访问无法完成此步骤。',
  },
  en: {
    title: 'Product activation',
    desc: 'A valid license is required. Copy the device ID below and send it to your software provider. Paste the license key you receive, then click Activate. The license is tied to this device.',
    deviceLabel: 'Device ID',
    copy: 'Copy',
    copied: 'Copied',
    licenseLabel: 'License key',
    placeholder: 'Paste the full license key in one line (starts with CINF-LIC1.).',
    activate: 'Activate',
    activating: 'Activating…',
    success: 'Activated',
    needElectron: 'Use the installed desktop app to complete activation.',
  },
}

export default function LicenseActivation({
  language,
  onActivated,
}: {
  language: 'zh' | 'en'
  onActivated: () => void
}) {
  const t = copy[language]
  const [machineId, setMachineId] = useState<string>('')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const api = (typeof window !== 'undefined' && (window as any).electronAPI?.license) as LicenseApi | undefined
    if (!api) return
    api.getStatus().then((s) => {
      if (s.machineId) setMachineId(s.machineId)
    })
  }, [])

  const copyId = () => {
    if (!machineId) return
    void navigator.clipboard.writeText(machineId).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  const activate = async () => {
    const api = (window as any).electronAPI?.license as LicenseApi | undefined
    if (!api) {
      setError(t.needElectron)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await api.activate(input.trim())
      if (r.ok) {
        onActivated()
        return
      }
      setError(r.error || (language === 'zh' ? '激活失败' : 'Activation failed'))
    } catch (e: any) {
      setError(e?.message || (language === 'zh' ? '激活失败' : 'Activation failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-lg p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">{t.title}</h1>
        <p className="text-sm text-slate-500 mb-2">{language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}</p>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">{t.desc}</p>

        <div className="mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">{t.deviceLabel}</div>
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs break-all text-slate-800 min-h-[2.5rem]">
              {machineId || '—'}
            </div>
            <button
              type="button"
              onClick={copyId}
              disabled={!machineId}
              className="shrink-0 px-3 py-2 rounded-lg bg-slate-100 text-slate-800 text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">{t.licenseLabel}</div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.placeholder}
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {error && <div className="mb-3 text-sm text-red-600 whitespace-pre-line">{error}</div>}

        <button
          type="button"
          onClick={activate}
          disabled={busy || !input.trim()}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? t.activating : t.activate}
        </button>
      </div>
    </div>
  )
}
