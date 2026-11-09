/**
 * In-app scenes on the studio car. Each one is driven by the app's own state, so what the demo page and the video
 * show is exactly what the car shows:
 *   Parts       Blender-built HV pack structure, busbars, orange HV harness, e-motors, 12 V battery, tyre shell;
 *               the part a warning lamp points at pulses amber under a glass body
 *   FloodFloor  the real 침수흔적도 (safemap WMS tiles around the car) laid under the car as a glowing map,
 *               with the recommended public lot and the way there
 *   Water       on a heavy-rain warning inside a flood trace the water rises to the hubs; it drains once the
 *               car stands somewhere safe
 *   Sweep       trade-up: a light sweep turns the car into the next one
 *   Blocks      the passport: one glass block per day, the newest one lit
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { HALF_L, TRACK_Z, WHEEL_X, WHEEL_Y, topAt } from './ioniq5'

export type Part = 'tyre' | 'lv' | 'hv' | 'motor'

export interface FloodScene {
  /** 0 none, ~0.3 inside a flood trace (map only), 1 heavy-rain warning inside it (water) */
  level: number
  /** the car now stands outside any flood trace (water drains) */
  safe?: boolean
  center?: { lat: number; lng: number }
  target?: { lat: number; lng: number; name: string }
  tiles?: { url: string; west: number; south: number; east: number; north: number }[]
}

export const PARTS_URL = `${import.meta.env.BASE_URL}3d/parts.glb`
const AMBER = new THREE.Color('#ff9f0a')
const FLOOD_BLUE = '#0a84ff'
const PIN = '#ffffff'

// ---- parts ----------------------------------------------------------------------------------------------

const PART_OBJECTS: Record<Part, string[]> = {
  tyre: ['tyre_shell'],
  lv: ['lv_battery'],
  hv: ['hv_frame', 'hv_busbar', 'hv_harness'],
  motor: ['motor_front', 'motor_rear'],
}

/** where the callout line starts for each part (car frame) */
const ANCHOR: Record<Part, [number, number, number]> = {
  tyre: [WHEEL_X[0], WHEEL_Y + 0.42, -TRACK_Z - 0.12],
  lv: [1.92, 0.78, -0.42],
  hv: [0.2, 0.32, -0.78],
  motor: [WHEEL_X[0], WHEEL_Y + 0.2, -0.3],
}

export function Parts({ show, part, label }: { show: boolean; part: Part | null; label?: string }) {
  const { scene } = useGLTF(PARTS_URL)
  const objs = useMemo(() => {
    const root = scene.clone(true)
    const byName = new Map<string, { o: THREE.Object3D; mats: THREE.MeshStandardMaterial[] }>()
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const c = (x as THREE.MeshStandardMaterial).clone()
        c.transparent = true
        c.opacity = 0
        return c
      })
      m.material = Array.isArray(m.material) ? mats : mats[0]
      // glTF names the mesh after the Blender object; walk up to the named node
      let n: THREE.Object3D | null = o
      while (n && !Object.values(PART_OBJECTS).flat().includes(n.name) && !n.name.startsWith('motor_')) n = n.parent
      const key = n?.name ?? o.name
      const e = byName.get(key) ?? { o: n ?? o, mats: [] }
      e.mats.push(...mats)
      byName.set(key, e)
    })
    const tyre = byName.get('tyre_shell')
    if (tyre) tyre.o.position.set(WHEEL_X[0], WHEEL_Y, -TRACK_Z) // front-left
    return { root, byName }
  }, [scene])
  const vis = useRef(0)
  useFrame(({ clock }, dt) => {
    vis.current += ((show || part ? 1 : 0) - vis.current) * (1 - Math.exp(-dt * 3))
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.4)
    for (const [name, e] of objs.byName) {
      const hot = part !== null && PART_OBJECTS[part].includes(name)
      const isTyre = name === 'tyre_shell'
      for (const m of e.mats) {
        m.opacity = isTyre ? (hot ? vis.current * (0.55 + 0.35 * pulse) : 0) : vis.current * (part && !hot ? 0.35 : 1)
        m.emissive.copy(AMBER)
        m.emissiveIntensity = hot ? 0.6 + 2.2 * pulse : 0
        m.depthWrite = m.opacity > 0.9
      }
      e.o.visible = vis.current > 0.01 && (!isTyre || hot)
    }
  })
  return (
    <>
      <primitive object={objs.root} />
      {part && label && (
        <Html position={ANCHOR[part]} center={false} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="cv-callout">
            <i />
            <span>{label}</span>
          </div>
        </Html>
      )}
    </>
  )
}

