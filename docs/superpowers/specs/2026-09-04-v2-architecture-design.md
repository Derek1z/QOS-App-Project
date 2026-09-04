# Version 2 Architecture Design Specification
**Date**: 2026-09-04  
**Project**: 2G/3G/4G QoS Network Intelligence Workstation (v2.0.0)  
**Status**: Approved

---

## 1. Executive Summary & V2 Core Principles

Version 2 upgrades the QoS Network Intelligence application into a fully dynamic, multi-technology (2G / 3G / 4G) telecom analytics workstation. V2 completely eliminates the hardcoded metrics (PRB, Users, Volume, Throughput, Availability), rigid UI card layouts, and grain-mismatch defects present in V1.

### Primary Objectives:
1. **Generic Long-Form Data Architecture**: Store observations in a dynamic DuckDB EAV/Observation model (`fact_kpi_daily`), supporting arbitrary vendor KPIs without modifying database schemas.
2. **Universal Grain Synchronization**: Enforce a global `UniversalAnalysisContext` (Technology, Primary KPI, Grain, Range, Scope) across all charts, cards, tables, maps, and investigation views. Changing technology or scope instantly updates 100% of analytical components.
3. **Dynamic Executive View**: Render dynamic KPI cards prioritized by Core KPIs → Derived KPIs → Imported KPIs. Remove hardcoded header targets and replace them with a clickable `[Targets]` control.
4. **Technology-Aware Targets Panel**: Interactive slide-out drawer providing view, edit, warning/critical threshold, and compliance direction configuration per technology, with instant propagation across all analytics.
5. **Reusable Derived KPI & Counter Formula Engine**: Compute derived KPIs (such as 3G DL Power Congestion, UL CE Congestion, PhyCh Failures) row-by-row with strict null handling, missing counter protection, and smart counter pattern intelligence for automated discovery.

---

## 2. Generic Database Architecture & Data Retention

### 2.1 DuckDB Schema Definition (Version `0.2.0`)

```sql
-- Technology Dimension
CREATE TABLE IF NOT EXISTS dim_technology (
  technology_id INTEGER PRIMARY KEY,
  code VARCHAR NOT NULL UNIQUE,       -- '2G', '3G', '4G'
  display_name VARCHAR NOT NULL,
  enabled BOOLEAN DEFAULT true
);

-- Cell Dimension linked to Technology
ALTER TABLE dim_cell ADD COLUMN IF NOT EXISTS technology_id INTEGER;

-- KPI Metadata Registry
CREATE TABLE IF NOT EXISTS dim_kpi (
  kpi_id BIGINT PRIMARY KEY,
  technology_id INTEGER NOT NULL,
  canonical_key VARCHAR NOT NULL,
  display_name VARCHAR NOT NULL,
  category VARCHAR NOT NULL,          -- 'Accessibility', 'Retainability', 'Mobility', etc.
  role VARCHAR NOT NULL,              -- 'compliance', 'supporting', 'informational'
  source_unit VARCHAR,
  display_unit VARCHAR NOT NULL,
  conversion_type VARCHAR NOT NULL DEFAULT 'none',
  conversion_formula VARCHAR,
  target DOUBLE,
  operator VARCHAR,                   -- '>=', '<='
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

-- Fact Cell Daily (Structural)
CREATE TABLE IF NOT EXISTS fact_cell_day (
  technology_id INTEGER NOT NULL,
  date_id INTEGER NOT NULL,
  cell_id BIGINT NOT NULL,
  source_import_id BIGINT,
  PRIMARY KEY (technology_id, date_id, cell_id)
);

-- Unified Observation Fact Table
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

-- Derived KPI Configuration & Formula Store
CREATE TABLE IF NOT EXISTS derived_kpi_config (
  derived_kpi_id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  technology_id INTEGER NOT NULL,
  operation VARCHAR NOT NULL,         -- 'SUM', 'AVERAGE', 'RATIO', 'CUSTOM'
  source_kpi_keys JSON NOT NULL,
  custom_expression VARCHAR,
  display_unit VARCHAR,
  target DOUBLE,
  warning_threshold DOUBLE,
  critical_threshold DOUBLE,
  direction VARCHAR NOT NULL,         -- 'HIGHER_IS_BETTER', 'LOWER_IS_BETTER'
  treat_missing_as_zero BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true
);

-- Technology Target Overrides
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
```

### 2.2 Data Retention Policy
- **Processed Generic Facts**: Retain the latest **90 distinct reporting dates** shared across all technologies in `.qosdb`.
- **Raw File Retention**: Source files preserved for **90 calendar days**.

---

## 3. Reusable Derived KPI & Formula Engine

### 3.1 3G Congestion Built-In Derived Formulas
Calculated **row-by-row** across imported counters:

