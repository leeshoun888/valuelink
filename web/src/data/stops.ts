import { ROUTE, snapToRoute } from '../engine/route'
import type { RestStop } from '../engine/types'
import raw from './reststops.json'

type RawStop = Omit<RestStop, 'km'>

/** 졸음쉼터 + 휴게소 (public data, see README) snapped onto the active route. */
export const ALL_STOPS: RawStop[] = raw as RawStop[]
export const REST_STOPS: RestStop[] = snapToRoute(ROUTE, ALL_STOPS, 0.9).filter(
  (s, i, arr) => !arr.slice(0, i).some((o) => o.name === s.name && Math.abs(o.km - s.km) < 2),
)