// ---- flood floor: the real flood-trace map under the car -------------------------------------------------

/** Scene metres per real metre: the floor shows ~1.4 km around the car on a 16 m plate. */
/** the 3D scene shows water only; the real flood-trace map lives in the Value Map sheet */
const SHOW_MAP = false
const FLOOR = 16
const SPAN_M = 2000
const k = FLOOR / SPAN_M

function useFloodTexture(f?: FloodScene) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const key = f?.center ? `${f.center.lat.toFixed(4)},${f.center.lng.toFixed(4)},${f.tiles?.length}` : ''
  useEffect(() => {
    if (!f?.center || !f.tiles?.length) return
    let live = true
    const N = 2048
    const c = document.createElement('canvas')
    c.width = c.height = N
    const g = c.getContext('2d')!
    const lat0 = f.center.lat
    const lng0 = f.center.lng
    const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
    const toPx = (lat: number, lng: number) => ({ x: N / 2 + (((lng - lng0) * mPerLng) / SPAN_M) * N, y: N / 2 - (((lat - lat0) * 110_540) / SPAN_M) * N })
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = 1024
    const tg = tmp.getContext('2d')!
    Promise.all(
      f.tiles.map(
        (t) =>
          new Promise<void>((res) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
              // recolour the layer to one luminous blue (Apple-map restraint)
              tg.clearRect(0, 0, 1024, 1024)
              tg.globalCompositeOperation = 'source-over'
              tg.drawImage(img, 0, 0, 1024, 1024)
              tg.globalCompositeOperation = 'source-in'
              tg.fillStyle = FLOOD_BLUE
              tg.fillRect(0, 0, 1024, 1024)
              const a = toPx(t.north, t.west)
              const b = toPx(t.south, t.east)
              g.drawImage(tmp, a.x, a.y, b.x - a.x, b.y - a.y)
              res()
            }
            img.onerror = () => res()
            img.src = t.url
          }),
      ),
    ).then(() => {
      if (!live) return
      // soft vignette so the plate dissolves into the studio
      g.globalCompositeOperation = 'destination-in'
      const rg = g.createRadialGradient(N / 2, N / 2, N * 0.18, N / 2, N / 2, N / 2)
      rg.addColorStop(0, 'rgba(0,0,0,1)')
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = rg
      g.fillRect(0, 0, N, N)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      setTex((old) => {
        old?.dispose()
        return t
      })
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return tex
}

function toLocal(f: FloodScene, p: { lat: number; lng: number }) {
  const mPerLng = 111_320 * Math.cos((f.center!.lat * Math.PI) / 180)
  return new THREE.Vector3((p.lng - f.center!.lng) * mPerLng * k, 0.012, -(p.lat - f.center!.lat) * 110_540 * k)
}

export function FloodFloor({ flood }: { flood?: FloodScene }) {
  const tex = useFloodTexture(SHOW_MAP ? flood : undefined)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false }), [])
  const pin = useMemo(() => new THREE.MeshBasicMaterial({ color: PIN, transparent: true, opacity: 0, toneMapped: false }), [])
  const line = useMemo(() => new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0 }), [])
  const vis = useRef(0)
  useEffect(() => {
    mat.map = tex
    mat.needsUpdate = true
  }, [tex, mat])
  const target = flood?.center && flood.target ? toLocal(flood, flood.target) : null
  const lineGeo = useMemo(() => {
    if (!target) return null
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(target.x, 0.02, target.z)])
    return g
  }, [target?.x, target?.z]) // eslint-disable-line react-hooks/exhaustive-deps
  const lineRef = useRef<THREE.Line>(null)
  useEffect(() => {
    lineRef.current?.computeLineDistances()
  }, [lineGeo])
  useFrame((_, dt) => {
    const on = (flood?.level ?? 0) > 0 ? 1 : 0
    vis.current += (on - vis.current) * (1 - Math.exp(-dt * 2.5))
    mat.opacity = 0.58 * vis.current
    pin.opacity = (flood?.level ?? 0) >= 0.9 ? vis.current : 0
    line.opacity = pin.opacity * 0.9
  })
  if (!flood?.center) return null
  return (
    <group>
      {SHOW_MAP && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} material={mat} renderOrder={-1}>
          <planeGeometry args={[FLOOR, FLOOR]} />
        </mesh>
      )}
      {target && (
        <>
          <mesh position={target} rotation-x={-Math.PI / 2} material={pin}>
            <circleGeometry args={[0.32, 48]} />
          </mesh>
          <mesh position={[target.x, 0.5, target.z]} material={pin}>
            <cylinderGeometry args={[0.025, 0.025, 1, 12]} />
          </mesh>
          {lineGeo && (
            // eslint-disable-next-line react/no-unknown-property
            <primitive object={new THREE.Line(lineGeo, line)} ref={lineRef} />
          )}
        </>
      )}
    </group>
  )
}

