// Voice layer: pre-rendered prompts, dynamic TTS, the voice reaction-time probe and the
// route-aware quiz used for L2 engagement. In the APK every call is routed to the Pleos
// TextToSpeech / SpeechToText SDKs through the native bridge.

import { create } from 'zustand'
import routePack from '../data/routePack.json'
import type { Runtime } from '../engine/runtime'
import { isNative, onNativeSpeech } from '../engine/native'
import { ROUTE } from '../engine/route'

export const LINES: Record<string, string> = {
  welcome: '안녕하세요, 깨움이에요. 오늘 이동 내내 졸음 신호를 살피다가, 필요할 때 먼저 깨워 드릴게요.',
  air_fresh: '실내 이산화탄소가 높아졌어요. 바깥 공기로 환기할게요.',
  pm_pulse: '바깥 미세먼지가 나빠서, 짧게 나눠서 환기할게요.',
  refresh: '조금 피곤하실 시간이에요. 실내를 시원하고 밝게 바꿔 드릴게요.',
  caution: '앞쪽에 주의가 필요한 구간이 있어요. 지금은 특히 집중해 주세요.',
  arrived: '쉼터에 도착했어요. 커피 한 잔 드시고 15분만 눈을 붙여 보세요.',
  heat_off: '열선은 졸음을 부를 수 있어 잠시 꺼 둘게요.',
  plan_offer: '졸음이 오기 전에 쉬어 가는 게 좋겠어요. 화면의 쉼터를 경유지로 추가할까요?',
  plan_accept: '경유지로 추가했어요. 도착하면 짧은 휴식을 도와 드릴게요.',
  engage: '잠깐 저랑 퀴즈 하나 해요. 지금 지나는 지역에 관한 문제예요.',
  probe: '띵 소리가 들리면, 바로 네 라고 대답해 주세요.',
  rest_now: '졸음 위험 신호가 이어지고 있어요. 다음 쉼터에서 꼭 쉬어 가세요.',
  critical: '위험합니다. 지금 바로 안전한 곳에 차를 세워 주세요.',
  nap_offer: '주차가 확인됐어요. 이십 분 파워냅을 준비해 드릴까요?',
  nap_start: '편히 쉬세요. 이십 분 뒤에 빛과 바람으로 부드럽게 깨워 드릴게요.',
  nap_wake: '잘 쉬셨어요? 천천히 기지개를 켜고, 물 한 잔 드신 뒤 출발하세요.',
  ready: '반응속도가 회복됐어요. 이제 출발하셔도 좋아요.',
  calm: '컨디션이 좋아졌네요. 실내를 평소대로 돌려 놓을게요.',
}

export interface Quiz {
  region: string
  story: string
  q: string
  choices: string[]
  answer: number // index in choices
  explain: string
}

interface VoiceState {
  enabled: boolean
  caption: string | null
  captionKey: string | null
  probe: { phase: 'idle' | 'prompt' | 'armed' | 'listening' | 'done'; rt?: number }
  quiz: (Quiz & { picked?: number }) | null
  setEnabled: (b: boolean) => void
}

export const useVoice = create<VoiceState>((set) => ({
  enabled: false,
  caption: null,
  captionKey: null,
  probe: { phase: 'idle' },
  quiz: null,
  setEnabled: (enabled) => set({ enabled }),
}))

let ctx: AudioContext | null = null
const audioCtx = () => (ctx ??= new AudioContext())
const cache = new Map<string, HTMLAudioElement>()
let queue: Promise<void> = Promise.resolve()
let captionTimer = 0

function caption(text: string, key: string | null = null, ms = 5200) {
  useVoice.setState({ caption: text, captionKey: key })
  clearTimeout(captionTimer)
  captionTimer = window.setTimeout(() => useVoice.setState({ caption: null, captionKey: null }), ms)
}

function playFile(key: string): Promise<void> {
  return new Promise((resolve) => {
    let a = cache.get(key)
    if (!a) {
      a = new Audio(`${import.meta.env.BASE_URL}voice/${key}.mp3`)
      cache.set(key, a)
    }
    a.currentTime = 0
    a.onended = () => resolve()
    a.onerror = () => resolve()
    a.play().catch(() => resolve())
  })
}

async function speakDynamic(text: string): Promise<void> {
  if (isNative()) {
    window.CarValueNative!.speak('', text)
    return new Promise((r) => setTimeout(r, Math.min(9000, 220 * text.length)))
  }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (r.ok && r.headers.get('content-type')?.includes('audio')) {
      const url = URL.createObjectURL(await r.blob())
      await new Promise<void>((res) => {
        const a = new Audio(url)
        a.onended = () => res()
        a.onerror = () => res()
        a.play().catch(() => res())
      })
      return
    }
  } catch {
    /* fall through to the browser voice */
  }
  if ('speechSynthesis' in window) {
    await new Promise<void>((res) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ko-KR'
      u.rate = 1.05
      u.onend = () => res()
      u.onerror = () => res()
      speechSynthesis.speak(u)
    })
  }
}

