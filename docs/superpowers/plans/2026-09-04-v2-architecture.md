# Version 2 Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic, multi-technology (2G/3G/4G) architecture for the QoS Network Intelligence Workstation (v2.0.0) with an observation-based DuckDB schema, universal grain synchronization, dynamic executive UI, technology-aware targets manager, and reusable derived KPI formula engine.

**Architecture:** A central `UniversalAnalysisContext` in Zustand drives all analytical queries. Data is stored in a long-form observation model in DuckDB (`fact_kpi_daily`), eliminating hardcoded metric columns. A derived KPI engine automatically detects raw counter sets (such as 3G congestion counters) and calculates derived metrics row-by-row with strict null and missing counter handling.

**Tech Stack:** Electron 43, React 19, TypeScript 7, Zustand 5, DuckDB Node API 1.5.5, ECharts 6, Vitest.

## Global Constraints

- **Multi-Technology Scope**: Support 2G, 3G, and 4G in a single `.qosdb` workspace.
- **Generic Data Model**: Logical primary key `(technology_id, date_id, cell_id, kpi_id)`.
- **Data Retention**: Retain newest 90 distinct reporting dates shared across all technologies; 90 calendar days for raw files.
- **Null Safety**: Represent missing values as `"Data unavailable"`, never `0`.
- **Universal Grain**: All charts, maps, and tables must update synchronously when `UniversalAnalysisContext` changes.
- **Multi-Grain Breach Support**: Breach and Non-Compliance analytics must support `daily`, `weekly`, and `monthly` grains.

---

### Task 1: Generic Database Schema v0.2.0 & Migration Scaffold

**Files:**
- Modify: `src/main/workspace/schema.ts`
- Create: `src/main/kpi/schemaV2.ts`
- Test: `tests/workspace/schemaV2.test.ts`

**Interfaces:**
- Produces: `ensureSchemaV020(connection: DuckDBConnection): Promise<void>`
- Tables: `dim_technology`, `dim_kpi`, `fact_cell_day`, `fact_kpi_daily`, `derived_kpi_config`, `kpi_targets`.

- [ ] **Step 1: Write the failing test for schema v0.2.0 initialization**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempWorkspace } from '../helpers/tempWorkspace'
import { ensureSchemaV020 } from '../../src/main/kpi/schemaV2'

