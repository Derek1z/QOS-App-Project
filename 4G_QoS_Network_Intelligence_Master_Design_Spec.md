# 4G QoS Network Intelligence — Master Design Specification

## 1. Product Vision
Build a professional, portable Windows desktop application for telecom QoS analytics that evolves the current dashboard into a full engineering intelligence workstation.

The product should help users:

**Explore → Diagnose → Prioritize → Compare → Forecast → Investigate → Report**

Version 1 requirements:
- Windows only
- No installation
- No admin rights
- One portable executable: `4G_QoS.exe`
- Multiple independent workspace files: `*.qosdb`
- Fully offline operation
- Portable folder model
- 50M+ row and multi-year design target
- 100M+ row architectural growth target

## 2. Core Technology Stack
- **Electron** desktop application
- **DuckDB** embedded analytical engine
- One DuckDB-backed `.qosdb` per workspace
- Modular single-executable architecture
- Mature embedded charting engine
- Virtualized tables/matrices
- Background workers/processes for imports, queries, forecasting, reporting, backups, and maintenance

## 3. Portable Folder Model
```text
4G QoS\
├── 4G_QoS.exe
├── workspaces\
│   ├── MTN_4G.qosdb
│   ├── Test_Network.qosdb
│   └── ...
├── backups\
├── exports\
└── app_state.json
```
The entire folder can be moved to another Windows PC or USB drive.

## 4. Workspace Model
Workspaces are fully independent. Each `.qosdb` owns:
- processed KPI history
- thresholds and engineering bands
- Weekly breach rules
- source mappings
- NC lifecycle settings
- Priority Score weights
- forecasting settings
- saved views and watchlists
- annotations and investigations
- reports and report definitions
- import and audit history
- raw-source archive
- security configuration
- report branding
- ruleset history
- workspace snapshots

Only basic app preferences are global, such as recent workspace list, last workspace path, window position, UI appearance, and density.

## 5. Startup and Workspace Opening
Default startup:
1. Launch `4G_QoS.exe`
2. Reopen last workspace automatically
3. Validate workspace
4. Load cached/precomputed summary
5. Render dashboard quickly
6. Continue deeper initialization in background

If unavailable, offer:
- Locate Workspace
- Open Recent
- Create New Workspace

## 6. Workspace Security
Encryption is optional per workspace.

Protected workspaces use:
- password
- recovery key

Recovery key rules:
- generated when encryption is enabled
- user must confirm it was saved
- never stored inside the same workspace in recoverable form
- can unlock workspace if password is forgotten
- recovery event is audited

Protected scope includes:
- processed data
- raw-source archive
- mappings
- notes
- investigations
- saved views
- reports
- audit records
- settings
- classifications
- metadata

Encrypted workspace backups remain encrypted.

### Export security
For exports from encrypted workspaces, always ask:
- Save normally
- Protect this export

Never silently create an unprotected export.

## 7. Backups and Snapshots
### Backups
Keep latest **7 automatic backups**.
Create before:
- major imports
- migrations
- destructive maintenance
- structural changes
- manual backup

Backup #8 removes the oldest.

### Workspace snapshots
Snapshots are for analytical milestones, not disaster recovery.
Examples:
- Before PRB threshold change
- Month-end July 2026
- Before optimization campaign

## 8. Read-only Mode and Locking
Workspaces can open in:
- Normal
- Read Only

Read-only permits dashboards, filtering, analysis, and exports, but blocks imports, notes, status changes, settings changes, maintenance, and writes.

Only one writable app instance may open a workspace at once. A second instance may open read-only.

## 9. Data Retention
- **Processed data:** retain indefinitely
- **Raw source CSV/XLSX:** keep compressed copies for **90 days**

After 90 days:
- raw file blob is removed
- processed data remains
- filename/checksum/import metadata/validation history remain

## 10. Expected Scale
Design for:
- ~143,000 cells/day
- 50M+ rows
- 100M+ row growth
- multi-year history
- long-term daily/weekly/monthly analysis

The UI must never directly load millions of raw fact rows.

