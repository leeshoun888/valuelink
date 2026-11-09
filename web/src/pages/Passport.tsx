// The vehicle passport a buyer (or Hyundai Certified Used Car) would see: identity, what was verified,
// how the car aged (mileage and battery health per month), and the hash chain that makes it tamper-evident.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { manwon } from '../engine/valuation'
import { sha256 } from '../engine/passport'
import { Logo } from '../ui/icons'
import './passport.css'

export default function PassportPage() {
  const boot = useStore((s) => s.boot)
  const snap = useStore((s) => s.snap)
  const rt = useStore((s) => s.runtime)
  useEffect(() => boot(), [boot])
  const [tamper, setTamper] = useState(false)

  const blocks = rt?.passport.blocks ?? []
  const monthly = useMemo(() => {
    const m = new Map<string, { km: number; soh: number }>()
    for (const b of blocks) m.set(b.day.slice(0, 7), { km: b.odometerKm, soh: b.sohPct ?? 100 })
    return [...m.entries()].map(([month, v]) => ({ month, ...v }))
  }, [blocks])

  // "Try to roll back the odometer": recompute the chain with one block edited and show where it breaks.
  const tampered = useMemo(() => {
    if (!tamper || blocks.length < 10) return null
    const k = blocks.length - 120
    const edited = blocks.map((b, i) => (i === k ? { ...b, odometerKm: b.odometerKm - 5000 } : b))
    let prev = '0'.repeat(64)
    let brokeAt = -1
    for (let i = 0; i < edited.length; i++) {
      const b = edited[i]
      const rec = JSON.stringify([b.day, +b.odometerKm.toFixed(1), +b.wheelKm.toFixed(1), b.sohPct === undefined ? null : +b.sohPct.toFixed(2), b.warnings, b.charges, b.fastCharges, b.guards, b.harsh])
      if (b.prev !== prev || sha256(prev + rec) !== b.hash) {
        brokeAt = i
        break
      }
      prev = b.hash
    }
    return { day: edited[k].day, brokeAt }
  }, [tamper, blocks])

  if (!snap || !rt) return <div className="pp-boot"><Logo size={44} /></div>
  const p = snap.passport
  const ok = p.chainOk && p.mileageOk
  const W = 640
  const H = 160
  const kmMax = Math.max(1, ...monthly.map((m) => m.km))
  const sohMin = Math.min(...monthly.map((m) => m.soh), 96)
  const x = (i: number) => 10 + (i / Math.max(1, monthly.length - 1)) * (W - 20)
  const yKm = (v: number) => H - 14 - (v / kmMax) * (H - 30)
  const ySoh = (v: number) => H - 14 - ((v - sohMin) / (100 - sohMin)) * (H - 30)

  return (
    <div className="pp">
      <nav className="pp-nav">
        <a href="#/" className="pp-brand">
          <Logo size={20} /> 밸류링크
        </a>
        <span>차량 여권</span>
        <a href="#/console">콘솔 ›</a>
      </nav>

      <header className="pp-head">
        <p className="pp-eyebrow">Vehicle Passport</p>
        <h1>
          {snap.sig.modelYear} {snap.model.name}
        </h1>
        <p className="pp-id mono">
          VIN {snap.sig.vin ?? '미확인'}
          {snap.vin ? ` · ${snap.vin.maker}${snap.vin.year ? ` ${snap.vin.year}년형` : ''}` : ''}
        </p>
        <div className={`pp-verdict ${ok ? 'ok' : 'bad'}`}>
          <b>{ok ? '이력 무결성 확인됨' : '검증 실패'}</b>
          <span>
            {p.days.toLocaleString()}일 · {p.blocks.toLocaleString()}개 블록 · 출고 {p.since}부터
          </span>
        </div>
      </header>

      <section className="pp-grid">
        <div className="pp-card">
          <small>주행거리</small>
          <b className="num">{Math.round(p.odometerKm).toLocaleString()} km</b>
          <span>바퀴 회전 수로 독립 검증 · 최대 오차 {(p.worstGap * 100).toFixed(1)}%</span>
        </div>
        <div className="pp-card">
          <small>배터리 건강도</small>
          <b className="num">{snap.battery.soh.toFixed(1)}%</b>
          <span>{snap.battery.sohSource === 'car' ? '차량 실측 (EV_CURRENT_BATTERY_CAPACITY)' : '추정'} · 같은 연식 평균 {snap.battery.expected.toFixed(1)}%</span>
        </div>
        <div className="pp-card">
          <small>사고 이력</small>
          <b>{snap.sig.airbagDeployed ? '에어백 전개 있음' : snap.sig.airbagDeployed === false ? '에어백 전개 없음' : '실차에서 확인'}</b>
          <span>Safety.hasSeatAirbagBeenDeployed</span>
        </div>
        <div className="pp-card">
          <small>경고등 · 정비</small>
          <b>{snap.warnings.length ? `${snap.warnings.length}개 미해결` : '미해결 없음'}</b>
          <span>경고등이 켜진 날과 해결된 날이 모두 기록됩니다</span>
        </div>
        <div className="pp-card">
          <small>충전 습관 (최근 30일)</small>
          <b className="num">급속 {(snap.battery.habits.fastShare * 100).toFixed(0)}% · 완충 {(snap.battery.habits.fullShare * 100).toFixed(0)}%</b>
          <span>연간 예상 열화 {snap.battery.fadeMine.toFixed(1)}%p (평균 {snap.battery.fadeAverage.toFixed(1)}%p)</span>
        </div>
        <div className="pp-card">
          <small>관리 점수 · 인증중고차 기준</small>
          <b className="num">{snap.links.careScore}점</b>
          <span>
            {snap.links.cpo.eligible ? `매입 기준(5년·10만km·무사고)까지 ${Math.floor(snap.links.cpo.monthsLeft / 12)}년 ${snap.links.cpo.monthsLeft % 12}개월 · ${snap.links.cpo.kmLeft.toLocaleString()}km` : '매입 기준 밖'}
          </span>
        </div>
        <div className="pp-card pub">
          <small>침수 노출 · 공공데이터 교차 검증</small>
          <b className="num">호우특보 {snap.exposure.alertDays}일 · 침수흔적 구역 체류 {snap.exposure.floodMin}분</b>
          <span>기상청 기상특보 × 행정안전부 침수흔적도 × 주차 기록 {snap.exposure.parks.toLocaleString()}회. 날마다 해시 사슬에 봉인</span>
        </div>
        <div className="pp-card pub">
          <small>리콜 · 배터리 이력</small>
          <b>
            {snap.pub.feed.recalls.length ? `리콜 ${snap.pub.feed.recalls.length}건 · ${snap.pub.feed.recalls.every((r) => r.fixedAt) ? '모두 조치 완료' : '미조치 있음'}` : '해당 리콜 없음'}
          </b>
          <span>
            {snap.pub.feed.recalls.map((r) => r.title).join(', ')} (시연 데이터, 출시 시 국토교통부 리콜정보 API 연동) · 배터리 이력관리 {snap.pub.feed.batteryRegistry ? '등록' : '미확인'} (2025.2.17 시행)
          </span>
        </div>
        <div className="pp-card">
          <small>여권 기준 예상 매입가</small>
          <b className="num">{snap.tradeIn ? manwon(snap.tradeIn.price) : manwon(snap.value.value)}</b>
          <span>검증 우대 +{snap.tradeIn ? (snap.tradeIn.premium * 100).toFixed(0) : 0}% 포함 (제휴 시나리오)</span>
        </div>
      </section>

      <section className="pp-chart">
        <div className="pp-chart-head">
          <h2>차가 나이 든 방식</h2>
          <span>
            <i className="km" /> 누적 주행거리 <i className="soh" /> 배터리 건강도
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 주행거리와 배터리 건강도">
          <path className="km" d={monthly.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${yKm(m.km)}`).join(' ')} />
          <path className="soh" d={monthly.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${ySoh(m.soh)}`).join(' ')} />
          <text x={10} y={H - 1}>{monthly[0]?.month}</text>
          <text x={W - 10} y={H - 1} textAnchor="end">
            {monthly.at(-1)?.month}
          </text>
        </svg>
      </section>

      <section className="pp-chain">
        <div className="pp-chart-head">
          <h2>해시 사슬</h2>
          <button className="pill secondary" onClick={() => setTamper(!tamper)}>
            {tamper ? '원래대로' : '주행거리 5,000km 되돌려 보기'}
          </button>
        </div>
        {tampered && (
          <p className="pp-tamper">
            {tampered.day} 블록의 주행거리를 바꾸자 {tampered.brokeAt >= 0 ? `#${tampered.brokeAt} 블록에서 사슬이 끊겼습니다.` : '변화가 감지되지 않았습니다.'} 조작은 숨길 수 없습니다.
          </p>
        )}
        <ol>
          {blocks
            .slice(-8)
            .reverse()
            .map((b) => (
              <li key={b.i}>
                <span className="num">#{b.i}</span>
                <b>{b.day}</b>
                <span className="num">{Math.round(b.odometerKm).toLocaleString()} km</span>
                <span className="num">{b.sohPct?.toFixed(2)}%</span>
                <code className="mono">{b.hash.slice(0, 16)}…</code>
              </li>
            ))}
        </ol>
        <p className="pp-head-hash mono">head {p.head}</p>
      </section>

      <footer className="pp-foot">
        블록은 차 안에서 하루 한 번 봉인되고, 각 블록은 이전 블록의 SHA-256을 포함합니다. 현대 인증중고차와 제휴하면 머리 해시를 서버에 앵커링해 구매자가 직접 검증할 수 있습니다.
      </footer>
    </div>
  )
}
