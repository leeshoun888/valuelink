// Public data: what the city and the state know that the car does not.
//
// ValueLink overlays Korean public data on the car's own signals so the car can protect its value before
// anything happens: forecast rain before the wipers ever move, a heavy-rain warning over a parking spot that
// flooded before, a theft-prone block, an accident hotspot ahead, the EV subsidy window for the next car.
//
// Two kinds of data, two paths:
//   dynamic (weather, warnings, charger status)  -> LivePublicSource through a tiny key-holding proxy
//                                                   (tools/publicdata-proxy), queried by KMA 5 km grid cell,
//                                                   never by the car's exact position
//   static  (flood traces, crime / accident zones,  -> regional packs shipped with the app and refreshed
//            parking lots, recalls, subsidy notices)    monthly, matched on the device
// When the proxy is not configured (judging build, emulator without internet) ScenarioPublicSource serves a
// snapshot in the same shapes, so the engine and the guard run identically.

export type AlertKind = '호우주의보' | '호우경보' | '태풍경보' | '대설주의보' | '폭염경보' | '한파주의보' | '우박'

export interface Alert {
  kind: AlertKind
  area: string
  issuedAt: number
}

export interface Weather {
  /** KMA PTY: 0 none, 1 rain, 2 rain/snow, 3 snow, 4 shower, 5 drizzle, 6 drizzle/snow flurry, 7 snow flurry */
  pty: number
  /** minutes until precipitation starts in the ultra-short-term forecast (undefined: none in 6 h) */
  rainInMin?: number
  /** probability of precipitation, % (short-term forecast POP) */
  pop: number
  /** 1-hour precipitation, mm (RN1) */
  rain1hMm: number
  tempC: number
  /** KMA living-weather UV index */
  uv: number
}

export type ZoneKind = 'flood' | 'theft' | 'accident'

export interface Zone {
  id: string
  kind: ZoneKind
  lat: number
  lng: number
  radiusM: number
  label: string
  detail: string
  source: string
}

export type LotKind = '지하' | '지상' | '주차빌딩' | '노상' | '건물'

export interface Lot {
  id: string
  name: string
  lat: number
  lng: number
  kind: LotKind
  /** recommended level, e.g. "지상 4층" */
  level: string
  covered: boolean
  public: boolean
  evChargers: number
}

export interface Subsidy {
  region: string
  nationalManwon: number
  localManwon: number
  remaining: number
  total: number
  notice: string
}

export interface PolicyDate {
  name: string
  endsAt: number
  manwon: number
}

export interface Recall {
  id: string
  title: string
  issuedAt: number
  /** completed at a Bluehands visit (from the car's own service record) */
  fixedAt?: number
}

export interface PublicFeed {
  at: number
  grid: { nx: number; ny: number }
  region: string
  weather: Weather
  alerts: Alert[]
  zones: Zone[]
  lots: Lot[]
  subsidy?: Subsidy
  policy: PolicyDate[]
  recalls: Recall[]
  batteryRegistry?: { id: string; registeredAt: number }
  /** where each piece came from, for the UI and the judges */
  mode: 'live' | 'snapshot'
  /** EV chargers nearby with live availability (한국환경공단) */
  chargers?: Charger[]
  /** map layers drawn under the Value Map (생활안전지도 WMS tiles through the proxy) */
  overlays?: Overlay[]
  /** raster layers sampled at a point (flood trace, crime density); undefined while not loaded */
  sample?: (kind: 'flood' | 'theft', p: { lat: number; lng: number }) => Zone | null | undefined
}

export interface Charger {
  id: string
  name: string
  busi: string
  lat: number
  lng: number
  maxKw: number
  avail: number
  total: number
  fast: boolean
  epit: boolean
}

export interface Overlay {
  layer: 'flood' | 'theft'
  url: string
  west: number
  south: number
  east: number
  north: number
}

export interface PublicCall {
  t: number
  api: string
  query: string
  result: string
}

