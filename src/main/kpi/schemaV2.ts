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

export async function enforce90DateRetention(connection: DuckDBConnection): Promise<void> {
  await connection.run(`
    DELETE FROM fact_cell_day
    WHERE date_id NOT IN (
      SELECT date_id FROM (
        SELECT DISTINCT date_id FROM fact_cell_day ORDER BY date_id DESC LIMIT 90
      )
    );
    DELETE FROM fact_kpi_daily
    WHERE date_id NOT IN (
      SELECT date_id FROM (
        SELECT DISTINCT date_id FROM fact_kpi_daily ORDER BY date_id DESC LIMIT 90
      )
    );
  `)
}

