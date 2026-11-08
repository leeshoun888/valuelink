// 깨움 KKAEUM · landing / pitch page.
// Facts used here come only from research/market_research.md items tagged [검증] or [계산],
// and from src/data/accidents.json (한국도로공사 졸음운전 사고통계 2023–2025 원자료).

import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { animate, motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { arc as d3arc, scaleRadial } from 'd3'
import accidents from '../data/accidents.json'
import {
  IcAlert,
  IcBolt,
  IcCheck,
  IcEye,
  IcLight,
  IcMic,
  IcMoon,
  IcPin,
  IcSeat,
  IcSpark,
  IcCar,
  IcWind,
  Logo,
} from '../ui/icons'
import './landing.css'

/* ──────────────────────────────────────────────────────────────────────────
   3D hero · loaded lazily. import.meta.glob keeps this file compiling even
   when ../console/CabinTwin.tsx does not exist yet (the glob is then empty).
   ────────────────────────────────────────────────────────────────────────── */
type HeroModule = { CabinTwinHero?: ComponentType }
const heroLoaders = import.meta.glob<HeroModule>('../console/CabinTwin.tsx')
const Hero3D = lazy(async () => {
  const load = Object.values(heroLoaders)[0]
  if (!load) return { default: HeroFallback }
  try {
    const m = await load()
    return { default: m.CabinTwinHero ?? HeroFallback }
  } catch {
    return { default: HeroFallback }
  }
})

class HeroBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <HeroFallback /> : this.props.children
  }
}

function HeroFallback() {
  return (
    <div className="lp-orb" aria-hidden="true">
      <svg viewBox="0 0 400 400">
        <defs>
          <radialGradient id="lpOrbCore" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#3CF2C8" stopOpacity=".55" />
            <stop offset=".55" stopColor="#5AB8FF" stopOpacity=".12" />
            <stop offset="1" stopColor="#05070b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lpOrbRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3CF2C8" />
            <stop offset="1" stopColor="#9B8CFF" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#lpOrbCore)" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="rgba(148,178,222,.14)" />
        <circle cx="200" cy="200" r="110" fill="none" stroke="rgba(148,178,222,.10)" />
        <g className="lp-orb-spin">
          <circle cx="200" cy="200" r="150" fill="none" stroke="url(#lpOrbRing)" strokeWidth="2" strokeDasharray="2 10" />
        </g>
        <path d="M 94 306 A 150 150 0 1 1 306 306" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="10" strokeLinecap="round" />
        <path className="lp-orb-arc" d="M 94 306 A 150 150 0 1 1 306 94" fill="none" stroke="url(#lpOrbRing)" strokeWidth="10" strokeLinecap="round" />
        <text x="200" y="196" textAnchor="middle" className="lp-orb-num">3.2</text>
        <text x="200" y="226" textAnchor="middle" className="lp-orb-cap">KSS · 맑음</text>
      </svg>
      <span className="lp-float f1 chip">CO₂ 820 ppm · 외기</span>
      <span className="lp-float f2 chip">다음 휴식 · 망향휴게소 34분</span>
      <span className="lp-float f3 chip">앰비언트 · Cyan</span>
    </div>
  )
}

/* ──────────────────────────── motion helpers ──────────────────────────── */

const EASE = [0.2, 0.7, 0.2, 1] as const

function Reveal({ children, delay = 0, y = 28, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

function CountUp({ to, decimals = 0, duration = 1.6 }: { to: number; decimals?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotion()
  const fmt = (v: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  useEffect(() => {
    const el = ref.current
    if (!el || !inView) return
    if (reduce) {
      el.textContent = fmt(to)
      return
    }
    const c = animate(0, to, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => (el.textContent = fmt(v)) })
    return () => c.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, to, reduce])
  return (
    <span ref={ref} className="num">
      {fmt(reduce ? to : 0)}
    </span>
  )
}

function SectionHead({ eyebrow, title, lead, center }: { eyebrow: string; title: ReactNode; lead?: ReactNode; center?: boolean }) {
  return (
    <Reveal className={`lp-head${center ? ' center' : ''}`}>
      <div className="eyebrow lp-eyebrow">{eyebrow}</div>
      <h2 className="lp-h2">{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </Reveal>
  )
}

/* ─────────────────────────────── page ─────────────────────────────── */

export function Landing() {
  return (
    <div className="landing">
      <div className="lp-grain" aria-hidden="true" />
      <Nav />
      <main>
        <Hero />
        <Problem />
        <DataStory />
        <WhyCar />
        <HowItWorks />
        <SdkSection />
        <Business />
        <Principles />
      </main>
      <Footer />
    </div>
  )
}

/* ─────────────────────────────── nav ─────────────────────────────── */

const NAV = [
  ['problem', '문제'],
  ['data', '데이터'],
  ['vehicle', '차량 특화'],
  ['how', '작동 원리'],
  ['sdk', 'Pleos SDK'],
  ['business', '사업성'],
] as const

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const go = (id: string) => (e: ReactMouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <header className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="lp-wrap lp-nav-in">
        <a className="lp-brand" href="#/" onClick={go('top')} aria-label="깨움 KKAEUM 처음으로">
          <Logo size={26} />
          <span className="lp-brand-ko">깨움</span>
          <span className="lp-brand-en">KKAEUM</span>
        </a>
        <nav className="lp-nav-links" aria-label="섹션">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={go(id)}>
              {label}
            </a>
          ))}
        </nav>
        <a className="btn primary lp-nav-cta" href="#/console">
          라이브 데모
        </a>
      </div>
    </header>
  )
}

