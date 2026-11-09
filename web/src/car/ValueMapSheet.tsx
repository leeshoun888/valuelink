// 밸류맵: the asset risk of where the car stands, drawn from public data. A quiet, Apple-Maps-like plate
// (no tiles: it works offline in the car) with the layers that matter to the car's value, and the one action
// that lowers the risk most.

import type { Snapshot } from '../engine/runtime'
import { useStore } from '../state/store'
import { won } from '../engine/valuation'
import { clock } from '../ui/format'

const W = 640
const H = 560
const RANGE_M = 720

export function ValueMapSheet({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const m = snap.pub.map
  const rt = useStore((s) => s.runtime)
  if (!m) return null
  const k = (Math.min(W, H) / 2 - 24) / RANGE_M
  const cos = Math.cos((m.here.lat * Math.PI) / 180)
  const px = (p: { lat: number; lng: number }) => ({ x: W / 2 + (p.lng - m.here.lng) * cos * 111_320 * k, y: H / 2 - (p.lat - m.here.lat) * 110_540 * k })
  const f = snap.pub.feed
  const alert = f.alerts[0]
  const wx = f.weather
  const weather = alert ? alert.kind : wx.pty > 0 ? `비 ${wx.rain1hMm}mm/h` : wx.rainInMin !== undefined ? `${wx.rainInMin}분 뒤 비` : `${wx.tempC}℃ · 자외선 ${wx.uv}`
  return (
    <div className="jg-sheet-bg" onClick={onClose}>
      <div className="jg-sheet glass solid jg-vm" onClick={(e) => e.stopPropagation()}>
        <div className="jg-vm-map">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            <defs>
              <clipPath id="vmclip">
                <rect x="0" y="0" width={W} height={H} rx="28" />
              </clipPath>
              <pattern id="vmgrid" width="64" height="64" patternUnits="userSpaceOnUse">
                <path d="M64 0H0V64" className="grid" />
              </pattern>
            </defs>
            <g clipPath="url(#vmclip)">
              <rect width={W} height={H} className="plate" />
              <rect width={W} height={H} fill="url(#vmgrid)" />
              {!f.overlays?.length && (
                <>
                  <path d={`M0 ${H * 0.62} L${W} ${H * 0.38}`} className="road" />
                  <path d={`M${W * 0.36} 0 L${W * 0.52} ${H}`} className="road" />
                  <path d={`M0 ${H * 0.2} L${W} ${H * 0.28}`} className="road thin" />
                </>
              )}
              {f.overlays?.map((o) => {
                const a = px({ lat: o.north, lng: o.west })
                const b = px({ lat: o.south, lng: o.east })
                return <image key={o.url} href={o.url} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} preserveAspectRatio="none" className={`ov ${o.layer}`} />
              })}
              {m.zonesNear
                .filter((z) => z.radiusM > 0)
                .map((z) => {
                  const p = px(z)
                  return <circle key={z.id} cx={p.x} cy={p.y} r={z.radiusM * k} className={`zone ${z.kind}`} />
                })}
              {m.zonesNear.filter((z) => z.radiusM > 0).map((z) => {
                const p = px(z)
                const y = Math.min(H - 70, p.y + z.radiusM * k - 16)
                if (p.x < -40 || p.x > W + 40 || p.y < -z.radiusM * k || p.y > H + z.radiusM * k) return null
                return (
                  <text key={`t${z.id}`} x={Math.max(80, Math.min(W - 80, p.x))} y={y} className={`zlabel ${z.kind}`} textAnchor="middle">
                    {z.label}
                  </text>
                )
              })}
              {m.best &&
                (() => {
                  const b = px(m.best)
                  return <path d={`M${W / 2} ${H / 2} L${b.x} ${b.y}`} className="route" />
                })()}
              {m.lotsNear.filter((l) => l.public || l.id === m.best?.id).slice(0, 14).map((l) => {
                const p = px(l)
                const best = m.best?.id === l.id
                const here = m.lot?.id === l.id
                if (here) return null
                return (
                  <g key={l.id} transform={`translate(${p.x} ${p.y})`} className={`lot ${best ? 'best' : ''} lv-${l.risk.level}`}>
                    <rect x="-15" y="-15" width="30" height="30" rx="9" />
                    <text y="6" textAnchor="middle">P</text>
                    <text x="24" y="6" className="lname">
                      {l.name}
                    </text>
                  </g>
                )
              })}
              {f.chargers
                ?.filter((c) => c.epit)
                .map((c) => {
                  const p = px(c)
                  if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return null
                  return (
                    <g key={c.id} transform={`translate(${p.x} ${p.y})`} className="epit">
                      <circle r="14" />
                      <text y="5" textAnchor="middle">⚡</text>
                      <text x="22" y="6" className="lname">
                        {c.name} · 빈 {c.avail}/{c.total}
                      </text>
                    </g>
                  )
                })}
              <g transform={`translate(${W / 2} ${H / 2})`} className={`car lv-${m.level}`}>
                <circle r="34" className="halo" />
                <circle r="13" className="dot" />
              </g>
            </g>
          </svg>
          <div className="jg-vm-chips">
            <span>
              <i className="flood" />
              침수흔적
            </span>
            <span>
              <i className="theft" />
              범죄 주의
            </span>
            <span>
              <i className="accident" />
              사고다발
            </span>
            <span>
              <i className="lotk" />
              공영주차장
            </span>
          </div>
        </div>

        <div className="jg-vm-side">
          <p className="jg-label">
            밸류맵 · {m.lot?.name ?? snap.sig.placeName ?? '현재 위치'} · {weather}
          </p>
          <div className="jg-vm-score">
            <b className={`num lv-${m.level}`}>{m.score}</b>
            <div>
              <span className={`lvl lv-${m.level}`}>{m.level}</span>
              <small>
                24시간 기대손실 <b className="num">{won(m.expectedLoss)}</b>
              </small>
            </div>
          </div>
          <ul className="jg-vm-factors">
            {m.factors.length === 0 && <li className="none">침수·범죄·날씨 위험이 없는 자리예요.</li>}
            {m.factors.map((x) => (
              <li key={x.kind}>
                <div>
                  <b>{x.label}</b>
                  <span>{x.detail}</span>
                  <small>{x.source}</small>
                </div>
                {x.loss > 0 && <em className="num">−{won(x.p * x.loss)}</em>}
              </li>
            ))}
          </ul>
          {m.best && (
            <div className="jg-vm-best">
              <div>
                <small>
                  {Math.round(m.best.distanceM)}m · {m.best.level} · 안전 점수 {m.best.risk.score}
                </small>
                <b>{m.best.name}</b>
                <span>
                  기대손실 <b className="num">−{won(m.best.saved)}</b>
                </span>
              </div>
              <button
                className="pill primary"
                onClick={() => {
                  void rt?.bus.apply({ kind: 'searchPlace', value: m.best!.name, reason: '밸류맵 추천 주차장' })
                  onClose()
                }}
              >
                안내
              </button>
            </div>
          )}
          <div className="jg-vm-src">
            <p>
              {snap.pub.mode === 'live' ? `공공데이터 실시간 · ${f.region}` : f.overlays?.length ? '공공데이터 실데이터 캡처 (날씨·특보는 시연 시나리오)' : '공공데이터 스냅샷'} · 기상청 격자 {f.grid.nx},{f.grid.ny} · 지도 1km 타일 (정확한 위치는 차 밖으로 나가지 않아요)
            </p>
            <ul>
              {snap.pub.calls.slice(0, 4).map((c, i) => (
                <li key={i}>
                  <span className="num">{clock(c.t)}</span> {c.api} <em>{c.result}</em>
                </li>
              ))}
            </ul>
          </div>
          <button className="pill secondary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
