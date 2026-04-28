import { useState, useEffect } from 'react'
import { APP_NAME_EN, APP_NAME_ZH, APP_TAGLINE_MAIN_EN, APP_TAGLINE_ZH } from '../constants/appCopy'

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
    pageKicker: APP_NAME_ZH,
    zoneIntroTitle: '产品介绍与授权联络',
    zoneIntroAuth:
      '使用本软件需取得与本机绑定的使用许可。请将下方「产品激活」中的设备标识发给授权方申请密钥；取得许可密钥后在同一区域粘贴并完成激活。',
    contactTitle: '授权方与联络方式',
    orgName: '长沙有色冶金设计研究院有限公司',
    orgBlurb:
      '（简称长沙有色院）创建于1953年，为国家高新技术企业、国家技术创新示范企业、国家企业技术中心；隶属中国铝业集团有限公司。许可相关事宜请通过下列邮箱或「联系开发者」洽询。',
    addrLabel: '地址',
    addrLine: '湖南省长沙市雨花区木莲东路299号　邮编 410019',
    mailGeneral: '综合邮箱',
    mailMarket: '生产运营中心',
    mailIntl: '海外业务中心',
    contactDeveloper: '联系开发者（反馈与本软件授权咨询）',
    zoneActivationTitle: '产品激活',
    activationHint:
      '复制「设备标识」发送至授权方以获取许可密钥；密钥与当前设备绑定。密钥以 CINF-LIC1 开头，请整段一行粘贴。若从通讯工具复制发生断行，可先粘贴至记事本合并为一行后再粘贴到此处。',
    deviceLabel: '设备标识',
    copy: '复制',
    copied: '已复制',
    licenseLabel: '许可密钥',
    placeholder: '许可密钥以 CINF-LIC1 开头，整段粘贴即可。',
    activate: '激活',
    activating: '正在激活…',
    success: '激活成功',
    needElectron: '请在已安装的桌面版中完成激活。浏览器访问无法完成此步骤。',
  },
  en: {
    pageKicker: APP_NAME_EN,
    zoneIntroTitle: 'Overview & licensing contacts',
    zoneIntroAuth:
      'A device-bound license is required. Copy the device ID from the section below and request a key from your provider; paste the license key there to activate.',
    contactTitle: 'Licensor & contact',
    orgName: 'Changsha Engineering & Research Institute of Nonferrous Metals Co., Ltd.',
    orgBlurb:
      'A national high-tech enterprise and enterprise technology center under Aluminum Corporation of China. For licensing, use the emails below or contact the developer.',
    addrLabel: 'Address',
    addrLine: 'No.299 Mulian East Rd., Yuhua District, Changsha, Hunan, China · 410019',
    mailGeneral: 'General',
    mailMarket: 'Operations / Market',
    mailIntl: 'International',
    contactDeveloper: 'Contact developer (feedback & licensing)',
    zoneActivationTitle: 'Activation',
    activationHint:
      'Send your device ID to obtain a license key tied to this machine. Paste one full line starting with CINF-LIC1.',
    deviceLabel: 'Device ID',
    copy: 'Copy',
    copied: 'Copied',
    licenseLabel: 'License key',
    placeholder: 'CINF-LIC1.…',
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

  const mailSubjectDev = encodeURIComponent(`【${APP_NAME_ZH}】软件建议与反馈`)
  const mailBodyDev = encodeURIComponent(
    `软件名称：${APP_NAME_ZH}\n\n建议/反馈类型：□ 功能建议  □ 问题反馈  □ 授权咨询  □ 其他\n\n内容说明：\n\n\n\n`
  )

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

  const mailDevHref = `mailto:xuqianglai@outlook.com?subject=${mailSubjectDev}&body=${mailBodyDev}`

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
        <div className="px-8 pt-8 pb-2 border-b border-slate-100 bg-white">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{t.pageKicker}</p>
          <p className="text-sm text-slate-500 mt-1">
            {language === 'en' ? APP_TAGLINE_MAIN_EN : APP_TAGLINE_ZH}
          </p>
        </div>

        {/* 专区一：产品介绍与联络 */}
        <section className="px-8 py-6 bg-slate-50/90 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900 mb-3">{t.zoneIntroTitle}</h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-5">{t.zoneIntroAuth}</p>

          <h3 className="text-sm font-semibold text-slate-800 mb-3">{t.contactTitle}</h3>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-900">{t.orgName}</div>
            <p className="text-slate-600 text-xs leading-relaxed mt-1.5">{t.orgBlurb}</p>
            <div className="mt-4 grid gap-3 text-xs sm:text-sm">
              <div>
                <span className="text-slate-500">{t.addrLabel}：</span>
                <span className="text-slate-700">{t.addrLine}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <span className="text-slate-500 shrink-0">{t.mailGeneral}</span>
                <a href="mailto:cinf@chinalco.com.cn" className="text-blue-600 hover:text-blue-700 break-all">
                  cinf@chinalco.com.cn
                </a>
              </div>
              {language === 'zh' && (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 items-baseline">
                    <span className="text-slate-500 shrink-0">{t.mailMarket}</span>
                    <a href="mailto:cinf_scjy@chinalco.com.cn" className="text-blue-600 hover:text-blue-700 break-all">
                      cinf_scjy@chinalco.com.cn
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 items-baseline">
                    <span className="text-slate-500 shrink-0">{t.mailIntl}</span>
                    <a href="mailto:cinf_intl@chinalco.com.cn" className="text-blue-600 hover:text-blue-700 break-all">
                      cinf_intl@chinalco.com.cn
                    </a>
                  </div>
                </>
              )}
              <div className="pt-2 border-t border-slate-100 mt-1">
                <a href={mailDevHref} className="text-blue-600 hover:text-blue-700 font-medium">
                  {t.contactDeveloper}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 专区二：产品激活（文案与设置页「产品许可」区块对齐） */}
        <section className="px-8 py-7">
          <h2 className="text-lg font-bold text-slate-900 mb-2">{t.zoneActivationTitle}</h2>
          <p className="text-xs text-slate-500 leading-relaxed mb-5">{t.activationHint}</p>

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
        </section>
      </div>
    </div>
  )
}
