// Renders the in-car app (#/car on the vite dev server) in every UI state, day and night, landscape
// (1682×1210, the Pleos Connect-S app window) and portrait (840×1184), for design review.
// Usage: node tools/emu/states.cjs <outDir> [stateName ...]
const puppeteer = require('puppeteer-core')
const path = require('node:path')
const fs = require('node:fs')

const OUT = process.argv[2]
const only = process.argv.slice(3)
const BASE = 'http://127.0.0.1:5173/#/car?scenario=chuseok-night'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Each state: a function run in the page against the zustand store (globalThis.__cvStore).
const STATES = {
  drive: `rt.frame(25 * 60_000, 1)`,
  proposal: `rt.autoPilot = false; for (let i = 0; i < 200 && !rt.proposal; i++) rt.frame(60_000, 1)`,
  waypoint: `rt.autoPilot = false; for (let i = 0; i < 200 && !rt.proposal; i++) rt.frame(60_000, 1); rt.acceptProposal(); rt.frame(10_000, 1)`,
  critical: `rt.autoPilot = false; rt.frame(25 * 60_000, 1); rt.waypoint = null; rt.proposal = null; rt.bus.daw = true; rt.frame(20_000, 1); rt.waypoint = null`,
  parked: `rt.frame(40 * 60_000, 1); rt.bus.speed = 0; rt.bus.gear = 'P'; rt.bus.parkingBrake = true; rt.bus.state = 'parked'; rt.orch.mode = 'parked'`,
  nap: `rt.bus.speed = 0; rt.bus.gear = 'P'; rt.bus.parkingBrake = true; rt.bus.state = 'parked'; rt.frame(20_000, 1); rt.startNap(15); rt.frame(240_000, 1)`,
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-states',
    args: ['--use-angle=metal', '--enable-gpu', '--mute-audio'],
  })
  for (const [name, script] of Object.entries(STATES)) {
    if (only.length && !only.includes(name)) continue
    for (const theme of ['day', 'night']) {
      for (const [orient, w, h] of [
        ['land', 1682, 1210],
        ['port', 840, 1184],
      ]) {
        const p = await b.newPage()
        await p.setViewport({ width: w, height: h })
        await p.goto(BASE, { waitUntil: 'networkidle2' })
        await p.waitForFunction(() => globalThis.__cvStore?.getState().runtime)
        await p.evaluate(
          (script, theme) => {
            const st = globalThis.__cvStore.getState()
            st.setPlaying(false)
            st.setCarTheme(theme)
            const rt = st.runtime
            // eslint-disable-next-line no-new-func
            new Function('rt', script)(rt)
            globalThis.__cvStore.setState({ snap: rt.snapshot() })
          },
          script,
          theme,
        )
        await sleep(900)
        const file = path.join(OUT, `${name}-${theme}-${orient}.png`)
        await p.screenshot({ path: file })
        await p.close()
        console.log(file)
      }
    }
  }
  await b.close()
})()
