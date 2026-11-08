// Landing: an Apple-style product page. One object (the car), big type, scroll-told features: as each
// feature scrolls by, the sticky 3D car shows it happening (windows close, lamps go out, the pack fills).

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Logo } from '../ui/icons'
import { READ_CALLS } from '../engine/sdkTrace'
import { DEFAULT_CAR, type CarState } from '../three/StudioCar'
import './landing.css'

const StudioCar = lazy(() => import('../three/StudioCar'))
const R = `${import.meta.env.BASE_URL}3d/renders/`

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp [data-reveal]')
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.18 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

/** A render from tools/blender (overnight Cycles); hides itself until the file exists. */
function Render({ name, alt, className }: { name: string; alt: string; className?: string }) {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return <img className={className} src={`${R}${name}.png`} alt={alt} onError={() => setOk(false)} loading="lazy" />
}

const STEPS: { k: string; title: string; body: string; sdk: string; car: Partial<CarState> }[] = [
  {
    k: 'charge',
    title: '충전은 80%까지만.\n장거리 전날엔 100%로.',
    body: '플러그를 꽂으면 차가 직접 충전 상한을 80%로 맞춥니다. 내비 목적지가 80%로 갈 수 없는 거리면, 그날만 100%로 올립니다.',
    sdk: 'EvBattery.setEvChargePercentLimit',
    car: { charging: true, xray: true, socPct: 64, chargeLimitPct: 80 },
  },
  {
    k: 'rain',
    title: '비가 오면,\n열린 창문을 닫습니다.',
    body: '와이퍼가 움직이고 창문이 열린 채 주차돼 있으면, 차가 스스로 창문을 올립니다. 실내 침수는 중고 감정의 큰 감점입니다.',
    sdk: 'Window.setWindowPosition',
    car: { windowsOpen: 0 },
  },
  {
    k: 'lights',
    title: '켜두고 내린 전조등,\n차가 끕니다.',
    body: 'P단 정차 후 1분이 지나도 전조등이 켜져 있으면 끕니다. 12V 배터리 방전과 긴급출동을 미리 막습니다.',
    sdk: 'Light.setLowBeamLightSwitch',
    car: { headlights: false },
  },
  {
    k: 'tyre',
    title: '경고등이 켜지면,\n가까운 블루핸즈로.',
    body: '타이어 공기압, 12V 배터리, EV 시스템. 경고등을 읽어 내비에서 블루핸즈를 바로 찾습니다. 미해결 경고등은 자산 가치를 낮추는 요인입니다.',
    sdk: 'Safety.getTelltalesInfo → NaviHelper.SearchPlace',
    car: { tyreWarning: true },
  },
]

