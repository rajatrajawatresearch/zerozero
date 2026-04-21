# Phase 4 — Realtime + Polish Contracts

## WebSocket endpoints

```
/ws/orders/{order_id}?token=<access>    — authed customer watches own order
/ws/partner?token=<access>              — delivery partner receives assignment + sends location
/ws/public/track/{share_token}          — no auth; shared tracking link
```

All WS messages JSON shape:
```ts
type WsMessage =
  | { type: 'status', status: OrderStatus, note?: string, at: string }
  | { type: 'partner_location', lat: number, lng: number, heading?: number, speed?: number, at: string }
  | { type: 'eta', minutes: number, at: string }
  | { type: 'assignment', order_id: string, pickup: {lat, lng, name}, drop: {lat, lng, label}, at: string }
  | { type: 'ping' }
  | { type: 'pong' }
```

Server sends `ping` every 25s; client must reply `pong` within 10s else server drops.

## Redis pub/sub channels

- `orders:{order_id}` — fan out to all WS subs for that order
- `partners:{partner_id}` — fan out to partner's own WS
- `public:{share_token}` — fan out to public trackers (same events as orders, minus PII)

Connection manager pattern:
```python
class ConnectionManager:
    connections: dict[str, set[WebSocket]]   # channel → sockets
    async def join(channel, ws): ...
    async def leave(channel, ws): ...
    async def broadcast(channel, msg: dict): ...   # serializes + await send_text
```

One asyncio task per process subscribes to the matching Redis pub/sub channels and fans messages out via broadcast.

## Partner simulator route (dev only)

```
POST /partner/online                       — mark partner online, location
POST /partner/location                     — batch of {lat, lng, recorded_at} points
POST /partner/orders/{id}/accept           — partner accepts assigned order
POST /partner/orders/{id}/status?s=X       — advance order status (confirmed/preparing/ready/out_for_delivery/delivered)
```
All partner routes: `Depends(require_role(UserRole.PARTNER, UserRole.ADMIN))`.

Side effects of `status` POST: publish to `orders:{id}` and `public:{share_token}`.

## Reviews

```
POST /reviews                              body: {order_id, rating 1-5, comment, images[]}
   → 201 ReviewOut (already exists from Phase 3 scope; Phase 4 adds aggregate recompute)
```
After create: `UPDATE restaurants SET rating_avg=avg, rating_count=count FROM (SELECT ...) WHERE id=restaurant_id` — via trigger OR service call (pick service-call for simplicity).

## Notifications

```
GET    /notifications?unread=true&page=1   → PageOut[NotificationOut]
POST   /notifications/{id}/read            → 204
POST   /notifications/read-all             → 204
GET    /notifications/unread-count         → {count: int}
```

WebSocket: `/ws/notifications?token=X` pushes new notifications live.

```python
class NotificationOut(BaseModel):
    id: UUID
    type: str        # "order_status" | "promo" | "generic"
    title: str
    body: str
    payload: dict
    is_read: bool
    created_at: datetime
```

Events that create notifications:
- order status changes → notify owner
- promo published → notify all users (skip for Phase 4)

## Frontend slices

### features/tracking — upgrades OrderDetailPage
- `useOrderSocket(orderId)` — opens `/ws/orders/{id}`, merges into `queryClient.setQueryData(['orders', id, 'track'], ...)` on every status/partner_location event
- Auto-reconnect via existing `ReconnectingWS` from `@/lib/ws`
- Replace 10s polling with WS subscription in OrderDetailPage + PublicTrackPage
- Live ETA badge updates

### features/partner-sim — at `/dev/partner` (role=partner only)
- Page that shows any active orders assigned to this partner
- "Go online" button → calls `/partner/online`
- After "accept" → uses `navigator.geolocation.watchPosition` to continuously push `/partner/location` every 3s
- Status progression buttons (Confirmed → Preparing → Ready → Out for Delivery → Delivered) — each calls backend, triggers broadcast
- A dev-only demo mode: fake-route simulation (walks partner marker along a line between restaurant and customer)

### features/theme-customizer — **DEEPEN** the existing sheet
- Phase 2 Agent 10 built `ThemeCustomizerSheet` with 5 presets + color pickers.
- Phase 4 extensions:
  - Contrast-checker badge (WCAG AA / AAA) on primary + accent
  - Export theme as JSON / import from JSON
  - "Save as custom preset" → calls POST `/users/me/theme-presets` (new endpoint — or local only for Phase 4)
  - Keyboard shortcut: `shift+t` opens customizer

### features/reviews — UI slice
- Star-rating component (react-hook-form + stars)
- ReviewList on restaurant detail page (new section)
- Aggregate rating already displayed via existing RatingBadge; just render reviews below menu

### features/notifications — bell + list
- Notification bell in Header (unread badge count from `useUnreadCountQuery` + WS subscription for live pulses)
- NotificationsSheet: scrollable list; click-to-mark-read; "Mark all" button

## Rules

1. Register new WS endpoints in main.py via `app.add_api_websocket_route(...)` or standard APIRouter with websocket decorator
2. Auth for WS: `?token=` query param → decode in endpoint handler → close with 4401 code if bad
3. No new DB tables — all schema already in 0001
4. Each feature slice exports `<slice>Routes: RouteObject[]` for Agent 10 to merge
5. Agent 10 of Phase 4 = FE-Reviews-Notif + route merge lead
