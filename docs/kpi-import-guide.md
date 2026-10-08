# Per-Technology KPI Guide

The network intelligence engine analyses **whatever KPIs each technology actually
reports** — 2G congestion, 3G CE utilization, 4G PRB — using the columns you
import, not a fixed 4G-only set. This guide covers the three features that make
that possible.

---

## 1. KPI auto-suggest on import (Data Manager → Import)

When you drop a CSV or `.xlsx` workbook, the app looks at each column name and suggests which of the
**active technology's KPIs** it represents — exact alias match first, then a
fuzzy word-overlap match (so `Data Volume (MB)` correctly suggests 2G's
GPRS Traffic).

- A banner appears above the mapping table: **"✨ Auto-suggested N KPI
  mappings from the column names."**
- Click **Apply suggestions** to map all of them in one click, or **Dismiss**.
- You can still edit any column afterwards — each row has one **Mapped to**
  list: *ignore*, a network & cell field (date, cell, site, …), or a KPI of the
  workspace's technology. PRB utilisation is a 4G field and is only offered in
  4G workspaces.
- Each workspace holds one technology, and the suggestions are for that
  technology. A file that looks like another technology is stopped with
  **Open the <T> workspace** (or **Create a <T> workspace**), which analyses it
  again there, and **Import anyway**.
- **Accepted assignments are remembered.** The source-mapping profile stores
  your KPI choices, so re-importing the same file restores them automatically —
  no need to re-apply.

## 2. Imported KPIs on the Executive Overview

The Executive Overview shows the active technology's imported KPIs against
their editable targets:

- **Available KPI metrics** — one card per imported KPI with its latest
  complete-period value and whether it meets the target.
- **KPI threshold breach telemetry** — how many cells breach each KPI's target
  per period (daily, weekly or monthly).

Both show the open workspace's technology.

## 3. Tech-aware NC detection

NC (non-compliance) is judged on each technology's regulatory KPIs, against
the editable targets:

| Technology | NC KPIs                                                                  |
|------------|--------------------------------------------------------------------------|
| 2G         | Call Connection Success Rate, Call Drop Rate, TCH Congestion, SDCCH Congestion |
| 3G         | Call Connection Success Rate, Call Drop Rate, Data Access Success Rate    |
| 4G         | Call Connection Success Rate, Call Drop Rate, Data Service Access Failure, Peak Hour PRB Utilization |

A cell-day is bad when any of its technology's NC KPIs misses its target; a
week is NC with enough bad days (default 1), a month likewise (default 3).
The NC labels (New, Recurring, Intermittent, Persistent, Chronic NC,
Recovering, Healthy), trends, severity and the priority and health scores all
follow from these flags. See the README for the label rules.

## Managing the definitions themselves

Open **KPI Definitions** (Management group) to edit targets, units,
worse-is-higher direction, aggregation, and aliases per technology — those
editable targets are exactly what the Overview, NC detection and forecast
risk compare against.
