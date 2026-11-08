// Conversational copilot over the OpenAI Realtime API (WebRTC, speech-to-speech).
// The model drives the car only through typed tools that call into the same Runtime
// the orchestrator uses · so a spoken "좀 졸려" ends up as real Pleos SDK calls.

import { create } from 'zustand'
import type { Runtime } from '../engine/runtime'
import { useSim } from '../state/store'
import { voice } from './voice'

type Status = 'idle' | 'connecting' | 'live' | 'error'
interface RtState {
  status: Status
  error: string | null
  transcript: { who: 'me' | 'ai'; text: string }[]
  toolLog: string[]
}
export const useRealtime = create<RtState>(() => ({ status: 'idle', error: null, transcript: [], toolLog: [] }))

const TOOLS = [
  {
    type: 'function',
    name: 'get_driver_status',
    description: '운전자의 현재 졸음지수(KSS), 위험 단계, 위험 도달 예측, 실내 CO2, 차량 상태, 추천 쉼터를 조회한다.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'set_cabin',
    description: '각성 유지를 위해 차량 실내 환경을 제어한다 (Pleos Vehicle SDK). 지정한 항목만 바뀐다.',
    parameters: {
      type: 'object',
      properties: {
        fresh_air: { type: 'boolean', description: 'true=외기 유입, false=내기순환' },
        temperature_c: { type: 'number', description: '설정 온도 18~28' },
        fan: { type: 'integer', description: '송풍 0~8' },
        seat_ventilation: { type: 'integer', description: '운전석 통풍 0~3' },
        ambient: { type: 'string', enum: ['calm', 'cool', 'alert', 'nap', 'wake'], description: '앰비언트 조명 프리셋' },
      },
    },
  },
  {
    type: 'function',
    name: 'add_rest_stop',
    description: '추천(또는 지정한) 졸음쉼터/휴게소를 내비게이션 경유지로 추가한다. 반드시 운전자 동의 후 호출.',
    parameters: { type: 'object', properties: { stop_name: { type: 'string', description: '생략 시 예측 플래너의 추천 쉼터' } } },
  },
  {
    type: 'function',
    name: 'start_power_nap',
    description: '정차(P단) 상태에서 파워냅 모드를 시작한다: 시트 젖힘, 수면 공조·조명, 타이머 기상.',
    parameters: { type: 'object', properties: { minutes: { type: 'integer', enum: [10, 15, 20] } }, required: ['minutes'] },
  },
  { type: 'function', name: 'start_alertness_quiz', description: '지금 지나는 지역에 관한 각성 퀴즈를 시작한다.', parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'measure_reaction_time', description: '음성 반응속도(Voice PVT)를 측정해 졸음 추정에 반영한다.', parameters: { type: 'object', properties: {} } },
]

const AMB: Record<string, { color: string; brightness: number }> = {
  calm: { color: '#3CF2C8', brightness: 35 },
  cool: { color: '#8FD8FF', brightness: 70 },
  alert: { color: '#FFB547', brightness: 80 },
  nap: { color: '#FF9A5A', brightness: 12 },
  wake: { color: '#E8F4FF', brightness: 100 },
}

