// Mission Control: the judges' live demo. Left · the real in-car app inside a Pleos
// Connect-S head unit, plus the route map. Right · the cabin digital twin, explainable
// fatigue model, and a live trace of the Pleos SDK calls the app makes.

import { lazy, Suspense, useEffect } from 'react'
import { useSim } from '../state/store'
import { SCENARIOS } from '../engine/sim'
import { useVoice, voice } from '../voice/voice'
import { Ivi } from './Ivi'
import { MapView } from './MapView'
import { EventLog, ExplainPanel, SdkTrace, TripChart } from './Panels'
import { RealtimeButton } from '../voice/RealtimeButton'
import { clock } from '../ui/format'
import { IcMic, IcPause, IcPlay, Logo } from '../ui/icons'
import './console.css'

const CabinTwin = lazy(() => import('./CabinTwin').then((m) => ({ default: m.CabinTwin })))

export function Console() {
  const { load, scenario, playing, setPlaying, timeScale, setTimeScale, autoPilot, setAutoPilot, runtime, carTheme, setCarTheme } = useSim()
  const voiceOn = useVoice((s) => s.enabled)
  const t = useSim((s) => s.snap?.sig.t)
  useEffect(() => {
    // Deep-link options for demos/recording: #/console?scenario=fleet-dawn&skip=45&autoplay&speed=60
    const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const sc = q.get('scenario')
    if (!useSim.getState().runtime || sc) load(sc ?? SCENARIOS[0].id)
    const rt0 = useSim.getState().runtime
    const skip = Number(q.get('skip') ?? 0)
    if (rt0 && skip > 0) rt0.frame(skip * 60_000, 1)
    if (q.get('speed')) setTimeScale(Number(q.get('speed')))
    if (q.has('autoplay')) setPlaying(true)
  }, [load, setPlaying, setTimeScale])

  return (
    <div className="console">
      <header className="topbar">
        <a href="#/" className="tb-brand">
          <Logo size={26} />
          <b>깨움</b>
          <span>Mission Control</span>
        </a>
        <div className="tb-scen">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={`scen ${scenario.id === s.id ? 'on' : ''}`} onClick={() => { load(s.id); setPlaying(true) }}>
              <b>{s.title}</b>
              <small>{s.subtitle}</small>
            </button>
          ))}
        </div>
        <div className="tb-ctrl">
          <button className="btn primary play" onClick={() => setPlaying(!playing)}>
            {playing ? <IcPause size={16} /> : <IcPlay size={16} />}
            {playing ? '일시정지' : '시뮬레이션 시작'}
          </button>
          <div className="seg">
            {[1, 10, 60, 240].map((s) => (
              <button key={s} className={timeScale === s ? 'on' : ''} onClick={() => setTimeScale(s)}>
                {s}×
              </button>
            ))}
          </div>
          <span className="simclock mono">{t ? clock(t) : '--:--'}</span>
          <div className="seg" title="차량 화면 테마 (Pleos 주간/야간 모드)">
            {(
              [
                ['auto', '자동'],
                ['day', '주간'],
                ['night', '야간'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={carTheme === k ? 'on' : ''} onClick={() => setCarTheme(k)}>
                {l}
              </button>
            ))}
          </div>
          <button className={`btn ${autoPilot ? 'on' : ''}`} onClick={() => setAutoPilot(!autoPilot)} title="시뮬레이션 운전자가 제안에 자동 응답">
            오토 드라이버
          </button>
          <button className={`btn ${voiceOn ? 'on' : ''}`} onClick={() => { useVoice.getState().setEnabled(!voiceOn); if (!voiceOn) voice.say('welcome') }}>
            음성 {voiceOn ? 'ON' : 'OFF'}
          </button>
          <button className="btn" onClick={() => runtime && voice.manualProbe(runtime)} title="마이크로 실제 반응속도 측정">
            <IcMic size={16} /> 반응속도
          </button>
          <RealtimeButton />
        </div>
      </header>

      <main className="cgrid">
        <section className="c-left">
          <Ivi />
          <div className="c-row">
            <div className="panel glass mapwrap">
              <div className="panel-h abs">
                <span className="eyebrow">Route · 예측 졸음 리본 · 공공데이터 쉼터 {`/`} 졸음사고 히트맵</span>
              </div>
              <MapView />
            </div>
          </div>
          <TripChart />
        </section>
        <section className="c-right">
          <div className="panel glass twin">
            <Suspense fallback={<div className="twin-fallback">3D 캐빈 트윈 로딩…</div>}>
              <CabinTwin height={330} />
            </Suspense>
          </div>
          <ExplainPanel />
          <div className="c-split">
            <SdkTrace />
            <EventLog />
          </div>
        </section>
      </main>
      <Tray />
    </div>
  )
}

/** Manual "virtual console" inputs, mirroring the Pleos Virtual Console cards. */
function Tray() {
  const rt = useSim((s) => s.runtime)
  const sig = useSim((s) => s.snap?.sig)
  if (!rt || !sig || rt.bus.kind !== 'sim') return null
  const sim = rt.bus as unknown as { daw: boolean; occupants: number; recirc: boolean }
  return (
    <div className="tray glass">
      <span className="eyebrow">Virtual Console</span>
      <button className={`chip ${sig.dawWarning ? 'hot' : ''}`} onClick={() => (sim.daw = !sim.daw)}>
        DRIVER_ATTENTION 텔테일 {sig.dawWarning ? 'ON' : 'OFF'}
      </button>
      <button className="chip" onClick={() => (sim.recirc = !sim.recirc)}>
        공조 {sig.recirculation ? '내기순환' : '외기유입'} 전환
      </button>
      <button className="chip" onClick={() => (sim.occupants = (sim.occupants % 4) + 1)}>
        탑승 {sig.occupants}명
      </button>
      {rt.proposal && (
        <button className="chip hot" onClick={() => rt.acceptProposal()}>
          제안 수락: {rt.proposal.stop.name}
        </button>
      )}
    </div>
  )
}
