# 📡 2G/3G/4G QoS Network Intelligence Workstation

> **Portable, multi-technology telecom QoS analytics and regulatory compliance workstation built on Electron, React 19, and embedded DuckDB.**

---

## 📸 Application Snapshots & Gallery

| 📊 Executive Overview & Multi-Tech Dynamic Cards | 🕵️ 3G/4G Investigation Workspace & Diagnostic Cards |
| :---: | :---: |
| ![Executive Overview](docs/screenshots/executive_overview.png) | ![Investigation Workspace](docs/screenshots/investigation_workspace.png) |
| *Executive KPI strip, breach count toggles & dynamic cards* | *5-Panel multi-grid telemetry, 3G diagnostic counters & RCA* |

| 🗺️ Ghana GIS Regional Choropleth Map | 📥 Multi-Vendor Data Import & Quality Engine |
| :---: | :---: |
| ![Ghana GIS Map Analytics](docs/screenshots/ghana_map_analytics.png) | ![Data Manager Import](docs/screenshots/data_manager_import.png) |
| *16-Region GeoJSON map with 253 district drill-down* | *Drag-and-drop CSV/XLSX parser with auto-alias detection* |

---

## 🚀 Current Application State (100% Production Ready)

The workstation is fully built, hardened, and verified across all **13 core analytics modules**, featuring an offline embedded **DuckDB** columnar data engine, automated **National Communications Authority (NCA)** regulatory rule evaluation, multi-vendor counter auto-mapping (Huawei, Ericsson, Nokia), and 1-click executive slide deck and native Excel chart exports.

### Verification Status
* **TypeScript Compiler**: `0 errors` (`npm run typecheck`)
* **Automated Test Suite**: `25/25 suites passed` (`npm run smoke` $\to$ `SMOKE_OK`)
* **Windows Portable Executable**: `release/2G_3G_4G_QoS.exe` (119.48 MB, standalone)
* **Windows Portable Folder Archive**: `release/2G_3G_4G_QoS_Portable_Folder.zip` (225.59 MB, portable `.zip`)

---

## 🛠️ Complete Module Map (13 Interactive Modules)

### 1. 📊 Executive Overview
* **Interactive Ghana GIS Choropleth**: 16-Region GeoJSON map with 1-click drill-down into 253 District boundaries. Automatically reverses color scales for non-compliance metrics (higher PRB/NC = darker red) while keeping health scores standard. Clicking any region/district filters the workstation or opens its investigation.
* **Network Health Score Line Chart**: Multi-week health trend with Watch threshold mark and component tooltip breakdown.
* **NC Movement Stacked Area**: Live tracking of weekly lifecycle transitions (`New NC`, `Recurring NC`, `Persistent NC`, `Chronic NC`, `Recovering`).
* **Top Priorities Preview**: Real-time top-8 priority queue preview powered by the 6-component priority scoring engine.

### 2. 🛡️ NC Intelligence (Regulatory Non-Compliance)
* **Lifecycle Distribution**: Categorizes cells into `Healthy`, `New NC`, `Recurring NC`, `Persistent NC`, `Chronic NC`, or `Recovering`.
* **Trajectory Radar**: Evaluates multi-signal trend trajectory (`Improving`, `Stable`, `Worsening`).
* **Severity Matrix**: Four-tier urgency rating (`Normal`, `Watch`, `High`, `Critical`).
* **Interactive Triage Filter Bar**: Keyboard-accessible click-to-filter pills for rapid queue isolation.
* **Ruleset Versioning Editor**: Modifying thresholds creates a versioned audit trail and triggers transactional recomputation without altering raw facts.

### 3. 🎯 Priority Center (Cross-Scope Workflow Queue)
* **Unified Workflow Queue**: Joins cells, sites, and districts with 0–100 priority scores and active `entity_action_status`.
* **SLA Overdue Tracking**: Automatically flags entities past target review dates (excluding `Resolved` / `Deferred`).
* **Workflow Status Assignment**: Assigns entities across 7 workflow states (`Unreviewed`, `Investigating`, `Escalated`, `Optimization in progress`, `Monitoring`, `Resolved`, `Deferred`) with owner tag and external ticket ID.

