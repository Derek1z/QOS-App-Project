import React, { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import type { CellIntelligenceRow, CellDetail, Technology } from '../../../shared/api'
import Chart from '../lib/Chart'
import type { EChartsOption } from 'echarts'
import { PALETTE, tooltipStyle, axisLabelStyle } from '../lib/Chart'

export default function SimulationLab(): React.JSX.Element {
  const workspace = useAppStore((s) => s.workspace)
  const selectedTech = useAppStore((s) => s.selectedTech)
  const grain = useAppStore((s) => s.grain)
  const setGrain = useAppStore((s) => s.setGrain)

  // Active technology state (defaults to workspace/store tech, with switchable tabs)
  const [tech, setTech] = useState<Technology>(workspace?.technology ?? selectedTech ?? '4G')
  useEffect(() => {
    if (workspace?.technology) {
      setTech(workspace.technology)
    } else if (selectedTech) {
      setTech(selectedTech)
    }
  }, [workspace?.technology, selectedTech])

  const [cells, setCells] = useState<CellIntelligenceRow[]>([])
  const [selectedCellId, setSelectedCellId] = useState<number | null>(null)
  const [detail, setDetail] = useState<CellDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Active chart KPI projection view
  const [selectedKpiKey, setSelectedKpiKey] = useState<string>('prb')

  // --- 4G LTE Simulation Parameters ---
  const [baseBwMHz, setBaseBwMHz] = useState<number>(10)
  const [deltaBwMHz, setDeltaBwMHz] = useState<number>(10)
  const [mimoMode, setMimoMode] = useState<'2x2' | '4x4' | 'massive_32t32r' | 'massive_64t64r'>('massive_64t64r')
  const [enableCA, setEnableCA] = useState<boolean>(true)
  const [enable256QAM, setEnable256QAM] = useState<boolean>(true)
  const [downTiltDeg, setDownTiltDeg] = useState<number>(2)
  const [offloadPct4G, setOffloadPct4G] = useState<number>(10)

  // --- 3G UMTS Simulation Parameters ---
  const [baseCarriers, setBaseCarriers] = useState<number>(1)
  const [addedCarriers, setAddedCarriers] = useState<number>(1)
  const [addedCE, setAddedCE] = useState<number>(64)
  const [enableDcHsdpa, setEnableDcHsdpa] = useState<boolean>(true)
  const [enableDynamicPower, setEnableDynamicPower] = useState<boolean>(true)
  const [offloadPct3G, setOffloadPct3G] = useState<number>(15)

  // --- 2G GSM Simulation Parameters ---
  const [baseTRX, setBaseTRX] = useState<number>(2)
  const [addedTRX, setAddedTRX] = useState<number>(2)
  const [enableHalfRate, setEnableHalfRate] = useState<boolean>(true)
  const [enableDynSdcch, setEnableDynSdcch] = useState<boolean>(true)
  const [enableSFH, setEnableSFH] = useState<boolean>(true)
  const [offloadPct2G, setOffloadPct2G] = useState<number>(10)

  // Auto-switch selected chart KPI key when technology changes
  useEffect(() => {
    if (tech === '4G') setSelectedKpiKey('prb')
    else if (tech === '3G') setSelectedKpiKey('cssr_3g')
    else if (tech === '2G') setSelectedKpiKey('tch_cong')
  }, [tech])

  // Load cells for quick selection
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await window.api.analytics.cellIntelligence({ limit: 100 })
        if (alive && res.rows) {
          setCells(res.rows)
          if (res.rows.length > 0 && selectedCellId == null) {
            const worst = res.rows.find((c) => c.isNc) ?? res.rows[0]
            setSelectedCellId(worst.cellId)
          }
        }
      } catch (e) {
        console.error('Failed to load cells for simulation:', e)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace?.path])

  // Load selected cell detail
  useEffect(() => {
    if (selectedCellId == null) return
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const d = await window.api.analytics.cellDetail(selectedCellId, grain)
        if (alive) {
          setDetail(d)
        }
      } catch (e) {
        console.error('Failed to load cell detail for simulation:', e)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedCellId, grain])

  // Filtered cells for list
  const filteredCells = useMemo(() => {
    if (!search.trim()) return cells
    const q = search.toLowerCase()
    return cells.filter(
      (c) =>
        c.cellName.toLowerCase().includes(q) ||
        (c.district && c.district.toLowerCase().includes(q)) ||
        (c.site && c.site.toLowerCase().includes(q))
    )
  }, [cells, search])

  // --------------------------------------------------------------------------
  // Core KPI Simulation Calculation Engine
  // --------------------------------------------------------------------------
  const simulationResults = useMemo(() => {
    if (!detail || !detail.weeks || detail.weeks.length === 0) return null

    const labels = detail.weeks.map((h) => h.weekStart)
    const basePrbRaw = detail.weeks.map((h) => h.prbAvg ?? 0)
    const baseThrRaw = detail.weeks.map((h) => (h.throughputKbps ? h.throughputKbps / 1000 : 15.0))

    if (tech === '4G') {
      // 4G LTE Mathematical Model
      let spectralGain = (baseBwMHz + deltaBwMHz) / baseBwMHz
      if (enableCA) spectralGain *= 1.30 // CA 2CC/3CC ~30% scheduling gain
      if (mimoMode === '4x4') spectralGain *= 1.35 // 4x4 MIMO ~35%
      else if (mimoMode === 'massive_32t32r') spectralGain *= 1.70 // 32T32R Massive MIMO ~70%
      else if (mimoMode === 'massive_64t64r') spectralGain *= 2.00 // 64T64R Massive MIMO ~100% (2x)
      if (enable256QAM) spectralGain *= 1.15 // 256QAM link efficiency ~15%

      const offloadFactor = (100 - offloadPct4G) / 100
      const tiltFactor = 1 + downTiltDeg * 0.04 // Down-tilt reduces overshoot & interference by 4%/deg

      // 1. 4G PRB Utilization (%) (Target < 80%)
      const basePrb = basePrbRaw
      const simPrb = basePrb.map((prb) => {
        const reduced = (prb * offloadFactor) / (spectralGain * tiltFactor)
        return Math.max(0, Math.min(100, Math.round(reduced * 10) / 10))
      })

      // 2. 4G CSSR (%) (Target >= 98.5%)
      const baseCssr = basePrb.map((prb) => {
        const breach = Math.max(0, prb - 75)
        return Math.max(90, Math.round((99.2 - breach * 0.15) * 100) / 100)
      })
      const simCssr = baseCssr.map((cssr, i) => {
        const ratio = (simPrb[i] ?? 0) / Math.max(1, basePrb[i] ?? 1)
        const unsucc = (100 - cssr) * Math.pow(ratio, 1.2)
        return Math.min(100, Math.round((100 - unsucc) * 100) / 100)
      })

      // 3. 4G Call Drop Rate (%) (Target < 1.5%)
      const baseDrop = basePrb.map((prb) => {
        const breach = Math.max(0, prb - 70)
        return Math.max(0.3, Math.round((0.6 + breach * 0.06) * 100) / 100)
      })
      const simDrop = baseDrop.map((drop, i) => {
        const ratio = (simPrb[i] ?? 0) / Math.max(1, basePrb[i] ?? 1)
        const beamformingRelief = mimoMode.startsWith('massive') ? 0.65 : 0.85
        const improved = drop * Math.pow(ratio, 0.8) * beamformingRelief * (1 - downTiltDeg * 0.03)
        return Math.max(0.1, Math.round(improved * 100) / 100)
      })

      // 4. 4G Data Service Access Failure Rate (%) (Target < 1.0%)
      const baseFailure = basePrb.map((prb) => {
        const breach = Math.max(0, prb - 75)
        return Math.max(0.2, Math.round((0.4 + breach * 0.05) * 100) / 100)
      })
      const simFailure = baseFailure.map((fail, i) => {
        const ratio = (simPrb[i] ?? 0) / Math.max(1, basePrb[i] ?? 1)
        const improved = (fail * Math.pow(ratio, 1.4)) / (spectralGain * 0.8)
        return Math.max(0.05, Math.round(improved * 100) / 100)
      })

      // 5. DL User Throughput (Mbps)
      const baseThr = baseThrRaw
      const simThr = baseThr.map((thr) => Math.round(thr * spectralGain * 10) / 10)

      // Latest values & compliance
      const curPrb = basePrb[basePrb.length - 1] ?? 0
      const fcPrb = simPrb[simPrb.length - 1] ?? 0
      const curCssr = baseCssr[baseCssr.length - 1] ?? 98.5
      const fcCssr = simCssr[simCssr.length - 1] ?? 98.5
      const curDrop = baseDrop[baseDrop.length - 1] ?? 0.8
      const fcDrop = simDrop[simDrop.length - 1] ?? 0.8
      const curFail = baseFailure[baseFailure.length - 1] ?? 0.5
      const fcFail = simFailure[simFailure.length - 1] ?? 0.5
      const curThr = baseThr[baseThr.length - 1] ?? 15
      const fcThr = simThr[simThr.length - 1] ?? 15

      const isCompliantPrb = fcPrb < 80
      const isCompliantCssr = fcCssr >= 98.5
      const isCompliantDrop = fcDrop < 1.5
      const isCompliantFail = fcFail < 1.0
      const isAllCompliant = isCompliantPrb && isCompliantCssr && isCompliantDrop && isCompliantFail

      const kpis = [
        {
          key: 'prb',
          label: '4G DL PRB Util',
          unit: '%',
          baseVal: curPrb,
          simVal: fcPrb,
          target: 80,
          worseIsHigher: true,
          compliant: isCompliantPrb,
          deltaText: `↓ ${(curPrb - fcPrb).toFixed(1)}% (${curPrb > 0 ? Math.round(((curPrb - fcPrb) / curPrb) * 100) : 0}% drop)`,
          baseSeries: basePrb,
          simSeries: simPrb
        },
        {
          key: 'cssr',
          label: '4G CSSR',
          unit: '%',
          baseVal: curCssr,
          simVal: fcCssr,
          target: 98.5,
          worseIsHigher: false,
          compliant: isCompliantCssr,
          deltaText: `↑ +${(fcCssr - curCssr).toFixed(2)}%`,
          baseSeries: baseCssr,
          simSeries: simCssr
        },
        {
          key: 'drop',
          label: '4G Call Drop Rate',
          unit: '%',
          baseVal: curDrop,
          simVal: fcDrop,
          target: 1.5,
          worseIsHigher: true,
          compliant: isCompliantDrop,
          deltaText: `↓ -${(curDrop - fcDrop).toFixed(2)}%`,
          baseSeries: baseDrop,
          simSeries: simDrop
        },
        {
          key: 'failure',
          label: '4G Data Access Failure',
          unit: '%',
          baseVal: curFail,
          simVal: fcFail,
          target: 1.0,
          worseIsHigher: true,
          compliant: isCompliantFail,
          deltaText: `↓ -${(curFail - fcFail).toFixed(2)}%`,
          baseSeries: baseFailure,
          simSeries: simFailure
        },
        {
          key: 'throughput',
          label: '4G DL User Speed',
          unit: 'Mbps',
          baseVal: curThr,
          simVal: fcThr,
          target: 10.0,
          worseIsHigher: false,
          compliant: fcThr >= 10.0,
          deltaText: `↑ +${(fcThr - curThr).toFixed(1)} Mbps (${Math.round((spectralGain - 1) * 100)}% boost)`,
          baseSeries: baseThr,
          simSeries: simThr
        }
      ]

      return {
        tech: '4G' as Technology,
        labels,
        spectralGain: Math.round(spectralGain * 100) / 100,
        isAllCompliant,
        kpis
      }
    } else if (tech === '3G') {
      // 3G UMTS Mathematical Model
      let capacityGain = (baseCarriers + addedCarriers) / baseCarriers
      capacityGain *= 1 + addedCE / 64
      if (enableDcHsdpa) capacityGain *= 1.45
      if (enableDynamicPower) capacityGain *= 1.15

      const offloadFactor = (100 - offloadPct3G) / 100

      // 1. 3G CSSR (%) (Target >= 98.5%)
      const baseCssr = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 70)
        return Math.max(91, Math.round((99.0 - breach * 0.2) * 100) / 100)
      })
      const simCssr = baseCssr.map((cssr) => {
        const unsucc = (100 - cssr) / (capacityGain * (1 + 0.3 * (offloadPct3G / 100)))
        return Math.min(100, Math.round((100 - unsucc) * 100) / 100)
      })

      // 2. 3G Call Drop Rate (%) (Target < 1.5%)
      const baseDrop = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 65)
        return Math.max(0.4, Math.round((0.8 + breach * 0.08) * 100) / 100)
      })
      const simDrop = baseDrop.map((drop) => {
        const pwrBonus = enableDynamicPower ? 0.75 : 1.0
        const improved = drop * pwrBonus * offloadFactor * (1 / Math.sqrt(capacityGain))
        return Math.max(0.15, Math.round(improved * 100) / 100)
      })

      // 3. 3G Data Access Success Rate (%) (Target >= 98.0%)
      const baseDataAccess = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 70)
        return Math.max(92, Math.round((98.8 - breach * 0.18) * 100) / 100)
      })
      const simDataAccess = baseDataAccess.map((da) => {
        const unsucc = (100 - da) / capacityGain
        return Math.min(100, Math.round((100 - unsucc) * 100) / 100)
      })

      // 4. 3G Peak Traffic Utilization (%) (Target < 80%)
      const baseUtil = basePrbRaw
      const simUtil = baseUtil.map((u) => {
        const reduced = (u * offloadFactor) / capacityGain
        return Math.max(0, Math.min(100, Math.round(reduced * 10) / 10))
      })

      // 5. HSDPA User Speed (Mbps)
      const baseThr = baseThrRaw.map((t) => Math.max(1.5, Math.round(t * 0.3 * 10) / 10))
      const simThr = baseThr.map((t) => Math.round(t * capacityGain * 10) / 10)

      const curCssr = baseCssr[baseCssr.length - 1] ?? 98.5
      const fcCssr = simCssr[simCssr.length - 1] ?? 98.5
      const curDrop = baseDrop[baseDrop.length - 1] ?? 0.8
      const fcDrop = simDrop[simDrop.length - 1] ?? 0.8
      const curDA = baseDataAccess[baseDataAccess.length - 1] ?? 98.0
      const fcDA = simDataAccess[simDataAccess.length - 1] ?? 98.0
      const curUtil = baseUtil[baseUtil.length - 1] ?? 50
      const fcUtil = simUtil[simUtil.length - 1] ?? 50
      const curThr = baseThr[baseThr.length - 1] ?? 3.5
      const fcThr = simThr[simThr.length - 1] ?? 3.5

      const isCompliantCssr = fcCssr >= 98.5
      const isCompliantDrop = fcDrop < 1.5
      const isCompliantDA = fcDA >= 98.0
      const isCompliantUtil = fcUtil < 80
      const isAllCompliant = isCompliantCssr && isCompliantDrop && isCompliantDA && isCompliantUtil

      const kpis = [
        {
          key: 'cssr_3g',
          label: '3G CSSR',
          unit: '%',
          baseVal: curCssr,
          simVal: fcCssr,
          target: 98.5,
          worseIsHigher: false,
          compliant: isCompliantCssr,
          deltaText: `↑ +${(fcCssr - curCssr).toFixed(2)}%`,
          baseSeries: baseCssr,
          simSeries: simCssr
        },
        {
          key: 'drop_3g',
          label: '3G Call Drop Rate',
          unit: '%',
          baseVal: curDrop,
          simVal: fcDrop,
          target: 1.5,
          worseIsHigher: true,
          compliant: isCompliantDrop,
          deltaText: `↓ -${(curDrop - fcDrop).toFixed(2)}%`,
          baseSeries: baseDrop,
          simSeries: simDrop
        },
        {
          key: 'data_access_3g',
          label: '3G Data Access Success',
          unit: '%',
          baseVal: curDA,
          simVal: fcDA,
          target: 98.0,
          worseIsHigher: false,
          compliant: isCompliantDA,
          deltaText: `↑ +${(fcDA - curDA).toFixed(2)}%`,
          baseSeries: baseDataAccess,
          simSeries: simDataAccess
        },
        {
          key: 'util_3g',
          label: '3G Traffic Util',
          unit: '%',
          baseVal: curUtil,
          simVal: fcUtil,
          target: 80,
          worseIsHigher: true,
          compliant: isCompliantUtil,
          deltaText: `↓ ${(curUtil - fcUtil).toFixed(1)}% (${curUtil > 0 ? Math.round(((curUtil - fcUtil) / curUtil) * 100) : 0}% drop)`,
          baseSeries: baseUtil,
          simSeries: simUtil
        },
        {
          key: 'throughput_3g',
          label: '3G HSDPA Speed',
          unit: 'Mbps',
          baseVal: curThr,
          simVal: fcThr,
          target: 4.0,
          worseIsHigher: false,
          compliant: fcThr >= 4.0,
          deltaText: `↑ +${(fcThr - curThr).toFixed(1)} Mbps (${Math.round((capacityGain - 1) * 100)}% boost)`,
          baseSeries: baseThr,
          simSeries: simThr
        }
      ]

      return {
        tech: '3G' as Technology,
        labels,
        spectralGain: Math.round(capacityGain * 100) / 100,
        isAllCompliant,
        kpis
      }
    } else {
      // 2G GSM Mathematical Model
      let trxGain = (baseTRX + addedTRX) / baseTRX
      if (enableHalfRate) trxGain *= 1.75 // Half-Rate AMR codec ~75% voice slot jump
      if (enableSFH) trxGain *= 1.20 // Frequency Hopping interference gain ~20%

      const offloadFactor = (100 - offloadPct2G) / 100

      // 1. 2G TCH Congestion (%) (Target < 2.0%)
      const baseTchCong = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 65)
        return Math.max(0.2, Math.round((0.5 + breach * 0.12) * 100) / 100)
      })
      const simTchCong = baseTchCong.map((tc) => {
        const reduced = (tc * offloadFactor) / Math.pow(trxGain, 1.8)
        return Math.max(0, Math.min(100, Math.round(reduced * 100) / 100))
      })

      // 2. 2G SDCCH Congestion (%) (Target < 2.0%)
      const baseSdcchCong = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 70)
        return Math.max(0.1, Math.round((0.4 + breach * 0.10) * 100) / 100)
      })
      const simSdcchCong = baseSdcchCong.map((sc) => {
        const dynBonus = enableDynSdcch ? 4.0 : 1.0
        const reduced = (sc * offloadFactor) / (trxGain * dynBonus)
        return Math.max(0, Math.min(100, Math.round(reduced * 100) / 100))
      })

      // 3. 2G CSSR (%) (Target >= 98.5%)
      const baseCssr = baseTchCong.map((tc, i) => {
        const sc = baseSdcchCong[i] ?? 0.5
        return Math.max(90, Math.round((100 - (tc + sc) * 1.1) * 100) / 100)
      })
      const simCssr = simTchCong.map((tc, i) => {
        const sc = simSdcchCong[i] ?? 0.1
        return Math.min(100, Math.round((100 - (tc + sc) * 1.05) * 100) / 100)
      })

      // 4. 2G TCH Drop Rate (%) (Target < 1.5%)
      const baseDrop = basePrbRaw.map((prb) => {
        const breach = Math.max(0, prb - 65)
        return Math.max(0.3, Math.round((0.7 + breach * 0.07) * 100) / 100)
      })
      const simDrop = baseDrop.map((drop) => {
        const sfhBonus = enableSFH ? 0.70 : 1.0
        const improved = drop * sfhBonus * Math.pow(offloadFactor, 0.5)
        return Math.max(0.1, Math.round(improved * 100) / 100)
      })

      const curTch = baseTchCong[baseTchCong.length - 1] ?? 2.5
      const fcTch = simTchCong[simTchCong.length - 1] ?? 0.5
      const curSdcch = baseSdcchCong[baseSdcchCong.length - 1] ?? 1.8
      const fcSdcch = simSdcchCong[simSdcchCong.length - 1] ?? 0.3
      const curCssr = baseCssr[baseCssr.length - 1] ?? 97.0
      const fcCssr = simCssr[simCssr.length - 1] ?? 99.2
      const curDrop = baseDrop[baseDrop.length - 1] ?? 1.8
      const fcDrop = simDrop[simDrop.length - 1] ?? 0.8

      const isCompliantTch = fcTch < 2.0
      const isCompliantSdcch = fcSdcch < 2.0
      const isCompliantCssr = fcCssr >= 98.5
      const isCompliantDrop = fcDrop < 1.5
      const isAllCompliant = isCompliantTch && isCompliantSdcch && isCompliantCssr && isCompliantDrop

      const kpis = [
        {
          key: 'tch_cong',
          label: '2G TCH Congestion',
          unit: '%',
          baseVal: curTch,
          simVal: fcTch,
          target: 2.0,
          worseIsHigher: true,
          compliant: isCompliantTch,
          deltaText: `↓ -${(curTch - fcTch).toFixed(2)}%`,
          baseSeries: baseTchCong,
          simSeries: simTchCong
        },
        {
          key: 'sdcch_cong',
          label: '2G SDCCH Congestion',
          unit: '%',
          baseVal: curSdcch,
          simVal: fcSdcch,
          target: 2.0,
          worseIsHigher: true,
          compliant: isCompliantSdcch,
          deltaText: `↓ -${(curSdcch - fcSdcch).toFixed(2)}%`,
          baseSeries: baseSdcchCong,
          simSeries: simSdcchCong
        },
        {
          key: 'cssr_2g',
          label: '2G CSSR',
          unit: '%',
          baseVal: curCssr,
          simVal: fcCssr,
          target: 98.5,
          worseIsHigher: false,
          compliant: isCompliantCssr,
          deltaText: `↑ +${(fcCssr - curCssr).toFixed(2)}%`,
          baseSeries: baseCssr,
          simSeries: simCssr
        },
        {
          key: 'drop_2g',
          label: '2G TCH Drop Rate',
          unit: '%',
          baseVal: curDrop,
          simVal: fcDrop,
          target: 1.5,
          worseIsHigher: true,
          compliant: isCompliantDrop,
          deltaText: `↓ -${(curDrop - fcDrop).toFixed(2)}%`,
          baseSeries: baseDrop,
          simSeries: simDrop
        }
      ]

      return {
        tech: '2G' as Technology,
        labels,
        spectralGain: Math.round(trxGain * 100) / 100,
        isAllCompliant,
        kpis
      }
    }
  }, [
    tech,
    detail,
    baseBwMHz,
    deltaBwMHz,
    mimoMode,
    enableCA,
    enable256QAM,
    downTiltDeg,
    offloadPct4G,
    baseCarriers,
    addedCarriers,
    addedCE,
    enableDcHsdpa,
    enableDynamicPower,
    offloadPct3G,
    baseTRX,
    addedTRX,
    enableHalfRate,
    enableDynSdcch,
    enableSFH,
    offloadPct2G
  ])

  // Active KPI for chart
  const activeKpi = useMemo(() => {
    if (!simulationResults) return null
    return (
      simulationResults.kpis.find((k) => k.key === selectedKpiKey) ??
      simulationResults.kpis[0]
    )
  }, [simulationResults, selectedKpiKey])

  // Chart Options
  const chartOption: EChartsOption = useMemo(() => {
    if (!simulationResults || !activeKpi) return {}

    const isPct = activeKpi.unit === '%'
    const minVal = Math.min(...activeKpi.baseSeries, ...activeKpi.simSeries, activeKpi.target ?? 0)
    const maxVal = Math.max(...activeKpi.baseSeries, ...activeKpi.simSeries, activeKpi.target ?? 100)
    const padding = (maxVal - minVal) * 0.15 || 5

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(),
        valueFormatter: (val) => (val == null ? '—' : `${Number(val).toFixed(2)} ${activeKpi.unit}`)
      },
      legend: {
        top: 0,
        right: 10,
        textStyle: { color: PALETTE.text, fontSize: 11 }
      },
      grid: { left: 45, right: 20, top: 35, bottom: 25 },
      xAxis: {
        type: 'category',
        data: simulationResults.labels,
        axisLabel: axisLabelStyle(),
        axisLine: { lineStyle: { color: PALETTE.border } }
      },
      yAxis: [
        {
          type: 'value',
          name: `${activeKpi.label} (${activeKpi.unit})`,
          min: isPct ? (minVal > 80 ? 80 : 0) : Math.max(0, Math.floor(minVal - padding)),
          max: isPct ? (maxVal < 100 ? 100 : Math.ceil(maxVal + 5)) : Math.ceil(maxVal + padding),
          axisLabel: { ...axisLabelStyle(), formatter: `{value}${activeKpi.unit}` },
          splitLine: { lineStyle: { color: 'rgba(38,48,65,0.5)' } }
        }
      ],
      series: [
        {
          name: `Baseline ${activeKpi.label}`,
          type: 'line',
          data: activeKpi.baseSeries,
          itemStyle: { color: '#ef4444' },
          lineStyle: { width: 2, type: 'dashed' },
          symbol: 'circle',
          symbolSize: 4
        },
        {
          name: `Simulated ${activeKpi.label}`,
          type: 'line',
          data: activeKpi.simSeries,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 3 },
          areaStyle: {
            color: 'rgba(16, 185, 129, 0.15)'
          },
          symbol: 'circle',
          symbolSize: 6,
          markLine:
            activeKpi.target != null
              ? {
                  data: [
                    {
                      yAxis: activeKpi.target,
                      name: `Target Limit (${activeKpi.target}${activeKpi.unit})`
                    }
                  ],
                  lineStyle: { color: '#f59e0b', type: 'dashed', width: 2 },
                  label: {
                    formatter: `Target: ${activeKpi.target}${activeKpi.unit}`,
                    color: '#f59e0b',
                    fontSize: 10,
                    position: 'insideEndTop'
                  }
                }
              : undefined
        }
      ]
    }
  }, [simulationResults, activeKpi])

  return (
    <div className="module-container sim-container">
      {/* Header with Technology and Grain Toggles */}
      <div className="module-head" style={{ marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>
            <span>🔬</span> What-If Capacity & Spectral Simulation Lab
          </h2>
          <span className="card-note">
            Simulate Massive MIMO, carrier expansion, interference down-tilt & traffic offload across Core KPIs
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Technology Selector Tabs */}
          <div className="seg">
            <button
              className={`seg-btn ${tech === '4G' ? 'active' : ''}`}
              onClick={() => setTech('4G')}
              style={{ fontWeight: tech === '4G' ? 700 : 500, padding: '4px 10px' }}
            >
              4G LTE
            </button>
            <button
              className={`seg-btn ${tech === '3G' ? 'active' : ''}`}
              onClick={() => setTech('3G')}
              style={{ fontWeight: tech === '3G' ? 700 : 500, padding: '4px 10px' }}
            >
              3G UMTS
            </button>
            <button
              className={`seg-btn ${tech === '2G' ? 'active' : ''}`}
              onClick={() => setTech('2G')}
              style={{ fontWeight: tech === '2G' ? 700 : 500, padding: '4px 10px' }}
            >
              2G GSM
            </button>
          </div>

          <div className="grain-toggle">
            <button className={`grain-btn ${grain === 'daily' ? 'active' : ''}`} onClick={() => setGrain('daily')}>
              Daily
            </button>
            <button className={`grain-btn ${grain === 'weekly' ? 'active' : ''}`} onClick={() => setGrain('weekly')}>
              Weekly
            </button>
          </div>
        </div>
      </div>

      <div className="sim-layout">
        {/* Left Column: Sector Selection & Engineering Parameters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          {/* Target Sector Search & List */}
          <div className="card glass-card" style={{ padding: '12px' }}>
            <div className="card-head" style={{ marginBottom: '8px' }}>
              <span className="card-title" style={{ fontSize: '13px' }}>1. Target Sector</span>
              <span className="badge" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: '10.5px' }}>
                {tech} Mode
              </span>
            </div>

            <div className="sim-search-box">
              <span className="sim-search-icon">🔍</span>
              <input
                type="text"
                className="sim-search-input"
                placeholder="Filter cells, sites…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="sim-cell-list">
              {filteredCells.map((c) => {
                const isSelected = selectedCellId === c.cellId
                return (
                  <div
                    key={c.cellId}
                    onClick={() => setSelectedCellId(c.cellId)}
                    className={`sim-cell-card ${isSelected ? 'selected' : ''}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, overflow: 'hidden' }}>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.cellName}
                      </span>
                      <span style={{ fontSize: '10.5px', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.site ?? 'Site'} • {c.district ?? '—'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <span
                        className="badge"
                        style={{
                          background: c.isNc ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: c.isNc ? '#ef4444' : '#10b981',
                          border: `1px solid ${c.isNc ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                          fontSize: '10px',
                          padding: '1px 5px'
                        }}
                      >
                        {c.isNc ? '🔴 Breached' : '🟢 Compliant'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Technology-Specific Engineering Levers */}
          <div className="card glass-card" style={{ padding: '12px' }}>
            <div className="card-head" style={{ marginBottom: '8px' }}>
              <span className="card-title" style={{ fontSize: '13px' }}>2. Engineering Parameters ({tech})</span>
            </div>

            {/* --- 4G LTE Controls --- */}
            {tech === '4G' && (
              <>
                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Current Bandwidth</span>
                  </div>
                  <select
                    className="sim-select"
                    value={baseBwMHz}
                    onChange={(e) => setBaseBwMHz(Number(e.target.value))}
                  >
                    <option value={5}>5 MHz Channel</option>
                    <option value={10}>10 MHz Channel</option>
                    <option value={15}>15 MHz Channel</option>
                    <option value={20}>20 MHz Channel</option>
                  </select>
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Add Carrier BW</span>
                    <span className="sim-control-val">+{deltaBwMHz} MHz</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={5}
                    value={deltaBwMHz}
                    onChange={(e) => setDeltaBwMHz(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">MIMO Configuration</span>
                  </div>
                  <select
                    className="sim-select"
                    value={mimoMode}
                    onChange={(e) => setMimoMode(e.target.value as any)}
                  >
                    <option value="2x2">2x2 MIMO (Standard)</option>
                    <option value="4x4">4x4 MIMO (+35% Cap)</option>
                    <option value="massive_32t32r">32T32R Massive MIMO (+70% Cap)</option>
                    <option value="massive_64t64r">64T64R Massive MIMO (+100% Cap)</option>
                  </select>
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Antenna Down-Tilt</span>
                    <span className="sim-control-val">{downTiltDeg}° Tilt</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={1}
                    value={downTiltDeg}
                    onChange={(e) => setDownTiltDeg(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Traffic Offload %</span>
                    <span className="sim-control-val">{offloadPct4G}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={offloadPct4G}
                    onChange={(e) => setOffloadPct4G(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-toggle-grid">
                  <div
                    className={`sim-toggle-card ${enableCA ? 'active' : ''}`}
                    onClick={() => setEnableCA(!enableCA)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">📡 Carrier Aggregation (CA 2CC/3CC)</span>
                      <span className="sim-toggle-desc">+30% peak & edge capacity boost</span>
                    </div>
                    <div className={`sim-switch ${enableCA ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>

                  <div
                    className={`sim-toggle-card ${enable256QAM ? 'active' : ''}`}
                    onClick={() => setEnable256QAM(!enable256QAM)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">⚡ 256QAM DL Modulation</span>
                      <span className="sim-toggle-desc">+15% downlink spectral efficiency</span>
                    </div>
                    <div className={`sim-switch ${enable256QAM ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* --- 3G UMTS Controls --- */}
            {tech === '3G' && (
              <>
                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Current Carriers</span>
                  </div>
                  <select
                    className="sim-select"
                    value={baseCarriers}
                    onChange={(e) => setBaseCarriers(Number(e.target.value))}
                  >
                    <option value={1}>1 Carrier (F1)</option>
                    <option value={2}>2 Carriers (F1 + F2)</option>
                  </select>
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Add UMTS Carrier</span>
                    <span className="sim-control-val">+{addedCarriers} UARFCN</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={1}
                    value={addedCarriers}
                    onChange={(e) => setAddedCarriers(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Channel Elements (CE)</span>
                  </div>
                  <select
                    className="sim-select"
                    value={addedCE}
                    onChange={(e) => setAddedCE(Number(e.target.value))}
                  >
                    <option value={0}>+0 CE (Standard Base)</option>
                    <option value={32}>+32 CEs License</option>
                    <option value={64}>+64 CEs License</option>
                    <option value={128}>+128 CEs License</option>
                  </select>
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">3G → 4G Offload %</span>
                    <span className="sim-control-val">{offloadPct3G}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={offloadPct3G}
                    onChange={(e) => setOffloadPct3G(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-toggle-grid">
                  <div
                    className={`sim-toggle-card ${enableDcHsdpa ? 'active' : ''}`}
                    onClick={() => setEnableDcHsdpa(!enableDcHsdpa)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">🚀 Dual-Cell HSDPA (DC-HSDPA)</span>
                      <span className="sim-toggle-desc">+45% to +100% data access speed</span>
                    </div>
                    <div className={`sim-switch ${enableDcHsdpa ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>

                  <div
                    className={`sim-toggle-card ${enableDynamicPower ? 'active' : ''}`}
                    onClick={() => setEnableDynamicPower(!enableDynamicPower)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">⚡ Dynamic Power Sharing</span>
                      <span className="sim-toggle-desc">+3dB pilot/traffic power pooling</span>
                    </div>
                    <div className={`sim-switch ${enableDynamicPower ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* --- 2G GSM Controls --- */}
            {tech === '2G' && (
              <>
                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Current TRX Count</span>
                  </div>
                  <select
                    className="sim-select"
                    value={baseTRX}
                    onChange={(e) => setBaseTRX(Number(e.target.value))}
                  >
                    <option value={1}>1 TRX (8 timeslots)</option>
                    <option value={2}>2 TRX (16 timeslots)</option>
                    <option value={4}>4 TRX (32 timeslots)</option>
                  </select>
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">Add TRX Expansion</span>
                    <span className="sim-control-val">+{addedTRX} TRX</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    value={addedTRX}
                    onChange={(e) => setAddedTRX(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-control-group">
                  <div className="sim-control-head">
                    <span className="sim-control-label">2G → 3G/4G Offload</span>
                    <span className="sim-control-val">{offloadPct2G}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={offloadPct2G}
                    onChange={(e) => setOffloadPct2G(Number(e.target.value))}
                    className="sim-slider-input"
                  />
                </div>

                <div className="sim-toggle-grid">
                  <div
                    className={`sim-toggle-card ${enableHalfRate ? 'active' : ''}`}
                    onClick={() => setEnableHalfRate(!enableHalfRate)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">📞 Half-Rate (HR) AMR Codec</span>
                      <span className="sim-toggle-desc">Doubles voice capacity per TCH slot</span>
                    </div>
                    <div className={`sim-switch ${enableHalfRate ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>

                  <div
                    className={`sim-toggle-card ${enableDynSdcch ? 'active' : ''}`}
                    onClick={() => setEnableDynSdcch(!enableDynSdcch)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">⚠️ Dynamic SDCCH Allocation</span>
                      <span className="sim-toggle-desc">Prevents SMS & signalling blocking</span>
                    </div>
                    <div className={`sim-switch ${enableDynSdcch ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>

                  <div
                    className={`sim-toggle-card ${enableSFH ? 'active' : ''}`}
                    onClick={() => setEnableSFH(!enableSFH)}
                  >
                    <div className="sim-toggle-info">
                      <span className="sim-toggle-title">🔄 Synthesized Freq Hopping</span>
                      <span className="sim-toggle-desc">Cuts co-channel interference & drop rate</span>
                    </div>
                    <div className={`sim-switch ${enableSFH ? 'on' : ''}`}>
                      <div className="sim-switch-handle" />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Scorecard Grid, Projection Chart & Field Optimization Plan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
          {loading && <div className="notice">Simulating spectral dynamics…</div>}

          {!loading && detail && simulationResults && (
            <>
              {/* Outcome Scorecard for All Core KPIs */}
              <div className="sim-outcome-grid">
                {simulationResults.kpis.slice(0, 4).map((k) => {
                  const isBreached = !k.compliant
                  return (
                    <div
                      key={k.key}
                      className="sim-kpi-card"
                      style={
                        {
                          '--kpi-accent': isBreached ? '#ef4444' : '#10b981'
                        } as React.CSSProperties
                      }
                    >
                      <div className="sim-kpi-head">
                        <span className="sim-kpi-label">{k.label}</span>
                        <span className={`sim-kpi-badge ${isBreached ? 'breached' : 'compliant'}`}>
                          {isBreached ? '⚠ Breached' : '✓ Compliant'}
                        </span>
                      </div>

                      <div className="sim-kpi-values">
                        <span className="sim-kpi-sim-val" style={{ color: isBreached ? '#ef4444' : '#10b981' }}>
                          {k.simVal}
                          <span style={{ fontSize: '11.5px', marginLeft: '2px', fontWeight: 600 }}>{k.unit}</span>
                        </span>
                        <span className="sim-kpi-base-val">
                          {k.baseVal}
                          {k.unit}
                        </span>
                      </div>

                      <div className="sim-kpi-subtext" style={{ color: isBreached ? '#f87171' : '#34d399' }}>
                        <span>{k.deltaText}</span>
                        <span style={{ color: '#64748b', marginLeft: 'auto' }}>
                          {k.worseIsHigher ? `< ${k.target}` : `≥ ${k.target}`}
                          {k.unit}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Chart with Core KPI Projection Tabs */}
              <div className="card glass-card" style={{ padding: '14px', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
                <div className="card-head" style={{ marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <span className="card-title" style={{ fontSize: '13px' }}>
                      {activeKpi?.label} Projection: {detail.cellName} ({detail.site ?? '—'})
                    </span>
                  </div>

                  {/* Core KPI Chart Switcher */}
                  <div className="sim-chart-tabs">
                    {simulationResults.kpis.map((k) => (
                      <button
                        key={k.key}
                        className={`sim-chart-tab ${selectedKpiKey === k.key ? 'active' : ''}`}
                        onClick={() => setSelectedKpiKey(k.key)}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ width: '100%', overflow: 'hidden' }}>
                  <Chart option={chartOption} height={300} />
                </div>
              </div>

              {/* Actionable Field Engineering Advisory */}
              <div
                className={`sim-rec-box ${simulationResults.isAllCompliant ? 'resolved' : 'unresolved'}`}
              >
                <div className="sim-rec-header">
                  <div className="sim-rec-title">
                    <span>💡</span> Recommended Field Optimization & Engineering Plan
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: simulationResults.isAllCompliant
                        ? 'rgba(16, 185, 129, 0.2)'
                        : 'rgba(245, 158, 11, 0.2)',
                      color: simulationResults.isAllCompliant ? '#10b981' : '#f59e0b',
                      border: `1px solid ${
                        simulationResults.isAllCompliant ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'
                      }`,
                      fontSize: '10.5px',
                      padding: '2px 7px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {simulationResults.isAllCompliant
                      ? '🟢 All Core KPIs Compliant'
                      : '🟡 Partial Breach Remaining'}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.45 }}>
                  {simulationResults.isAllCompliant ? (
                    <>
                      Simulated configuration delivers a{' '}
                      <strong>{simulationResults.spectralGain}x capacity multiplier</strong>, bringing all {tech} Core
                      Compliance KPIs within authoritative network thresholds.
                    </>
                  ) : (
                    <>
                      Simulated parameters improve network capacity by{' '}
                      <strong>{simulationResults.spectralGain}x</strong>, but some Core KPIs remain near or above
                      regulatory thresholds. Implement additional spectral expansion or activate Massive MIMO.
                    </>
                  )}
                </div>

                {/* Structured Engineering Checklist */}
                <div className="sim-rec-checklist">
                  <div className="sim-rec-item">
                    <span>📡</span>
                    <div>
                      <strong>Physical/RF:</strong>{' '}
                      {tech === '4G'
                        ? `Set electrical down-tilt to ${downTiltDeg}° to confine footprint and eliminate inter-cell interference.`
                        : tech === '3G'
                        ? 'Re-tune antenna azimuth and check feeder VSWR for secondary carrier readiness.'
                        : 'Verify RF feeder loss and check co-channel frequency reuse distance.'}
                    </div>
                  </div>

                  <div className="sim-rec-item">
                    <span>⚡</span>
                    <div>
                      <strong>Software/License:</strong>{' '}
                      {tech === '4G'
                        ? `Activate ${mimoMode.replace('_', ' ').toUpperCase()}, Carrier Aggregation (CA), and 256QAM license.`
                        : tech === '3G'
                        ? `Deploy +${addedCE} CE license and enable Dual-Cell HSDPA feature.`
                        : 'Enable Half-Rate (HR) AMR codec and dynamic SDCCH allocation on BSC.'}
                    </div>
                  </div>

                  <div className="sim-rec-item">
                    <span>🔀</span>
                    <div>
                      <strong>Traffic Offload:</strong>{' '}
                      {tech === '4G'
                        ? `Schedule inter-frequency load balancing to offload ${offloadPct4G}% traffic to microcells.`
                        : tech === '3G'
                        ? `Configure 3G → 4G fast return to offload ${offloadPct3G}% data traffic.`
                        : `Enable directed retry to offload ${offloadPct2G}% voice traffic to 3G/4G.`}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

