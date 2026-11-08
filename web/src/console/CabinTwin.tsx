/**
 * CabinTwin · real-time 3D "cabin digital twin" for the Mission Control console.
 *
 * Everything is procedural (no model files). Motion is GPU-driven: particle
 * systems animate in their vertex shaders from integrated clocks, so the CPU
 * only pushes a handful of uniforms per frame (no per-frame buffer uploads).
 *
 * Coordinate frame: +X = vehicle front, +Y = up, +Z = vehicle right
 * (driver sits on the left, -Z, as in a Korean LHD car). Units ≈ metres.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, RoundedBox } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { useSim } from '../state/store'
import type { Snapshot } from '../engine/runtime'
import './cabinTwin.css'

/* ════════════════════════════════════════════════════════════════════════
 * State normalisation (sim snapshot or demo loop)
 * ════════════════════════════════════════════════════════════════════════ */

type TwinMode = 'driving' | 'parked' | 'napping' | 'waking'

interface TwinState {
  co2: number
  recirc: boolean
  fan: number
  setTemp: number
  cabinTemp: number
  occupants: number
  ambColor: string
  ambBright: number
  recline: number
  seatVent: number
  window: number
  speed: number
  kss: number
  level: number
  mode: TwinMode
  live: boolean
}

function fromSnap(s: Snapshot): TwinState {
  const g = s.sig
  return {
    co2: s.co2,
    recirc: g.recirculation,
    fan: g.fanSpeed,
    setTemp: g.setTempC,
    cabinTemp: g.cabinTempC ?? g.setTempC,
    occupants: Math.max(1, Math.min(4, Math.round(g.occupants || 1))),
    ambColor: g.ambient?.color ?? '#3CF2C8',
    ambBright: g.ambient?.brightness ?? 40,
    recline: g.seatRecline ?? 12,
    seatVent: g.seatVentDriver ?? 0,
    window: g.windowOpenPct ?? 0,
    speed: g.speedKph,
    kss: s.est.kss,
    level: s.est.level,
    mode: s.mode as TwinMode,
    live: true,
  }
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 26-second demo loop: CO₂ builds up under recirculation, then fresh air flushes it. */
function demoState(t: number): TwinState {
  const T = 26
  const p = (t % T) / T
  const rising = p < 0.52
  let co2: number
  if (rising) co2 = 650 + 2350 * sstep(0.02, 0.5, p)
  else co2 = 3000 - 2200 * (1 - Math.pow(1 - (p - 0.52) / 0.48, 3))
  const kss = rising ? 4 + 3.6 * sstep(0.18, 0.5, p) : 7.6 - 3.6 * sstep(0.55, 0.85, p)
  const level = kss >= 8 ? 4 : kss >= 7 ? 3 : kss >= 6 ? 2 : kss >= 5 ? 1 : 0
  return {
    co2,
    recirc: rising,
    fan: rising ? 2 : 6,
    setTemp: 22,
    cabinTemp: rising ? 23.2 + p * 1.5 : 22.4,
    occupants: 2,
    ambColor: '#3CF2C8',
    ambBright: 55,
    recline: 12,
    seatVent: rising ? 0 : 2,
    window: 0,
    speed: 96,
    kss,
    level,
    mode: 'driving',
    live: false,
  }
}

const nowSec = () => performance.now() / 1000

function readTwin(): TwinState {
  const s = useSim.getState().snap
  return s ? fromSnap(s) : demoState(nowSec())
}

/* ════════════════════════════════════════════════════════════════════════
 * Colour helpers
 * ════════════════════════════════════════════════════════════════════════ */

const CO2_STOPS: [number, string][] = [
  [0, '#3CF2C8'],
  [1000, '#3CF2C8'],
  [2000, '#FFD04A'],
  [3500, '#FF9A3C'],
  [5000, '#FF3B4F'],
]
const CO2_COLS = CO2_STOPS.map(([p, c]) => [p, new THREE.Color(c)] as const)

function co2Color(ppm: number, out: THREE.Color) {
  for (let i = 0; i < CO2_COLS.length - 1; i++) {
    const [p0, c0] = CO2_COLS[i]
    const [p1, c1] = CO2_COLS[i + 1]
    if (ppm <= p1) return out.lerpColors(c0, c1, Math.max(0, (ppm - p0) / (p1 - p0)))
  }
  return out.copy(CO2_COLS[CO2_COLS.length - 1][1])
}
function co2Css(ppm: number) {
  // interpolate in sRGB for UI text
  for (let i = 0; i < CO2_STOPS.length - 1; i++) {
    const [p0, h0] = CO2_STOPS[i]
    const [p1, h1] = CO2_STOPS[i + 1]
    if (ppm <= p1) {
      const t = Math.max(0, (ppm - p0) / (p1 - p0))
      const a = parseInt(h0.slice(1), 16)
      const b = parseInt(h1.slice(1), 16)
      const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t)
      return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
    }
  }
  return CO2_STOPS[CO2_STOPS.length - 1][1]
}

const LEVEL_COLS = ['#3CF2C8', '#9BE15D', '#FFD04A', '#FF9A3C', '#FF3B4F'].map((c) => new THREE.Color(c))
const C_TEAL = new THREE.Color('#3CF2C8')
const C_BLUE = new THREE.Color('#5AB8FF')
const C_WARM = new THREE.Color('#FF9A5A')
const C_COOL = new THREE.Color('#EAF4FF')
const C_FRESH = new THREE.Color('#9FE8FF')
const C_RECIRC = new THREE.Color('#9B8CFF')
const C_PASSENGER = new THREE.Color('#5AB8FF')

/* ════════════════════════════════════════════════════════════════════════
 * Procedural body modelled on the Hyundai IONIQ 5 (the Pleos Connect emulator's
 * vehicle): lofted superellipse cross-sections along X, 1 unit ≈ 0.958 m.
 * Real figures → model: length 4,635 → 4.84, wheelbase 3,000 → 3.13,
 * overhangs 845 / 790 → 0.88 / 0.825, height 1,605 → 1.675, width 1,890 → 1.97,
 * track 1,638 → 1.71, tyre 255/45R20 (Ø737) → r 0.385.
 * Character: flat roof, near-vertical hatch, short clamshell hood, squared
 * wheel arches, diagonal "Z" door line, parametric-pixel lamps.
 * ════════════════════════════════════════════════════════════════════════ */

const HALF_L = 2.42
const BELT_Y = 1.15
const SQ_N = 6.5 // superellipse exponent of the cross-section (higher = boxier: flat IONIQ 5 flanks)
const WHEEL_X = [1.54, -1.595]
const WHEEL_Y = 0.385
const WHEEL_R = 0.385
const ARCH_R = 0.48
const TRACK_Z = 0.855

