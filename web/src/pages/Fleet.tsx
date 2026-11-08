// Fleet: what a lease / rental operator (e.g. Hyundai Capital) sees. Residual value is their balance-sheet
// risk; the same engine runs per vehicle on data the Pleos Fleet API webhooks already carry
// (Vehicle.Odometer, TractionBattery.SOC, WarningLamp.*, Acceleration.*). Simulated fleet, deterministic.

import { useMemo, useState } from 'react'
import { CATALOG, ageCurve, expectedSoh, manwon, valuate, won } from '../engine/valuation'
import { annualFade } from '../engine/battery'
import { careScore } from '../engine/links'
import { Logo } from '../ui/icons'
import './fleet.css'

interface Car {
  plate: string
  model: string
  ageYears: number
  km: number
  soh: number
  fast: number
  full: number
  harsh: number
  warnings: number
  guard: boolean
  value: number
  residualGap: number // 만원 vs contract residual
  kept: number // 원 this year by the guard
  fade: number
  care: number
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

function makeFleet(): Car[] {
  const r = rng(11)
  const ev = CATALOG.filter((c) => c.ev)
  return Array.from({ length: 36 }, (_, i) => {
    const m = ev[Math.floor(r() * ev.length)]
    const age = 0.4 + r() * 2.6
    const guard = i % 3 !== 0 // two thirds already run ValueLink
    const fast = guard ? 0.1 + r() * 0.2 : 0.3 + r() * 0.5
    const full = guard ? 0.05 + r() * 0.15 : 0.4 + r() * 0.5
    const hot = r() * 0.2
    const fade = annualFade({ sessions: 14, fastShare: fast, fullShare: full, hotShare: hot, deepDischarges: Math.floor(r() * 3) })
    const soh = 100 - fade * age
    const km = (12_000 + r() * 28_000) * age
    const harsh = guard ? r() * 3 : 2 + r() * 6
    const warnings = r() < 0.12 ? 1 : 0
    const v = valuate({ model: m, ageYears: age, odometerKm: km, sohPct: soh, activeWarnings: warnings, airbagDeployed: false, wearIndex: Math.min(1, harsh / 8), passportDays: guard ? Math.round(age * 365) : 0 })
    const contract = m.basePrice * ageCurve(age) * 0.93 // residual written into the lease contract [assumption]
    return {
      plate: `${10 + (i % 89)}${['하', '허', '호'][i % 3]} ${String(1000 + Math.floor(r() * 8999))}`,
      model: m.name,
      ageYears: age,
      km,
      soh,
      fast,
      full,
      harsh,
      warnings,
      guard,
      value: v.value,
      residualGap: v.value - contract,
      kept: guard ? 180_000 + r() * 260_000 : 0,
      fade,
      care: careScore({
        battery: { sessions: 14, fastShare: fast, fullShare: full, hotShare: hot, deepDischarges: 0 },
        habits: { km: 1000, harshAccelPer100: harsh / 2, harshBrakePer100: harsh / 2, adasPer100: 0, score: Math.round(Math.max(0, 100 - harsh * 7)), wearIndex: 0, wearWonPerKm: 0 },
        passport: { blocks: 1, days: guard ? Math.round(age * 365) : 0, chainOk: guard, mileageOk: guard, worstGap: 0, head: '' },
        activeWarnings: warnings,
      }),
    }
  })
}

type SortKey = 'residualGap' | 'soh' | 'harsh' | 'value' | 'care'

export default function Fleet() {
  const fleet = useMemo(makeFleet, [])
  const [sort, setSort] = useState<SortKey>('residualGap')
  const rows = [...fleet].sort((a, b) => (sort === 'harsh' ? b.harsh - a.harsh : a[sort] - b[sort]))
  const total = fleet.reduce((a, c) => a + c.value, 0)
  const gap = fleet.reduce((a, c) => a + c.residualGap, 0)
  const withG = fleet.filter((c) => c.guard)
  const without = fleet.filter((c) => !c.guard)
  const avgSoh = (cs: Car[]) => cs.reduce((a, c) => a + (c.soh - expectedSoh(c.ageYears)), 0) / cs.length
  const kept = fleet.reduce((a, c) => a + c.kept, 0)
  const risk = fleet.filter((c) => c.residualGap < 0 || c.warnings).length
  return (
    <div className="fl">
      <nav className="fl-nav">
        <a href="#/" className="fl-brand">
          <Logo size={20} /> 밸류링크 <span>Fleet</span>
        </a>
        <span>현대캐피탈 리스 · 렌터카 플릿 (시뮬레이션 36대)</span>
        <a href="#/console">콘솔 ›</a>
      </nav>
      <header className="fl-head">
        <p className="fl-eyebrow">잔존가치는 리스사의 리스크입니다</p>
        <h1>플릿 36대, 지금 가치 {manwon(total)}</h1>
        <p className="fl-sub">
          계약 잔존가치 대비 <b className="num">{gap >= 0 ? '+' : ''}{manwon(gap)}</b> · 올해 밸류링크가 지켜낸 가치 <b className="num">{won(kept)}</b> · 점검 필요 <b className="num">{risk}대</b>
        </p>
      </header>
      <section className="fl-compare">
        <div>
          <small>밸류링크 사용 차량 ({withG.length}대)</small>
          <b className="num">{avgSoh(withG) >= 0 ? '+' : ''}{avgSoh(withG).toFixed(1)}%p</b>
          <span>같은 연식 평균 대비 배터리 건강도</span>
        </div>
        <div>
          <small>미사용 차량 ({without.length}대)</small>
          <b className="num">{avgSoh(without) >= 0 ? '+' : ''}{avgSoh(without).toFixed(1)}%p</b>
          <span>급속·완충 습관이 그대로 남은 차</span>
        </div>
        <div>
          <small>데이터 경로</small>
          <b>Pleos Fleet API</b>
          <span>Webhook: Vehicle.Odometer · TractionBattery.SOC · WarningLamp.* · Acceleration.*</span>
        </div>
      </section>
      <section className="fl-table">
        <div className="fl-sort">
          {(
            [
              ['residualGap', '잔존가치 위험순'],
              ['care', '관리 점수순'],
              ['soh', '배터리 건강도순'],
              ['harsh', '운전 습관순'],
              ['value', '가치순'],
            ] as [SortKey, string][]
          ).map(([k, l]) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>차량</th>
              <th>관리 점수</th>
              <th>연식 · 주행</th>
              <th>배터리</th>
              <th>충전 습관</th>
              <th>급가속·급제동</th>
              <th>지금 가치</th>
              <th>계약 잔존가치 대비</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.plate}>
                <td>
                  <b>{c.plate}</b>
                  <span>
                    {c.model}
                    {c.guard ? ' · 밸류링크' : ''}
                  </span>
                </td>
                <td className="num">
                  <b>{c.care}</b>
                  <span>{c.care >= 85 ? '현대캐피탈 우대' : c.care >= 70 ? '양호' : '코칭 필요'}</span>
                </td>
                <td className="num">
                  {c.ageYears.toFixed(1)}년 · {Math.round(c.km / 1000).toLocaleString()}천km
                </td>
                <td className="num">
                  {c.soh.toFixed(1)}%<span>열화 {c.fade.toFixed(1)}%p/년</span>
                </td>
                <td className="num">
                  급속 {(c.fast * 100).toFixed(0)}% · 완충 {(c.full * 100).toFixed(0)}%
                </td>
                <td className="num">{c.harsh.toFixed(1)}/100km</td>
                <td className="num">{manwon(c.value)}</td>
                <td className={`num ${c.residualGap < 0 ? 'neg' : ''}`}>
                  {c.residualGap >= 0 ? '+' : ''}
                  {manwon(c.residualGap)}
                  {c.warnings ? <em>경고등</em> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="fl-foot">시뮬레이션 플릿입니다. 실차 연결 시 Pleos Fleet API Webhook이 차량별 엔진에 같은 신호를 공급합니다. 계수는 출품 시나리오의 가정값입니다.</p>
    </div>
  )
}