## 11. Canonical Source Schema
Expected columns:
```text
DATETIME
DISTRICT
REGION
CELL
BASESTATION
4G Peak Hour Traffic Utilization_NCA
RRC Connected UEs (Avg)_STD(#)
4G Data Volume_STD(MB)
4G Cell Availability_STD(%)
E-UTRAN IP Throughput UE DL_STD(kbps)
```
Mappings:
- PRB Utilization
- Connected Users
- Data Volume
- Availability
- DL Throughput
- District
- Region
- Cell
- Site/Base Station
- Date

Display conversions:
- MB → GB
- kbps → Mbps

## 12. Import System
Supported:
- Manual Import
- Drag and Drop

Flow:
```text
Select/drop files
→ Detect format
→ Smart mapping
→ Validate
→ Preview
→ Confirm
→ Backup
→ Stage
→ Deduplicate
→ Merge transactionally
→ Update dimensions
→ Update aggregates
→ Refresh intelligence
→ Complete
```

Default import batch behavior is atomic. A critical failure cancels the batch and leaves the workspace unchanged.

## 13. Smart Mapping
Mappings are remembered per source fingerprint using:
- normalized header set
- column order
- sheet pattern
- filename pattern
- optional source/vendor label

High-confidence matches reuse mappings automatically. Material schema changes require review. Never guess critical KPI mappings.

## 14. Data Validation
Severity levels:
- **Error:** unsafe to import
- **Warning:** import possible but review recommended
- **Information:** normal import event

Validation includes:
- required columns
- dates
- numeric parseability
- missing Cell/Region/District
- PRB/Availability range sanity
- negative Users/Traffic/Throughput
- schema confidence

Suspicious values should warn, not silently delete, unless explicitly configured as reject.

## 15. Duplicate Policy
Logical key: **Date + Cell**

Rule: **oldest/first stored record wins**.
Incoming duplicates do not overwrite stored observations.

## 16. Import Audit
Each import records:
- Import ID
- timestamp
- files
- source rows
- inserted rows
- duplicates ignored
- rejected rows
- mapping profile
- schema version
- validation result
- raw checksum
- database before/after
- ruleset

## 17. Data Quality Score
Each import/day can receive a transparent score based on:
- cell coverage
- KPI completeness
- rejected rows
- mapping confidence
- duplicate behavior
- unexpected dimension changes

Analytics modules may warn when source quality is weak.

## 18. Data Coverage
Coverage views show:
- daily completeness
- expected vs observed cells
- coverage %
- missing/new cells
- completed/partial weeks

## 19. Time Grain
Supported:
- Daily
- Weekly
- Monthly

Weekly definition:
- Monday–Sunday
- ISO week number
- complete weeks only

Partial weeks:
- excluded from Weekly analytics
- still available in Daily mode

Weekly chart axes show `W31`, `W32`, etc.; full date ranges appear only in hover/export metadata.

## 20. Weekly NC Logic
Control: **Weekly NC breach days ≥ N**
- N = 1–7
- default = 1

A cell is Weekly NC when it breaches the High PRB threshold on at least N distinct days in a completed week.

A cell counts once per week.

Weekly Total Cells = distinct cells observed.
Weekly NC Cells = distinct qualifying cells.
Weekly NC Rate = Unique NC / Unique Total × 100.

## 21. Weekly KPI Aggregation
| Metric | Weekly rule |
|---|---|
| Unique Cells | Distinct |
| Unique NC Cells | Distinct qualifying cells |
| NC Rate | Unique NC / Unique Total |
| PRB | Average |
| Peak PRB | Maximum |
| Data Volume | Sum |
| Connected Users | Sum |
| DL Throughput | Average |
| Availability | Average |

## 22. District Compliance
District NC Rate = Unique Weekly NC Cells / Unique Weekly Total Cells.

District is NC when NC Rate ≥ configured threshold.
Default District NC threshold = **10%**.

## 23. Application Shell
Persistent collapsible left navigation:
```text
Overview
Network Explorer
Cell Intelligence
Performance
NC Intelligence
Health Matrix
Comparison Lab
Investigation
Priority Center
Forecasting
Reports

Data Manager
Workspace
```

