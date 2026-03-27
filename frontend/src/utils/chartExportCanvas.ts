/** L–压力 曲线点（与后端 hl_curve 一致：H 为纵轴压力 kPa） */
export interface HlCurvePoint {
  L: number
  H: number
}

function niceStep(range: number, approxDivisions: number): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const raw = range / Math.max(1, approxDivisions)
  const exp = Math.floor(Math.log10(raw))
  const f = raw / Math.pow(10, exp)
  let nf = 1
  if (f <= 1) nf = 1
  else if (f <= 2) nf = 2
  else if (f <= 5) nf = 5
  else nf = 10
  return nf * Math.pow(10, exp)
}

function linspaceTicks(min: number, max: number, step: number): number[] {
  const ticks: number[] = []
  const start = Math.ceil(min / step - 1e-9) * step
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12)))
  }
  if (ticks.length === 0) ticks.push(min, max)
  return ticks
}

function formatTick(n: number): string {
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(1)
  const a = Math.abs(n)
  if (a >= 1000) return n.toFixed(0)
  if (a >= 100) return n.toFixed(1)
  if (a >= 10) return n.toFixed(2)
  return n.toFixed(3).replace(/\.?0+$/, '') || '0'
}

export interface ScientificHlChartOptions {
  curveData: HlCurvePoint[]
  darkMode: boolean
  title: string
  subtitle?: string
  xAxisLabel: string
  yAxisLabel: string
  lineColor: string
  legendText: string
  filename: string
  /** 画布宽度，默认 1600 */
  width?: number
  /** 画布高度，默认 900 */
  height?: number
}

/**
 * 用 hl_curve 数据在离屏 Canvas 上绘制带坐标轴、网格、刻度的线图并触发 PNG 下载。
 * 避免 Recharts SVG 序列化后尺寸/样式丢失导致导出为空白或仅一个点的问题。
 */
export function downloadScientificHlChartPng(options: ScientificHlChartOptions): void {
  const {
    curveData,
    darkMode,
    title,
    subtitle,
    xAxisLabel,
    yAxisLabel,
    lineColor,
    legendText,
    filename,
    width = 1600,
    height = 900,
  } = options

  if (!curveData.length) return

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const bg = darkMode ? '#1F2937' : '#FFFFFF'
  const fg = darkMode ? '#E5E7EB' : '#1F2937'
  const muted = darkMode ? '#9CA3AF' : '#6B7280'
  const gridColor = darkMode ? '#4B5563' : '#D1D5DB'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  const margin = { top: subtitle ? 88 : 72, right: 48, bottom: 72, left: 88 }
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom
  const left = margin.left
  const top = margin.top
  const right = left + plotW
  const bottom = top + plotH

  const Ls = curveData.map((d) => d.L)
  const Hs = curveData.map((d) => d.H)
  let Lmin = Math.min(...Ls)
  let Lmax = Math.max(...Ls)
  let Hmin = Math.min(...Hs)
  let Hmax = Math.max(...Hs)
  if (Lmax <= Lmin) {
    Lmin = 0
    Lmax = Lmax || 1
  }
  if (Hmax <= Hmin) {
    const c = Hmin
    Hmin = c - 1
    Hmax = c + 1
  }
  const Lpad = (Lmax - Lmin) * 0.04 || 1
  const Hpad = (Hmax - Hmin) * 0.06 || Math.max(1, Math.abs(Hmax) * 0.05)
  Lmin = Math.max(0, Lmin - Lpad)
  Lmax = Lmax + Lpad
  Hmin = Math.max(0, Hmin - Hpad)
  Hmax = Hmax + Hpad

  const xStep = niceStep(Lmax - Lmin, 8)
  const yStep = niceStep(Hmax - Hmin, 7)
  const xTicks = linspaceTicks(Lmin, Lmax, xStep)
  const yTicks = linspaceTicks(Hmin, Hmax, yStep)

  const xScale = (L: number) => left + ((L - Lmin) / (Lmax - Lmin)) * plotW
  const yScale = (h: number) => bottom - ((h - Hmin) / (Hmax - Hmin)) * plotH

  // 网格
  ctx.strokeStyle = gridColor
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (const xt of xTicks) {
    const x = xScale(xt)
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  }
  for (const yt of yTicks) {
    const y = yScale(yt)
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 坐标轴框
  ctx.strokeStyle = muted
  ctx.lineWidth = 1.5
  ctx.strokeRect(left, top, plotW, plotH)

  // 刻度与数字
  ctx.font = '14px system-ui, "Segoe UI", sans-serif'
  ctx.fillStyle = muted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const xt of xTicks) {
    const x = xScale(xt)
    ctx.beginPath()
    ctx.moveTo(x, bottom)
    ctx.lineTo(x, bottom + 6)
    ctx.stroke()
    ctx.fillText(formatTick(xt), x, bottom + 10)
  }

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const yt of yTicks) {
    const y = yScale(yt)
    ctx.beginPath()
    ctx.moveTo(left - 6, y)
    ctx.lineTo(left, y)
    ctx.stroke()
    ctx.fillText(formatTick(yt), left - 10, y)
  }

  // 曲线
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < curveData.length; i++) {
    const p = curveData[i]
    const x = xScale(p.L)
    const y = yScale(p.H)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // 标题
  ctx.fillStyle = fg
  ctx.font = 'bold 20px system-ui, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(title, width / 2, 20)
  if (subtitle) {
    ctx.font = '13px system-ui, "Segoe UI", sans-serif'
    ctx.fillStyle = muted
    ctx.fillText(subtitle, width / 2, 48)
  }

  // 轴标题
  ctx.fillStyle = muted
  ctx.font = 'italic 15px system-ui, "Segoe UI", sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillText(xAxisLabel, left + plotW / 2, height - 36)

  ctx.save()
  ctx.translate(28, top + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText(yAxisLabel, 0, 0)
  ctx.restore()

  // 图例
  const legY = top + 12
  const legX = right - 8
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(legX - 120, legY)
  ctx.lineTo(legX - 20, legY)
  ctx.stroke()
  ctx.fillStyle = fg
  ctx.font = '13px system-ui, "Segoe UI", sans-serif'
  const shortLegend =
    legendText.length > 70 ? `${legendText.slice(0, 67)}…` : legendText
  ctx.fillText(shortLegend, legX - 128, legY)

  const a = document.createElement('a')
  a.download = filename
  a.href = canvas.toDataURL('image/png')
  a.click()
}
