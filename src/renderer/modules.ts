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
    title: 'Analytics',
    items: [
      {
        id: 'overview',
        label: 'Executive Overview',
        icon: '📊',
        milestone: 0,
        blurb: 'Executive KPI strip, network health score, Ghana map, top priorities.'
      },
      {
        id: 'explorer',
        label: 'Network Explorer',
        icon: '🌐',
        milestone: 3,
        blurb: 'Hierarchical Network → Region → District → Site → Cell navigation.'
      },
      {
        id: 'cell-intelligence',
        label: 'Cell Intelligence',
        icon: '📱',
        milestone: 3,
        blurb: 'All cells with lifecycle, trend, severity and priority scoring.'
      },
      {
        id: 'performance',
        label: 'Performance Analysis',
        icon: '⚡',
        milestone: 3,
        blurb: 'Percentiles, distributions, heatmaps, scatterplots, correlations.'
      },
      {
        id: 'nc-intelligence',
        label: 'NC Intelligence',
        icon: '🚦',
        milestone: 2,
        blurb: 'Lifecycle, trend and severity classification of NC cells.'
      },
      {
        id: 'health-matrix',
        label: 'Health Matrix',
        icon: '🧭',
        milestone: 3,
        blurb: 'Historical Region/District/Site/Cell × Day/Week/Month matrix.'
      },
      {
        id: 'comparison-lab',
        label: 'Comparison Lab',
        icon: '🔬',
        milestone: 3,
        blurb: 'Period, Region, District, Site, Cell and Cohort comparisons.'
      },
      {
        id: 'simulation-lab',
        label: 'Simulation Lab',
        icon: '🧪',
        milestone: 4,
        blurb: 'What-If spectral expansions, MIMO upgrades, and traffic offload simulator.'
      },
      {
        id: 'investigation',
        label: 'Investigation Workspace',
        icon: '🕵️',
        milestone: 4,
        blurb: 'Evidence-based diagnosis, notes and events, before/after analysis.'
      },
      {
        id: 'priority-center',
        label: 'Priority Center',
        icon: '🎯',
        milestone: 4,
        blurb: 'Transparent 0-100 Priority Score and action workflow.'
      },
      {
        id: 'forecasting',
        label: 'Forecasting & Early Warning',
        icon: '🔮',
        milestone: 4,
        blurb: 'Simple-first forecasts with early-warning risk states.'
      },
      {
        id: 'reports',
        label: 'Reporting Center',
        icon: '📄',
        milestone: 5,
        blurb: 'Excel, PowerPoint, PDF and PNG report packs.'
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
        blurb: 'Imports, mappings, validation, coverage, audit, raw archive.'
      },
      {
        id: 'workspace',
        label: 'Workspace',
        icon: '🧰',
        milestone: 0,
        blurb: 'Workspace info, create/open, read-only mode, recent workspaces.'
      },
      {
        id: 'kpi-definitions',
        label: 'KPI Definitions',
        icon: '🎚️',
        milestone: 0,
        blurb: 'Per-technology KPI sets, editable targets and units.'
      }
    ]
  }
]

export const ALL_MODULES: ModuleDef[] = MODULE_GROUPS.flatMap((g) => g.items)
