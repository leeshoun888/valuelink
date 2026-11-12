// The vehicle passport as a document: a data page with a photo, verified fields, the daily record chain, an
// issuing seal and a machine-readable zone. Rolling the odometer back strikes the mileage, breaks the chain at
// that day, switches the hologram off and stamps the page void, so the idea reads without explanation.

import { useMemo } from 'react'
import { Logo } from './icons'
import './passportCard.css'

export interface PassportCardData {
  model: string
  /** ASCII model name for the machine-readable zone, words joined by '<' */
  modelEn?: string
  year?: number | string
  vin?: string
  since: string
  days: number
  km: number
  soh: number
  sohMeasured: boolean
  floodMin: number
  openWarnings: number
  head: string
  ok: boolean
}

export interface PassportTamper {
  /** the day whose block was edited */
  day: string
  /** odometer after the rollback */
  km: number
}

const N = 56 // ticks on the record strip: the last eight weeks
const BREAK = N - 17

// outside 3d/renders, which the APK leaves out
const R = `${import.meta.env.BASE_URL}3d/`

function mrz(d: PassportCardData) {
  const pad = (s: string) => (s + '<'.repeat(44)).slice(0, 44)
  const name = (d.modelEn ?? 'IONIQ5<LONG<RANGE').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const vin = (d.vin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '<').padEnd(17, '<').slice(0, 17)
  const num = (v: number, n: number) => String(Math.max(0, Math.round(v))).padStart(n, '0').slice(-n)
  return [
    pad(`VP<KOR${name}<<${String(d.year ?? '').slice(-4)}`),
    pad(`${vin}<${num(d.days, 4)}D<${num(d.km, 6)}KM<${num(d.soh * 10, 4)}SOH<${d.head.slice(0, 6).toUpperCase()}`),
  ]
}

