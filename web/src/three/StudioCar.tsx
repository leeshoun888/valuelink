/**
 * StudioCar: the IONIQ 5 as an object on a studio table. Apple product-page grammar: one object,
 * soft area lights, clear-coated paint, real glass, a contact shadow, slow motion.
 *
 * It is also a live twin of what ValueLink does to the car:
 *   windows   side glass slides down / up (Window.setWindowPosition)
 *   lights    pixel headlamps on / off (Light.setLowBeamLightSwitch)
 *   blind     the vision roof turns from glass to fabric (Window.moveWindowBlind)
 *   charging  charge port glows, the battery pack fills to the SoC and stops at the charge limit
 *   xray      body turns to glass and shows the pack coloured by state of health
 *   warning   the affected corner (tyre pressure → front-left wheel) pulses amber
 *
 * Everything is offline (no HDR downloads): the environment is built from Lightformers.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from '@react-three/drei'
import { Blocks, FloodFloor, Parts, Sweep, Water, type FloodScene, type Part, type PassportScene } from './Scenes'
import * as THREE from 'three'
import {
  BELT_Y,
  HALF_L,
  TRACK_Z,
  WHEEL_R,
  WHEEL_X,
  WHEEL_Y,
  buildBodyGeometry,
  lightBar,
  sideZ,
  surfacePoint,
  topAt,
} from './ioniq5'

export interface CarState {
  windowsOpen: number // 0..4 windows open
  headlights: boolean
  charging: boolean
  socPct: number
  chargeLimitPct: number
  blindClosed: boolean
  sohPct: number
  xray: boolean
  tyreWarning: boolean
  /** a guard event just happened: brief soft glow on that part */
  pulse?: 'windows' | 'lights' | 'blind' | 'charge' | null
  /** the part a warning lamp points at (glass body, part pulses amber) */
  part?: Part | null
  /** callout beside that part, e.g. "타이어 공기압 · 방치 시 −2%" */
  partLabel?: string
  /** flood scene: real flood-trace map under the car, water on a heavy-rain warning */
  flood?: FloodScene
  /** trade-up: light sweep into the next car */
  newCar?: boolean
  /** passport: glass day blocks beside the car */
  passport?: PassportScene | null
}

export const DEFAULT_CAR: CarState = {
  windowsOpen: 0,
  headlights: false,
  charging: false,
  socPct: 72,
  chargeLimitPct: 80,
  blindClosed: false,
  sohPct: 98,
  xray: false,
  tyreWarning: false,
  pulse: null,
}

interface Props {
  state: CarState
  theme?: 'light' | 'dark'
  autoRotate?: boolean
  interactive?: boolean
  /** camera azimuth in degrees when not rotating (0 = front-left three-quarter). */
  azimuth?: number
  /** paint colour */
  paint?: string
  className?: string
  style?: React.CSSProperties
  /** render on demand only (static frames, e.g. while driving) */
  still?: boolean
  /**
   * Head-unit mode: render on demand at dpr 1. Frames run only for a few seconds after the car state changes
   * (a window closing, the pack filling) or while the driver drags the car; otherwise the GPU idles.
   * Measured on Pleos Connect emulator 2.1.0: a continuously rendered full-screen scene starved the VHAL.
   */
  lowPower?: boolean
  /** camera distance (default 7.8) */
  distance?: number
  /** move the car within the frame, as a fraction of the width / height (+ = right / down) */
  shiftX?: number
  shiftY?: number
}

const GLASS = new THREE.Color('#07090c')
const WHITE = new THREE.Color('#ffffff')
const NEXT_TINT = new THREE.Color('#5f9a96')
const ENV = { light: `${import.meta.env.BASE_URL}3d/studio_light.hdr`, dark: `${import.meta.env.BASE_URL}3d/studio_dark.hdr` }
const ROOF_GLASS = new THREE.Color('#0b0e12')
const BLIND = new THREE.Color('#8a8d92')

/** Daylight opening helpers (same construction as the twin's feature lines). */
const dloTop = (x: number) => topAt(x) - 0.07
const DLO_FRONT = (() => {
  let xf = 0.2
  for (let x = 0.2; x < 1.4; x += 0.005) if (dloTop(x) > BELT_Y + 0.03) xf = x
  return xf
})()

