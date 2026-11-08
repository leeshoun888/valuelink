// Dumps the IONIQ 5 loft (web/src/three/ioniq5.ts) for Blender:
//   body grid (U × V) with natural UVs (u along the length, v around the section), zone per vertex,
//   panel / feature lines mapped into UV space (Blender rasterises them into the detail texture),
//   pixel lamps, mirror outlines, wheel layout.
// Run: npx esbuild tools/blender/export-geometry.ts --bundle --platform=node --outfile=$TMPDIR/geo.cjs && node $TMPDIR/geo.cjs out.json
import { writeFileSync } from 'node:fs'
import * as THREE from 'three'
import {
  ARCH_R, BELT_Y, HALF_L, SQ_N, TRACK_Z, WHEEL_R, WHEEL_X, WHEEL_Y,
  buildFeatureLines, lightBar, profile, surfacePoint, tumble, topAt,
} from '../../web/src/three/ioniq5'

const U = 360
const V = 180
const out: Record<string, unknown> = { U, V, HALF_L, BELT_Y, WHEEL_X, WHEEL_Y, WHEEL_R, ARCH_R, TRACK_Z }

const pos: number[] = []
const v3 = new THREE.Vector3()
for (let i = 0; i < U; i++) {
  const x = -HALF_L * Math.cos((Math.PI * i) / (U - 1))
  for (let j = 0; j < V; j++) {
    surfacePoint(x, (Math.PI * 2 * j) / V, v3)
    pos.push(+v3.x.toFixed(5), +v3.y.toFixed(5), +v3.z.toFixed(5))
  }
}
out.body = pos

/** (x, y, z) on the body → (u, v) of the loft grid, or null when the point is off the surface. */
function toUV(x: number, y: number, z: number): [number, number] | null {
  if (Math.abs(x) > HALF_L) return null
  const p = profile(x)
  const sy = Math.max(-1, Math.min(1, (y - p.cy) / p.b))
  const s = Math.sign(sy) * Math.pow(Math.abs(sy), SQ_N / 2)
  const cz = Math.max(-1, Math.min(1, z / (p.a * tumble(y))))
  const c = Math.sign(cz) * Math.pow(Math.abs(cz), SQ_N / 2)
  let th = Math.atan2(s, c)
  if (th < 0) th += Math.PI * 2
  const back = surfacePoint(x, th, new THREE.Vector3())
  if (back.distanceTo(new THREE.Vector3(x, y, z / 1.006)) > 0.035) return null
  return [Math.acos(Math.max(-1, Math.min(1, -x / HALF_L))) / Math.PI, th / (Math.PI * 2)]
}

const [strong, faint] = buildFeatureLines()
const lines = (g: THREE.BufferGeometry) => {
  const a = g.getAttribute('position')
  const segs: number[] = []
  for (let k = 0; k < a.count; k += 2) {
    const p = toUV(a.getX(k), a.getY(k), a.getZ(k))
    const q = toUV(a.getX(k + 1), a.getY(k + 1), a.getZ(k + 1))
    if (p && q && Math.abs(p[1] - q[1]) < 0.5) segs.push(+p[0].toFixed(5), +p[1].toFixed(5), +q[0].toFixed(5), +q[1].toFixed(5))
  }
  return segs
}
out.linesStrong = lines(strong)
out.linesFaint = lines(faint)

