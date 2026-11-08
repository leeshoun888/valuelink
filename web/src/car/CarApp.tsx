// The in-vehicle app (what runs in the Pleos Connect window). Glanceable, voice-first,
// motion-restrained while driving (Pleos "Easy & Safe" / driver-distraction guideline).

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSim } from '../state/store'
import { useVoice, voice } from '../voice/voice'
import { AlertRing } from '../ui/AlertRing'
import { clock, co2Color, co2ColorDay, dur, kssColor, kssColorDay, LEVEL } from '../ui/format'
import {
  IcCheck,
  IcCoffee,
  IcFan,
  IcMic,
  IcMoon,
  IcPin,
  IcRecirc,
  IcSeat,
  IcSpeaker,
  IcSun,
  IcTemp,
  IcWind,
  Logo,
} from '../ui/icons'
import type { Snapshot } from '../engine/runtime'
import './car.css'

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
    <div ref={ref} className="car-frame">
      <div
        className={`car ${auto ? 'portrait' : 'landscape'}`}
        style={{ width: d.w, height: d.h, transform: `translate(-50%,-50%) scale(${s})` }}
      >
        <CarApp />
      </div>
    </div>
  )
}

/** Day / night: the vehicle's UI mode when running in the APK, otherwise the console setting (auto = sim clock). */
export function useTheme(snap: Snapshot | null): 'day' | 'night' {
  const pref = useSim((s) => s.carTheme)
  if (!snap) return 'night'
  if (snap.sig.uiNight !== undefined) return snap.sig.uiNight ? 'night' : 'day'
  if (pref !== 'auto') return pref
  const h = new Date(snap.sig.t).getHours()
  return h >= 7 && h < 19 ? 'day' : 'night'
}

const DayCtx = createContext(false)
/** Theme-aware level / CO₂ colours for inline styles. */
function usePalette() {
  const day = useContext(DayCtx)
  return { day, kss: day ? kssColorDay : kssColor, co2: day ? co2ColorDay : co2Color }
}

export function CarApp() {
  const snap = useSim((s) => s.snap)
  const rt = useSim((s) => s.runtime)
  const theme = useTheme(snap)
  if (!snap || !rt) return <div className="car-boot"><Logo size={96} /></div>
  const driving = snap.sig.speedKph > 3
  // Sleep screens stay dark whatever the theme.
  const day = theme === 'day' && snap.mode !== 'napping' && snap.mode !== 'waking'
  return (
    <DayCtx.Provider value={day}>
    <div className={`car-app lv${snap.est.level} ${driving ? 'driving' : 'stopped'}`} data-theme={day ? 'day' : 'night'}>
      <div className="car-ambient" style={{ background: `radial-gradient(60% 50% at 20% 0%, ${snap.sig.ambient?.color ?? '#3CF2C8'}22, transparent 70%)` }} />
      <Header snap={snap} />
      {snap.mode === 'napping' || snap.mode === 'waking' ? (
        <NapView snap={snap} />
      ) : snap.mode === 'parked' ? (
        <ParkedView snap={snap} />
      ) : (
        <DriveView snap={snap} />
      )}
      <VoiceBar />
      <QuizOverlay />
      <ProbeOverlay />
    </div>
    </DayCtx.Provider>
  )
}

function Header({ snap }: { snap: Snapshot }) {
  const enabled = useVoice((s) => s.enabled)
  return (
    <header className="car-head">
      <div className="brand">
        <Logo size={44} />
        <span>깨움</span>
        <em className={snap.caps.source === 'pleos' ? 'live' : ''}>
          <i className="dot" />
          {snap.caps.source === 'pleos' ? 'Pleos 차량 연결' : '시뮬레이션'} · {snap.mode === 'driving' ? '주행 모니터링' : snap.mode === 'napping' ? '휴식 중' : '정차'}
        </em>
      </div>
      <div className="head-right">
        <button className={`voice-toggle ${enabled ? 'on' : ''}`} onClick={() => useVoice.getState().setEnabled(!enabled)}>
          <IcSpeaker size={30} />
          {enabled ? '음성 켜짐' : '음성 꺼짐'}
        </button>
        <span className="clock">{clock(snap.sig.t)}</span>
      </div>
    </header>
  )
}

