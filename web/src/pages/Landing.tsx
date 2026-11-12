// Landing: an Apple-style product page. One object (the car), big type, scroll-told features: as each
// feature scrolls by, the sticky 3D car shows it happening (windows close, lamps go out, the pack fills).

import { PassportCard, type PassportCardData } from '../ui/PassportCard'
import { ClipLayer, type ClipName } from '../three/Clip'
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
  return <img className={className} src={`${R}${name}.jpg`} alt={alt} onError={() => setOk(false)} loading="lazy" />
}

// The real data the car app reads around Gangnam (tools/publicdata-capture.mjs): flood-trace tiles and the lot
// the Value Map recommends. The landing plays the same in-app scenes on it.
const PUB = `${import.meta.env.BASE_URL}pub/tiles/`
const OFFICE = { lat: 37.4959, lng: 127.0276 }
const LOT = { lat: 37.4953545, lng: 127.0332497, name: '역삼1동문화센터 공영주차장' }
const FLOOD_TILES = (() => {
  const t = []
  for (let tx = Math.floor((OFFICE.lng - 0.013) / 0.01); tx <= Math.floor((OFFICE.lng + 0.013) / 0.01); tx++)
    for (let ty = Math.floor((OFFICE.lat - 0.013) / 0.01); ty <= Math.floor((OFFICE.lat + 0.013) / 0.01); ty++)
      t.push({ url: `${PUB}flood_${tx}_${ty}.png`, west: tx * 0.01, south: ty * 0.01, east: (tx + 1) * 0.01, north: (ty + 1) * 0.01 })
  return t
})()

const STEPS: { k: string; title: string; body: string; sdk: string; clip?: ClipName; car: (phase: number) => Partial<CarState> }[] = [
  {
    k: 'flood',
    clip: 'flood',
    title: '물이 차기 전에,\n차가 먼저 피합니다.',
    body: '호우경보가 내리면, 예전에 물에 잠긴 자리인지 차가 압니다. 그리고 가장 가까운 안전한 주차장으로 안내합니다.',
    sdk: '기상청 특보 × 침수흔적도 → NaviHelper.SearchPlace',
    car: (p) => ({ flood: { level: 1, safe: p >= 2, center: OFFICE, target: LOT, tiles: FLOOD_TILES } }),
  },
  {
    k: 'warning',
    title: '경고등 하나, 차 값 −2%.\n지금 고치면 0원.',
    body: '어떤 부품인지 보여주고, 가까운 블루핸즈로 안내합니다. 고친 날은 여권에 남습니다.',
    sdk: 'Safety.getTelltalesInfo → NaviHelper.SearchPlace("블루핸즈")',
    car: (p) => {
      const k = (['tyre', 'lv', 'hv'] as const)[p % 3]
      const name = { tyre: '타이어 공기압', lv: '12V 배터리', hv: 'EV 시스템' }[k]
      return { part: k, partLabel: `${name} · 방치하면 차 값 −2%` }
    },
  },
  {
    k: 'charge',
    title: '평소엔 80%.\n먼 길은 가는 길에 E-pit 한 번.',
    body: '밤새 100%로 두지 않습니다. 먼 길엔 빈 E-pit을 찾아 미리 예열합니다.',
    sdk: 'EvBattery.setEvChargePercentLimit · 한국환경공단 충전기 상태',
    car: (p) => ({ charging: true, xray: true, socPct: 58 + Math.min(p, 1) * 22, chargeLimitPct: 80 }),
  },
  {
    k: 'tradeup',
    clip: 'tradeup',
    title: '가장 좋은 교체 시점,\n차가 먼저 말합니다.',
    body: '인증중고차 매입 기준이 끝나기 전, 보조금이 남아 있을 때. 실 부담 1,550만원.',
    sdk: '차량 여권 → 인증중고차 · 신차 · 현대캐피탈',
    car: (p) => ({ newCar: p >= 1 }),
  },
]