/* ─────────────────────────────── 1. hero ─────────────────────────────── */

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const yText = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90])
  const yViz = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60])
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, reduce ? 1 : 0.2])

  return (
    <section ref={ref} className="lp-hero" id="top">
      <div className="lp-aurora" aria-hidden="true">
        <i className="a1" />
        <i className="a2" />
        <i className="a3" />
      </div>
      <div className="lp-horizon" aria-hidden="true" />
      <div className="lp-wrap lp-grid lp-hero-grid">
        <motion.div className="lp-hero-copy" style={{ y: yText, opacity: fade }}>
          <motion.div
            className="lp-hero-badge"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            <Logo size={22} />
            <span>
              깨움 <b>KKAEUM</b>
            </span>
            <span className="lp-hero-badge-sep" />
            <span className="lp-hero-badge-pleos">for Pleos Connect</span>
          </motion.div>
          <h1 className="lp-h1">
            {['졸음이 오기 전에,', '차가 먼저 깨운다.'].map((line, i) => (
              <span className="lp-h1-line" key={line}>
                <motion.span
                  initial={reduce ? false : { y: '105%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 1.1, delay: 0.15 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                  className={i === 1 ? 'lp-grad-text' : undefined}
                >
                  {line}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p
            className="lp-hero-sub"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.45, ease: EASE }}
          >
            Pleos Connect 차량용 졸음운전 예방 코파일럿. 수면 과학 모델과 차량 신호로 졸음을 <b>미리</b> 예측하고, 공조·조명·시트·내비게이션을 직접 움직여 운전자를 깨웁니다.
          </motion.p>
          <motion.div
            className="lp-cta-row"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.6, ease: EASE }}
          >
            <a className="btn primary lp-btn-lg" href="#/console">
              <span className="lp-live-dot" />
              라이브 데모 실행
            </a>
            <a className="btn lp-btn-lg" href="#/car">
              차량 앱 화면
            </a>
            <a className="btn lp-btn-lg lp-btn-ghost" href="#/fleet">
              Fleet 콘솔 →
            </a>
          </motion.div>
          <motion.ul
            className="lp-hero-meta"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.85 }}
          >
            <li>
              <b>카메라 없이</b>
              <span>차량 신호 + 음성</span>
            </li>
            <li>
              <b>온디바이스</b>
              <span>추론·기록 모두 차 안에서</span>
            </li>
            <li>
              <b>L0 → L4</b>
              <span>단계별 개입 사다리</span>
            </li>
          </motion.ul>
        </motion.div>

        <motion.div
          className="lp-hero-viz"
          style={{ y: yViz }}
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.4, delay: 0.2, ease: EASE }}
        >
          <div className="lp-hero-frame">
            <HeroBoundary>
              <Suspense fallback={<HeroFallback />}>
                <Hero3D />
              </Suspense>
            </HeroBoundary>
          </div>
          <div className="lp-hero-caption mono">CABIN DIGITAL TWIN · LIVE</div>
        </motion.div>
      </div>
      <a
        className="lp-scroll-hint"
        href="#problem"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('problem')?.scrollIntoView({ behavior: 'smooth' })
        }}
      >
        <span>스크롤</span>
        <i />
      </a>
    </section>
  )
}

/* ─────────────────────────────── 2. problem ─────────────────────────────── */

const STATS: { to: number; decimals?: number; unit: string; label: ReactNode; src: string; tone: string }[] = [
  {
    to: 71.6,
    decimals: 1,
    unit: '%',
    label: (
      <>
        2026년 상반기 고속도로 사망자 중<br />
        졸음·주시태만 비중
      </>
    ),
    src: '한국도로공사 · 파이낸셜뉴스 2026.07.28',
    tone: 'coral',
  },
  {
    to: 2,
    unit: '배',
    label: (
      <>
        졸음운전 치사율, 음주운전 대비
        <br />
        <small>사고 100건당 사망 2.9명 vs 1.5명</small>
      </>
    ),
    src: '경찰청 2019–2023 · SBS Biz 2024.04.04',
    tone: 'amber',
  },
  {
    to: 5000,
    unit: 'ppm',
    label: (
      <>
        내기순환 30분이면 차 안 CO₂
        <br />
        <small>600ppm → 5,000ppm 수준. 2,000ppm부터 졸음·두통</small>
      </>
    ),
    src: '한국도로공사 · 파이낸셜뉴스 2026.07.07',
    tone: 'violet',
  },
  {
    to: 83,
    unit: 'm',
    label: (
      <>
        시속 100km에서 3초 졸면
        <br />
        <small>아무도 운전하지 않는 차가 달리는 거리</small>
      </>
    ),
    src: '자체 계산 · 27.8m/s × 3s',
    tone: 'aurora',
  },
]

