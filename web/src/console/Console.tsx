// Mission Control: the judges' console. One screen shows the in-car app, the car itself (3D twin) doing
// what the app decided, the exact Pleos SDK calls, and the money: value over the next three years with the
// driver's habits vs an average driver's.

import { lazy, Suspense, useEffect, useMemo } from 'react'
import { useStore } from '../state/store'
import { CarFrame, carStateOf } from '../car/CarApp'
import { manwon, won } from '../engine/valuation'
import { clock } from '../ui/format'
import { Logo } from '../ui/icons'
import type { Snapshot } from '../engine/runtime'
import './console.css'

const StudioCar = lazy(() => import('../three/StudioCar'))

const SPEEDS = [30, 60, 180, 600]

export default function Console() {
  const boot = useStore((s) => s.boot)
  const snap = useStore((s) => s.snap)
  const sim = useStore((s) => s.sim)
  const playing = useStore((s) => s.playing)
  const timeScale = useStore((s) => s.timeScale)
  useEffect(() => {
    boot()
    useStore.getState().setPlaying(true)
  }, [boot])
  if (!snap || !sim) return <div className="mc-boot"><Logo size={48} /></div>
  const minutes = sim.minutes()
  return (
    <div className="mc">
      <header className="mc-top">
        <a href="#/" className="mc-brand">
          <Logo size={22} /> 밸류링크 <span>Mission Control</span>
        </a>
        <div className="mc-transport">
          <button className="pill secondary" onClick={() => useStore.getState().setPlaying(!playing)}>
            {playing ? '일시정지' : '재생'}
          </button>
          <div className="mc-seg">
            {SPEEDS.map((s) => (
              <button key={s} className={timeScale === s ? 'on' : ''} onClick={() => useStore.getState().setTimeScale(s)}>
                {s}×
              </button>
            ))}
          </div>
          <button className="pill secondary" onClick={() => useStore.getState().restart()}>
            처음부터
          </button>
          <span className="mc-clock num">{clock(snap.sig.t)}</span>
        </div>
        <nav className="mc-links">
          <a href="#/car">차량 앱 단독</a>
          <a href="#/passport">차량 여권</a>
          <a href="#/fleet">플릿</a>
        </nav>
      </header>

      <section className="mc-timeline">
        {sim.marks.map((m) => (
          <button
            key={m.at}
            className={`mc-mark ${minutes >= m.at ? 'done' : ''}`}
            onClick={() => {
              sim.jumpTo(m.at)
              useStore.getState().runtime?.tick(1000)
            }}
          >
            <i />
            <span>{m.label}</span>
          </button>
        ))}
      </section>

      <main className="mc-grid">
        <section className="mc-ivi">
          <div className="mc-ivi-bezel">
            <CarFrame />
          </div>
          <p className="mc-cap">Pleos Connect 차량 앱 (1700 × 1212 dp)</p>
        </section>

        <section className="mc-twin">
          <Twin snap={snap} />
          <Triggers />
        </section>

        <section className="mc-panels">
          <ValueChart snap={snap} />
          <SdkLog snap={snap} />
        </section>
      </main>
    </div>
  )
}

function Twin({ snap }: { snap: Snapshot }) {
  const car = useMemo(() => carStateOf(snap), [snap])
  const s = snap.sig
  return (
    <div className="mc-stage">
      <Suspense fallback={null}>
        <StudioCar state={car} theme="dark" autoRotate interactive distance={10.5} shiftY={0.04} style={{ width: '100%', height: '100%' }} />
      </Suspense>
      <div className="mc-stage-hud">
        <span>{s.gear === 'P' ? '주차' : `${Math.round(s.speedKph)} km/h`}</span>
        <span>창문 {s.windowsOpen ? `${s.windowsOpen}개 열림` : '닫힘'}</span>
        <span>전조등 {s.headlightsOn ? '켜짐' : '꺼짐'}</span>
        <span>충전 {s.plugged ? `${Math.round(s.socPct ?? 0)}% → ${s.chargeLimitPct}%` : '안 함'}</span>
        {s.raining && <span>비</span>}
        {snap.warnings.map((w) => (
          <span key={w.type} className="warn">
            {w.name}
          </span>
        ))}
      </div>
      {s.navScreen && <div className="mc-navi">내비 화면 · {s.navScreen}</div>}
    </div>
  )
}

