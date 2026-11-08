import type { RiskLevel } from '../engine/types'

export const LEVEL = [
  { name: '맑음', desc: '또렷한 상태예요', color: 'var(--l0)', hex: '#3CF2C8' },
  { name: '주의', desc: '졸음 신호가 보이기 시작해요', color: 'var(--l1)', hex: '#9BE15D' },
  { name: '졸음 신호', desc: '각성 유지가 필요해요', color: 'var(--l2)', hex: '#FFD04A' },
  { name: '휴식 필요', desc: '졸음운전 위험 구간이에요', color: 'var(--l3)', hex: '#FF9A3C' },
  { name: '위험', desc: '지금 바로 쉬어야 해요', color: 'var(--l4)', hex: '#FF3B4F' },
] as const

export const levelInfo = (l: RiskLevel) => LEVEL[l]

export function kssColor(kss: number): string {
  const stops: [number, [number, number, number]][] = [
    [1, [60, 242, 200]],
    [5, [155, 225, 93]],
    [6, [255, 208, 74]],
    [7, [255, 154, 60]],
    [8.5, [255, 59, 79]],
  ]
  if (kss <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`
  for (let i = 1; i < stops.length; i++) {
    if (kss <= stops[i][0]) {
      const [k0, c0] = stops[i - 1]
      const [k1, c1] = stops[i]
      const f = (kss - k0) / (k1 - k0)
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(',')})`
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`
}

/** Day theme (light Pleos palette): same ramp, darker so it reads on white. */
export function kssColorDay(kss: number): string {
  const stops: [number, [number, number, number]][] = [
    [1, [0, 163, 137]],
    [5, [90, 158, 16]],
    [6, [209, 143, 0]],
    [7, [234, 100, 12]],
    [8.5, [232, 50, 15]],
  ]
  if (kss <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`
  for (let i = 1; i < stops.length; i++) {
    if (kss <= stops[i][0]) {
      const [k0, c0] = stops[i - 1]
      const [k1, c1] = stops[i]
      const f = (kss - k0) / (k1 - k0)
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(',')})`
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`
}

export function co2ColorDay(ppm: number): string {
  if (ppm < 1000) return '#00A389'
  if (ppm < 2000) return '#D18F00'
  if (ppm < 3500) return '#EA640C'
  return '#E8320F'
}

export function co2Color(ppm: number): string {
  if (ppm < 1000) return '#3CF2C8'
  if (ppm < 2000) return '#FFD04A'
  if (ppm < 3500) return '#FF9A3C'
  return '#FF3B4F'
}

export const clock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const dur = (min: number | null) => {
  if (min === null) return '-'
  if (min < 1) return '지금'
  if (min < 60) return `${Math.round(min)}분`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}시간 ${m}분` : `${h}시간`
}