/** Guilloche rosettes, the fine security print of the page. */
function Guilloche() {
  const paths = useMemo(() => {
    const out: string[] = []
    const rose = (cx: number, cy: number, R0: number, r: number, d: number, turns: number) => {
      let p = ''
      const steps = 1400
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * turns
        const x = cx + (R0 - r) * Math.cos(t) + d * Math.cos(((R0 - r) / r) * t)
        const y = cy + (R0 - r) * Math.sin(t) - d * Math.sin(((R0 - r) / r) * t)
        p += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      }
      out.push(p)
    }
    rose(1060, 160, 210, 36, 64, 9)
    rose(1060, 160, 150, 26, 40, 13)
    rose(160, 700, 260, 46, 80, 23)
    // flowing lines across the page
    for (let k = 0; k < 14; k++) {
      let p = ''
      for (let x = 0; x <= 1420; x += 10) {
        const y = 430 + k * 16 + Math.sin(x / 70 + k * 0.45) * 22 + Math.sin(x / 190 - k) * 14
        p += `${x ? 'L' : 'M'}${x},${y.toFixed(1)}`
      }
      out.push(p)
    }
    return out
  }, [])
  return (
    <svg className="vp-guilloche" viewBox="0 0 1420 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

function Seal({ days }: { days: number }) {
  return (
    <svg className="vp-seal" viewBox="0 0 120 120" aria-label="이력 검증 도장">
      <defs>
        <path id="vp-seal-arc" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
        <filter id="vp-ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.6" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </defs>
      <g filter="url(#vp-ink)">
        <circle cx="60" cy="60" r="56" fill="none" strokeWidth="2.4" />
        <circle cx="60" cy="60" r="36" fill="none" strokeWidth="1.2" />
        <text className="arc">
          <textPath href="#vp-seal-arc" startOffset="0">
            VALUELINK · VERIFIED · 이력 검증 · VALUELINK · VERIFIED ·
          </textPath>
        </text>
        <path d="M47 59l9 9 17-19" fill="none" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <text x="60" y="84" textAnchor="middle" className="days">
          {days.toLocaleString()}일
        </text>
      </g>
    </svg>
  )
}

function Void() {
  return (
    <svg className="vp-void" viewBox="0 0 220 110" aria-label="무효 도장">
      <g filter="url(#vp-ink)">
        <rect x="4" y="4" width="212" height="102" rx="10" fill="none" strokeWidth="4" />
        <rect x="12" y="12" width="196" height="86" rx="6" fill="none" strokeWidth="1.5" />
        <text x="110" y="62" textAnchor="middle" className="big">
          무효
        </text>
        <text x="110" y="86" textAnchor="middle" className="small">
          VOID · 기록 사슬 끊김
        </text>
      </g>
    </svg>
  )
}

export function PassportCard({ data, tamper = null, className = '' }: { data: PassportCardData; tamper?: PassportTamper | null; className?: string }) {
  const [l1, l2] = mrz(data)
  const t = Boolean(tamper)
  const vinShown = data.vin ?? '미확인'
  return (
    <div className={`vp ${t ? 'is-void' : ''} ${className}`} role="group" aria-label="차량 여권">
      <div className="vp-page">
        <Guilloche />
        <div className="vp-holo" aria-hidden />

        <header className="vp-top">
          <div className="vp-issuer">
            <Logo size={18} />
            <div>
              <b>차량 여권</b>
              <small>VEHICLE PASSPORT</small>
            </div>
          </div>
          <div className="vp-no">
            <small>발급 · ISSUED BY</small>
            <b>밸류링크 · Pleos Connect</b>
          </div>
        </header>

        <div className="vp-body">
          <figure className="vp-photo">
            <img src={`${R}passport_photo.jpg`} alt="" draggable={false} />
            <figcaption>
              <span>{data.model}</span>
              <img className="vp-ghost" src={`${R}passport_photo.jpg`} alt="" draggable={false} />
              <span className="micro">VALUELINK VEHICLE PASSPORT · VALUELINK VEHICLE PASSPORT · VALUELINK VEHICLE PASSPORT</span>
            </figcaption>
          </figure>

          <dl className="vp-fields">
            <div className="wide">
              <dt>
                차종 <i>Model</i>
              </dt>
              <dd>
                {data.year ? `${data.year} ` : ''}
                {data.model}
              </dd>
            </div>
            <div className="wide">
              <dt>
                차대번호 <i>VIN</i>
              </dt>
              <dd className="mono">{vinShown}</dd>
            </div>
            <div>
              <dt>
                최초 기록 <i>Since</i>
              </dt>
              <dd className="num">{data.since}</dd>
            </div>
            <div>
              <dt>
                봉인 일수 <i>Sealed days</i>
              </dt>
              <dd className="num">{data.days.toLocaleString()}일</dd>
            </div>
            <div className={t ? 'bad' : ''}>
              <dt>
                주행거리 <i>Odometer</i>
              </dt>
              <dd className="num">
                {Math.round(t ? tamper!.km : data.km).toLocaleString()} km
              </dd>
              <em>
                {t ? (
                  <>
                    <s>{Math.round(data.km).toLocaleString()}</s> 바퀴 회전 거리와 불일치
                  </>
                ) : (
                  '바퀴 회전 수로 검증'
                )}
              </em>
            </div>
            <div>
              <dt>
                배터리 건강도 <i>SOH</i>
              </dt>
              <dd className="num">{data.soh.toFixed(1)}%</dd>
              <em>{data.sohMeasured ? '차량 실측' : '추정'}</em>
            </div>
            <div>
              <dt>
                침수 노출 <i>Flood</i>
              </dt>
              <dd className="num">{data.floodMin ? `${data.floodMin}분` : '없음'}</dd>
              <em>기상특보 × 침수흔적도</em>
            </div>
            <div>
              <dt>
                미해결 경고등 <i>Warnings</i>
              </dt>
              <dd className="num">{data.openWarnings ? `${data.openWarnings}개` : '없음'}</dd>
            </div>
          </dl>
          <div className="vp-stamp">
            <Seal days={data.days} />
            <Void />
          </div>
        </div>

        <div className="vp-chain">
          <div className="vp-chain-head">
            <span>
              기록 사슬 <i>하루 한 칸, 앞 칸의 해시를 품고 봉인</i>
            </span>
            <code>{t ? `${tamper!.day} 이후 불일치` : `HEAD ${data.head.slice(0, 12)}…`}</code>
          </div>
          <div className="vp-ticks" aria-hidden>
            {Array.from({ length: N }, (_, i) => (
              <span key={i} className={i === N - 1 ? 'today' : t && i === BREAK ? 'broke' : t && i > BREAK ? 'dead' : ''} style={{ animationDelay: `${(i - BREAK) * 18}ms` }} />
            ))}
            <svg className="vp-crack" viewBox="0 0 20 40" style={{ left: `${((BREAK + 0.5) / N) * 100}%` }}>
              <path d="M10 0 L6 9 L13 16 L7 24 L12 31 L9 40" />
            </svg>
          </div>
        </div>

        <div className="vp-mrz mono" aria-label="기계 판독 영역">
          <div>{l1}</div>
          <div>{l2}</div>
        </div>

      </div>
    </div>
  )
}

/** The card's fields from a runtime snapshot. */
export function passportDataOf(snap: {
  sig: { modelYear?: number; vin?: string }
  model: { id: string; name: string }
  passport: { days: number; odometerKm: number; since: string; head: string; chainOk: boolean; mileageOk: boolean }
  battery: { soh: number; sohSource: 'car' | 'estimate' }
  exposure: { floodMin: number }
  warnings: unknown[]
}): PassportCardData {
  return {
    model: snap.model.name,
    modelEn: snap.model.id.toUpperCase().replace(/-/g, '<').replace('<LR', '<LONG<RANGE').replace('<SR', '<STANDARD'),
    year: snap.sig.modelYear,
    vin: snap.sig.vin,
    since: snap.passport.since,
    days: snap.passport.days,
    km: snap.passport.odometerKm,
    soh: snap.battery.soh,
    sohMeasured: snap.battery.sohSource === 'car',
    floodMin: snap.exposure.floodMin,
    openWarnings: snap.warnings.length,
    head: snap.passport.head,
    ok: snap.passport.chainOk && snap.passport.mileageOk,
  }
}
