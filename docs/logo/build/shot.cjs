const puppeteer = require('puppeteer-core')
;(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--allow-file-access-from-files'] })
  const p = await b.newPage()
  await p.setViewport({ width: 1300, height: 330, deviceScaleFactor: 1 })
  await p.goto('file://' + process.argv[2], { waitUntil: 'load' })
  await p.screenshot({ path: process.argv[3] })
  await b.close()
})()
