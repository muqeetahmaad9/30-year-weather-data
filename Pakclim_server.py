#!/usr/bin/env python3
"""
PakClim Local SQLite Server  v2.2
- All original district routes unchanged
- NEW: /tehsils, /tehsil/summary, /tehsil/climate, /tehsil/stats, /tehsil/search
- Extra variables (EVAP, PRES, SPHU, SNOW, WMAX, WDIR) returned in all routes
"""

import sqlite3, json, argparse, sys, time, os
import urllib.request, urllib.error
from flask import Flask, jsonify, request
from flask_cors import CORS

_urlreq = urllib.request
_urlerr = urllib.error

app = Flask(__name__)

# Allow ALL origins — this server is local-only (127.0.0.1) so there is no
# security risk. This fixes VS Code Live Server, file://, and any dev port.
CORS(app, origins="*", supports_credentials=False)

# Handle CORS preflight for all routes explicitly
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# ── AI key (set via --key flag or POST /api/ai/key) ──────────────
_CLAUDE_API_KEY = None

TABLE_NAME = "weather_data"
LAT_LON_TOL = 0.15
DB_PATH = None

COLUMN_MAP = {
    "T2M": "temp_mean_c", "T2M_MAX": "temp_max_c", "T2M_MIN": "temp_min_c",
    "PREC": "precipitation_mm", "WS2M": "windspeed_mean_2m_ms",
    "RH2M": "relative_humidity_pct", "SOLAR": "solar_radiation_kwh_m2",
    "EVAP": "evapotranspiration_mm", "PRES": "surface_pressure_kpa",
    "SPHU": "specific_humidity_g_kg", "SNOW": "snow_depth_cm",
    "WMAX": "windspeed_max_2m_ms", "WDIR": "wind_direction_deg",
}

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def check_ready():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in cur.fetchall()}
        conn.close()
        district_ok = {'monthly_stats','yearly_stats','climate_normals'}.issubset(tables)
        tehsil_ok   = {'tehsil_monthly_stats','tehsil_yearly_stats','tehsil_normals'}.issubset(tables)
        return district_ok, tehsil_ok
    except:
        return False, False

@app.route('/health')
def health():
    district_ok, tehsil_ok = check_ready()
    return jsonify({
        "status":   "ok",
        "server":   "PakClim SQLite Server v2.2",
        "db":       DB_PATH,
        "prepared": district_ok,
        "tehsil_ready": tehsil_ok,
    })

# ── FULL API ROUTES EXPECTED BY app.js ─────────────────────────────

@app.route('/districts')
def districts():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT district, province, latitude, longitude FROM monthly_stats ORDER BY district")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/summary')
def summary():
    lat = float(request.args.get('lat', 0))
    lon = float(request.args.get('lon', 0))
    conn = get_db()
    cur = conn.cursor()

    # ── Yearly stats ──────────────────────────────────────────
    cur.execute("""
        SELECT year, T2M, T2M_MAX, T2M_MIN, T2M_MAX_PEAK, T2M_MIN_PEAK,
               PREC, WS2M, RH2M, SOLAR
        FROM yearly_stats
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        ORDER BY year
    """, (lat-0.2, lat+0.2, lon-0.2, lon+0.2))
    yearly_rows = cur.fetchall()

    yearly = {
        "years":        [r["year"]           for r in yearly_rows],
        "T2M":          [r["T2M"]            for r in yearly_rows],
        "T2M_MAX":      [r["T2M_MAX"]        for r in yearly_rows],
        "T2M_MIN":      [r["T2M_MIN"]        for r in yearly_rows],
        "T2M_MAX_PEAK": [r["T2M_MAX_PEAK"]   for r in yearly_rows],
        "T2M_MIN_PEAK": [r["T2M_MIN_PEAK"]   for r in yearly_rows],
        "PREC":         [r["PREC"]           for r in yearly_rows],
        "WS2M":         [r["WS2M"]           for r in yearly_rows],
        "RH2M":         [r["RH2M"]           for r in yearly_rows],
        "SOLAR":        [r["SOLAR"]          for r in yearly_rows],
    }

    # ── Climate normals ────────────────────────────────────────
    cur.execute("""
        SELECT month, T2M_norm, T2M_MAX_norm, T2M_MIN_norm,
               PREC_norm, WS2M_norm, RH2M_norm, SOLAR_norm
        FROM climate_normals
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        ORDER BY month
    """, (lat-0.2, lat+0.2, lon-0.2, lon+0.2))
    norm_rows = cur.fetchall()

    normals = {
        "months":    [r["month"]      for r in norm_rows],
        "T2M":       [r["T2M_norm"]   for r in norm_rows],
        "T2M_MAX":   [r["T2M_MAX_norm"] for r in norm_rows],
        "T2M_MIN":   [r["T2M_MIN_norm"] for r in norm_rows],
        "PREC":      [r["PREC_norm"]  for r in norm_rows],
        "WS2M":      [r["WS2M_norm"]  for r in norm_rows],
        "RH2M":      [r["RH2M_norm"]  for r in norm_rows],
        "SOLAR":     [r["SOLAR_norm"] for r in norm_rows],
    }

    # ── District info ──────────────────────────────────────────
    cur.execute("""
        SELECT district, province FROM yearly_stats
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        LIMIT 1
    """, (lat-0.2, lat+0.2, lon-0.2, lon+0.2))
    info = cur.fetchone()

    conn.close()
    return jsonify({
        "district": info["district"] if info else "",
        "province": info["province"] if info else "",
        "yearly":   yearly,
        "normals":  normals,
    })

