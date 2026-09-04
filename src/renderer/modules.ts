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
    title: 'V2 Analytics',
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
        label: 'KPI Definitions & Derived Engine',
        icon: '🎚️',
        milestone: 1,
        blurb: 'Per-technology KPI targets, derived formula engine, and counter discovery.'
      },
      {
        id: 'workspace',
        label: 'Workspace Settings',
        icon: '🧰',
        milestone: 0,
        blurb: 'Workspace information, snapshot backups, and database maintenance.'
      }
    ]
  }
]

export const ALL_MODULES: ModuleDef[] = MODULE_GROUPS.flatMap((g) => g.items)
