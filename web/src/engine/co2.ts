// Cabin CO2 digital twin · a single-zone mass balance:
//
//   dC/dt = N·G / V  −  λ(t) · (C − C_out)
//
// C: cabin CO2 [ppm], N: occupants, G: CO2 generation per person [m³/h],
// V: cabin air volume [m³], λ: air-exchange rate [1/h] which depends on the
// HVAC intake mode, fan speed, vehicle speed and window opening.
// Solved exactly per step (the ODE is linear with piecewise-constant inputs),
// so the model is stable for any time step · important for 60× time-lapse.

export interface CabinParams {
  volumeM3: number
  outdoorPpm: number
  genM3hPerPerson: number
}

export const DEFAULT_CABIN: CabinParams = {
  volumeM3: 3.1, // cabin air volume, 2012 Hyundai Elantra (Deng et al., Sensors 2020)
  outdoorPpm: 420,
  genM3hPerPerson: 0.0168, // ≈0.28 L/min per occupant, measured driver output (Deng et al., Sensors 2020)
}

export interface AirInputs {
  occupants: number
  recirculation: boolean
  fanSpeed: number // 0..8
  speedKph: number
  windowOpenPct: number
}

/** Air changes per hour. Recirculation still leaks (door seals, body), increasing with speed. */
export function airExchangeRate(i: AirInputs): number {
  // Recirculation leakage fitted on a Hyundai Elantra: λ = 0.060·mph − 0.88 (Deng et al. 2020) ≈ 2.85/h at 100 km/h
  const leak = Math.max(0.5, 0.06 * i.speedKph * 0.6214 - 0.88)
  const fresh = i.recirculation ? 0 : 14 + 6.5 * i.fanSpeed // ≈ 40/h at fan 4
  const window = (i.windowOpenPct / 100) * (25 + 0.6 * i.speedKph)
  return leak + fresh + window
}

export function steadyStatePpm(i: AirInputs, p: CabinParams = DEFAULT_CABIN): number {
  const lambda = airExchangeRate(i)
  return p.outdoorPpm + (i.occupants * p.genM3hPerPerson * 1e6) / (p.volumeM3 * lambda)
}

/** Exact solution over dtMin minutes. */
export function stepCo2(c: number, dtMin: number, i: AirInputs, p: CabinParams = DEFAULT_CABIN): number {
  const lambda = airExchangeRate(i)
  const css = steadyStatePpm(i, p)
  return css + (c - css) * Math.exp((-lambda * dtMin) / 60)
}

/** Minutes until CO2 reaches `targetPpm` given constant inputs (null if never). */
export function minutesUntil(c: number, targetPpm: number, i: AirInputs, p: CabinParams = DEFAULT_CABIN): number | null {
  const lambda = airExchangeRate(i)
  const css = steadyStatePpm(i, p)
  if ((targetPpm - css) * (c - css) <= 0) return c >= targetPpm ? 0 : null
  const ratio = (targetPpm - css) / (c - css)
  if (ratio <= 0 || ratio >= 1) return c >= targetPpm ? 0 : null
  return (-Math.log(ratio) / lambda) * 60
}

export type Co2Band = 'fresh' | 'stale' | 'drowsy' | 'danger'
export function co2Band(ppm: number): Co2Band {
  if (ppm < 1000) return 'fresh'
  if (ppm < 2000) return 'stale'
  if (ppm < 3500) return 'drowsy'
  return 'danger'
}

/**
 * When outdoor air is polluted we do not simply switch to fresh air permanently.
 * Duty-cycle fresh-air bursts to keep CO2 under a ceiling while minimising PM ingress.
 * Returns the fraction of time fresh-air should be on (0..1).
 */
export function freshAirDutyCycle(i: AirInputs, ceilingPpm: number, p: CabinParams = DEFAULT_CABIN): number {
  const rec = steadyStatePpm({ ...i, recirculation: true }, p)
  if (rec <= ceilingPpm) return 0
  const fresh = steadyStatePpm({ ...i, recirculation: false }, p)
  if (fresh >= ceilingPpm) return 1
  // Average exchange rate needed to hold the ceiling, interpolated between modes.
  const needLambda = (i.occupants * p.genM3hPerPerson * 1e6) / (p.volumeM3 * (ceilingPpm - p.outdoorPpm))
  const lr = airExchangeRate({ ...i, recirculation: true })
  const lf = airExchangeRate({ ...i, recirculation: false })
  return Math.min(1, Math.max(0, (needLambda - lr) / (lf - lr)))
}
