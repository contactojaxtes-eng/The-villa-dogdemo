/** Coordenadas aproximadas THE VILLA DOG / centro operativo Montería */
export const RESTAURANT_COORDS = { lat: 8.7575, lng: -75.888 }

const ZONE_KM_ESTIMATE: Record<string, number> = {
  Centro: 1.5,
  Norte: 3.5,
  Sur: 4,
  Oriente: 4.5,
  Occidente: 4,
  Periferia: 6.5,
  General: 3,
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function estimateDeliveryKm(zoneGroup?: string, latitude?: number, longitude?: number): number {
  if (latitude != null && longitude != null) {
    return Math.round(haversineKm(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, latitude, longitude) * 10) / 10
  }
  return ZONE_KM_ESTIMATE[zoneGroup || 'General'] ?? 3
}