function DriveView({ snap }: { snap: Snapshot }) {
  const { est, plan, proposal, waypoint } = snap
  const info = LEVEL[est.level]
  const pal = usePalette()
  return (
    <main className="drive">
      <section className="ring-col">
        <AlertRing kss={est.kss} level={est.level} size={600} confidence={est.confidence} calm day={pal.day} />
        <p className="ring-desc" style={{ color: info.color }}>{info.desc}</p>
        <div className="forecast">
          <span>졸음 위험(KSS 7) 도달 예측</span>
          <b style={{ color: est.minutesToDanger !== null && est.minutesToDanger < 40 ? 'var(--l3)' : 'var(--ink-strong)' }}>
            {est.minutesToDanger === null ? '4시간 이상' : est.minutesToDanger === 0 ? '도달' : dur(est.minutesToDanger) + ' 후'}
          </b>
        </div>
      </section>
      <section className="side-col">
        <RestCard snap={snap} plan={plan} proposal={proposal} waypoint={waypoint} />
        <AirCard snap={snap} />
        <ActionStrip snap={snap} />
      </section>
    </main>
  )
}

function RestCard({ snap, plan, proposal, waypoint }: Pick<Snapshot, 'plan' | 'proposal' | 'waypoint'> & { snap: Snapshot }) {
  const rt = useSim((s) => s.runtime)!
  const pal = usePalette()
  const km = snap.sig.routeProgressKm ?? 0
  const navTrip = (id: string) => (snap.trip && snap.trip.poiId === id ? snap.trip : null)
  const charging = (snap.sig.socPct ?? 100) < 30
  if (waypoint) {
    const trip = navTrip(waypoint.id)
    const left = Math.max(0, waypoint.km - km)
    const arrived = snap.arrivedAt === waypoint.id
    return (
      <div className="card rest set">
        <div className="card-k">
          <IcCheck size={28} /> {arrived ? '쉼터 도착 확인 (지오펜스)' : '경유지로 안내 중'}
          <button className="rest-cancel" onClick={() => rt.cancelWaypoint()}>취소</button>
        </div>
        <div className="rest-name">{waypoint.name}</div>
        <div className="rest-meta">
          <span><b>{left.toFixed(0)}</b>km</span>
          <span><b>{Math.round(trip ? trip.etaMin : (left / 95) * 60)}</b>분 후 도착{trip ? ' · 내비 기준' : ''}</span>
          <span className="tag">{waypoint.kind === 'service' ? '휴게소' : '졸음쉼터'}</span>
          {trip && snap.sig.socPct !== undefined && <span className="tag">도착 배터리 {trip.socAtDest}%</span>}
        </div>
        <p className="rest-why">{charging && waypoint.kind === 'service' ? '배터리가 낮아 충전 겸 휴식으로 골랐어요. ' : ''}도착하면 커피 한 잔과 15분 파워냅을 준비해 드릴게요.</p>
      </div>
    )
  }
  const target = proposal ? { stop: proposal.stop, etaMin: proposal.etaMin, kssAtArrival: plan?.kssAtArrival } : plan
  if (!target) return <div className="card rest"><div className="card-k">다음 휴식</div><div className="rest-name dim">경로 위 쉼터 없음</div></div>
  return (
    <div className={`card rest ${proposal ? 'ask' : ''}`}>
      <div className="card-k">
        {target.stop.kind === 'service' ? <IcCoffee size={28} /> : <IcPin size={28} />}
        {proposal ? '깨움이 휴식을 제안해요' : '예측 기반 추천 휴식지'}
      </div>
      <div className="rest-name">{target.stop.name}</div>
      <div className="rest-meta">
        <span><b>{Math.max(0, target.stop.km - km).toFixed(0)}</b>km</span>
        <span><b>{Math.round(navTrip(target.stop.id)?.etaMin ?? target.etaMin)}</b>분{navTrip(target.stop.id) ? ' · 내비 기준' : ''}</span>
        {charging && target.stop.kind === 'service' && <span className="tag">⚡ 충전 겸 휴식</span>}
        {target.kssAtArrival !== undefined && (
          <span>도착 시 <b style={{ color: pal.kss(target.kssAtArrival) }}>{target.kssAtArrival.toFixed(1)}</b></span>
        )}
      </div>
      {proposal ? (
        <div className="rest-actions">
          <button className="big primary" onClick={() => rt.acceptProposal()}>경유지 추가</button>
          <button className="big" onClick={() => rt.declineProposal()}>나중에</button>
        </div>
      ) : (
        <p className="rest-why">{plan?.reason}</p>
      )}
    </div>
  )
}