/** Fritsch–Carlson monotone cubic interpolation (no overshoot on the roofline). */
function monotone(xs: number[], ys: number[]) {
  const n = xs.length
  const d: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

// Roofline, rear → front (x ascending): upright hatch with a lip spoiler, long flat roof,
// fast windscreen, short clamshell hood falling to a blunt, squared nose.
// Side elevation of the IONIQ 5 (mm from the front bumper, height), measured off a true side photo
// scaled by its 737 mm tyres and the 845 / 3,000 / 790 mm overhang-wheelbase split:
// tail (4,635, 860) · lamp band (4,600, 980) · raked rear glass (4,430, 1,185)→(3,950, 1,545) ·
// roof to the lip spoiler (3,800, 1,585)–(2,300, 1,600) · header (1,950, 1,585) · cowl (1,100, 1,140) ·
// rising clamshell hood (700, 1,020)→(80, 860) · nose (0, 800). Model: x = 2.42 − mm·0.001044, y = mm·0.001044.
const TOP_PTS: [number, number][] = [
  [-2.42, 0.86],
  [-2.405, 0.94],
  [-2.382, 1.023],
  [-2.309, 1.107],
  [-2.205, 1.237],
  [-1.913, 1.482],
  [-1.704, 1.613],
  [-1.547, 1.655],
  [-1.2, 1.672],
  [-0.712, 1.676],
  [0.019, 1.67],
  [0.384, 1.655],
  [0.645, 1.514],
  [0.958, 1.336],
  [1.272, 1.19],
  [1.689, 1.065],
  [2.055, 0.971],
  [2.336, 0.898],
  [2.42, 0.835],
]
const topAt = monotone(
  TOP_PTS.map((p) => p[0]),
  TOP_PTS.map((p) => p[1]),
)

/** Squared IONIQ 5 wheel-arch opening: flat top, chamfered corners. */
function archTop(dx: number) {
  const a = Math.abs(dx)
  if (a >= ARCH_R) return -Infinity
  const flat = ARCH_R * 0.6
  if (a <= flat) return WHEEL_Y + ARCH_R * 0.92
  const f = (a - flat) / (ARCH_R - flat)
  return WHEEL_Y + ARCH_R * (0.92 - 0.55 * Math.pow(f, 1.5))
}

function botAt(x: number) {
  // sill cladding ≈ 210 mm; front lip 260 mm (17.5° approach); rear bumper 400 mm (25.4° departure)
  let b = 0.22 + 0.06 * sstep(2.0, 2.42, x) + 0.2 * sstep(1.9, 2.42, -x)
  for (const cx of WHEEL_X) b = Math.max(b, archTop(x - cx))
  return b
}
const widthAt = (x: number) => 0.985 * (1 - 0.07 * sstep(1.55, 2.42, x) - 0.04 * sstep(1.7, 2.42, -x))
const tumble = (y: number) => 1 - 0.27 * sstep(BELT_Y - 0.02, 1.62, y)

function profile(x: number) {
  const ax = Math.min(1, Math.abs(x) / HALF_L)
  // The hatch is almost flat (high exponent); the nose rounds off a little more.
  const e = x < 0 ? 34 : 22
  const sh = Math.max(0.02, Math.sqrt(1 - Math.pow(ax, e)))
  const sw = Math.max(0.02, Math.sqrt(1 - Math.pow(ax, x < 0 ? 14 : 12)))
  const top = topAt(x)
  const bot = botAt(x)
  const cy = (top + bot) / 2
  return { top, bot, cy, b: ((top - bot) / 2) * sh, a: widthAt(x) * sw }
}

/** Half-width (|z|) of the body surface at (x, y). */
function sideZ(x: number, y: number) {
  const p = profile(x)
  const t = Math.min(1, Math.max(-1, (y - p.cy) / p.b))
  const sAbs = Math.pow(Math.abs(t), SQ_N / 2)
  const cAbs = Math.sqrt(Math.max(0, 1 - sAbs * sAbs))
  return p.a * Math.pow(cAbs, 2 / SQ_N) * tumble(y)
}

function surfacePoint(x: number, theta: number, out: THREE.Vector3) {
  const p = profile(x)
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const y = p.cy + p.b * Math.sign(s) * Math.pow(Math.abs(s), 2 / SQ_N)
  const z = p.a * Math.sign(c) * Math.pow(Math.abs(c), 2 / SQ_N) * tumble(y)
  return out.set(x, y, z)
}

/** Outermost body x (front: max, rear: min) at height y and half-width |z|. */
function faceX(y: number, z: number, front: boolean) {
  const dir = front ? -1 : 1
  for (let x = front ? HALF_L : -HALF_L; Math.abs(x) > 1.6; x += dir * 0.002) {
    const p = profile(x)
    if (y > p.bot && y < p.top && sideZ(x, y) >= Math.abs(z)) return x
  }
  return front ? 1.6 : -1.6
}

function buildBodyGeometry(U = 170, V = 80) {
  const pos = new Float32Array(U * V * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < U; i++) {
    const x = -HALF_L * Math.cos((Math.PI * i) / (U - 1))
    for (let j = 0; j < V; j++) {
      surfacePoint(x, (Math.PI * 2 * j) / V, v)
      const k = (i * V + j) * 3
      pos[k] = v.x
      pos[k + 1] = v.y
      pos[k + 2] = v.z
    }
  }
  const idx: number[] = []
  for (let i = 0; i < U - 1; i++)
    for (let j = 0; j < V; j++) {
      const a = i * V + j
      const b = (i + 1) * V + j
      const c = i * V + ((j + 1) % V)
      const d = (i + 1) * V + ((j + 1) % V)
      idx.push(a, b, c, b, d, c)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** Blueprint feature lines: [strong, faint] line-segment geometries. */
function buildFeatureLines() {
  const strong: number[] = []
  const faint: number[] = []
  const pushPath = (arr: number[], pts: THREE.Vector3[], closed = false) => {
    for (let i = 0; i < pts.length - 1; i++) arr.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z)
    if (closed && pts.length > 2) {
      const a = pts[pts.length - 1]
      const b = pts[0]
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  const OUT = 1.006
  const onSide = (x: number, y: number, side: number) => new THREE.Vector3(x, y, side * sideZ(x, y) * OUT)
  const line = (arr: number[], x0: number, y0: number, x1: number, y1: number, side: number, n = 24) => {
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= n; k++) pts.push(onSide(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, side))
    pushPath(arr, pts)
  }

  // Cross-section ribs
  for (const x of [-2.1, -1.6, -1.0, -0.4, 0.2, 0.8, 1.4, 2.0]) {
    const pts: THREE.Vector3[] = []
    for (let j = 0; j <= 64; j++) pts.push(surfacePoint(x, (Math.PI * 2 * j) / 64, new THREE.Vector3()))
    pushPath(faint, pts)
  }
  // Longitudinal iso-lines
  for (const th of [Math.PI / 2, 0.42, Math.PI - 0.42, -0.28, Math.PI + 0.28, 1.05, Math.PI - 1.05]) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 120; i++) {
      const x = -HALF_L * 0.985 * Math.cos((Math.PI * i) / 120)
      const p = surfacePoint(x, th, new THREE.Vector3())
      pts.push(p.setZ(p.z * OUT))
    }
    pushPath(faint, pts)
  }

  // Daylight opening: windscreen base (cowl) to the rear quarter glass
  const dloTop = (x: number) => topAt(x) - 0.07
  let xf = 0.2
  for (let x = 0.2; x < 1.4; x += 0.005) if (dloTop(x) > BELT_Y + 0.03) xf = x
  const xr = -1.3

  for (const side of [-1, 1]) {
    // Beltline (straight, IONIQ 5 keeps it flat to the hatch)
    const belt: THREE.Vector3[] = []
    for (let x = -2.3; x <= 1.0; x += 0.04) belt.push(onSide(x, BELT_Y - 0.01, side))
    pushPath(strong, belt)
    // Daylight opening
    const dlo: THREE.Vector3[] = []
    for (let x = xr + 0.1; x <= xf; x += 0.04) dlo.push(onSide(x, BELT_Y + 0.025, side))
    for (let x = xf; x >= xr; x -= 0.03) dlo.push(onSide(x, Math.max(BELT_Y + 0.025, dloTop(x)), side))
    pushPath(strong, dlo, true)
    // B pillar (paired) and the broad C pillar ahead of the quarter glass
    for (const [px, w] of [[-0.16, 0.045]] as const) {
      for (const off of [-w, w]) {
        const x = px + off
        const pl: THREE.Vector3[] = []
        for (let y = BELT_Y + 0.025; y <= dloTop(x); y += 0.03) pl.push(onSide(x, y, side))
        pl.push(onSide(x, dloTop(x), side))
        pushPath(strong, pl)
      }
    }
    // Clamshell hood shut line: wraps from the nose along the fender to the A-pillar base
    const clam: THREE.Vector3[] = []
    for (let x = 2.32; x >= 1.27; x -= 0.03) clam.push(onSide(x, topAt(x) - 0.045, side))
    pushPath(strong, clam)
    // Diagonal "Z" character line across the doors (low at the front door, rising toward the rear arch)
    line(strong, 1.05, 0.52, -1.1, 0.9, side, 40)
    line(faint, -1.1, 0.9, -1.2, 0.9, side, 4)
    // Door shut lines
    for (const [x0, x1] of [
      [1.07, 1.02],
      [-0.16, -0.18],
      [-1.06, -1.3],
    ] as const)
      line(faint, x0, 0.47, x1, BELT_Y - 0.02, side, 12)
    // Squared wheel arches with their black cladding edge
    for (const cx of WHEEL_X) {
      const arch: THREE.Vector3[] = []
      for (let k = 0; k <= 48; k++) {
        const dx = -ARCH_R + (2 * ARCH_R * k) / 48
        const y = Math.max(archTop(dx * 0.999) + 0.035, 0.44)
        arch.push(onSide(cx + dx * 1.05, y, side))
      }
      pushPath(strong, arch)
    }
    // Rocker / lower cladding
    line(faint, -1.05, 0.34, 1.0, 0.34, side, 30)
    // Side mirror (on the door, just behind the A-pillar base)
    const mz = side * (sideZ(1.2, 1.2) + 0.02)
    const mo = side * 0.17
    const m = [
      [1.26, 1.19, mz],
      [1.26, 1.3, mz],
      [1.14, 1.31, mz + mo],
      [1.12, 1.21, mz + mo],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z))
    pushPath(strong, m, true)
  }

  // Rear lip spoiler across the roof end
  const sp: THREE.Vector3[] = []
  for (let z = -0.72; z <= 0.72; z += 0.06) sp.push(new THREE.Vector3(-1.66, 1.665, z))
  pushPath(strong, sp)
  sp.length = 0
  for (let z = -0.72; z <= 0.72; z += 0.06) sp.push(new THREE.Vector3(-1.86, 1.6, z))
  pushPath(strong, sp)
  // Tailgate glass bottom and the black pixel-lamp band
  for (const y of [1.2, 1.08, 0.96]) {
    const pts: THREE.Vector3[] = []
    for (let z = -0.84; z <= 0.84; z += 0.04) pts.push(new THREE.Vector3(faceX(y, z, false) - 0.004, y, z))
    pushPath(y === 1.2 ? strong : faint, pts)
  }
  // Front: clamshell leading edge and the lower intake
  for (const [y, w, arr] of [
    [0.865, 0.82, strong],
    [0.56, 0.6, faint],
    [0.44, 0.66, faint],
  ] as const) {
    const pts: THREE.Vector3[] = []
    for (let z = -w; z <= w + 1e-6; z += 0.04) pts.push(new THREE.Vector3(faceX(y, z, true) + 0.004, y, z))
    pushPath(arr, pts)
  }

  const mk = (arr: number[]) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    return g
  }
  return [mk(strong), mk(faint)] as const
}