// ---- water --------------------------------------------------------------------------------------------

function rippleTexture() {
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const img = g.createImageData(N, N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = Math.sin((x / N) * Math.PI * 6 + Math.sin((y / N) * Math.PI * 4) * 1.2)
      const b = Math.sin((y / N) * Math.PI * 8 + Math.cos((x / N) * Math.PI * 2) * 1.6)
      const nx = 0.5 + 0.18 * a
      const ny = 0.5 + 0.18 * b
      const i = (y * N + x) * 4
      img.data[i] = nx * 255
      img.data[i + 1] = ny * 255
      img.data[i + 2] = 255
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(5, 5)
  return t
}

function radialAlpha() {
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const rg = g.createRadialGradient(N / 2, N / 2, N * 0.22, N / 2, N / 2, N / 2)
  rg.addColorStop(0, '#fff')
  rg.addColorStop(1, '#000')
  g.fillStyle = rg
  g.fillRect(0, 0, N, N)
  return new THREE.CanvasTexture(c)
}

export function Water({ flood }: { flood?: FloodScene }) {
  const normal = useMemo(rippleTexture, [])
  const alpha = useMemo(radialAlpha, [])
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#3d84b8',
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        transparent: true,
        opacity: 0,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.35, 0.35),
        alphaMap: alpha,
        envMapIntensity: 1.4,
        depthWrite: false,
      }),
    [normal, alpha],
  )
  useEffect(() => () => [normal, alpha, mat].forEach((d) => d.dispose()), [normal, alpha, mat])
  const h = useRef(0)
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    const rising = (flood?.level ?? 0) >= 0.9 && !flood?.safe
    h.current += ((rising ? 0.3 : 0) - h.current) * (1 - Math.exp(-dt * 1.2))
    if (ref.current) {
      ref.current.position.y = h.current
      ref.current.visible = h.current > 0.004
    }
    mat.opacity = Math.min(0.85, h.current * 3.6)
    normal.offset.x += dt * 0.025
    normal.offset.y += dt * 0.017
  })
  const foamGeo = useMemo(() => new THREE.RingGeometry(0.4, 0.43, 64), [])
  const foam = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }), [])
  const foamRef = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const g = foamRef.current
    if (!g) return
    g.position.y = h.current + 0.002
    g.visible = h.current > 0.03
    foam.opacity = Math.min(0.55, h.current * 2.2) * (0.75 + 0.25 * Math.sin(clock.elapsedTime * 2))
  })
  useEffect(() => () => [foamGeo, foam].forEach((d) => d.dispose()), [foamGeo, foam])
  return (
    <>
      <mesh ref={ref} rotation-x={-Math.PI / 2} material={mat} renderOrder={2}>
        <circleGeometry args={[6.2, 96]} />
      </mesh>
      {/* a thin bright waterline where the water meets each tyre */}
      <group ref={foamRef}>
        {[WHEEL_X[0], WHEEL_X[1]].flatMap((x) =>
          [-TRACK_Z, TRACK_Z].map((z) => <mesh key={`${x}${z}`} geometry={foamGeo} material={foam} position={[x, 0, z]} rotation-x={-Math.PI / 2} scale={[1, 0.62, 1]} renderOrder={3} />),
        )}
      </group>
    </>
  )
}

