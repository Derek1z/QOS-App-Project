import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, HeatmapChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapContinuousComponent,
  MarkLineComponent,
  DataZoomComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

// Register only the charts/primitives this app uses (keeps the bundle lean).
echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapContinuousComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer
])

/** Theme palette mirrored from styles.css CSS variables (canvas can't read CSS
 *  custom properties, so chart options share this JS copy). */
export const PALETTE = {
  bg: 'transparent',
  bg3: '#1a2130',
  border: '#263041',
  text: '#d7dde8',
  dim: '#8b95a7',
  faint: '#5c6675',
  accent: '#38bdf8',
  green: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171'
}

export function tooltipStyle(): { backgroundColor: string; borderColor: string; textStyle: { color: string }; extraCssText: string } {
  return {
    backgroundColor: '#141922',
    borderColor: PALETTE.border,
    textStyle: { color: PALETTE.text },
    extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,.5); border-radius: 6px; font-size: 12px;'
  }
}

export function axisLabelStyle(): { color: string; fontSize: number } {
  return { color: PALETTE.dim, fontSize: 11 }
}

/** Thin ECharts wrapper: init once, follow container size, dispose on unmount. */
export default function Chart({
  option,
  height = 260
}: {
  option: EChartsOption | null
  height?: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    let disposed = false
    const ro = new ResizeObserver(() => {
      // a resize can fire between dispose() and disconnect(); never paint a dead chart
      if (!disposed) chart.resize()
    })
    ro.observe(ref.current)
    return () => {
      disposed = true
      ro.disconnect()
      try {
        chart.clear()
        chart.dispose()
      } catch {
        /* already disposed */
      }
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (option) chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} style={{ width: '100%', height }} />
}