export function chime(freq = 1046.5) {
  const ac = audioCtx()
  const t = ac.currentTime
  for (const [f, d] of [
    [freq, 0],
    [freq * 1.5, 0.09],
  ]) {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    o.frequency.value = f
    g.gain.setValueAtTime(0, t + d)
    g.gain.linearRampToValueAtTime(0.22, t + d + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6)
    o.connect(g).connect(ac.destination)
    o.start(t + d)
    o.stop(t + d + 0.65)
  }
}

function regionAt(routeKm: number) {
  const km = (routeKm * 395) / ROUTE.totalKm // pack ranges were authored on a 395 km reference
  return routePack.find((r) => km >= r.fromKm && km < r.toKm) ?? routePack[routePack.length - 1]
}

const asked = new Set<string>()
export function pickQuiz(km: number): Quiz {
  const reg = regionAt(km)
  const pool = reg.quizzes.filter((q) => !asked.has(q.q))
  const src = (pool.length ? pool : reg.quizzes)[0]
  asked.add(src.q)
  // Shuffle the two choices so the right answer is not always first.
  const swap = Math.random() < 0.5
  const choices = swap ? [src.choices[1], src.choices[0]] : [...src.choices]
  const answer = swap ? (src.answer === 1 ? 1 : 0) : src.answer - 1
  return { region: reg.name, story: reg.story, q: src.q, choices, answer, explain: src.explain }
}

/** Listens on the microphone and resolves with ms until voice onset (energy VAD), or null on timeout. */
async function measureVoiceOnset(timeoutMs = 2600): Promise<number | null> {
  if (isNative()) {
    return new Promise((resolve) => {
      const id = `probe-${Date.now()}`
      const t0 = performance.now()
      const off = onNativeSpeech((rid, ev) => {
        if (rid !== id) return
        if (ev === 'onBeginningOfSpeech' || ev === 'onPartialResult') {
          off()
          resolve(performance.now() - t0)
        } else if (ev === 'onError' || ev === 'onEndOfSpeech') {
          off()
          resolve(null)
        }
      })
      window.CarValueNative!.listen(id)
      setTimeout(() => (off(), resolve(null)), timeoutMs)
    })
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch {
    return null
  }
  const ac = audioCtx()
  const src = ac.createMediaStreamSource(stream)
  const an = ac.createAnalyser()
  an.fftSize = 1024
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  // Calibrate the noise floor for 250 ms, then arm.
  let floor = 0
  const calEnd = performance.now() + 250
  while (performance.now() < calEnd) {
    an.getFloatTimeDomainData(buf)
    floor = Math.max(floor, Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length))
    await new Promise((r) => requestAnimationFrame(r))
  }
  const thresh = Math.max(0.025, floor * 3.2)
  chime()
  const t0 = performance.now()
  return new Promise((resolve) => {
    const tick = () => {
      an.getFloatTimeDomainData(buf)
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
      const dt = performance.now() - t0
      if (rms > thresh && dt > 90) return done(dt)
      if (dt > timeoutMs) return done(null)
      requestAnimationFrame(tick)
    }
    const done = (v: number | null) => {
      stream.getTracks().forEach((t) => t.stop())
      src.disconnect()
      resolve(v)
    }
    requestAnimationFrame(tick)
  })
}

export const voice = {
  say(key: string) {
    const text = LINES[key]
    if (!text) return
    caption(text, key)
    if (!useVoice.getState().enabled) return
    if (isNative()) {
      window.CarValueNative!.speak(key, text)
      return
    }
    queue = queue.then(() => playFile(key))
  },

  sayText(text: string) {
    caption(text, null, Math.max(4000, text.length * 120))
    if (!useVoice.getState().enabled) return Promise.resolve()
    queue = queue.then(() => speakDynamic(text))
    return queue
  },

  engage(rt: Runtime) {
    const km = rt.bus.read().routeProgressKm ?? 0
    const quiz = pickQuiz(km)
    useVoice.setState({ quiz })
    this.say('engage')
    void this.sayText(`${quiz.q} ${quiz.choices[0]}, 아니면 ${quiz.choices[1]}?`)
    if (rt.autoPilot && rt.bus.kind === 'sim') {
      setTimeout(() => this.answer(Math.random() < 0.85 ? quiz.answer : 1 - quiz.answer), 5200)
    }
  },

  answer(idx: number) {
    const quiz = useVoice.getState().quiz
    if (!quiz || quiz.picked !== undefined) return
    useVoice.setState({ quiz: { ...quiz, picked: idx } })
    const ok = idx === quiz.answer
    void this.sayText(`${ok ? '정답이에요!' : '아쉬워요.'} ${quiz.explain}`)
    setTimeout(() => useVoice.setState({ quiz: null }), 7000)
  },

  async probe(rt: Runtime) {
    useVoice.setState({ probe: { phase: 'prompt' } })
    this.say('probe')
    await queue
    useVoice.setState({ probe: { phase: 'listening' } })
    const rtMs = await measureVoiceOnset()
    const value = rtMs ?? 900
    rt.recordProbe(value, rtMs !== null)
    useVoice.setState({ probe: { phase: 'done', rt: value } })
    setTimeout(() => useVoice.setState({ probe: { phase: 'idle' } }), 4000)
  },

  /** Manual probe outside of the orchestrator (e.g. "반응속도 측정" button or before departure). */
  async manualProbe(rt: Runtime) {
    await this.probe(rt)
  },
}