export interface PublicSource {
  readonly mode: 'live' | 'snapshot'
  feed(pos: [number, number] | undefined, t: number): PublicFeed
  /** recent API calls (newest first), for the console's data log */
  calls: PublicCall[]
}

// ---- catalogue of the datasets ValueLink uses (shown in the app and in the proposal) ------------------------

export const DATASETS = [
  { key: 'kma-fcst', name: '단기예보 조회서비스 (초단기예보)', agency: '기상청', use: '강수 시작 시각·강수확률·기온', access: 'Open API · 공공누리 1유형' },
  { key: 'kma-warn', name: '기상특보 조회서비스', agency: '기상청', use: '호우·태풍·대설·폭염 특보', access: 'Open API · 공공누리 1유형' },
  { key: 'kma-life', name: '생활기상지수 조회서비스', agency: '기상청', use: '자외선지수', access: 'Open API · 이용허락 제한 없음' },
  { key: 'safemap', name: '생활안전지도 (침수흔적도·범죄주의구간·상습결빙구간)', agency: '행정안전부·경찰청', use: '과거 침수 구역·차량 범죄 주의 구간', access: 'WMS Open API' },
  { key: 'taas', name: '사고다발지역정보 (보행자·결빙·법규위반)', agency: '도로교통공단', use: '사고다발지 경고', access: 'Open API · 이용허락 제한 없음' },
  { key: 'parking', name: '전국주차장정보표준데이터 + 건축물대장 (옥내·옥외 주차)', agency: '국토교통부·지자체', use: '공영주차장 위치·옥내 여부', access: '파일·Open API' },
  { key: 'ev-charger', name: '전기자동차 충전소 정보', agency: '한국환경공단', use: '충전기 실시간 상태', access: 'Open API · 공공누리 1유형' },
  { key: 'ev-subsidy', name: '전기차 구매보조금 지자체 공고·접수 현황', agency: '환경부 무공해차 통합누리집', use: '보조금·잔여 대수', access: '웹 공시 (서버 수집)' },
  { key: 'recall', name: '자동차 리콜정보 API', agency: '국토교통부·한국교통안전공단', use: '차대번호별 리콜 대상', access: '출시 시 연동 (베타 API, 사전협의)' },
  { key: 'battery', name: '전기차 배터리 이력관리제 (2025.2.17 시행)', agency: '국토교통부', use: '배터리 식별번호·정비 이력', access: '자동차등록원부 연계 (제휴)' },
] as const

// ---- KMA grid (Lambert conformal conic, 5 km): the car shares only this cell, not its position ----------------

export function kmaGrid(lat: number, lng: number) {
  const RE = 6371.00877
  const GRID = 5.0
  const D = Math.PI / 180
  const re = RE / GRID
  const s1 = 30 * D
  const s2 = 60 * D
  const olon = 126 * D
  const olat = 38 * D
  let sn = Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5)
  sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + s1 * 0.5)
  sf = (Math.pow(sf, sn) * Math.cos(s1)) / sn
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5)
  ro = (re * sf) / Math.pow(ro, sn)
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5)
  ra = (re * sf) / Math.pow(ra, sn)
  let theta = lng * D - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) }
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000
  const D = Math.PI / 180
  const dLat = (b.lat - a.lat) * D
  const dLng = (b.lng - a.lng) * D
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const at = (pos: [number, number]) => ({ lng: pos[0], lat: pos[1] })

// ---- the regional pack + scenario weather (snapshot) ------------------------------------------------------

/** Places of "밸류링크의 하루" (Seoul Gangnam). */
export const PLACES = {
  // inside the real 침수흔적도 polygon south of Gangnam Station
  office: [127.0276, 37.4959] as [number, number],
  // 역삼1동문화센터 공영주차장 (전국주차장정보표준데이터, 공영 노외 118면), outside the flood trace
  garage: [127.0332497, 37.4953545] as [number, number],
  service: [127.0405, 37.5045] as [number, number],
  home: [127.0622, 37.5081] as [number, number],
  school: [127.0365, 37.5009] as [number, number],
}

