// Drives the Pleos Connect emulator along the bundled Seoul → Busan route: every second it sends a GPS
// fix (adb emu geo fix) and the matching speed / gear to the Virtual Console, so the app sees a real drive.
// Usage: node tools/emu/drive.mjs [--from-km 0] [--kph 100] [--warp 1] [--stop-at-km N]
//   --warp 5 moves 5× faster along the road than the reported speed (to reach events sooner).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const route = JSON.parse(readFileSync(join(here, '../../web/src/data/route.json'), 'utf8'))
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? Number(process.argv[i + 1]) : d
}
let km = arg('from-km', 0)
const kph = arg('kph', 100)
const warp = arg('warp', 1)
const stopAt = arg('stop-at-km', route.totalKm)
const ADB = join(process.env.ANDROID_HOME ?? '/Volumes/Transcend/devtools/android-sdk', 'platform-tools/adb')
const VC = 'http://127.0.0.1:8088'

function at(k) {
  const p = route.points
  let i = 1
  while (i < p.length - 1 && p[i][2] < k) i++
  const a = p[i - 1]
  const b = p[i]
  const f = b[2] === a[2] ? 0 : Math.min(1, Math.max(0, (k - a[2]) / (b[2] - a[2])))
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

async function put(path) {
  try {
    await fetch(VC + path, { method: 'PUT' })
  } catch {
    /* Virtual Console not forwarded: GPS still moves */
  }
}

await put('/vehicle/gear?gear=Drive')
let stopping = false
process.on('SIGINT', () => (stopping = true))
console.log(`driving from km ${km.toFixed(1)} at ${kph} km/h (warp ×${warp}); Ctrl-C to stop`)
while (!stopping && km < stopAt) {
  const [lng, lat] = at(km)
  execFileSync(ADB, ['emu', 'geo', 'fix', lng.toFixed(6), lat.toFixed(6)], { stdio: 'ignore' })
  await put(`/vehicle/controls?speed=${kph}&accelerator=20&brake=0`)
  if (Math.round(km * 10) % 50 === 0) console.log(`km ${km.toFixed(1)}  ${lat.toFixed(5)},${lng.toFixed(5)}`)
  km += (kph / 3600) * warp
  await new Promise((r) => setTimeout(r, 1000))
}
await put('/vehicle/controls?speed=0&accelerator=0&brake=30')
console.log(`stopped at km ${km.toFixed(1)}`)
