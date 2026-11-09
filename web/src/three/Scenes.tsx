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
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { TRACK_Z, WHEEL_X, WHEEL_Y } from './ioniq5'

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

// ---- parts ----------------------------------------------------------------------------------------------

const PART_OBJECTS: Record<Part, string[]> = {
  tyre: ['tyre_shell'],
  lv: ['lv_battery'],
  hv: ['hv_frame', 'hv_busbar', 'hv_harness'],
  motor: ['motor_front', 'motor_rear'],
}

export function Parts({ show, part }: { show: boolean; part: Part | null }) {
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
  return <primitive object={objs.root} />
}

// ---- flood floor: the real flood-trace map under the car -------------------------------------------------

/** Scene metres per real metre: the floor shows ~1.4 km around the car on a 16 m plate. */
const FLOOR = 16
const SPAN_M = 2000
const k = FLOOR / SPAN_M

function useFloodTexture(f?: FloodScene) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const key = f?.center ? `${f.center.lat.toFixed(4)},${f.center.lng.toFixed(4)},${f.tiles?.length}` : ''
  useEffect(() => {
    if (!f?.center || !f.tiles?.length) return
    let live = true
    const N = 1024
    const c = document.createElement('canvas')
    c.width = c.height = N
    const g = c.getContext('2d')!
    const lat0 = f.center.lat
    const lng0 = f.center.lng
    const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
    const toPx = (lat: number, lng: number) => ({ x: N / 2 + (((lng - lng0) * mPerLng) / SPAN_M) * N, y: N / 2 - (((lat - lat0) * 110_540) / SPAN_M) * N })
    const tmp = document.createElement('canvas')
    tmp.width = tmp.height = 512
    const tg = tmp.getContext('2d')!
    Promise.all(
      f.tiles.map(
        (t) =>
          new Promise<void>((res) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
              // recolour the layer to one luminous blue (Apple-map restraint)
              tg.clearRect(0, 0, 512, 512)
              tg.globalCompositeOperation = 'source-over'
              tg.drawImage(img, 0, 0, 512, 512)
              tg.globalCompositeOperation = 'source-in'
              tg.fillStyle = FLOOD_BLUE
              tg.fillRect(0, 0, 512, 512)
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
      t.anisotropy = 4
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
  const tex = useFloodTexture(flood)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false }), [])
  const pin = useMemo(() => new THREE.MeshBasicMaterial({ color: FLOOD_BLUE, transparent: true, opacity: 0, toneMapped: false }), [])
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
    const on = (flood?.level ?? 0) > 0 && tex ? 1 : 0
    vis.current += (on - vis.current) * (1 - Math.exp(-dt * 2.5))
    mat.opacity = 0.58 * vis.current
    pin.opacity = (flood?.level ?? 0) >= 0.9 ? vis.current : 0
    line.opacity = pin.opacity * 0.9
  })
  if (!flood?.center) return null
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} material={mat} renderOrder={-1}>
        <planeGeometry args={[FLOOR, FLOOR]} />
      </mesh>
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
        color: '#1d5fa8',
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
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} material={mat} renderOrder={2}>
      <circleGeometry args={[6.2, 96]} />
    </mesh>
  )
}

// ---- trade-up sweep -------------------------------------------------------------------------------------

export function Sweep({ on }: { on: boolean }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
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

export function Blocks({ count }: { count: number }) {
  const N = 28
  const geo = useMemo(() => new THREE.BoxGeometry(0.17, 0.17, 0.17), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, metalness: 0, clearcoat: 1, transparent: true, opacity: 0, envMapIntensity: 1.6 }), [])
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 }), [])
  const head = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0a84ff', transparent: true, opacity: 0, toneMapped: false }), [])
  useEffect(() => () => [geo, edges, mat, lineMat, head].forEach((d) => d.dispose()), [geo, edges, mat, lineMat, head])
  const grow = useRef(0)
  useFrame((_, dt) => {
    const target = count > 0 ? N : 0
    grow.current += (target - grow.current) * (1 - Math.exp(-dt * 1.6))
    mat.opacity = Math.min(0.32, grow.current / N)
    lineMat.opacity = Math.min(0.7, grow.current / N)
    head.opacity = grow.current > N - 1.5 ? 0.9 : 0
  })
  const blocks = []
  for (let i = 0; i < N; i++) {
    // a gentle arc beside the car, oldest at the back
    const t = i / (N - 1)
    const x = 2.7 - t * 6.4
    const z = 1.55 + 0.35 * Math.sin(t * Math.PI)
    blocks.push(
      <group key={i} position={[x, 0.09, z]} scale={1} visible>
        <mesh geometry={geo} material={i === 0 ? head : mat} onBeforeRender={() => undefined} />
        <lineSegments geometry={edges} material={lineMat} />
      </group>,
    )
  }
  return <BlocksReveal grow={grow}>{blocks}</BlocksReveal>
}

function BlocksReveal({ grow, children }: { grow: React.MutableRefObject<number>; children: React.ReactNode[] }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    g.children.forEach((c, i) => {
      const s = THREE.MathUtils.clamp(grow.current - i, 0, 1)
      c.scale.setScalar(s)
      c.visible = s > 0.01
    })
  })
  return <group ref={ref}>{children}</group>
}

useGLTF.preload(PARTS_URL)
