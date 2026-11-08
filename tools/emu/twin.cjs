// Renders the console's 3D cabin twin from several orbit angles (drag-rotates the OrbitControls).
// Usage: node tools/emu/twin.cjs <outPrefix>
const puppeteer = require('puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.argv[2]
;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-states',
    args: ['--use-angle=metal', '--enable-gpu', '--mute-audio'],
  })
  const p = await b.newPage()
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
  await p.goto('http://127.0.0.1:5173/#/console?scenario=chuseok-night', { waitUntil: 'networkidle2' })
  await p.waitForSelector('.twin canvas', { timeout: 60000 })
  await sleep(4000)
  const el = await p.$('.twin')
  const box = await el.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  // [label, horizontal drag px] relative to the default front-left 3/4 view
  for (const [label, dx] of [
    ['34front', 0],
    ['side', 150],
    ['rear34', 330],
  ]) {
    if (dx) {
      await p.mouse.move(cx, cy)
      await p.mouse.down()
      await p.mouse.move(cx + dx / 2, cy, { steps: 12 })
      await p.mouse.move(cx + dx, cy, { steps: 12 })
      await p.mouse.up()
      await sleep(1500)
    }
    await el.screenshot({ path: `${OUT}-${label}.png` })
    console.log(label)
    // return to the default pose for the next absolute offset
    if (dx) {
      await p.mouse.move(cx + dx, cy)
      await p.mouse.down()
      await p.mouse.move(cx, cy, { steps: 20 })
      await p.mouse.up()
      await sleep(1200)
    }
  }
  await b.close()
})()
