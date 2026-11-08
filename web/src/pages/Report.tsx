// Trip report: what happened, what KKAEUM did, and an AI coach summary (Responses API).

import { useMemo, useState } from 'react'
import { useSim } from '../state/store'
import { clock, dur, kssColor, LEVEL } from '../ui/format'
import { Logo } from '../ui/icons'
import { TripChart } from '../console/Panels'
import '../console/console.css'
import './report.css'

export function Report() {
  const snap = useSim((s) => s.snap)
  const scenario = useSim((s) => s.scenario)
  const [coach, setCoach] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => {
    if (!snap) return null
    const h = snap.history
    const start = h[0]?.t ?? snap.sig.t
    const levelMin = [0, 0, 0, 0, 0]
    for (const p of h) levelMin[p.level] += 1
    const naps = snap.timeline.filter((e) => e.title.includes('파워냅') && e.title.includes('시작')).length
    const stops = snap.timeline.filter((e) => e.title.startsWith('경유지')).map((e) => e.title.replace('경유지 추가 · ', ''))
    const recircMin = h.filter((p) => p.recirc).length
    const peakCo2 = Math.max(0, ...h.map((p) => p.co2))
    return {
      scenario: scenario.title,
      start: clock(start),
      now: clock(snap.sig.t),
      durationMin: Math.round((snap.sig.t - start) / 60000),
      distanceKm: Math.round(snap.sig.routeProgressKm ?? 0),
      maxKss: +snap.stats.maxKss.toFixed(1),
      minutesAtLevel: levelMin,
      dangerMinutes: levelMin[3] + levelMin[4],
      interventions: snap.stats.interventions,
      naps,
      restStops: stops,
      peakCo2: Math.round(peakCo2),
      recirculationMinutes: recircMin,
      probes: snap.probes.map((p) => Math.round(p.reactionMs)),
    }
  }, [snap, scenario])

  async function askCoach() {
    if (!summary) return
    setBusy(true)
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/coach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) })
      const j = await r.json()
      setCoach(r.ok ? j.text : `AI 코치를 사용할 수 없어요: ${j.error ?? r.status}`)
    } catch {
      setCoach('AI 코치 서버(server/index.mjs)에 연결할 수 없어요.')
    } finally {
      setBusy(false)
    }
  }

  if (!snap || !summary)
    return (
      <div className="report empty">
        <Logo size={48} />
        <p>아직 주행 기록이 없어요. Mission Control에서 시뮬레이션을 실행한 뒤 돌아오세요.</p>
        <a className="btn primary" href="#/console">Mission Control 열기</a>
      </div>
    )

  const total = summary.minutesAtLevel.reduce((a, b) => a + b, 0) || 1
  return (
    <div className="report">
      <header className="rp-head">
        <a href="#/" className="tb-brand"><Logo size={24} /><b>깨움</b><span>Trip Report</span></a>
        <a className="btn" href="#/console">← Mission Control</a>
      </header>
      <h1>{summary.scenario}</h1>
      <p className="rp-sub">{summary.start} → {summary.now} · {dur(summary.durationMin)} · {summary.distanceKm}km</p>
      <div className="rp-kpis">
        <Kpi k="최고 졸음지수" v={summary.maxKss.toFixed(1)} c={kssColor(summary.maxKss)} />
        <Kpi k="위험 구간(L3+) 노출" v={`${summary.dangerMinutes}분`} c={summary.dangerMinutes ? 'var(--l3)' : 'var(--l0)'} />
        <Kpi k="깨움 개입" v={`${summary.interventions}회`} />
        <Kpi k="예측 휴식 · 파워냅" v={`${summary.restStops.length} · ${summary.naps}`} />
        <Kpi k="최고 실내 CO₂" v={`${summary.peakCo2.toLocaleString()}ppm`} />
      </div>
      <div className="rp-levels glass">
        <span className="eyebrow">상태별 주행 시간</span>
        <div className="lvbar">
          {summary.minutesAtLevel.map((m, i) => (
            <i key={i} style={{ flex: m, background: LEVEL[i].hex }} title={`${LEVEL[i].name} ${m}분`} />
          ))}
        </div>
        <div className="lvleg">
          {summary.minutesAtLevel.map((m, i) => (
            <span key={i}><i style={{ background: LEVEL[i].hex }} />{LEVEL[i].name} {Math.round((m / total) * 100)}%</span>
          ))}
        </div>
      </div>
      <TripChart />
      <div className="rp-coach glass">
        <div className="panel-h">
          <span className="eyebrow">AI 안전 코치 · GPT</span>
          <button className="btn primary" onClick={askCoach} disabled={busy}>{busy ? '분석 중…' : '리포트 생성'}</button>
        </div>
        {coach ? <div className="coach-md">{coach.split('\n').map((l, i) => <p key={i} className={l.startsWith('#') ? 'h' : ''}>{l.replace(/^#+\s*/, '').replace(/\*\*/g, '')}</p>)}</div> : <p className="rp-sub">주행 요약 데이터만 서버로 보내 개인화 리포트를 만듭니다 (위치·음성 원본 미전송).</p>}
      </div>
      <div className="rp-stops glass">
        <span className="eyebrow">들른 쉼터</span>
        <ul>{summary.restStops.length ? summary.restStops.map((s, i) => <li key={i}>{s}</li>) : <li>없음</li>}</ul>
      </div>
    </div>
  )
}

const Kpi = ({ k, v, c }: { k: string; v: string; c?: string }) => (
  <div className="kpi glass">
    <span>{k}</span>
    <b style={{ color: c }}>{v}</b>
  </div>
)