/**
 * Regional pack, Seoul Gangnam. Shapes follow the source datasets; positions and counts are illustrative
 * for the demonstration (the live build loads the published layers for the car's region).
 */
function regionPack(): Pick<PublicFeed, 'zones' | 'lots'> {
  const [oLng, oLat] = PLACES.office
  const [gLng, gLat] = PLACES.garage
  const [sLng, sLat] = PLACES.school
  const [hLng, hLat] = PLACES.home
  return {
    zones: [
      { id: 'f1', kind: 'flood', lat: oLat - 0.0004, lng: oLng - 0.0006, radiusM: 520, label: '침수흔적 구역', detail: '2022년 8월 집중호우 침수흔적 (도로·지하공간 침수)', source: '행정안전부 생활안전지도 침수흔적도' },
      { id: 'f2', kind: 'flood', lat: oLat - 0.006, lng: oLng + 0.009, radiusM: 380, label: '침수흔적 구역', detail: '저지대 반복 침수 구간', source: '행정안전부 생활안전지도 침수흔적도' },
      { id: 'c1', kind: 'theft', lat: hLat + 0.0006, lng: hLng - 0.0008, radiusM: 260, label: '차량 범죄 주의 구간', detail: '야간 차량 내 물품 절도 신고 다발', source: '행정안전부 생활안전지도 치안안전' },
      { id: 'a1', kind: 'accident', lat: sLat, lng: sLng, radiusM: 180, label: '보행자 사고다발지', detail: '최근 3년 보행자 사고 다발 (어린이보호구역 인접)', source: '도로교통공단 사고다발지역정보' },
    ],
    lots: [
      { id: 'p0', name: '회사 지상주차장', lat: oLat, lng: oLng, kind: '지상', level: '지상', covered: false, public: false, evChargers: 4 },
      { id: 'p4', name: '역 앞 지하공영주차장', lat: oLat + 0.0011, lng: oLng + 0.0009, kind: '지하', level: '지하 2층', covered: true, public: true, evChargers: 8 },
      { id: 'p1', name: '공영주차빌딩 A', lat: gLat, lng: gLng, kind: '주차빌딩', level: '지상 4층', covered: true, public: true, evChargers: 6 },
      { id: 'p2', name: '공영 노외주차장 B', lat: oLat + 0.0042, lng: oLng - 0.0031, kind: '지상', level: '지상', covered: false, public: true, evChargers: 2 },
      { id: 'p3', name: '집 지상주차장', lat: hLat, lng: hLng, kind: '지상', level: '지상', covered: false, public: false, evChargers: 1 },
    ],
  }
}

const CALM: Weather = { pty: 0, pop: 10, rain1hMm: 0, tempC: 21, uv: 3 }

/**
 * Snapshot source with scenario controls. The simulator script and the in-car demo menu change the weather and
 * warnings; the static layers come from the regional pack. When the car is far from the pack (the emulator's
 * default position), the pack is re-centred on the car so the demonstration still makes sense.
 */
export class ScenarioPublicSource implements PublicSource {
  readonly mode = 'snapshot' as const
  weather: Weather = { ...CALM }
  alerts: Alert[] = []
  calls: PublicCall[] = []
  private lastGrid = ''
  private lastAlerts = ''
  private lastWeather = ''

  setWeather(w: Partial<Weather>) {
    this.weather = { ...this.weather, ...w }
  }

  setAlert(kind: AlertKind | null, t: number) {
    this.alerts = kind ? [{ kind, area: '서울 동남권', issuedAt: t }] : []
  }

  clear() {
    this.weather = { ...CALM }
    this.alerts = []
  }

