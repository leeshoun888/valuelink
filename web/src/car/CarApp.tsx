// The in-vehicle app (what runs in the Pleos Connect window). Apple-like restraint: one big number, a
// living object, short sentences. While driving it collapses to a glanceable, motion-free card
// (Pleos driver-distraction guideline); the 3D car rotates only while parked.

import { PassportCard, passportDataOf } from '../ui/PassportCard'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type SheetKind } from '../state/store'
import { ValueMapSheet } from './ValueMapSheet'
import { useVoice } from '../voice/voice'
import type { Snapshot } from '../engine/runtime'
import { manwon, won } from '../engine/valuation'
import { activeRouteKm, type LedgerEntry } from '../engine/guard'
import { ago, clock } from '../ui/format'
import { Logo } from '../ui/icons'
import { isNative } from '../engine/native'
import type { CarState } from '../three/StudioCar'
import { ClipLayer, clipFor, type ClipName } from '../three/Clip'
import './car.css'

const StudioCar = lazy(() => import('../three/StudioCar'))

const LAND = { w: 1700, h: 1212 }
const PORT = { w: 840, h: 1184 }

/** Scales the fixed dp design to whatever box it is mounted in (APK window or console frame). */
export function CarFrame({ portrait }: { portrait?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const auto = portrait ?? box.h > box.w * 1.05
  const d = auto ? PORT : LAND
  const s = box.w ? Math.min(box.w / d.w, box.h / d.h) : 0
  return (
    <div ref={ref} className="jg-frame">
      <div className={`jg-scale ${auto ? 'portrait' : 'landscape'}`} style={{ width: d.w, height: d.h, transform: `translate(-50%,-50%) scale(${s})` }}>
        <CarApp portrait={auto} />
      </div>
    </div>
  )
}

/** Light / dark: the vehicle's UI mode in the APK; otherwise the console setting (auto = sim clock). */
export function useTheme(snap: Snapshot | null): 'light' | 'dark' {
  const pref = useStore((s) => s.carTheme)
  if (!snap) return 'light'
  if (snap.sig.uiNight !== undefined) return snap.sig.uiNight ? 'dark' : 'light'
  if (pref !== 'auto') return pref
  const h = new Date(snap.sig.t).getHours()
  return h >= 7 && h < 19 ? 'light' : 'dark'
}

const PART_OF: Record<string, CarState['part']> = {
  TPMS: 'tyre',
  LOW_VOLT_BATTERY: 'lv',
  EV_SYSTEM: 'hv',
  POWER_DOWN: 'hv',
  RBS: 'hv',
  ENGINE: 'motor',
  MDPS: 'motor',
}

export function carStateOf(s: Snapshot, xray = false, sheet: SheetKind | null = null): CarState {
  const m = s.pub.map
  const floodF = m?.factors.find((f) => f.kind === 'flood')
  const driving = s.mode === 'driving'
  const part = driving ? null : (s.warnings.map((w) => PART_OF[w.type]).find(Boolean) ?? null)
  const w = s.warnings[0]
  const wx = s.pub.feed.weather
  const recent = (kind: string, ms: number) => s.ledger.some((e) => e.kind === kind && s.sig.t - e.t >= 0 && s.sig.t - e.t < ms)
  const hour = new Date(s.sig.t).getHours()
  return {
    rain: driving ? 0 : wx.pty > 0 || s.sig.raining ? 2 : wx.rainInMin !== undefined && wx.rainInMin <= 60 ? 1 : 0,
    locked: recent('theftZone', 20_000),
    frost: recent('accidentZone', 90_000) && s.ledger.find((e) => e.kind === 'accidentZone')?.title.includes('결빙'),
    sun: !driving && hour >= 10 && hour <= 17 && ((s.sig.outsideTempC ?? 20) >= 28 || wx.uv >= 8),
    part,
    partLabel: part && w ? `${w.name} · 방치하면 차 값 −2%` : undefined,
    flood:
      !driving && m && floodF && m.level === '위험'
        ? {
            level: m.level === '위험' ? 1 : 0.3,
            center: m.here,
            target: m.best ? { lat: m.best.lat, lng: m.best.lng, name: m.best.name } : undefined,
            tiles: (s.pub.feed.overlays ?? []).filter((o) => o.layer === 'flood'),
          }
        : undefined,
    newCar: sheet === 'tradeUp' || s.suggestion?.kind === 'tradeUp',
    passport: null,
    windowsOpen: s.sig.windowsOpen ?? 0,
    headlights: Boolean(s.sig.headlightsOn),
    charging: s.mode === 'charging' && s.sig.chargeState === 'charging',
    socPct: s.sig.socPct ?? 70,
    chargeLimitPct: s.sig.chargeLimitPct ?? 100,
    blindClosed: Boolean(s.sig.blindClosed) || recent('sunBlind', 6 * 3600e3),
    sohPct: s.battery.soh,
    xray: xray || s.mode === 'charging',
    tyreWarning: s.warnings.some((w) => w.type === 'TPMS'),
  }
}

export function CarApp({ portrait }: { portrait?: boolean }) {
  const snap = useStore((s) => s.snap)
  const sheet = useStore((s) => s.sheet)
  const theme = useTheme(snap)
  if (!snap) {
    return (
      <div className="jg-app jg-boot" data-theme={theme}>
        <Logo size={120} />
      </div>
    )
  }
  return (
    <div className={`jg-app mode-${snap.mode} ${portrait ? 'is-portrait' : ''}`} data-theme={theme}>
      <Scene snap={snap} theme={theme} portrait={portrait} />
      <Header snap={snap} />
      {snap.mode === 'driving' ? <DriveView snap={snap} theme={theme} /> : <HomeView snap={snap} theme={theme} portrait={portrait} />}
      {snap.suggestion && !sheet && <SuggestionBar snap={snap} />}
      {!sheet && !snap.suggestion && <Caption />}
    </div>
  )
}

function Header({ snap }: { snap: Snapshot }) {
  const enabled = useVoice((s) => s.enabled)
  const [menu, setMenu] = useState(false)
  return (
    <header className="jg-head">
      <div className="jg-brand">
        <Logo size={46} />
        <span>밸류링크</span>
      </div>
      <div className="jg-head-r">
        <button className={`jg-toggle ${enabled ? 'on' : ''}`} onClick={() => useVoice.getState().setEnabled(!enabled)}>
          {enabled ? '음성 켜짐' : '음성 꺼짐'}
        </button>
        <span className="jg-clock num">{clock(snap.sig.t)}</span>
        {isNative() && (
          <button className="jg-more" onClick={() => setMenu(!menu)} aria-label="더보기">
            ···
          </button>
        )}
        {menu && (
          <div className="jg-menu" onClick={() => setMenu(false)}>
            <button onClick={() => useStore.getState().loadDemoHistory()}>시연용 이력 불러오기</button>
            <button onClick={() => useStore.getState().previewTradeUp()}>교체 시점 미리보기</button>
            <button onClick={() => useStore.getState().runtime?.publicScenario('rainSoon')}>공공데이터: 30분 뒤 비 예보</button>
            <button onClick={() => useStore.getState().runtime?.publicScenario('heavyRain')}>공공데이터: 호우경보 발령</button>
            <button onClick={() => useStore.getState().runtime?.publicScenario('clear')}>공공데이터: 특보 해제</button>
            <button onClick={() => useStore.getState().setCarTheme(useStore.getState().carTheme === 'dark' ? 'light' : 'dark')}>화면 테마 전환</button>
          </div>
        )}
      </div>
    </header>
  )
}

/**
 * The car is the page: a full-bleed studio scene behind everything. It turns slowly while parked and
 * freezes into a still frame while driving (no motion in the driver's field of view).
 */
function Scene({ snap, theme, portrait }: { snap: Snapshot; theme: 'light' | 'dark'; portrait?: boolean }) {
  const sheet = useStore((s) => s.sheet)
  const car = useMemo(() => carStateOf(snap, false, sheet), [snap, sheet])
  // the asset report opens as a side panel; the vehicle passport takes the car's place on the left
  const report = sheet === 'trade' && !portrait
  const driving = snap.mode === 'driving'
  // fixed-look events play their pre-rendered clip once, over the real-time car
  const prev = useRef(car)
  const [clip, setClip] = useState<ClipName | null>(null)
  const [clipOn, setClipOn] = useState(false)
  useEffect(() => {
    const c = driving ? null : clipFor(prev.current, car)
    prev.current = car
    if (c) setClip(c)
  }, [car, driving])
  const distance = portrait ? 17 : report ? 22 : 15.5
  const shiftX = portrait ? 0 : driving ? 0.16 : report ? -0.25 : -0.13
  const shiftY = portrait ? 0.02 : 0.13
  return (
    <div className="jg-scene">
      <div className={`cv-live ${clipOn || report ? 'hide' : ''}`}>
      <Suspense fallback={null}>
        <StudioCar
          state={car}
          theme={theme}
          still={driving}
          lowPower={isNative()}
          autoRotate={!driving && !report}
          interactive={!driving}
          azimuth={driving ? 14 : report ? 34 : 0}
          distance={distance}
          shiftX={shiftX}
          shiftY={shiftY}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
      </div>
      <ClipLayer clip={clip} theme={theme} framing={{ distance, shiftX, shiftY }} onPlaying={setClipOn} onEnded={() => setClip(null)} />
      {report && (
        <div className="jg-ppcard">
          <PassportCard data={passportDataOf(snap)} />
        </div>
      )}
    </div>
  )
}

// ---- parked / charging -------------------------------------------------------------------------------

function HomeView({ snap, theme, portrait }: { snap: Snapshot; theme: 'light' | 'dark'; portrait?: boolean }) {
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)
  void theme
  void portrait
  return (
    <main className="jg-home">
      <section className="jg-hero">
        <div className="jg-hero-copy">
          <p className="jg-label">내 차의 자산 가치</p>
          <button className="jg-value num" onClick={() => setSheet('value')}>
            {manwon(snap.value.value)}
          </button>
          <p className="jg-kept">
            이번 달 지켜낸 가치 <b className="num">+{won(snap.protectedMonth)}</b>
          </p>
          <p className="jg-model">
            {snap.sig.modelYear} {snap.model.name} · <span className="num">{Math.round(snap.sig.odometerKm ?? 0).toLocaleString()}km</span> · 출고 {snap.ageYears.toFixed(1)}년
          </p>
          <div className="jg-linkrow">
            {snap.pub.map && (
              <span className={`risk lv-${snap.pub.map.level}`} onClick={() => setSheet('map')}>
                <i /> 주차 안전 <b className="num">{snap.pub.map.score}</b> {snap.pub.map.level}
              </span>
            )}
            {snap.links.tradeUp.due ? (
              <span className="due" onClick={() => setSheet('tradeUp')}>
                교체 최적 시점 <b>지금</b>
              </span>
            ) : (
              snap.links.cpo.eligible && (
                <span>
                  인증중고차 기준까지 <b className="num">{Math.floor(snap.links.cpo.monthsLeft / 12)}년 {snap.links.cpo.monthsLeft % 12}개월</b>
                </span>
              )
            )}
          </div>
        </div>
      </section>

      <section className="jg-side">
        <BatteryCard snap={snap} />
        <GuardCard snap={snap} portrait={portrait} />
      </section>

      <section className="jg-passport glass" onClick={() => setSheet('trade')}>
        <div>
          <p className="jg-label">차량 여권</p>
          <p className="jg-pp">
            <b className="num">{snap.passport.days.toLocaleString()}일</b> 연속 기록{' '}
            {snap.passport.chainOk && snap.passport.mileageOk ? <span className="ok" aria-label="무결성 확인" /> : <span className="warn">검증 필요</span>}
          </p>
        </div>
        <span className="pill primary">자산 가치 리포트</span>
      </section>

      {sheet && <Sheet snap={snap} kind={sheet} onClose={() => setSheet(null)} />}
    </main>
  )
}

