// Captures every web page for design review (vite dev server on 127.0.0.1:5173).
// Usage: node tools/emu/pages.cjs <outDir>
const puppeteer = require('puppeteer-core')
const path = require('node:path')
const fs = require('node:fs')
const OUT = process.argv[2]
const B = 'http://127.0.0.1:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-states',
    args: ['--use-angle=metal', '--enable-gpu', '--mute-audio'],
  })
  const page = async (w, h) => {
    const p = await b.newPage()
    await p.setViewport({ width: w, height: h })
    return p
  }

  // Landing: viewport-sized slices down the whole page (reveal animations need scrolling).
  {
    const p = await page(1600, 1000)
    await p.goto(B + '#/', { waitUntil: 'networkidle2' })
    await sleep(2500)
    const total = await p.evaluate(() => document.documentElement.scrollHeight)
    let i = 1
    for (let y = 0; y < total; y += 1000) {
      await p.evaluate((y) => window.scrollTo(0, y), y)
      await sleep(1300)
      await p.screenshot({ path: path.join(OUT, `01_landing_${String(i++).padStart(2, '0')}.png`) })
    }
    await p.close()
  }

  // Mission Control, in-car night and day, with a rest stop accepted so every panel has content.
  for (const theme of ['night', 'day']) {
    const p = await page(1920, 1080)
    await p.goto(B + '#/console?scenario=chuseok-night', { waitUntil: 'networkidle2' })
    await p.waitForFunction(() => globalThis.__cvStore?.getState().runtime)
    await p.evaluate((theme) => {
      const st = globalThis.__cvStore.getState()
      st.setPlaying(false)
      st.setCarTheme(theme)
      const rt = st.runtime
      rt.autoPilot = false
      for (let i = 0; i < 200 && !rt.proposal; i++) rt.frame(60_000, 1)
      rt.acceptProposal()
      rt.frame(60_000, 1)
      globalThis.__cvStore.setState({ snap: rt.snapshot() })
    }, theme)
    await sleep(3500)
    await p.screenshot({ path: path.join(OUT, `02_console_${theme}.png`) })
    await p.close()
  }

  // Fleet console (let the 24 engines warm up) and the trip report.
  {
    const p = await page(1600, 1000)
    await p.goto(B + '#/fleet', { waitUntil: 'networkidle2' })
    await sleep(16000)
    await p.screenshot({ path: path.join(OUT, '04_fleet.png') })
    await p.evaluate(() => window.scrollTo(0, 1000))
    await sleep(1200)
    await p.screenshot({ path: path.join(OUT, '04_fleet_2.png') })
    await p.close()
  }
  {
    const p = await page(1600, 1000)
    await p.goto(B + '#/console?scenario=chuseok-night', { waitUntil: 'networkidle2' })
    await p.waitForFunction(() => globalThis.__cvStore?.getState().runtime)
    await p.evaluate(() => {
      const st = globalThis.__cvStore.getState()
      st.setPlaying(false)
      st.runtime.frame(180 * 60_000, 1)
      globalThis.__cvStore.setState({ snap: st.runtime.snapshot() })
    })
    await p.evaluate(() => (location.hash = '#/report'))
    await sleep(3000)
    await p.screenshot({ path: path.join(OUT, '05_report.png'), fullPage: true })
    await p.close()
  }
  await b.close()
})()
