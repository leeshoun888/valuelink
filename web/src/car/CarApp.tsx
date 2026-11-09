// The in-vehicle app (what runs in the Pleos Connect window). Apple-like restraint: one big number, a
// living object, short sentences. While driving it collapses to a glanceable, motion-free card
// (Pleos driver-distraction guideline); the 3D car rotates only while parked.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useVoice } from '../voice/voice'
import type { Snapshot } from '../engine/runtime'
import { manwon, won } from '../engine/valuation'
import { activeRouteKm, type LedgerEntry } from '../engine/guard'
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
      {!sheet && <Caption raised={Boolean(snap.suggestion)} />}
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
        <span>밸류링크</span>
        <em className={live ? 'live' : ''}>
          <i />
          {live ? 'Pleos 차량 연결' : '시뮬레이션'} · {status}
          {useStore.getState().runtime?.ageOffsetYears ? ' · 교체 시점 미리보기' : ''}
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
            <button onClick={() => useStore.getState().previewTradeUp()}>교체 시점 미리보기</button>
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
          lowPower={isNative()}
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
            <span>
              관리 점수 <b className="num">{snap.links.careScore}</b>
            </span>
            <span>
              블루멤버스 퀘스트 <b className="num">{snap.links.quests.filter((q) => q.done).length}/{snap.links.quests.length}</b>
            </span>
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
          {ago(e.t, now)} · {e.auto ? '차가 직접 실행' : '안내'}
        </span>
      </div>
      {e.won > 0 && <em className="num">+{won(e.won)}</em>}
    </li>
  )
}

function Sheet({ snap, kind, onClose }: { snap: Snapshot; kind: 'trade' | 'value' | 'tradeUp'; onClose: () => void }) {
  if (kind === 'tradeUp') return <TradeUpSheet snap={snap} onClose={onClose} />
  return (
    <div className="jg-sheet-bg" onClick={onClose}>
      <div className="jg-sheet glass solid" onClick={(e) => e.stopPropagation()}>
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
            <p className="jg-fine">기준가·가치 계수는 밸류링크의 가정값이에요. 현대 인증중고차 거래 데이터와 연결되면 실거래 기반으로 바뀌어요.</p>
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
            현대 인증중고차 예상 매입가 · 여권 검증 우대 <b>+{(snap.tradeIn!.premium * 100).toFixed(0)}%</b> · {snap.tradeIn!.validDays}일 보장
          </p>
        </div>
        <div className="jg-care">
          <span className="num">{L.careScore}</span>
          <small>관리 점수</small>
        </div>
      </div>
      <div className="jg-links">
        <section>
          <h4>현대 인증중고차</h4>
          <p>{L.cpo.eligible ? `매입 기준까지 ${years ? `${years}년 ` : ''}${months}개월 · ${L.cpo.kmLeft.toLocaleString()}km 남음` : '매입 기준(5년·10만km·무사고) 밖'}</p>
          <small>주행거리 무결성 {snap.passport.mileageOk ? '✓' : '확인 필요'} · 에어백 전개 {snap.sig.airbagDeployed ? '있음' : snap.sig.airbagDeployed === false ? '없음 ✓' : '실차 확인'} · SOH {snap.battery.soh.toFixed(1)}% 실측</small>
        </section>
        <section className="tap" onClick={() => useStore.getState().setSheet('tradeUp')}>
          <h4>신차 보상판매 ›</h4>
          <p>권장 교체 시점 {ym(L.tradeUp.when)}</p>
          <small>
            {L.tradeUp.reason}
            {L.tradeUp.loyaltyDiscount ? ` · 관리 우수 재구매 할인 ${L.tradeUp.loyaltyDiscount}만원` : ''}
          </small>
        </section>
        <section>
          <h4>블루멤버스 퀘스트</h4>
          <ul className="jg-quests">
            {L.quests.map((q) => (
              <li key={q.id} className={q.done ? 'done' : ''}>
                <span>{q.title}</span>
                <i style={{ width: `${(100 * q.progress) / q.target}%` }} />
                <b className="num">{q.points.toLocaleString()}P</b>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>현대캐피탈</h4>
          <p>관리 등급 {L.capital.tier}</p>
          <small>
            {L.capital.residualBonusPct ? `리스 반납 잔존가치 +${L.capital.residualBonusPct}%p · 재계약 금리 −${L.capital.rateCutPct}%p` : '관리 점수 70점부터 우대'}
          </small>
        </section>
      </div>
      <p className="jg-fine">매입가 보장·할인·포인트·금리는 현대차그룹 제휴를 전제로 한 출품 시나리오입니다. 여권은 차주가 동의할 때만 공유됩니다.</p>
    </>
  )
}

/** 새 차로 잇기: the passport price becomes the down payment for the next Hyundai, financed by Hyundai Capital. */
function TradeUpSheet({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const tu = snap.links.tradeUp
  const o = tu.offer
  const rt = useStore((s) => s.runtime)
  const ym = (t: number) => `${new Date(t).getFullYear()}년 ${new Date(t).getMonth() + 1}월`
  return (
    <div className="jg-sheet-bg" onClick={onClose}>
      <div className="jg-sheet glass solid" onClick={(e) => e.stopPropagation()}>
        <p className="jg-label">새 차로 잇기 · 권장 교체 시점 {ym(tu.when)}</p>
        <p className="jg-tu-model">{o.model}</p>
        <div className="jg-tu">
          <div>
            <small>신차 가격</small>
            <b className="num">{manwon(o.newPrice)}</b>
          </div>
          <span>−</span>
          <div>
            <small>내 차 매입가 (현대 인증중고차, 여권 우대)</small>
            <b className="num">{manwon(o.tradeIn)}</b>
          </div>
          <span>−</span>
          <div>
            <small>관리 우수 재구매 할인</small>
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
            <small>현대캐피탈 {o.months}개월 할부 · 관리 점수 우대 금리 {o.ratePct}%</small>
            <b className="num">월 {Math.round(o.monthly).toLocaleString()}만원</b>
          </div>
          <span>블루멤버스 {snap.links.pointsThisMonth.toLocaleString()}P 사용 가능</span>
        </div>
        <p className="jg-fine">{tu.reason}. 매입가·할인·금리는 현대차그룹 제휴를 전제로 한 출품 시나리오입니다.</p>
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
                useStore.getState().setSheet(s.cta.sheet)
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
