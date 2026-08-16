/** DuckDB schema for one .qosdb workspace (spec §60-§63).
 *  Raw facts are immutable; all derived intelligence lives in separate tables. */

const ENTITY_GRAINS: Array<[string, string]> = [
  ['site', 'daily'], ['site', 'weekly'], ['site', 'monthly'],
  ['district', 'daily'], ['district', 'weekly'], ['district', 'monthly'],
  ['region', 'daily'], ['region', 'weekly'], ['region', 'monthly'],
  ['network', 'daily'], ['network', 'weekly'], ['network', 'monthly']
]

function aggTable(entity: string, grain: string): string {
  const idCol = entity === 'network' ? '' : ` ${entity}_id BIGINT,`
  const pk = entity === 'network' ? 'period_start' : `period_start, ${entity}_id`
  return `CREATE TABLE IF NOT EXISTS agg_${entity}_${grain} (
    period_start DATE, period_end DATE, iso_year INTEGER, iso_week INTEGER, month INTEGER, year INTEGER,
    ${idCol}
    observed_days INTEGER, distinct_cells INTEGER, nc_cells INTEGER, nc_rate DOUBLE,
    prb_avg DOUBLE, prb_peak DOUBLE,
    data_volume_mb_sum DOUBLE, connected_users_sum DOUBLE,
    dl_throughput_kbps_avg DOUBLE, availability_pct_avg DOUBLE,
    PRIMARY KEY (${pk})
  )`
}

