// District lookup for district-keyed public data (EV chargers, parking, icing hotspots, UV index).
// The car resolves its own district on the device; only the district code leaves the car.
// Seoul's 25 districts for the pilot; elsewhere the weather (grid) and map layers (tile) still work.

export interface Region {
  name: string
  /** 5-digit 시군구 code (EV charger zscode) */
  zscode: string
  sido: string
  gugun: string
  /** 10-digit area code for the KMA living-weather index */
  area: string
  /** KMA warning station */
  stn: number
  /** institution name in the parking standard data */
  inst: string
}

const SEOUL: [string, string, number, number][] = [
  ['종로구', '11110', 37.573, 126.979],
  ['중구', '11140', 37.5641, 126.9979],
  ['용산구', '11170', 37.5324, 126.99],
  ['성동구', '11200', 37.5634, 127.0369],
  ['광진구', '11215', 37.5385, 127.0823],
  ['동대문구', '11230', 37.5744, 127.0396],
  ['중랑구', '11260', 37.6063, 127.0927],
  ['성북구', '11290', 37.5894, 127.0167],
  ['강북구', '11305', 37.6396, 127.0257],
  ['도봉구', '11320', 37.6688, 127.0471],
  ['노원구', '11350', 37.6542, 127.0568],
  ['은평구', '11380', 37.6027, 126.9291],
  ['서대문구', '11410', 37.5791, 126.9368],
  ['마포구', '11440', 37.5663, 126.9019],
  ['양천구', '11470', 37.517, 126.8664],
  ['강서구', '11500', 37.5509, 126.8495],
  ['구로구', '11530', 37.4954, 126.8874],
  ['금천구', '11545', 37.4569, 126.8955],
  ['영등포구', '11560', 37.5264, 126.8962],
  ['동작구', '11590', 37.5124, 126.9393],
  ['관악구', '11620', 37.4784, 126.9516],
  ['서초구', '11650', 37.4837, 127.0324],
  ['강남구', '11680', 37.5172, 127.0473],
  ['송파구', '11710', 37.5145, 127.1059],
  ['강동구', '11740', 37.5301, 127.1238],
]

const make = ([name, z]: [string, string, number, number]): Region => ({ name: `서울 ${name}`, zscode: z, sido: z.slice(0, 2), gugun: z.slice(2), area: `${z}00000`, stn: 109, inst: `서울특별시 ${name}` })

/** Districts by distance from the point (centroid approximation). */
export function regionsNear(lat: number, lng: number, n = 2): Region[] {
  if (lat < 37.41 || lat > 37.72 || lng < 126.76 || lng > 127.19) return []
  return [...SEOUL]
    .sort((a, b) => (a[2] - lat) ** 2 + ((a[3] - lng) * 0.79) ** 2 - ((b[2] - lat) ** 2 + ((b[3] - lng) * 0.79) ** 2))
    .slice(0, n)
    .map(make)
}

export function regionOf(lat: number, lng: number): Region | null {
  return regionsNear(lat, lng, 1)[0] ?? null
}
