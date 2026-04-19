import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Distance-based delivery fee.
 *
 * Pricing model (v1):
 *   fee = base + per_km * max(0, distance_km - free_radius_km)
 *   distance > max_radius_m   → deliverable=false (caller rejects order)
 *
 * Knobs (env, all optional — sane defaults match the old flat $3):
 *   DELIVERY_FEE_BASE_CENTS      default 200   ($2.00 base "door-to-scooter")
 *   DELIVERY_FEE_PER_KM_CENTS    default 100   ($1.00 per km past the free radius)
 *   DELIVERY_FREE_RADIUS_M       default 500   (first 500 m are included in base)
 *   DELIVERY_MAX_RADIUS_M        default 7000  (refuse to deliver past 7 km)
 *   DELIVERY_FEE_CENTS           default 300   (fallback flat when coords missing)
 *
 * When customer coords aren't available (client didn't ask for geolocation
 * or user denied), we fall back to the flat `DELIVERY_FEE_CENTS` and mark
 * `distanceM = null`. Deliverability passes — we don't want to block orders
 * just because the browser didn't grant geolocation.
 */
export interface DeliveryFeeQuote {
  feeCents: number;
  distanceM: number | null;
  deliverable: boolean;
  reason: 'OK' | 'OUTSIDE_RADIUS' | 'NO_COORDS_FLAT';
}

@Injectable()
export class DeliveryFeeService {
  constructor(private readonly config: ConfigService) {}

  quote(params: {
    storeLatitude: number;
    storeLongitude: number;
    customerLatitude?: number | null;
    customerLongitude?: number | null;
  }): DeliveryFeeQuote {
    const flat = this.intEnv('DELIVERY_FEE_CENTS', 300);
    const base = this.intEnv('DELIVERY_FEE_BASE_CENTS', 200);
    const perKm = this.intEnv('DELIVERY_FEE_PER_KM_CENTS', 100);
    const freeRadiusM = this.intEnv('DELIVERY_FREE_RADIUS_M', 500);
    const maxRadiusM = this.intEnv('DELIVERY_MAX_RADIUS_M', 7000);

    const custLat = params.customerLatitude;
    const custLng = params.customerLongitude;
    if (custLat == null || custLng == null) {
      return { feeCents: flat, distanceM: null, deliverable: true, reason: 'NO_COORDS_FLAT' };
    }

    const distanceM = Math.round(haversineMeters(params.storeLatitude, params.storeLongitude, custLat, custLng));
    if (distanceM > maxRadiusM) {
      return { feeCents: 0, distanceM, deliverable: false, reason: 'OUTSIDE_RADIUS' };
    }

    const billableM = Math.max(0, distanceM - freeRadiusM);
    const feeCents = base + Math.ceil((billableM / 1000) * perKm);
    return { feeCents, distanceM, deliverable: true, reason: 'OK' };
  }

  private intEnv(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
}

/** Haversine great-circle distance in metres. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
