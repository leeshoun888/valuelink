// IONIQ 5 body geometry, extracted from the KKAEUM cabin twin (the shape signed off against the
// Pleos Connect emulator's vehicle). Pure functions: used by the studio car (three.js) and by
// tools/blender/export-obj.mjs, which hands the same surfaces to Blender for the Cycles renders.

import * as THREE from 'three'

export const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ════════════════════════════════════════════════════════════════════════
 * Procedural body modelled on the Hyundai IONIQ 5 (the Pleos Connect emulator's
 * vehicle): lofted superellipse cross-sections along X, 1 unit ≈ 0.958 m.
 * Real figures → model: length 4,635 → 4.84, wheelbase 3,000 → 3.13,
 * overhangs 845 / 790 → 0.88 / 0.825, height 1,605 → 1.675, width 1,890 → 1.97,
 * track 1,638 → 1.71, tyre 255/45R20 (Ø737) → r 0.385.
 * Character: flat roof, near-vertical hatch, short clamshell hood, squared
 * wheel arches, diagonal "Z" door line, parametric-pixel lamps.
 * ════════════════════════════════════════════════════════════════════════ */

export const HALF_L = 2.42
export const BELT_Y = 1.15
export const SQ_N = 6.5 // superellipse exponent of the cross-section (higher = boxier: flat IONIQ 5 flanks)
export const WHEEL_X = [1.54, -1.595]
export const WHEEL_Y = 0.385
export const WHEEL_R = 0.385
export const ARCH_R = 0.48
export const TRACK_Z = 0.855

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
export const topAt = monotone(
  TOP_PTS.map((p) => p[0]),
  TOP_PTS.map((p) => p[1]),
)

/** Squared IONIQ 5 wheel-arch opening: flat top, chamfered corners. */
export function archTop(dx: number) {
  const a = Math.abs(dx)
  if (a >= ARCH_R) return -Infinity
  const flat = ARCH_R * 0.6
  if (a <= flat) return WHEEL_Y + ARCH_R * 0.92
  const f = (a - flat) / (ARCH_R - flat)
  return WHEEL_Y + ARCH_R * (0.92 - 0.55 * Math.pow(f, 1.5))
}

export function botAt(x: number) {
  // sill cladding ≈ 210 mm; front lip 260 mm (17.5° approach); rear bumper 400 mm (25.4° departure)
  let b = 0.22 + 0.06 * sstep(2.0, 2.42, x) + 0.2 * sstep(1.9, 2.42, -x)
  for (const cx of WHEEL_X) b = Math.max(b, archTop(x - cx))
  return b
}
export const widthAt = (x: number) => 0.985 * (1 - 0.07 * sstep(1.55, 2.42, x) - 0.04 * sstep(1.7, 2.42, -x))
export const tumble = (y: number) => 1 - 0.27 * sstep(BELT_Y - 0.02, 1.62, y)

export function profile(x: number) {
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
export function sideZ(x: number, y: number) {
  const p = profile(x)
  const t = Math.min(1, Math.max(-1, (y - p.cy) / p.b))
  const sAbs = Math.pow(Math.abs(t), SQ_N / 2)
  const cAbs = Math.sqrt(Math.max(0, 1 - sAbs * sAbs))
  return p.a * Math.pow(cAbs, 2 / SQ_N) * tumble(y)
}

export function surfacePoint(x: number, theta: number, out: THREE.Vector3) {
  const p = profile(x)
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const y = p.cy + p.b * Math.sign(s) * Math.pow(Math.abs(s), 2 / SQ_N)
  const z = p.a * Math.sign(c) * Math.pow(Math.abs(c), 2 / SQ_N) * tumble(y)
  return out.set(x, y, z)
}

/** Outermost body x (front: max, rear: min) at height y and half-width |z|. */
export function faceX(y: number, z: number, front: boolean) {
  const dir = front ? -1 : 1
  for (let x = front ? HALF_L : -HALF_L; Math.abs(x) > 1.6; x += dir * 0.002) {
    const p = profile(x)
    if (y > p.bot && y < p.top && sideZ(x, y) >= Math.abs(z)) return x
  }
  return front ? 1.6 : -1.6
}

export function buildBodyGeometry(U = 170, V = 80) {
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
export function buildFeatureLines() {
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
export function lightBar(front: boolean) {
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

export function ambientStrip() {
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
