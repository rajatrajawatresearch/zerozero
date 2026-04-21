/**
 * Reviews feature TS mirrors of backend Pydantic v2 schemas.
 *
 * Wire format is snake_case exactly as served by the backend. Money /
 * timestamps follow the same conventions used elsewhere in the app — ISO-8601
 * strings, decimal-string money. Image URLs are absolute.
 *
 * Backend routes consumed by this slice:
 *   GET  /restaurants/{slug}/reviews?page=1&page_size=10   → PageOut<ReviewOut>
 *
 * Contract source: `docs/PHASE4_CONTRACTS.md` — Reviews section.
 */
import type { PageOut } from '@/features/orders/types';

/* -------------------------------------------------------------------------- */
/*                                    Review                                  */
/* -------------------------------------------------------------------------- */
/**
 * Single review as shown on the restaurant detail page. Matches the server's
 * `ReviewOut` Pydantic model. `images` is optional — older reviews predate
 * the image-upload feature.
 */
export interface ReviewOut {
  id: string;
  order_id: string;
  user_id: string;
  user_name: string;
  user_avatar_url: string | null;
  rating: number;
  comment: string | null;
  images: string[];
  created_at: string;
}

/** Aggregate rating block shown at the top of the reviews section. */
export interface ReviewAggregate {
  rating_avg: number;
  rating_count: number;
}

/** Re-export paginated envelope so callers don't need two imports. */
export type ReviewPage = PageOut<ReviewOut>;