function AirCard({ snap }: { snap: Snapshot }) {
  const { co2, sig } = snap
  const pal = usePalette()
  const pct = Math.min(1, co2 / 5000)
  return (
    <div className="card air">
      <div className="air-top">
        <div>
          <div className="card-k">실내 CO₂ <small>디지털 트윈 추정</small></div>
          <div className="co2" style={{ color: pal.co2(co2) }}>
            {Math.round(co2).toLocaleString()}<small>ppm</small>
          </div>
        </div>
        <div className={`mode ${sig.recirculation ? 'rec' : 'fresh'}`}>
          {sig.recirculation ? <IcRecirc size={34} /> : <IcWind size={34} />}
          {sig.recirculation ? '내기순환' : '외기유입'}
        </div>
      </div>
      <div className="co2-bar">
        <i style={{ width: `${pct * 100}%`, background: pal.co2(co2) }} />
        <span style={{ left: '20%' }}>1,000</span>
        <span style={{ left: '40%' }}>2,000</span>
        <span style={{ left: '70%' }}>3,500</span>
      </div>
      <div className="air-stats">
        <span><IcTemp size={28} />{sig.setTempC.toFixed(1)}℃</span>
        <span><IcFan size={28} />{sig.fanSpeed}단</span>
        <span><IcSeat size={28} />통풍 {sig.seatVentDriver ?? 0}</span>
        <span><IcSun size={28} /><i className="amb" style={{ background: sig.ambient?.color }} /></span>
      </div>
    </div>
  )
}

function ActionStrip({ snap }: { snap: Snapshot }) {
  const items = snap.timeline.filter((e) => e.actions.length).slice(-3).reverse()
  return (
    <div className="card actions">
      <div className="card-k">깨움이 한 일</div>
      {items.length === 0 && <div className="act dim">아직 개입이 필요하지 않았어요</div>}
      {items.map((e, i) => (
        <div className="act" key={e.t + e.title + i}>
          <i style={{ background: LEVEL[e.level].hex }} />
          <span className="act-t">{clock(e.t)}</span>
          <span className="act-title">{e.title}</span>
        </div>
      ))}
    </div>
  )
}

/** From navi's recent destinations: how long the next trip probably is and how many rests it needs. */
function TripPlanHint({ snap }: { snap: Snapshot }) {
  const pos = snap.sig.position
  const dest = snap.recent[0]
  if (!pos || !dest) return null
  const R = 6371
  const toR = Math.PI / 180
  const dLat = (dest.lat - pos[1]) * toR
  const dLon = (dest.lon - pos[0]) * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(pos[1] * toR) * Math.cos(dest.lat * toR) * Math.sin(dLon / 2) ** 2
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.3
  if (km < 30) return null
  const rests = Math.max(0, Math.ceil((km / 95) * 60 / 110) - 1)
  return (
    <p className="trip-hint">
      최근 목적지 <b>{dest.name}</b>까지 약 {Math.round(km)}km · 졸음 예측상 휴식 <b>{rests}회</b> 계획을 세워 둘게요.
    </p>
  )
}

function ParkedView({ snap }: { snap: Snapshot }) {
  const rt = useSim((s) => s.runtime)!
  const pal = usePalette()
  const [min, setMin] = useState(20)
  return (
    <main className="parked">
      <div className="nap-hero">
        <IcMoon size={120} />
        <h1>파워냅 준비 완료</h1>
        <p>
          주차가 확인됐어요. 현재 졸음지수 <b style={{ color: pal.kss(snap.est.kss) }}>{snap.est.kss.toFixed(1)}</b>
          <br />
          좌석을 젖히고, 공기·온도·조명을 수면에 맞추고, 정확한 시간에 깨워 드려요.
        </p>
        <TripPlanHint snap={snap} />
        <div className="nap-opts">
          {[10, 15, 20].map((m) => (
            <button key={m} className={`big ${min === m ? 'primary' : ''}`} onClick={() => setMin(m)}>
              {m}분
            </button>
          ))}
        </div>
        <button className="big primary wide" onClick={() => rt.startNap(min)}>
          <IcMoon size={36} /> {min}분 파워냅 시작
        </button>
        <button className="big ghost wide" onClick={() => voice.manualProbe(rt)}>
          <IcMic size={34} /> 출발 전 반응속도 확인
        </button>
      </div>
    </main>
  )
}

