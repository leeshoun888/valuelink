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

export type LotKind = '지하' | '지상' | '주차빌딩' | '노상'

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
  { key: 'recall', name: '자동차 리콜정보 API', agency: '국토교통부·한국교통안전공단', use: '차대번호별 리콜 대상', access: 'Open API · 사전협의 후 연동' },
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
  office: [127.0286, 37.4972] as [number, number],
  garage: [127.0331, 37.4996] as [number, number],
  service: [127.0405, 37.5045] as [number, number],
  home: [127.0592, 37.5121] as [number, number],
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

// ---- live source (proxy holds the data.go.kr service key; the car sends a grid cell only) ------------------

/**
 * Live public data through the ValueLink proxy (tools/publicdata-proxy). Dynamic data is refreshed every 10 min
 * per grid cell; the static layers still come from the regional pack. Falls back to the snapshot on any error.
 */
export class LivePublicSource implements PublicSource {
  readonly mode = 'live' as const
  calls: PublicCall[] = []
  private cache = new Map<string, { at: number; weather: Weather; alerts: Alert[] }>()
  private pending = new Set<string>()
  private proxy: string
  private fallback: ScenarioPublicSource
  constructor(proxy: string, fallback = new ScenarioPublicSource()) {
    this.proxy = proxy
    this.fallback = fallback
  }

  feed(pos: [number, number] | undefined, t: number): PublicFeed {
    const base = this.fallback.feed(pos, t)
    const key = `${base.grid.nx},${base.grid.ny}`
    const hit = this.cache.get(key)
    if (!hit || Date.now() - hit.at > 10 * 60_000) void this.refresh(key, base.grid)
    return hit ? { ...base, weather: hit.weather, alerts: hit.alerts, mode: 'live' } : base
  }

  private async refresh(key: string, grid: { nx: number; ny: number }) {
    if (this.pending.has(key)) return
    this.pending.add(key)
    try {
      const [fc, wr] = await Promise.all([
        fetch(`${this.proxy}/kma/ultra?nx=${grid.nx}&ny=${grid.ny}`).then((r) => r.json()),
        fetch(`${this.proxy}/kma/warnings?nx=${grid.nx}&ny=${grid.ny}`).then((r) => r.json()),
      ])
      const weather = parseUltraShort(fc)
      const alerts = parseWarnings(wr)
      this.cache.set(key, { at: Date.now(), weather, alerts })
      this.calls.unshift({ t: Date.now(), api: '기상청 초단기예보', query: `nx=${grid.nx} ny=${grid.ny}`, result: `PTY ${weather.pty} · POP ${weather.pop}%` })
    } catch {
      /* keep the snapshot */
    } finally {
      this.pending.delete(key)
    }
  }
}

interface KmaItem {
  category: string
  fcstDate: string
  fcstTime: string
  fcstValue: string
}

/** KMA VilageFcstInfoService_2.0 getUltraSrtFcst response -> Weather (first rain hour, RN1, T1H). */
export function parseUltraShort(json: unknown): Weather {
  const items: KmaItem[] = (json as { response?: { body?: { items?: { item?: KmaItem[] } } } })?.response?.body?.items?.item ?? []
  const byTime = new Map<string, Record<string, string>>()
  for (const it of items) {
    const k = it.fcstDate + it.fcstTime
    byTime.set(k, { ...(byTime.get(k) ?? {}), [it.category]: it.fcstValue })
  }
  const slots = [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b))
  const now = slots[0]?.[1] ?? {}
  const first = slots.findIndex(([, v]) => Number(v.PTY ?? 0) > 0)
  const rn = (v?: string) => (v && /[\d.]+/.test(v) ? parseFloat(v) : 0)
  return {
    pty: Number(now.PTY ?? 0),
    rainInMin: first >= 0 ? first * 60 : undefined,
    pop: first >= 0 ? 80 : 10,
    rain1hMm: rn(now.RN1),
    tempC: Number(now.T1H ?? 20),
    uv: 3,
  }
}

/** KMA WthrWrnInfoService getWthrWrnList titles -> Alerts. */
export function parseWarnings(json: unknown): Alert[] {
  const items: { title?: string; tmFc?: string }[] = (json as { response?: { body?: { items?: { item?: { title?: string; tmFc?: string }[] } } } })?.response?.body?.items?.item ?? []
  const kinds: AlertKind[] = ['호우경보', '호우주의보', '태풍경보', '대설주의보', '폭염경보', '한파주의보']
  const out: Alert[] = []
  for (const it of items) {
    const k = kinds.find((x) => it.title?.includes(x.replace('경보', ' 경보').replace('주의보', ' 주의보')) || it.title?.includes(x))
    if (k && !it.title?.includes('해제')) out.push({ kind: k, area: it.title ?? '', issuedAt: Date.now() })
  }
  return out
}