/** Events a judge can cause at any time. */
function Triggers() {
  const sim = useStore((s) => s.sim)!
  const rt = useStore((s) => s.runtime)
  const t = (fn: () => void) => () => {
    fn()
    rt?.tick(1000)
  }
  return (
    <div className="mc-triggers">
      <button onClick={t(() => sim.park(sim.sig.placeName ?? '주차장'))}>주차</button>
      <button onClick={t(() => sim.drive({ name: '목적지', km: 12, cruiseKph: 48 }))}>주행 시작</button>
      <button onClick={t(() => sim.harsh(2))}>급출발 2회</button>
      <button onClick={t(() => ((sim.sig.windowsOpen = 2), (sim.sig.raining = true)))}>비 + 창문 열림</button>
      <button onClick={t(() => (sim.sig.headlightsOn = true))}>전조등 켠 채 주차</button>
      <button onClick={t(() => sim.setWarning('LOW_VOLT_BATTERY', true))}>12V 배터리 경고등</button>
      <button onClick={t(() => sim.setWarning('LOW_VOLT_BATTERY', false))}>경고등 해결</button>
      <button
        onClick={t(() => {
          sim.sig.chargeLimitPct = 100
          sim.plugIn(7)
        })}
      >
        완속 충전 (상한 100%)
      </button>
      <button onClick={t(() => ((sim.sig.routeRemainingKm = 395), (sim.sig.navStatus = 'ROUTE_READY')))}>부산 395km 목적지</button>
      <button onClick={t(() => sim.unplug())}>충전기 분리</button>
      <button
        onClick={t(() => {
          Object.assign(sim.sig, { outsideTempC: -4, fastChargePlanned: true, plannedChargeKw: 240, plannedChargeKm: 38, batteryConditioning: false })
          sim.drive({ name: '이핏 급속충전소', km: 38, cruiseKph: 80 })
        })}
      >
        겨울 급속충전 경로
      </button>
    </div>
  )
}

function ValueChart({ snap }: { snap: Snapshot }) {
  const pts = snap.projection
  const W = 520
  const H = 200
  const lo = Math.min(...pts.map((p) => Math.min(p.mine, p.average))) * 0.98
  const hi = Math.max(...pts.map((p) => Math.max(p.mine, p.average))) * 1.01
  const x = (m: number) => 16 + (m / 36) * (W - 32)
  const y = (v: number) => 12 + (1 - (v - lo) / (hi - lo)) * (H - 36)
  const line = (k: 'mine' | 'average') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
  const gap = pts.at(-1)!.mine - pts.at(-1)!.average
  return (
    <div className="mc-card">
      <div className="mc-card-head">
        <h3>3년 뒤 내 차의 가치</h3>
        <span>
          평균 운전자보다 <b className="num">{gap >= 0 ? '+' : ''}{manwon(gap)}</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mc-chart" role="img" aria-label="3년 가치 예측">
        <path d={line('average')} className="avg" />
        <path d={line('mine')} className="mine" />
        <circle cx={x(36)} cy={y(pts.at(-1)!.mine)} r="4" className="dot" />
        <text x={x(36) - 4} y={y(pts.at(-1)!.mine) - 10} textAnchor="end" className="lbl">
          내 습관 {manwon(pts.at(-1)!.mine)}
        </text>
        <text x={x(36) - 4} y={y(pts.at(-1)!.average) + 18} textAnchor="end" className="lbl dim">
          평균 운전자 {manwon(pts.at(-1)!.average)}
        </text>
        <text x={16} y={H - 4} className="ax">지금</text>
        <text x={W - 16} y={H - 4} textAnchor="end" className="ax">36개월</text>
      </svg>
      <div className="mc-kpis">
        <div>
          <small>지금 가치</small>
          <b className="num">{manwon(snap.value.value)}</b>
        </div>
        <div>
          <small>이번 달 지켜낸 가치</small>
          <b className="num">+{won(snap.protectedMonth)}</b>
        </div>
        <div>
          <small>배터리 건강도</small>
          <b className="num">{snap.battery.soh.toFixed(1)}%</b>
        </div>
        <div>
          <small>연간 열화 (내 습관 / 평균)</small>
          <b className="num">
            {snap.battery.fadeMine.toFixed(1)} / {snap.battery.fadeAverage.toFixed(1)}%p
          </b>
        </div>
      </div>
    </div>
  )
}

function SdkLog({ snap }: { snap: Snapshot }) {
  return (
    <div className="mc-card mc-log">
      <div className="mc-card-head">
        <h3>밸류링크가 한 일 · Pleos SDK 호출</h3>
        <span>누적 +{won(snap.protectedTotal)}</span>
      </div>
      <ul>
        {snap.ledger.slice(0, 7).map((e) => (
          <li key={e.id}>
            <div className="mc-log-top">
              <time className="num">{clock(e.t)}</time>
              <b>{e.title}</b>
              {e.won > 0 && <em className="num">+{won(e.won)}</em>}
            </div>
            {e.sdk.map((c) => (
              <code key={c}>{c}</code>
            ))}
            <small>{e.basis}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