// ---- trade-up sweep -------------------------------------------------------------------------------------

export function Sweep({ on }: { on: boolean }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [])
  const x = useRef(-4)
  const prev = useRef(false)
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (on && !prev.current) x.current = 3.6
    prev.current = on
    if (x.current > -3.6) x.current -= dt * 4.2
    mat.opacity = x.current > -3.6 && x.current < 3.6 ? 0.55 * Math.sin(((x.current + 3.6) / 7.2) * Math.PI) : 0
    if (ref.current) ref.current.position.x = x.current
  })
  return (
    <mesh ref={ref} position={[0, 0.85, 0]} rotation-y={Math.PI / 2} material={mat}>
      <planeGeometry args={[2.6, 1.9]} />
    </mesh>
  )
}

// ---- passport blocks ------------------------------------------------------------------------------------

/** One sealed day of the vehicle passport. */
export interface DayBlock {
  day: string
  km: number
  soh?: number
  /** heavy-rain warning that day */
  alert: boolean
  /** a warning lamp was on that day */
  warn: boolean
}

export interface PassportScene {
  days: DayBlock[]
  /** index (0 = oldest shown) whose mileage was rolled back: it cracks red, everything after it falls dark */
  tamper?: number | null
}

const INK = new THREE.Color('#ffffff')
const INK_LIGHT = new THREE.Color('#1d1d1f')
const RAIN = new THREE.Color('#8fa9bf') // rain day: a muted water tone
const LAMP = new THREE.Color('#ff9f0a')
const BROKEN = new THREE.Color('#ff9f0a') // the one signal colour

/**
 * The passport as objects: one glass block per day along an arc beside the car, height = kilometres driven, a
 * blue core on heavy-rain days, an amber cap on warning-lamp days, the newest block lit. Rolling the odometer
 * back cracks that block and the chain after it goes dark: the hash chain made visible.
 */
