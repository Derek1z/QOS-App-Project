# Per-Technology KPI Guide

The network intelligence engine analyses **whatever KPIs each technology actually
reports** — 2G congestion, 3G CE utilization, 4G PRB — using the columns you
import, not a fixed 4G-only set. This guide covers the three features that make
that possible.

---

## 1. KPI auto-suggest on import (Data Manager → Import)

When you drop a CSV, the app looks at each column name and suggests which of the
**active technology's KPIs** it represents — exact alias match first, then a
fuzzy word-overlap match (so `Data Volume (MB)` correctly suggests 2G's
GPRS Traffic).

- A banner appears above the mapping table: **"✨ Auto-suggested N KPI
  mappings from the column names."**
- Click **Apply suggestions** to map all of them in one click, or **Dismiss**.
- You can still edit any column afterwards — each row has a second dropdown
  (canonical field **or** any KPI definition).
- The suggestions are always for the **currently active technology** (see the
  2G/3G/4G switcher in the top bar), so switch technology *before* importing a
  file for that technology's columns.
- **Accepted assignments are remembered.** The source-mapping profile stores
  your KPI choices, so re-importing the same file restores them automatically —
  no need to re-apply.

## 2. KPI Watch (Executive Overview)

The **KPI Watch** card on the Executive Overview shows the active technology's
KPI health at a glance, driven entirely by the imported values vs. the editable
targets:

- **Top breached KPIs** — label, breached/total cells, the target, and a mean
  severity (0–100) for the latest week.
- **Weekly trend sparklines** — each KPI's value history (last ~12 weeks) with
  breach weeks in red and a dashed line at the target.
- **Worst cells** — the cells with the highest breach severity and how many KPIs
  each breached.

The card **refreshes automatically when you switch 2G/3G/4G** in the top bar, so
you can compare how each technology's imported KPIs are doing.

## 3. Tech-aware NC detection

NC (noise cell) classification uses the technology's own KPIs:

| Technology | NC drivers (imported KPIs)        |
|------------|-----------------------------------|
| 2G         | TCH Congestion, Drop Call Rate    |
| 3G         | CE Utilization, Drop Call Rate    |
| 4G         | PRB utilization (threshold rule)  |

A 2G/3G cell is flagged NC when its imported congestion/drop KPI breaches the
**editable target** on enough days in the week — the 4G PRB threshold no longer
applies. Lifecycle (New/Recurring/Persistent NC), trends, severity, and the
priority/health scores all flow from these tech-aware flags.

## Managing the definitions themselves

Open **KPI Definitions** (Management group) to edit targets, units,
worse-is-higher direction, aggregation, and aliases per technology — those
editable targets are exactly what the KPI Watch and NC detection compare
against.
