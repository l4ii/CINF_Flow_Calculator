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

/** 水头轴刻度：按量程决定小数位，避免满屏长小数 */
export function formatHydraulicHeadTick(value: number, yMin: number, yMax: number): string {
  if (!Number.isFinite(value)) return ''
  const span = Math.max(yMax - yMin, 1e-9)
  let d = 0
  if (span >= 200) d = 0
  else if (span >= 20) d = 1
  else if (span >= 2) d = 2
  else d = 2
  const t = Number(value.toFixed(d))
  if (Math.abs(t) >= 10000) return t.toFixed(0)
  return String(t)
}

/** 管长轴刻度：优先整数，便于与工程输入一致 */
export function formatHydraulicLengthTick(n: number): string {
  if (!Number.isFinite(n)) return ''
  const a = Math.abs(n)
  if (a >= 100) return String(Math.round(n))
  const t = Number(n.toFixed(1))
  return String(t)
}

/** 与界面一致：X 轴 0…L_max 共 divisions+1 个刻度 */
function hydraulicGradeXTickValues(lMax: number, divisions: number): number[] {
  if (!Number.isFinite(lMax) || lMax <= 0 || divisions < 1) return [0, lMax]
  return Array.from({ length: divisions + 1 }, (_, i) => Number(((lMax * i) / divisions).toPrecision(12)))
}

export interface HydraulicLayoutOptions {
  lMax: number
  yMin: number
  yMax: number
  /** 与 HYDRAULIC_GRADE_TICK_DIVISIONS 一致，默认 10 */
  xTickDivisions?: number
}

export interface ScientificHlChartExtraCurve {
  curve: HlCurvePoint[]
  color: string
  legend: string
}

export interface ScientificHlChartOptions {
  curveData: HlCurvePoint[]
  /** 第二条 L–H 曲线（如浆体图中间损失压力递减示意） */
  secondCurve?: HlCurvePoint[]
  secondLineColor?: string
  secondLegendText?: string
  /** 水力坡度图：第三条及以后的曲线（如地形线、最大允许压力线） */
  extraHydraulicCurves?: ScientificHlChartExtraCurve[]
  darkMode: boolean
  title: string
  subtitle?: string
  xAxisLabel: string
  yAxisLabel: string
  lineColor: string
  legendText: string
  filename: string
  /** 画布宽度，默认 1600；水力坡度默认 1280 */
  width?: number
  /** 画布高度，默认 900；水力坡度默认约 564（含底部图例与轴标题区） */
  height?: number
  /** 与软件水力坡度图：固定 X/Y 域与 X 等分刻度 */
  hydraulicLayout?: HydraulicLayoutOptions
  /** 图下方小字（如 P_n、P_z 说明） */
  footnote?: string
}

/**
 * 用 hl_curve 数据在离屏 Canvas 上绘制带坐标轴、网格、刻度的线图并触发 PNG 下载。
 * 避免 Recharts SVG 序列化后尺寸/样式丢失导致导出为空白或仅一个点的问题。
 */
