// Route map: traveled path, a forecast ribbon colored by predicted sleepiness,
// public rest-stop data, real drowsy-crash locations (한국도로공사 2023–2025), and the car.

import { useEffect, useRef } from 'react'
import { Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useSim } from '../state/store'
import { ROUTE, pointAtKm } from '../engine/route'
import { REST_STOPS } from '../data/stops'
import accidents from '../data/accidents.json'
import { kssAt } from '../engine/planner'
import { kssColor } from '../ui/format'

// Bundlers relocate maplibre; point it at its (self-contained) worker explicitly.
setWorkerUrl(workerUrl)

const lineCoords = (from: number, to: number, step = 0.5) => {
  const out: [number, number][] = []
  for (let k = from; k <= to; k += step) out.push(pointAtKm(ROUTE, k).lngLat)
  return out
}

// 경부선 milepost (이정) runs Busan 0 → Seoul ≈416 km; map it onto our Seoul→Busan route.
const crashKm = (milepost: number) => 8 + (416 - milepost) * ((ROUTE.totalKm - 20) / 416)
const CRASHES = {
  type: 'FeatureCollection' as const,
  features: accidents.gyeongbu.map((a) => ({
    type: 'Feature' as const,
    properties: { d: a.d, h: a.h },
    geometry: { type: 'Point' as const, coordinates: pointAtKm(ROUTE, crashKm(a.km)).lngLat },
  })),
}

export function MapView({ follow = true }: { follow?: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const car = useRef<Marker | null>(null)
  const lastForecast = useRef(0)

  useEffect(() => {
    const m = new MapLibre({
      container: el.current!,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [127.6, 36.4],
      zoom: 6.4,
      pitch: 38,
      attributionControl: { compact: true },
    })
    map.current = m
    m.on('load', () => {
      // Tone the basemap toward the console palette.
      for (const layer of m.getStyle().layers ?? []) {
        if (layer.type === 'background') m.setPaintProperty(layer.id, 'background-color', '#05080d')
        if (layer.id.includes('water') && layer.type === 'fill') m.setPaintProperty(layer.id, 'fill-color', '#08131f')
      }
      m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ROUTE.points.map((p) => [p[0], p[1]]) } } })
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#1b2638', 'line-width': 7 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      m.addSource('done', { type: 'geojson', data: emptyLine() })
      m.addLayer({ id: 'done', type: 'line', source: 'done', paint: { 'line-color': '#5AB8FF', 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round' } })
      m.addSource('ahead', { type: 'geojson', data: emptyLine(), lineMetrics: true })
      m.addLayer({ id: 'ahead-glow', type: 'line', source: 'ahead', paint: { 'line-color': '#3CF2C8', 'line-width': 16, 'line-blur': 12, 'line-opacity': 0.25 }, layout: { 'line-cap': 'round' } })
      m.addLayer({ id: 'ahead', type: 'line', source: 'ahead', paint: { 'line-width': 6, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#3CF2C8', 1, '#3CF2C8'] }, layout: { 'line-cap': 'round' } })
      m.addSource('crash', { type: 'geojson', data: CRASHES })
      m.addLayer({ id: 'crash-heat', type: 'heatmap', source: 'crash', paint: { 'heatmap-radius': 18, 'heatmap-intensity': 0.9, 'heatmap-opacity': 0.55, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.3, 'rgba(255,90,60,0.35)', 1, 'rgba(255,59,79,0.9)'] } })
      m.addLayer({ id: 'crash-fatal', type: 'circle', source: 'crash', filter: ['>', ['get', 'd'], 0], paint: { 'circle-radius': 3.2, 'circle-color': '#FF3B4F', 'circle-stroke-width': 1, 'circle-stroke-color': '#2a0a0e' } })
      m.addSource('stops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: REST_STOPS.map((s) => ({ type: 'Feature', properties: { id: s.id, name: s.name, kind: s.kind }, geometry: { type: 'Point', coordinates: s.lngLat } })) },
      })
      m.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['match', ['get', 'kind'], 'service', 5.5, 3.5], 'circle-color': ['match', ['get', 'kind'], 'service', '#E8F0FF', '#3CF2C8'], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#05080d' } })
      m.addSource('plan', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'plan-ring', type: 'circle', source: 'plan', paint: { 'circle-radius': 16, 'circle-color': 'rgba(255,181,71,0.12)', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFB547' } })
      m.addLayer({ id: 'plan-label', type: 'symbol', source: 'plan', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-offset': [0, -1.9], 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#FFB547', 'text-halo-color': '#05080d', 'text-halo-width': 2 } })
    })
    const dot = document.createElement('div')
    dot.className = 'car-marker'
    dot.innerHTML = '<i></i>'
    car.current = new Marker({ element: dot, rotationAlignment: 'map' }).setLngLat([127.0276, 37.4979]).addTo(m)
    return () => m.remove()
  }, [])

  useEffect(
    () =>
      useSim.subscribe((st) => {
        const s = st.snap
        const m = map.current
        if (!s || !m || !m.isStyleLoaded() || !m.getSource('done')) return
        const km = s.sig.routeProgressKm ?? 0
        const pos = pointAtKm(ROUTE, km)
        car.current?.setLngLat(pos.lngLat).setRotation(pos.heading)
        const now = performance.now()
        if (now - lastForecast.current < 400) return
        lastForecast.current = now
        ;(m.getSource('done') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords(0, km, 1) } })
        // Forecast ribbon: 3 hours ahead at ~95 km/h, colored by predicted KSS.
        const rt = st.runtime
        if (rt) {
          const curve = rt.fatigue.forecastCurve(s.sig, s.est.kss, 180, 10)
          const span = Math.min(ROUTE.totalKm - km, (180 / 60) * 95)
          if (span > 1) {
            ;(m.getSource('ahead') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords(km, km + span, 0.8) } })
            const stops: (number | string)[] = []
            for (let i = 0; i <= 10; i++) {
              const f = i / 10
              const min = ((f * span) / 95) * 60
              stops.push(f, kssColor(kssAt(curve, min)))
            }
            m.setPaintProperty('ahead', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...stops])
          }
        }
        const target = s.waypoint ?? s.proposal?.stop ?? s.plan?.stop
        ;(m.getSource('plan') as GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: target ? [{ type: 'Feature', properties: { name: target.name }, geometry: { type: 'Point', coordinates: target.lngLat } }] : [],
        })
        if (follow) m.easeTo({ center: pos.lngLat, zoom: 8.6, bearing: 0, duration: 380 })
      }),
    [follow],
  )

  return <div ref={el} className="map" />
}

function emptyLine() {
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] } }
}
