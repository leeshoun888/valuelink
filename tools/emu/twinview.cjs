// Renders the 3D twin from exact camera poses for shape review.
// Usage: node tools/emu/twinview.cjs <outPrefix>
const puppeteer = require('puppeteer-core')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = process.argv[2]
const VIEWS = {
  // [position, fov]: target is (0, 0.85, 0); +x = front, -z = driver (left) side
  side: [[0, 0.85, -24], 16],
  front34: [[6.6, 5.2, -6.4], 22], // ≈ the emulator's elevated front-left render
  front: [[24, 0.85, 0], 9],
  rear: [[-24, 0.85, 0], 9],
  top: [[0.01, 24, 0], 13],
}
;(async () => {
  const b = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-states',
    args: ['--use-angle=metal', '--enable-gpu', '--mute-audio'],
  })
  const p = await b.newPage()
  await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 })
  await p.goto('http://127.0.0.1:5173/#/console?scenario=chuseok-night', { waitUntil: 'networkidle2' })
  await p.waitForFunction(() => globalThis.__twin?.camera, { timeout: 60000 })
  await sleep(2500)
  const el = await p.$('.twin')
  for (const [name, [pos, fov]] of Object.entries(VIEWS)) {
    await p.evaluate(
      (pos, fov) => {
        const { camera, controls } = globalThis.__twin
        if (controls) {
          controls.autoRotate = false
          controls.enableDamping = false
          controls.minPolarAngle = 0
          controls.maxPolarAngle = Math.PI
          controls.maxDistance = 100
        }
        camera.position.set(...pos)
        camera.fov = fov
        camera.updateProjectionMatrix()
        camera.lookAt(0, 0.85, 0)
        controls?.update()
      },
      pos,
      fov,
    )
    await sleep(1400)
    await el.screenshot({ path: `${OUT}-${name}.png` })
    console.log(name)
  }
  await b.close()
})()