function Story() {
  const [step, setStep] = useState(0)
  const [rainOpen, setRainOpen] = useState(1)
  const refs = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.i))
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    refs.current.forEach((r) => r && io.observe(r))
    return () => io.disconnect()
  }, [])
  // replay the moment each time a step becomes active: window open → closes, lamps on → off
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    setPhase(0)
    setRainOpen(2)
    const t = window.setTimeout(() => {
      setPhase(1)
      setRainOpen(0)
    }, 1400)
    return () => clearTimeout(t)
  }, [step])
  const s = STEPS[step]
  const car: CarState = {
    ...DEFAULT_CAR,
    sohPct: 98.1,
    ...s.car,
    windowsOpen: s.k === 'rain' ? rainOpen : 0,
    headlights: s.k === 'lights' ? phase === 0 : false,
    socPct: s.k === 'charge' ? 58 + phase * 22 : 72,
  }
  return (
    <section className="lp-story" id="guard">
      <div className="lp-story-stage">
        <Suspense fallback={null}>
          <StudioCar state={car} theme="dark" autoRotate interactive={false} distance={11} shiftX={0.12} shiftY={0.06} style={{ width: '100%', height: '100%' }} />
        </Suspense>
        <div className="lp-story-sdk">
          <span>Pleos SDK</span>
          <code>{s.sdk}</code>
        </div>
      </div>
      <div className="lp-story-steps">
        <p className="lp-eyebrow">지킨다</p>
        {STEPS.map((st, i) => (
          <div key={st.k} ref={(el) => void (refs.current[i] = el)} data-i={i} className={`lp-step ${i === step ? 'on' : ''}`}>
            <h3>
              {st.title.split('\n').map((l, k) => (
                <span key={k}>{l}</span>
              ))}
            </h3>
            <p>{st.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Landing() {
  useReveal()
  return (
    <div className="lp">
      <nav className="lp-nav">
        <a href="#/" className="lp-brand">
          <Logo size={22} />
          밸류링크
        </a>
        <div className="lp-links">
          <a href="#guard">지킨다</a>
          <a href="#prove">증명한다</a>
          <a href="#value">잇는다</a>
          <a href="#pleos">Pleos</a>
        </div>
        <a className="pill primary small" href="#/console">
          데모 콘솔
        </a>
      </nav>

      <header className="lp-hero">
        <p className="lp-eyebrow" data-reveal>
          Pleos Connect 자산 관리 매니저
        </p>
        <h1 data-reveal>내 차, 자산이 되다.</h1>
        <p className="lp-lede" data-reveal>
          당신의 현대차를 자산으로 관리하는 가장 스마트한 방법. 차가 스스로 가치를 지키고, 증명하고, 다음으로 잇습니다.
        </p>
        <div className="lp-cta" data-reveal>
          <a className="pill primary" href="#/car">
            차량 앱 실행하기
          </a>
          <a className="pill link" href="#/console">
            시연 콘솔 보기 ›
          </a>
        </div>
        <div className="lp-hero-visual" data-reveal>
          <Render name="hero_dark" alt="스튜디오 조명 아래의 아이오닉 5" className="lp-hero-img" />
        </div>
      </header>

      <section className="lp-number">
        <p className="lp-eyebrow" data-reveal>
          지금 내 차의 가치
        </p>
        <h2 className="lp-big num" data-reveal>
          4,128만원
        </h2>
        <p className="lp-sub" data-reveal>
          연식, 주행거리, <b>차가 직접 잰 배터리 건강도</b>, 경고등, 운전 습관, 차량 여권.
          <br />
          무엇이 가치를 움직이는지, 매일 원화로 보여줍니다.
        </p>
        <div className="lp-chips" data-reveal>
          <span>배터리 건강도 +2.9%</span>
          <span>주행거리 −0.6%</span>
          <span>운전 습관 −1.1%</span>
          <span>차량 여권 +1.5%</span>
        </div>
      </section>

      <Story />

      <section className="lp-battery">
        <div className="lp-battery-copy">
          <p className="lp-eyebrow" data-reveal>
            배터리 건강도
          </p>
          <h2 data-reveal>
            추정이 아니라,
            <br />
            차가 직접 잰 숫자.
          </h2>
          <p className="lp-sub" data-reveal>
            현재 배터리 용량(EV_CURRENT_BATTERY_CAPACITY)을 신차 용량으로 나눠, 차가 보고하는 그대로의 건강도를 씁니다. 전기차의 자산 가치를 가장 크게 움직이는 숫자입니다.
          </p>
          <div className="lp-stat" data-reveal>
            <b className="num">99.5%</b>
            <span>
              Pleos Connect 에뮬레이터 실측
              <br />
              77,000 Wh / 77,400 Wh
            </span>
          </div>
        </div>
        <Render name="xray_dark" alt="차체를 투과해 보이는 배터리 팩" className="lp-battery-img" />
      </section>

      <section className="lp-prove" id="prove">
        <p className="lp-eyebrow" data-reveal>
          증명한다
        </p>
        <h2 data-reveal>
          차가 매일 쓰는,
          <br />
          위조할 수 없는 여권.
        </h2>
        <p className="lp-sub" data-reveal>
          주행거리, 바퀴 회전 수로 잰 독립 거리, 배터리 건강도, 경고등과 정비, 충전 습관. 하루 한 블록씩 이전 블록의 SHA-256을 품고 이어집니다. 주행거리를 되돌리거나 하루를 지우면 사슬이 끊깁니다.
        </p>
        <div className="lp-chain" data-reveal>
          {['2025.03.14', '2025.09.02', '2026.04.21', '오늘'].map((d, i) => (
            <div key={d} className="lp-block">
              <small>#{[0, 172, 403, 606][i]}</small>
              <b>{d}</b>
              <span className="num">{['0', '9,240', '17,880', '24,812'][i]} km</span>
              <code>{['0000…', '8f3a…', 'c41e…', '2b97…'][i]}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-value" id="value">
        <p className="lp-eyebrow" data-reveal>
          잇는다
        </p>
        <h2 data-reveal>현대차그룹으로 돌아오는 가치.</h2>
        <div className="lp-tiles">
          {[
            ['현대 인증중고차', '관리 이력이 검증된 자사 차량을 직접 매입. 좋은 매물을 먼저 확보합니다.'],
            ['신차 재구매', '가치 곡선이 꺾이기 직전, 최적의 교체 시점에 보상판매로 잇습니다.'],
            ['블루핸즈', '“지금 고치면 가치 손실 0원.” 경고등이 정비 예약으로 이어집니다.'],
            ['현대캐피탈', '관리 점수가 높은 차는 리스 잔존가치 우대. 반납 차량 품질이 오릅니다.'],
            ['Pleos App Market', '상세 리포트와 시세 알림 구독. 렌터카·리스 플릿은 차량당 과금.'],
          ].map(([t, d]) => (
            <div key={t} className="lp-tile" data-reveal>
              <h4>{t}</h4>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-pleos" id="pleos">
        <p className="lp-eyebrow" data-reveal>
          Built on Pleos
        </p>
        <h2 data-reveal>
          에뮬레이터에서
          <br />
          실제로 동작합니다.
        </h2>
        <p className="lp-sub" data-reveal>
          Vehicle SDK 55개 제어 함수와 AAOS 차량 속성을 전수 조사해, 3rd-party 앱이 쓸 수 있는 것만으로 만들었습니다. 충전 상한, 창문, 전조등, 경고등 안내 모두 Pleos Connect 에뮬레이터에서 실제 호출을 검증했습니다.
        </p>
        <ul className="lp-sdk" data-reveal>
          {READ_CALLS.map((c) => (
            <li key={c.call}>
              <em>{c.api}</em>
              <code>{c.call}</code>
              <span>{c.use}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-final">
        <Render name="side_light" alt="측면에서 본 아이오닉 5" className="lp-final-img" />
        <h2 data-reveal>내 차, 자산이 되다.</h2>
        <div className="lp-cta" data-reveal>
          <a className="pill primary" href="#/car">
            차량 앱 실행하기
          </a>
          <a className="pill link" href="#/passport">
            차량 여권 보기 ›
          </a>
          <a className="pill link" href="#/fleet">
            법인·렌터카 ›
          </a>
        </div>
      </section>

      <footer className="lp-foot">
        <p>밸류링크 ValueLink · 현대자동차그룹 차량용 앱 개발 공모전 출품작 · Pleos Connect</p>
        <p>시세 계수와 제휴 서비스는 출품 시나리오의 가정값입니다. 배터리 건강도·경고등·충전 제어는 Pleos SDK와 AAOS 실측 값입니다.</p>
      </footer>
    </div>
  )
}