  feed(pos: [number, number] | undefined, t: number): PublicFeed {
    const here = pos ?? PLACES.office
    const pack = regionPack()
    // emulator / foreign position: move the pack onto the car (demo only)
    const d = distanceM(at(here), at(PLACES.office))
    let zones = pack.zones
    let lots = pack.lots
    if (d > 30_000) {
      const dx = here[0] - PLACES.office[0]
      const dy = here[1] - PLACES.office[1]
      zones = zones.map((z) => ({ ...z, lng: z.lng + dx, lat: z.lat + dy }))
      lots = lots.map((l) => ({ ...l, lng: l.lng + dx, lat: l.lat + dy }))
    }
    const grid = kmaGrid(here[1], here[0])
    this.log(t, grid)
    return {
      at: t,
      grid,
      region: '서울 강남구',
      weather: { ...this.weather },
      alerts: [...this.alerts],
      zones,
      lots,
      subsidy: { region: '서울특별시', nationalManwon: 520, localManwon: 130, remaining: 1_180, total: 6_900, notice: '무공해차 통합누리집 지자체 공고 (시연 가정값)' },
      policy: [{ name: '승용차 개별소비세 인하', endsAt: new Date(new Date(t).getFullYear(), 11, 31).getTime(), manwon: 143 }],
      recalls: [{ id: 'R-ICCU', title: '충전 제어 소프트웨어 업데이트', issuedAt: t - 400 * 864e5, fixedAt: t - 370 * 864e5 }],
      batteryRegistry: { id: 'BAT-KR-2025-0314-77K-****', registeredAt: new Date(2025, 2, 14).getTime() },
      mode: 'snapshot',
    }
  }

  private log(t: number, grid: { nx: number; ny: number }) {
    const g = `${grid.nx},${grid.ny}`
    const w = JSON.stringify(this.weather)
    const a = this.alerts.map((x) => x.kind).join(',')
    if (g !== this.lastGrid) {
      this.push(t, '행정안전부 생활안전지도', `침수흔적·치안 레이어 · 격자 ${g}`, '침수흔적 2 · 범죄주의 1 구역')
      this.push(t, '도로교통공단 사고다발지역정보', '반경 3km', '보행자 사고다발지 1곳')
      this.push(t, '전국주차장정보표준데이터 + 건축물대장', '반경 1km', '공영 3곳 (옥내 2 · 옥외 1)')
      this.lastGrid = g
    }
    if (w !== this.lastWeather) {
      const wx = this.weather
      this.push(t, '기상청 초단기예보 getUltraSrtFcst', `nx=${grid.nx} ny=${grid.ny}`, wx.rainInMin !== undefined ? `PTY ${wx.pty || 1} · ${wx.rainInMin}분 뒤 강수 · POP ${wx.pop}%` : `PTY ${wx.pty} · RN1 ${wx.rain1hMm}mm · T1H ${wx.tempC}℃`)
      this.lastWeather = w
    }
    if (a !== this.lastAlerts) {
      this.push(t, '기상청 기상특보 getWthrWrnList', '서울 동남권', a || '특보 없음')
      this.lastAlerts = a
    }
  }

  private push(t: number, api: string, query: string, result: string) {
    this.calls.unshift({ t, api, query, result })
    this.calls = this.calls.slice(0, 30)
  }
}

// ---- live source (proxy holds the keys; the car sends a grid cell, a ~1 km tile index or a district code) ----

import { regionOf, regionsNear, type Region } from './region'

export const TILE_DEG = 0.01
const TILE_PX = 512
const LAND_ALERTS: AlertKind[] = ['호우경보', '호우주의보', '태풍경보', '대설주의보', '폭염경보', '한파주의보']

interface Raster {
  data: Uint8ClampedArray
  size: number
  tx: number
  ty: number
}

async function decodePng(url: string): Promise<{ data: Uint8ClampedArray; size: number }> {
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob)
  const n = bmp.width || TILE_PX
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n })
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.drawImage(bmp, 0, 0, n, n)
  return { data: g.getImageData(0, 0, n, n).data, size: n }
}

