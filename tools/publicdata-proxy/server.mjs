// ValueLink public-data proxy. Holds the service keys (they never ship in the APK) and caches by coarse cell, so
// the call count grows with the number of cells, not the number of cars. The car never sends its coordinates:
// weather by KMA 5 km grid cell (nx, ny), maps by ~1 km tile (tx, ty), POIs by district code.
//
//   tools/publicdata-proxy/run.sh            (loads ../.secrets/datagokr.env and safemap.env, PORT=8791)
//   web: VITE_PUBLIC_PROXY=http://<host>:8791
//
// Routes (all GET, JSON unless noted)
//   /kma/ncst?nx&ny          기상청 초단기실황 (PTY, RN1, T1H)              data.go.kr 15084084
//   /kma/ultra?nx&ny         기상청 초단기예보 6 h (PTY, RN1, T1H)           data.go.kr 15084084
//   /kma/warnings?stn        기상청 기상특보 목록                            data.go.kr 15000415
//   /kma/uv?area             기상청 생활기상지수 자외선지수                   data.go.kr 15085288
//   /ev?zscode               한국환경공단 충전소 + 상태, 충전소별 집계        data.go.kr 15076352
//   /parking?inst            전국주차장정보표준데이터 (기관명)               data.go.kr 15012896
//   /koroad/freezing?sido&gugun  도로교통공단 결빙 사고다발지역              data.go.kr 15058135
//   /safemap/tile?layer&tx&ty    생활안전지도 WMS (flood | crime), PNG     safemap IF_0092, IF_0084

import http from 'node:http'

const KEY = process.env.DATA_GO_KR_KEY
const SAFEMAP = process.env.SAFEMAP_KEY
const PORT = Number(process.env.PORT ?? 8791)
if (!KEY || !SAFEMAP) {
  console.error('DATA_GO_KR_KEY and SAFEMAP_KEY are required')
  process.exit(1)
}

export const TILE_DEG = 0.01
const TILE_PX = { flood: 1024, crime: 512 } // flood polygons need the detail, the density map does not
const LAYERS = { flood: 'IF_0092_WMS', crime: 'IF_0084_WMS' }
const cache = new Map()

async function cached(key, ttlMs, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.v
  const v = await load()
  cache.set(key, { at: Date.now(), v })
  return v
}

const kst = (ms = Date.now()) => new Date(ms + 9 * 3600e3)
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '')
const hh = (d) => String(d.getUTCHours()).padStart(2, '0')

/** 초단기실황: hourly at :00, published ~:40. 초단기예보: hourly at :30, published ~:45. */
function base(kind) {
  const d = kst()
  const ready = kind === 'ncst' ? 40 : 45
  if (d.getUTCMinutes() < ready) d.setUTCHours(d.getUTCHours() - 1)
  return { d: ymd(d), t: `${hh(d)}${kind === 'ncst' ? '00' : '30'}` }
}

async function json(url) {
  const r = await fetch(url)
  const text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`upstream ${r.status}: ${text.slice(0, 200)}`)
  }
}

const items = (j) => {
  const it = j?.response?.body?.items?.item ?? j?.body?.items?.item ?? j?.items?.item ?? j?.items ?? []
  return Array.isArray(it) ? it : [it]
}

async function kma(path, params) {
  const q = new URLSearchParams({ serviceKey: KEY, dataType: 'JSON', pageNo: '1', numOfRows: '100', ...params })
  return json(`https://apis.data.go.kr/1360000/${path}?${q}`)
}

async function ev(zscode) {
  const zcode = zscode.slice(0, 2)
  const rows = []
  for (let page = 1; page <= 6; page++) {
    const q = new URLSearchParams({ serviceKey: KEY, dataType: 'JSON', pageNo: String(page), numOfRows: '9999', zcode, zscode })
    const j = await json(`https://apis.data.go.kr/B552584/EvCharger/getChargerInfo?${q}`)
    const it = items(j)
    rows.push(...it)
    if (it.length < 9999) break
  }
  const by = new Map()
  for (const c of rows) {
    const s = by.get(c.statId) ?? { id: c.statId, name: c.statNm, busi: c.busiNm, lat: +c.lat, lng: +c.lng, maxKw: 0, avail: 0, total: 0, fast: false }
    s.total++
    if (c.stat === '2') s.avail++ // 2 = 충전대기 (free)
    s.maxKw = Math.max(s.maxKw, Number(c.output) || 0)
    if (['01', '03', '04', '05', '06', '09'].includes(c.chgerType)) s.fast = true // DC types
    by.set(c.statId, s)
  }
  return [...by.values()].map((s) => ({ ...s, epit: /e-?pit/i.test(s.name) }))
}