export function Blocks({ scene, theme = 'dark' }: { scene?: PassportScene | null; theme?: 'light' | 'dark' }) {
  const ink = theme === 'dark' ? INK : INK_LIGHT
  const days = scene?.days ?? []
  const N = days.length
  const maxKm = Math.max(30, ...days.map((d) => d.km))
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: theme === 'dark' ? '#ffffff' : '#c9ccd2', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0, envMapIntensity: 1.8, depthWrite: false }), [])
  const mats = useRef<{ core: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial; cap: THREE.MeshBasicMaterial }[]>([])
  if (mats.current.length !== N) {
    mats.current.forEach((m) => [m.core, m.line, m.cap].forEach((x) => x.dispose()))
    mats.current = days.map(() => ({
      core: new THREE.MeshBasicMaterial({ color: RAIN, transparent: true, opacity: 0, toneMapped: false }),
      line: new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0 }),
      cap: new THREE.MeshBasicMaterial({ color: LAMP, transparent: true, opacity: 0, toneMapped: false }),
    }))
  }
  useEffect(() => () => [geo, edges, glass].forEach((d) => d.dispose()), [geo, edges, glass])
  const grow = useRef(0)
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }, dt) => {
    grow.current += ((N ? N : 0) - grow.current) * (1 - Math.exp(-dt * 1.4))
    glass.opacity = N ? 0.22 : 0
    const t = scene?.tamper ?? null
    const g = group.current
    if (!g) return
    g.children.forEach((c, i) => {
      const s = THREE.MathUtils.clamp(grow.current - i, 0, 1)
      c.scale.set(1, Math.max(0.0001, s), 1)
      c.visible = s > 0.01
      const m = mats.current[i]
      if (!m) return
      const d = days[i]
      const broken = t !== null && i === t
      const dark = t !== null && i > t
      const head = i === N - 1 && t === null
      m.line.color.copy(broken ? BROKEN : ink)
      m.line.opacity = (dark ? 0.12 : head ? 1 : 0.55) * s
      m.core.color.copy(broken ? BROKEN : d.alert ? RAIN : ink)
      m.core.opacity = (broken ? 0.75 + 0.25 * Math.sin(clock.elapsedTime * 9) : dark ? 0.03 : head ? 0.95 : d.alert ? 0.55 : 0.1) * s
      m.cap.opacity = d.warn && !dark ? 0.95 * s : 0
      // a cracked block shivers
      c.position.y = broken ? 0.004 * Math.sin(clock.elapsedTime * 40) : 0
    })
  })
  return (
    <group ref={group}>
      {days.map((d, i) => {
        const t = N > 1 ? i / (N - 1) : 0
        // a straight row along the car's near side on the floor: oldest at the rear, today by the front wheel
        const x = -2.9 + t * 4.7
        const z = 1.55
        const h = 0.09 + (0.62 * d.km) / maxKm
        return (
          <group key={d.day} position={[x, 0, z]}>
            <group position={[0, h / 2, 0]}>
              <mesh geometry={geo} material={glass} scale={[0.19, h, 0.19]} renderOrder={3} />
              <lineSegments geometry={edges} material={mats.current[i].line} scale={[0.19, h, 0.19]} />
              <mesh geometry={geo} material={mats.current[i].core} scale={[0.07, h * 0.82, 0.07]} />
            </group>
            <mesh geometry={geo} material={mats.current[i].cap} position={[0, h + 0.012, 0]} scale={[0.195, 0.022, 0.195]} />
          </group>
        )
      })}
    </group>
  )
}

// ---- everyday guards: rain, headlamps, door lock, icy road, hard sun -------------------------------------

/** Rain: thin white streaks around the car (1 = drizzle on the way, 2 = raining). */
export function Rain({ level, theme = 'dark' }: { level: number; theme?: 'light' | 'dark' }) {
  const N = 520
  const geo = useMemo(() => new THREE.BoxGeometry(0.006, 0.34, 0.006), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: theme === 'dark' ? '#ffffff' : '#5f6b78', transparent: true, opacity: 0, depthWrite: false }), [theme])
  const ref = useRef<THREE.InstancedMesh>(null)
  const drops = useMemo(() => Array.from({ length: N }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, z: (Math.sin(i * 78.233) * 12345.678) % 1, y: (i * 0.618) % 1, v: 0.8 + ((i * 0.37) % 0.4) })), [])
  const o = useMemo(() => new THREE.Object3D(), [])
  const vis = useRef(0)
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat])
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    vis.current += ((level > 0 ? 1 : 0) - vis.current) * (1 - Math.exp(-dt * 2))
    mat.opacity = vis.current * (level >= 2 ? 0.42 : 0.2)
    m.visible = vis.current > 0.01
    const speed = level >= 2 ? 7 : 4
    for (let i = 0; i < N; i++) {
      const d = drops[i]
      d.y -= dt * speed * d.v * 0.25
      if (d.y < 0) d.y += 1
      o.position.set(d.x * 7, d.y * 4.2, d.z * 4.5)
      o.rotation.z = 0.12
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[geo, mat, N]} frustumCulled={false} />
}