const DAILY: typeof STEPS = [
  {
    k: 'rain',
    clip: 'rain',
    title: '비 오기 30분 전,\n창문이 먼저 닫힙니다.',
    body: '기상청 예보로 비 소식을 먼저 받습니다.',
    sdk: 'Window.setWindowPosition',
    car: (p) => ({ rain: p >= 1 ? 2 : 1, windowsOpen: p >= 1 ? 0 : 2 }),
  },
  {
    k: 'lights',
    clip: 'lights',
    title: '켜두고 내린 전조등,\n차가 끕니다.',
    body: '12V 배터리 방전을 막습니다.',
    sdk: 'Light.setLowBeamLightSwitch',
    car: (p) => ({ headlights: p % 2 === 0 }),
  },
  {
    k: 'lock',
    clip: 'lock',
    title: '절도가 잦은 골목이면,\n문을 잠급니다.',
    body: '경찰청 범죄주의구간 위에 세웠을 때.',
    sdk: 'Door.setDoorLock',
    car: (p) => ({ locked: p % 2 === 1 }),
  },
  {
    k: 'frost',
    clip: 'frost',
    title: '결빙 사고다발지 앞,\n먼저 알립니다.',
    body: '도로교통공단 데이터로 600m 전에.',
    sdk: '도로교통공단 결빙 사고다발지역',
    car: () => ({ frost: true }),
  },
  {
    k: 'sun',
    clip: 'sun',
    title: '한낮의 햇볕엔,\n블라인드를 닫습니다.',
    body: '실내 소재의 변색을 늦춥니다.',
    sdk: 'Window.moveWindowBlind',
    car: (p) => ({ sun: true, blindClosed: p >= 1 }),
  },
]

