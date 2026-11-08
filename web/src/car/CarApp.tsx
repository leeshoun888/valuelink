// The in-vehicle app (what runs in the Pleos Connect window). Apple-like restraint: one big number, a
// living object, short sentences. While driving it collapses to a glanceable, motion-free card
// (Pleos driver-distraction guideline); the 3D car rotates only while parked.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useVoice } from '../voice/voice'
import type { Snapshot } from '../engine/runtime'
import { manwon, won } from '../engine/valuation'
import type { LedgerEntry } from '../engine/guard'
import { ago, clock } from '../ui/format'
import { Logo } from '../ui/icons'
import { isNative } from '../engine/native'
import type { CarState } from '../three/StudioCar'
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

export function carStateOf(s: Snapshot, xray = false): CarState {
  return {
    windowsOpen: s.sig.windowsOpen ?? 0,
    headlights: Boolean(s.sig.headlightsOn),
    charging: s.mode === 'charging' && s.sig.chargeState === 'charging',
    socPct: s.sig.socPct ?? 70,
    chargeLimitPct: s.sig.chargeLimitPct ?? 100,
    blindClosed: Boolean(s.sig.blindClosed),
    sohPct: s.battery.soh,
    xray: xray || s.mode === 'charging',
    tyreWarning: s.warnings.some((w) => w.type === 'TPMS'),
  }
}

export function CarApp({ portrait }: { portrait?: boolean }) {
  const snap = useStore((s) => s.snap)
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
      {snap.suggestion && <SuggestionBar snap={snap} />}
      <Caption />
    </div>
  )
}

function Header({ snap }: { snap: Snapshot }) {
  const enabled = useVoice((s) => s.enabled)
  const [menu, setMenu] = useState(false)
  const live = snap.caps.source === 'pleos'
  const status = snap.mode === 'driving' ? '주행 중' : snap.mode === 'charging' ? (snap.sig.chargeState === 'charging' ? '충전 중' : '충전 대기') : '주차 중'
  return (
    <header className="jg-head">
      <div className="jg-brand">
        <Logo size={46} />
        <span>제값</span>
        <em className={live ? 'live' : ''}>
          <i />
          {live ? 'Pleos 차량 연결' : '시뮬레이션'} · {status}
        </em>
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
  const car = useMemo(() => carStateOf(snap), [snap])
  const driving = snap.mode === 'driving'
  return (
    <div className="jg-scene">
      <Suspense fallback={null}>
        <StudioCar
          state={car}
          theme={theme}
          still={driving}
          autoRotate={!driving}
          interactive={!driving}
          azimuth={driving ? 14 : 0}
          distance={portrait ? 17 : 15.5}
          shiftX={portrait ? 0 : driving ? 0.16 : -0.13}
          shiftY={portrait ? 0.02 : 0.13}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
    </div>
  )
}

// ---- parked / charging -------------------------------------------------------------------------------

function HomeView({ snap, theme, portrait }: { snap: Snapshot; theme: 'light' | 'dark'; portrait?: boolean }) {
  const [sheet, setSheet] = useState<'trade' | 'value' | null>(null)
  void theme
  void portrait
  return (
    <main className="jg-home">
      <section className="jg-hero">
        <div className="jg-hero-copy">
          <p className="jg-label">내 차의 지금 가치</p>
          <button className="jg-value num" onClick={() => setSheet('value')}>
            {manwon(snap.value.value)}
          </button>
          <p className="jg-kept">
            이번 달 지킨 가치 <b className="num">+{won(snap.protectedMonth)}</b>
          </p>
          <p className="jg-model">
            {snap.sig.modelYear} {snap.model.name} · <span className="num">{Math.round(snap.sig.odometerKm ?? 0).toLocaleString()}km</span> · 출고 {snap.ageYears.toFixed(1)}년
          </p>
          <div className="jg-factors">
            {snap.value.factors
              .filter((f) => f.key !== 'age' && Math.abs(f.effect) > 0.0005)
              .map((f) => (
                <span key={f.key} className={f.effect >= 0 ? 'up' : 'down'}>
                  {f.label} <b className="num">{f.effect >= 0 ? '+' : ''}{(f.effect * 100).toFixed(1)}%</b>
                </span>
              ))}
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
            <b className="num">{snap.passport.days.toLocaleString()}일</b> 연속 기록 ·{' '}
            {snap.passport.chainOk && snap.passport.mileageOk ? <span className="ok">주행거리·이력 무결성 확인</span> : <span className="warn">검증 필요</span>}
          </p>
        </div>
        <span className="pill primary">보상판매 견적 보기</span>
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
            배터리 건강도 <span className="tag">{b.sohSource === 'car' ? '차량 실측' : '추정'}</span>
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
      <p className="jg-fine">
        내 습관 기준 연간 열화 <b className="num">{b.fadeMine.toFixed(1)}%p</b> · 평균 운전자 <span className="num">{b.fadeAverage.toFixed(1)}%p</span>
      </p>
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
        <p className="jg-label">제값이 지킨 일</p>
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
          {ago(e.t, now)} · {e.auto ? '차가 직접 실행' : '안내'}
        </span>
      </div>
      {e.won > 0 && <em className="num">+{won(e.won)}</em>}
    </li>
  )
}

function Sheet({ snap, kind, onClose }: { snap: Snapshot; kind: 'trade' | 'value'; onClose: () => void }) {
  return (
    <div className="jg-sheet-bg" onClick={onClose}>
      <div className="jg-sheet glass solid" onClick={(e) => e.stopPropagation()}>
        {kind === 'trade' && snap.tradeIn ? (
          <>
            <p className="jg-label">현대 인증중고차 보상판매 예상 매입가</p>
            <p className="jg-value num">{manwon(snap.tradeIn.price)}</p>
            <p className="jg-sub">
              차량 여권 검증 우대 <b className="up">+{(snap.tradeIn.premium * 100).toFixed(0)}%</b> 포함 · {snap.tradeIn.validDays}일간 유효 (제휴 시나리오)
            </p>
            <ul className="jg-sheet-list">
              <li>
                주행거리 무결성 <b>{snap.passport.mileageOk ? '확인' : '확인 필요'}</b>
              </li>
              <li>
                에어백 전개 이력 <b>{snap.sig.airbagDeployed ? '있음' : snap.sig.airbagDeployed === false ? '없음' : '실차에서 확인'}</b>
              </li>
              <li>
                배터리 건강도 <b className="num">{snap.battery.soh.toFixed(1)}% (차량 실측)</b>
              </li>
              <li>
                미해결 경고등 <b>{snap.warnings.length ? `${snap.warnings.length}개` : '없음'}</b>
              </li>
            </ul>
          </>
        ) : (
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
            <p className="jg-fine">기준가·감가 계수는 제값의 가정값이에요. 현대 인증중고차 거래 데이터와 연결되면 실거래 기반으로 바뀌어요.</p>
          </>
        )}
        <button className="pill secondary" onClick={onClose}>
          닫기
        </button>
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
          {snap.sig.routeRemainingKm !== undefined ? `목적지까지 ${Math.round(snap.sig.routeRemainingKm)}km · ` : ''}배터리 {Math.round(snap.sig.socPct ?? 0)}%
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
          <button className="pill primary" onClick={() => void rt?.accept()}>
            {s.cta.label}
          </button>
        )}
      </div>
    </div>
  )
}

function Caption() {
  const caption = useVoice((s) => s.caption)
  if (!caption) return null
  return <div className="jg-caption">{caption}</div>
}