/**
 * Parametric-pixel lamps: a grid of small squares on the body face.
 * Front: one rectangular cluster at each corner. Rear: a cluster at each end of the tailgate band
 * plus a thin row of pixels joining them.
 */
function lightBar(front: boolean) {
  const pos: number[] = []
  const px = 0.034
  const gap = 0.012
  const quad = (y: number, z: number) => {
    const x = faceX(y, z, front) + (front ? 0.006 : -0.006)
    const h = px / 2
    const a = [x, y - h, z - h]
    const b = [x, y - h, z + h]
    const c = [x, y + h, z + h]
    const d = [x, y + h, z - h]
    pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  const cluster = (y0: number, rows: number, z0: number, cols: number, dir: number) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) quad(y0 + r * (px + gap), dir * (z0 + c * (px + gap)))
  }
  for (const dir of [-1, 1]) {
    if (front) cluster(0.77, 3, 0.52, 7, dir)
    else {
      cluster(1.0, 2, 0.48, 8, dir)
      for (let z = -0.42; z <= 0.42 + 1e-6; z += px + gap) if (dir === 1) quad(1.023, z)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

function ambientStrip() {
  const pts: THREE.Vector3[] = []
  const y = BELT_Y - 0.06
  const inner = (x: number) => sideZ(x, y) * 0.88
  // dashboard (right → left), left door (front → rear), rear, right door
  for (let z = 0.62; z >= -0.62; z -= 0.155) pts.push(new THREE.Vector3(0.86, y - 0.05, z))
  for (let x = 0.62; x >= -1.85; x -= 0.31) pts.push(new THREE.Vector3(x, y, -inner(x)))
  for (let z = -0.5; z <= 0.5; z += 0.25) pts.push(new THREE.Vector3(-2.02, y + 0.02, z))
  for (let x = -1.85; x <= 0.62; x += 0.31) pts.push(new THREE.Vector3(x, y, inner(x)))
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 260, 0.012, 6, true)
}

/* ════════════════════════════════════════════════════════════════════════
 * Shaders
 * ════════════════════════════════════════════════════════════════════════ */

const SHELL_VS = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`
const SHELL_FS = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uRim;
uniform float uBase;
uniform float uFade;
uniform float uScan;
uniform float uScanAmt;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = dot(N, V);
  N *= sign(ndv);
  float f = pow(1.0 - abs(ndv), 3.0);
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, normalize(vec3(0.25, 1.0, 0.35))), 0.0), 48.0);
  float spec2 = pow(max(dot(R, normalize(vec3(-0.8, 0.35, -0.5))), 0.0), 90.0);
  float scan = exp(-pow((vWorld.x - uScan) * 7.0, 2.0)) * uScanAmt;
  vec3 col = uTint + uRim * (f * 1.35 + scan * 0.7) + vec3(0.85, 0.95, 1.0) * (spec * 0.55 + spec2 * 0.35);
  float a = uBase + f * 0.6 + spec * 0.45 + spec2 * 0.3 + scan * 0.12;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uFade);
  #include <colorspace_fragment>
}`

const HOLO_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`
const HOLO_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  vec3 col = uColor * (0.14 + f * 1.25) * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

const PARTICLE_FS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`

const CO2_VS = /* glsl */ `
attribute vec4 aSeed;
uniform float uClock;
uniform float uFrac;
uniform float uOpacity;
uniform float uSize;
uniform float uViewH;
uniform vec3 uMin;
uniform vec3 uMax;
varying float vAlpha;
vec3 flow(vec3 p, float t) {
  return vec3(
    sin(p.y * 2.1 + t * 0.7) + cos(p.z * 1.7 - t * 0.5),
    sin(p.z * 2.3 + t * 0.6) + cos(p.x * 1.3 + t * 0.4),
    sin(p.x * 1.9 - t * 0.8) + cos(p.y * 2.7 + t * 0.3));
}
void main() {
  float t = uClock + aSeed.w * 40.0;
  vec3 q = aSeed.xyz * 6.2831;
  vec3 d = flow(q, t) * 0.035 + flow(q * 1.9 + 3.1, t * 1.4) * 0.015;
  vec3 p = fract(aSeed.xyz + d + vec3(-uClock * 0.006, uClock * 0.0025, uClock * 0.0015));
  vec3 pos = mix(uMin, uMax, p);
  pos.z *= 1.0 - 0.24 * smoothstep(1.1, 1.6, pos.y);
  float edge = min(min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)), min(p.z, 1.0 - p.z));
  float vis = step(aSeed.w, uFrac);
  float tw = 0.65 + 0.35 * sin(t * 2.3 + aSeed.x * 20.0);
  vAlpha = uOpacity * vis * smoothstep(0.0, 0.08, edge) * tw;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.55 + 0.9 * fract(aSeed.w * 7.31));
  gl_PointSize = vis * sz * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
}`

const FLOW_VS = /* glsl */ `
attribute vec4 aLane;   // x: lateral -1..1, y: spread 0..1, z: phase, w: rand
attribute float aTrail; // 0 head .. 1 tail
uniform float uFlow;
uniform float uMix;     // 0 fresh .. 1 recirculation
uniform float uWindow;  // 0..1
uniform float uAlpha;
uniform float uSize;
uniform float uViewH;
varying float vAlpha;
void main() {
  float sp = 0.75 + 0.5 * aLane.w;
  float s = fract(aLane.z + uFlow * sp - aTrail * 0.03);
  float isWin = step(0.84, aLane.w);
  // fresh air: cowl vents → over the occupants → rear extraction
  vec3 fresh = vec3(
    mix(1.02, -2.2, s),
    1.08 + 0.44 * sin(s * 3.14159) * (0.55 + 0.45 * aLane.y) - 0.18 * s * s,
    aLane.x * (0.18 + 0.52 * smoothstep(0.0, 0.3, s)) + 0.035 * sin(s * 14.0 + aLane.w * 6.0));
  float fa = smoothstep(0.0, 0.05, s) * smoothstep(1.0, 0.82, s);
  // recirculation: closed swirl loop
  float ph = 6.28318 * s;
  float rr = 0.6 + 0.4 * aLane.y;
  vec3 loopP = vec3(
    -0.45 + 1.25 * rr * cos(ph),
    1.08 + 0.3 * rr * sin(ph),
    aLane.x * 0.6 + 0.05 * sin(ph * 3.0 + aLane.w * 6.0));
  vec3 pos = mix(fresh, loopP, uMix);
  float a = mix(fa, 0.75, uMix);
  // driver window inflow
  vec3 win = vec3(0.32 - 1.5 * s, 1.3 - 0.28 * s + 0.05 * sin(s * 9.0 + aLane.w * 5.0), -0.8 + 0.85 * s * (0.5 + 0.5 * aLane.y));
  pos = mix(pos, win, isWin);
  a = mix(a, smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.6, s) * uWindow, isWin);
  float tail = 1.0 - aTrail;
  vAlpha = a * tail * tail * uAlpha;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.35 + 0.65 * tail) * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
}`

const WISP_VS = /* glsl */ `
attribute vec4 aSeed;
uniform float uClock;
uniform float uFrac;
uniform float uSize;
uniform float uViewH;
uniform vec3 uOrigin;
varying float vAlpha;
void main() {
  float s = fract(aSeed.z + uClock * (0.25 + 0.2 * aSeed.w));
  float vis = step(aSeed.w, uFrac);
  vec3 pos = uOrigin + vec3(
    (aSeed.x - 0.5) * 0.42 + 0.04 * sin(s * 9.0 + aSeed.w * 10.0),
    s * 0.55,
    (aSeed.y - 0.5) * 0.36 + 0.04 * cos(s * 7.0 + aSeed.w * 8.0));
  vAlpha = sin(s * 3.14159) * vis * 0.55;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vis * uSize * (0.6 + s) * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
}`

const GROUND_VS = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`
const GROUND_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uScroll;
uniform float uPulse;
uniform float uFade;
varying vec2 vP;
float gridLine(vec2 p, float scale) {
  vec2 q = p * scale;
  vec2 g = abs(fract(q) - 0.5) / fwidth(q);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float r = length(vP / vec2(3.15, 2.0));
  float shadow = smoothstep(0.8, 0.1, r) * 0.32;
  float contact = smoothstep(0.62, 0.3, length(vP / vec2(2.6, 1.0))) * 0.3;
  float fade = smoothstep(1.35, 0.25, r);
  float grid = gridLine(vP + vec2(uScroll, 0.0), 2.0) * 0.22 * fade;
  float ring = smoothstep(0.012, 0.0, abs(r - 0.96)) * 0.45;
  float ring2 = smoothstep(0.008, 0.0, abs(r - 1.12)) * 0.18;
  float pr = fract(uPulse);
  float pulse = smoothstep(0.03, 0.0, abs(r - pr * 1.4)) * (1.0 - pr) * 0.5;
  vec3 glow = uColor * (grid + ring + ring2 + pulse) * uFade;
  gl_FragColor = vec4(glow, clamp(shadow + contact, 0.0, 0.85));
  #include <colorspace_fragment>
}`

/* ════════════════════════════════════════════════════════════════════════
 * Live (smoothed) state shared by all scene parts
 * ════════════════════════════════════════════════════════════════════════ */

interface Live {
  t: number
  co2: number
  recircMix: number
  fan: number
  recline: number
  seatVent: number
  window: number
  speed: number
  kss: number
  nap: number
  wake: number
  breath: number
  occ: number[] // per-seat visibility 0..1
  amb: THREE.Color
  ambBright: number
  rim: THREE.Color
  rimGain: number
  driver: THREE.Color
  co2Col: THREE.Color
  flowClock: number
  co2Clock: number
  wispClock: number
  wheelAngle: number
  scroll: number
}

const _tmpC = new THREE.Color()
const _tmpC2 = new THREE.Color()

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Scene parts
 * ════════════════════════════════════════════════════════════════════════ */

type LiveRef = MutableRefObject<Live>

function Body({ live, reduced }: { live: LiveRef; reduced: boolean }) {
  const geo = useMemo(() => buildBodyGeometry(), [])
  const [strongGeo, faintGeo] = useMemo(() => buildFeatureLines(), [])
  const headGeo = useMemo(() => lightBar(true), [])
  const tailGeo = useMemo(() => lightBar(false), [])

  const mats = useMemo(() => {
    const mk = (side: THREE.Side, base: number) =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VS,
        fragmentShader: SHELL_FS,
        transparent: true,
        depthWrite: false,
        side,
        uniforms: {
          uTint: { value: new THREE.Color('#06101c') },
          uRim: { value: new THREE.Color('#3CF2C8') },
          uBase: { value: base },
          uFade: { value: 1 },
          uScan: { value: -3 },
          uScanAmt: { value: 0 },
        },
      })
    return {
      back: mk(THREE.BackSide, 0.14),
      front: mk(THREE.FrontSide, 0.07),
      strong: new THREE.LineBasicMaterial({ color: '#3CF2C8', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      faint: new THREE.LineBasicMaterial({ color: '#5AB8FF', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      head: new THREE.MeshBasicMaterial({ color: '#E6F7FF', toneMapped: false, transparent: true, side: THREE.DoubleSide }),
      tail: new THREE.MeshBasicMaterial({ color: '#FF3B4F', toneMapped: false, transparent: true, side: THREE.DoubleSide }),
    }
  }, [])

  useEffect(
    () => () => {
      geo.dispose()
      strongGeo.dispose()
      faintGeo.dispose()
      headGeo.dispose()
      tailGeo.dispose()
      Object.values(mats).forEach((m) => m.dispose())
    },
    [geo, strongGeo, faintGeo, headGeo, tailGeo, mats],
  )

  useFrame(() => {
    const L = live.current
    const scanPeriod = 7
    const ph = (L.t % scanPeriod) / scanPeriod
    const scanX = 2.9 - ph * 5.8
    const scanAmt = reduced ? 0 : Math.sin(Math.min(1, ph * 1.15) * Math.PI) * (1 - L.nap * 0.7)
    for (const m of [mats.back, mats.front]) {
      ;(m.uniforms.uRim.value as THREE.Color).copy(L.rim).multiplyScalar(L.rimGain)
      m.uniforms.uScan.value = scanX
      m.uniforms.uScanAmt.value = scanAmt
      m.uniforms.uFade.value = 0.75 + 0.25 * L.rimGain
    }
    mats.strong.color.copy(L.rim)
    mats.strong.opacity = 0.75 * L.rimGain
    mats.faint.color.lerpColors(C_BLUE, L.rim, 0.35 + 0.65 * L.nap)
    mats.faint.opacity = 0.16 * L.rimGain
    const lampGain = 1 - 0.75 * L.nap
    mats.head.color.set('#E6F7FF').multiplyScalar(1.6 * lampGain + L.wake * 0.8)
    mats.tail.color.set('#FF3B4F').multiplyScalar(1.4 * lampGain)
  })

  return (
    <group>
      <mesh geometry={geo} material={mats.back} renderOrder={1} />
      <mesh geometry={geo} material={mats.front} renderOrder={20} />
      <lineSegments geometry={strongGeo} material={mats.strong} renderOrder={21} />
      <lineSegments geometry={faintGeo} material={mats.faint} renderOrder={21} />
      <mesh geometry={headGeo} material={mats.head} renderOrder={22} />
      <mesh geometry={tailGeo} material={mats.tail} renderOrder={22} />
    </group>
  )
}

function Wheels({ live }: { live: LiveRef }) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const parts = useMemo(() => {
    // 255/45R20: Ø737 tyre (r 0.385), 20" rim (r 0.265), 255 mm tread (0.266) with low, square shoulders.
    const prof = [
      [0.262, -0.118],
      [0.3, -0.13],
      [0.352, -0.133],
      [0.374, -0.124],
      [0.384, -0.104],
      [WHEEL_R, 0],
      [0.384, 0.104],
      [0.374, 0.124],
      [0.352, 0.133],
      [0.3, 0.13],
      [0.262, 0.118],
    ].map(([r, y]) => new THREE.Vector2(r, y))
    const tire = new THREE.LatheGeometry(prof, 72)
    tire.rotateX(Math.PI / 2)
    // Aero rim face: outer lip ring, five V-pairs of slim spokes, an inner ring and the hub.
    const rim = new THREE.RingGeometry(0.228, 0.262, 72)
    const hub = new THREE.CircleGeometry(0.058, 36)
    const inner = new THREE.RingGeometry(0.135, 0.152, 60)
    // Swept blade, offset from the radius so 18 of them read as the IONIQ 5's turbine-style 20" wheel.
    const spoke = new THREE.BoxGeometry(0.165, 0.014, 0.02)
    spoke.translate(0.15, 0.028, 0)
    const barrel = new THREE.CylinderGeometry(0.262, 0.262, 0.22, 48, 1, true)
    barrel.rotateX(Math.PI / 2)
    const ringPts: number[] = []
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2
      ringPts.push(Math.cos(a) * 0.262, Math.sin(a) * 0.262, 0)
    }
    const ring = new THREE.BufferGeometry()
    ring.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3))
    // Holographic outline of the 18 swept turbine blades (both edges), the inner ring and the hub.
    const bladePts: number[] = []
    for (let k = 0; k < 18; k++) {
      for (const edge of [0, 0.075]) {
        let prev: [number, number] | null = null
        for (let t = 0; t <= 1.0001; t += 0.125) {
          const r = 0.07 + t * 0.165
          const a = (k / 18) * Math.PI * 2 + edge + t * 0.55
          const pt: [number, number] = [Math.cos(a) * r, Math.sin(a) * r]
          if (prev) bladePts.push(prev[0], prev[1], 0, pt[0], pt[1], 0)
          prev = pt
        }
      }
    }
    for (const r of [0.058, 0.145]) {
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2
        const a1 = ((k + 1) / 48) * Math.PI * 2
        bladePts.push(Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0)
      }
    }
    const blades = new THREE.BufferGeometry()
    blades.setAttribute('position', new THREE.Float32BufferAttribute(bladePts, 3))
    const bladeMat = new THREE.LineBasicMaterial({ color: '#3CF2C8', transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const tireMat = new THREE.MeshStandardMaterial({ color: '#07090d', roughness: 0.6, metalness: 0.2 })
    const rimMat = new THREE.MeshStandardMaterial({ color: '#1a2230', roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide })
    const ringMat = new THREE.LineBasicMaterial({ color: '#3CF2C8', transparent: true, opacity: 0.7, toneMapped: false })
    return { tire, rim, hub, inner, spoke, barrel, ring, blades, tireMat, rimMat, ringMat, bladeMat }
  }, [])
  useEffect(
    () => () => {
      Object.values(parts).forEach((p) => p.dispose())
    },
    [parts],
  )
  useFrame(() => {
    const L = live.current
    for (const g of refs.current) if (g) g.rotation.z = -L.wheelAngle
    parts.ringMat.color.copy(L.rim)
    parts.ringMat.opacity = 0.7 * L.rimGain
    parts.bladeMat.color.copy(L.rim)
    parts.bladeMat.opacity = 0.38 * L.rimGain
  })
  const spots: [number, number][] = []
  for (const x of WHEEL_X) for (const s of [-1, 1]) spots.push([x, s])
  return (
    <group>
      {spots.map(([x, s], i) => (
        <group key={i} position={[x, WHEEL_Y, s * TRACK_Z]}>
          <mesh geometry={parts.tire} material={parts.tireMat} />
          <mesh geometry={parts.barrel} material={parts.rimMat} />
          <group ref={(el) => void (refs.current[i] = el)} position={[0, 0, s * 0.1]}>
            <mesh geometry={parts.rim} material={parts.rimMat} />
            <mesh geometry={parts.inner} material={parts.rimMat} />
            <mesh geometry={parts.hub} material={parts.rimMat} />
            {Array.from({ length: 18 }, (_, k) => (
              <mesh key={k} geometry={parts.spoke} material={parts.rimMat} rotation={[0, 0, (k / 18) * Math.PI * 2 * -s]} scale={[1, s, 1]} />
            ))}
            <lineLoop geometry={parts.ring} material={parts.ringMat} position={[0, 0, s * 0.012]} />
            <lineSegments geometry={parts.blades} material={parts.bladeMat} position={[0, 0, s * 0.014]} scale={[1, s, 1]} />
          </group>
        </group>
      ))}
    </group>
  )
}

