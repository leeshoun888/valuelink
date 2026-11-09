// Captures real public data around Seoul Gangnam (the scripted day's area) from the running proxy into static
// files, so the web demo and an APK without the proxy still run on real map layers, parking lots, chargers and
// icing hotspots. Weather and warnings stay scenario-driven in those builds.
//
//   tools/publicdata-proxy/run.sh &   then   node tools/publicdata-capture.mjs
//   -> web/public/pub/tiles/{flood|crime}_{tx}_{ty}.png, web/public/pub/poi/{zscode}.json, web/public/pub/meta.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const P = process.env.PROXY ?? 'http://127.0.0.1:8791'
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/public/pub')
const TILE = 0.01
const AREA = { west: 127.0, east: 127.07, south: 37.48, north: 37.525 }
const DISTRICTS = [
  ['11680', '서울특별시 강남구'],
  ['11650', '서울특별시 서초구'],
]

fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'poi'), { recursive: true })

const get = async (u) => {
  const r = await fetch(P + u)
  if (!r.ok) throw new Error(`${u} ${r.status}`)
  return r
}

let tiles = 0
for (let tx = Math.floor(AREA.west / TILE); tx <= Math.floor(AREA.east / TILE); tx++)
  for (let ty = Math.floor(AREA.south / TILE); ty <= Math.floor(AREA.north / TILE); ty++)
    for (const layer of ['flood', 'crime']) {
      const buf = Buffer.from(await (await get(`/safemap/tile?layer=${layer}&tx=${tx}&ty=${ty}`)).arrayBuffer())
      fs.writeFileSync(path.join(OUT, 'tiles', `${layer}_${tx}_${ty}.png`), buf)
      tiles++
    }

const poi = {}
for (const [z, inst] of DISTRICTS) {
  const ev = await (await get(`/ev?zscode=${z}`)).json()
  const parking = await (await get(`/parking?inst=${encodeURIComponent(inst)}`)).json()
  const freezing = await (await get(`/koroad/freezing?sido=${z.slice(0, 2)}&gugun=${z.slice(2)}`)).json()
  // keep fast chargers and E-pit (what the guard routes to); slow chargers are not used by the app
  const fast = ev.filter((c) => c.fast || c.epit)
  fs.writeFileSync(path.join(OUT, 'poi', `${z}.json`), JSON.stringify({ ev: fast, parking, freezing }))
  poi[z] = { chargers: fast.length, epit: fast.filter((c) => c.epit).length, parking: parking.length, freezing: freezing.length }
}

const meta = { capturedAt: new Date().toISOString(), area: AREA, tiles, poi, sources: ['행정안전부 생활안전지도 침수흔적도(IF_0092)', '경찰청 범죄주의구간 절도(IF_0084)', '한국환경공단 전기자동차 충전소 정보', '전국주차장정보표준데이터', '도로교통공단 결빙 교통사고 다발지역'] }
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1))
console.log(JSON.stringify(meta))