Global command bar contains Workspace, Period, Grain, Compare, Region, District, Site, PRB threshold, Weekly breach days, Import, Export, and Saved View.

## 24. Global Analytical Context
Shared context may contain:
- workspace
- period
- grain
- comparison
- Region(s)
- District(s)
- Site(s)
- ruleset
- cohort
- metric

Modules can follow or intentionally detach from this context.

## 25. Network Hierarchy
Canonical hierarchy:
**Network → Region → District → Site → Cell**

Breadcrumbs support drill navigation.

## 26. Saved Views
Saved Views remember:
- module
- filters
- period/grain
- comparison
- thresholds
- chart state
- cohort
- sort order
- visible columns
- layout configuration

They do not duplicate underlying KPI data.

## 27. Command Palette
Shortcut: **Ctrl + K**

Examples:
- Open Cell CELL001
- Go to Upper West
- Show Persistent NC
- Import Data
- Generate Weekly Report
- Compare W32 vs W31
- Open Capacity Watchlist

## 28. Executive Overview
Purpose: answer in under 15 seconds:
- How healthy is the network?
- What changed?
- Where?
- Why?
- What needs attention?

Components:
- executive KPI strip
- Network Health Score
- Ghana health map
- network trend
- NC movement
- Top Priorities preview
- Health Matrix preview
- Executive Observations
- Comparison mode
- Presentation mode

## 29. Network Health Score
Transparent, configurable score based on visible components such as:
- Capacity
- Throughput
- Availability
- NC recurrence
- Growth pressure

Never opaque.

## 30. Ghana Map
Color modes can include:
- Weekly NC Rate
- PRB
- Throughput
- Availability
- Traffic
- Priority Score
- New NC
- Persistent NC
- Forecast Risk

Supports hover, multi-region selection, and click-to-filter.

## 31. Network Explorer
First-class hierarchical navigation and analysis.

Features:
- searchable/virtualized tree
- Network → Region → District → Site → Cell
- time-aware status indicators
- peer comparisons
- pins/quick access
- context actions
- direct navigation to analytical modules

## 32. Cell Intelligence Center
Contains **all cells**, not only Top 10.

Filters include:
- All
- NC
- Healthy
- New
- Recurring
- Persistent
- Recovering
- Worsening
- Critical

Cell table may include:
- Cell/Site/District/Region
- Lifecycle/Trend/Severity
- PRB/Peak PRB/Breach Days
- Traffic/Users/Throughput/Availability
- Priority Score

Supports advanced filters, bulk actions, watchlists, notes, cohort analysis, and direct investigation.

## 33. Cell Detail — Actual Metrics
Default detailed chart mode uses five vertically aligned charts:
1. PRB
2. Traffic
3. Connected Users
4. DL Throughput
5. Availability

Each has independent Y-axis, units, threshold, and engineering bands.

Shared interaction only:
- X-axis/time
- cursor
- zoom
- pan
- selected period
- comparison overlay
- event markers

Never share incompatible raw Y-scales.

## 34. Cell Detail — Relationship View
Separate normalized/indexed mode with baseline = 100.

Used to compare movement between PRB, Traffic, Users, Throughput, and Availability.

This view never replaces Actual Metrics.

## 35. NC Intelligence
Three independent dimensions:

### Lifecycle
- Healthy
- New NC
- Recurring NC
- Persistent NC
- Recovering

### Trend
- Improving
- Stable
- Worsening

### Severity
- Normal
- Watch
- High
- Critical

A cell can be **Persistent NC · Worsening · Critical**.

## 36. Persistent NC
Default: **3 consecutive qualifying weeks**.
Configurable per workspace.

## 37. Lifecycle Logic
- **New NC:** qualifies now, no recent prior NC
- **Recurring NC:** qualifies now after a healthy period, but had older NC history
- **Persistent NC:** qualifies for configured consecutive periods
- **Recovering:** was NC last period, healthy now
- second healthy period can transition Recovering → Healthy

## 38. Trend Classification
Trend considers:
- PRB direction
- breach-day direction
- Throughput direction
- Traffic direction
- Users direction

Use configurable tolerances so noise is not overclassified.