/**
 * Live public data through the ValueLink proxy (tools/publicdata-proxy). Every request is keyed by something
 * coarse: KMA grid cell for weather, ~1 km tile for the flood / crime layers, district code for chargers,
 * parking and icing hotspots. The engine reads synchronously; refreshes run in the background.
 */
export class LivePublicSource implements PublicSource {
  calls: PublicCall[] = []
  private proxy: string
  private fallback: ScenarioPublicSource
  private wx = new Map<string, { at: number; weather: Weather; alerts: Alert[] }>()
  private uv = new Map<string, { at: number; uv: number }>()
  private poi = new Map<string, { at: number; lots: Lot[]; chargers: Charger[]; zones: Zone[] }>()
  private tiles = new Map<string, Raster | 'pending' | 'error'>()
  private pending = new Set<string>()
  private failures = 0
  /** demo overlay: the in-car menu can still inject a heavy-rain warning on top of live data */
  demo: Partial<Weather> & { alert?: AlertKind | null } = {}

  /**
   * captured: the same real data captured to static files (tools/publicdata-capture.mjs) for builds without the
   * proxy. Map layers, parking, chargers and icing hotspots are real; weather and warnings follow the scenario.
   */
  private captured: boolean
  readonly mode: 'live' | 'snapshot'
  /** captured builds: weather and warnings come from the scenario source (demo menu / simulator) */
  get scenario(): ScenarioPublicSource | null {
    return this.captured ? this.fallback : null
  }
  constructor(proxy: string, fallback = new ScenarioPublicSource(), opts: { captured?: boolean } = {}) {
    this.proxy = proxy.replace(/\/$/, '')
    this.fallback = fallback
    this.captured = Boolean(opts.captured)
    this.mode = this.captured ? 'snapshot' : 'live'
  }

  feed(pos: [number, number] | undefined, t: number): PublicFeed {
    // proxy unreachable (judging emulator without the proxy): behave exactly like the snapshot build
    if (!this.captured && this.failures >= 2 && this.wx.size === 0) {
      const f = this.fallback.feed(pos, t)
      if (this.failures < 50 && Date.now() % 60_000 < 1_000) this.failures = 1 // retry about once a minute
      return f
    }
    const here = pos ?? PLACES.office
    const lat = here[1]
    const lng = here[0]
    const grid = kmaGrid(lat, lng)
    const region = regionOf(lat, lng)
    const gk = `${grid.nx},${grid.ny}`
    const wx = this.captured ? undefined : this.wx.get(gk)
    if (!this.captured && (!wx || Date.now() - wx.at > 10 * 60e3)) this.once(`wx${gk}`, () => this.loadWeather(gk, grid, region))
    let uv = 3
    let poi = { lots: [] as Lot[], chargers: [] as Charger[], zones: [] as Zone[] }
    if (region && !this.captured) {
      const u = this.uv.get(region.area)
      if (!u || Date.now() - u.at > 3600e3) this.once(`uv${region.area}`, () => this.loadUv(region))
      if (u) uv = u.uv
    }
    for (const r of regionsNear(lat, lng, 2)) {
      const p = this.poi.get(r.zscode)
      if (!p || (!this.captured && Date.now() - p.at > 3 * 60e3)) this.once(`poi${r.zscode}`, () => this.loadPoi(r))
      if (p) poi = { lots: [...poi.lots, ...p.lots], chargers: [...poi.chargers, ...p.chargers], zones: [...poi.zones, ...p.zones] }
    }
    // flood / crime tiles covering ±1.3 km
    const overlays: Overlay[] = []
    const span = 0.013
    for (let tx = Math.floor((lng - span) / TILE_DEG); tx <= Math.floor((lng + span) / TILE_DEG); tx++)
      for (let ty = Math.floor((lat - span) / TILE_DEG); ty <= Math.floor((lat + span) / TILE_DEG); ty++)
        for (const layer of ['flood', 'theft'] as const) {
          const k = `${layer}${tx},${ty}`
          if (!this.tiles.has(k)) this.once(k, () => this.loadTile(layer, tx, ty))
          overlays.push({ layer, url: this.tileUrl(layer, tx, ty), west: tx * TILE_DEG, south: ty * TILE_DEG, east: (tx + 1) * TILE_DEG, north: (ty + 1) * TILE_DEG })
        }
    const base = this.fallback.feed(pos, t)
    const weather = this.captured ? base.weather : { ...(wx?.weather ?? base.weather), uv, ...this.demoWeather() }
    const alerts = this.captured ? base.alerts : this.demo.alert ? [{ kind: this.demo.alert, area: region?.name ?? '현재 지역', issuedAt: t }] : wx?.alerts ?? []
    return {
      ...base,
      at: t,
      grid,
      region: region?.name ?? '서울 밖 (격자·지도 레이어만)',
      weather,
      alerts,
      zones: poi.zones,
      lots: poi.lots,
      chargers: poi.chargers,
      overlays,
      sample: (kind, p) => this.sample(kind, p),
      mode: this.mode,
    }
  }

