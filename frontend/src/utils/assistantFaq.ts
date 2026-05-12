import type { AssistantWorkspaceSnapshot } from '../context/AssistantContext'
import type { CalculationResult } from '../types'
import { APP_NAME_EN, APP_NAME_ZH, APP_ORG_NAME_EN } from '../constants/appCopy'

/** 与侧栏「了解我们 → 长沙有色冶金设计研究院」一致的机构与联系方式摘要（勿臆造条目之外的信息） */
const ABOUT_ORG_ZH_LINES = [
  '本产品信息与对外联络请以侧栏「了解我们」页面的完整版面为准。',
  '机构概要：长沙有色冶金设计研究院有限公司（简称长沙有色院）成立于1953年，为国家高新技术企业、国家技术创新示范企业、国家企业技术中心；隶属于中国铝业集团有限公司，为中铝国际工程股份有限公司子公司。',
  '科研条线：院内设有科研创新中心，统筹科技创新与成果转化，并与多个国家及省级工程技术研究中心等平台协同联动。侧栏「了解我们 → 科研创新中心」可查阅各省级平台名录与简介。',
  '业务部门示例：市政事业部聚焦于废水治理与浆体输送等工程技术（侧栏对应「了解我们 → 市政事业部」）。',
].join('\n')

const CONTACT_ZH_LINES = [
  '联系方式（公司与业务）：',
  '· 地址：湖南省长沙市雨花区木莲东路299号，邮编410019。',
  '· 办公室电话：0731-84397032；传真：0731-82228112；总机对外邮箱：cinf@chinalco.com.cn',
  '对外联络：',
  '· 生产运营中心（市场开发部）：0731-84397070，cinf_scjy@chinalco.com.cn',
  '· 海外业务中心（海外发展中心）：0086-731-84397078 / 84397079，cinf_intl@chinalco.com.cn',
  '· 人力资源部（党委组织部）：0731-84397022',
].join('\n')

const ABOUT_ORG_EN_LINES = [
  `Official materials: use the sidebar “About Us” pages in the product for full text and visuals.`,
  `Organization (from product UI copy): ${APP_ORG_NAME_EN} (Chinese legal name shown in-app: 长沙有色冶金设计研究院有限公司), established in 1953; national high‑tech enterprise, national technological innovation demonstration enterprise, and national enterprise technology center; part of Aluminum Corporation of China, subsidiary of Aluminum Corporation of China International Engineering.`,
  `R&D hub: Research Innovation Center coordinates R&D and technology transfer with multiple national/provincial engineering technology centers — see sidebar About → Research.`,
  `Example division: Municipal Division covers wastewater and slurry transport engineering — see sidebar About → Municipal.`,
].join('\n')

const CONTACT_EN_LINES = [
  `Contact (from the company About page — verify on screen before official use):`,
  `Address: No.299 Mulian East Road, Yuhua District, Changsha, Hunan, China. Post code 410019.`,
  `Office: +86-731-84397032. Fax: +86-731-82228112. Email: cinf@chinalco.com.cn`,
  `Production & market: +86-731-84397070, cinf_scjy@chinalco.com.cn`,
  `Overseas: +86-731-84397078 / 84397079, cinf_intl@chinalco.com.cn`,
  `HR: +86-731-84397022`,
].join('\n')

