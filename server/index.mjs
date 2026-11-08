// KKAEUM API server (zero dependencies, Node ≥ 20).
// Keeps the OpenAI key server-side and serves the built web app.
//   POST /api/realtime/session  → ephemeral client secret for the WebRTC voice copilot
//   POST /api/tts               → dynamic Korean speech (gpt-4o-mini-tts)
//   POST /api/coach             → AI trip report from the trip summary (Responses API)
//   /api/fleet/*                → Pleos Fleet API webhook receiver, SSE stream, REST proxy (server/fleet.mjs)
//   GET  /api/health
// Usage: OPENAI_API_KEY=... node server/index.mjs   (PORT defaults to 8790)

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleFleet } from './fleet.mjs'

const PORT = Number(process.env.PORT ?? 8790)
const KEY = process.env.OPENAI_API_KEY
const DIST = fileURLToPath(new URL('../web/dist/', import.meta.url))
const REALTIME_MODEL = process.env.REALTIME_MODEL ?? 'gpt-realtime-2.1'
const TEXT_MODEL = process.env.TEXT_MODEL ?? 'gpt-5.5'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
}

// Simple per-IP rate limit so a public demo cannot drain the key.
const hits = new Map()
function limited(ip, max = 40) {
  const now = Date.now()
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000)
  h.push(now)
  hits.set(ip, h)
  return h.length > max
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function body(req) {
  let s = ''
  for await (const c of req) {
    s += c
    if (s.length > 64_000) throw new Error('payload too large')
  }
  return s ? JSON.parse(s) : {}
}

const openai = (path, payload) =>
  fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

const COPILOT_INSTRUCTIONS = `너는 현대자동차 Pleos Connect 차량에 탑재된 졸음운전 예방 코파일럿 "깨움이"다.
- 운전 중인 사람과 대화한다. 한 번에 1~2문장, 짧고 또렷한 한국어 존댓말. 화면을 보라고 하지 않는다.
- 운전자가 졸리다/피곤하다고 하면 get_driver_status로 상태를 확인하고, set_cabin으로 외기 유입·온도 1~2도 낮춤·송풍 올림·통풍시트를 켜고, 추천 쉼터를 add_rest_stop으로 경유지 추가할지 묻는다.
- 운전자의 승낙 없이 경유지를 추가하지 않는다. 운전 조작(속도/조향/브레이크)에는 절대 개입하지 않는다.
- 졸음 신호가 있을 때 각성을 위해 짧은 대화·퀴즈를 이끌 수 있다(start_alertness_quiz). 반응속도 측정은 measure_reaction_time.
- 정차(P단) 중이면 start_power_nap으로 10~20분 파워냅을 제안할 수 있다.
- 의학적 진단을 하지 않는다. 위험(졸음지수 7 이상)이면 다음 쉼터에서 꼭 쉬라고 분명히 말한다.`

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress ?? 'x'
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, ai: Boolean(KEY), model: REALTIME_MODEL })
  if (await handleFleet(req, res, url)) return
  if (!KEY) return json(res, 503, { error: 'OPENAI_API_KEY not configured' })
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
  if (limited(ip)) return json(res, 429, { error: 'rate limited' })
  try {
    const b = await body(req)
    if (url.pathname === '/api/realtime/session') {
      const r = await openai('realtime/client_secrets', {
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: COPILOT_INSTRUCTIONS,
          audio: {
            input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'ko' }, turn_detection: { type: 'semantic_vad' } },
            output: { voice: 'marin' },
          },
        },
      })
      const j = await r.json()
      if (!r.ok) return json(res, r.status, { error: j.error?.message ?? 'realtime error' })
      return json(res, 200, { value: j.value, expires_at: j.expires_at, model: REALTIME_MODEL })
    }
    if (url.pathname === '/api/tts') {
      const text = String(b.text ?? '').slice(0, 400)
      if (!text) return json(res, 400, { error: 'text required' })
      const r = await openai('audio/speech', {
        model: 'gpt-4o-mini-tts',
        voice: 'marin',
        input: text,
        instructions: '차량 안 운전자에게 말하는 따뜻하고 또렷한 한국어 코파일럿. 자연스러운 속도.',
        response_format: 'mp3',
      })
      if (!r.ok) return json(res, r.status, { error: 'tts error' })
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      return res.end(Buffer.from(await r.arrayBuffer()))
    }
    if (url.pathname === '/api/coach') {
      const r = await openai('responses', {
        model: TEXT_MODEL,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'system',
            content:
              '너는 졸음운전 예방 앱 "깨움"의 안전 코치다. 주어진 주행 요약 JSON만 근거로, 운전자에게 주는 주행 리포트를 한국어로 쓴다. 형식: 제목 한 줄, 핵심 요약 2문장, "잘한 점" 2개, "다음 주행 팁" 3개(구체적 시각·행동). 과장·의학적 진단 금지. 마크다운 사용. 엠대시(—) 문장부호는 쓰지 않는다.',
          },
          { role: 'user', content: JSON.stringify(b).slice(0, 12_000) },
        ],
      })
      const j = await r.json()
      if (!r.ok) return json(res, r.status, { error: j.error?.message ?? 'coach error' })
      const raw = j.output?.find((o) => o.type === 'message')?.content?.[0]?.text ?? ''
      // House style: no em dashes in anything shown to the user.
      const text = raw.replace(/\s*\u2014\s*/g, ', ')
      return json(res, 200, { text })
    }
    return json(res, 404, { error: 'not found' })
  } catch (e) {
    return json(res, 500, { error: String(e.message ?? e) })
  }
}

async function serveStatic(res, url) {
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  if (p === '/' || p === '') p = '/index.html'
  let file = join(DIST, p)
  if (!file.startsWith(DIST)) file = join(DIST, 'index.html')
  try {
    if (!(await stat(file)).isFile()) throw 0
  } catch {
    file = join(DIST, 'index.html')
  }
  try {
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('build the web app first: cd web && npm run build')
  }
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) return void handleApi(req, res, url)
  return void serveStatic(res, url)
}).listen(PORT, () => console.log(`KKAEUM server on http://localhost:${PORT}  (AI ${KEY ? 'enabled' : 'disabled'})`))
