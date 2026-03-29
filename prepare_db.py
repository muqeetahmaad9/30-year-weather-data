#!/usr/bin/env python3
"""
PakClim DB Optimizer  v2.2
==========================
Run this ONCE on your weather_data.db before starting the server.
It adds indexes + pre-aggregated summary tables so the portal loads instantly.

v2.2 additions (non-breaking — existing district tables still work):
  - tehsil_monthly_stats  — monthly aggregates per tehsil
  - tehsil_yearly_stats   — yearly aggregates per tehsil
  - tehsil_normals        — 30-yr climate normals per tehsil
  - Extra variables in ALL tables:
      EVAP  (evapotranspiration_mm)
      PRES  (surface_pressure_kpa)
      SPHU  (specific_humidity_g_kg)
      SNOW  (snow_depth_cm)
      WMAX  (windspeed_max_2m_ms)
      WDIR  (wind_direction_deg)

Usage:
  python prepare_db.py --db weather_data.db

Time: ~5-10 minutes. Only needs to run once.
"""

import sqlite3
import argparse
import time


def run(db_path):
    print(f"\n{'='*60}")
    print(f"  PakClim DB Optimizer  v2.2")
    print(f"{'='*60}")
    print(f"  DB: {db_path}\n")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-65536")
    cur = conn.cursor()

    # ── Check existing structure ──────────────────────────────
    cur.execute("SELECT MIN(date), MAX(date), COUNT(*) FROM weather_data")
    row = cur.fetchone()
    print(f"  Rows:       {row[2]:,}")
    print(f"  Date range: {row[0]} → {row[1]}")

    cur.execute("PRAGMA table_info(weather_data)")
    existing_cols = {r[1] for r in cur.fetchall()}

    has_tehsil = 'tehsil'                 in existing_cols
    has_evap   = 'evapotranspiration_mm'  in existing_cols
    has_pres   = 'surface_pressure_kpa'   in existing_cols
    has_sphu   = 'specific_humidity_g_kg' in existing_cols
    has_snow   = 'snow_depth_cm'          in existing_cols
    has_wmax   = 'windspeed_max_2m_ms'    in existing_cols
    has_wdir   = 'wind_direction_deg'     in existing_cols

    print(f"  Tehsil col: {has_tehsil}")
    print(f"  Extra cols: evap={has_evap} pres={has_pres} sphu={has_sphu} "
          f"snow={has_snow} wmax={has_wmax} wdir={has_wdir}\n")

    # Safe aggregate helpers
    def agg(col, fn='AVG', alias=None):
        a = alias or col
        if col in existing_cols:
            return f"ROUND({fn}({col}), 2) AS {a}"
        return f"NULL AS {a}"

    # ── STEP 1: Indexes ───────────────────────────────────────
    print("  [1/7] Creating indexes...")
    t = time.time()
    conn.execute("CREATE INDEX IF NOT EXISTS idx_latlon_date ON weather_data(latitude, longitude, date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_district    ON weather_data(district)")
    if has_tehsil:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tehsil ON weather_data(tehsil)")
    conn.commit()
    print(f"        Done in {time.time()-t:.1f}s")

    # ── STEP 2: monthly_stats (district) ─────────────────────
    print("  [2/7] Building monthly_stats...")
    t = time.time()
    conn.execute("DROP TABLE IF EXISTS monthly_stats")
    conn.execute(f"""
        CREATE TABLE monthly_stats AS
        SELECT
            district, province,
            ROUND(AVG(latitude),  4) AS latitude,
            ROUND(AVG(longitude), 4) AS longitude,
            CAST(date/100   AS INTEGER) AS year_month,
            CAST(date/10000 AS INTEGER) AS year,
            (CAST(date/100 AS INTEGER) - CAST(date/10000 AS INTEGER)*100) AS month,
            ROUND(AVG(temp_mean_c),          2) AS T2M,
            ROUND(AVG(temp_max_c),           2) AS T2M_MAX,
            ROUND(AVG(temp_min_c),           2) AS T2M_MIN,
            ROUND(SUM(precipitation_mm),     2) AS PREC,
            ROUND(AVG(windspeed_mean_2m_ms), 2) AS WS2M,
            ROUND(AVG(relative_humidity_pct),2) AS RH2M,
            ROUND(AVG(solar_radiation_kwh_m2),2) AS SOLAR,
            {agg('evapotranspiration_mm','SUM','EVAP')},
            {agg('surface_pressure_kpa',  'AVG','PRES')},
            {agg('specific_humidity_g_kg','AVG','SPHU')},
            {agg('snow_depth_cm',         'AVG','SNOW')},
            {agg('windspeed_max_2m_ms',   'AVG','WMAX')},
            {agg('wind_direction_deg',    'AVG','WDIR')},
            COUNT(*) AS days
        FROM weather_data
        WHERE temp_mean_c > -999
        GROUP BY district, year_month
        ORDER BY district, year_month
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_monthly_dist   ON monthly_stats(district)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_monthly_latlon ON monthly_stats(latitude, longitude)")
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM monthly_stats")
    print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")

    # ── STEP 3: yearly_stats (district) ──────────────────────
    print("  [3/7] Building yearly_stats...")
    t = time.time()
    conn.execute("DROP TABLE IF EXISTS yearly_stats")
    conn.execute(f"""
        CREATE TABLE yearly_stats AS
        SELECT
            district, province,
            ROUND(AVG(latitude),  4) AS latitude,
            ROUND(AVG(longitude), 4) AS longitude,
            CAST(date/10000 AS INTEGER) AS year,
            ROUND(AVG(temp_mean_c),          2) AS T2M,
            ROUND(AVG(temp_max_c),           2) AS T2M_MAX,
            ROUND(AVG(temp_min_c),           2) AS T2M_MIN,
            ROUND(SUM(precipitation_mm),     2) AS PREC,
            ROUND(AVG(windspeed_mean_2m_ms), 2) AS WS2M,
            ROUND(AVG(relative_humidity_pct),2) AS RH2M,
            ROUND(AVG(solar_radiation_kwh_m2),2) AS SOLAR,
            ROUND(MAX(temp_max_c),           2) AS T2M_MAX_PEAK,
            ROUND(MIN(temp_min_c),           2) AS T2M_MIN_PEAK,
            {agg('evapotranspiration_mm','SUM','EVAP')},
            {agg('surface_pressure_kpa',  'AVG','PRES')},
            {agg('specific_humidity_g_kg','AVG','SPHU')},
            {agg('snow_depth_cm',         'AVG','SNOW')},
            {agg('windspeed_max_2m_ms',   'AVG','WMAX')},
            {agg('wind_direction_deg',    'AVG','WDIR')},
            COUNT(*) AS days
        FROM weather_data
        WHERE temp_mean_c > -999
        GROUP BY district, year
        ORDER BY district, year
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yearly_dist   ON yearly_stats(district)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_yearly_latlon ON yearly_stats(latitude, longitude)")
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM yearly_stats")
    print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")

    # ── STEP 4: climate_normals (district) ───────────────────
    print("  [4/7] Building climate_normals...")
    t = time.time()
    conn.execute("DROP TABLE IF EXISTS climate_normals")
    conn.execute("""
        CREATE TABLE climate_normals AS
        SELECT
            district, province,
            ROUND(AVG(latitude),  4) AS latitude,
            ROUND(AVG(longitude), 4) AS longitude,
            month,
            ROUND(AVG(T2M),   2) AS T2M_norm,
            ROUND(AVG(T2M_MAX),2) AS T2M_MAX_norm,
            ROUND(AVG(T2M_MIN),2) AS T2M_MIN_norm,
            ROUND(AVG(PREC),  2) AS PREC_norm,
            ROUND(AVG(WS2M),  2) AS WS2M_norm,
            ROUND(AVG(RH2M),  2) AS RH2M_norm,
            ROUND(AVG(SOLAR), 2) AS SOLAR_norm,
            ROUND(AVG(EVAP),  2) AS EVAP_norm,
            ROUND(AVG(PRES),  2) AS PRES_norm,
            ROUND(AVG(SPHU),  2) AS SPHU_norm,
            ROUND(AVG(SNOW),  2) AS SNOW_norm,
            ROUND(AVG(WMAX),  2) AS WMAX_norm,
            ROUND(AVG(WDIR),  2) AS WDIR_norm
        FROM monthly_stats
        GROUP BY district, month
        ORDER BY district, month
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_normals_dist   ON climate_normals(district)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_normals_latlon ON climate_normals(latitude, longitude)")
    conn.commit()
    cur.execute("SELECT COUNT(*) FROM climate_normals")
    print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")

    # ── STEP 5: tehsil_monthly_stats ─────────────────────────
    if has_tehsil:
        print("  [5/7] Building tehsil_monthly_stats...")
        t = time.time()
        conn.execute("DROP TABLE IF EXISTS tehsil_monthly_stats")
        conn.execute(f"""
            CREATE TABLE tehsil_monthly_stats AS
            SELECT
                tehsil, district, province,
                ROUND(AVG(latitude),  4) AS latitude,
                ROUND(AVG(longitude), 4) AS longitude,
                CAST(date/100   AS INTEGER) AS year_month,
                CAST(date/10000 AS INTEGER) AS year,
                (CAST(date/100 AS INTEGER) - CAST(date/10000 AS INTEGER)*100) AS month,
                ROUND(AVG(temp_mean_c),          2) AS T2M,
                ROUND(AVG(temp_max_c),           2) AS T2M_MAX,
                ROUND(AVG(temp_min_c),           2) AS T2M_MIN,
                ROUND(SUM(precipitation_mm),     2) AS PREC,
                ROUND(AVG(windspeed_mean_2m_ms), 2) AS WS2M,
                ROUND(AVG(relative_humidity_pct),2) AS RH2M,
                ROUND(AVG(solar_radiation_kwh_m2),2) AS SOLAR,
                {agg('evapotranspiration_mm','SUM','EVAP')},
                {agg('surface_pressure_kpa',  'AVG','PRES')},
                {agg('specific_humidity_g_kg','AVG','SPHU')},
                {agg('snow_depth_cm',         'AVG','SNOW')},
                {agg('windspeed_max_2m_ms',   'AVG','WMAX')},
                {agg('wind_direction_deg',    'AVG','WDIR')},
                COUNT(*) AS days
            FROM weather_data
            WHERE temp_mean_c > -999
              AND tehsil IS NOT NULL AND tehsil != ''
            GROUP BY tehsil, year_month
            ORDER BY tehsil, year_month
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tmonthly_tehsil ON tehsil_monthly_stats(tehsil)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tmonthly_latlon ON tehsil_monthly_stats(latitude, longitude)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tmonthly_dist   ON tehsil_monthly_stats(district)")
        conn.commit()
        cur.execute("SELECT COUNT(*) FROM tehsil_monthly_stats")
        print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")
    else:
        print("  [5/7] Skipped — no tehsil column found")

    # ── STEP 6: tehsil_yearly_stats ──────────────────────────
    if has_tehsil:
        print("  [6/7] Building tehsil_yearly_stats...")
        t = time.time()
        conn.execute("DROP TABLE IF EXISTS tehsil_yearly_stats")
        conn.execute(f"""
            CREATE TABLE tehsil_yearly_stats AS
            SELECT
                tehsil, district, province,
                ROUND(AVG(latitude),  4) AS latitude,
                ROUND(AVG(longitude), 4) AS longitude,
                CAST(date/10000 AS INTEGER) AS year,
                ROUND(AVG(temp_mean_c),          2) AS T2M,
                ROUND(AVG(temp_max_c),           2) AS T2M_MAX,
                ROUND(AVG(temp_min_c),           2) AS T2M_MIN,
                ROUND(SUM(precipitation_mm),     2) AS PREC,
                ROUND(AVG(windspeed_mean_2m_ms), 2) AS WS2M,
                ROUND(AVG(relative_humidity_pct),2) AS RH2M,
                ROUND(AVG(solar_radiation_kwh_m2),2) AS SOLAR,
                ROUND(MAX(temp_max_c),           2) AS T2M_MAX_PEAK,
                ROUND(MIN(temp_min_c),           2) AS T2M_MIN_PEAK,
                {agg('evapotranspiration_mm','SUM','EVAP')},
                {agg('surface_pressure_kpa',  'AVG','PRES')},
                {agg('specific_humidity_g_kg','AVG','SPHU')},
                {agg('snow_depth_cm',         'AVG','SNOW')},
                {agg('windspeed_max_2m_ms',   'AVG','WMAX')},
                {agg('wind_direction_deg',    'AVG','WDIR')},
                COUNT(*) AS days
            FROM weather_data
            WHERE temp_mean_c > -999
              AND tehsil IS NOT NULL AND tehsil != ''
            GROUP BY tehsil, year
            ORDER BY tehsil, year
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tyearly_tehsil ON tehsil_yearly_stats(tehsil)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tyearly_latlon ON tehsil_yearly_stats(latitude, longitude)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tyearly_dist   ON tehsil_yearly_stats(district)")
        conn.commit()
        cur.execute("SELECT COUNT(*) FROM tehsil_yearly_stats")
        print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")
    else:
        print("  [6/7] Skipped — no tehsil column found")

    # ── STEP 7: tehsil_normals ───────────────────────────────
    if has_tehsil:
        print("  [7/7] Building tehsil_normals...")
        t = time.time()
        conn.execute("DROP TABLE IF EXISTS tehsil_normals")
        conn.execute("""
            CREATE TABLE tehsil_normals AS
            SELECT
                tehsil, district, province,
                ROUND(AVG(latitude),  4) AS latitude,
                ROUND(AVG(longitude), 4) AS longitude,
                month,
                ROUND(AVG(T2M),   2) AS T2M_norm,
                ROUND(AVG(T2M_MAX),2) AS T2M_MAX_norm,
                ROUND(AVG(T2M_MIN),2) AS T2M_MIN_norm,
                ROUND(AVG(PREC),  2) AS PREC_norm,
                ROUND(AVG(WS2M),  2) AS WS2M_norm,
                ROUND(AVG(RH2M),  2) AS RH2M_norm,
                ROUND(AVG(SOLAR), 2) AS SOLAR_norm,
                ROUND(AVG(EVAP),  2) AS EVAP_norm,
                ROUND(AVG(PRES),  2) AS PRES_norm,
                ROUND(AVG(SPHU),  2) AS SPHU_norm,
                ROUND(AVG(SNOW),  2) AS SNOW_norm,
                ROUND(AVG(WMAX),  2) AS WMAX_norm,
                ROUND(AVG(WDIR),  2) AS WDIR_norm
            FROM tehsil_monthly_stats
            GROUP BY tehsil, month
            ORDER BY tehsil, month
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tnormals_tehsil ON tehsil_normals(tehsil)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tnormals_latlon ON tehsil_normals(latitude, longitude)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tnormals_dist   ON tehsil_normals(district)")
        conn.commit()
        cur.execute("SELECT COUNT(*) FROM tehsil_normals")
        print(f"        {cur.fetchone()[0]:,} rows — done in {time.time()-t:.1f}s")
    else:
        print("  [7/7] Skipped — no tehsil column found")

    # ── Final ANALYZE ─────────────────────────────────────────
    print("\n  Running ANALYZE for query planner...")
    t = time.time()
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()
    print(f"  Done in {time.time()-t:.1f}s")

    print(f"\n{'='*60}")
    print(f"  ✅ DB ready! Start server with:")
    print(f"     python Pakclim_server.py --db {db_path}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True, help='Path to weather_data.db')
    args = parser.parse_args()
    run(args.db)