// Real panel gaps and creases, rebuilt from the same construction as buildFeatureLines (which also holds
// blueprint-only ribs and iso-lines that must not become panel lines).
const sideZAt = (x: number, y: number) => {
  const p = profile(x)
  const t = Math.min(1, Math.max(-1, (y - p.cy) / p.b))
  const sAbs = Math.pow(Math.abs(t), SQ_N / 2)
  const cAbs = Math.sqrt(Math.max(0, 1 - sAbs * sAbs))
  return p.a * Math.pow(cAbs, 2 / SQ_N) * tumble(y)
}
const polyUV = (pts: [number, number, number][]) => {
  const segs: number[] = []
  for (let k = 0; k < pts.length - 1; k++) {
    const p = toUV(...pts[k])
    const q = toUV(...pts[k + 1])
    if (p && q && Math.abs(p[1] - q[1]) < 0.5) segs.push(+p[0].toFixed(5), +p[1].toFixed(5), +q[0].toFixed(5), +q[1].toFixed(5))
  }
  return segs
}
const sideLine = (x0: number, y0: number, x1: number, y1: number, side: number, n = 40) => {
  const pts: [number, number, number][] = []
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n
    const y = y0 + ((y1 - y0) * k) / n
    pts.push([x, y, side * sideZAt(x, y)])
  }
  return polyUV(pts)
}
const dloT = (x: number) => topAt(x) - 0.07
let xf0 = 0.2
for (let x = 0.2; x < 1.4; x += 0.005) if (dloT(x) > BELT_Y + 0.03) xf0 = x
const gaps: number[] = []
const creases: number[] = []
for (const side of [-1, 1]) {
  // door shut lines: front door leading / B-pillar split / rear door trailing edge
  for (const [x0, x1] of [[1.07, 1.02], [-0.16, -0.18], [-1.06, -1.3]] as const) gaps.push(...sideLine(x0, 0.47, x1, BELT_Y - 0.02, side, 30))
  // clamshell hood shut line along the fender
  const clam: [number, number, number][] = []
  for (let x = 2.32; x >= 1.27; x -= 0.01) clam.push([x, topAt(x) - 0.045, side * sideZAt(x, topAt(x) - 0.045)])
  gaps.push(...polyUV(clam))
  // window seal (belt) and the lower door edge above the sill
  gaps.push(...sideLine(-1.3, BELT_Y + 0.02, xf0, BELT_Y + 0.02, side, 80))
  gaps.push(...sideLine(-1.3, 0.47, 1.07, 0.47, side, 80))
  // charge port door (rear right) and fuel-free left: a small rounded square
  if (side > 0) {
    const cp: [number, number, number][] = []
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2
      const x = -1.62 + 0.085 * Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.4)
      const y = 0.95 + 0.075 * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.4)
      cp.push([x, y, sideZAt(x, y)])
    }
    gaps.push(...polyUV(cp))
  }
  // the IONIQ 5 diagonal "Z" crease
  creases.push(...sideLine(1.05, 0.52, -1.1, 0.9, side, 60))
}
// tailgate shut line across the rear and the frunk / clamshell front edge are on the end faces
out.gaps = gaps
out.creases = creases

const lamp = (g: THREE.BufferGeometry) => Array.from(g.getAttribute('position').array as Float32Array, (n) => +n.toFixed(5))
out.headLamp = lamp(lightBar(true))
out.tailLamp = lamp(lightBar(false))

// daylight opening (for the separate side-glass panes) and the roofline for the vision roof
const dloTop = (x: number) => topAt(x) - 0.07
let xf = 0.2
for (let x = 0.2; x < 1.4; x += 0.005) if (dloTop(x) > BELT_Y + 0.03) xf = x
out.dloFront = xf
const panes: Record<string, number[]> = {}
const pane = (name: string, x0: number, x1: number, side: number) => {
  const pts: number[] = []
  const NU = 40
  const NV = 20
  for (let i = 0; i <= NU; i++) {
    const x = x0 + ((x1 - x0) * i) / NU
    const top = Math.max(BELT_Y + 0.03, dloTop(x) - 0.012)
    for (let j = 0; j <= NV; j++) {
      const y = BELT_Y + 0.03 + ((top - BELT_Y - 0.03) * j) / NV
      const p = profile(x)
      const t = Math.min(1, Math.max(-1, (y - p.cy) / p.b))
      const sAbs = Math.pow(Math.abs(t), SQ_N / 2)
      const cAbs = Math.sqrt(Math.max(0, 1 - sAbs * sAbs))
      const z = p.a * Math.pow(cAbs, 2 / SQ_N) * tumble(y)
      pts.push(+x.toFixed(5), +y.toFixed(5), +(side * (z + 0.004)).toFixed(5))
    }
  }
  panes[name] = pts
}
pane('window_fl', -0.12, xf - 0.04, -1)
pane('window_rl', -1.02, -0.2, -1)
pane('window_fr', -0.12, xf - 0.04, 1)
pane('window_rr', -1.02, -0.2, 1)
out.panes = panes
out.paneGrid = [41, 21]

writeFileSync(process.argv[2] ?? 'ioniq5.json', JSON.stringify(out))
console.log('body', U, 'x', V, '| strong segs', (out.linesStrong as number[]).length / 4, '| faint', (out.linesFaint as number[]).length / 4)