export const SCHEMA_SQL: string[] = [
  // --- workspace meta ---
  `CREATE TABLE IF NOT EXISTS workspace_meta (key VARCHAR PRIMARY KEY, value VARCHAR)`,

  // --- dimensions (spec §60) ---
  `CREATE SEQUENCE IF NOT EXISTS seq_region START 1`,
  `CREATE SEQUENCE IF NOT EXISTS seq_district START 1`,
  `CREATE SEQUENCE IF NOT EXISTS seq_site START 1`,
  `CREATE SEQUENCE IF NOT EXISTS seq_cell START 1`,
  `CREATE TABLE IF NOT EXISTS dim_region (region_id BIGINT PRIMARY KEY, name VARCHAR NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dim_district (district_id BIGINT PRIMARY KEY, name VARCHAR NOT NULL, region_id BIGINT)`,
  `CREATE TABLE IF NOT EXISTS dim_site (site_id BIGINT PRIMARY KEY, name VARCHAR NOT NULL, district_id BIGINT)`,
  `CREATE TABLE IF NOT EXISTS dim_cell (
     cell_id BIGINT PRIMARY KEY,
     name VARCHAR NOT NULL,
     site_id BIGINT, district_id BIGINT, region_id BIGINT
   )`,
  `CREATE TABLE IF NOT EXISTS dim_source (
     source_id BIGINT PRIMARY KEY,
     filename VARCHAR, checksum VARCHAR, imported_at TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS dim_date (
     date_id INTEGER PRIMARY KEY,
     date DATE NOT NULL,
     day_of_month INTEGER,
     iso_year INTEGER, iso_week INTEGER, week_start DATE,
     month INTEGER, year INTEGER, quarter INTEGER
   )`,

  // --- main fact table (spec §60) ---
  // PRIMARY KEY (date_id, cell_id) enforces the Date+Cell logical key (spec §15).
  `CREATE TABLE IF NOT EXISTS fact_cell_daily (
     date_id INTEGER NOT NULL,
     cell_id BIGINT NOT NULL,
     prb_utilization DOUBLE,
     data_volume_mb DOUBLE,
     connected_users DOUBLE,
     dl_throughput_kbps DOUBLE,
     availability_pct DOUBLE,
     source_import_id BIGINT,
     PRIMARY KEY (date_id, cell_id)
   )`,

  // --- derived aggregates (spec §61) ---
  `CREATE TABLE IF NOT EXISTS agg_cell_weekly (
     week_start DATE, week_end DATE, iso_year INTEGER, iso_week INTEGER,
     cell_id BIGINT,
     observed_days INTEGER, breach_days INTEGER,
     prb_avg DOUBLE, prb_peak DOUBLE,
     data_volume_mb_sum DOUBLE, connected_users_sum DOUBLE,
     dl_throughput_kbps_avg DOUBLE, availability_pct_avg DOUBLE,
     is_nc BOOLEAN,
     PRIMARY KEY (week_start, cell_id)
   )`,
  `CREATE TABLE IF NOT EXISTS agg_cell_monthly (
     month_start DATE, month_end DATE, month INTEGER, year INTEGER,
     cell_id BIGINT,
     observed_days INTEGER, breach_days INTEGER,
     prb_avg DOUBLE, prb_peak DOUBLE,
     data_volume_mb_sum DOUBLE, connected_users_sum DOUBLE,
     dl_throughput_kbps_avg DOUBLE, availability_pct_avg DOUBLE,
     is_nc BOOLEAN,
     PRIMARY KEY (month_start, cell_id)
   )`,
  ...ENTITY_GRAINS.map(([e, g]) => aggTable(e, g)),

  // --- ruleset versioning (spec §63) ---
  `CREATE TABLE IF NOT EXISTS ruleset (
     version INTEGER PRIMARY KEY,
     created_at TIMESTAMP DEFAULT now(),
     prb_threshold_pct DOUBLE NOT NULL DEFAULT 80,
     weekly_breach_days INTEGER NOT NULL DEFAULT 1,
     persistent_weeks INTEGER NOT NULL DEFAULT 3,
     district_nc_threshold_pct DOUBLE NOT NULL DEFAULT 10,
     priority_weights JSON,
     notes VARCHAR
   )`,
  `INSERT INTO ruleset (version, notes)
   SELECT 1, 'Initial ruleset' WHERE NOT EXISTS (SELECT 1 FROM ruleset)`,

  // --- import & audit (spec §16) ---
  `CREATE SEQUENCE IF NOT EXISTS seq_import_audit START 1`,
  `CREATE TABLE IF NOT EXISTS import_audit (
     import_id BIGINT DEFAULT nextval('seq_import_audit') PRIMARY KEY,
     imported_at TIMESTAMP DEFAULT now(),
     files JSON, source_rows BIGINT, inserted_rows BIGINT,
     duplicates_ignored BIGINT, rejected_rows BIGINT,
     mapping_profile VARCHAR, schema_version VARCHAR,
     validation_result JSON, raw_checksum VARCHAR,
     db_size_before BIGINT, db_size_after BIGINT, ruleset_version INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS source_mapping_profiles (
     fingerprint VARCHAR PRIMARY KEY,
     profile JSON, confidence DOUBLE,
     source_label VARCHAR,
     first_used TIMESTAMP DEFAULT now(), last_used TIMESTAMP DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS data_quality_scores (
     date_id INTEGER PRIMARY KEY,
     cell_coverage_pct DOUBLE, kpi_completeness_pct DOUBLE,
     rejected_rows BIGINT, mapping_confidence DOUBLE, duplicates_ignored BIGINT,
     score DOUBLE, details JSON
   )`,
  `CREATE TABLE IF NOT EXISTS coverage_daily (
     date_id INTEGER PRIMARY KEY,
     observed_cells BIGINT, expected_cells BIGINT, coverage_pct DOUBLE, missing_cells JSON
   )`,

  // --- per-technology KPI definitions (spec §54a) ---
  `CREATE SEQUENCE IF NOT EXISTS seq_kpi_defs START 1`,
  `CREATE TABLE IF NOT EXISTS kpi_defs (
     kpi_id BIGINT DEFAULT nextval('seq_kpi_defs') PRIMARY KEY,
     technology VARCHAR NOT NULL CHECK (technology IN ('2G', '3G', '4G')),
     kpi_key VARCHAR NOT NULL,
     label VARCHAR NOT NULL,
     unit VARCHAR NOT NULL DEFAULT '',
     worse_is_higher BOOLEAN NOT NULL DEFAULT true,
     target DOUBLE,
     agg VARCHAR NOT NULL DEFAULT 'avg' CHECK (agg IN ('avg', 'sum', 'max', 'min')),
     source_headers JSON,
     is_custom BOOLEAN NOT NULL DEFAULT false,
     active BOOLEAN NOT NULL DEFAULT true,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMP DEFAULT now(),
     updated_at TIMESTAMP DEFAULT now(),
     UNIQUE (technology, kpi_key)
   )`,
  `CREATE TABLE IF NOT EXISTS fact_extra_metrics (
     date_id INTEGER NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     value DOUBLE,
     PRIMARY KEY (date_id, cell_id, kpi_id)
   )`,
  `CREATE TABLE IF NOT EXISTS agg_cell_kpi_weekly (
     week_start DATE NOT NULL,
     cell_id BIGINT NOT NULL,
     kpi_id BIGINT NOT NULL,
     avg_value DOUBLE, sum_value DOUBLE, max_value DOUBLE, min_value DOUBLE,
     observed_days INTEGER,
     PRIMARY KEY (week_start, cell_id, kpi_id)
   )`,

  // --- derived intelligence (spec §62; populated by later milestones) ---
  `CREATE TABLE IF NOT EXISTS cell_nc_lifecycle (
     cell_id BIGINT, period_start DATE, grain VARCHAR, ruleset_version INTEGER,
     is_nc BOOLEAN, lifecycle VARCHAR, trend VARCHAR, severity VARCHAR,
     breach_days INTEGER, prb_avg DOUBLE, computed_at TIMESTAMP DEFAULT now(),
     PRIMARY KEY (cell_id, period_start, grain, ruleset_version)
   )`,
  `CREATE TABLE IF NOT EXISTS cell_priority_history (
     cell_id BIGINT, as_of DATE, score DOUBLE, band VARCHAR, mode VARCHAR,
     weights JSON, ruleset_version INTEGER,
     PRIMARY KEY (cell_id, as_of, mode)
   )`,
  `CREATE TABLE IF NOT EXISTS cell_anomalies (
     cell_id BIGINT, date_id INTEGER, metric VARCHAR, score DOUBLE, detail JSON,
     PRIMARY KEY (cell_id, date_id, metric)
   )`,
  `CREATE TABLE IF NOT EXISTS cell_forecasts (
     cell_id BIGINT, metric VARCHAR, horizon VARCHAR, as_of DATE,
     method VARCHAR, forecast JSON, lower_bound DOUBLE, upper_bound DOUBLE,
     mae DOUBLE, rmse DOUBLE, quality VARCHAR, risk VARCHAR,
     PRIMARY KEY (cell_id, metric, horizon, as_of)
   )`,
  `CREATE TABLE IF NOT EXISTS cell_health_history (
     cell_id BIGINT, date_id INTEGER, health_score DOUBLE, components JSON,
     PRIMARY KEY (cell_id, date_id)
   )`,
  `CREATE TABLE IF NOT EXISTS entity_action_status (
     entity_type VARCHAR, entity_id BIGINT, status VARCHAR,
     owner VARCHAR, external_ticket VARCHAR, target_review_date DATE,
     updated_at TIMESTAMP DEFAULT now(),
     PRIMARY KEY (entity_type, entity_id)
   )`,
  `CREATE SEQUENCE IF NOT EXISTS seq_notes_events START 1`,
  `CREATE TABLE IF NOT EXISTS notes_events (
     event_id BIGINT DEFAULT nextval('seq_notes_events') PRIMARY KEY,
     entity_type VARCHAR, entity_id BIGINT,
     occurred_at TIMESTAMP DEFAULT now(),
     kind VARCHAR, note VARCHAR, author VARCHAR
   )`,
  `CREATE SEQUENCE IF NOT EXISTS seq_saved_views START 1`,
  `CREATE TABLE IF NOT EXISTS saved_views (
     view_id BIGINT DEFAULT nextval('seq_saved_views') PRIMARY KEY,
     name VARCHAR, module VARCHAR, config JSON, created_at TIMESTAMP DEFAULT now()
   )`,
  `CREATE SEQUENCE IF NOT EXISTS seq_watchlists START 1`,
  `CREATE TABLE IF NOT EXISTS watchlists (
     watchlist_id BIGINT DEFAULT nextval('seq_watchlists') PRIMARY KEY,
     name VARCHAR, entity_type VARCHAR, entity_ids JSON, created_at TIMESTAMP DEFAULT now()
   )`,
  `CREATE SEQUENCE IF NOT EXISTS seq_report_definitions START 1`,
  `CREATE TABLE IF NOT EXISTS report_definitions (
     report_id BIGINT DEFAULT nextval('seq_report_definitions') PRIMARY KEY,
     name VARCHAR, template VARCHAR, config JSON, schedule VARCHAR, created_at TIMESTAMP DEFAULT now()
   )`,
  `CREATE SEQUENCE IF NOT EXISTS seq_workspace_snapshots START 1`,
  `CREATE TABLE IF NOT EXISTS workspace_snapshots (
     snapshot_id BIGINT DEFAULT nextval('seq_workspace_snapshots') PRIMARY KEY,
     name VARCHAR, reason VARCHAR, notes VARCHAR, created_at TIMESTAMP DEFAULT now(),
     path VARCHAR
   )`,

  // --- raw-source archive (spec §9): gzip copies of imported files, kept 90 days ---
  `CREATE SEQUENCE IF NOT EXISTS seq_raw_archive START 1`,
  `CREATE TABLE IF NOT EXISTS raw_archive (
     archive_id BIGINT DEFAULT nextval('seq_raw_archive') PRIMARY KEY,
     import_id BIGINT, filename VARCHAR,
     archived_path VARCHAR, size_bytes BIGINT, checksum VARCHAR,
     imported_at TIMESTAMP DEFAULT now(), retention_until TIMESTAMP
   )`,

  // --- maintenance scheduler (§58): settings + run history ---
  `CREATE TABLE IF NOT EXISTS maintenance_settings (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     enabled BOOLEAN DEFAULT false,
     cadence_hours INTEGER DEFAULT 24,
     actions JSON DEFAULT '["integrity","purge"]',
     run_on_open BOOLEAN DEFAULT true,
     last_run_at TIMESTAMP,
     last_ok BOOLEAN,
     last_summary VARCHAR,
     updated_at TIMESTAMP DEFAULT now()
   )`,
  `INSERT INTO maintenance_settings (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM maintenance_settings)`,
  `CREATE SEQUENCE IF NOT EXISTS seq_maintenance_runs START 1`,
  `CREATE TABLE IF NOT EXISTS maintenance_runs (
     run_id BIGINT DEFAULT nextval('seq_maintenance_runs') PRIMARY KEY,
     ran_at TIMESTAMP DEFAULT now(),
     ok BOOLEAN, actions JSON, summary VARCHAR, duration_ms BIGINT
   )`,

  // --- calendar (2020-2035, ISO weeks Monday-Sunday per spec §19) ---
  `INSERT INTO dim_date (date_id, date, day_of_month, iso_year, iso_week, week_start, month, year, quarter)
   SELECT CAST(strftime(d, '%Y%m%d') AS INTEGER), d, day(d),
          CAST(strftime(d, '%G') AS INTEGER), CAST(strftime(d, '%V') AS INTEGER),
          CAST(date_trunc('week', d) AS DATE),
          month(d), year(d), quarter(d)
   FROM (SELECT unnest(range(DATE '2020-01-01', DATE '2036-01-01', INTERVAL 1 DAY)) AS d)`
]