/** Classifies a body vertex: 0 paint, 1 glass (screens / side), 2 roof glass. */
function zoneOf(p: THREE.Vector3, n: THREE.Vector3) {
  if (p.y < BELT_Y + 0.025 || p.x > 1.27 || p.x < -2.36) return 0
  if (p.x > 0.33 && p.x < 1.12) return 1 // windscreen
  if (p.x < -1.6) return p.y > 1.58 ? 0 : 1 // rear glass under the lip spoiler
  if (n.y > 0.8) return p.x > -1.55 && p.x < 0.3 && Math.abs(p.z) < 0.6 ? 2 : 0 // vision roof
  return 1
}

function useBody(paint: string) {
  return useMemo(() => {
    const geo = buildBodyGeometry(240, 120)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
    const zones = new Uint8Array(pos.count)
    const colors = new Float32Array(pos.count * 3)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const base = new THREE.Color(paint)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nrm, i)
      const z = zoneOf(p, n)
      zones[i] = z
      const c = z === 0 ? base : z === 1 ? GLASS : ROOF_GLASS
      colors.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return { geo, zones }
  }, [paint])
}

/** One side window pane, sampled just outside the body so it can slide down into the door. */
function paneGeometry(x0: number, x1: number, side: number) {
  const U = 28
  const V = 14
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= U; i++) {
    const x = x0 + ((x1 - x0) * i) / U
    const top = Math.max(BELT_Y + 0.03, dloTop(x) - 0.012)
    for (let j = 0; j <= V; j++) {
      const y = BELT_Y + 0.03 + ((top - BELT_Y - 0.03) * j) / V
      pos.push(x, y, side * (sideZ(x, y) + 0.006))
    }
  }
  for (let i = 0; i < U; i++)
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j
      const b = a + V + 1
      if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1)
      else idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function Body({ state, paint }: { state: CarState; paint: string }) {
  const { geo, zones } = useBody(paint)
  const head = useMemo(() => lightBar(true), [])
  const tail = useMemo(() => lightBar(false), [])
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        metalness: 0.6,
        roughness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.85,
        transparent: true,
      }),
    [],
  )
  const headMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#2a2d33', side: THREE.DoubleSide, toneMapped: false }), [])
  const tailMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#3a0d12', side: THREE.DoubleSide, toneMapped: false }), [])
  const blind = useRef(state.blindClosed ? 1 : 0)
  const lamp = useRef(state.headlights ? 1 : 0)
  const xr = useRef(state.xray ? 1 : 0)
  const col = useMemo(() => new THREE.Color(), [])

  useEffect(() => () => [geo, head, tail, mat, headMat, tailMat].forEach((d) => d.dispose()), [geo, head, tail, mat, headMat, tailMat])

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3)
    const bTarget = state.blindClosed ? 1 : 0
    if (Math.abs(blind.current - bTarget) > 0.002) {
      blind.current += (bTarget - blind.current) * k
      col.copy(ROOF_GLASS).lerp(BLIND, blind.current)
      const attr = geo.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < zones.length; i++) if (zones[i] === 2) attr.setXYZ(i, col.r, col.g, col.b)
      attr.needsUpdate = true
    }
    lamp.current += ((state.headlights ? 1 : 0) - lamp.current) * k
    headMat.color.set('#2a2d33').lerp(new THREE.Color(3.2, 3.3, 3.6), lamp.current)
    tailMat.color.set('#3a0d12').lerp(new THREE.Color(2.4, 0.15, 0.25), lamp.current)
    xr.current += ((state.xray ? 1 : 0) - xr.current) * k
    mat.opacity = 1 - 0.86 * xr.current
    mat.depthWrite = xr.current < 0.5
  })

  return (
    <group>
      <mesh geometry={geo} material={mat} castShadow renderOrder={xr.current > 0.5 ? 5 : 0} />
      <mesh geometry={head} material={headMat} />
      <mesh geometry={tail} material={tailMat} />
    </group>
  )
}