const SEATS: { x: number; z: number }[] = [
  { x: 0.1, z: -0.4 }, // driver (front-left)
  { x: 0.1, z: 0.4 }, // front passenger
  { x: -0.95, z: 0.4 }, // rear right
  { x: -0.95, z: -0.4 }, // rear left
]

function Seat({ index, live, seatMat, holoMat }: { index: number; live: LiveRef; seatMat: THREE.Material; holoMat: THREE.ShaderMaterial }) {
  const { x, z } = SEATS[index]
  const back = useRef<THREE.Group>(null)
  const neck = useRef<THREE.Group>(null)
  const bodyA = useRef<THREE.Group>(null)
  const bodyB = useRef<THREE.Group>(null)
  const isDriver = index === 0
  useFrame(() => {
    const L = live.current
    if (back.current) back.current.rotation.z = isDriver ? THREE.MathUtils.degToRad(L.recline) + 0.1 : 0.32
    const v = L.occ[index]
    for (const g of [bodyA.current, bodyB.current]) {
      if (!g) continue
      g.visible = v > 0.01
      g.scale.setScalar(0.6 + 0.4 * v)
    }
    if (neck.current) {
      let nod = 0
      if (isDriver && L.kss >= 6.5) {
        const amp = 0.1 + 0.16 * Math.min(1, (L.kss - 6.5) / 2.5)
        nod = amp * Math.pow(Math.max(0, Math.sin(L.t * 0.85)), 4)
      }
      // gentle head tilt when napping
      nod += isDriver ? L.nap * 0.12 : 0
      neck.current.rotation.z = -nod
    }
  })
  const bodyGeo = useMemo(() => new THREE.CapsuleGeometry(0.135, 0.26, 6, 16), [])
  const legGeo = useMemo(() => new THREE.CapsuleGeometry(0.065, 0.28, 4, 12), [])
  const headGeo = useMemo(() => new THREE.SphereGeometry(0.098, 24, 16), [])
  useEffect(() => () => [bodyGeo, legGeo, headGeo].forEach((g) => g.dispose()), [bodyGeo, legGeo, headGeo])

  return (
    <group position={[x, 0, z]}>
      {/* cushion */}
      <RoundedBox args={[0.5, 0.12, 0.48]} radius={0.045} smoothness={3} position={[0, 0.62, 0]} material={seatMat} />
      {/* backrest pivot at cushion rear */}
      <group ref={back} position={[-0.23, 0.66, 0]}>
        <RoundedBox args={[0.12, 0.62, 0.47]} radius={0.05} smoothness={3} position={[0, 0.31, 0]} material={seatMat} />
        <RoundedBox args={[0.1, 0.14, 0.26]} radius={0.04} smoothness={3} position={[0.01, 0.72, 0]} material={seatMat} />
        <group ref={bodyA}>
          <mesh geometry={bodyGeo} material={holoMat} position={[0.17, 0.32, 0]} />
          <group ref={neck} position={[0.17, 0.56, 0]}>
            <mesh geometry={headGeo} material={holoMat} position={[0.03, 0.1, 0]} />
          </group>
        </group>
      </group>
      <group ref={bodyB}>
        {[-0.09, 0.09].map((dz) => (
          <group key={dz}>
            <mesh geometry={legGeo} material={holoMat} position={[0.07, 0.76, dz]} rotation={[0, 0, Math.PI / 2]} />
            <mesh geometry={legGeo} material={holoMat} position={[0.3, 0.55, dz]} rotation={[0, 0, 0.25]} />
          </group>
        ))}
      </group>
    </group>
  )
}

