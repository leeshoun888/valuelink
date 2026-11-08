// Renders docs/diagrams.html sections to docs/img/{loop,arch}.png at 2x.
const puppeteer = require('puppeteer-core')
const path = require('node:path')
;(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', userDataDir: '/Volumes/Transcend/devtools/tmp/chrome-diag', args: ['--allow-file-access-from-files'] })
  const p = await b.newPage()
  await p.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 })
  await p.goto('file://' + path.resolve(__dirname, '../docs/diagrams.html'), { waitUntil: 'load' })
  await new Promise((r) => setTimeout(r, 800))
  for (const id of ['loop', 'arch']) {
    const el = await p.$('#' + id)
    await el.screenshot({ path: path.resolve(__dirname, `../docs/img/${id}.png`) })
    console.log('diagram', id)
  }
  await b.close()
})()