function Windows({ state }: { state: CarState }) {
  const panes = useMemo(() => {
    const out: { g: THREE.BufferGeometry; h: number; side: number; idx: number }[] = []
    const spans: [number, number][] = [
      [-0.12, DLO_FRONT - 0.04],
      [-1.02, -0.2],
    ]
    let idx = 0
    for (const side of [-1, 1])
      for (const [a, b] of spans) {
        const g = paneGeometry(a, b, side)
        g.computeBoundingBox()
        out.push({ g, h: g.boundingBox!.max.y - BELT_Y, side, idx: idx++ })
      }
    return out
  }, [])
  const clip = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BELT_Y + 0.02))], [])
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#1a222c',
        metalness: 0.1,
        roughness: 0.04,
        clearcoat: 1,
        envMapIntensity: 1.6,
        side: THREE.DoubleSide,
        clippingPlanes: clip,
      }),
    [clip],
  )
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const open = useRef([0, 0, 0, 0])
  useEffect(() => () => [...panes.map((p) => p.g), mat].forEach((d) => d.dispose()), [panes, mat])
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 1.6)
    // windowsOpen counts windows; open the driver's first, then the others
    const order = [0, 2, 1, 3]
    for (let n = 0; n < 4; n++) {
      const i = order[n]
      const target = n < state.windowsOpen ? 0.92 : 0
      open.current[i] += (target - open.current[i]) * k
      const m = refs.current[i]
      if (m) m.position.y = -open.current[i] * panes[i].h
    }
  })
  return (
    <group>
      {panes.map((p, i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)} geometry={p.g} material={mat} />
      ))}
    </group>
  )
}

function Wheels({ state }: { state: CarState }) {
  const parts = useMemo(() => {
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
    const tire = new THREE.LatheGeometry(prof, 96)
    tire.rotateX(Math.PI / 2)
    const face = new THREE.CircleGeometry(0.262, 72)
    const blade = new THREE.BoxGeometry(0.17, 0.016, 0.03)
    blade.translate(0.15, 0.028, 0)
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 32)
    hub.rotateX(Math.PI / 2)
    const lip = new THREE.TorusGeometry(0.25, 0.012, 12, 96)
    const halo = new THREE.TorusGeometry(0.4, 0.018, 12, 96)
    return {
      tire,
      face,
      blade,
      hub,
      lip,
      halo,
      tireMat: new THREE.MeshPhysicalMaterial({ color: '#141518', roughness: 0.82, metalness: 0 }),
      faceMat: new THREE.MeshPhysicalMaterial({ color: '#1b1d21', roughness: 0.5, metalness: 0.6 }),
      bladeMat: new THREE.MeshPhysicalMaterial({ color: '#c7cbd1', roughness: 0.22, metalness: 1 }),
      haloMat: new THREE.MeshBasicMaterial({ color: '#ff9f0a', transparent: true, opacity: 0, toneMapped: false }),
    }
  }, [])
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts])
  useFrame(({ clock }) => {
    parts.haloMat.opacity = state.tyreWarning ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 3.2) : 0
  })
  const spots: [number, number][] = []
  for (const x of WHEEL_X) for (const s of [-1, 1]) spots.push([x, s])
  return (
    <group>
      {spots.map(([x, s], i) => (
        <group key={i} position={[x, WHEEL_Y, s * TRACK_Z]}>
          <mesh geometry={parts.tire} material={parts.tireMat} castShadow />
          <group position={[0, 0, s * 0.11]} scale={[1, 1, s]}>
            <mesh geometry={parts.face} material={parts.faceMat} />
            {Array.from({ length: 18 }, (_, k) => (
              <mesh key={k} geometry={parts.blade} material={parts.bladeMat} rotation={[0, 0, (k / 18) * Math.PI * 2]} position={[0, 0, 0.012]} />
            ))}
            <mesh geometry={parts.hub} material={parts.bladeMat} position={[0, 0, 0.02]} />
            <mesh geometry={parts.lip} material={parts.bladeMat} position={[0, 0, 0.01]} />
          </group>
          {i === 1 && <mesh geometry={parts.halo} material={parts.haloMat} position={[0, 0, s * 0.14]} />}
          {i === 1 && <mesh geometry={parts.halo} material={parts.haloMat} position={[0, 0, -s * 0.14]} />}
        </group>
      ))}
    </group>
  )
}

// ---- Blender model (tools/blender/build.py): panel gaps and AO baked into the body texture ---------------

// Silver in both themes: in real-time light a black body sinks into a dark page (the black build is for
// the Cycles renders, where rim lights carry its shape).
const GLB = { light: `${import.meta.env.BASE_URL}3d/ioniq5.glb`, dark: `${import.meta.env.BASE_URL}3d/ioniq5.glb` }

/**
 * The studio IONIQ 5 exported from Blender. Driven by name: window_* panes slide into the doors (clipped at
 * the belt line), lamp_* materials glow, body materials fade for the x-ray view. Same frame as the loft.
 */
