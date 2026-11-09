import { useEffect, useRef, useState } from 'react'
import type { CarState } from './StudioCar'

/**
 * Pre-rendered Cycles clips (tools/blender/clips.py) for the scenes that look the same every time. They play
 * over the real-time car at the same camera (fov 24, three-quarter front), which fades out while a clip plays
 * and back in when it ends. Data-driven scenes (battery fill, warning part, passport blocks) stay real-time.
 * Missing clip files are fine: the real-time scene simply stays.
 */
export type ClipName = 'rain' | 'lights' | 'lock' | 'frost' | 'sun' | 'flood' | 'tradeup'

const BASE = `${import.meta.env.BASE_URL}3d/clips/`
/** Clips are framed at distance 12 (flood: 15, higher); the real-time car's distance sets the scale. */
const CLIP_DIST = 12

export interface Framing {
  distance: number
  shiftX: number
  shiftY: number
}

/** Which clip a car-state change should play (edge-triggered by the caller). */
export function clipFor(prev: CarState, next: CarState): ClipName | null {
  if ((next.flood?.level ?? 0) > 0 && !((prev.flood?.level ?? 0) > 0)) return 'flood'
  if (next.newCar && !prev.newCar) return 'tradeup'
  if ((next.rain ?? 0) > 0 && !((prev.rain ?? 0) > 0)) return 'rain'
  if (next.locked && !prev.locked) return 'lock'
  if (next.frost && !prev.frost) return 'frost'
  if (next.sun && !prev.sun) return 'sun'
  if (prev.headlights && !next.headlights) return 'lights'
  return null
}

export function ClipLayer({ clip, theme, framing, loop = false, onPlaying, onEnded }: { clip: ClipName | null; theme: 'light' | 'dark'; framing: Framing; loop?: boolean; onPlaying?: (on: boolean) => void; onEnded?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(false)
    onPlaying?.(false)
    const v = ref.current
    if (!v || !clip) return
    v.load()
    v.play().catch(() => onPlaying?.(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, theme])
  if (!clip) return null
  const h = (clip === 'flood' ? CLIP_DIST * 1.25 : CLIP_DIST) / framing.distance
  return (
    <video
      ref={ref}
      className={`cv-clip ${on ? 'on' : ''}`}
      muted
      playsInline
      autoPlay
      loop={loop}
      preload="auto"
      style={{ height: `${h * 100}%`, left: `${(0.5 + framing.shiftX) * 100}%`, top: `${(0.5 + framing.shiftY) * 100}%` }}
      onPlaying={() => {
        setOn(true)
        onPlaying?.(true)
      }}
      onEnded={() => {
        setOn(false)
        onPlaying?.(false)
        onEnded?.()
      }}
      onError={() => {
        setOn(false)
        onPlaying?.(false)
      }}
    >
      {/* VP9 with alpha where supported (Chromium, Android WebView); H.264 on black elsewhere */}
      <source src={`${BASE}${clip}_${theme}.webm`} type='video/webm; codecs="vp9"' />
      {theme === 'dark' && <source src={`${BASE}${clip}_dark.mp4`} type="video/mp4" />}
    </video>
  )
}
