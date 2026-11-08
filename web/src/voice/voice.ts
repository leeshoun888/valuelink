// Voice layer: every guard event is spoken once, short and calm. In the APK the Pleos TextToSpeech SDK
// speaks (native bridge); in the browser the API server's TTS, then the browser voice.

import { create } from 'zustand'
import { isNative } from '../engine/native'

interface VoiceState {
  enabled: boolean
  caption: string | null
  setEnabled: (b: boolean) => void
}

export const useVoice = create<VoiceState>((set) => ({
  enabled: false,
  caption: null,
  setEnabled: (enabled) => set({ enabled }),
}))

let ctx: AudioContext | null = null
const audioCtx = () => (ctx ??= new AudioContext())
let queue: Promise<void> = Promise.resolve()
let captionTimer = 0

function caption(text: string, ms: number) {
  useVoice.setState({ caption: text })
  clearTimeout(captionTimer)
  captionTimer = window.setTimeout(() => useVoice.setState({ caption: null }), ms)
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

/** Soft two-note chime that precedes a guard announcement. */
export function chime(freq = 880) {
  try {
    const ac = audioCtx()
    const t = ac.currentTime
    for (const [f, d] of [
      [freq, 0],
      [freq * 1.25, 0.11],
    ]) {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t + d)
      g.gain.linearRampToValueAtTime(0.16, t + d + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.7)
      o.connect(g).connect(ac.destination)
      o.start(t + d)
      o.stop(t + d + 0.75)
    }
  } catch {
    /* no audio context */
  }
}

export const voice = {
  say(text: string) {
    caption(text, Math.max(4500, text.length * 120))
    if (!useVoice.getState().enabled) return Promise.resolve()
    if (!isNative()) chime()
    queue = queue.then(() => speakDynamic(text))
    return queue
  },
}