function NapView({ snap }: { snap: Snapshot }) {
  const rt = useSim((s) => s.runtime)!
  const total = rt.orch.napMinutes
  const left = snap.napRemainingMin ?? 0
  const frac = snap.mode === 'waking' ? 1 : 1 - left / total
  const R = 300
  const C = 2 * Math.PI * R
  return (
    <main className={`nap ${snap.mode}`}>
      <svg width={720} height={720} viewBox="0 0 720 720">
        <circle cx={360} cy={360} r={R} stroke="rgba(255,255,255,0.06)" strokeWidth={14} fill="none" />
        <circle
          cx={360}
          cy={360}
          r={R}
          stroke={snap.mode === 'waking' ? '#E8F4FF' : '#FF9A5A'}
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`}
          transform="rotate(-90 360 360)"
          style={{ transition: 'stroke-dasharray 1s linear, stroke 2s' }}
        />
        <text x={360} y={330} textAnchor="middle" fontSize={44} fill="rgba(255,255,255,.55)" fontFamily="var(--pleos)" fontWeight={600}>
          {snap.mode === 'waking' ? '기상 시퀀스' : '파워냅'}
        </text>
        <text x={360} y={430} textAnchor="middle" fontSize={130} fill="#fff" fontFamily="var(--pleos)" fontWeight={800}>
          {snap.mode === 'waking' ? '☀︎' : `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, '0')}`}
        </text>
      </svg>
      <div className="nap-side">
        <NapStep on icon={<IcSeat size={34} />} t="좌석 등받이 젖힘" />
        <NapStep on icon={<IcTemp size={34} />} t={`${snap.sig.setTempC.toFixed(1)}℃ · 송풍 ${snap.sig.fanSpeed}단`} />
        <NapStep on={!snap.sig.recirculation} icon={<IcWind size={34} />} t="외기 유입 · CO₂ 축적 방지" />
        <NapStep on icon={<IcSun size={34} />} t={snap.mode === 'waking' ? '주광색 조명으로 각성' : '저조도 웜톤 조명'} />
        {snap.mode === 'napping' && (
          <button className="big wide" onClick={() => rt.wakeNow()}>
            지금 깨우기
          </button>
        )}
      </div>
    </main>
  )
}

const NapStep = ({ on, icon, t }: { on: boolean; icon: React.ReactNode; t: string }) => (
  <div className={`nap-step ${on ? 'on' : ''}`}>
    {icon}
    <span>{t}</span>
  </div>
)

function VoiceBar() {
  const caption = useVoice((s) => s.caption)
  return (
    <footer className={`voicebar ${caption ? 'show' : ''}`}>
      <div className="orb" />
      <span>{caption ?? '“깨움아” 라고 부르거나 스티어링 휠 음성 버튼을 눌러 말해 보세요'}</span>
    </footer>
  )
}

function QuizOverlay() {
  const quiz = useVoice((s) => s.quiz)
  const driving = useSim((s) => s.snap?.mode === 'driving')
  // The quiz is an in-motion engagement tool: never show it over the nap / parked screens.
  if (!quiz || !driving) return null
  return (
    <div className="overlay quiz rise">
      <div className="ov-k">각성 퀴즈 · {quiz.region}</div>
      <h2>{quiz.q}</h2>
      <div className="choices">
        {quiz.choices.map((c, i) => {
          const state = quiz.picked === undefined ? '' : i === quiz.answer ? 'right' : i === quiz.picked ? 'wrong' : 'dim'
          return (
            <button key={c} className={`choice ${state}`} onClick={() => voice.answer(i)}>
              <em>{i + 1}</em>
              {c}
            </button>
          )
        })}
      </div>
      <p className="ov-hint">“{quiz.choices[0]}” 또는 “{quiz.choices[1]}” 라고 말씀하세요</p>
    </div>
  )
}

function ProbeOverlay() {
  const probe = useVoice((s) => s.probe)
  if (probe.phase === 'idle') return null
  return (
    <div className="overlay probe rise">
      <div className="ov-k">음성 반응속도 측정 · Voice PVT</div>
      {probe.phase === 'done' ? (
        <>
          <h2 className="rt" style={{ color: (probe.rt ?? 0) > 500 ? 'var(--l3)' : 'var(--l0)' }}>{Math.round(probe.rt ?? 0)}ms</h2>
          <p>{(probe.rt ?? 0) > 500 ? '반응이 늦어졌어요 (500ms 초과 = 주의 지연)' : '반응속도 양호'}</p>
        </>
      ) : (
        <>
          <div className={`probe-orb ${probe.phase}`} />
          <h2>{probe.phase === 'listening' ? '지금 “네” 라고 말하세요' : '띵 소리가 나면 “네”'}</h2>
        </>
      )}
    </div>
  )
}