### 4. 📱 Cell Intelligence
* **Searchable Cell Table**: Paginated DuckDB server-side search by cell name, site, district, region, lifecycle, trend, severity, PRB, breach days, and priority score.
* **Detail Drawer**: Slide-out drawer rendering an aligned 5-grid multi-chart (PRB + threshold mark, throughput, users, volume on shared ISO-week axes with linked cursors) and weekly NC timeline strip.

### 5. 📈 Performance Analysis
* **Percentile Distribution Curves**: P0–P100 percentile plots with P50/P90 threshold markers for PRB, throughput, and payload.
* **PRB-vs-Throughput 4-Quadrant Scatter**: Categorizes cells into engineering quadrants based on active ruleset thresholds.
* **Correlation Matrix**: Color-coded Pearson correlation matrix between traffic, users, PRB, availability, and drops.

### 6. 🔬 Comparison Lab
* **Period-vs-Period Delta View**: Latest vs previous ISO week delta comparison across Cell, Site, District, and Region scopes.
* **Region-vs-Region Delta View**: Regional performance vs network baseline.
* **Visualization Modes**: Toggle between `Actual`, `Indexed`, and `Delta` views with ▲/▼ delta badges colored by impact (direction-aware).
* **Difference Ranking Table**: Ranks worst-degrading cells first with transition tags (`Still NC`, `New NC`, `Recovered`).

### 7. 🌐 Network Explorer
* **Hierarchical Navigation**: Region $\to$ District $\to$ Site $\to$ Cell drill-down with interactive breadcrumbs.
* **Health Rollups**: Entity nodes roll up health scores directly from cell health history. Leaf cell clicks open the detail drawer.

### 8. 🔍 Investigation Workspace
* **Calibrated Language Diagnosis**: Generates findings in evidence-calibrated language (`consistent with`, `suggests`, `evidence supports`).
* **5-Hypothesis Support Engine**: Evaluates 5 root-cause hypotheses (Radio Link Drop, Iub/Transport Congestion, CE/Power Exhaustion, Interference, Hardware Fault) with supporting and contradicting evidence lists.
* **Before / After Intervention Analysis**: Compares up to 8 weeks before vs after an optimization date with direction-aware badges.
* **Audit Timeline & Notes**: Combines user notes with system-audited lifecycle, severity, and status changes. Exports formatted Markdown reports.

### 9. 🔮 Forecasting & Early Warning
* **4-Model Tournament Engine**: Runs a holdout tournament between 4 time-series algorithms:
  1. **SARMA** (Seasonal Auto-Regressive Moving Average)
  2. **Triple Exponential Smoothing** (Holt-Winters)
  3. **Simple Moving Average** (SMA)
  4. **Simple Linear Regression**
* **Best-Fit Selection**: Selects optimal model based on minimum RMSE and AIC with 1 to 6-week horizon projections.
* **Early-Warning Risk Classification**: Classifies entities into `Stable`, `Watch`, `At Risk`, `Likely Breach`, or `Already Breached`.
* **Sparse Data Suppression**: Suppresses forecasts with explicit reasons if fewer than 2 observations exist.

### 10. 📄 Reporting Center
* **Report Pack Generator**: Generates 5 template types (*Executive*, *Engineering*, *Investigation*, *Capacity Watch*, *Custom*).
* **Multi-Format Export**: Markdown, CSV, styled dark-theme HTML, printToPDF, native OOXML 13-sheet Excel (`.xlsx`), and editable PowerPoint (`.pptx`).
* **Native OOXML Excel Charts**: Injects real editable chart objects (`xl/charts/*.xml`) into the Excel zip container so KPI trends, region bar charts, and summary charts remain natively editable in Microsoft Excel.
* **Saved Templates & Schedules**: Automates report generation on weekly, monthly, or quarterly schedules with open-time overdue banners.

### 11. 🌡️ Health Matrix
* **Scope Heatmap**: Multi-week entity heatmap (Cell, Site, District, Region) across 4 to 26-week windows, sorted worst-first or A–Z.