## 39. Severity
Severity reflects current urgency using evidence such as:
- PRB severity
- recurrence/persistence
- user impact
- traffic impact
- throughput degradation
- worsening trend
- availability context

## 40. Performance Analysis
Capabilities:
- metric-specific summaries
- percentiles
- distributions
- rankings
- performance heatmaps
- scatterplots
- quadrant analysis
- correlation table
- growth analysis
- anomaly overlay
- engineering bands
- rolling/change/comparison modes

Correlation is descriptive, not causal.

## 41. Health Matrix
First-class historical module.

Rows can be:
- Region
- District
- Site
- Cell

Columns can be:
- Day
- Week
- Month

Metrics can include:
- NC Rate
- PRB
- Throughput
- Traffic
- Users
- Availability
- Priority
- Persistent NC
- Critical NC
- Anomaly Count

Modes:
- Absolute
- Change
- Highlight Runs
- Cohort
- Compare Matrix

Uses virtualization and drill-down.

## 42. Comparison Lab
Comparison types:
- Period vs Period
- Region vs Region
- District vs District
- Site vs Site
- Cell vs Cell
- Cohort vs Cohort

Visualization modes:
- Actual Values
- Indexed
- Delta

Features:
- KPI comparison
- difference ranking
- distribution comparison
- split/change maps
- NC transitions
- significant-change filtering
- saved comparisons

## 43. Priority Center
Transparent 0–100 Priority Score.

Default weights:
| Component | Weight |
|---|---:|
| PRB severity | 25 |
| Persistence/recurrence | 20 |
| User impact | 15 |
| Traffic impact | 15 |
| Throughput degradation | 15 |
| Worsening trend | 10 |

Weights configurable.

Priority bands default:
- 90–100 Critical
- 75–89 High
- 50–74 Medium
- 25–49 Watch
- 0–24 Low

Priority modes:
- Balanced
- Customer Impact
- Congestion Severity
- Persistence
- Rapid Deterioration

Supports Cells, Sites, Districts, Regions.

## 44. Priority Workflow
Action Status:
- Unreviewed
- Investigating
- Escalated
- Optimization in progress
- Monitoring
- Resolved
- Deferred

Optional fields:
- owner
- external ticket
- target review date

## 45. Forecasting & Early Warning
Forecast horizons:
- next week
- 2 weeks
- 4 weeks
- short custom horizon

Forecastable metrics:
- PRB
- Traffic
- Users
- Throughput
- Availability

Risk states:
- Stable
- Watch
- At Risk
- Likely Breach
- Already Breached

Every forecast exposes trajectory, confidence, model quality, historical error, and explanation.

## 46. Forecast Strategy
Prefer simple validated methods first:
1. moving averages / linear trend
2. exponential smoothing / ETS
3. autoregressive / robust regression
4. more advanced models only when justified

Track MAE, RMSE, directional accuracy, threshold prediction accuracy.
Suppress low-quality forecasts.

## 47. Investigation Workspace
Supports Cell, Site, District, or Cohort.

Includes:
- classifications
- KPI evidence strip
- Actual Metrics
- Relationship View
- lifecycle/lifetime history
- peer comparison
- diagnostic relationships
- deterministic diagnosis
- alternative hypotheses
- investigation checklist
- notes/events
- before/after analysis
- snapshots
- exportable investigation report

## 48. Evidence-Based Diagnosis
Use deterministic evidence first.
Language should use calibrated phrasing such as:
- consistent with
- suggests
- evidence supports

Do not claim root cause beyond imported data.

Alternative hypotheses should show supporting and contradicting evidence.

## 49. Notes and Events
Store:
- user notes
- status changes
- threshold events
- import events
- classification changes
- priority changes
- ticket references
- optimization events

Event annotations appear across synchronized charts.

## 50. Before/After Analysis
Users can mark intervention events and compare windows before/after across:
- PRB
- Traffic
- Users
- Throughput
- Availability

## 51. Reporting Center
Report types:
- Executive
- Engineering
- Investigation
- Capacity Watch
- Custom

Outputs:
- Excel
- PowerPoint
- PDF
- CSV
- PNG
- report packs

## 52. Report Builder
Users can:
- choose sections
- reorder
- configure
- save templates
- preview
- validate
- generate packs