function Problem() {
  return (
    <section className="lp-section" id="problem">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="01 · The Problem"
          title={
            <>
              가장 조용한 사고는
              <br />
              <span className="lp-dim">가장 치명적입니다.</span>
            </>
          }
          lead="졸음은 브레이크를 밟지 않습니다. 사고 직전까지 아무 신호도 남기지 않기에, 경고만으로는 늦습니다."
        />
        <div className="lp-grid lp-stats">
          {STATS.map((s, i) => (
            <Reveal key={s.src} delay={i * 0.08} className={`lp-stat glass tone-${s.tone}`}>
              <div className="lp-stat-num">
                <CountUp to={s.to} decimals={s.decimals} />
                <span className="lp-stat-unit">{s.unit}</span>
              </div>
              <div className="lp-stat-label">{s.label}</div>
              <div className="lp-src">{s.src}</div>
            </Reveal>
          ))}
        </div>
        <Reveal className="lp-problem-foot">
          <p>
            운전자 주의 경고(DAW)와 CO₂ 자동 환기는 주의가 떨어지거나 CO₂가 쌓인 <b>“뒤”</b>에 반응합니다. 깨움은 그 신호를 입력으로 받아 <b>“전”</b>에
            움직입니다. 공기를 바꾸고, 빛과 바람으로 깨우고, 쉼터까지 데려갑니다.
          </p>
          <span className="lp-src">기아 MV1 사용설명서 · 운전자 주의 경고 / 현대 인포테인먼트 매뉴얼 · CO₂ 자동 환기</span>
        </Reveal>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 3. data story ─────────────────────────────── */

const PEAK_HOURS = new Set([4, 5, 6, 13, 14, 15])

function RadialClock() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' })
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const byHour = accidents.byHour as number[]
  const max = Math.max(...byHour)
  const R0 = 92
  const R1 = 226

  const { arcs, bands } = useMemo(() => {
    const r = scaleRadial().domain([0, max]).range([R0, R1])
    const step = (2 * Math.PI) / 24
    const gen = d3arc<{ h: number; v: number }>()
      .innerRadius(R0)
      .outerRadius((d) => r(d.v))
      .startAngle((d) => d.h * step)
      .endAngle((d) => (d.h + 1) * step)
      .padAngle(0.035)
      .cornerRadius(3)
    const band = d3arc<{ a: number; b: number }>()
      .innerRadius(R0 - 14)
      .outerRadius(R1 + 10)
      .startAngle((d) => d.a * step)
      .endAngle((d) => d.b * step)
    return {
      arcs: byHour.map((v, h) => ({ h, v, d: gen({ h, v }) ?? '' })),
      bands: [band({ a: 4, b: 7 }) ?? '', band({ a: 13, b: 16 }) ?? ''],
    }
  }, [byHour, max])

  const shown = hover ?? null
  const label = (h: number) => {
    const a = (h / 24) * 2 * Math.PI
    const rr = R1 + 26
    return { x: Math.sin(a) * rr, y: -Math.cos(a) * rr }
  }

  return (
    <div className="lp-clock">
      <svg ref={ref} viewBox="-270 -270 540 540" role="img" aria-label="시간대별 고속도로 졸음운전 사고 건수, 04~06시와 13~15시에 정점">
        <defs>
          <linearGradient id="lpPeak" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFB547" />
            <stop offset="1" stopColor="#FF6B5E" />
          </linearGradient>
        </defs>
        {bands.map((d, i) => (
          <path key={i} d={d} className="lp-clock-band" />
        ))}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} r={R0 + (R1 - R0) * f} className="lp-clock-grid" />
        ))}
        <circle r={R0 - 14} className="lp-clock-core" />
        {arcs.map(({ h, v, d }, i) => {
          const peak = PEAK_HOURS.has(h)
          return (
            <motion.path
              key={h}
              d={d}
              fill={peak ? 'url(#lpPeak)' : 'rgba(90,184,255,.34)'}
              className={`lp-clock-bar${hover === h ? ' on' : ''}${hover !== null && hover !== h ? ' dim' : ''}`}
              style={{ transformOrigin: '0px 0px' }}
              initial={reduce ? false : { scale: 0.55, opacity: 0 }}
              animate={inView ? { scale: 1, opacity: 1 } : undefined}
              transition={{ duration: 0.9, delay: 0.02 * i, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={() => setHover(h)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(h)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${h}시 ${v}건`}
            />
          )
        })}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
          const p = label(h)
          return (
            <text key={h} x={p.x} y={p.y} className="lp-clock-hour" textAnchor="middle" dominantBaseline="middle">
              {String(h).padStart(2, '0')}
            </text>
          )
        })}
        <text y={-12} textAnchor="middle" className="lp-clock-center-num">
          {shown === null ? accidents.total : byHour[shown]}
        </text>
        <text y={20} textAnchor="middle" className="lp-clock-center-cap">
          {shown === null ? '건 · 2023–2025' : `건 · ${String(shown).padStart(2, '0')}시대`}
        </text>
      </svg>
      <div className="lp-clock-legend">
        <span>
          <i className="peak" />
          서캐디언 저점 시간대
        </span>
        <span>
          <i />
          그 외 시간대
        </span>
      </div>
    </div>
  )
}

function DataStory() {
  const deaths = accidents.deathsByYear as Record<string, number>
  const years = accidents.byYear as Record<string, number>
  const dMax = Math.max(...Object.values(deaths))
  const routes = (accidents.topRoutes as [string, number][]).slice(0, 6)
  const rMax = routes[0][1]
  return (
    <section className="lp-section lp-data" id="data">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="02 · Real Data"
          title={
            <>
              졸음은 정해진
              <br />
              시간에 찾아옵니다.
            </>
          }
          lead={
            <>
              고속도로 졸음운전 사고는 새벽 <b className="lp-hl-amber">04–06시</b>와 이른 오후 <b className="lp-hl-amber">13–15시</b>, 인체 시계의 두 저점에 몰립니다. 그래서
              깨움은 ‘지금 몇 시인지’를 위험 모델의 핵심 입력으로 씁니다.
            </>
          }
        />
        <div className="lp-grid lp-data-grid">
          <Reveal className="lp-data-clock glass">
            <RadialClock />
            <p className="lp-caption">한국도로공사 고속도로 졸음운전 사고 694건 (2023–2025) 원자료 분석</p>
          </Reveal>
          <div className="lp-data-side">
            <Reveal className="lp-mini glass" delay={0.05}>
              <div className="lp-mini-head">
                <span className="eyebrow">연도별 사망자</span>
                <span className="lp-mini-delta">+64%</span>
              </div>
              <div className="lp-bars">
                {Object.entries(deaths).map(([y, v], i) => (
                  <div key={y} className="lp-bar-col">
                    <div className="lp-bar-val num">{v}명</div>
                    <div className="lp-bar-track">
                      <motion.div
                        className={`lp-bar-fill${i === 2 ? ' hot' : ''}`}
                        initial={{ height: 0 }}
                        whileInView={{ height: `${(v / dMax) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: 0.15 * i, ease: EASE }}
                      />
                    </div>
                    <div className="lp-bar-x">
                      {y}
                      <small>{years[y]}건</small>
                    </div>
                  </div>
                ))}
              </div>
              <p className="lp-mini-note">
                사고 100건당 사망 10.1명 → 17.8명. 3년 평균 <b>13.4명</b>으로 전국 졸음사고(2.9명)의 약 4.6배.
              </p>
            </Reveal>
            <Reveal className="lp-mini glass" delay={0.12}>
              <div className="lp-mini-head">
                <span className="eyebrow">노선별 사고</span>
                <span className="lp-mini-tag">경부선 102건 최다</span>
              </div>
              <ul className="lp-routes">
                {routes.map(([name, v], i) => (
                  <li key={name}>
                    <span className="lp-route-name">{name}</span>
                    <span className="lp-route-track">
                      <motion.i
                        className={i === 0 ? 'top' : undefined}
                        initial={{ width: 0 }}
                        whileInView={{ width: `${(v / rMax) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, delay: 0.08 * i, ease: EASE }}
                      />
                    </span>
                    <span className="lp-route-v num">{v}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal className="lp-mini lp-mini-inline glass" delay={0.18}>
              <div>
                <div className="lp-mini-big num">32.0%</div>
                <div className="lp-mini-sub">교통량이 가장 적은 00–06시에 몰린 사고 비중</div>
              </div>
              <div>
                <div className="lp-mini-big num">11월</div>
                <div className="lp-mini-sub">월별 최다 (70건)</div>
              </div>
            </Reveal>
          </div>
        </div>
        <p className="lp-src lp-src-block">자료: 한국도로공사_졸음운전 사고통계 (data.go.kr 15145210). 비중·치사율은 팀 자체 계산.</p>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 4. why the car ─────────────────────────────── */

const WHY = [
  {
    icon: IcWind,
    tone: 'aurora',
    title: '차량이 직접 공기를 바꾼다',
    body: '실내 CO₂가 쌓이는 1차 원인은 환기 설정입니다. 깨움은 CO₂ 디지털 트윈으로 농도를 추정해, 위험해지기 전에 내기순환을 외기로 전환합니다.',
    api: 'HVAC.setHvacRecirculation',
    ev: '외기 유입 모드에선 우려 수준을 넘지 않음 · Hudda & Fruin, Sci. Total Environ. 2018',
  },
  {
    icon: IcLight,
    tone: 'blue',
    title: '빛과 바람으로 깨운다',
    body: '앰비언트 라이트를 각성 색으로, 통풍시트와 송풍을 시원하게. 스마트폰은 소리만 낼 수 있지만, 차는 운전자의 몸을 둘러싼 환경 전체를 바꿀 수 있습니다.',
    api: 'Light · Seat · HVAC',
    ev: '대시보드 청색광으로 차선 이탈 26.4 → 14.6회 · Taillard et al., PLoS One 2012',
  },
  {
    icon: IcPin,
    tone: 'violet',
    title: '내비가 쉼터로 데려간다',
    body: '“쉬세요”라는 말 대신, 졸음이 오기 전 도달 가능한 마지막 휴게소를 계산해 현재 경로에 경유지로 바로 추가합니다.',
    api: 'NaviHelper.addWaypoint',
    ev: '졸음쉼터 설치 구간 사고 47% 감소 · 국토교통부 2014',
  },
  {
    icon: IcMoon,
    tone: 'amber',
    title: '차가 침실이 된다',
    body: '주차하면 파워냅 모드. 시트를 젖히고, 공조와 조명을 낮추고, 20분 뒤 빛·바람·소리로 천천히 깨웁니다. 수면 관성까지 고려한 기상 시퀀스입니다.',
    api: 'Seat.moveSeatBackrestAngle',
    ev: '카페인 + 15분 미만 낮잠 시 운전 사고 위약 대비 9% · Reyner & Horne 1997',
  },
] as const

function WhyCar() {
  return (
    <section className="lp-section" id="vehicle">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="03 · Why the car, not the phone"
          title={
            <>
              휴대폰은 경고하고,
              <br />
              <span className="lp-grad-text">차는 행동합니다.</span>
            </>
          }
          lead="졸음운전 앱은 많습니다. 하지만 공기를 바꾸고, 시트를 움직이고, 경로를 바꿀 수 있는 건 차량뿐입니다. 깨움은 Pleos Connect 위에서만 가능한 개입을 설계했습니다."
        />
        <div className="lp-grid lp-why">
          {WHY.map((w, i) => (
            <Reveal key={w.title} delay={i * 0.07} className={`lp-why-card glass tone-${w.tone}`}>
              <div className="lp-why-icon">
                <w.icon size={26} />
              </div>
              <div className="lp-why-idx mono">0{i + 1}</div>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
              <div className="lp-why-foot">
                <code className="mono">{w.api}</code>
                <span className="lp-src">{w.ev}</span>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="lp-layer glass">
          <div className="lp-layer-h">
            <span className="eyebrow">기존 차량 기능과의 관계</span>
            <h3>대체하지 않습니다. 그 위에서 먼저 움직입니다.</h3>
          </div>
          <div className="lp-layer-rows">
            {LAYERS.map((l) => (
              <div key={l.has} className="lp-layer-row">
                <div>
                  <b>{l.has}</b>
                  <small>{l.now}</small>
                </div>
                <span className="lp-layer-arrow" aria-hidden>→</span>
                <p>{l.kkaeum}</p>
              </div>
            ))}
          </div>
          <p className="lp-layer-foot">새 센서·하드웨어 없이, 이미 탑재된 안전·공조 자산의 효과를 끌어올리는 Pleos 소프트웨어 레이어.</p>
        </Reveal>
      </div>
    </section>
  )
}

const LAYERS = [
  { has: 'DAW 운전자 주의 경고', now: '주의 저하 감지 후 휴식 권유 문구·경고음', kkaeum: 'DRIVER_ATTENTION 텔테일을 입력으로 즉시 L3 승격 → 문구에서 끝나지 않고 쉼터 경유지 추가까지' },
  { has: 'CO₂ 자동 환기 (사양 적용 차량)', now: '센서가 임계값 초과 시 외기 유입', kkaeum: 'SDK가 CO₂ 값을 주지 않아도 공조·탑승·속도로 추정 → 졸음 예측과 결합해 1,200ppm에서 선제 환기, 미세먼지 나쁘면 펄스' },
  { has: '내비게이션', now: '목적지 안내 · 휴게소 정보', kkaeum: '졸음 예측 곡선 × 쉼터 253곳 → “위험 전 마지막 쉼터”를 NaviHelper로 경유지 추가' },
]

/* ─────────────────────────────── 5. how it works ─────────────────────────────── */

function StepArt({ kind }: { kind: 'sense' | 'predict' | 'intervene' | 'recover' }) {
  if (kind === 'sense')
    return (
      <svg viewBox="0 0 160 80" className="lp-art">
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            className={`lp-art-wave w${i}`}
            d="M0 40 Q 10 20 20 40 T 40 40 T 60 40 T 80 40 T 100 40 T 120 40 T 140 40 T 160 40 T 180 40 T 200 40"
            transform={`translate(0 ${(i - 1) * 14})`}
          />
        ))}
      </svg>
    )
  if (kind === 'predict')
    return (
      <svg viewBox="0 0 160 80" className="lp-art">
        <line x1="0" y1="22" x2="160" y2="22" className="lp-art-thr" />
        <path className="lp-art-curve" d="M4 70 C 40 66, 70 58, 96 40 S 140 14, 156 8" />
        <circle className="lp-art-dot" cx="112" cy="26" r="4" />
      </svg>
    )
  if (kind === 'intervene')
    return (
      <svg viewBox="0 0 160 80" className="lp-art">
        {['#3CF2C8', '#9BE15D', '#FFD04A', '#FF9A3C', '#FF3B4F'].map((c, i) => (
          <rect key={c} className={`lp-art-step s${i}`} x={8 + i * 30} y={64 - i * 12} width="24" height={12 + i * 12} rx="4" fill={c} />
        ))}
      </svg>
    )
  return (
    <svg viewBox="0 0 160 80" className="lp-art">
      <line x1="10" y1="62" x2="150" y2="62" className="lp-art-thr solid" />
      <path className="lp-art-sun" d="M50 62 a30 30 0 0 1 60 0" />
      {[-60, -30, 0, 30, 60].map((a) => (
        <line
          key={a}
          className="lp-art-ray"
          x1={80 + Math.sin((a * Math.PI) / 180) * 38}
          y1={62 - Math.cos((a * Math.PI) / 180) * 38}
          x2={80 + Math.sin((a * Math.PI) / 180) * 48}
          y2={62 - Math.cos((a * Math.PI) / 180) * 48}
        />
      ))}
    </svg>
  )
}

const STEPS = [
  {
    k: 'sense' as const,
    en: 'Sense',
    ko: '감지',
    body: '조향각 미세 흔들림, 연속 주행 시간·거리, 크루즈 단조로움, 실내 온도, 차량 주의 경고(DRIVER_ATTENTION), 시각.',
    tags: ['SteeringWheel', 'Odometer', 'Safety telltale'],
  },
  {
    k: 'predict' as const,
    en: 'Predict',
    ko: '예측',
    body: '3-Process 수면 모델(Åkerstedt)로 졸음 압력과 생체 리듬을 계산해 KSS 1–9로 환산하고, 앞으로 90분의 졸음 곡선을 그립니다.',
    tags: ['Process S · C', 'KSS', 'CO₂ twin'],
  },
  {
    k: 'intervene' as const,
    en: 'Intervene',
    ko: '개입',
    body: '위험도에 맞춰 L0–L4 사다리를 오릅니다. 공기·빛·바람 → 음성 대화와 반응속도 측정 → 쉼터 경유지 → 반복 경고.',
    tags: ['HVAC', 'Light', 'NaviHelper', 'TTS'],
  },
  {
    k: 'recover' as const,
    en: 'Recover',
    ko: '회복',
    body: '쉼터에 도착하면 파워냅 모드. 시트·공조·조명이 수면 환경을 만들고, 정해진 시간에 단계적으로 깨워 다시 출발을 돕습니다.',
    tags: ['Seat recline', 'Wake sequence'],
  },
]

const LADDER = [
  { l: 'L0', name: 'Watch', ko: '관찰', d: '조용히 지켜봅니다' },
  { l: 'L1', name: 'Refresh', ko: '리프레시', d: '외기 전환 · 냉풍 · 청색 앰비언트' },
  { l: 'L2', name: 'Engage', ko: '대화', d: '음성 대화 + Voice PVT' },
  { l: 'L3', name: 'Rest', ko: '휴식 유도', d: '쉼터를 경유지로 추가' },
  { l: 'L4', name: 'Critical', ko: '위험', d: '반복 경고 · 즉시 휴식' },
]

function HowItWorks() {
  return (
    <section className="lp-section" id="how">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="04 · How it works"
          title={
            <>
              경고가 아니라,
              <br />
              예측하고 개입합니다.
            </>
          }
          lead="깨움은 졸음이 ‘감지된 뒤’가 아니라 ‘오기 전’에 움직이도록 설계된 네 단계 파이프라인입니다."
        />
        <div className="lp-pipeline">
          {STEPS.map((s, i) => (
            <Reveal key={s.k} delay={i * 0.08} className="lp-step glass">
              <div className="lp-step-top">
                <span className="lp-step-n mono">0{i + 1}</span>
                <span className="lp-step-en">{s.en}</span>
              </div>
              <StepArt kind={s.k} />
              <h3>{s.ko}</h3>
              <p>{s.body}</p>
              <div className="lp-tags">
                {s.tags.map((t) => (
                  <span key={t} className="chip mono">
                    {t}
                  </span>
                ))}
              </div>
              {i < STEPS.length - 1 && <span className="lp-step-arrow" aria-hidden="true" />}
            </Reveal>
          ))}
        </div>

        <div className="lp-grid lp-tech">
          <Reveal className="lp-tech-card glass" delay={0}>
            <div className="eyebrow">수면 과학</div>
            <h4>3-Process 졸음 모델 → KSS</h4>
            <p>항상성 수면 압력(S)과 서캐디언 리듬(C)을 계산해 카롤린스카 졸음 척도로 환산합니다. 주행 시간·단조로움·CO₂·온도·반응속도는 각각 설명 가능한 가산 항목입니다.</p>
            <div className="lp-formula mono">KSS ≈ 10.6 − 0.6 · (S + C)</div>
            <span className="lp-src">Åkerstedt & Folkard · Ingre et al., J Sleep Res 2006</span>
          </Reveal>
          <Reveal className="lp-tech-card glass" delay={0.06}>
            <div className="eyebrow">디지털 트윈</div>
            <h4>CO₂ 질량수지 캐빈 모델</h4>
            <p>탑승 인원, 내기/외기 모드, 팬 단계, 차속으로 실내 CO₂를 실시간 추정합니다. 센서가 없는 차량에서도 동작합니다.</p>
            <div className="lp-formula mono">dC/dt = N·G/V − λ(C − C_out)</div>
            <span className="lp-src">Deng et al., Sensors 2020 실측 계수 · V 3.1m³, 1인 5,344ppm/h, λ = 0.060·mph − 0.88</span>
          </Reveal>
          <Reveal className="lp-tech-card glass" delay={0.12}>
            <div className="eyebrow">예측 휴식 플래너</div>
            <h4>졸리기 전, 마지막 안전한 쉼터</h4>
            <p>예측 졸음 곡선과 경로 위 휴게소·졸음쉼터를 교차해, 도착 시점 KSS가 안전 기준 아래인 가장 먼 쉼터를 고릅니다. 플릿 차량은 회사 휴식정책(예: 2시간마다 15분)도 함께 지킵니다.</p>
            <div className="lp-formula mono">argmax km  s.t. KSS(t_arrive) &lt; θ</div>
            <span className="lp-src">고속도로 졸음쉼터 253개소 · 한국도로공사 표준데이터 2026</span>
          </Reveal>
          <Reveal className="lp-tech-card glass" delay={0.18}>
            <div className="eyebrow">Voice PVT</div>
            <h4>음성 반응속도 측정</h4>
            <p>운전 중 화면 대신 목소리로 짧은 신호에 답하게 해 반응 지연을 잽니다. 개인 기준선 대비 지연이 늘면 졸음 점수에 반영합니다.</p>
            <div className="lp-formula mono">lapse ⇔ RT ≥ 500 ms</div>
            <span className="lp-src">Basner, Mollicone & Dinges, Acta Astronautica 2011</span>
          </Reveal>
        </div>

        <Reveal className="lp-ladder glass">
          <div className="lp-ladder-head">
            <div>
              <div className="eyebrow">Escalation ladder</div>
              <h4>필요한 만큼만, 단계적으로.</h4>
            </div>
            <span className="lp-src">L3 이상은 차량 주의 경고(DRIVER_ATTENTION)와 연동</span>
          </div>
          <div className="lp-ladder-row">
            {LADDER.map((s, i) => (
              <div key={s.l} className={`lp-rung r${i}`}>
                <div className="lp-rung-bar" />
                <div className="lp-rung-l mono">{s.l}</div>
                <div className="lp-rung-name">
                  {s.ko} <span>{s.name}</span>
                </div>
                <div className="lp-rung-d">{s.d}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 6. Pleos SDK ─────────────────────────────── */

const SDKS = [
  { name: 'Vehicle SDK', ver: '2.3.2', icon: IcBolt, apis: ['HVAC', 'Light', 'Seat', 'Window', 'Safety · DRIVER_ATTENTION', 'SteeringWheel', 'Odometer'], use: '감지와 개입의 중심' },
  { name: 'CarPropertyManager', ver: 'AAOS', icon: IcEye, apis: ['PERF_VEHICLE_SPEED', 'GEAR_SELECTION', 'CarUxRestrictions'], use: '차속·기어·주행 제한' },
  { name: 'NaviHelper', ver: '3.0.5', icon: IcPin, apis: ['addWaypoint', 'getDestinationInfo', 'TBT · TURN_RESTAREA'], use: '쉼터 경유지 · 남은 시간' },
  { name: 'TextToSpeech', ver: '3.3.1', icon: IcSpark, apis: ['speak', 'EventListener'], use: '대화형 각성 · 안내' },
  { name: 'SpeechToText', ver: '3.3.1', icon: IcMic, apis: ['request', 'onUpdated', 'ON_DEVICE'], use: 'Voice PVT 응답 인식' },
  { name: 'FusedLocation', ver: '1.1.3', icon: IcCar, apis: ['LocationData'], use: '경로 진행·쉼터 거리' },
  { name: 'Gleo Interface', ver: 'schema.json', icon: IcSeat, apis: ['FIND_REST_STOP', 'START_POWER_NAP', 'CHECK_ALERTNESS'], use: '“글레오, 쉴 곳 찾아줘”' },
]

const SNIPPETS: { tab: string; file: string; lang: string; code: string }[] = [
  {
    tab: 'L1 리프레시',
    file: 'CabinActuator.kt',
    lang: 'kotlin',
    code: `// L1: 내기순환 → 외기, 냉풍, 각성 앰비언트
val driver = SeatArea(SeatValue.ROW_1_LEFT)
val hvac = vehicle.getHVAC()

hvac.setHvacRecirculation(driver, false)       // false = 외기 유입
hvac.setHvacTemperature(driver, 21.0f, TemperatureUnit.CELSIUS,
    onComplete = { _, _ -> trace("HVAC 21°C") }, onFailed = ::fallback)
vehicle.getSeat().setHvacSeatVentilation(driver, 3)
vehicle.getLight().setAmbientLightBrightness(driver, 100)`,
  },
  {
    tab: 'L3 쉼터 경유',
    file: 'RestRouter.kt',
    lang: 'kotlin',
    code: `// 예측 플래너가 고른 쉼터를 현재 경로에 경유지로 추가
naviHelper.addWaypoint(
    RequestWaypointInfo(lat, lon, "망향휴게소", WaypointIndex.FIRST,
        poiId = stop.poiId, address = stop.address, poiSubId = "0")
)
// → onWaypointChanged(WaypointChangedInfo(index, ADD, routeStartInfo))`,
  },
  {
    tab: '차량 신호',
    file: 'SignalHub.kt',
    lang: 'kotlin',
    code: `// 차속: AAOS Car API (Pleos 정책상 표준 데이터는 AAOS에서)
propertyManager.registerCallback(speedCb,
    VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL)

// 차량 자체 주의 경고 텔테일을 주기적으로 확인
vehicle.getSafety().getTelltalesInfo({ t ->
    val daw = t?.telltales?.any { it.type == TelltaleType.DRIVER_ATTENTION
        && it.state != TelltaleState.OFF } == true
    fatigue.onVehicleWarning(daw)
}, onFailed = ::log)`,
  },
  {
    tab: 'Gleo 연동',
    file: 'assets/schema.json',
    lang: 'json',
    code: `{
  "packageName": "ai.kkaeum.copilot",
  "actionCalls": [{
    "type": "function",
    "function": {
      "name": "FIND_REST_STOP",
      "description": "Adds the nearest safe rest area on the route as a waypoint.",
      "parameters": { "type": "object", "properties": {}, "required": [] },
      "component": "service"
    }
  }]
}`,
  },
]

const KW = /\b(val|var|fun|object|override|true|false|null|it)\b/
function highlight(code: string) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?f?\b)|(\b[A-Z][A-Za-z0-9_]*\b)|(\b[a-z][A-Za-z0-9_]*\b)/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [t] = m
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 't' : KW.test(t) ? 'k' : code[m.index + t.length] === '(' ? 'f' : ''
    out.push(cls ? <span key={k++} className={`tk-${cls}`}>{t}</span> : t)
    last = m.index + t.length
  }
  out.push(code.slice(last))
  return out
}

function SdkSection() {
  const [tab, setTab] = useState(0)
  const snip = SNIPPETS[tab]
  return (
    <section className="lp-section" id="sdk">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="05 · Built on Pleos SDK"
          title={
            <>
              7개 SDK,
              <br />
              하나의 각성 시스템.
            </>
          }
          lead="깨움은 Pleos Connect가 제공하는 차량·내비·음성 인터페이스를 엮어 하나의 폐루프를 만듭니다. 모든 호출은 기능 확인(capability check) 후 실행되고, 실패하면 음성 안내로 안전하게 대체됩니다."
        />
        <div className="lp-grid lp-sdk">
          <div className="lp-sdk-list">
            {SDKS.map((s, i) => (
              <Reveal key={s.name} delay={i * 0.04} y={16} className="lp-sdk-item glass">
                <div className="lp-sdk-ic">
                  <s.icon size={20} />
                </div>
                <div className="lp-sdk-body">
                  <div className="lp-sdk-name">
                    {s.name} <span className="mono">{s.ver}</span>
                  </div>
                  <div className="lp-sdk-use">{s.use}</div>
                  <div className="lp-sdk-apis">
                    {s.apis.map((a) => (
                      <code key={a} className="mono">
                        {a}
                      </code>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="lp-code glass" delay={0.1}>
            <div className="lp-code-tabs" role="tablist">
              {SNIPPETS.map((s, i) => (
                <button key={s.tab} role="tab" aria-selected={i === tab} className={i === tab ? 'on' : undefined} onClick={() => setTab(i)}>
                  {s.tab}
                </button>
              ))}
            </div>
            <div className="lp-code-bar">
              <span className="lp-code-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="mono">{snip.file}</span>
              <span className="lp-code-lang mono">{snip.lang}</span>
            </div>
            <pre className="lp-pre mono">
              <code key={tab}>{highlight(snip.code)}</code>
            </pre>
            <div className="lp-code-foot">
              <IcCheck size={16} />
              <span>Pleos Playground 에뮬레이터 Virtual Console에서 공조·조명·텔테일 변화를 검증하는 데모 경로를 갖췄습니다.</span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 7. business ─────────────────────────────── */

const MODELS = [
  {
    tag: 'B2C',
    title: '신차 기본 탑재 + 프리미엄',
    body: '기본 졸음 예측·L1 리프레시는 무료로 기본 탑재해 안전 경험을 넓히고, 파워냅·장거리 리포트·개인화 각성 루틴은 프리미엄으로.',
    fact: 'Pleos Connect, 2030년까지 현대·기아·제네시스 약 2,000만 대 탑재 목표',
    src: '현대자동차그룹 보도자료 2026.04.30',
  },
  {
    tag: 'B2B Fleet',
    title: '법인차 · 렌터카 플릿',
    body: '출장·영업·장기렌트 차량의 졸음 위험과 휴식 이력을 Fleet 콘솔로. 예측 플래너가 회사 휴식정책(예: 2시간마다 15분)을 경로 위에서 자동으로 맞춥니다.',
    fact: '렌터카 약 101만 대 · 졸음 사망 1명당 사고비용 5.3억 원',
    src: '렌터카연합회 2020.7 / 도로교통공단 2022 기준',
  },
  {
    tag: 'B2B2C 보험',
    title: '졸음 위험 기반 UBI',
    body: '현행 운전습관 점수는 급가속·급감속 중심입니다. ‘제때 쉬는 운전자’를 점수화해 보험사와 할인 특약을 설계합니다.',
    fact: '티맵 안전운전 할인 특약 가입자 약 500만 명 (벤치마크)',
    src: '파이낸셜뉴스 2026.06.26',
  },
]

const KPIS = [
  { v: '5%', l: 'Pleos Connect 탑재 차량 중 월 활성 비율', n: '목표' },
  { v: '40%', l: '장거리 주행자 4주 리텐션', n: '목표' },
  { v: '500대', l: 'Fleet 파일럿 (법인·렌터카)', n: '목표' },
  { v: '1곳', l: '보험사 UBI 특약 제휴', n: '목표' },
]

const ROADMAP = [
  { t: '2026 Q4', h: 'PoC', d: 'Pleos Playground 에뮬레이터 검증, 공모전 출품, 내부 실차 테스트 제안' },
  { t: '2027', h: 'App Market 출시', d: 'Pleos Connect 탑재 차종 대상 출시, Gleo 음성 연동, 사용자 기준선 학습' },
  { t: '2028', h: 'Fleet · 보험 연동', d: '법인·렌터카 Fleet 콘솔 상용화, 보험사 UBI 특약, 화물·버스 확장, 해외(EU GSR) 검토' },
]

function Business() {
  return (
    <section className="lp-section" id="business">
      <div className="lp-wrap">
        <SectionHead
          eyebrow="06 · Business"
          title={
            <>
              안전이 곧
              <br />
              비즈니스가 되는 구조.
            </>
          }
          lead="운전자에게는 기본 안전 기능, 플릿 운영사에게는 안전정책 관리 도구, 보험사에게는 새로운 위험 지표. 하나의 엔진으로 세 시장을 엽니다."
        />
        <div className="lp-grid lp-biz">
          {MODELS.map((m, i) => (
            <Reveal key={m.tag} delay={i * 0.08} className="lp-biz-card glass">
              <span className="chip lp-biz-tag">{m.tag}</span>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
              <div className="lp-biz-fact">
                <b>{m.fact}</b>
                <span className="lp-src">{m.src}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="lp-grid lp-biz-bottom">
          <Reveal className="lp-kpi glass">
            <div className="lp-kpi-head">
              <span className="eyebrow">Target KPI</span>
              <span className="chip lp-assume">목표치 · 검증 전 가정</span>
            </div>
            <div className="lp-kpi-grid">
              {KPIS.map((k) => (
                <div key={k.l} className="lp-kpi-item">
                  <div className="lp-kpi-v num">{k.v}</div>
                  <div className="lp-kpi-l">{k.l}</div>
                </div>
              ))}
            </div>
            <p className="lp-src">위 수치는 실적이 아닌 2028년 목표이며, PoC 이후 실사용 데이터로 재산정합니다.</p>
          </Reveal>
          <Reveal className="lp-road glass" delay={0.08}>
            <span className="eyebrow">Roadmap</span>
            <ol>
              {ROADMAP.map((r, i) => (
                <li key={r.t} className={i === 0 ? 'now' : undefined}>
                  <span className="lp-road-dot" />
                  <div className="lp-road-t mono">{r.t}</div>
                  <div className="lp-road-h">{r.h}</div>
                  <div className="lp-road-d">{r.d}</div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 8. principles ─────────────────────────────── */

const PRINCIPLES = [
  { icon: IcAlert, t: '주행 조작 개입 없음', d: '조향·가속·제동에는 절대 손대지 않습니다. 깨움이 바꾸는 건 공기, 빛, 바람, 경로 제안뿐입니다.' },
  { icon: IcEye, t: '온디바이스 추론', d: '카메라 없이 차량 신호와 음성만 씁니다. 졸음 추론과 기록은 차 안에서 처리되고 밖으로 나가지 않습니다.' },
  { icon: IcCheck, t: '운전자 동의 기반', d: '공조·시트 자동 제어, Fleet 공유, 보험 연동은 모두 운전자가 직접 켜야 동작합니다. 언제든 끌 수 있습니다.' },
  { icon: IcLight, t: 'Pleos 주의분산 가이드 준수', d: '1–2초 안에 읽히는 화면, 주행 중 영상·자동 스크롤 없음, 음성 우선. CarUxRestrictions를 따릅니다.' },
]

function Principles() {
  return (
    <section className="lp-section" id="principles">
      <div className="lp-wrap">
        <SectionHead eyebrow="07 · Safety & Privacy" title="운전은 언제나 운전자의 것." center />
        <div className="lp-grid lp-prin">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.t} delay={i * 0.06} className="lp-prin-item">
              <div className="lp-prin-ic">
                <p.icon size={22} />
              </div>
              <h4>{p.t}</h4>
              <p>{p.d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────── 9. footer ─────────────────────────────── */

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-aurora lp-aurora-foot" aria-hidden="true">
        <i className="a1" />
        <i className="a2" />
      </div>
      <div className="lp-wrap">
        <Reveal className="lp-final">
          <Logo size={48} />
          <h2 className="lp-h2 lp-final-h">
            다음 휴게소까지,
            <br />
            <span className="lp-grad-text">깨어 있게.</span>
          </h2>
          <div className="lp-cta-row center">
            <a className="btn primary lp-btn-lg" href="#/console">
              <span className="lp-live-dot" />
              라이브 데모 실행
            </a>
            <a className="btn lp-btn-lg" href="#/car">
              차량 앱 화면
            </a>
            <a className="btn lp-btn-lg lp-btn-ghost" href="#/fleet">
              Fleet 콘솔 →
            </a>
          </div>
        </Reveal>
        <div className="lp-foot-bottom">
          <div className="lp-foot-brand">
            <Logo size={22} />
            <div>
              <b>팀 깨움</b>
              <span>현대자동차그룹 차량용 앱 개발 공모전 2026 출품작</span>
            </div>
          </div>
          <p className="lp-foot-src">
            주요 출처: 한국도로공사 졸음운전 사고통계(data.go.kr 15145210) · 한국도로공사 졸음쉼터 표준데이터 · 경찰청(파이낸셜뉴스, SBS Biz 보도) · 현대자동차그룹 보도자료 2026.04.30 ·
            Deng et al. Sensors 2020 · Hudda & Fruin 2018 · Taillard et al. 2012 · Reyner & Horne 1997 · Basner et al. 2011 · Ingre et al. 2006. 시뮬레이션 화면은 데모용
            가상 데이터입니다.
          </p>
        </div>
      </div>
    </footer>
  )
}