export function downloadScientificHlChartPng(options: ScientificHlChartOptions): void {
  const {
    curveData,
    secondCurve,
    secondLineColor = '#DC2626',
    secondLegendText = '',
    extraHydraulicCurves,
    darkMode,
    title,
    subtitle,
    xAxisLabel,
    yAxisLabel,
    lineColor,
    legendText,
    filename,
    width: widthOpt,
    height: heightOpt,
    hydraulicLayout,
    footnote,
  } = options

  if (!curveData.length) return

  const isHydraulic = !!hydraulicLayout
  const hasBottomLegend = isHydraulic
  /** 水力坡度图：为 X 轴刻度、底部图例、多行 X 轴标题预留空间，避免与曲线区重叠 */
  const hydraulicBelowPlot =
    hasBottomLegend
      ? 26 /* X 刻度数字 */ + 28 /* 图例行 */ + 60 /* 轴标题多行（约 4 行×15px） */ + 10 /* 底边距 */
      : 0
  /** 水力坡度：宽约 1200px；总高度含底部图例区 */
  const width = widthOpt ?? (isHydraulic ? 1200 : 1600)
  const height = heightOpt ?? (isHydraulic ? (footnote ? 596 : 564) : 900)

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

  const bottomExtra = footnote ? 28 : 0
  const margin = {
    top: subtitle ? 86 : 68,
    right: isHydraulic ? 40 : 48,
    bottom: (isHydraulic ? hydraulicBelowPlot : 72) + bottomExtra,
    left: isHydraulic ? 72 : 88,
  }
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom
  const left = margin.left
  const top = margin.top
  const right = left + plotW
  const bottom = top + plotH

  let Lmin: number
  let Lmax: number
  let Hmin: number
  let Hmax: number
  let xTicks: number[]
  let yTicks: number[]

  if (hydraulicLayout) {
    const { lMax, yMin, yMax, xTickDivisions = 10 } = hydraulicLayout
    Lmin = 0
    Lmax = lMax
    Hmin = yMin
    Hmax = yMax
    xTicks = hydraulicGradeXTickValues(lMax, xTickDivisions)
    const ySpan = Math.max(Hmax - Hmin, 1e-9)
    const yStep = niceStep(ySpan, 7)
    yTicks = linspaceTicks(Hmin, Hmax, yStep)
  } else {
    const Ls = curveData.map((d) => d.L)
    const Hs = curveData.map((d) => d.H)
    const Ls2 = secondCurve?.map((d) => d.L) ?? []
    const Hs2 = secondCurve?.map((d) => d.H) ?? []
    const allL = Ls2.length ? [...Ls, ...Ls2] : Ls
    const allH = Hs2.length ? [...Hs, ...Hs2] : Hs
    Lmin = Math.min(...allL)
    Lmax = Math.max(...allL)
    Hmin = Math.min(...allH)
    Hmax = Math.max(...allH)
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
    xTicks = linspaceTicks(Lmin, Lmax, xStep)
    yTicks = linspaceTicks(Hmin, Hmax, yStep)
  }

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
  ctx.font = '13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = muted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const xt of xTicks) {
    const x = xScale(xt)
    ctx.beginPath()
    ctx.moveTo(x, bottom)
    ctx.lineTo(x, bottom + 6)
    ctx.stroke()
    const lx = hydraulicLayout ? formatHydraulicLengthTick(xt) : formatTick(xt)
    ctx.fillText(lx, x, bottom + 10)
  }

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const yt of yTicks) {
    const y = yScale(yt)
    ctx.beginPath()
    ctx.moveTo(left - 6, y)
    ctx.lineTo(left, y)
    ctx.stroke()
    const hy = hydraulicLayout ? formatHydraulicHeadTick(yt, Hmin, Hmax) : formatTick(yt)
    ctx.fillText(hy, left - 10, y)
  }

  // 曲线（双线均为实线，靠颜色区分）
  const lineW = 2.5
  ctx.strokeStyle = lineColor
  ctx.lineWidth = lineW
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash([])
  ctx.beginPath()
  for (let i = 0; i < curveData.length; i++) {
    const p = curveData[i]
    const x = xScale(p.L)
    const y = yScale(p.H)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  if (secondCurve && secondCurve.length > 1) {
    ctx.strokeStyle = secondLineColor
    ctx.lineWidth = lineW
    ctx.setLineDash([])
    ctx.beginPath()
    for (let i = 0; i < secondCurve.length; i++) {
      const p = secondCurve[i]
      const x = xScale(p.L)
      const y = yScale(p.H)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  if (extraHydraulicCurves?.length) {
    for (const ex of extraHydraulicCurves) {
      if (!ex.curve || ex.curve.length < 2) continue
      ctx.strokeStyle = ex.color
      ctx.lineWidth = lineW
      ctx.setLineDash([])
      ctx.beginPath()
      for (let i = 0; i < ex.curve.length; i++) {
        const p = ex.curve[i]
        const x = xScale(p.L)
        const y = yScale(p.H)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  // 标题
  ctx.fillStyle = fg
  ctx.font = 'bold 18px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(title, width / 2, 16)
  if (subtitle) {
    ctx.font = '12px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = muted
    const subY = 42
    const maxSubW = width - 48
    wrapFillText(ctx, subtitle, width / 2, subY, maxSubW, 16, muted, '12px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif')
  }

  ctx.save()
  ctx.translate(isHydraulic ? 22 : 28, top + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = muted
  ctx.font = 'italic 13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
  const yLines = yAxisLabel.split('\n')
  const yLineH = 15
  const yStart = (-(yLines.length - 1) * yLineH) / 2
  yLines.forEach((line, i) => {
    ctx.fillText(line.trim(), 0, yStart + i * yLineH)
  })
  ctx.restore()

  // 图例：在水力坡度图中置于 X 刻度下方、轴标题上方，避免压住横轴标签
  const hydraulicTickBand = 26
  const hydraulicLegendBand = 28
  if (isHydraulic) {
    const items: { color: string; text: string }[] = [{ color: lineColor, text: legendText }]
    if (secondCurve && secondCurve.length > 1 && secondLegendText) {
      items.push({ color: secondLineColor, text: secondLegendText })
    }
    if (extraHydraulicCurves?.length) {
      for (const ex of extraHydraulicCurves) {
        if (ex.curve.length > 1 && ex.legend) {
          items.push({ color: ex.color, text: ex.legend })
        }
      }
    }
    const gap = 28
    const sampleW = 36
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const totalW = items.reduce((s, it) => s + sampleW + 8 + measureTextW(ctx, it.text, '13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif') + gap, 0) - gap
    let cx = left + (plotW - totalW) / 2
    const legY = bottom + hydraulicTickBand + hydraulicLegendBand / 2
    ctx.font = '13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
    for (const it of items) {
      ctx.strokeStyle = it.color
      ctx.lineWidth = 3
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(cx, legY)
      ctx.lineTo(cx + sampleW, legY)
      ctx.stroke()
      ctx.fillStyle = fg
      const t = it.text.length > 36 ? `${it.text.slice(0, 33)}…` : it.text
      ctx.fillText(t, cx + sampleW + 8, legY)
      cx += sampleW + 8 + measureTextW(ctx, t, '13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif') + gap
    }
  }

  // X 轴标题（多行）：紧挨画布下沿之上，在图例下方区域
  ctx.fillStyle = muted
  ctx.font = 'italic 13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  const xLabelY =
    isHydraulic
      ? bottom + hydraulicTickBand + hydraulicLegendBand + 4
      : height - margin.bottom + 18
  wrapFillText(ctx, xAxisLabel, left + plotW / 2, xLabelY, plotW - 8, 15, muted, 'italic 13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif')

  if (!isHydraulic) {
    let legY = top + 12
    const legX = right - 8
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 3
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(legX - 120, legY)
    ctx.lineTo(legX - 20, legY)
    ctx.stroke()
    ctx.fillStyle = fg
    ctx.font = '13px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
    const shortLegend = legendText.length > 70 ? `${legendText.slice(0, 67)}…` : legendText
    ctx.fillText(shortLegend, legX - 128, legY)

    if (secondCurve && secondCurve.length > 1 && secondLegendText) {
      legY += 22
      ctx.strokeStyle = secondLineColor
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(legX - 120, legY)
      ctx.lineTo(legX - 20, legY)
      ctx.stroke()
      ctx.setLineDash([])
      const t2 = secondLegendText.length > 70 ? `${secondLegendText.slice(0, 67)}…` : secondLegendText
      ctx.fillText(t2, legX - 128, legY)
    }
  }

  if (footnote) {
    ctx.save()
    ctx.fillStyle = muted
    ctx.font = '11px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    let t = footnote
    const maxW = width - 48
    while (t.length > 6 && ctx.measureText(`${t}…`).width > maxW) {
      t = t.slice(0, -1)
    }
    if (t !== footnote) t += '…'
    ctx.fillText(t, width / 2, height - 6)
    ctx.restore()
  }

  const a = document.createElement('a')
  a.download = filename
  a.href = canvas.toDataURL('image/png')
  a.click()
}

function measureTextW(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.save()
  ctx.font = font
  const w = ctx.measureText(text).width
  ctx.restore()
  return w
}

/** 多行居中文字：支持 \n；超长行按字符折行（中英文） */
function wrapFillText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  startY: number,
  maxWidth: number,
  lineHeight: number,
  color: string,
  font: string
): void {
  ctx.save()
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let y = startY
  for (const para of text.split('\n')) {
    let line = ''
    for (let i = 0; i < para.length; i++) {
      const ch = para[i]
      const test = line + ch
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, cx, y)
        y += lineHeight
        line = ch
      } else {
        line = test
      }
    }
    if (line) {
      ctx.fillText(line, cx, y)
      y += lineHeight
    }
  }
  ctx.restore()
}