function GlbCar({ state, theme }: { state: CarState; theme: 'light' | 'dark' }) {
  const { scene } = useGLTF(GLB[theme])
  const parts = useMemo(() => {
    const root = scene.clone(true)
    const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BELT_Y + 0.02))]
    const panes: THREE.Object3D[] = []
    const bodyMats: THREE.MeshPhysicalMaterial[] = []
    let head: THREE.MeshStandardMaterial | null = null
    let tail: THREE.MeshStandardMaterial | null = null
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => (x as THREE.Material).clone())
      m.material = Array.isArray(m.material) ? mats : mats[0]
      for (const mat of mats as THREE.MeshPhysicalMaterial[]) {
        mat.envMapIntensity = 1
        if (mat.name === 'body' || mat.name.startsWith('body_')) {
          mat.transparent = true
          bodyMats.push(mat)
        }
        if (mat.name === 'window') {
          mat.clippingPlanes = clip
          mat.side = THREE.DoubleSide
        }
        if (mat.name === 'lamp_head') head = mat
        if (mat.name === 'lamp_tail') tail = mat
      }
      if (o.name.startsWith('window_')) panes.push(o)
    })
    panes.sort((a, b) => ['window_fl', 'window_rl', 'window_fr', 'window_rr'].indexOf(a.name) - ['window_fl', 'window_rl', 'window_fr', 'window_rr'].indexOf(b.name))
    // trade-up: a pale ghost of the current car that slides back and fades as the next one takes its place
    const ghost = scene.clone(true)
    const ghostMat = new THREE.MeshPhysicalMaterial({ color: '#d7dade', roughness: 0.2, metalness: 0.4, clearcoat: 1, transparent: true, opacity: 0, depthWrite: false })
    ghost.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.material = ghostMat
    })
    ghost.visible = false
    return { root, panes, bodyMats, head: head as THREE.MeshStandardMaterial | null, tail: tail as THREE.MeshStandardMaterial | null, ghost, ghostMat }
  }, [scene])
  const ghostT = useRef(1)
  const wasNew = useRef(false)
  const open = useRef([0, 0, 0, 0])
  const lamp = useRef(0)
  const xr = useRef(0)
  const nc = useRef(0)
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 2)
    for (let n = 0; n < parts.panes.length; n++) {
      const target = n < state.windowsOpen ? 0.3 : 0
      open.current[n] += (target - open.current[n]) * k
      parts.panes[n].position.y = -open.current[n]
    }
    lamp.current += ((state.headlights ? 1 : 0) - lamp.current) * k
    if (parts.head) {
      parts.head.emissive.set('#eaf2ff')
      parts.head.emissiveIntensity = 0.35 + 3.2 * lamp.current
    }
    if (parts.tail) {
      parts.tail.emissive.set('#ff1f3a')
      parts.tail.emissiveIntensity = 0.25 + 2.2 * lamp.current
    }
    xr.current += ((state.xray || state.part ? 1 : 0) - xr.current) * k
    nc.current += ((state.newCar ? 1 : 0) - nc.current) * (1 - Math.exp(-dt * 1.4))
    if (state.newCar && !wasNew.current) ghostT.current = 0
    wasNew.current = Boolean(state.newCar)
    if (ghostT.current < 1) ghostT.current = Math.min(1, ghostT.current + dt / 2.2)
    const gt = ghostT.current
    parts.ghost.visible = gt < 1
    parts.ghost.position.x = -0.15 - 2.6 * gt * gt
    parts.ghostMat.opacity = 0.45 * (1 - gt)
    for (const m of parts.bodyMats) {
      m.opacity = 1 - 0.82 * xr.current
      m.depthWrite = xr.current < 0.5
      // trade-up: the silver car becomes the next one (Digital Teal) behind the light sweep
      m.color.copy(WHITE).lerp(NEXT_TINT, nc.current)
    }
  })
  return (
    <>
      <primitive object={parts.root} />
      <primitive object={parts.ghost} />
    </>
  )
}

/** True once the model file is known to exist (a missing file must not take the whole canvas down). */
const glbOk = new Map<string, Promise<boolean>>()
function useGlbAvailable(url: string) {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    if (!glbOk.has(url)) {
      glbOk.set(
        url,
        fetch(url, { method: 'HEAD' })
          .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('html'))
          .catch(() => false),
      )
    }
    glbOk.get(url)!.then((v) => live && setOk(v))
    return () => {
      live = false
    }
  }, [url])
  return ok
}

