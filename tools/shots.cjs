// Captures the screens used in the proposal and README (vite dev server on 127.0.0.1:5174).
// Usage: NODE_PATH=/Volumes/Transcend/devtools/media/node_modules node tools/shots.cjs <outDir> [only]
const puppeteer = require('puppeteer-core')
const fs = require('node:fs')
const path = require('node:path')
const OUT = process.argv[2]
const ONLY = process.argv[3]
const B = 'http://127.0.0.1:5174/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-shots',
    args: ['--use-angle=metal', '--enable-gpu', '--mute-audio', '--disable-dev-shm-usage'],
  })
  const shot = async (name, url, w, h, prep, opts = {}) => {
    if (ONLY && !name.startsWith(ONLY)) return
    const p = await b.newPage()
    await p.setViewport({ width: w, height: h, deviceScaleFactor: opts.scale ?? 1 })
    await p.goto(B + url, { waitUntil: 'load', timeout: 90000 })
    await sleep(5000)
    if (prep) await p.evaluate(prep)
    await sleep(opts.wait ?? 4000)
    await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: Boolean(opts.full) })
    await p.close()
    console.log('shot', name)
  }
  // Car app states. The store is exposed as globalThis.__cvStore; the simulator jumps along "밸류링크의 하루".
  const at = (min, extra = '') => `(() => { const s = __cvStore.getState(); s.setPlaying(false); s.sim.jumpTo(${min}); ${extra}; for (let i = 0; i < 3; i++) s.runtime.tick(1000) })()`
  await shot('car_parked', '#/car', 1700, 1212, at(60, "s.setCarTheme('light')"))
  await shot('car_dark', '#/car', 1700, 1212, at(60, "s.setCarTheme('dark')"))
  await shot('car_charging', '#/car', 1700, 1212, at(725, "s.setCarTheme('light')"))
  await shot('car_warning', '#/car', 1700, 1212, at(649, "s.setCarTheme('light')"))
  await shot('car_rain', '#/car', 1700, 1212, at(432, "s.setCarTheme('light')"))
  await shot('car_portrait', '#/car', 840, 1184, at(60, "s.setCarTheme('light')"))
  await shot('console', '#/console', 1600, 1000, at(725), { scale: 1.5 })
  await shot('passport', '#/passport', 1200, 1500, null, { full: true, scale: 1.5 })
  await shot('fleet', '#/fleet', 1400, 1000, null, { scale: 1.5 })
  await b.close()
})()