Templates can include Weekly Management, Monthly Network Performance, Capacity Review, Persistent NC Escalation.

## 53. Excel Reporting
Potential sheets:
1. Executive Summary
2. KPI Trend
3. Region Analysis
4. District Analysis
5. Site Analysis
6. All Cells
7. NC Register
8. Persistent NC
9. Priority Queue
10. Forecast Risk
11. Health Matrix
12. Lifecycle Analysis
13. Import Metadata

Use tables, filters, frozen panes, conditional formatting, embedded charts, metadata, and proper units.

## 54. PowerPoint Reporting
Generate editable `.pptx` where practical.
Potential slides:
1. Cover
2. Executive Summary
3. Ghana Map
4. KPI Movement
5. NC Lifecycle
6. Deteriorating Districts
7. Priority Cells
8. Forecast Risk
9. Recommended Focus

Themes:
- Corporate Light
- Executive Dark
- Engineering
- Presentation Minimal
- Custom

Branding is workspace-specific.

## 55. PDF and Snapshot Reports
PDF is for distribution/archive.
Snapshot reports freeze:
- scope
- thresholds
- KPI values
- classifications
- chart data
- comparison
- narratives
- ruleset version

## 56. Report History and Schedules
Track generated reports with workspace, period, template, formats, ruleset, snapshot status.

Schedules are app-local only; no Windows service. When app opens, it can detect due report definitions and offer generation.

## 57. Data Manager
Responsibilities:
- import
- mappings
- validation
- coverage
- audit
- raw archive
- backups
- maintenance
- data-quality monitoring

## 58. Workspace Maintenance
Actions:
- optimize database
- rebuild aggregates
- verify integrity
- purge expired raw files
- rebuild search indexes
- compact workspace
- analyze storage

Create backup first for state-altering repair operations.

## 59. Workspace Health
Checks:
- database integrity
- encryption health
- backup freshness
- incomplete imports
- stale aggregates
- missing mappings
- coverage gaps
- disk-space risk

## 60. DuckDB Data Model
Dimensions:
- `dim_region`
- `dim_district`
- `dim_site`
- `dim_cell`
- `dim_source`
- `dim_date`

Main fact:
- `fact_cell_daily`

Example fact fields:
- date_id
- cell_id
- prb_utilization
- data_volume_mb
- connected_users
- dl_throughput_kbps
- availability_pct
- source_import_id

## 61. Derived Aggregates
Potential tables:
- `agg_cell_weekly`
- `agg_cell_monthly`
- `agg_site_daily/weekly/monthly`
- `agg_district_daily/weekly/monthly`
- `agg_region_daily/weekly/monthly`
- `agg_network_daily/weekly/monthly`

## 62. Derived Intelligence
Potential structures:
- `cell_nc_lifecycle`
- `cell_priority_history`
- `cell_anomalies`
- `cell_forecasts`
- `cell_health_history`
- `entity_action_status`
- `investigation_events`

Raw source observations remain separate from derived intelligence.

## 63. Ruleset Versioning
Example:
```text
Ruleset v12
PRB threshold = 80%
Weekly breach = 3 days
Persistent threshold = 3 weeks
District NC threshold = 10%
```

Changing rules:
- creates a new version
- never alters raw observations
- can recompute derived intelligence
- writes audit event
- reports/snapshots reference ruleset used

## 64. Query Service
UI modules should call centralized analytics interfaces, not embed SQL everywhere.
Examples:
- `getNetworkSummary(scope)`
- `getRegionPerformance(scope)`
- `getDistrictPerformance(scope)`
- `getCellHistory(cell, period)`
- `getHealthMatrix(scope, metric)`
- `getPriorityQueue(scope)`
- `getNcLifecycle(scope)`
- `getForecastRisk(scope)`

## 65. Cache Architecture
- **L1:** in-memory active-screen cache
- **L2:** persisted analytical aggregates in `.qosdb`
- **L3:** full fact history

Cache keys include workspace, ruleset, period, grain, scope, metric, filters.