function glowTexture(sx = 1, sy = 1) {
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  g.setTransform(sx, 0, 0, sy, (N * (1 - sx)) / 2, (N * (1 - sy)) / 2)
  const rg = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, N, N)
  return new THREE.CanvasTexture(c)
}

/** Low beams: a soft pool of light on the road ahead; it fades out when the car switches them off. */
export function Beams({ on, theme = 'dark' }: { on: boolean; theme?: 'light' | 'dark' }) {
  const tex = useMemo(() => glowTexture(), [])
  const pool = useMemo(() => new THREE.MeshBasicMaterial({ color: theme === 'dark' ? '#ffffff' : '#8d96a1', map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [tex, theme])
  useEffect(() => () => [tex, pool].forEach((d) => d.dispose()), [tex, pool])
  const v = useRef(0)
  useFrame((_, dt) => {
    v.current += ((on ? 1 : 0) - v.current) * (1 - Math.exp(-dt * 2.2))
    pool.opacity = 0.42 * v.current
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[HALF_L + 0.6, 0.01, 0]} scale={[2.4, 2.1, 1]} material={pool}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  )
}

/** Door lock: a thin white outline traces around the car once, with a quiet "잠김" mark. */
export function LockRing({ on, theme = 'dark' }: { on: boolean; theme?: 'light' | 'dark' }) {
  const { geo, count } = useMemo(() => {
    const shape = new THREE.Shape()
    const w = HALF_L + 0.22
    const h = TRACK_Z + 0.3
    const r = 0.5
    shape.moveTo(-w + r, -h)
    shape.lineTo(w - r, -h)
    shape.quadraticCurveTo(w, -h, w, -h + r)
    shape.lineTo(w, h - r)
    shape.quadraticCurveTo(w, h, w - r, h)
    shape.lineTo(-w + r, h)
    shape.quadraticCurveTo(-w, h, -w, h - r)
    shape.lineTo(-w, -h + r)
    shape.quadraticCurveTo(-w, -h, -w + r, -h)
    const pts = shape.getSpacedPoints(360)
    const pos: number[] = []
    const half = 0.024
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      const nx = (-dy / l) * half
      const ny = (dx / l) * half
      const q = [a.x + nx, a.y + ny, a.x - nx, a.y - ny, b.x - nx, b.y - ny, b.x + nx, b.y + ny]
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k * 2], 0.012, q[k * 2 + 1])
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return { geo: g, count: pos.length / 3 }
  }, [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: theme === 'dark' ? '#ffffff' : '#1d1d1f', transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }), [theme])
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat])
  const t = useRef(1)
  const prev = useRef(false)
  useFrame((_, dt) => {
    if (on && !prev.current) t.current = 0
    prev.current = on
    t.current = Math.min(1, t.current + dt / 1.4)
    geo.setDrawRange(0, Math.max(6, Math.floor((count * Math.min(1, t.current * 1.3)) / 6) * 6))
    mat.opacity = on ? 0.95 : Math.max(0, mat.opacity - dt)
  })
  return (
    <>
      <mesh geometry={geo} material={mat} renderOrder={4} />
      {on && (
        <Html position={[0, topAt(0) + 0.45, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="cv-chip">잠김</div>
        </Html>
      )}
    </>
  )
}

function frostTexture() {
  const N = 1024
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')!
  const base = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  base.addColorStop(0, 'rgba(255,255,255,0.34)')
  base.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  base.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = base
  g.fillRect(0, 0, N, N)
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  g.strokeStyle = '#fff'
  g.lineCap = 'round'
  // a handful of clean six-fold crystals, larger towards the centre
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * N * 0.4
    const x = N / 2 + Math.cos(a) * d
    const y = N / 2 + Math.sin(a) * d
    const R = (1 - d / (N * 0.5)) * 34 + 10
    const rot = rnd()
    g.globalAlpha = 0.35 + 0.4 * (1 - d / (N * 0.5))
    g.lineWidth = 1.6
    for (let k = 0; k < 6; k++) {
      const t = rot + (k / 6) * Math.PI * 2
      const ex = x + Math.cos(t) * R
      const ey = y + Math.sin(t) * R
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(ex, ey)
      for (const f of [0.45, 0.7]) {
        const bx = x + Math.cos(t) * R * f
        const by = y + Math.sin(t) * R * f
        const l = R * 0.28 * (1.1 - f)
        g.moveTo(bx, by)
        g.lineTo(bx + Math.cos(t + 0.9) * l, by + Math.sin(t + 0.9) * l)
        g.moveTo(bx, by)
        g.lineTo(bx + Math.cos(t - 0.9) * l, by + Math.sin(t - 0.9) * l)
      }
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Icy-road hotspot ahead: frost crystals spread on the road in front of the car. */
export function Frost({ on, theme = 'dark' }: { on: boolean; theme?: 'light' | 'dark' }) {
  const tex = useMemo(frostTexture, [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, color: theme === 'dark' ? '#ffffff' : '#6f8296', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [tex, theme])
  useEffect(() => () => [tex, mat].forEach((d) => d.dispose()), [tex, mat])
  const v = useRef(0)
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    v.current += ((on ? 1 : 0) - v.current) * (1 - Math.exp(-dt * 1.4))
    mat.opacity = v.current
    if (ref.current) ref.current.scale.setScalar(0.6 + 0.4 * v.current)
  })
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[HALF_L - 0.4, 0.008, 0]} material={mat}>
      <planeGeometry args={[3.4, 3.4]} />
    </mesh>
  )
}