function Interior({ live }: { live: LiveRef }) {
  const mats = useMemo(() => {
    const holo = (c: THREE.Color) =>
      new THREE.ShaderMaterial({
        vertexShader: HOLO_VS,
        fragmentShader: HOLO_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: c.clone() }, uIntensity: { value: 1 } },
      })
    return {
      seat: new THREE.MeshStandardMaterial({ color: '#1b2433', roughness: 0.55, metalness: 0.25, emissive: '#070c14' }),
      driver: holo(C_TEAL),
      passenger: holo(C_PASSENGER),
      dash: new THREE.MeshStandardMaterial({ color: '#141c2a', roughness: 0.35, metalness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }),
      screen: new THREE.MeshBasicMaterial({ color: '#3CF2C8', toneMapped: false, transparent: true, opacity: 0.85 }),
      wheel: new THREE.MeshStandardMaterial({ color: '#2a3446', roughness: 0.3, metalness: 0.7 }),
      strip: new THREE.MeshBasicMaterial({ color: '#3CF2C8', toneMapped: false, transparent: true }),
      floor: new THREE.MeshBasicMaterial({ color: '#0b1320', transparent: true, opacity: 0.5, depthWrite: false }),
    }
  }, [])
  const strip = useMemo(() => ambientStrip(), [])
  const light = useRef<THREE.PointLight>(null)
  useEffect(
    () => () => {
      strip.dispose()
      Object.values(mats).forEach((m) => m.dispose())
    },
    [strip, mats],
  )

  useFrame(() => {
    const L = live.current
    ;(mats.driver.uniforms.uColor.value as THREE.Color).copy(L.driver)
    mats.driver.uniforms.uIntensity.value = 0.9 * (1 - 0.4 * L.nap) + 0.3 * L.wake
    mats.passenger.uniforms.uIntensity.value = 0.6 * (1 - 0.4 * L.nap)
    const b = L.ambBright
    mats.strip.color.copy(L.amb).multiplyScalar(0.25 + 2.2 * b)
    mats.screen.color.copy(L.rim).multiplyScalar(0.5 + 0.6 * (1 - L.nap))
    if (light.current) {
      light.current.color.copy(L.amb)
      light.current.intensity = 0.4 + 5 * b
    }
  })

  return (
    <group>
      {/* floor plate */}
      <RoundedBox args={[3.3, 0.03, 1.4]} radius={0.012} smoothness={2} position={[-0.45, 0.5, 0]} material={mats.floor} />
      {/* dashboard + panoramic display */}
      <RoundedBox args={[0.26, 0.1, 1.42]} radius={0.045} smoothness={3} position={[0.88, 1.0, 0]} material={mats.dash} />
      <mesh position={[0.74, 1.1, -0.22]} rotation={[0, -Math.PI / 2, 0]} material={mats.screen}>
        <planeGeometry args={[0.86, 0.07]} />
      </mesh>
      {/* steering wheel */}
      <group position={[0.56, 1.0, SEATS[0].z]} rotation={[0, Math.PI / 2, 0]}>
        <group rotation={[-0.42, 0, 0]}>
          <mesh material={mats.wheel}>
            <torusGeometry args={[0.165, 0.018, 10, 40]} />
          </mesh>
        </group>
      </group>
      {/* ambient light strip + cabin light */}
      <mesh geometry={strip} material={mats.strip} />
      <pointLight ref={light} position={[-0.35, 1.3, 0]} distance={3.4} decay={1.6} />
      {SEATS.map((_, i) => (
        <Seat key={i} index={i} live={live} seatMat={mats.seat} holoMat={i === 0 ? mats.driver : mats.passenger} />
      ))}
    </group>
  )
}