@app.route('/climate')
def climate():
    lat = float(request.args.get('lat', 0))
    lon = float(request.args.get('lon', 0))
    from_date = request.args.get('from', '')
    to_date   = request.args.get('to', '')

    conn = get_db()
    cur = conn.cursor()

    # ── If from/to provided: return daily rows as time-series ─────
    if from_date and to_date:
        # Convert YYYY-MM-DD → YYYYMMDD integer for comparison
        from_int = int(from_date.replace('-', ''))
        to_int   = int(to_date.replace('-', ''))

        cur.execute("""
            SELECT date, temp_mean_c, temp_max_c, temp_min_c,
                   precipitation_mm, windspeed_mean_2m_ms,
                   relative_humidity_pct, solar_radiation_kwh_m2,
                   evapotranspiration_mm, surface_pressure_kpa,
                   specific_humidity_g_kg, snow_depth_cm,
                   windspeed_max_2m_ms, wind_direction_deg
            FROM weather_data
            WHERE latitude  BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND date BETWEEN ? AND ?
              AND temp_mean_c > -999
            ORDER BY date
        """, (lat-0.2, lat+0.2, lon-0.2, lon+0.2, from_int, to_int))
        rows = cur.fetchall()
        conn.close()

        data = {
            "dates":   [], "T2M": [], "T2M_MAX": [], "T2M_MIN": [],
            "PREC":    [], "WS2M": [], "RH2M": [], "SOLAR": [],
            "EVAP":    [], "PRES": [], "SPHU": [], "SNOW": [],
            "WMAX":    [], "WDIR": [],
        }
        for r in rows:
            data["dates"].append(str(r["date"]))
            data["T2M"].append(r["temp_mean_c"])
            data["T2M_MAX"].append(r["temp_max_c"])
            data["T2M_MIN"].append(r["temp_min_c"])
            data["PREC"].append(r["precipitation_mm"])
            data["WS2M"].append(r["windspeed_mean_2m_ms"])
            data["RH2M"].append(r["relative_humidity_pct"])
            data["SOLAR"].append(r["solar_radiation_kwh_m2"])
            data["EVAP"].append(r["evapotranspiration_mm"])
            data["PRES"].append(r["surface_pressure_kpa"])
            data["SPHU"].append(r["specific_humidity_g_kg"])
            data["SNOW"].append(r["snow_depth_cm"])
            data["WMAX"].append(r["windspeed_max_2m_ms"])
            data["WDIR"].append(r["wind_direction_deg"])
        return jsonify({"data": data})

    # ── No date range: return monthly climate normals (legacy) ─────
    cur.execute("""
        SELECT month, T2M_norm, T2M_MAX_norm, T2M_MIN_norm, PREC_norm,
               WS2M_norm, RH2M_norm, SOLAR_norm
        FROM climate_normals 
        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
        ORDER BY month
    """, (lat-0.2, lat+0.2, lon-0.2, lon+0.2))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/stats')
