// Pleos Fleet API integration (docs: document.pleos.ai/api-reference/fleet-api).
//
//   POST /api/fleet/webhook   Fleet API Webhook receiver: Periodic Data (header X-42dot-transmissionType)
//                             and Vehicle event payloads, exactly as documented. Answers 200
//                             {"status":"completed"} per the callback-response guide. Optional shared secret:
//                             FLEET_WEBHOOK_KEY must equal the X-Custom-Key header registered with the webhook.
//   GET  /api/fleet/stream    Server-Sent Events: every normalised webhook → the Fleet console, live.
//   GET  /api/fleet/state     Latest normalised state per vehicle (for a console that joins late).
//   GET  /api/fleet/vehicles  Fleet REST API GET /api/vehicles through the documented token flow
//                             (POST /auth/client/token → header x-42dot-client-id: Bearer <token>).
//                             Needs FLEET_API_HOST, FLEET_CLIENT_ID, FLEET_CLIENT_SECRET, FLEET_PROJECT_ID,
//                             which Pleos issues after a Pleos Fleet contract; 503 until then.
//
// The web Fleet console's simulator emits the same payloads through the same normaliser, so switching
// from simulation to real vehicles is configuration, not code.

const vehicles = new Map() // vehicleId → normalised state
const clients = new Set() // SSE responses

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Flattens `{ Vehicle: { Speed: { value, eventTime } } }` into `{ 'Vehicle.Speed': value }`. */
export function flatten(data, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(data ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && 'value' in v) out[key] = v.value
    else if (v && typeof v === 'object') flatten(v, key, out)
  }
  return out
}

/** One webhook POST → one normalised update per item (newest last). */
export function normalise(payload, kind) {
  const items = [...(payload.items ?? [])].sort((a, b) => String(a.messageTime).localeCompare(String(b.messageTime)))
  return items.map((it) => {
    const f = flatten(it.data)
    return {
      kind,
      vin: payload.vin,
      vehicleId: payload.vehicleId,
      t: Date.parse(it.messageTime) || Date.now(),
      speedKph: f['Vehicle.Speed'],
      lat: f['Vehicle.Latitude'],
      lon: f['Vehicle.Longitude'],
      odometerKm: f['Vehicle.Odometer'],
      dteKm: f['Vehicle.DTE'],
      socPct: f['TractionBattery.SOC'],
      accelLong: f['Acceleration.Longitudinal'],
      accelLat: f['Acceleration.Lateral'],
      ignition: f['Vehicle.DrivingReady'] ?? f['Vehicle.Ignition1'],
      buckled: f['Seat.Buckle.Driver'] ?? f['Vehicle.Seat.Buckle.Driver'],
      parkingBrake: f['ParkingBrake.Engage'],
      crash: f['Emergency.Crash'],
      raw: f,
    }
  })
}

function broadcast(update) {
  const prev = vehicles.get(update.vehicleId) ?? {}
  const merged = { ...prev }
  for (const [k, v] of Object.entries(update)) if (v !== undefined) merged[k] = v
  vehicles.set(update.vehicleId, merged)
  const line = `data: ${JSON.stringify(update)}\n\n`
  for (const c of clients) c.write(line)
}

async function readJson(req) {
  let s = ''
  for await (const c of req) {
    s += c
    if (s.length > 256_000) throw new Error('payload too large')
  }
  return s ? JSON.parse(s) : {}
}

// ---- Fleet REST API (token flow) ---------------------------------------------------------------------

let token = null // { value, exp }
async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value
  const r = await fetch(`${process.env.FLEET_API_HOST}/auth/client/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.FLEET_CLIENT_ID,
      secret: process.env.FLEET_CLIENT_SECRET,
      identifier: process.env.FLEET_PROJECT_ID,
      regenerate_token: false,
    }),
  })
  const j = await r.json()
  const value = j.accessToken ?? j.access_token ?? j.data?.accessToken
  if (!r.ok || !value) throw new Error(`token ${r.status}`)
  token = { value, exp: Date.now() + 3600_000 }
  return value
}

const fleetConfigured = () =>
  Boolean(process.env.FLEET_API_HOST && process.env.FLEET_CLIENT_ID && process.env.FLEET_CLIENT_SECRET && process.env.FLEET_PROJECT_ID)

/** Returns true when the request was a /api/fleet/* route (handled here). */
export async function handleFleet(req, res, url) {
  if (!url.pathname.startsWith('/api/fleet/')) return false
  try {
    if (url.pathname === '/api/fleet/webhook' && req.method === 'POST') {
      const key = process.env.FLEET_WEBHOOK_KEY
      if (key && req.headers['x-custom-key'] !== key) {
        send(res, 401, { error: 'Unauthorized', message: 'X-Custom-Key mismatch.' })
        return true
      }
      const payload = await readJson(req)
      if (!payload.vin && !payload.vehicleId) {
        send(res, 400, { error: 'Bad Request', message: 'Required fields are missing in the request.', errors: [{ field: 'vin', message: 'This field is required.', code: 'ERR_MISSING_FIELD' }] })
        return true
      }
      const kind = req.headers['x-42dot-transmissiontype'] ? 'periodic' : 'event'
      for (const u of normalise(payload, kind)) broadcast(u)
      send(res, 200, { status: 'completed', message: 'Request processed successfully.' })
      return true
    }
    if (url.pathname === '/api/fleet/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`retry: 3000\n\n`)
      for (const v of vehicles.values()) res.write(`data: ${JSON.stringify(v)}\n\n`)
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return true
    }
    if (url.pathname === '/api/fleet/state') {
      send(res, 200, { vehicles: [...vehicles.values()], configured: fleetConfigured() })
      return true
    }
    if (url.pathname === '/api/fleet/vehicles') {
      if (!fleetConfigured()) {
        send(res, 503, { error: 'Pleos Fleet 계약 후 발급되는 FLEET_API_HOST / CLIENT_ID / SECRET / PROJECT_ID가 필요합니다.' })
        return true
      }
      const tk = await accessToken()
      const r = await fetch(`${process.env.FLEET_API_HOST}/api/vehicles?page=${url.searchParams.get('page') ?? 1}&size=${url.searchParams.get('size') ?? 50}`, {
        headers: { 'x-42dot-client-id': `Bearer ${tk}` },
      })
      send(res, r.status, await r.json())
      return true
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e) })
  }
  return true
}