  private demoWeather(): Partial<Weather> {
    const { alert: _a, ...w } = this.demo
    return w
  }

  private tileUrl(layer: 'flood' | 'theft', tx: number, ty: number) {
    const l = layer === 'theft' ? 'crime' : 'flood'
    return this.captured ? `${this.proxy}/tiles/${l}_${tx}_${ty}.png` : `${this.proxy}/safemap/tile?layer=${l}&tx=${tx}&ty=${ty}`
  }

  private once(key: string, fn: () => Promise<void>) {
    if (this.pending.has(key)) return
    this.pending.add(key)
    void fn()
      .then(() => (this.failures = 0))
      .catch((e) => {
        this.failures++
        this.log('proxy', key, `오류 ${String(e).slice(0, 60)}`)
      })
      .finally(() => this.pending.delete(key))
  }

  private log(api: string, query: string, result: string) {
    this.calls.unshift({ t: Date.now(), api, query, result })
    this.calls = this.calls.slice(0, 30)
  }

  private async get(path: string) {
    const r = await fetch(`${this.proxy}${path}`)
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }

  private async loadWeather(gk: string, grid: { nx: number; ny: number }, region: Region | null) {
    const [ncst, ultra, warn] = await Promise.all([
      this.get(`/kma/ncst?nx=${grid.nx}&ny=${grid.ny}`),
      this.get(`/kma/ultra?nx=${grid.nx}&ny=${grid.ny}`),
      this.get(`/kma/warnings?stn=${region?.stn ?? 109}`),
    ])
    const weather = parseWeather(ncst, ultra)
    const alerts = parseWarnings(warn).filter((a) => LAND_ALERTS.includes(a.kind))
    this.wx.set(gk, { at: Date.now(), weather, alerts })
    this.log('기상청 초단기실황·예보', `격자 ${gk}`, `PTY ${weather.pty} · RN1 ${weather.rain1hMm}mm · ${weather.tempC}℃${weather.rainInMin !== undefined ? ` · ${weather.rainInMin}분 뒤 강수` : ''}`)
    const titles = (items(warn) as { title?: string }[]).map((x) => x.title ?? '')
    this.log('기상청 기상특보', `지점 ${region?.stn ?? 109}`, alerts.length ? alerts.map((a) => a.kind).join(', ') : `육상 특보 없음${titles[0] ? ` (최근: ${titles[0].replace(/^\[특보\]\s*/, '').slice(0, 40)})` : ''}`)
  }

  private async loadUv(region: Region) {
    const j = await this.get(`/kma/uv?area=${region.area}`)
    const it = items(j)[0] as Record<string, string> | undefined
    const uv = Number(it?.h0 ?? it?.h3 ?? 0) || 0
    this.uv.set(region.area, { at: Date.now(), uv })
    this.log('기상청 생활기상지수', region.name, `자외선지수 ${uv}`)
  }