def stats():
    lat = float(request.args.get('lat', 0))
    lon = float(request.args.get('lon', 0))
    year = request.args.get('year')
    conn = get_db()
    cur = conn.cursor()
    if year:
        cur.execute("SELECT * FROM yearly_stats WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? AND year = ?",
                    (lat-0.2, lat+0.2, lon-0.2, lon+0.2, int(year)))
    else:
        cur.execute("SELECT * FROM yearly_stats WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY year",
                    (lat-0.2, lat+0.2, lon-0.2, lon+0.2))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/search')
def search():
    q = request.args.get('q', '').strip().lower()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT district, province, latitude, longitude 
        FROM monthly_stats 
        WHERE LOWER(district) LIKE ? 
        GROUP BY district LIMIT 20
    """, (f'%{q}%',))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)


# ── TEHSIL ROUTES ──────────────────────────────────────────────

@app.route('/tehsils')
def tehsils():
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT DISTINCT tehsil, district, province, latitude, longitude FROM tehsil_monthly_stats ORDER BY tehsil")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/tehsil/summary')
def tehsil_summary():
    lat = request.args.get('lat'); lon = request.args.get('lon')
    tq  = request.args.get('tehsil', '').strip()
    conn = get_db(); cur = conn.cursor()
    if tq:
        wy, wn, py, pn = "WHERE tehsil=?", "WHERE tehsil=?", (tq,), (tq,)
    else:
        lat, lon = float(lat), float(lon)
        wy = wn = "WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?"
        py = pn = (lat-0.2, lat+0.2, lon-0.2, lon+0.2)
    cur.execute(f"SELECT year,T2M,T2M_MAX,T2M_MIN,T2M_MAX_PEAK,T2M_MIN_PEAK,PREC,WS2M,RH2M,SOLAR,EVAP,PRES,SPHU,SNOW,WMAX,WDIR FROM tehsil_yearly_stats {wy} ORDER BY year", py)
    yr = cur.fetchall()
    yearly = {k:[r[k] for r in yr] for k in ("T2M","T2M_MAX","T2M_MIN","T2M_MAX_PEAK","T2M_MIN_PEAK","PREC","WS2M","RH2M","SOLAR","EVAP","PRES","SPHU","SNOW","WMAX","WDIR")}
    yearly["years"] = [r["year"] for r in yr]
    cur.execute(f"SELECT month,T2M_norm,T2M_MAX_norm,T2M_MIN_norm,PREC_norm,WS2M_norm,RH2M_norm,SOLAR_norm,EVAP_norm,PRES_norm,SPHU_norm,SNOW_norm,WMAX_norm,WDIR_norm FROM tehsil_normals {wn} ORDER BY month", pn)
    nr = cur.fetchall()
    normals = {"months":[r["month"] for r in nr],"T2M":[r["T2M_norm"] for r in nr],"T2M_MAX":[r["T2M_MAX_norm"] for r in nr],"T2M_MIN":[r["T2M_MIN_norm"] for r in nr],"PREC":[r["PREC_norm"] for r in nr],"WS2M":[r["WS2M_norm"] for r in nr],"RH2M":[r["RH2M_norm"] for r in nr],"SOLAR":[r["SOLAR_norm"] for r in nr],"EVAP":[r["EVAP_norm"] for r in nr],"PRES":[r["PRES_norm"] for r in nr],"SPHU":[r["SPHU_norm"] for r in nr],"SNOW":[r["SNOW_norm"] for r in nr],"WMAX":[r["WMAX_norm"] for r in nr],"WDIR":[r["WDIR_norm"] for r in nr]}
    cur.execute(f"SELECT tehsil,district,province FROM tehsil_yearly_stats {wy} LIMIT 1", py)
    info = cur.fetchone(); conn.close()
    return jsonify({"tehsil":info["tehsil"] if info else "","district":info["district"] if info else "","province":info["province"] if info else "","yearly":yearly,"normals":normals})

@app.route('/tehsil/climate')
def tehsil_climate():
    lat=float(request.args.get('lat',0)); lon=float(request.args.get('lon',0))
    tq=request.args.get('tehsil','').strip()
    fd=request.args.get('from',''); td=request.args.get('to','')
    fi=int(fd.replace('-','')) if fd else 0
    ti=int(td.replace('-','')) if td else 99999999
    conn=get_db(); cur=conn.cursor()
    cols="date,temp_mean_c,temp_max_c,temp_min_c,precipitation_mm,windspeed_mean_2m_ms,relative_humidity_pct,solar_radiation_kwh_m2,evapotranspiration_mm,surface_pressure_kpa,specific_humidity_g_kg,snow_depth_cm,windspeed_max_2m_ms,wind_direction_deg"
    if tq:
        cur.execute(f"SELECT {cols} FROM weather_data WHERE tehsil=? AND date BETWEEN ? AND ? AND temp_mean_c>-999 ORDER BY date",(tq,fi,ti))
    else:
        cur.execute(f"SELECT {cols} FROM weather_data WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? AND date BETWEEN ? AND ? AND temp_mean_c>-999 ORDER BY date",(lat-0.2,lat+0.2,lon-0.2,lon+0.2,fi,ti))
    rows=cur.fetchall(); conn.close()
    data={"dates":[],"T2M":[],"T2M_MAX":[],"T2M_MIN":[],"PREC":[],"WS2M":[],"RH2M":[],"SOLAR":[],"EVAP":[],"PRES":[],"SPHU":[],"SNOW":[],"WMAX":[],"WDIR":[]}
    for r in rows:
        data["dates"].append(str(r["date"])); data["T2M"].append(r["temp_mean_c"]); data["T2M_MAX"].append(r["temp_max_c"]); data["T2M_MIN"].append(r["temp_min_c"]); data["PREC"].append(r["precipitation_mm"]); data["WS2M"].append(r["windspeed_mean_2m_ms"]); data["RH2M"].append(r["relative_humidity_pct"]); data["SOLAR"].append(r["solar_radiation_kwh_m2"]); data["EVAP"].append(r["evapotranspiration_mm"]); data["PRES"].append(r["surface_pressure_kpa"]); data["SPHU"].append(r["specific_humidity_g_kg"]); data["SNOW"].append(r["snow_depth_cm"]); data["WMAX"].append(r["windspeed_max_2m_ms"]); data["WDIR"].append(r["wind_direction_deg"])
    return jsonify({"data":data})

@app.route('/tehsil/stats')
def tehsil_stats():
    lat=float(request.args.get('lat',0)); lon=float(request.args.get('lon',0))
    tq=request.args.get('tehsil','').strip(); yr=request.args.get('year')
    conn=get_db(); cur=conn.cursor()
    if tq:
        b,p="FROM tehsil_yearly_stats WHERE tehsil=?",[tq]
    else:
        b,p="FROM tehsil_yearly_stats WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?",[lat-0.2,lat+0.2,lon-0.2,lon+0.2]
    if yr: cur.execute(f"SELECT * {b} AND year=? ORDER BY year",p+[int(yr)])
    else:  cur.execute(f"SELECT * {b} ORDER BY year",p)
    rows=[dict(r) for r in cur.fetchall()]; conn.close()
    return jsonify(rows)

@app.route('/tehsil/search')
def tehsil_search():
    q=request.args.get('q','').strip().lower(); conn=get_db(); cur=conn.cursor()
    cur.execute("SELECT tehsil,district,province,latitude,longitude FROM tehsil_monthly_stats WHERE LOWER(tehsil) LIKE ? GROUP BY tehsil LIMIT 30",(f'%{q}%',))
    rows=[dict(r) for r in cur.fetchall()]; conn.close()
    return jsonify(rows)

# ── END TEHSIL ROUTES ───────────────────────────────────────────


# ══════════════════════════════════════════════════════════════════
# ── AI PROXY  /api/ai   &   /api/ai/key ──────────────────────────
# The frontend sends requests to /api/ai so the API key never appears
# in browser JS.  Falls back to a rule-based engine if no key is set.
# ══════════════════════════════════════════════════════════════════

_AI_KEY = None   # set via --key CLI flag or POST /api/ai/key

# ── Farming calendar for Pakistan crops ──────────────────────────
_CROP_CALENDAR = {
    "wheat":   {"sow":"Nov–Dec","harvest":"Apr–May","water_mm":400,"temp_c":"15–25","notes":"Winter crop; needs cool germination, warm grain fill."},
    "rice":    {"sow":"Jun–Jul","harvest":"Oct–Nov","water_mm":1200,"temp_c":"24–35","notes":"Kharif crop; high water; avoid cold nights during flowering."},
    "cotton":  {"sow":"Apr–May","harvest":"Sep–Nov","water_mm":700,"temp_c":"27–37","notes":"Kharif; sensitive to frost and excessive rain during boll opening."},
    "maize":   {"sow":"Mar–Apr (rabi) / Jul (kharif)","harvest":"Jul / Nov","water_mm":500,"temp_c":"18–32","notes":"Dual season; needs good drainage and moderate humidity."},
    "sugarcane":{"sow":"Feb–Mar","harvest":"Dec–Jan","water_mm":1500,"temp_c":"26–35","notes":"Ratoon crop; needs frost-free winters for juice yield."},
    "mustard": {"sow":"Oct–Nov","harvest":"Feb–Mar","water_mm":300,"temp_c":"10–25","notes":"Short rabi; low water; suits arid Punjab/Sindh."},
    "mango":   {"sow":"perennial","harvest":"Jun–Sep","water_mm":800,"temp_c":"24–40","notes":"Needs dry cool spell in winter to induce flowering; avoid frost."},
    "citrus":  {"sow":"perennial","harvest":"Dec–Feb","water_mm":900,"temp_c":"13–38","notes":"Needs mild winters; sensitive to waterlogging."},
    "potato":  {"sow":"Oct–Nov","harvest":"Feb–Mar","water_mm":500,"temp_c":"15–25","notes":"Cool weather essential for tuber development."},
    "onion":   {"sow":"Oct–Nov","harvest":"Mar–Apr","water_mm":350,"temp_c":"13–24","notes":"Long-day crop; avoid rain at harvest."},
    "sunflower":{"sow":"Feb–Mar / Aug–Sep","harvest":"May–Jun / Nov–Dec","water_mm":500,"temp_c":"20–35","notes":"Dual season; drought tolerant; high solar needs."},
    "gram":    {"sow":"Oct–Nov","harvest":"Mar–Apr","water_mm":250,"temp_c":"10–25","notes":"Chickpea / channa; low water rabi; frost risk in mountains."},
}

# ── Rule-based fallback engine ────────────────────────────────────
def _rule_based_reply(body):
    """Generate a helpful climate/farming answer without calling the API."""
    sys_p  = (body.get("system") or "").lower()
    msgs   = body.get("messages") or []
    user_q = ""
    for m in reversed(msgs):
        if m.get("role") == "user":
            user_q = (m.get("content") or "").lower()
            break

    # ── Try to extract location data from system prompt ────────────
    loc_name = "the selected location"
    avg_t    = None
    rain_mm  = None
    try:
        import re
        # Look for avgT or overall.avgT in the JSON blob inside system prompt
        m = re.search(r'"avgT[^"]*"\s*:\s*([\d.]+)', sys_p)
        if m: avg_t = float(m.group(1))
        m2 = re.search(r'"annualRain[^"]*"\s*:\s*([\d.]+)', sys_p)
        if m2: rain_mm = float(m2.group(1))
        m3 = re.search(r'"location"\s*:\s*"([^"]+)"', sys_p)
        if m3: loc_name = m3.group(1).title()
    except Exception:
        pass

    q = user_q

    # ── Farming / crop advice ─────────────────────────────────────
    for crop, info in _CROP_CALENDAR.items():
        if crop in q:
            advice = (
                f"🌾 **{crop.title()} Farming Guide for {loc_name}**\n\n"
                f"📅 Sowing Season : {info['sow']}\n"
                f"🏆 Harvest Season: {info['harvest']}\n"
                f"💧 Water Needed  : ~{info['water_mm']} mm/season\n"
                f"🌡️ Ideal Temp    : {info['temp_c']}°C\n"
                f"📝 Notes         : {info['notes']}\n"
            )
            if avg_t is not None:
                if avg_t < 10:
                    advice += f"\n⚠️ {loc_name} avg temp ({avg_t}°C) is quite cold — consider protected cultivation or choose cold-tolerant varieties."
                elif avg_t > 35:
                    advice += f"\n⚠️ {loc_name} avg temp ({avg_t}°C) is very hot — irrigation management and heat-tolerant varieties are critical."
                else:
                    advice += f"\n✅ {loc_name} avg temp ({avg_t}°C) is suitable for this crop."
            if rain_mm is not None:
                if rain_mm < info['water_mm'] * 0.4:
                    advice += f"\n💧 Annual rain (~{rain_mm:.0f}mm) is well below crop water need — supplemental irrigation required."
                elif rain_mm >= info['water_mm']:
                    advice += f"\n🌧️ Annual rain (~{rain_mm:.0f}mm) may meet most water needs — monitor drainage."
            return advice

    # Generic farming question
    if any(w in q for w in ["farm","crop","agri","grow","plant","irrigat","harvest","sow","cultivat"]):
        crops_list = ", ".join(c.title() for c in _CROP_CALENDAR)
        reply = (
            f"🌿 **Farming Advisory for {loc_name}**\n\n"
            f"I can provide detailed guidance for: {crops_list}.\n"
            f"Ask me about a specific crop (e.g. 'wheat farming advice') for:\n"
            f"  • Sowing & harvest calendar\n"
            f"  • Water requirements\n"
            f"  • Temperature suitability for this location\n"
            f"  • Key cultivation notes\n"
        )
        if avg_t is not None and rain_mm is not None:
            reply += f"\n📊 Current data summary: Avg temp {avg_t}°C · Annual rain ~{rain_mm:.0f}mm"
        return reply

    # ── Temperature questions ─────────────────────────────────────
    if any(w in q for w in ["temp","hot","cold","degree","warmest","coolest","heat","freeze"]):
        if avg_t is not None:
            season = "hot" if avg_t > 28 else ("warm" if avg_t > 20 else ("mild" if avg_t > 12 else "cold"))
            return (
                f"🌡️ **Temperature — {loc_name}**\n\n"
                f"Mean annual temperature: **{avg_t}°C** ({season} climate).\n\n"
                f"Pakistan's climate zones:\n"
                f"  • >30°C avg — arid/semi-arid (Sindh, S. Punjab)\n"
                f"  • 20–30°C   — semi-arid/sub-humid (Central Punjab, KP plains)\n"
                f"  • 10–20°C   — sub-humid/humid (Northern areas, AJK)\n"
                f"  • <10°C     — highland/alpine (GB, upper KP)\n\n"
                f"Use the Climate tab charts for monthly/seasonal breakdowns."
            )
        return (
            f"🌡️ Temperature data for {loc_name} will appear in the KPI cards and charts once "
            f"you fetch climate data (click the Fetch button or select a decade). "
            f"Then ask me again for a detailed temperature analysis!"
        )

    # ── Rainfall / monsoon questions ──────────────────────────────
    if any(w in q for w in ["rain","monsoon","flood","drought","precipit","water","dry","wet"]):
        if rain_mm is not None:
            cat = "very arid (<100mm)" if rain_mm < 100 else \
                  "arid (100–250mm)"   if rain_mm < 250 else \
                  "semi-arid (250–500mm)" if rain_mm < 500 else \
                  "sub-humid (500–800mm)" if rain_mm < 800 else "humid (>800mm)"
            return (
                f"🌧️ **Rainfall — {loc_name}**\n\n"
                f"Avg annual rainfall: **{rain_mm:.0f} mm** — classified as {cat}.\n\n"
                f"🗓️ Pakistan monsoon (Jul–Sep) typically brings 60–80% of annual rain in most districts.\n"
                f"Pre-monsoon (Jun): hot, dry westerlies.\n"
                f"Winter rains (Jan–Mar): Western disturbances affect N. Punjab, KP, Balochistan.\n\n"
                f"💡 Tip: Switch to the Compare tab to see rainfall year-by-year trends."
            )
        return (
            f"🌧️ Load climate data first (Fetch button), then ask me about rainfall patterns, "
            f"monsoon timing, drought risk, or flood seasons for {loc_name}."
        )

    # ── Wind questions ────────────────────────────────────────────
    if any(w in q for w in ["wind","gust","breeze","storm"]):
        return (
            f"💨 **Wind — {loc_name}**\n\n"
            f"Wind data (WS2M = 2m height) is shown in the Wind chart on the Climate tab.\n"
            f"Pakistan wind patterns:\n"
            f"  • Summer: Hot Loo winds (May–Jun) in Punjab/Sindh — 40–60 km/h gusts\n"
            f"  • Monsoon: South-westerly moist winds (Jul–Sep)\n"
            f"  • Winter: Cold northwesterlies from Afghanistan/Iran\n"
            f"  • Coastal: Sea breezes in Karachi (Arabian Sea)\n\n"
            f"Load data and check the Wind chart for site-specific mean wind speeds."
        )

    # ── Climate summary / general ─────────────────────────────────
    if any(w in q for w in ["summar","overview","climate","tell me","what","describ","explain","analys","analyz"]):
        if avg_t is not None:
            rain_line = f"  🌧️ Annual rain : {rain_mm:.0f}mm\n" if rain_mm else ""
            return (
                f"🌍 **Climate Overview — {loc_name}**\n\n"
                f"📊 Loaded data shows:\n"
                f"  🌡️ Mean temp   : {avg_t}°C\n"
                f"{rain_line}"
                f"Pakistan has 5 major climate zones: arid (Balochistan/Sindh), semi-arid (Punjab plains), "
                f"sub-humid (NE Punjab), humid (AJK/KP hills), and alpine (GB/Hindu Kush).\n\n"
                f"💡 Use the AI tab → Smart Summary button for a full AI-generated narrative.\n"
                f"Or ask me about temperature, rainfall, wind, or a specific crop."
            )
        return (
            f"🌍 **PakClim Assistant**\n\n"
            f"I can help you with:\n"
            f"  🌡️ Temperature analysis for any district\n"
            f"  🌧️ Rainfall & monsoon patterns\n"
            f"  💨 Wind & humidity insights\n"
            f"  🌾 Crop & farming advice (wheat, rice, cotton, mango + more)\n"
            f"  ⚠️ Disaster risk awareness (flood, drought, heatwave)\n\n"
            f"Select a district on the map, fetch climate data, then ask me anything!"
        )

    # ── Disaster / risk questions ─────────────────────────────────
    if any(w in q for w in ["risk","disast","flood","heatwave","drought","earthquake","landslid"]):
        return (
            f"⚠️ **Disaster Risk — {loc_name}**\n\n"
            f"Pakistan faces several major climate hazards:\n"
            f"  🌊 Floods    — Monsoon flash floods (Jul–Sep), Indus River flooding\n"
            f"  ☀️ Heatwaves — May–Jun in Sindh/S.Punjab (>45°C recorded)\n"
            f"  💧 Droughts  — Extended dry spells in Balochistan/Sindh\n"
            f"  ❄️ Cold waves — Dec–Jan in northern highlands\n\n"
            f"💡 Use AI tab → Risk Advisor for a data-driven risk assessment for your selected district."
        )

    # ── Default ───────────────────────────────────────────────────
    return (
        f"👋 I'm **PakClim AI Assistant** for {loc_name}.\n\n"
        f"You can ask me:\n"
        f"  🌡️ Temperature / hottest month\n"
        f"  🌧️ Rainfall / monsoon patterns\n"
        f"  🌾 Farming advice (wheat, rice, cotton, mango…)\n"
        f"  ⚠️ Flood / drought / heatwave risk\n"
        f"  💨 Wind conditions\n\n"
        f"💡 To get full Claude AI answers, add your Anthropic API key:\n"
        f"   python Pakclim_server.py --db weather_data.db --key sk-ant-…"
    )


@app.route('/api/ai/key', methods=['POST', 'OPTIONS'])
def set_ai_key():
    """Allow the frontend to set the API key at runtime (local only)."""
    if request.method == 'OPTIONS':
        return '', 204
    global _AI_KEY
    data = request.get_json(silent=True) or {}
    key  = (data.get("key") or "").strip()
    if not key.startswith("sk-ant-"):
        return jsonify({"error": "Invalid key format. Must start with sk-ant-"}), 400
    _AI_KEY = key
    return jsonify({"ok": True, "message": "API key saved for this session."})


@app.route('/api/ai/status', methods=['GET'])
def ai_status():
    """Let the frontend check if an API key is loaded."""
    return jsonify({"key_loaded": bool(_AI_KEY), "mode": "claude" if _AI_KEY else "rule-based"})


@app.route('/api/ai', methods=['POST', 'OPTIONS'])
def ai_proxy():
    """
    POST /api/ai  — receives a Claude-format request body and:
      1. Forwards it to Anthropic API if _AI_KEY is set   (Claude mode)
      2. Falls back to rule-based engine otherwise         (offline mode)
    Body schema:  { model, max_tokens, system, messages }
    """
    global _AI_KEY   # declared at top so it can be cleared on auth error

    if request.method == 'OPTIONS':
        return '', 204

    body = request.get_json(silent=True) or {}

    # ── CLAUDE API MODE ───────────────────────────────────────────
    if _AI_KEY and _urlreq:
        try:
            payload = {
                "model":      body.get("model", "claude-sonnet-4-20250514"),
                "max_tokens": min(int(body.get("max_tokens", 1024)), 4096),
                "messages":   body.get("messages", []),
            }
            if body.get("system"):
                payload["system"] = body["system"]

            req_data = json.dumps(payload).encode("utf-8")
            req = _urlreq.Request(
                "https://api.anthropic.com/v1/messages",
                data    = req_data,
                method  = "POST",
                headers = {
                    "x-api-key":         _AI_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                }
            )
            with _urlreq.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            return jsonify(result)

        except _urlerr.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(err_body)
                err_msg  = err_json.get("error", {}).get("message", err_body)
            except Exception:
                err_msg = err_body[:300]

            # If auth error, clear key so fallback activates automatically
            if e.code in (401, 403):
                _AI_KEY = None
                err_msg = f"API key rejected ({e.code}). Switching to rule-based mode. Re-add key with --key flag."

            return jsonify({"error": f"Anthropic API error {e.code}: {err_msg}"}), 502

        except Exception as e:
            return jsonify({"error": f"Claude API call failed: {str(e)}. Falling back to rule-based."}), 502

    # ── RULE-BASED FALLBACK MODE ──────────────────────────────────
    reply_text = _rule_based_reply(body)

    # Return with _use_js_engine flag so the browser JS knows to
    # use its own built-in engine instead of this server response.
    # This gives richer answers based on actual loaded chart data.
    return jsonify({
        "id":    "rb-0000",
        "type":  "message",
        "role":  "assistant",
        "model": "rule-based-v1",
        "content": [{"type": "text", "text": reply_text}],
        "stop_reason": "end_turn",
        "_mode": "rule-based",
        "_use_js_engine": True
    })

# ── END AI PROXY ───────────────────────────────────────────────────



if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db',   required=True)
    parser.add_argument('--port', default=8765, type=int)
    parser.add_argument('--key',  default='',   help='Anthropic API key (sk-ant-…). Enables Claude AI mode.')
    args = parser.parse_args()
    DB_PATH = args.db

    if args.key and args.key.startswith("sk-ant-"):
        _AI_KEY = args.key
        ai_mode = "✅ Claude AI mode  (key loaded)"
    else:
        ai_mode = "⚡ Rule-based mode (add --key sk-ant-… for Claude AI)"

    district_ok, tehsil_ok = check_ready()
    status = "✅ District + Tehsil tables ready!" if (district_ok and tehsil_ok) \
        else ("✅ District tables ready — run prepare_db.py for tehsil" if district_ok \
        else "⚠ Run prepare_db.py first!")

    print(f"""
╔══════════════════════════════════════════════════════╗
║         PakClim SQLite Server  v2.3                  ║
╠══════════════════════════════════════════════════════╣
║  DB:    {args.db:<45} ║
║  URL:   http://localhost:{args.port:<28} ║
║  {status:<52} ║
║  AI:    {ai_mode:<45} ║
╚══════════════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=args.port, debug=False)