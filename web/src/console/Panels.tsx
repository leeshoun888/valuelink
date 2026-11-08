import { useEffect, useMemo, useRef, useState } from 'react'
import { useSim } from '../state/store'
import { clock, dur, kssColor, LEVEL } from '../ui/format'
import { READ_CALLS, sdkCallsFor } from '../engine/sdkTrace'
import { onSdkTrace } from '../engine/native'
import type { TimelineEvent } from '../engine/types'

/** Explainable fatigue: KSS decomposition into additive contributions + forecast curve. */
export function ExplainPanel() {
  const snap = useSim((s) => s.snap)
  const rt = useSim((s) => s.runtime)
  const curve = useMemo(
    () => (snap && rt ? rt.fatigue.forecastCurve(snap.sig, snap.est.kss, 240, 5) : []),
    // recompute ~ every sim minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, snap ? Math.floor(snap.sig.t / 60000) : 0],
  )
  if (!snap) return null
  const items = snap.est.contributions.filter((c) => Math.abs(c.value) > 0.02)
  const max = Math.max(1.5, ...items.map((c) => Math.abs(c.value)))
  const W = 420
  const H = 120
  const x = (m: number) => (m / 240) * W
  const y = (k: number) => H - ((k - 1) / 8) * H
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(p.kss).toFixed(1)}`).join('')
  const cross = curve.find((p) => p.kss >= 7)
  return (
    <div className="panel glass explain">
      <div className="panel-h">
        <span className="eyebrow">Explainable Fatigue · 3-Process Model</span>
        <span className="chip" style={{ color: LEVEL[snap.est.level].hex, borderColor: LEVEL[snap.est.level].hex + '66' }}>
          L{snap.est.level} {LEVEL[snap.est.level].name}
        </span>
      </div>
      <div className="kss-big">
        <b style={{ color: kssColor(snap.est.kss) }}>{snap.est.kss.toFixed(2)}</b>
        <span>KSS · 신뢰도 {(snap.est.confidence * 100).toFixed(0)}%</span>
      </div>
      <div className="contrib">
        {items.map((c) => (
          <div key={c.key} className="crow">
            <span className="cl">{c.label}</span>
            <span className="cbar">
              <i
                className={c.value >= 0 ? 'pos' : 'neg'}
                style={{ width: `${(Math.abs(c.value) / max) * 50}%`, [c.value >= 0 ? 'left' : 'right']: '50%' } as React.CSSProperties}
              />
            </span>
            <span className="cv mono">{c.value >= 0 ? '+' : ''}{c.value.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="fc-h">
        <span className="eyebrow">4시간 졸음 예측</span>
        <span className="fc-v">{cross ? `KSS 7 도달 ${dur(cross.min)} 후` : '4시간 내 위험 없음'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="fc">
        <defs>
          <linearGradient id="fcg" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#3CF2C8" />
            <stop offset="0.55" stopColor="#FFD04A" />
            <stop offset="0.8" stopColor="#FF9A3C" />
            <stop offset="1" stopColor="#FF3B4F" />
          </linearGradient>
        </defs>
        <rect x={0} y={y(9)} width={W} height={y(7) - y(9)} fill="rgba(255,90,60,0.08)" />
        <line x1={0} x2={W} y1={y(7)} y2={y(7)} stroke="#FF9A3C" strokeDasharray="4 4" strokeWidth={1} />
        {[60, 120, 180].map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={0} y2={H} stroke="rgba(255,255,255,.06)" />
            <text x={x(m)} y={H + 14} fontSize={10} fill="#6c7a90" textAnchor="middle">{m / 60}h</text>
          </g>
        ))}
        <path d={path} stroke="url(#fcg)" strokeWidth={2.5} fill="none" />
        {snap.plan && <circle cx={x(snap.plan.etaMin)} cy={y(snap.plan.kssAtArrival)} r={5} fill="#05070b" stroke="#FFB547" strokeWidth={2} />}
      </svg>
    </div>
  )
}

/** Live stream of the Pleos SDK calls behind each intervention. */
export function SdkTrace() {
  const rt = useSim((s) => s.runtime)
  const [lines, setLines] = useState<{ t: string; s: string; k: 'r' | 'w' | 'n' }[]>([])
  const seen = useRef(new WeakSet<TimelineEvent>())
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!rt) return
    seen.current = new WeakSet()
    setLines(READ_CALLS.map((s) => ({ t: 'init', s, k: 'r' as const })))
    const offNative = onSdkTrace((s) => setLines((l) => [...l.slice(-160), { t: clock(Date.now()), s, k: 'n' }]))
    const off = rt.subscribe((snap) => {
      const add: { t: string; s: string; k: 'w' }[] = []
      for (const ev of snap.timeline) {
        if (seen.current.has(ev)) continue
        seen.current.add(ev)
        if (rt.bus.kind === 'native') continue
        for (const a of ev.actions) for (const s of sdkCallsFor(a)) add.push({ t: clock(ev.t), s, k: 'w' })
      }
      if (add.length) setLines((l) => [...l, ...add].slice(-160))
    })
    return () => {
      off()
      offNative()
    }
  }, [rt])
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' })
  }, [lines])
  return (
    <div className="panel glass trace">
      <div className="panel-h">
        <span className="eyebrow">Pleos Connect SDK · Call Trace</span>
        <span className="chip">{rt?.bus.kind === 'native' ? 'LIVE' : 'SIM'}</span>
      </div>
      <div ref={box} className="trace-body scroll-y mono">
        {lines.map((l, i) => (
          <div key={i} className={`tl ${l.k}`}>
            <span className="tt">{l.t}</span>
            <span>{l.s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Whole-trip timeline: KSS + CO₂ over time with intervention markers. */
export function TripChart() {
  const snap = useSim((s) => s.snap)
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    const ro = new ResizeObserver(() => setW(ref.current?.clientWidth ?? 800))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  const H = 150
  const hist = snap?.history ?? []
  if (!snap) return <div ref={ref} className="panel glass tripchart" />
  const t0 = hist[0]?.t ?? snap.sig.t
  const t1 = Math.max(t0 + 3 * 3.6e6, snap.sig.t)
  const x = (t: number) => ((t - t0) / (t1 - t0)) * w
  const yk = (k: number) => H - ((k - 1) / 8) * (H - 10)
  const yc = (c: number) => H - Math.min(1, c / 6000) * (H - 10)
  const kssPath = hist.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${yk(p.kss).toFixed(1)}`).join('')
  const co2Area = hist.length
    ? `M${x(hist[0].t)},${H}` + hist.map((p) => `L${x(p.t).toFixed(1)},${yc(p.co2).toFixed(1)}`).join('') + `L${x(hist[hist.length - 1].t)},${H}Z`
    : ''
  const events = snap.timeline.filter((e) => e.level >= 1 || e.title.includes('경유지') || e.title.includes('파워냅'))
  const hours: number[] = []
  for (let t = Math.ceil(t0 / 3.6e6) * 3.6e6; t < t1; t += 3.6e6) hours.push(t)
  return (
    <div ref={ref} className="panel glass tripchart">
      <div className="panel-h">
        <span className="eyebrow">Trip Timeline · 졸음지수 & 실내 CO₂</span>
        <span className="legend">
          <i style={{ background: '#3CF2C8' }} />KSS <i style={{ background: 'rgba(255,181,71,.5)' }} />CO₂ <i style={{ background: '#FF9A3C' }} />개입
        </span>
      </div>
      <svg width={w} height={H + 20}>
        <defs>
          <linearGradient id="kssg" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#3CF2C8" />
            <stop offset="0.5" stopColor="#9BE15D" />
            <stop offset="0.62" stopColor="#FFD04A" />
            <stop offset="0.75" stopColor="#FF9A3C" />
            <stop offset="1" stopColor="#FF3B4F" />
          </linearGradient>
          <linearGradient id="co2g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(255,181,71,.35)" />
            <stop offset="1" stopColor="rgba(255,181,71,0)" />
          </linearGradient>
        </defs>
        <line x1={0} x2={w} y1={yk(7)} y2={yk(7)} stroke="rgba(255,154,60,.5)" strokeDasharray="3 5" />
        {hours.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="rgba(255,255,255,.05)" />
            <text x={x(t) + 4} y={H + 14} fontSize={10} fill="#6c7a90">{clock(t)}</text>
          </g>
        ))}
        <path d={co2Area} fill="url(#co2g)" />
        <path d={kssPath} stroke="url(#kssg)" strokeWidth={2.5} fill="none" />
        {events.map((e, i) => (
          <g key={i}>
            <line x1={x(e.t)} x2={x(e.t)} y1={H - 6} y2={H} stroke={LEVEL[e.level].hex} strokeWidth={2} />
            {e.title.includes('파워냅') && <text x={x(e.t)} y={14} fontSize={11} textAnchor="middle" fill="#FF9A5A">☾</text>}
            {e.title.includes('경유지') && <text x={x(e.t)} y={14} fontSize={11} textAnchor="middle" fill="#FFB547">◆</text>}
          </g>
        ))}
        <circle cx={x(snap.sig.t)} cy={yk(snap.est.kss)} r={4.5} fill={kssColor(snap.est.kss)} />
      </svg>
    </div>
  )
}

const NO_EVENTS: TimelineEvent[] = []
export function EventLog() {
  const tl = useSim((s) => s.snap?.timeline ?? NO_EVENTS)
  const items = tl.slice(-40).reverse()
  return (
    <div className="panel glass log">
      <div className="panel-h">
        <span className="eyebrow">Intervention Log</span>
        <span className="chip">{tl.length}</span>
      </div>
      <div className="log-body scroll-y">
        {items.map((e, i) => (
          <div key={e.t + e.title + i} className="ev rise">
            <i style={{ background: LEVEL[e.level].hex }} />
            <div>
              <div className="ev-h">
                <span className="mono">{clock(e.t)}</span> {e.title}
              </div>
              <div className="ev-d">{e.detail}</div>
              {e.actions.length > 0 && (
                <div className="ev-a">
                  {e.actions.filter((a) => a.kind !== 'speak').map((a, j) => (
                    <span key={j} className="chip" title={a.reason}>
                      {a.kind}
                      {a.value !== undefined && typeof a.value !== 'object' ? `=${a.value}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