function useViewH() {
  const h = useThree((s) => s.size.height)
  const dpr = useThree((s) => s.viewport.dpr)
  return h * dpr
}

function Co2Field({ live, count = 2600 }: { live: LiveRef; count?: number }) {
  const viewH = useViewH()
  const { geo, mat } = useMemo(() => {
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.4, 1, 0), 3)
    const m = new THREE.ShaderMaterial({
      vertexShader: CO2_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uClock: { value: 0 },
        uFrac: { value: 0.2 },
        uOpacity: { value: 0.5 },
        uSize: { value: 0.03 },
        uViewH: { value: 800 },
        uMin: { value: new THREE.Vector3(-2.0, 0.58, -0.78) },
        uMax: { value: new THREE.Vector3(1.0, 1.55, 0.78) },
        uColor: { value: new THREE.Color('#3CF2C8') },
      },
    })
    return { geo: g, mat: m }
  }, [count])
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat])
  useFrame(() => {
    const L = live.current
    const n = Math.min(1, Math.max(0, (L.co2 - 400) / 4600))
    const u = mat.uniforms
    u.uClock.value = L.co2Clock
    u.uFrac.value = 0.06 + 0.94 * Math.pow(n, 0.75)
    u.uOpacity.value = (0.35 + 0.6 * n) * (1 - 0.35 * L.nap)
    u.uSize.value = 0.026 + 0.018 * n
    u.uViewH.value = viewH
    ;(u.uColor.value as THREE.Color).copy(L.co2Col)
  })
  return <points geometry={geo} material={mat} renderOrder={10} frustumCulled={false} />
}