function Story({ steps = STEPS, id = 'guard', eyebrow = '지킨다' }: { steps?: typeof STEPS; id?: string; eyebrow?: string }) {
  const [step, setStep] = useState(0)
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
  // replay each moment when its step becomes active (water rises then drains, parts cycle, the pack fills,
  // the light sweep turns the car into the next one)
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    setPhase(0)
    let n = 0
    const id = window.setInterval(() => setPhase(++n), 2600)
    return () => clearInterval(id)
  }, [step])
  const s = steps[step]
  const car: CarState = { ...DEFAULT_CAR, sohPct: 98.1, socPct: 72, ...s.car(phase) }
  const [clipOn, setClipOn] = useState(false)
  return (
    <section className="lp-story" id={id}>
      <div className="lp-story-stage">
        <div className={`cv-live ${clipOn ? 'hide' : ''}`}>
          <Suspense fallback={null}>
            <StudioCar state={car} theme="dark" autoRotate interactive={false} distance={11} shiftX={0.12} shiftY={0.06} style={{ width: '100%', height: '100%' }} />
          </Suspense>
        </div>
        <ClipLayer clip={s.clip ?? null} theme="dark" loop framing={{ distance: 11, shiftX: 0.12, shiftY: 0.06 }} onPlaying={setClipOn} />
        <div className="lp-story-sdk">
          <code>{s.sdk}</code>
        </div>
      </div>
      <div className="lp-story-steps">
        <p className="lp-eyebrow">{eyebrow}</p>
        {steps.map((st, i) => (
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

/** 28 sealed days (deterministic sample): kilometres, two heavy-rain days, one warning-lamp day. */
const PROOF_DAYS = 607

/** The vehicle passport as a document, with the rollback demo: the mileage is struck, the record chain breaks
 * at that day and the page is stamped void. */
const PROOF: PassportCardData = {
  model: '아이오닉 5 롱레인지',
  modelEn: 'IONIQ5<LONG<RANGE',
  year: 2025,
  vin: 'KMHKN81AFSU******',
  since: '2025-03-14',
  days: PROOF_DAYS,
  km: 24812,
  soh: 98.1,
  sohMeasured: true,
  floodMin: 0,
  openWarnings: 0,
  head: '4df218ead6e34d19019de7b9ea7abd1d94bc8a2af650d5ff28559e3bc3a0b9b0',
  ok: true,
}

function ProofStage() {
  const [tamper, setTamper] = useState(false)
  return (
    <div className="lp-proof">
      <div className="lp-proof-stage">
        <PassportCard data={PROOF} tamper={tamper ? { day: '2026-10-24', km: PROOF.km - 5000 } : null} />
      </div>
      <div className="lp-proof-ctl">
        <button className="pill secondary" onClick={() => setTamper(!tamper)}>
          {tamper ? '원래대로' : '주행거리 5,000km 되돌려 보기'}
        </button>
        <p>{tamper ? '조작한 날부터 기록 사슬이 끊기고, 여권은 무효가 됩니다.' : '하루 한 칸씩 봉인된 기록이 차의 이력을 증명합니다.'}</p>
      </div>
    </div>
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
          내가 관리하지 않아도, 스스로를 관리하는 자산.
          <br />
          쓰기만 해도 차 값이 지켜집니다.
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
          무엇이 가치를 움직이는지, 매일 원화로.
        </p>
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
            전기차의 가치를 가장 크게 움직이는 숫자를, 차가 보고하는 그대로.
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
        <Render name="charge_xray" alt="투명한 차체 아래 배터리 팩, 버스바, 고전압 배선과 전후 모터" className="lp-battery-img" />
      </section>

      <section className="lp-value lp-city" id="city">
        <p className="lp-eyebrow" data-reveal>
          그리고 매일, 조용히
        </p>
        <h2 data-reveal>
          차의 신호와
          <br />
          도시의 데이터로.
        </h2>
        <p className="lp-sub" data-reveal>
          공공데이터를 차의 신호에 겹칩니다. 정확한 위치는 차 밖으로 나가지 않습니다.
        </p>
        <div className="lp-city-visual" data-reveal>
          <Render name="flood_dark" alt="바퀴 높이까지 찬 물 위의 아이오닉 5와 안전한 주차장 방향 표시" className="lp-city-img" />
        </div>
      </section>

      <Story steps={DAILY} id="daily" eyebrow="그리고 매일, 조용히" />

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
          하루 한 블록, 이전 블록에 잠겨 이어집니다. 주행거리를 되돌리면 사슬이 끊깁니다.
        </p>
        <ProofStage />
      </section>

      <section className="lp-value" id="value">
        <p className="lp-eyebrow" data-reveal>
          잇는다
        </p>
        <h2 data-reveal>현대차그룹으로 돌아오는 가치.</h2>
        <p className="lp-sub" data-reveal>
          관리 잘 된 현대차가, 다음 현대차 고객을 만듭니다.
        </p>
        <ol className="lp-cycle" data-reveal>
          {[
            ['차주', '쓰기만 해도 차 값이 지켜집니다.'],
            ['인증중고차', '여권으로 증명된 매물이 됩니다.'],
            ['첫 차 고객', '관리 잘 된 현대차로 입문합니다.'],
            ['다음 차', '가장 좋은 때, 현대차 신차로.'],
          ].map(([t, d]) => (
            <li key={t}>
              <b>{t}</b>
              <span>{d}</span>
            </li>
          ))}
        </ol>

        <div className="lp-tiles">
          {[
            ['현대 인증중고차', '검증된 자사 차량을 먼저 매입합니다.'],
            ['신차 재구매', '가장 좋은 때, 보상판매로 잇습니다.'],
            ['블루핸즈', '경고등이 정비 예약이 됩니다.'],
            ['현대캐피탈', '관리 잘 된 차는 잔존가치가 높습니다.'],
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
        <p className="lp-sub" data-reveal>
          관리 가능한 차량 자산의 표준, 현대차.
        </p>
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