### 12. 📥 Data Manager (Import Hub & Quality Engine)
* **Multi-Tech CSV/XLSX Ingestion Hub**: Drag-and-drop file analyzer with column alias auto-detection (Huawei, Ericsson, Nokia headers).
* **Starter CSV Template Generator**: 1-click creation of starter CSV files for 2G GSM, 3G UMTS, 4G LTE, and Combined datasets.
* **Derived KPI Formula Detection**: Auto-detects and constructs 3G Downlink Power Congestion, Uplink/Downlink CE Congestion, Code Blocking, Iub/TNL Failures, Physical Channel Failures, and Inter-RAT HO Drops.
* **Atomic Worker Pipeline**: Background worker thread handles staging $\to$ validation $\to$ merge $\to$ aggregate refresh with automatic rollback on error. Deduplicates on Date+Cell (oldest wins).
* **Raw-Source 90-Day Archive**: Gzip copies stored in `workspaces/<name>.qosdb.raw/` with 90-day retention auto-purge.

### 13. 🗄️ Workspace & Maintenance
* **Workspace Lifecycle**: Create, open, validate, close, and auto-restore `.qosdb` DuckDB workspaces.
* **Read-Only & Write Lock**: Prevents multi-instance corruption via per-workspace write locks and read-only fallback mode.
* **Point-in-Time Snapshots**: Create, restore, and diff point-in-time workspace snapshots.
* **Workspace Maintenance Tools**: Data Manager tab providing `Integrity Check`, `Optimize` (checkpoint), `Compact` (rebuild database), `Rebuild Intelligence`, and `Purge Expired Raw`.

---

## 📡 Technology KPI Reference & Derived Formulas

### Core & High-Level KPIs
| Tech | Metric Key | Label | Unit | Target Threshold | Direction |
| :---: | :--- | :--- | :---: | :---: | :---: |
| **2G** | `call_setup_success_2g` | 2G CSSR | % | $\ge 95.0\%$ | Higher is better |
| **2G** | `tch_drop_rate` | 2G TCH Drop Rate | % | $\le 1.0\%$ | Lower is better |
| **3G** | `call_setup_success_3g` | 3G Call Connection Success Rate | % | $\ge 95.0\%$ | Higher is better |
| **3G** | `call_drop_rate_3g` | 3G Call Drop Rate | % | $\le 1.0\%$ | Lower is better |
| **3G** | `data_access_success_3g` | 3G Data Access Success Rate | % | $\ge 98.0\%$ | Higher is better |
| **3G** | `availability_3g` | 3G Cell Availability | % | $\ge 99.5\%$ | Higher is better |
| **3G** | `hsdpa_throughput` | HSDPA User Speed | kbps | $\ge 2000\text{ kbps}$ | Higher is better |
| **4G** | `prb_utilization` | 4G PRB Utilization | % | $\le 80.0\%$ | Lower is better |
| **4G** | `volte_cssr` | VoLTE Call Setup Success Rate | % | $\ge 98.0\%$ | Higher is better |
| **4G** | `volte_cdr` | VoLTE Call Drop Rate | % | $\le 0.5\%$ | Lower is better |
| **4G** | `dl_throughput` | 4G Downlink Speed | kbps | $\ge 10000\text{ kbps}$ | Higher is better |

### Auto-Derived Diagnostic Formulas
* **3G Downlink Power Congestion (`3g_dl_power_congestion`)**:  
  `VS.RRC.Rej.DLPower.Cong` + `VS.RAB.FailEstabPS.DLPower.Cong` + `VS.RAB.FailEstabCS.DLPower.Cong`
* **3G Uplink CE Congestion (`3g_ul_ce_congestion`)**:  
  `VS.RRC.Rej.ULCE.Cong` + `VS.RAB.FailEstabPS.ULCE.Cong` + `VS.RAB.FailEstabCS.ULCE.Cong`
* **3G Downlink CE Congestion (`3g_dl_ce_congestion`)**:  
  `VS.RRC.Rej.DLCE.Cong` + `VS.RAB.FailEstabPS.DLCE.Cong` + `VS.RAB.FailEstabCS.DLCE.Cong`
* **3G Downlink Code Congestion (`3g_dl_code_congestion`)**:  
  `VS.RRC.Rej.Code.Cong` + `VS.RAB.FailEstabCS.Code.Cong`
