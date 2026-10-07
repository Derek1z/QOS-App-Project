import type { ModuleId } from './store'

export interface ModuleDef {
  id: ModuleId
  label: string
  icon: string
  milestone: number
  blurb: string
}

export const MODULE_GROUPS: { title: string; items: ModuleDef[] }[] = [
  {
    title: 'Executive Analytics',
    items: [
      {
        id: 'overview',
        label: 'Executive Overview',
        icon: '📊',
        milestone: 0,
        blurb: 'Dynamic technology health cards, targets manager, dynamic KPI grid, multi-grain breach analytics.'
      },
      {
        id: 'nc-intelligence',
        label: 'NC & Breach Analytics',
        icon: '🚦',
        milestone: 1,
        blurb: 'Multi-grain non-compliance and breach classification across daily, weekly, and monthly views.'
      },
      {
        id: 'priority-center',
        label: 'Smart Priority Queue',
        icon: '🎯',
        milestone: 1,
        blurb: 'Automated priority ranking queue for critical cell remediation.'
      },
      {
        id: 'forecasting',
        label: 'Forecasting & Early Warning',
        icon: '🔮',
        milestone: 1,
        blurb: 'Backtested forecasts of imported KPIs, per-cell risk against targets, and capacity growth.'
      }
    ]
  },
  {
    title: 'Investigation & Maps',
    items: [
      {
        id: 'investigation',
        label: 'Cell Investigation',
        icon: '🔬',
        milestone: 1,
        blurb: 'Deep-dive investigation of a cell, site or district: trend lines, threshold overlays, findings and root-cause hypotheses.'
      },
      {
        id: 'explorer',
        label: 'Network Explorer',
        icon: '🌐',
        milestone: 1,
        blurb: 'Multi-level network hierarchy tree: Region → District → BTS Site → Sector Cell.'
      },
      {
        id: 'health-matrix',
        label: 'Ghana Health Matrix',
        icon: '🗺️',
        milestone: 1,
        blurb: 'Interactive Ghana geographic choropleth map and regional health matrix.'
      },
      {
        id: 'performance',
        label: 'Performance Analysis',
        icon: '📈',
        milestone: 1,
        blurb: 'Statistical distributions, 2D scatter quadrant matrices, and Pearson correlation matrices.'
      }
    ]
  },
  {
    title: 'Management',
    items: [
      {
        id: 'data-manager',
        label: 'Data Manager',
        icon: '🗂️',
        milestone: 1,
        blurb: 'Multi-technology import pipeline, mapping profiles, validation, and audit.'
      },
      {
        id: 'kpi-definitions',
        label: 'KPI Definitions & Derived',
        icon: '🎚️',
        milestone: 1,
        blurb: 'Per-technology KPI targets, derived formula engine, and counter discovery.'
      },
      {
        id: 'workspace',
        label: 'Workspace Settings',
        icon: '🧰',
        milestone: 0,
        blurb: 'Workspace information and recent workspaces.'
      }
    ]
  }
]

export const ALL_MODULES: ModuleDef[] = MODULE_GROUPS.flatMap((g) => g.items)