function Airflow({ live, lanes = 220, trail = 10 }: { live: LiveRef; lanes?: number; trail?: number }) {
  const viewH = useViewH()
  const { geo, mat } = useMemo(() => {
    const n = lanes * trail
    const lane = new Float32Array(n * 4)
    const tr = new Float32Array(n)
    for (let l = 0; l < lanes; l++) {
      const a = [Math.random() * 2 - 1, Math.random(), Math.random(), Math.random()]
      for (let k = 0; k < trail; k++) {
        const i = l * trail + k
        lane.set(a, i * 4)
        tr[i] = k / (trail - 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('aLane', new THREE.BufferAttribute(lane, 4))
    g.setAttribute('aTrail', new THREE.BufferAttribute(tr, 1))
    const m = new THREE.ShaderMaterial({
      vertexShader: FLOW_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFlow: { value: 0 },
        uMix: { value: 0 },
        uWindow: { value: 0 },
        uAlpha: { value: 0.6 },
        uSize: { value: 0.022 },
        uViewH: { value: 800 },
        uColor: { value: new THREE.Color('#9FE8FF') },
      },
    })
    return { geo: g, mat: m }
  }, [lanes, trail])
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat])
  useFrame(() => {
    const L = live.current
    const u = mat.uniforms
    u.uFlow.value = L.flowClock
    u.uMix.value = L.recircMix
    u.uWindow.value = L.window
    u.uAlpha.value = (0.12 + 0.6 * Math.min(1, L.fan / 5)) * (1 - 0.5 * L.nap)
    u.uViewH.value = viewH
    ;(u.uColor.value as THREE.Color).lerpColors(C_FRESH, C_RECIRC, L.recircMix)
  })
  return <points geometry={geo} material={mat} renderOrder={11} frustumCulled={false} />
}

function SeatWisps({ live, count = 160 }: { live: LiveRef; count?: number }) {
  const viewH = useViewH()
  const { geo, mat } = useMemo(() => {
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < count * 4; i++) seed[i] = Math.random()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const m = new THREE.ShaderMaterial({
      vertexShader: WISP_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uClock: { value: 0 },
        uFrac: { value: 0 },
        uSize: { value: 0.03 },
        uViewH: { value: 800 },
        uOrigin: { value: new THREE.Vector3(SEATS[0].x, 0.69, SEATS[0].z) },
        uColor: { value: new THREE.Color('#BFF6FF') },
      },
    })
    return { geo: g, mat: m }
  }, [count])
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat])
  useFrame(() => {
    const L = live.current
    mat.uniforms.uClock.value = L.wispClock
    mat.uniforms.uFrac.value = L.seatVent / 3
    mat.uniforms.uViewH.value = viewH
  })
  return <points geometry={geo} material={mat} renderOrder={12} frustumCulled={false} />
}

function Vents({ live }: { live: LiveRef }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9FE8FF', toneMapped: false, transparent: true, opacity: 0.8, depthWrite: false }), [])
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const L = live.current
    const fresh = 1 - L.recircMix
    mat.color.lerpColors(C_FRESH, C_RECIRC, L.recircMix).multiplyScalar(0.4 + 1.6 * fresh * Math.min(1, L.fan / 4 + 0.2))
  })
  return (
    <group>
      {[-0.42, -0.14, 0.14, 0.42].map((z) => (
        <mesh key={z} position={[1.12, 1.135, z]} rotation={[-Math.PI / 2, 0, 0]} material={mat}>
          <planeGeometry args={[0.05, 0.2]} />
        </mesh>
      ))}
    </group>
  )
}

function Ground({ live }: { live: LiveRef }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GROUND_VS,
        fragmentShader: GROUND_FS,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        uniforms: {
          uColor: { value: new THREE.Color('#3CF2C8') },
          uScroll: { value: 0 },
          uPulse: { value: 0 },
          uFade: { value: 1 },
        },
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const L = live.current
    ;(mat.uniforms.uColor.value as THREE.Color).copy(L.rim)
    mat.uniforms.uScroll.value = L.scroll
    mat.uniforms.uPulse.value = L.t * 0.22
    mat.uniforms.uFade.value = L.rimGain
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={mat} renderOrder={-1}>
      <planeGeometry args={[10, 7]} />
    </mesh>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Scene root: one master update per frame, then the parts read `live`
 * ════════════════════════════════════════════════════════════════════════ */

function Scene({ reduced, hero }: { reduced: boolean; hero: boolean }) {
  const live = useRef<Live>({
    t: 0,
    co2: 600,
    recircMix: 0,
    fan: 3,
    recline: 12,
    seatVent: 0,
    window: 0,
    speed: 0,
    kss: 3,
    nap: 0,
    wake: 0,
    breath: 0,
    occ: [1, 0, 0, 0],
    amb: new THREE.Color('#3CF2C8'),
    ambBright: 0.4,
    rim: new THREE.Color('#3CF2C8'),
    rimGain: 1,
    driver: new THREE.Color('#3CF2C8'),
    co2Col: new THREE.Color('#3CF2C8'),
    flowClock: 0,
    co2Clock: 0,
    wispClock: 0,
    wheelAngle: 0,
    scroll: 0,
  })
  const ambTarget = useMemo(() => new THREE.Color(), [])
  const keyLight = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)

  useFrame((_, rawDt) => {
    const dt = Math.min(0.1, rawDt)
    const L = live.current
    const s = readTwin()
    const motion = reduced ? 0.3 : 1
    const d = THREE.MathUtils.damp
    L.t += dt * motion

    L.co2 = d(L.co2, s.co2, 1.8, dt)
    L.recircMix = d(L.recircMix, s.recirc ? 1 : 0, 1.6, dt)
    L.fan = d(L.fan, s.fan, 2, dt)
    L.recline = d(L.recline, s.recline, 1.5, dt)
    L.seatVent = d(L.seatVent, s.seatVent, 2, dt)
    L.window = d(L.window, Math.min(1, s.window / 40), 2, dt)
    L.speed = d(L.speed, s.speed, 1.5, dt)
    L.kss = d(L.kss, s.kss, 1.2, dt)
    L.nap = d(L.nap, s.mode === 'napping' ? 1 : 0, 1.0, dt)
    L.wake = d(L.wake, s.mode === 'waking' ? 1 : 0, 1.2, dt)
    L.breath = 0.5 + 0.5 * Math.sin((L.t * Math.PI * 2) / 5.5)
    for (let i = 0; i < 4; i++) L.occ[i] = d(L.occ[i], i === 0 || i < s.occupants ? 1 : 0, 3, dt)

    // ambient: user colour, overridden warm (nap) / cool white (waking); ~2 s lerp
    ambTarget.set(s.ambColor)
    ambTarget.lerp(C_WARM, L.nap).lerp(C_COOL, L.wake)
    L.amb.lerp(ambTarget, 1 - Math.exp(-2 * dt))
    const ambB = (s.ambBright / 100) * (1 - L.nap) * (1 - L.wake) + L.nap * (0.18 + 0.22 * L.breath) + L.wake * 0.95
    L.ambBright = d(L.ambBright, ambB, 2, dt)

    // body rim colour / mood
    _tmpC.copy(C_TEAL).lerp(C_BLUE, 0.15).lerp(C_WARM, L.nap).lerp(C_COOL, L.wake * 0.85)
    L.rim.copy(_tmpC)
    L.rimGain = 1 - L.nap * (0.5 - 0.18 * L.breath) + 0.3 * L.wake

    // driver fatigue colour (continuous across levels)
    const kl = Math.min(4, Math.max(0, (L.kss - 4) / 1.25))
    const k0 = Math.floor(kl)
    _tmpC2.lerpColors(LEVEL_COLS[k0], LEVEL_COLS[Math.min(4, k0 + 1)], kl - k0)
    L.driver.copy(_tmpC2)

    co2Color(L.co2, L.co2Col)

    // integrated clocks (speed changes never cause jumps)
    const fresh = 1 - L.recircMix
    const flowSpeed = (0.05 + L.fan * 0.05) * fresh + (0.03 + L.fan * 0.01) * L.recircMix
    L.flowClock += dt * flowSpeed * motion * (L.fan < 0.15 ? 0.2 : 1)
    L.co2Clock += dt * (0.35 + L.co2 / 6000) * motion
    L.wispClock += dt * motion
    const v = L.speed * 0.08 * motion
    L.wheelAngle += dt * v
    L.scroll += (dt * L.speed * motion) / 36

    if (keyLight.current) keyLight.current.intensity = 1.1 * (1 - 0.6 * L.nap) + 0.6 * L.wake
    if (hemi.current) hemi.current.intensity = 0.35 * (1 - 0.5 * L.nap) + 0.3 * L.wake
  }, -1)

  return (
    <>
      <hemisphereLight ref={hemi} args={['#9fc8ff', '#05070b', 0.35]} />
      <directionalLight ref={keyLight} position={[3, 6, -4]} color="#dfefff" />
      <group position={[0.2, 0, 0]} scale={hero ? 1.08 : 1}>
        <Ground live={live} />
        <Wheels live={live} />
        <Interior live={live} />
        <Vents live={live} />
        <Co2Field live={live} count={hero ? 2400 : 2600} />
        <Airflow live={live} />
        <SeatWisps live={live} />
        <Body live={live} reduced={reduced} />
      </group>
    </>
  )
}

