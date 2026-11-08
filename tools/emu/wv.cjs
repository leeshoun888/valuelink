// Evaluates JS inside the app's WebView on the emulator (debug build; adb forward tcp:9222
// localabstract:webview_devtools_remote_<pid>). Usage: node wv.cjs '<expression>'
const puppeteer = require('puppeteer-core')
;(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
  const pages = await b.pages()
  const page = pages.find((p) => p.url().includes('#/car')) ?? pages[0]
  if (!page) throw new Error('no page')
  const r = await page.evaluate(new Function(`return (async () => (${process.argv[2]}))()`))
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1))
  b.disconnect()
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