* **3G Iub Transport Congestion & Link Failures (`3g_iub_tn_congestion`)**:  
  `VS.RRC.Rej.TNL.Fail` + `VS.RAB.FailEstabCS.TNL` + `VS.RAB.FailEstabCS.IubFail` + `VS.RAB.FailEstabPS.IubFail`
* **3G Physical Channel Failures (`3g_phych_failures`)**:  
  `VS.RAB.FailEstabPS.PhyChFail` + `VS.FailRBRecfg.PhyChFail` + `VS.FailRBSetup.PhyChFail`
* **3G PS Inter-RAT Handover Drops (`3g_irat_ho_failures`)**:  
  `VS.IRATHO.FailOutPS`

---

## 🛠️ Multi-Platform Native Bindings & Architecture

To support cross-compilation of portable Windows executables from Linux hosts, DuckDB native binaries are managed via a dedicated script:

* **Native Binding Script**: [`scripts/ensure-duckdb-bindings.cjs`](scripts/ensure-duckdb-bindings.cjs)
* **Supported Platforms**:
  * Windows x64: `node_modules/@duckdb/node-bindings-win32-x64/duckdb.node` & `duckdb.dll`
  * Linux x64: `node_modules/@duckdb/node-bindings-linux-x64/duckdb.node` & `libduckdb.so`
* **ASAR Unpacking**: Specified in `package.json` under `build.asarUnpack` (`**/*.node`, `**/*.dll`, `**/*.so`, `**/node_modules/@duckdb/**`) so Electron loads native drivers directly without temporary file extraction errors.

---

## 🚀 Commands & Development Workflow

```bash
# Install dependencies and ensure multi-platform DuckDB binaries exist
npm install

# Launch local development server with Vite HMR + Electron
npm run dev

# Run TypeScript compiler checks across Node main and Web renderer
npm run typecheck

# Run the 25-suite headless Electron smoke test
npm run smoke

# Compile production Vite assets
npm run build

# Package portable single-file Windows executable (release/2G_3G_4G_QoS.exe)
npm run dist:portable

# Package portable Windows ZIP archive folder (release/2G_3G_4G_QoS_Portable_Folder.zip)
npm run dist:zip
```

---

## 📂 Source Code Structure

```text
├── build/                      # Generated multi-size application icons (icon.ico, icon.png, favicon.png)
├── scripts/                    # Build, icon, and native binding scripts
│   ├── ensure-duckdb-bindings.cjs
│   ├── generate-icon.cjs
│   ├── zip-portable-folder.cjs
│   ├── clean-build-headroom.cjs
│   └── verify-portable.cjs
├── shared/
│   └── api.ts                  # Shared TypeScript interfaces, IPC channel names, derived KPI definitions
├── src/
│   ├── main/                   # Electron Main Process (Node.js)
│   │   ├── index.ts            # Main process entrypoint, window initialization, icon resolution
│   │   ├── ipc.ts              # IPC channel router connecting UI to query and background services
│   │   ├── smoke.ts            # Headless 25-suite validation pipeline
│   │   ├── analytics/          # NC logic, classification, priority score, investigation rules
│   │   ├── import/             # Worker thread importer, CSV/XLSX parser, atomic merge
│   │   ├── services/           # Analytics query engine, KPI service, forecasting, reporting, snapshots
│   │   └── workspace/          # DuckDB DDL database schema, workspace manager, write locking
│   ├── preload/                # ContextBridge preload script isolating renderer from Node.js
│   └── renderer/               # React 19 Frontend UI
│       ├── App.tsx             # Main desktop application frame & navigation shell
│       ├── components/         # AppLogo vector branding component, Chip badges, modals
│       ├── lib/                # ECharts options, Ghana GeoJSON maps, forecast algorithms, preview API
│       ├── modules/            # 13 Interactive Analytics and Management Modules
│       └── styles.css          # Dark engineering theme, focus-visible accessibility, prefers-reduced-motion
├── package.json
└── tsconfig.json
```

---

## ⚖️ License

Private & Confidential. Copyright © 2026. All rights reserved.