1. **DL Power Congestion**:
   $$\text{VS.RRC.Rej.DLPower.Cong} + \text{VS.RAB.FailEstabPS.DLPower.Cong} + \text{VS.RAB.FailEstabCS.DLPower.Cong}$$
2. **UL CE Congestion**:
   $$\text{VS.RRC.Rej.ULCE.Cong} + \text{VS.RAB.FailEstabPS.ULCE.Cong} + \text{VS.RAB.FailEstabCS.ULCE.Cong}$$
3. **PhyCh Failures**:
   $$\text{VS.RAB.FailEstabPS.PhyChFail} + \text{VS.FailRBRecfg.PhyChFail} + \text{VS.FailRBSetup.PhyChFail}$$

### 3.2 Smart Counter Intelligence & Auto-Discovery
- **Pattern Matching**: Scans incoming unmapped column headers for domain clusters (`Rej`, `Fail`, `Cong`, `Drop`, `Att`, `Block`).
- **Automated Suggestions**: Prompts user during import if 2 or more related raw counters are detected, offering one-click candidate creation (`[Create Derived KPI]`, `[Edit Formula]`, `[Ignore]`).
- **Workspace Learning**: Custom formulas are persisted to the workspace configuration library and automatically applied to future imports.

### 3.3 Strict Null & Missing Counter Rules
- **Missing Counter Column**: Derived KPI flagged as `"Data unavailable"` (e.g., `Missing: VS.RAB.FailEstabCS.DLPower.Cong`). Silent zero substitution is forbidden unless `treatMissingAsZero = true` is explicitly configured.
- **Row-Level Null Handling**: Calculated safely in SQL:
  ```sql
  CASE 
    WHEN c1 IS NULL OR c2 IS NULL OR c3 IS NULL THEN NULL 
    ELSE c1 + c2 + c3 
  END
  ```

---

## 4. Universal Analysis Context & Grain Synchronization

### 4.1 State Architecture (`UniversalAnalysisContext`)
Single source of truth in Zustand store:

```ts
export interface UniversalAnalysisContext {
  technologyId: number;        // 2G (2), 3G (3), 4G (4)
  primaryKpiId: number;       // Active primary KPI ID
  supportingKpiIds: number[]; // Up to 4 supporting KPI IDs for driver analysis
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

### 4.2 Universal Synchronization & Multi-Grain NC Rules
- **Global Broadcast**: Changing `technologyId` broadcasts `TECHNOLOGY_CHANGED`.
- **Query Scoping**: All modules (Overview, Performance, District Analysis, Non-Compliance, Health Matrix, Investigation Workspace, Reports) subscribe to `UniversalAnalysisContext`.
- **Instant Response**: 100% of charts, maps, cards, and tables re-query DuckDB for the active technology and KPI scope, eliminating all grain-mismatch defects.
- **Multi-Grain Non-Compliance & Breach Charts**:
  - Non-Compliance (NC) and breach charts (Breach Trends, Breach Distribution, District Breach Heatmaps, Cell Breach Lists) are **fully multi-grain aware**.
  - They dynamically calculate and display breach metrics across **Daily (`daily`)**, **Weekly (`weekly`)**, and **Monthly (`monthly`)** time grains.
  - Weekly breach status is evaluated against configured `weekly_breach_days` (distinct breached days per week); Monthly breach status is evaluated against `monthly_breach_days`.


---

## 5. Executive UI & Technology-Aware Targets Panel

### 5.1 Layout Hierarchy
1. **Header Toggles**: `[2G]` `[3G]` `[4G]`.
2. **Technology Health Card**: Overall health %, Compliant cells, NC cells, Persistent issues.
3. **`[Targets]` Button**: Interactive clickable control replacing the old `PRB Target: 80%` display.
4. **Dynamic KPI Card Grid**:
   - Auto-fitting CSS grid supporting 3 to 10+ cards.
   - Priority Order: Core KPIs → Enabled Derived KPIs (`DERIVED KPI` badge) → Imported KPIs.
   - Content: Name, Derived Badge, Current Value, Target, Compliance Status (`✓ Compliant`, `⚠️ Warning`, `🚨 Breach`), Trend arrow (`↑`, `↓`, `→`), NC Count, NC %, Persistent NC Count.
   - Safe `"Data unavailable"` display for missing values.

### 5.2 Technology-Aware Targets Panel
- Opens when clicking `[Targets]`.
- Displays thresholds for the active technology (2G, 3G, or 4G).
- Inline editing for Target, Warning, Critical thresholds, and Compliance Direction (`HIGHER_IS_BETTER` vs `LOWER_IS_BETTER`).
- Immediate propagation to health scores, cards, NC analysis, district analysis, investigation, reports, and alerts upon saving.