  private async loadPoi(region: Region) {
    type Park = { id: string; name: string; se: string; type: string; spaces: number; lat: number; lng: number }
    type Freeze = { id: string; name: string; count: number; injured: number; lat: number; lng: number; year: number }
    let ev: Charger[]
    let parking: Park[]
    let freezing: Freeze[]
    if (this.captured) {
      const r = await fetch(`${this.proxy}/poi/${region.zscode}.json`)
      const isJson = r.ok && (r.headers.get('content-type') ?? '').includes('json')
      const j = isJson ? ((await r.json()) as { ev: Charger[]; parking: Park[]; freezing: Freeze[] }) : { ev: [], parking: [], freezing: [] }
      ;({ ev, parking, freezing } = j)
    } else {
      ;[ev, parking, freezing] = await Promise.all([
        this.get(`/ev?zscode=${region.zscode}`) as Promise<Charger[]>,
        this.get(`/parking?inst=${encodeURIComponent(region.inst)}`) as Promise<Park[]>,
        this.get(`/koroad/freezing?sido=${region.sido}&gugun=${region.gugun}`) as Promise<Freeze[]>,
      ])
    }
    const lots: Lot[] = parking.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      kind: p.type === '부설' ? '건물' : p.type === '노상' ? '노상' : '지상',
      level: `${p.se} ${p.type} · ${p.spaces}면`,
      covered: p.type === '부설',
      public: p.se === '공영',
      evChargers: 0,
    }))
    const zones: Zone[] = freezing.map((f) => ({
      id: f.id,
      kind: 'accident',
      lat: f.lat,
      lng: f.lng,
      radiusM: 160,
      label: '결빙 사고다발지',
      detail: `${f.name.replace(/^서울 \S+ /, '')} · ${f.year}년 결빙 사고 ${f.count}건`,
      source: '도로교통공단 결빙 교통사고 다발지역',
    }))
    this.poi.set(region.zscode, { at: Date.now(), lots, chargers: ev, zones })
    const epit = ev.filter((c) => c.epit)
    if (this.captured) return
    this.log('한국환경공단 충전소 정보', region.name, `충전소 ${ev.length} · E-pit ${epit.length} (빈 충전기 ${epit.reduce((a, c) => a + c.avail, 0)})`)
    this.log('전국주차장정보표준데이터', region.name, `주차장 ${lots.length} (공영 ${lots.filter((l) => l.public).length})`)
    this.log('도로교통공단 결빙 사고다발지역', region.name, `${zones.length}곳`)
  }

  private async loadTile(layer: 'flood' | 'theft', tx: number, ty: number) {
    const k = `${layer}${tx},${ty}`
    this.tiles.set(k, 'pending')
    try {
      const { data, size } = await decodePng(this.tileUrl(layer, tx, ty))
      this.tiles.set(k, { data, size, tx, ty })
      if (this.captured) return
      let n = 0
      for (let i = 3; i < data.length; i += 4 * 16) if (data[i] > 40) n++
      this.log(layer === 'flood' ? '행정안전부 침수흔적도 WMS' : '생활안전지도 범죄주의구간(절도) WMS', `타일 ${tx},${ty}`, `표시 영역 ${((100 * n) / (data.length / 64)).toFixed(1)}%`)
    } catch {
      this.tiles.set(k, 'error')
    }
  }

  /** Flood: any feature within ~10 m. Theft: red-weighted density above a threshold within ~20 m. */
  private sample(kind: 'flood' | 'theft', p: { lat: number; lng: number }): Zone | null | undefined {
    const tx = Math.floor(p.lng / TILE_DEG)
    const ty = Math.floor(p.lat / TILE_DEG)
    const r = this.tiles.get(`${kind}${tx},${ty}`)
    if (!r || typeof r === 'string') return undefined
    const S = r.size
    const px = Math.floor(((p.lng - tx * TILE_DEG) / TILE_DEG) * S)
    const py = Math.floor((1 - (p.lat - ty * TILE_DEG) / TILE_DEG) * S)
    const rad = Math.round(((kind === 'flood' ? 5 : 10) * S) / TILE_PX)
    let hit = 0
    let peak = 0
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        const x = px + dx
        const y = py + dy
        if (x < 0 || y < 0 || x >= S || y >= S) continue
        const i = (y * S + x) * 4
        const a = r.data[i + 3] / 255
        if (kind === 'flood') {
          if (a > 0.15) hit++
        } else peak = Math.max(peak, a * (1 - r.data[i + 1] / 255) * 2.2)
      }
    if (kind === 'flood')
      return hit > 6 * (S / TILE_PX) ** 2 ? { id: `fl${tx}${ty}`, kind: 'flood', lat: p.lat, lng: p.lng, radiusM: 0, label: '침수흔적 구역', detail: '행정안전부 침수흔적도에 기록된 과거 침수 구역', source: '행정안전부 생활안전지도 침수흔적도 (실데이터)' } : null
    return peak > 0.45 ? { id: `cr${tx}${ty}`, kind: 'theft', lat: p.lat, lng: p.lng, radiusM: 0, label: '차량 범죄 주의 구간', detail: `절도 밀도 상위 구간 (밀도 ${Math.round(peak * 100)})`, source: '경찰청 범죄주의구간(절도) · 생활안전지도 (실데이터)' } : null
  }
}