function runTool(rt: Runtime, name: string, args: Record<string, unknown>): unknown {
  const s = rt.snapshot()
  const t = s.sig.t
  const log = (m: string) => useRealtime.setState((st) => ({ toolLog: [...st.toolLog.slice(-20), m] }))
  switch (name) {
    case 'get_driver_status':
      return {
        kss: +s.est.kss.toFixed(1),
        level: s.est.level,
        minutes_to_danger: s.est.minutesToDanger,
        cabin_co2_ppm: Math.round(s.co2),
        recirculation: s.sig.recirculation,
        temperature_c: s.sig.setTempC,
        speed_kph: Math.round(s.sig.speedKph),
        gear: s.sig.gear,
        continuous_driving_min: Math.round(rt.fatigue.timeOnTaskMin),
        recommended_stop: s.plan ? { name: s.plan.stop.name, eta_min: Math.round(s.plan.etaMin), kss_at_arrival: +s.plan.kssAtArrival.toFixed(1) } : null,
        top_factors: s.est.contributions.filter((c) => c.value > 0.2).sort((a, b) => b.value - a.value).slice(0, 3).map((c) => c.label),
      }
    case 'set_cabin': {
      const acts: { kind: Parameters<Runtime['applyAction']>[0]['kind']; value: unknown }[] = []
      if (typeof args.fresh_air === 'boolean') acts.push({ kind: 'freshAir', value: args.fresh_air })
      if (typeof args.temperature_c === 'number') acts.push({ kind: 'temperature', value: Math.min(28, Math.max(18, args.temperature_c)) })
      if (typeof args.fan === 'number') acts.push({ kind: 'fan', value: args.fan })
      if (typeof args.seat_ventilation === 'number') acts.push({ kind: 'seatVent', value: args.seat_ventilation })
      if (typeof args.ambient === 'string' && AMB[args.ambient]) acts.push({ kind: 'ambient', value: AMB[args.ambient] })
      rt.execute({
        t,
        level: s.est.level,
        title: '음성 요청 · 캐빈 제어',
        detail: '깨움이(Realtime AI)가 운전자 요청에 따라 실내 환경을 바꿨습니다.',
        actions: acts.map((a) => ({ ...a, value: a.value as never, reason: '운전자 음성 요청' })),
      })
      log(`set_cabin ${JSON.stringify(args)}`)
      return { ok: true, applied: acts.map((a) => a.kind) }
    }
    case 'add_rest_stop': {
      const name = String(args.stop_name ?? '')
      const stop = (name && rt.stops.find((x) => x.name.includes(name.replace(/\s/g, '').replace('휴게소', '').replace('졸음쉼터', '')))) || s.plan?.stop
      if (!stop) return { ok: false, reason: '경로 위 쉼터 없음' }
      rt.execute({ t, level: 0, title: `경유지 추가 · ${stop.name}`, detail: '운전자 음성 승인 (Realtime AI)', actions: [{ kind: 'waypoint', value: { stop, needsConfirm: false }, reason: '음성 승인' }] })
      log(`add_rest_stop ${stop.name}`)
      return { ok: true, stop: stop.name, distance_km: Math.round(stop.km - (s.sig.routeProgressKm ?? 0)) }
    }
    case 'start_power_nap':
      if (s.sig.speedKph > 1) return { ok: false, reason: '주행 중에는 시작할 수 없습니다. 정차 후 P단에서 가능합니다.' }
      rt.startNap(Number(args.minutes ?? 20))
      log('start_power_nap')
      return { ok: true }
    case 'start_alertness_quiz':
      voice.engage(rt)
      return { ok: true, note: '화면/음성으로 퀴즈가 출제됨' }
    case 'measure_reaction_time':
      void voice.probe(rt)
      return { ok: true, note: '띵 소리 후 측정' }
  }
  return { ok: false, reason: 'unknown tool' }
}

let pc: RTCPeerConnection | null = null
let mic: MediaStream | null = null
let audioEl: HTMLAudioElement | null = null

export async function startRealtime() {
  const rt = useSim.getState().runtime
  if (!rt || pc) return
  useRealtime.setState({ status: 'connecting', error: null, transcript: [] })
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/realtime/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `세션 발급 실패 (${r.status}), API 서버(server/index.mjs) 필요`)
    const { value } = await r.json()
    pc = new RTCPeerConnection()
    audioEl = new Audio()
    audioEl.autoplay = true
    pc.ontrack = (e) => (audioEl!.srcObject = e.streams[0])
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    pc.addTrack(mic.getAudioTracks()[0], mic)
    const dc = pc.createDataChannel('oai-events')
    dc.onopen = () => {
      dc.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', tools: TOOLS, tool_choice: 'auto' } }))
      const s = rt.snapshot()
      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: `[시스템 컨텍스트] 현재 졸음지수 ${s.est.kss.toFixed(1)}, 실내 CO2 ${Math.round(s.co2)}ppm, 속도 ${Math.round(s.sig.speedKph)}km/h. 운전자에게 짧게 인사해 줘.` }],
          },
        }),
      )
      dc.send(JSON.stringify({ type: 'response.create' }))
      useRealtime.setState({ status: 'live' })
    }
    dc.onmessage = (e) => {
      const ev = JSON.parse(e.data)
      if (ev.type === 'conversation.item.input_audio_transcription.completed' && ev.transcript)
        useRealtime.setState((st) => ({ transcript: [...st.transcript.slice(-12), { who: 'me', text: ev.transcript }] }))
      if (ev.type === 'response.output_audio_transcript.done' && ev.transcript)
        useRealtime.setState((st) => ({ transcript: [...st.transcript.slice(-12), { who: 'ai', text: ev.transcript }] }))
      if (ev.type === 'response.done') {
        const calls = (ev.response?.output ?? []).filter((o: { type: string }) => o.type === 'function_call')
        for (const c of calls) {
          let args = {}
          try {
            args = JSON.parse(c.arguments || '{}')
          } catch {
            /* keep empty */
          }
          const out = runTool(useSim.getState().runtime ?? rt, c.name, args)
          dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } }))
        }
        if (calls.length) dc.send(JSON.stringify({ type: 'response.create' }))
      }
      if (ev.type === 'error') useRealtime.setState({ error: ev.error?.message ?? 'error' })
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const sdp = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' },
    })
    if (!sdp.ok) throw new Error(`WebRTC 연결 실패 (${sdp.status})`)
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdp.text() })
  } catch (e) {
    stopRealtime()
    useRealtime.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

export function stopRealtime() {
  pc?.close()
  pc = null
  mic?.getTracks().forEach((t) => t.stop())
  mic = null
  if (audioEl) audioEl.srcObject = null
  if (useRealtime.getState().status !== 'error') useRealtime.setState({ status: 'idle' })
}
