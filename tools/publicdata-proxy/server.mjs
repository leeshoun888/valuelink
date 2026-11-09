// ValueLink public-data proxy: holds the data.go.kr service key so it never ships in the APK, and caches
// per KMA grid cell (5 km) so the call count grows with the number of cells, not the number of cars.
// The car sends only nx / ny, never its coordinates.
//
//   DATA_GO_KR_KEY=<service key> PORT=8791 node tools/publicdata-proxy/server.mjs
//   web: VITE_PUBLIC_PROXY=http://<host>:8791 npm run build
//
// Routes (JSON passthrough of the official responses; the web client parses them in engine/publicdata.ts)
//   GET /kma/ultra?nx=61&ny=125      기상청 단기예보 조회서비스 getUltraSrtFcst (초단기예보, 6 h)
//   GET /kma/warnings?nx=61&ny=125   기상청 기상특보 조회서비스 getWthrWrnList (stnId by region)

import http from 'node:http'

const KEY = process.env.DATA_GO_KR_KEY
const PORT = Number(process.env.PORT ?? 8791)
const TTL = 10 * 60_000
if (!KEY) {
  console.error('DATA_GO_KR_KEY is not set')
  process.exit(1)
}

const cache = new Map()

/** Ultra-short forecasts are issued every hour at :30 and published around :45. */
function ultraBase(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3)
  if (kst.getUTCMinutes() < 45) kst.setUTCHours(kst.getUTCHours() - 1)
  const d = kst.toISOString().slice(0, 10).replaceAll('-', '')
  const t = `${String(kst.getUTCHours()).padStart(2, '0')}30`
  return { d, t }
}

/** Warning station by grid row (coarse): 108 서울, 105 강릉, 133 대전, 143 대구, 156 광주, 159 부산, 184 제주. */
function station(nx, ny) {
  if (ny >= 120 && nx < 75) return 109 // 서울·인천·경기
  if (ny >= 115 && nx >= 75) return 105
  if (ny < 40) return 184
  if (nx >= 85) return ny > 80 ? 143 : 159
  return ny > 90 ? 133 : 156
}

async function cached(key, url) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.body
  const r = await fetch(url)
  const body = await r.text()
  if (r.ok) cache.set(key, { at: Date.now(), body })
  return body
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const nx = Number(u.searchParams.get('nx'))
    const ny = Number(u.searchParams.get('ny'))
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!Number.isInteger(nx) || !Number.isInteger(ny)) {
      res.writeHead(400).end('{"error":"nx, ny required"}')
      return
    }
    try {
      if (u.pathname === '/kma/ultra') {
        const { d, t } = ultraBase()
        const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?serviceKey=${KEY}&dataType=JSON&numOfRows=60&pageNo=1&base_date=${d}&base_time=${t}&nx=${nx}&ny=${ny}`
        res.end(await cached(`u${nx},${ny},${d}${t}`, url))
      } else if (u.pathname === '/kma/warnings') {
        const stn = station(nx, ny)
        const url = `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?serviceKey=${KEY}&dataType=JSON&numOfRows=20&pageNo=1&stnId=${stn}`
        res.end(await cached(`w${stn}`, url))
      } else res.writeHead(404).end('{"error":"not found"}')
    } catch (e) {
      res.writeHead(502).end(JSON.stringify({ error: String(e) }))
    }
  })
  .listen(PORT, () => console.log(`publicdata proxy on :${PORT}`))