/** Falls back to the procedural loft when the model cannot load (missing file, old WebView). */
class GlbBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function TyreHalo({ on }: { on: boolean }) {
  const geo = useMemo(() => new THREE.TorusGeometry(0.405, 0.016, 12, 96), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff9f0a', transparent: true, opacity: 0, toneMapped: false }), [])
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat])
  useFrame(({ clock }) => {
    mat.opacity = on ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 3.2) : 0
  })
  return <mesh geometry={geo} material={mat} position={[WHEEL_X[0], WHEEL_Y, -(TRACK_Z + 0.16)]} />
}

/** Battery pack under the floor: 2 × 16 modules, filled to the SoC, limit line at the charge limit. */
function Pack({ state, theme }: { state: CarState; theme: 'light' | 'dark' }) {
  const COLS = 16
  const ROWS = 2
  const geo = useMemo(() => new THREE.BoxGeometry(0.15, 0.1, 0.62), [])
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ roughness: 0.35, metalness: 0.2, transparent: true, toneMapped: false }), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  const show = useRef(0)
  const c = useMemo(() => new THREE.Color(), [])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    let k = 0
    for (let r = 0; r < ROWS; r++)
      for (let i = 0; i < COLS; i++) {
        o.position.set(-1.33 + i * 0.172, 0.2, (r - 0.5) * 0.66)
        o.updateMatrix()
        m.setMatrixAt(k++, o.matrix)
      }
    m.instanceMatrix.needsUpdate = true
  }, [])
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat])
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const target = state.xray || state.charging ? 1 : 0
    show.current += (target - show.current) * 0.08
    mat.opacity = show.current
    m.visible = show.current > 0.01
    const filled = (state.socPct / 100) * COLS
    const limit = (state.chargeLimitPct / 100) * COLS
    // monochrome: charged cells in the ink colour, the cell being filled breathes, the headroom up to the
    // charge limit is mid-grey, the capacity the limit keeps unused is faint
    const dark = theme === 'dark'
    const ink = dark ? 0.95 : 0.13
    const head = dark ? 0.32 : 0.62
    const unused = dark ? 0.12 : 0.86
    for (let r = 0; r < ROWS; r++)
      for (let i = 0; i < COLS; i++) {
        const k = r * COLS + i
        if (i < Math.floor(filled)) c.setScalar(ink)
        else if (i < filled) c.setScalar(head + (ink - head) * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4)))
        else if (i < limit) c.setScalar(head)
        else c.setScalar(unused)
        m.setColorAt(k, c)
      }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[geo, mat, COLS * ROWS]} />
}

/** IONIQ 5 charge port: rear right fender. */
function ChargePort({ state }: { state: CarState }) {
  const p = useMemo(() => {
    const v = new THREE.Vector3()
    surfacePoint(-1.62, 0.4, v)
    return v
  }, [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0, toneMapped: false }), [])
  const geo = useMemo(() => new THREE.RingGeometry(0.05, 0.075, 48), [])
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat])
  useFrame(({ clock }) => {
    mat.opacity = state.charging ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 2.4) : 0
  })
  return <mesh geometry={geo} material={mat} position={[p.x, p.y, p.z + 0.01]} />
}

