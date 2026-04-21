/**
 * Location feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Wire format is snake_case exactly as the backend serialises it — this keeps
 * the TanStack Query cache a faithful view of the server response. UI-facing
 * adapters (e.g. `useLocationStore.setPoint`) normalise to the camelCase
 * `LocationPoint` / `Address` shapes in `@/types`.
 *
 * Contract source: `docs/PHASE2_CONTRACTS.md` — "Location & Geocoding" and
 * "Users + Addresses" sections.
 */

/* -------------------------------------------------------------------------- */
/*                        Geocoding — /geo/search, /geo/reverse                */
/* -------------------------------------------------------------------------- */
/** `PlaceOut` — a geocoded place returned by Nominatim-backed endpoints. */
export interface Place {
  /** Display string — e.g. "Connaught Place, New Delhi, Delhi, India". */
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  osm_place_id: string | null;
}

/* -------------------------------------------------------------------------- */
/*                       Addresses — /users/me/addresses                       */
/* -------------------------------------------------------------------------- */
/** Wire shape matching backend `AddressOut` exactly (snake_case). */
export interface Address {
  id: string;
  user_id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  is_default: boolean;
  created_at: string;
}

/** Payload for POST /users/me/addresses. */
export interface AddressIn {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  is_default?: boolean;
}

/** Patch payload — PATCH /users/me/addresses/{id}. All fields optional. */
export type AddressPatch = Partial<AddressIn>;
