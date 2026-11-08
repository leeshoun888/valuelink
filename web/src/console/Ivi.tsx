// A faithful Pleos Connect-S (17", 2560×1440) head-unit frame: status bar, driving view,
// application window (our app, landscape) and the GNB with live climate controls · so the
// judges can see the app actually moving the car's HVAC, seat and light.

import { useEffect, useRef, useState } from 'react'
import { useSim } from '../state/store'
import { CarApp } from '../car/CarApp'
import { clock } from '../ui/format'
import { IcAlert, IcFan, IcRecirc, IcSeat, IcWind } from '../ui/icons'
import '../car/car.css'
import './ivi.css'

const W = 2560
const H = 1440

export function Ivi() {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(0.3)
  useEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setS(el.clientWidth / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="ivi-wrap" style={{ height: H * s }}>
      <div className="ivi" style={{ width: W, height: H, transform: `scale(${s})` }}>
        <StatusBar />
        <DrivingView />
        <div className="ivi-app">
          <div className="landscape" style={{ width: 1700, height: 1212, position: "relative" }}>
            <CarApp />
          </div>
        </div>
        <Gnb />
      </div>
    </div>
  )
}

function StatusBar() {
  const t = useSim((s) => s.snap?.sig.t ?? Date.now())
  const mode = useSim((s) => s.snap?.mode)
  return (
    <div className="ivi-status">
      <span className="drv-chip">{mode === 'driving' ? '주행 중' : '정차 중'}</span>
      <span className="gleo">Gleo AI</span>
      <span className="grow" />
      <span>LTE</span>
      <span className="clock">{clock(t)}</span>
    </div>
  )
}

function DrivingView() {
  const snap = useSim((s) => s.snap)
  if (!snap) return <div className="ivi-drive" />
  const { sig } = snap
  return (
    <div className="ivi-drive">
      <div className="tt-row">
        <i className={`tt ${sig.dawWarning ? 'on' : ''}`} title="DRIVER_ATTENTION">
          <IcAlert size={34} />
        </i>
        <i className={`tt ${sig.gear === 'P' ? 'on blue' : ''}`}>P</i>
        <i className={`tt ${sig.cruiseOn ? 'on green' : ''}`}>SCC</i>
      </div>
      <div className="speed">
        <b>{Math.round(sig.speedKph)}</b>
        <span>km/h</span>
      </div>
      <div className="gear">
        {(['P', 'R', 'N', 'D'] as const).map((g) => (
          <span key={g} className={sig.gear === g ? 'on' : ''}>
            {g}
          </span>
        ))}
      </div>
      <div className="trip">
        <div>
          <small>주행</small>
          <b>{(sig.routeProgressKm ?? 0).toFixed(0)} km</b>
        </div>
        <div>
          <small>남은 거리</small>
          <b>{(sig.routeRemainingKm ?? 0).toFixed(0)} km</b>
        </div>
        <div>
          <small>외기</small>
          <b>{sig.outsideTempC ?? '-'}℃</b>
        </div>
      </div>
      <div className="car-silhouette">
        <svg viewBox="0 0 200 420" width="200" height="420">
          <rect x="30" y="20" width="140" height="380" rx="60" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="4" />
          <rect x="48" y="120" width="104" height="70" rx="16" fill={sig.ambient?.color ?? '#3CF2C8'} opacity={0.18 + (sig.ambient?.brightness ?? 30) / 250} />
          <rect x="48" y="210" width="104" height="80" rx="16" fill="rgba(255,255,255,.06)" />
          {Array.from({ length: Math.min(4, sig.occupants) }).map((_, i) => (
            <circle key={i} cx={i % 2 ? 125 : 75} cy={i < 2 ? 155 : 250} r={14} fill="rgba(255,255,255,.55)" />
          ))}
          {!sig.recirculation && <path d="M60 30 L60 100 M100 26 L100 100 M140 30 L140 100" stroke="#3CF2C8" strokeWidth="4" strokeDasharray="8 10" className="flow" />}
        </svg>
      </div>
    </div>
  )
}

function Gnb() {
  const sig = useSim((s) => s.snap?.sig)
  if (!sig) return <div className="ivi-gnb" />
  return (
    <div className="ivi-gnb">
      <div className="apps">
        {['내비', '미디어', '전화', '깨움', '설정'].map((a) => (
          <span key={a} className={a === '깨움' ? 'on' : ''}>
            {a}
          </span>
        ))}
      </div>
      <div className="climate">
        <span className="temp">{sig.setTempC.toFixed(1)}°</span>
        <span className={`cl ${sig.recirculation ? 'amber' : 'teal'}`}>
          {sig.recirculation ? <IcRecirc size={44} /> : <IcWind size={44} />}
        </span>
        <span className="cl">
          <IcFan size={44} />
          {sig.fanSpeed}
        </span>
        <span className={`cl ${sig.seatVentDriver ? 'teal' : ''}`}>
          <IcSeat size={44} />
          {sig.seatVentDriver ?? 0}
        </span>
        <span className="temp">22.0°</span>
      </div>
    </div>
  )
}