function Rig({ autoRotate, interactive, azimuth, distance, shiftX, shiftY, high }: { autoRotate: boolean; interactive: boolean; azimuth: number; distance: number; shiftX: number; shiftY: number; high?: boolean }) {
  const { camera, size } = useThree()
  useEffect(() => {
    // three-quarter front view; azimuth swings around the car. The flood scene looks down onto the map.
    const a = ((azimuth + 38) * Math.PI) / 180
    const el = high ? 0.5 : 0.24
    const d = high ? distance * 1.6 : distance
    camera.position.set(Math.cos(a) * d * Math.cos(el), 0.7 + d * Math.sin(el), Math.sin(a) * d * Math.cos(el))
    camera.lookAt(0, 0.7, 0)
  }, [camera, azimuth, distance, high])
  useEffect(() => {
    // Off-centre framing (the car sits beside the type, as on a product page) without moving the orbit centre.
    const cam = camera as THREE.PerspectiveCamera
    if (shiftX || shiftY) cam.setViewOffset(size.width, size.height, -shiftX * size.width, -shiftY * size.height, size.width, size.height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
  }, [camera, size, shiftX, shiftY])
  return <OrbitControls target={[0, 0.72, 0]} enableZoom={false} enablePan={false} enableRotate={interactive} autoRotate={autoRotate} autoRotateSpeed={0.45} minPolarAngle={high ? 0.5 : 0.9} maxPolarAngle={1.45} />
}

/** Demand-mode driver: ~30 fps for 4 s whenever the car state changes, then idle. */
function AnimateOnChange({ state }: { state: CarState }) {
  const invalidate = useThree((s) => s.invalidate)
  const key = JSON.stringify(state)
  useEffect(() => {
    let n = 0
    const id = window.setInterval(() => {
      invalidate()
      if (++n > 120) window.clearInterval(id)
    }, 33)
    return () => window.clearInterval(id)
  }, [key, invalidate])
  return null
}

/** Studio light: the Cycles-rendered studio (tools/blender/envmap.py); Lightformers while it loads or if missing. */
function Studio({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <Suspense fallback={<StudioFallback theme={theme} />}>
      <Environment files={ENV[theme]} environmentIntensity={theme === 'dark' ? 0.8 : 0.55} />
    </Suspense>
  )
}

function StudioFallback({ theme }: { theme: 'light' | 'dark' }) {
  const dark = theme === 'dark'
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={[dark ? '#050506' : '#d9dadd']} />
      <Lightformer intensity={dark ? 1.8 : 1.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 3, 1]} />
      <Lightformer intensity={dark ? 1.4 : 1.2} position={[-6, 1.8, 3]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
      <Lightformer intensity={dark ? 1 : 0.9} position={[6, 1.8, -3]} rotation-y={-Math.PI / 2} scale={[8, 1.2, 1]} />
      <Lightformer intensity={dark ? 0.5 : 0.5} position={[0, 0.8, -8]} scale={[12, 0.8, 1]} />
      <Lightformer form="ring" intensity={dark ? 2.2 : 1.4} position={[4, 4, 6]} scale={1.6} />
    </Environment>
  )
}

export function StudioCar({ state, theme = 'light', autoRotate = true, interactive = true, azimuth = 0, paint, className, style, still, lowPower, distance = 7.8, shiftX = 0, shiftY = 0 }: Props) {
  // graphite on light, silver on dark: the object always reads against the page
  const color = paint ?? (theme === 'dark' ? '#b9bcc1' : '#d4d6da')
  const glb = useGlbAvailable(GLB[theme])
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <Canvas
        dpr={lowPower ? 1 : [1, 1.75]}
        // the car app is drawn at fixed dp and CSS-scaled: measure layout size, not the scaled rect
        resize={{ offsetSize: true }}
        frameloop={still || lowPower ? 'demand' : 'always'}
        shadows={false}
        gl={{ antialias: true, alpha: true, localClippingEnabled: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.92 }}
        camera={{ fov: 24, near: 0.1, far: 60, position: [7, 2.3, 6] }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true
        }}
      >
        <Studio theme={theme} />
        <ambientLight intensity={theme === 'dark' ? 0.15 : 0.35} />
        <group rotation={[0, -0.35, 0]}>
          {glb === false ? (
            <>
              <Body state={state} paint={color} />
              <Windows state={state} />
              <Wheels state={state} />
            </>
          ) : glb && (
          <GlbBoundary
            fallback={
              <>
                <Body state={state} paint={color} />
                <Windows state={state} />
                <Wheels state={state} />
              </>
            }
          >
            <Suspense fallback={null}>
              <GlbCar state={state} theme={theme} />
            </Suspense>
          </GlbBoundary>
          )}
          <TyreHalo on={state.tyreWarning && !state.part} />
          <Pack state={state} theme={theme} />
          <ChargePort state={state} />
          <Suspense fallback={null}>
            <Parts show={state.xray || state.charging} part={state.part ?? null} label={state.partLabel} />
          </Suspense>
          <FloodFloor flood={state.flood} />
          <Water flood={state.flood} />
          <Sweep on={Boolean(state.newCar)} />
          <Blocks scene={state.passport} theme={theme} />
        </group>
        <ContactShadows position={[0, 0.001, 0]} opacity={theme === 'dark' ? 0.8 : 0.6} scale={HALF_L * 4.2} blur={2.6} far={2.2} resolution={512} color="#000" />
        {lowPower && <AnimateOnChange state={state} />}
        <Rig autoRotate={autoRotate && !still && !lowPower && !(state.flood && state.flood.level > 0)} interactive={interactive} azimuth={azimuth} distance={distance} shiftX={shiftX} shiftY={shiftY} high={Boolean(state.flood && state.flood.level > 0)} />
      </Canvas>
    </div>
  )
}

export default StudioCar