async function parking(inst) {
  const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: '1', numOfRows: '1000', instt_nm: inst })
  const j = await json(`https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api?${q}`)
  return items(j)
    .filter((p) => p.latitude && p.longitude)
    .map((p) => ({ id: p.prkplceNo, name: p.prkplceNm, se: p.prkplceSe, type: p.prkplceType, spaces: Number(p.prkcmprt) || 0, lat: +p.latitude, lng: +p.longitude, addr: p.rdnmadr || p.lnmadr }))
}

async function freezing(sido, gugun) {
  for (const year of [kst().getUTCFullYear() - 1, kst().getUTCFullYear() - 2]) {
    const q = new URLSearchParams({ serviceKey: KEY, searchYearCd: String(year), siDo: sido, guGun: gugun, type: 'json', numOfRows: '100', pageNo: '1' })
    const j = await json(`https://apis.data.go.kr/B552061/frequentzoneFreezing/getRestFrequentzoneFreezing?${q}`)
    const it = items(j)
    if (it.length) return it.map((s) => ({ id: s.spot_cd, name: s.spot_nm, count: s.occrrnc_cnt, injured: s.caslt_cnt, lat: +s.la_crd, lng: +s.lo_crd, year }))
  }
  return []
}

async function tile(layer, tx, ty) {
  const minLng = tx * TILE_DEG
  const minLat = ty * TILE_DEG
  const bbox = `${minLng},${minLat},${minLng + TILE_DEG},${minLat + TILE_DEG}`
  const r = await fetch(`https://www.safemap.go.kr/openapi2/${LAYERS[layer]}?serviceKey=${SAFEMAP}&srs=EPSG:4326&bbox=${bbox}&format=image/png&width=${TILE_PX[layer]}&height=${TILE_PX[layer]}&transparent=TRUE`)
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('png')) throw new Error(`safemap ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const q = Object.fromEntries(u.searchParams)
    const int = (v) => /^-?\d+$/.test(v ?? '')
    try {
      switch (u.pathname) {
        case '/kma/ncst': {
          if (!int(q.nx) || !int(q.ny)) return send(res, 400, { error: 'nx, ny' })
          const b = base('ncst')
          return send(res, 200, await cached(`n${q.nx},${q.ny},${b.d}${b.t}`, 10 * 60e3, () => kma('VilageFcstInfoService_2.0/getUltraSrtNcst', { base_date: b.d, base_time: b.t, nx: q.nx, ny: q.ny })))
        }
        case '/kma/ultra': {
          if (!int(q.nx) || !int(q.ny)) return send(res, 400, { error: 'nx, ny' })
          const b = base('ultra')
          return send(res, 200, await cached(`u${q.nx},${q.ny},${b.d}${b.t}`, 10 * 60e3, () => kma('VilageFcstInfoService_2.0/getUltraSrtFcst', { base_date: b.d, base_time: b.t, nx: q.nx, ny: q.ny, numOfRows: '60' })))
        }
        case '/kma/warnings': {
          if (!int(q.stn)) return send(res, 400, { error: 'stn' })
          return send(res, 200, await cached(`w${q.stn}`, 10 * 60e3, () => kma('WthrWrnInfoService/getWthrWrnList', { stnId: q.stn, numOfRows: '20' })))
        }
        case '/kma/uv': {
          if (!int(q.area)) return send(res, 400, { error: 'area' })
          const d = kst()
          const t = `${ymd(d)}${d.getUTCHours() < 6 ? '00' : d.getUTCHours() < 18 ? '06' : '18'}`
          return send(res, 200, await cached(`uv${q.area}${t}`, 60 * 60e3, () => kma('LivingWthrIdxServiceV5/getUVIdxV5', { areaNo: q.area, time: t })))
        }
        case '/ev':
          if (!/^\d{5}$/.test(q.zscode ?? '')) return send(res, 400, { error: 'zscode' })
          return send(res, 200, await cached(`ev${q.zscode}`, 3 * 60e3, () => ev(q.zscode)))
        case '/parking':
          if (!q.inst) return send(res, 400, { error: 'inst' })
          return send(res, 200, await cached(`p${q.inst}`, 24 * 3600e3, () => parking(q.inst)))
        case '/koroad/freezing':
          if (!int(q.sido) || !int(q.gugun)) return send(res, 400, { error: 'sido, gugun' })
          return send(res, 200, await cached(`f${q.sido}${q.gugun}`, 24 * 3600e3, () => freezing(q.sido, q.gugun)))
        case '/safemap/tile':
          if (!LAYERS[q.layer] || !int(q.tx) || !int(q.ty)) return send(res, 400, { error: 'layer, tx, ty' })
          return send(res, 200, await cached(`t${q.layer}${q.tx},${q.ty}`, 24 * 3600e3, () => tile(q.layer, +q.tx, +q.ty)), 'image/png')
        case '/health':
          return send(res, 200, { ok: true, cached: cache.size })
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 502, { error: String(e.message ?? e) })
    }
  })
  .listen(PORT, () => console.log(`publicdata proxy on :${PORT}`))
