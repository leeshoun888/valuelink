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
          <PublicPanel snap={snap} />
          <LeadsPanel snap={snap} />
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
      <button onClick={t(() => sim.pub.setWeather({ pty: 0, rainInMin: 30, pop: 80 }))}>기상청: 30분 뒤 비 예보</button>
      <button onClick={t(() => (sim.pub.setWeather({ pty: 1, rainInMin: undefined, pop: 100, rain1hMm: 52 }), sim.pub.setAlert('호우경보', sim.sig.t)))}>기상청: 호우경보 발령</button>
      <button onClick={t(() => sim.pub.setAlert('우박', sim.sig.t))}>기상청: 우박 특보</button>
      <button onClick={t(() => sim.pub.clear())}>특보 해제</button>
      <button className="strong" onClick={t(() => useStore.getState().previewTradeUp())}>
        교체 시점 미리보기 (출고 4년 7개월)
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

/** Revenue opportunities ValueLink created for Hyundai Motor Group this month. */
function LeadsPanel({ snap }: { snap: Snapshot }) {
  const L = snap.leads
  return (
    <div className="mc-card">
      <div className="mc-card-head">
        <h3>현대차그룹으로 이은 매출 기회 · 이번 달</h3>
        <span>
          계약·이용 시 매출 규모 <b className="num">{L.monthManwon >= 1000 ? `${(L.monthManwon / 10000).toFixed(2)}억원` : `${Math.round(L.monthManwon).toLocaleString()}만원`}</b>
        </span>
      </div>
      <ul className="mc-leads">
        {L.month.map((c) => (
          <li key={c.channel}>
            <b>{c.channel}</b>
            <span className="num">{c.n}건</span>
          </li>
        ))}
        {L.month.length === 0 && <li>아직 없어요</li>}
      </ul>
      <ul className="mc-pub-calls">
        {L.list.slice(0, 4).map((l, i) => (
          <li key={i}>
            <time className="num">{new Date(l.t).toDateString() === new Date(snap.sig.t).toDateString() ? clock(l.t) : `${new Date(l.t).getMonth() + 1}/${new Date(l.t).getDate()}`}</time>
            <b>{l.channel}</b>
            <em>{l.title}</em>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Public data the car is reading right now, and the Value Map verdict for where it stands. */
function PublicPanel({ snap }: { snap: Snapshot }) {
  const m = snap.pub.map
  const f = snap.pub.feed
  const w = f.weather
  return (
    <div className="mc-card mc-pub">
      <div className="mc-card-head">
        <h3>공공데이터 × 밸류맵</h3>
        <span>
          {snap.pub.mode === 'live' ? '실시간' : '스냅샷'} · 기상청 격자 {f.grid.nx},{f.grid.ny}
        </span>
      </div>
      <div className="mc-pub-top">
        <div className={`mc-pub-score lv-${m?.level}`}>
          <b className="num">{m?.score ?? '-'}</b>
          <small>주차 안전 · {m?.level ?? '위치 없음'}</small>
        </div>
        <div className="mc-pub-wx">
          <span>{f.alerts.length ? f.alerts.map((a) => a.kind).join(' · ') : '특보 없음'}</span>
          <span>{w.pty > 0 ? `강수 ${w.rain1hMm}mm/h` : w.rainInMin !== undefined ? `${w.rainInMin}분 뒤 비 (${w.pop}%)` : `맑음 ${w.tempC}℃ · 자외선 ${w.uv}`}</span>
          <span>{m?.factors[0] ? `${m.factors[0].label} · 기대손실 ${won(m.expectedLoss)}` : '위험 요인 없음'}</span>
          {m?.best && <span className="best">추천: {m.best.name} {m.best.level} (−{won(m.best.saved)})</span>}
        </div>
      </div>
      <ul className="mc-pub-calls">
        {snap.pub.calls.slice(0, 5).map((c, i) => (
          <li key={i}>
            <time className="num">{clock(c.t)}</time>
            <b>{c.api}</b>
            <em>{c.result}</em>
          </li>
        ))}
      </ul>
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