describe('Schema v0.2.0', () => {
  it('creates dim_technology, dim_kpi, fact_kpi_daily, derived_kpi_config, and kpi_targets tables', async () => {
    const ws = await createTempWorkspace()
    await ensureSchemaV020(ws.connection)
    const tablesRes = await ws.connection.runAndReadAll(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`)
    const tableNames = tablesRes.getRowObjects().map(r => String(r.table_name))
    
    expect(tableNames).toContain('dim_technology')
    expect(tableNames).toContain('dim_kpi')
    expect(tableNames).toContain('fact_kpi_daily')
    expect(tableNames).toContain('derived_kpi_config')
    expect(tableNames).toContain('kpi_targets')
    await ws.cleanup()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace/schemaV2.test.ts`  
Expected: FAIL (`schemaV2` module not found)

- [ ] **Step 3: Implement `schemaV2.ts`**

```ts
import { DuckDBConnection } from '@duckdb/node-api'

export async function ensureSchemaV020(connection: DuckDBConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE IF NOT EXISTS dim_technology (
      technology_id INTEGER PRIMARY KEY,
      code VARCHAR NOT NULL UNIQUE,
      display_name VARCHAR NOT NULL,
      enabled BOOLEAN DEFAULT true
    );
    INSERT INTO dim_technology (technology_id, code, display_name) VALUES 
      (2, '2G', '2G GSM'),
      (3, '3G', '3G UMTS'),
      (4, '4G', '4G LTE')
    ON CONFLICT (technology_id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS dim_kpi (
      kpi_id BIGINT PRIMARY KEY,
      technology_id INTEGER NOT NULL,
      canonical_key VARCHAR NOT NULL,
      display_name VARCHAR NOT NULL,
      category VARCHAR NOT NULL,
      role VARCHAR NOT NULL,
      source_unit VARCHAR,
      display_unit VARCHAR NOT NULL,
      conversion_type VARCHAR NOT NULL DEFAULT 'none',
      conversion_formula VARCHAR,
      target DOUBLE,
      operator VARCHAR,
      cell_aggregation VARCHAR NOT NULL DEFAULT 'Average',
      time_aggregation VARCHAR NOT NULL DEFAULT 'Average',
      weekly_breach_days INTEGER,
      monthly_breach_days INTEGER,
      missing_policy VARCHAR NOT NULL DEFAULT 'ignore',
      decimals INTEGER NOT NULL DEFAULT 2,
      enabled BOOLEAN NOT NULL DEFAULT true,
      default_supporting_kpis JSON DEFAULT '[]',
      created_at TIMESTAMP DEFAULT now(),
      UNIQUE(technology_id, canonical_key)
    );

    CREATE TABLE IF NOT EXISTS fact_cell_day (
      technology_id INTEGER NOT NULL,
      date_id INTEGER NOT NULL,
      cell_id BIGINT NOT NULL,
      source_import_id BIGINT,
      PRIMARY KEY (technology_id, date_id, cell_id)
    );

    CREATE TABLE IF NOT EXISTS fact_kpi_daily (
      technology_id INTEGER NOT NULL,
      date_id INTEGER NOT NULL,
      cell_id BIGINT NOT NULL,
      kpi_id BIGINT NOT NULL,
      raw_value DOUBLE,
      value DOUBLE,
      source_import_id BIGINT,
      PRIMARY KEY (technology_id, date_id, cell_id, kpi_id)
    );

    CREATE TABLE IF NOT EXISTS derived_kpi_config (
      derived_kpi_id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      technology_id INTEGER NOT NULL,
      operation VARCHAR NOT NULL,
      source_kpi_keys JSON NOT NULL,
      custom_expression VARCHAR,
      display_unit VARCHAR,
      target DOUBLE,
      warning_threshold DOUBLE,
      critical_threshold DOUBLE,
      direction VARCHAR NOT NULL,
      treat_missing_as_zero BOOLEAN DEFAULT false,
      enabled BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS kpi_targets (
      technology_id INTEGER NOT NULL,
      kpi_id BIGINT NOT NULL,
      target DOUBLE,
      warning_threshold DOUBLE,
      critical_threshold DOUBLE,
      direction VARCHAR NOT NULL DEFAULT 'LOWER_IS_BETTER',
      updated_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (technology_id, kpi_id)
    );
  `)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace/schemaV2.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/kpi/schemaV2.ts tests/workspace/schemaV2.test.ts
git commit -m "feat(v2): add generic DuckDB schema v0.2.0 tables"
```

---

### Task 2: Reusable Derived KPI Formula Engine & Smart Counter Pattern Discovery

**Files:**
- Create: `src/main/kpi/derivedKpiEngine.ts`
- Test: `tests/kpi/derivedKpiEngine.test.ts`

**Interfaces:**
- Produces: `evaluateDerivedKpi(row: Record<string, number | null>, config: DerivedKPIConfig): number | null`
- Produces: `detectCandidateDerivedKpis(headers: string[]): CandidateDerivedKPI[]`
- Predefined 3G formulas: `3g_dl_power_congestion`, `3g_ul_ce_congestion`, `3g_phych_failures`.

- [ ] **Step 1: Write failing test for 3G DL Power Congestion and null safety**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateDerivedKpi, DL_POWER_CONGESTION_CONFIG } from '../../src/main/kpi/derivedKpiEngine'

describe('Derived KPI Engine', () => {
  it('calculates DL Power Congestion row-by-row when all counters are present', () => {
    const row = {
      'VS.RRC.Rej.DLPower.Cong': 4,
      'VS.RAB.FailEstabPS.DLPower.Cong': 7,
      'VS.RAB.FailEstabCS.DLPower.Cong': 3
    }
    const result = evaluateDerivedKpi(row, DL_POWER_CONGESTION_CONFIG)
    expect(result).toBe(14)
  })

  it('returns null if any required counter is null', () => {
    const row = {
      'VS.RRC.Rej.DLPower.Cong': 4,
      'VS.RAB.FailEstabPS.DLPower.Cong': null,
      'VS.RAB.FailEstabCS.DLPower.Cong': 3
    }
    const result = evaluateDerivedKpi(row, DL_POWER_CONGESTION_CONFIG)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/kpi/derivedKpiEngine.test.ts`  
Expected: FAIL (`derivedKpiEngine` module not found)

- [ ] **Step 3: Implement `derivedKpiEngine.ts`**

```ts
export interface DerivedKPIConfig {
  id: string
  name: string
  technologyId: number
  operation: 'SUM' | 'AVERAGE' | 'RATIO' | 'CUSTOM'
  sourceKPIKeys: string[]
  displayUnit?: string
  target?: number
  warningThreshold?: number
  criticalThreshold?: number
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER'
  treatMissingAsZero?: boolean
}

export const DL_POWER_CONGESTION_CONFIG: DerivedKPIConfig = {
  id: '3g_dl_power_congestion',
  name: 'DL Power Congestion',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RRC.Rej.DLPower.Cong',
    'VS.RAB.FailEstabPS.DLPower.Cong',
    'VS.RAB.FailEstabCS.DLPower.Cong'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

export const UL_CE_CONGESTION_CONFIG: DerivedKPIConfig = {
  id: '3g_ul_ce_congestion',
  name: 'UL CE Congestion',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RRC.Rej.ULCE.Cong',
    'VS.RAB.FailEstabPS.ULCE.Cong',
    'VS.RAB.FailEstabCS.ULCE.Cong'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

export const PHYCH_FAILURES_CONFIG: DerivedKPIConfig = {
  id: '3g_phych_failures',
  name: 'PhyCh Failures',
  technologyId: 3,
  operation: 'SUM',
  sourceKPIKeys: [
    'VS.RAB.FailEstabPS.PhyChFail',
    'VS.FailRBRecfg.PhyChFail',
    'VS.FailRBSetup.PhyChFail'
  ],
  direction: 'LOWER_IS_BETTER',
  treatMissingAsZero: false
}

export function evaluateDerivedKpi(
  row: Record<string, number | null>,
  config: DerivedKPIConfig
): number | null {
  const values: number[] = []

  for (const key of config.sourceKPIKeys) {
    const val = row[key]
    if (val === undefined || val === null) {
      if (config.treatMissingAsZero) {
        values.push(0)
      } else {
        return null // Strict null protection
      }
    } else {
      values.push(val)
    }
  }

  if (values.length === 0) return null

  switch (config.operation) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0)
    case 'AVERAGE':
      return values.reduce((a, b) => a + b, 0) / values.length
    default:
      return values.reduce((a, b) => a + b, 0)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/kpi/derivedKpiEngine.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/kpi/derivedKpiEngine.ts tests/kpi/derivedKpiEngine.test.ts
git commit -m "feat(v2): implement derived KPI formula engine with row-by-row null safety"
```

---

### Task 3: Universal Analysis Context & Zustand State Synchronization

**Files:**
- Modify: `src/renderer/store.ts`
- Create: `src/renderer/lib/useUniversalContext.ts`
- Test: `tests/renderer/storeContext.test.ts`

**Interfaces:**
- Produces: `UniversalAnalysisContext` state object & actions: `setTechnologyId`, `setPrimaryKpiId`, `setGrain`, `setReportingRange`, `setScope`.

- [ ] **Step 1: Write failing test for UniversalContext state changes**

```ts
import { describe, it, expect } from 'vitest'
import { useAppStore } from '../../src/renderer/store'

describe('Universal Context Store', () => {
  it('switches technology and updates primary context', () => {
    const store = useAppStore.getState()
    store.setTechnologyId(3) // 3G
    expect(useAppStore.getState().technologyId).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/storeContext.test.ts`  
Expected: FAIL (`setTechnologyId` not a function)

- [ ] **Step 3: Update `store.ts` with `UniversalAnalysisContext`**

```ts
export interface UniversalAnalysisContext {
  technologyId: number;        // 2G (2), 3G (3), 4G (4)
  primaryKpiId: number | null;
  supportingKpiIds: number[];
  grain: 'daily' | 'weekly' | 'monthly';
  range: 'latest' | '7r' | '14r' | '30r' | '60r' | '90r' | 'custom';
  customStart?: string;
  customEnd?: string;
  regionId?: number | null;
  districtId?: number | null;
  siteId?: number | null;
  cellId?: number | null;
}
```

Add actions: `setTechnologyId(id: number)`, `setPrimaryKpiId(id: number | null)`, `setGrain(g: 'daily'|'weekly'|'monthly')`, `setReportingRange(r: string)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/storeContext.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts tests/renderer/storeContext.test.ts
git commit -m "feat(v2): add UniversalAnalysisContext to Zustand store"
```

---

### Task 4: Technology-Aware `[Targets]` Panel Component

**Files:**
- Create: `src/renderer/components/TargetsModal.tsx`
- Modify: `src/renderer/modules/Overview.tsx`

**Interfaces:**
- Produces: `TargetsModal` component for viewing and editing KPI targets per active technology.

- [ ] **Step 1: Create `TargetsModal.tsx`**

Component renders slide-out panel:
- Title: `${activeTechnology} KPI Targets`
- Table of KPIs: Name, Target Input, Warning Input, Critical Input, Direction Select (`Lower is better` / `Higher is better`).
- Buttons: `[Save Targets]`, `[Reset to Defaults]`, `[Close]`.

- [ ] **Step 2: Connect `TargetsModal` to `Overview.tsx`**

Replace hardcoded `PRB Target: 80%` in top executive header with clickable `[Targets]` button.
Clicking `[Targets]` opens `TargetsModal` populated with active technology targets.

- [ ] **Step 3: Verify TypeScript build**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TargetsModal.tsx src/renderer/modules/Overview.tsx
git commit -m "feat(v2): add technology-aware Targets modal and replace header PRB display"
```

---

### Task 5: Dynamic Executive View & Auto-Fitting KPI Card Grid

**Files:**
- Create: `src/renderer/components/KpiCard.tsx`
- Modify: `src/renderer/modules/Overview.tsx`

**Interfaces:**
- `KpiCard` props: `name`, `isDerived`, `value`, `targetStr`, `status`, `trend`, `ncCount`, `ncPct`, `persistentNcCount`, `unit`.

- [ ] **Step 1: Implement `KpiCard.tsx`**

```tsx
import React from 'react';

export interface KpiCardProps {
  name: string;
  isDerived?: boolean;
  value: number | null;
  displayUnit: string;
  targetStr?: string;
  status: 'compliant' | 'warning' | 'breach' | 'unavailable';
  trend: 'improving' | 'worsening' | 'stable';
  ncCount?: number;
  ncPct?: number;
  persistentNcCount?: number;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  name,
  isDerived,
  value,
  displayUnit,
  targetStr,
  status,
  trend,
  ncCount,
  ncPct,
  persistentNcCount,
}) => {
  return (
    <div className={`kpi-card ${status}`}>
      <div className="kpi-card-header">
        <span className="kpi-name">{name}</span>
        {isDerived && <span className="derived-badge">DERIVED KPI</span>}
      </div>
      <div className="kpi-value">
        {value !== null ? `${value.toFixed(2)} ${displayUnit}` : 'Data unavailable'}
      </div>
      {targetStr && <div className="kpi-target">Target: {targetStr}</div>}
      <div className="kpi-footer">
        <span className={`trend ${trend}`}>
          {trend === 'improving' ? '↓ Improving' : trend === 'worsening' ? '↑ Worsening' : '→ Stable'}
        </span>
        {ncCount !== undefined && (
          <span className="nc-stats">NC: {ncCount} ({ncPct?.toFixed(1)}%)</span>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Update `Overview.tsx` to render dynamic card grid**

In `Overview.tsx`, query available KPIs for active `technologyId` ordered by: Core KPIs → Enabled Derived KPIs → Other Imported KPIs.
Render cards using CSS Grid (`display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;`).

- [ ] **Step 3: Run typecheck and smoke build**

Run: `npm run typecheck && npm run build`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/KpiCard.tsx src/renderer/modules/Overview.tsx
git commit -m "feat(v2): implement dynamic executive KPI card grid with derived badges"
```

---

### Task 6: Multi-Grain Non-Compliance (NC) & Breach Charts

**Files:**
- Modify: `src/renderer/modules/NcIntelligence.tsx`
- Modify: `src/renderer/modules/HealthMatrix.tsx`
- Modify: `src/main/analytics/nc.ts`

- [ ] **Step 1: Update NC query service to support `daily`, `weekly`, `monthly` grains**

In `src/main/analytics/nc.ts`, update `getNcOverview(context: UniversalAnalysisContext)` to evaluate breaches using:
- `fact_kpi_daily` for `daily` grain;
- `agg_cell_kpi_period` with `grain='weekly'` & `breach_days >= weekly_breach_days` for `weekly` grain;
- `agg_cell_kpi_period` with `grain='monthly'` & `breach_days >= monthly_breach_days` for `monthly` grain.

- [ ] **Step 2: Connect NC Intelligence UI to Grain toggle**

In `NcIntelligence.tsx`, ensure all breach charts (Breach Trend, Breach Distribution, District Heatmap, NC Cell Table) subscribe to `grain` from `useAppStore()`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/analytics/nc.ts src/renderer/modules/NcIntelligence.tsx src/renderer/modules/HealthMatrix.tsx
git commit -m "feat(v2): enable multi-grain breach analytics for daily, weekly, and monthly views"
```

---

### Task 7: Full Verification, Smoke Build & Execution Readiness

**Files:**
- Run full test suite & build checks.

- [ ] **Step 1: Run unit tests**

Run: `npm test`  
Expected: All PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 3: Run smoke build**

Run: `npm run smoke`  
Expected: PASS

- [ ] **Step 4: Commit final v2 baseline**

```bash
git commit --allow-empty -m "chore(v2): verify full v2 architecture baseline build and test readiness"
```
