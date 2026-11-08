import { useId } from 'react'
import { kssColor, kssColorDay, LEVEL } from './format'
import type { RiskLevel } from '../engine/types'

interface Props {
  kss: number
  level: RiskLevel
  size: number
  forecastMin?: number | null
  confidence?: number
  calm?: boolean // reduce motion while driving
  label?: string
  /** Day theme: light-surface palette (night keeps the original neon look). */
  day?: boolean
}

const START = 135
const SWEEP = 270

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Alertness gauge on the KSS 1–9 scale. Arc fills toward red as sleepiness rises. */
export function AlertRing({ kss, level, size, confidence = 0.6, calm, label, day }: Props) {
  const id = useId().replace(/:/g, '')
  const c = size / 2
  const r = size * 0.42
  const w = size * 0.055
  const frac = (Math.min(9, Math.max(1, kss)) - 1) / 8
  const len = (Math.PI * 2 * r * SWEEP) / 360
  const col = day ? kssColorDay(kss) : kssColor(kss)
  const ink = day
    ? { track: 'rgba(19,20,23,0.07)', halo: 'rgba(19,20,23,0.08)', tick: 'rgba(19,20,23,0.22)', tickText: 'rgba(19,20,23,0.38)', knob: '#ffffff', label: '#686A72', line: '#44464E', strong: '#131417', faint: '#A4A8AE', warn: '#EA640C' }
    : { track: 'rgba(255,255,255,0.07)', halo: 'rgba(255,255,255,0.08)', tick: 'rgba(255,255,255,0.28)', tickText: 'rgba(255,255,255,0.35)', knob: '#05070b', label: 'rgba(255,255,255,0.5)', line: 'rgba(255,255,255,0.72)', strong: '#fff', faint: 'rgba(255,255,255,0.4)', warn: '#FF9A3C' }
  const ramp = day ? ['#00A389', '#5A9E10', '#D18F00', '#EA640C', '#E8320F'] : ['#3CF2C8', '#9BE15D', '#FFD04A', '#FF9A3C', '#FF3B4F']
  const info = LEVEL[level]
  const ticks = [3, 5, 6, 7, 8]
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={ramp[0]} />
          <stop offset="0.5" stopColor={ramp[1]} />
          <stop offset="0.68" stopColor={ramp[2]} />
          <stop offset="0.82" stopColor={ramp[3]} />
          <stop offset="1" stopColor={ramp[4]} />
        </linearGradient>
        <filter id={`f${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={size * 0.02} />
        </filter>
        <radialGradient id={`rg${id}`}>
          <stop offset="0" stopColor={col} stopOpacity="0.20" />
          <stop offset="0.7" stopColor={col} stopOpacity="0.03" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r * 0.92} fill={`url(#rg${id})`} style={{ transition: 'fill 1s' }} />
      <path d={arc(c, c, r, START, START + SWEEP)} stroke={ink.track} strokeWidth={w} fill="none" strokeLinecap="round" />
      {/* confidence halo */}
      <path
        d={arc(c, c, r + w * 1.1, START, START + SWEEP)}
        stroke={ink.halo}
        strokeWidth={w * 0.12}
        fill="none"
        strokeDasharray={`${len * confidence} ${len}`}
      />
      <path
        d={arc(c, c, r, START, START + SWEEP)}
        stroke={`url(#g${id})`}
        strokeWidth={w}
        fill="none"
        strokeLinecap="round"
        filter={`url(#f${id})`}
        opacity={day ? 0.22 : 0.55}
        strokeDasharray={`${len * frac} ${len}`}
        style={{ transition: calm ? 'stroke-dasharray 1.2s ease' : 'stroke-dasharray 0.6s ease' }}
      />
      <path
        d={arc(c, c, r, START, START + SWEEP)}
        stroke={`url(#g${id})`}
        strokeWidth={w}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${len * frac} ${len}`}
        style={{ transition: calm ? 'stroke-dasharray 1.2s ease' : 'stroke-dasharray 0.6s ease' }}
      />
      {ticks.map((k) => {
        const a = ((START + (SWEEP * (k - 1)) / 8) * Math.PI) / 180
        const r0 = r - w * 1.05
        const r1 = r - w * 1.6
        return (
          <g key={k}>
            <line
              x1={c + r0 * Math.cos(a)}
              y1={c + r0 * Math.sin(a)}
              x2={c + r1 * Math.cos(a)}
              y2={c + r1 * Math.sin(a)}
              stroke={k === 7 ? ink.warn : ink.tick}
              strokeWidth={k === 7 ? 3 : 2}
            />
            <text
              x={c + (r1 - size * 0.035) * Math.cos(a)}
              y={c + (r1 - size * 0.035) * Math.sin(a)}
              fill={k === 7 ? ink.warn : ink.tickText}
              fontSize={size * 0.032}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="var(--pleos)"
              fontWeight={700}
            >
              {k}
            </text>
          </g>
        )
      })}
      {/* knob */}
      {(() => {
        const a = ((START + SWEEP * frac) * Math.PI) / 180
        return (
          <circle
            cx={c + r * Math.cos(a)}
            cy={c + r * Math.sin(a)}
            r={w * 0.62}
            fill={ink.knob}
            stroke={col}
            strokeWidth={w * 0.28}
            style={{ transition: 'cx 0.6s, cy 0.6s' }}
          />
        )
      })()}
      <text x={c} y={c - size * 0.1} textAnchor="middle" fill={ink.label} fontSize={size * 0.04} fontFamily="var(--pleos)" fontWeight={600}>
        {label ?? '각성 상태'}
      </text>
      <text x={c} y={c + size * 0.035} textAnchor="middle" fill={col} fontSize={size * 0.135} fontFamily="var(--pleos)" fontWeight={800} style={{ transition: 'fill 0.8s' }}>
        {info.name}
      </text>
      <text x={c} y={c + size * 0.13} textAnchor="middle" fill={ink.line} fontSize={size * 0.045} fontFamily="var(--pleos)" fontWeight={600}>
        졸음지수 <tspan fontWeight={800} fill={ink.strong}>{kss.toFixed(1)}</tspan>
        <tspan fill={ink.faint}> / 9</tspan>
      </text>
    </svg>
  )
}