export function buildAssistantWelcome(language: 'zh' | 'en'): string {
  if (language === 'en') {
    return [
      `Welcome to ${APP_NAME_EN}.`,
      '',
      `I am this product’s assistant. I can help you with:`,
      '• Finding and opening computation pages via the left sidebar.',
      '• Entering parameters as labeled, running calculations, and exporting Word where supported.',
      '• Clarifying common on-screen cues and interpreting the latest calculation result on the current page.',
      '',
      'Please describe your question.',
    ].join('\n')
  }
  return [
    `欢迎使用「${APP_NAME_ZH}」。`,
    '',
    '我是本软件的智能助手，可协助您完成以下事项：',
    '• 在左侧侧栏各分组中查找并打开所需计算页面；',
    '• 按字段说明填写参数、执行计算，并在支持时导出 Word；',
    '• 说明界面上的常用提示含义，并对当前页最近一次计算结果作解读；',
    '',
    '请描述您的问题。',
  ].join('\n')
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function briefResultLine(c: CalculationResult | null, language: 'zh' | 'en'): string | null {
  if (!c) return null
  if (language === 'en') {
    if (!c.success) return `Last calculation: failed — ${c.error ?? 'unknown error'}.`
    const r = c.result
    const parts: string[] = ['Last calculation: success.']
    if (r?.Vc != null) parts.push(`Vc ≈ ${r.Vc} (${r.unit ?? ''}).`)
    if (r?.condition_met !== undefined) parts.push(`condition_met: ${String(r.condition_met)}.`)
    if (c.animation_type) {
      parts.push(
        `animation_type: ${c.animation_type}${c.velocity_ratio != null ? `, ratio ${c.velocity_ratio.toFixed(3)}` : ''}.`
      )
    }
    parts.push('Richer interpretation is available once the smart-analysis backend is enabled by configuration.')
    return parts.join(' ')
  }
  if (!c.success) return `当前公式最近一次计算未成功：${c.error ?? '未知错误'}。`
  const r = c.result
  const parts: string[] = ['最近一次计算已成功。']
  if (r?.Vc != null) parts.push(`关键输出示例：Vc≈${r.Vc}${r.unit ? `，单位 ${r.unit}` : ''}。`)
  if (c.animation_type) {
    parts.push(
      `与锁定流速对照的界面档位为「${c.animation_type}」` +
        (c.velocity_ratio != null ? `，新算结果与锁定值之比约 ${c.velocity_ratio.toFixed(3)}` : '') +
        '；仅供对照理解，最终以规范及现场工况为准。'
    )
  }
  parts.push('若需更深层的用语解释，可待智能解读在服务端就绪后再提问。')
  return parts.join('')
}

/**
 * 判断用户措辞是否更像「需要长文推理/综合评价」类问题（用于文案提示等）。
 * 是否调用 LLM 由前端 AssistantPanel：规则命中优先 → `llmReady` → `/api/assistant/chat`。
 */
export function prefersLlmInterpretation(raw: string): boolean {
  const q = normalize(raw)
  if (!q) return false
  const zhTriggers =
    /为什么|是否合理|行不行|够不够|够不够安全|风险评估|综合评价|长篇|仔细分析|帮我判断|解释一下.*结果/.test(raw)
  const enTriggers =
    /\bwhy\b|reasonable|risk\s*assessment|in\s*detail|explain\s+(the\s+)?result|\bjudge\b/.test(q)
  return zhTriggers || enTriggers
}

/** 嵌入式 LLM 未就绪时在固定话术末尾附加一行后端诊断（由 /api/assistant/status 给出） */
export function smartInterpretationNotReadyReply(language: 'zh' | 'en', diagnostic?: string): string {
  const base =
    language === 'en'
      ? 'For this question I can help with concrete steps in the app—try the sidebar, filling parameters, exporting Word, or what a specific result field means. Please phrase your question as specifically as you can.'
      : '这类问题我可以从产品使用角度协助您：例如左侧侧栏如何找到计算页面、参数如何填写、Word 导出或某一界面提示含义等。请将问题写得更具体一些，便于为您解答。'
  const hint = diagnostic?.trim()
  if (!hint) return base
  return `${base}\n\n${hint}`
}

/** 本地规则/FAQ/关键词路由：命中则直接返回固定话术，不调用后端 LLM。 */
export function tryRuleBasedAssistantReply(
  raw: string,
  language: 'zh' | 'en',
  catalog: { id: string; name: string; group: string }[],
  snapshot: AssistantWorkspaceSnapshot | null
): string | null {
  const q = normalize(raw)
  if (!q) return null

  const zh = language === 'zh'

  // 机构身份：优先于泛化的「联系 / 关于」
  if (
    zh
      ? /长沙有色冶金设计研究院|长沙有色院|长沙院|中铝国际|中国铝业|软件|单位|公司|研发单位|软件.*谁做|开发/.test(
          raw
        )
      : new RegExp(
          APP_ORG_NAME_EN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        ).test(raw) ||
        /\bwho\s+are\s+you\b|\bwhat\s+company\b|\byour\s+organization\b|\babout\s+the\s+developer\b/i.test(q)
  ) {
    return zh ? ABOUT_ORG_ZH_LINES : ABOUT_ORG_EN_LINES
  }

  if (
    zh
      ? /科研创新|工程技术研究中心|工程研究中心|科研平台|博士后|国家企业技术中心/.test(raw)
      : /\bresearch\s+(innovation|center|platform)\b|\bengineering\s+technology\s+center\b/i.test(q)
  ) {
    return zh
      ? '科研创新中心与多个省级工程技术研究中心等平台介绍，见侧栏「了解我们 → 科研创新中心」；下方各板块为各中心名称与简介摘录。'
      : 'Open the sidebar About → Research for the Research Innovation Center and provincial engineering technology centers.'
  }

  if (zh ? /市政事业部|市政工程|废水处理|矿浆输送/.test(raw) : /\bmunicipal\s+(division|engineering)\b/i.test(q)) {
    return zh
      ? '市政事业部介绍与工程业绩见侧栏「了解我们 → 市政事业部」。'
      : 'Open the sidebar About → Municipal for the Municipal Division overview and projects.'
  }

  if (
    zh
      ? /联系|客服|通讯录|邮编|传真|市场部|人力资源|海外业务|电子邮箱|购买|联系/.test(raw) ||
        /邮箱|邮件|电话|地址|@(chinalco|china)/i.test(raw)
      : /\bcontact(s)?\b|\b(email|e-mail|phone|tel|fax|address)\b/i.test(raw)
  ) {
    return zh ? `${ABOUT_ORG_ZH_LINES}\n\n${CONTACT_ZH_LINES}` : `${ABOUT_ORG_EN_LINES}\n\n${CONTACT_EN_LINES}`
  }

  if (zh ? /了解我们|企业概况|公司介绍|公司简介|关于我们/.test(raw) : /\babout\s*(us)?\b|\bcompany\s+profile\b/i.test(q)) {
    return zh
      ? '完整图文请打开侧栏「了解我们」，可在「长沙有色冶金设计研究院」「市政事业部」「科研创新中心」三间切换查看。以下为机构与联系的摘要。\n\n' +
          `${ABOUT_ORG_ZH_LINES}\n\n${CONTACT_ZH_LINES}`
      : `${ABOUT_ORG_EN_LINES}\n\n${CONTACT_EN_LINES}`
  }

  if (
    zh
      ? /侧栏|侧边|左边|左边栏|导航|目录|去哪|哪里有|找不到|分组|模块|打不开.*页面|切换.*视图/.test(raw)
      : /sidebar|navigation|left\s*pane|menu|where.*(find|open)|which\s+(tab|section)/i.test(q)
  ) {
    const groups = [...new Set(catalog.map((c) => c.group))]
      .filter(Boolean)
      .slice(0, 12)
    return zh
      ? `计算公式在左侧侧栏的分组列表中：先展开大类，再点选具体条目，主内容区即切换到对应表单与说明。当前可见分组示例：${groups.join('、')}。「设置」「了解我们」等也在侧栏顶部或分组区域切换。`
      : `Use the left sidebar: expand a group (${groups.slice(0, 8).join(', ')}, …), pick a formula, and the main area opens its form and help text. Settings and About live in the sidebar too.`
  }

  if (
    zh
      ? /导出|下载.*word|word|文档|docx|\.doc/.test(raw) || /\b(word|docx)\b/i.test(raw)
      : /export|\b(word|docx)\b|download.*report/i.test(q)
  ) {
    return zh
      ? '请在对应公式页完成并成功计算后，在结果区域附近使用「导出」生成 Word；若不可用，请确认本机后端服务正常运行、磁盘可写且目标文件未被其他程序占用；开发环境下需先启用 API。'
      : 'After a successful calculation, export Word from near the results. Ensure the backend is running with a writable workspace and no file lock conflicts.'
  }

  if (
    zh
      ? /后端|本地服务|localhost|端口|连接.*失败|连不上|5000|cors|网络.*错误|ECONN/.test(raw)
      : /backend|cannot connect|connection refused|\blocalhost\b|cors|\bnetwork\b.*\berror\b|5000\b/i.test(q)
  ) {
    return zh
      ? '请先确认本地计算与助手依赖的后端服务已按说明启动；开发调试时通常需先起后端再开前端。若界面提示连接失败，可在提示处尝试「重试连接」，或退出应用后重新启动；仍失败时请对照运行日志与防火墙、端口占用。'
      : 'Start the backend service before the UI; use retry or restart after the service is healthy. Check firewall and port conflicts if connection errors persist.'
  }

  if (
    zh
      ? /设置|暗色|夜间|深色|浅色|亮色|明亮|界面语言|主题|翻译成|中英/.test(raw) || /english|界面.*英/i.test(raw)
      : /\b(settings|preferences)\b|\bdark\b.*\bmode\b|\btheme\b|\blanguage\b|interface\s+language/i.test(q)
  ) {
    return zh
      ? '语言和界面明暗主题一般在侧栏进入「设置」中切换；选择会保存在本机以便下次继续使用。'
      : 'Open Settings from the sidebar to switch language and light/dark theme—stored locally for next launch.'
  }

  if (
    zh
      ? /临界.*锁|锁定.*流速|Vc.*锁|流速.*对照|档位|动画对比|沉积|悬浮/.test(raw)
      : /lock.*(vc|velocity)|locked\s*Vc|comparison\s*tier|animation|settling|still-flow|medium-flow/i.test(raw)
  ) {
    return zh
      ? '临界流速可与界面「锁定」值对照查看：改动参数后出现的新 Vc 与档位用于理解相对高低——新结果相对锁定值偏高时，往往需要更高流速才维持悬浮，沉积风险常在工程意义上更受关注。说明仅为界面辅助解读，请以规范条文与工程师判断为准；若需要逐步推演工况，可待智能解读在服务端就绪后再描述具体场景。'
      : 'Vc lock and tier hints compare new results to the locked value for intuition only—not a substitute for codes or engineer judgment; detailed walkthroughs work best once smart interpretation is configured server-side.'
  }

  if (
    zh
      ? /怎么算|如何计算|计算按钮|点.*计算|开始算|步骤|必填|表单|输入.*参数/.test(raw)
      : /\bhow\s+to\s+calculate\b|calculate\b.*\bbutton\b|\bfill\b.*\b(fields|inputs)\b|parameters/i.test(raw)
  ) {
    return zh
      ? '在当前公式页按字段标签与占位说明逐项填写，再触发「计算」或页面上的等价操作；多步骤表单请自上而下依次完成，前序步骤的输出可能自动带入后续步骤。'
      : 'Fill each field using on-page hints, then run Calculate; multi-step forms flow top-down with possible auto-fill between steps.'
  }

  if (
    zh
      ? /结果|输出|读法|算出来|最近一次|刚才|Vc|condition_met/.test(raw)
      : /\b(result|output|last (run|calculation)|reading\b.*\b(result|Vc))/i.test(raw)
  ) {
    const line = briefResultLine(snapshot?.lastCalculation ?? null, language)
    if (line) return line
  }

  const compact = raw.replace(/\s/g, '')
  if (compact.length >= 2) {
    for (const row of catalog) {
      if (raw.includes(row.name) || compact.includes(row.name.replace(/\s/g, ''))) {
        return zh
          ? `「${row.name}」位于侧栏「${row.group}」分组；点该条目后主区切换到对应计算界面。`
          : `"${row.name}" sits under sidebar group "${row.group}". Select it to open the form.`
      }
    }
  }

  if (/^hello\b|^hi\b|你好|您好|在吗|帮助|help\b/.test(q)) {
    return buildAssistantWelcome(language)
  }

  return null
}