function BatteryCard({ snap }: { snap: Snapshot }) {
  const b = snap.battery
  const rt = useStore((s) => s.runtime)
  const limit = snap.sig.chargeLimitPct ?? 100
  const diff = b.soh - b.expected
  const charging = snap.sig.chargeState === 'charging'
  return (
    <div className="glass jg-batt">
      <div className="jg-batt-top">
        <Ring value={b.soh} />
        <div>
          <p className="jg-label">
            배터리 건강도
          </p>
          <p className="jg-batt-big num">{b.soh.toFixed(1)}%</p>
          <p className="jg-sub">
            같은 연식 평균 <span className="num">{b.expected.toFixed(1)}%</span>보다{' '}
            <b className={diff >= 0 ? 'up' : 'down'}>
              {diff >= 0 ? '+' : ''}
              {diff.toFixed(1)}%p
            </b>
          </p>
        </div>
      </div>
      <div className="jg-soc">
        <div className="jg-soc-bar">
          <i style={{ width: `${snap.sig.socPct ?? 0}%` }} className={charging ? 'charging' : ''} />
          <em style={{ left: `${limit}%` }} />
        </div>
        <div className="jg-soc-row">
          <span className="num">
            {Math.round(snap.sig.socPct ?? 0)}% · {Math.round(snap.sig.rangeKm ?? 0)}km
            {charging && snap.sig.chargeKw ? ` · ${snap.sig.chargeKw.toFixed(1)}kW` : ''}
          </span>
          <div className="jg-seg" role="group" aria-label="충전 상한">
            {[80, 90, 100].map((p) => (
              <button key={p} className={Math.round(limit) === p ? 'on' : ''} onClick={() => void rt?.setChargeLimit(p)}>
                {p}%
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Ring({ value }: { value: number }) {
  const r = 54
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, (value - 80) / 20))
  return (
    <svg className="jg-ring" width={136} height={136} viewBox="0 0 136 136">
      <circle cx="68" cy="68" r={r} className="track" />
      <circle cx="68" cy="68" r={r} className="val" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 68 68)" />
    </svg>
  )
}

function GuardCard({ snap, portrait }: { snap: Snapshot; portrait?: boolean }) {
  const items = snap.ledger.slice(0, portrait ? 2 : 3)
  return (
    <div className="glass jg-guard">
      <div className="jg-guard-head">
        <p className="jg-label">밸류링크가 지켜낸 가치</p>
        <span className="num">누적 +{won(snap.protectedTotal)}</span>
      </div>
      {items.length === 0 && <p className="jg-sub">아직 기록이 없어요. 주행과 충전을 하면 차가 알아서 지켜요.</p>}
      <ul>
        {items.map((e) => (
          <GuardRow key={e.id} e={e} now={snap.sig.t} />
        ))}
      </ul>
    </div>
  )
}

function GuardRow({ e, now }: { e: LedgerEntry; now: number }) {
  return (
    <li className={e.auto ? 'auto' : ''}>
      <div>
        <b>{e.title}</b>
        <span>
          {ago(e.t, now)}
        </span>
      </div>
      {e.won > 0 && <em className="num">+{won(e.won)}</em>}
    </li>
  )
}

function Sheet({ snap, kind, onClose }: { snap: Snapshot; kind: SheetKind; onClose: () => void }) {
  if (kind === 'tradeUp') return <TradeUpSheet snap={snap} onClose={onClose} />
  if (kind === 'map') return <ValueMapSheet snap={snap} onClose={onClose} />
  const side = kind === 'trade'
  return (
    <div className={`jg-sheet-bg ${side ? 'side' : ''}`} onClick={onClose}>
      <div className={`jg-sheet glass solid ${side ? 'side' : ''}`} onClick={(e) => e.stopPropagation()}>
        {kind === 'trade' && snap.tradeIn ? (
          <ReportSheet snap={snap} />        ) : (
          <>
            <p className="jg-label">가치는 이렇게 계산돼요</p>
            <ul className="jg-sheet-list">
              <li>
                신차 기준가 <b className="num">{manwon(snap.value.base)}</b>
              </li>
              {snap.value.factors.map((f) => (
                <li key={f.key}>
                  {f.label}
                  <small>{f.note}</small>
                  <b className={`num ${f.won >= 0 ? 'up' : 'down'}`}>
                    {f.won >= 0 ? '+' : ''}
                    {manwon(f.won)}
                  </b>
                </li>
              ))}
            </ul>
            <p className="jg-fine">기준가·계수는 가정값이에요.</p>
          </>
        )}
        <button className="pill secondary" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  )
}

/**
 * 자산 가치 리포트: the "Link" in ValueLink. The car's own record, linked to four Hyundai Motor Group services.
 * Partnership figures (price window, discounts, points, rate) are proposal-scenario assumptions.
 */
function ReportSheet({ snap }: { snap: Snapshot }) {
  const L = snap.links
  const ym = (t: number) => `${new Date(t).getFullYear()}년 ${new Date(t).getMonth() + 1}월`
  const years = Math.floor(L.cpo.monthsLeft / 12)
  const months = L.cpo.monthsLeft % 12
  return (
    <>
      <div className="jg-report-head">
        <div>
          <p className="jg-label">자산 가치 리포트</p>
          <p className="jg-value num">{manwon(snap.tradeIn!.price)}</p>
          <p className="jg-sub">
            현대 인증중고차 예상 매입가 · 여권 우대 <b>+{(snap.tradeIn!.premium * 100).toFixed(0)}%</b>
          </p>
        </div>
        <div className="jg-care">
          <span className="num">{L.careScore}</span>
          <small>관리 점수</small>
        </div>
      </div>
      <div className="jg-rows">
        <div>
          <span>현대 인증중고차 매입 기준까지</span>
          <b className="num">{L.cpo.eligible ? `${years ? `${years}년 ` : ''}${months}개월` : '기준 밖'}</b>
        </div>
        <div className="tap" onClick={() => useStore.getState().setSheet('tradeUp')}>
          <span>권장 교체 시점</span>
          <b>{ym(L.tradeUp.when)} ›</b>
        </div>
        <div>
          <span>현대캐피탈 관리 등급</span>
          <b>{L.capital.tier}</b>
        </div>
        <div>
          <span>블루멤버스 퀘스트</span>
          <b className="num">
            {L.quests.filter((q) => q.done).length}/{L.quests.length}
          </b>
        </div>
      </div>
      <p className="jg-fine">매입가·할인·금리는 제휴 시나리오 가정값이에요.</p>
    </>
  )
}

/** 새 차로 잇기: the passport price becomes the down payment for the next Hyundai, financed by Hyundai Capital. */
function TradeUpSheet({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const tu = snap.links.tradeUp
  const o = tu.offer
  const rt = useStore((s) => s.runtime)
  return (
    <div className="jg-sheet-bg" onClick={onClose}>
      <div className="jg-sheet glass solid" onClick={(e) => e.stopPropagation()}>
        <p className="jg-label">새 차로 잇기</p>
        <p className="jg-tu-model">{o.model}</p>
        <div className="jg-tu">
          <div>
            <small>신차</small>
            <b className="num">{manwon(o.newPrice)}</b>
          </div>
          <span>−</span>
          <div>
            <small>내 차</small>
            <b className="num">{manwon(o.tradeIn)}</b>
          </div>
          {o.subsidy > 0 && (
            <>
              <span>−</span>
              <div>
                <small>보조금</small>
                <b className="num">{manwon(o.subsidy)}</b>
              </div>
            </>
          )}
          <span>−</span>
          <div>
            <small>할인</small>
            <b className="num">{manwon(o.discount)}</b>
          </div>
          <span>=</span>
          <div className="net">
            <small>실 부담</small>
            <b className="num">{manwon(o.net)}</b>
          </div>
        </div>
        <div className="jg-tu-capital">
          <div>
            <small>현대캐피탈 {o.months}개월 · {o.ratePct}%</small>
            <b className="num">월 {Math.round(o.monthly).toLocaleString()}만원</b>
          </div>
        </div>
        {tu.timing.subsidyRemaining !== undefined && (
          <p className="jg-sub">
            {tu.timing.region?.replace('특별시', '')} 보조금 {tu.timing.subsidyRemaining.toLocaleString()}대 남음{tu.timing.policy ? ` · 개소세 인하 ${tu.timing.policy.daysLeft}일 남음` : ''}
          </p>
        )}
        <p className="jg-fine">매입가·보조금·할인·금리는 가정값이에요.</p>
        <div className="jg-tu-act">
          <button className="pill secondary" onClick={onClose}>
            나중에
          </button>
          <button
            className="pill primary"
            onClick={() => {
              void rt?.findShowroom()
              onClose()
            }}
          >
            가까운 현대 지점 찾기
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- driving -------------------------------------------------------------------------------------------

function DriveView({ snap }: { snap: Snapshot; theme: 'light' | 'dark' }) {
  const h = snap.habits
  const today = snap.ledger.filter((e) => new Date(e.t).toDateString() === new Date(snap.sig.t).toDateString()).reduce((a, e) => a + e.won, 0)
  return (
    <main className="jg-drive">
      <section className="jg-score">
        <p className="jg-label">차 아끼는 운전</p>
        <p className="jg-score-big num">{h.score}</p>
        <p className="jg-sub">
          100km당 급가속 <b className="num">{h.harshAccelPer100.toFixed(1)}</b> · 급제동 <b className="num">{h.harshBrakePer100.toFixed(1)}</b>
        </p>
      </section>
      <section className="glass jg-today">
        <p className="jg-label">오늘 지킨 가치</p>
        <p className="jg-today-big num">+{won(today)}</p>
        <p className="jg-sub">
          {activeRouteKm(snap.sig) !== undefined ? `목적지까지 ${Math.round(snap.sig.routeRemainingKm!)}km · ` : ''}배터리 {Math.round(snap.sig.socPct ?? 0)}%
        </p>
      </section>
    </main>
  )
}

function SuggestionBar({ snap }: { snap: Snapshot }) {
  const rt = useStore((s) => s.runtime)
  const s = snap.suggestion!
  return (
    <div className="jg-suggest glass">
      <div>
        <b>{s.title}</b>
        <span>{s.detail}</span>
      </div>
      <div className="jg-suggest-act">
        <button className="pill secondary" onClick={() => rt?.dismiss()}>
          나중에
        </button>
        {s.cta && (
          <button
            className="pill primary"
            onClick={() => {
              if (s.cta?.sheet) {
                useStore.getState().setSheet(s.cta.sheet as SheetKind)
                rt?.dismiss()
              } else void rt?.accept()
            }}
          >
            {s.cta.label}
          </button>
        )}
      </div>
    </div>
  )
}

function Caption({ raised }: { raised?: boolean }) {
  const caption = useVoice((s) => s.caption)
  if (!caption) return null
  return <div className={`jg-caption ${raised ? 'raised' : ''}`}>{caption}</div>
}