## 66. Incremental Processing
On new import, update only affected:
- days
- weeks
- months
- cells
- Sites
- Districts
- Regions
- forecasts
- priority scores
- classifications

Never rebuild all history unnecessarily.

## 67. Search and Virtualization
Search dimension tables, not fact history.
Global search should find Cell/Site/District/Region near-instantly.

Virtualize:
- Cell Intelligence
- Health Matrix
- large tables
- long lists

DuckDB performs sorting/filtering/pagination.

## 68. Charting Architecture
Use a mature embedded chart engine with:
- synchronized cursors
- independent Y-axes
- zoom/pan
- brush selection
- heatmaps
- threshold bands
- annotations
- tooltips
- mark lines/areas
- large scatterplots
- PNG/SVG export
- aligned multi-grid layouts

## 69. Long Time-Series Handling
Use meaningful temporal aggregation, not blind point deletion.
Suggested automatic grain:
- short → Daily
- medium → Weekly
- long → Monthly

User can override.

## 70. Scatterplot Performance
For large cell populations:
- canvas/GPU rendering
- density mode
- aggregation when zoomed out
- full detail when zoomed in
- statistics always use full population

## 71. Background Task Manager
Track:
- imports
- reports
- forecasts
- backups
- maintenance

Users can continue navigating while tasks run.
No console windows.

## 72. Event Bus
Internal events may include:
- FILTER_CHANGED
- PERIOD_CHANGED
- WORKSPACE_CHANGED
- RULESET_CHANGED
- IMPORT_COMPLETE
- FORECAST_UPDATED
- CELL_SELECTED

Modules coordinate via event/context boundaries rather than tight coupling.

## 73. Memory and Disk Strategy
Renderer should never retain huge raw arrays.
Use:
- virtualized views
- lazy loading
- worker exports
- chart disposal
- query memory limits
- DuckDB disk spill

Track workspace size, raw archive size, growth rate, free disk, and predicted time to storage threshold.

## 74. Performance Targets
| Operation | Target |
|---|---:|
| Startup to summary | <5 sec typical |
| Cached filter change | <1 sec |
| Uncached filter change | ~2 sec typical |
| Open Cell Intelligence | <2 sec |
| Cell/Site search | near-instant |
| Open Cell history | <1 sec typical |
| Weekly Overview | <2 sec |
| Health Matrix viewport | <2 sec |
| Priority sort/filter | <1 sec |
| Import UI | responsive throughout |
| 50M+ rows | supported |
| 100M+ rows | architectural target |

## 75. Presentation Mode
Executive Overview can hide engineering controls and show a clean management presentation layout.

## 76. Deterministic Observations
Narratives should come from transparent analytical rules first.
Examples:
- what changed
- where
- likely contributing pattern
- what improved
- priority focus
- forecast risk

Never invent source facts.

## 77. Version 1 Scope Boundary
Do not assume data that is not imported.
Do not claim:
- actual neighbor relations
- carrier configuration
- radio parameters
- antenna azimuth
- hardware capacity
- alarms/root-cause records

unless those datasets are added later.

The app may recommend investigation steps but must not fabricate configuration-level causes.

## 78. Approved Version 1 Modules
1. Executive Overview
2. Network Explorer
3. Cell Intelligence
4. Performance Analysis
5. NC Intelligence
6. Health Matrix
7. Comparison Lab
8. Investigation Workspace
9. Priority Center
10. Forecasting & Early Warning
11. Reporting Center
12. Data Manager
13. Workspace Manager & Security
14. Command Palette
15. Background Task Manager

## 79. Core Product Principle
**Raw data is immutable evidence.**

**Rules convert evidence into classifications.**

**Analytics converts classifications into insight.**

**Priority converts insight into action.**

**Investigation provides engineering evidence.**

**Forecasting provides early warning.**

**Reporting communicates the result.**

## 80. Final Product Target
Primary deliverable:
```text
4G_QoS.exe
```

Portable Windows application:
- double-click to run
- no installation
- no admin rights
- no command prompt
- no browser tab
- no local server setup

Operational data lives in portable:
```text
*.qosdb
```
workspaces.

The target product is a full **4G QoS Network Intelligence engineering workstation**, not simply a heavier dashboard.