/** Hard sun: the light turns warm and bright from above, and the roof blind slides shut under the glass. */
export function Sun({ on, blind }: { on: boolean; blind: boolean }) {
  const X0 = 0.75 // front edge of the glass roof
  const X1 = -1.25 // rear edge
  const geo = useMemo(() => {
    const n = 40
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= n; i++) {
      const x = X0 + ((X1 - X0) * i) / n
      const y = topAt(x) + 0.006
      pos.push(x, y, -0.5, x, y, 0.5)
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [])
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), [])
  const tex = useMemo(() => glowTexture(), [])
  const disc = useMemo(() => new THREE.SpriteMaterial({ map: tex, color: '#ffe9c4', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [tex])
  useEffect(() => () => [geo, shade, tex, disc].forEach((d) => d.dispose()), [geo, shade, tex, disc])
  const light = useRef<THREE.DirectionalLight>(null)
  const v = useRef(0)
  const b = useRef(0)
  useFrame((_, dt) => {
    v.current += ((on ? 1 : 0) - v.current) * (1 - Math.exp(-dt * 1.5))
    b.current += ((blind ? 1 : 0) - b.current) * (1 - Math.exp(-dt * 1.4))
    if (light.current) light.current.intensity = 1.4 * v.current
    disc.opacity = 0.85 * v.current
    // draw the blind from the front edge back: show only the first part of the strip
    const n = Math.round(40 * b.current)
    geo.setDrawRange(0, n * 6)
  })
  return (
    <>
      <directionalLight ref={light} position={[1.5, 9, 2]} intensity={0} color="#fff4e0" />
      <mesh geometry={geo} material={shade} />
      <sprite material={disc} position={[3.2, 2.4, -2.2]} scale={[1.1, 1.1, 1]} />
    </>
  )
}

useGLTF.preload(PARTS_URL)