function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.18} luminanceSmoothing={0.3} radius={0.72} />
      <Vignette eskil={false} offset={0.3} darkness={0.6} />
    </EffectComposer>
  )
}

function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, inView] as const
}

function TwinCanvas({ hero, reduced, active }: { hero: boolean; reduced: boolean; active: boolean }) {
  // initial 3/4 view from the front-left, above
  const camPos: [number, number, number] = hero ? [6.3, 3.0, -6.7] : [4.9, 2.9, -5.6]
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: camPos, fov: hero ? 30 : 32, near: 0.1, far: 60 }}
      onCreated={({ gl, camera, controls }) => {
        gl.setClearColor(0x000000, 1)
        // Design-review hook (tools/emu/twin.cjs): lets a script place the camera for reference views.
        ;(globalThis as { __twin?: Record<string, unknown> }).__twin = { ...((globalThis as { __twin?: Record<string, unknown> }).__twin ?? {}), camera, controls }
      }}
      // Opaque black + screen blending = visually transparent: black drops out, light adds onto
      // the host panel. Avoids premultiplied-alpha halos that bloom produces on alpha canvases.
      style={{ background: '#000', mixBlendMode: 'screen' }}
    >
      <Scene reduced={reduced} hero={hero} />
      <OrbitControls
        ref={(c) => {
          const g = globalThis as { __twin?: Record<string, unknown> }
          if (c) g.__twin = { ...(g.__twin ?? {}), controls: c }
        }}
        makeDefault
        target={[0, hero ? 0.75 : 0.85, 0]}
        enableDamping
        dampingFactor={0.07}
        enablePan={false}
        enableZoom={!hero}
        minDistance={5.2}
        maxDistance={11}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.46}
        autoRotate={!reduced}
        autoRotateSpeed={hero ? 0.35 : 0.5}
        rotateSpeed={0.6}
      />
      <Effects />
    </Canvas>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Overlay
 * ════════════════════════════════════════════════════════════════════════ */

const MODE_LABEL: Record<TwinMode, { t: string; c: string }> = {
  driving: { t: '주행 중', c: 'var(--aurora)' },
  parked: { t: '정차', c: 'var(--text-2)' },
  napping: { t: '휴식 · 낮잠', c: '#FF9A5A' },
  waking: { t: '기상 시퀀스', c: '#EAF4FF' },
}

function useTwinUi(): TwinState {
  const snap = useSim((s) => s.snap)
  const [demo, setDemo] = useState<TwinState | null>(() => (snap ? null : demoState(nowSec())))
  useEffect(() => {
    if (snap) return
    const id = window.setInterval(() => setDemo(demoState(nowSec())), 250)
    return () => window.clearInterval(id)
  }, [snap])
  return snap ? fromSnap(snap) : (demo ?? demoState(nowSec()))
}

const LEGEND_MAX = 5000
const legendPos = (ppm: number) => `${(Math.min(LEGEND_MAX, Math.max(0, ppm)) / LEGEND_MAX) * 100}%`

function TwinOverlay() {
  const s = useTwinUi()
  const col = co2Css(s.co2)
  const m = MODE_LABEL[s.mode] ?? MODE_LABEL.driving
  return (
    <div className="ct-overlay" aria-live="off">
      <div className="ct-tl">
        <div className="ct-eyebrow">
          <span className={s.live ? 'ct-live' : 'ct-live demo'} />
          Cabin Digital Twin
        </div>
        <div className="ct-co2">
          <span className="ct-co2-val" style={{ color: col, textShadow: `0 0 18px ${col}55` }}>
            {Math.round(s.co2).toLocaleString('en-US')}
          </span>
          <span className="ct-co2-unit">ppm</span>
          <span className="ct-co2-label">CO₂</span>
        </div>
        <div className="ct-rows">
          <span className="ct-k">공조</span>
          <span className="ct-v">
            <span className="ct-air-dot" style={{ background: s.recirc ? '#9B8CFF' : '#9FE8FF', boxShadow: `0 0 8px ${s.recirc ? '#9B8CFF' : '#9FE8FF'}` }} />
            {s.recirc ? '내기순환' : '외기유입'}
          </span>
          <span className="ct-k">온도</span>
          <span className="ct-v">
            {s.cabinTemp.toFixed(1)}°C <small>설정 {s.setTemp.toFixed(1)}°</small>
          </span>
          <span className="ct-k">송풍</span>
          <span className="ct-v">{Math.round(s.fan)}단</span>
          <span className="ct-k">탑승</span>
          <span className="ct-v">{s.occupants}명</span>
        </div>
      </div>
      <div className="ct-tr">
        <span className="ct-mode" style={{ color: m.c, borderColor: `color-mix(in srgb, ${m.c} 40%, transparent)` }}>
          {s.live ? m.t : 'DEMO'}
        </span>
      </div>
      <div className="ct-bl">
        <span className="ct-legend-title">CO₂ ppm</span>
        <div className="ct-legend-bar">
          <span className="ct-legend-marker" style={{ left: legendPos(s.co2) }} />
        </div>
        <div className="ct-legend-ticks">
          <span style={{ left: legendPos(1000) }}>1,000</span>
          <span style={{ left: legendPos(2000) }}>2,000</span>
          <span style={{ left: legendPos(3500) }}>3,500</span>
        </div>
      </div>
      <div className="ct-br">KSS {s.kss.toFixed(1)} · {Math.round(s.speed)} km/h</div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Public components
 * ════════════════════════════════════════════════════════════════════════ */

/** Mission-Control cabin digital twin with live HUD overlay. */
export function CabinTwin({ height = 360 }: { height?: number }) {
  const reduced = useReducedMotion()
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className="ct-root" style={{ height }}>
      <TwinCanvas hero={false} reduced={reduced} active={inView} />
      <TwinOverlay />
    </div>
  )
}

/** Landing-page hero: same scene, no overlay, larger car, slow orbit. Falls back to a demo loop without the sim. */
export function CabinTwinHero({ height = 520, className }: { height?: number | string; className?: string }) {
  const reduced = useReducedMotion()
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={`ct-root ct-hero${className ? ` ${className}` : ''}`} style={{ height }}>
      <TwinCanvas hero reduced={reduced} active={inView} />
    </div>
  )
}

export default CabinTwin