function items(json: unknown): unknown[] {
  const it = (json as { response?: { body?: { items?: { item?: unknown } } } })?.response?.body?.items?.item ?? []
  return Array.isArray(it) ? it : [it]
}

interface KmaItem {
  category: string
  fcstDate?: string
  fcstTime?: string
  fcstValue?: string
  obsrValue?: string
}

/** KMA 초단기실황 + 초단기예보 -> Weather (now from the observation, first rain hour from the forecast). */
export function parseWeather(ncst: unknown, ultra: unknown): Weather {
  const now: Record<string, string> = {}
  for (const it of items(ncst) as KmaItem[]) now[it.category] = it.obsrValue ?? ''
  const byTime = new Map<string, Record<string, string>>()
  for (const it of items(ultra) as KmaItem[]) {
    const k = `${it.fcstDate}${it.fcstTime}`
    byTime.set(k, { ...(byTime.get(k) ?? {}), [it.category]: it.fcstValue ?? '' })
  }
  const slots = [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b))
  const first = slots.find(([, v]) => Number(v.PTY ?? 0) > 0)
  let rainInMin: number | undefined
  if (first) {
    const k = first[0]
    const at = Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10) - 9, +k.slice(10, 12))
    rainInMin = Math.max(0, Math.round((at - Date.now()) / 60_000))
  }
  const num = (v?: string) => (v && /[\d.]+/.test(v) ? parseFloat(v) : 0)
  const pty = Number(now.PTY ?? 0)
  return {
    pty,
    rainInMin: pty > 0 ? undefined : rainInMin,
    pop: pty > 0 ? 100 : first ? 70 : 0,
    rain1hMm: num(now.RN1),
    tempC: num(now.T1H),
    uv: 3,
  }
}

/** KMA WthrWrnInfoService getWthrWrnList: the latest announcement per kind decides whether it is in force. */
export function parseWarnings(json: unknown): Alert[] {
  const list = (items(json) as { title?: string; tmFc?: number | string }[]).sort((a, b) => Number(b.tmFc) - Number(a.tmFc))
  const kinds: AlertKind[] = ['호우경보', '호우주의보', '태풍경보', '대설주의보', '폭염경보', '한파주의보']
  const out: Alert[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const title = it.title ?? ''
    for (const k of kinds) {
      const stem = k.replace(/(경보|주의보)$/, '')
      if (!title.includes(stem) || seen.has(stem)) continue
      seen.add(stem)
      if (/해제/.test(title)) continue
      const level = title.includes(`${stem}경보`) ? `${stem}경보` : `${stem}주의보`
      if (kinds.includes(level as AlertKind)) out.push({ kind: level as AlertKind, area: title, issuedAt: Date.now() })
    }
  }
  return out
}
