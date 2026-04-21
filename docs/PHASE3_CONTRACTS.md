# Phase 3 — Inter-Agent Contracts (Commerce)

All existing tables from 0001 are reused — **no new migration needed**. Schemas below are Pydantic DTOs; DB tables already exist.

---

## Cart (Agent 1 BE-Cart, Agent 7 FE-Cart)

```
GET    /cart                         → CartOut
POST   /cart/items                   → 201 CartItemOut
PATCH  /cart/items/{id}              → CartItemOut
DELETE /cart/items/{id}              → 204
DELETE /cart                         → 204   (clear cart)
```

Auth: `Depends(get_current_user)` for all.

### Schemas (`schemas/cart.py`)
```python
class CartItemIn(BaseModel):
    menu_item_id: UUID
    qty: conint(ge=1, le=50)
    options: dict[str, Any] | None = None

class CartItemOut(BaseModel):
    id: UUID
    restaurant_id: UUID
    menu_item_id: UUID
    qty: int
    options: dict[str, Any] | None
    item: MenuItemBrief             # denormalized for UI convenience
    line_total: Decimal

class CartOut(BaseModel):
    restaurant_id: UUID | None      # cart is single-restaurant at a time
    restaurant_name: str | None
    items: list[CartItemOut]
    subtotal: Decimal
    item_count: int
```

### Rules
- Cart is implicitly **single-restaurant**: adding an item from a different restaurant replaces the cart (service-level business rule, confirmed to client via header `X-Cart-Replaced: true`)
- Options-hash: compute `md5(menu_item_id + json.dumps(options, sort_keys=True))`; if matches existing row, increment qty instead of inserting a duplicate
- `line_total` = price_snapshot × qty (snapshot at time of add, not runtime lookup — avoids price changes mid-session)

---

## Orders (Agent 2 BE-Orders, Agent 9 FE-Orders)

```
POST /orders                         → 201 OrderDetailOut    (checkout)
GET  /orders                         → PageOut[OrderListItem]
GET  /orders/{id}                    → OrderDetailOut
POST /orders/{id}/cancel             → OrderDetailOut
POST /orders/{id}/review             → 201 ReviewOut          (only if status=delivered)
GET  /orders/{id}/track              → OrderTrackOut          (lightweight — polling fallback until WS in Phase 4)
```

### Schemas
```python
class CheckoutIn(BaseModel):
    address_id: UUID
    payment_method: PaymentMethod     # enum
    promo_code: str | None = None
    notes: str | None = None

class OrderItemOut(BaseModel):
    id: UUID
    menu_item_id: UUID
    name_snapshot: str
    price_snapshot: Decimal
    qty: int
    options: dict[str, Any] | None

class OrderListItem(BaseModel):
    id: UUID
    short_id: str                    # last-8-of-uuid uppercase, user-facing
    restaurant_name: str
    restaurant_image: str | None
    total: Decimal
    item_count: int
    status: OrderStatus
    placed_at: datetime
    delivered_at: datetime | None

class OrderDetailOut(OrderListItem):
    items: list[OrderItemOut]
    address: AddressOut
    subtotal: Decimal
    discount: Decimal
    delivery_fee: Decimal
    tax: Decimal
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    promo_code: str | None
    notes: str | None
    share_token: str
    events: list[OrderStatusEventOut]

class OrderStatusEventOut(BaseModel):
    status: OrderStatus
    note: str | None
    created_at: datetime

class OrderTrackOut(BaseModel):
    status: OrderStatus
    events: list[OrderStatusEventOut]
    partner_location: dict | None    # {lat, lng} or None
    eta_minutes: int | None
```

### Service responsibilities
- **Atomic checkout**: open tx, load cart, snapshot names+prices into order_items, delete cart rows, insert order+items+initial OrderStatusEvent (status=placed)
- Delivery fee rule: `delivery_fee_base + max(0, (distance_km - 3) * 10)` rounded to nearest integer (simple placeholder)
- Tax: `round(subtotal * Decimal('0.05'), 2)` — 5% GST approximation
- Promo validation delegated to `promo_service.validate_and_apply(promo_code, subtotal, user_id)` returning `Decimal` discount (Agent 5 owns)
- `share_token` = `uuid4().hex` (Phase 4 public tracking uses this)
- Cancel allowed only when status in {placed, confirmed} — else 409
- Review creates Review + **does NOT** trigger rating aggregate recompute here (Phase 4 or cron)

---

## Search (Agent 3 BE-Search, Agent 10 FE-Search)

```
GET /search?q=&lat=&lng=&type=       → SearchResults
```
`type` ∈ {all, restaurant, menu_item} (default all)

```python
class SearchResults(BaseModel):
    restaurants: list[RestaurantCard]
    menu_items: list[MenuItemSearchHit]

class MenuItemSearchHit(BaseModel):
    id: UUID
    name: str
    price: Decimal
    image_url: str | None
    is_veg: bool
    restaurant: RestaurantBrief      # id + name + slug + image
```

### Query
- Use Postgres trigram + ILIKE on `restaurants.name` + `menu_items.name`
- Limit 10 restaurants + 15 items
- Score by `GREATEST(similarity(name, :q), 0.15)` desc
- If lat/lng provided, further filter restaurants by ST_DWithin and include distance

---

## Payments (Agent 4 BE-Payments)

```
POST /payments/mock/charge           → MockChargeOut
POST /payments/webhook               → 200    (HMAC-verified)
```

```python
class MockChargeIn(BaseModel):
    order_id: UUID
    amount: Decimal

class MockChargeOut(BaseModel):
    order_id: UUID
    payment_status: PaymentStatus
    provider_ref: str
    redirect_url: str | None         # for simulated 3DS flow — always None
```

### Rules
- Mock logic: if `amount` ends in `.13` → FAILED, else PAID
- Small delay `asyncio.sleep(0.3)` to simulate network
- Updates `orders.payment_status` inline
- Webhook: HMAC-SHA256 of raw body with shared `settings.PAYMENT_WEBHOOK_SECRET` (add to settings with default `"mock-secret"`)
- Logs payment event via structlog

---

## Promos (Agent 5 BE-Promos)

```
POST /promos/validate                → PromoValidateOut
```

```python
class PromoValidateIn(BaseModel):
    code: str
    subtotal: Decimal

class PromoValidateOut(BaseModel):
    code: str
    valid: bool
    discount: Decimal                # 0 when !valid
    reason: str | None               # "expired" | "min_order" | "usage_exceeded" | None
    free_delivery: bool
```

### Service public function (called from order_service in Agent 2)
```python
async def validate_and_apply(code: str, subtotal: Decimal, user_id: UUID, db: AsyncSession) -> tuple[Decimal, bool]:
    ...  # returns (discount, free_delivery)
```

---

## Frontend slices

### FE-Cart (Agent 7) — `frontend/src/features/cart/`
- `useCartQuery()`, `useAddToCartMutation()`, `useUpdateCartItemMutation()`, `useRemoveFromCartMutation()`, `useClearCartMutation()`
- **Dual mode**: when logged in, reads/writes server cart via API; when logged out, uses Zustand `useCartStore` (Phase 1). Service merges guest cart into server cart on login (hook on login mutation success).
- Components: `CartDrawer` (Sheet), `CartPage`, `CartLineItem` with qty stepper, `CartSummary` (subtotal, delivery estimate, tax, total), `EmptyCart`
- Merges with existing `useCartStore` — do NOT replace it; guest cart still lives there

### FE-Checkout (Agent 8) — `features/checkout/`
- Page flow: `/checkout` → address picker (uses `@/features/location`) → payment method selector → promo input → review → place-order button
- Uses `useCheckoutMutation()` (POST /orders) → navigates to `/orders/{id}` on success
- Stepper UI (3 steps): Address, Payment, Review. Radix Tabs or custom progress
- `PromoInput` with debounced `usePromoValidateMutation` showing discount preview live
- On success: toast "Order placed" + confetti (CSS anim, no new deps)

### FE-Orders (Agent 9) — `features/orders/`
- `OrdersListPage` (`/orders`) — active tab + past tab; cards like OrderListItem
- `OrderDetailPage` (`/orders/:id`) — stepper showing status progression (placed → confirmed → preparing → out_for_delivery → delivered), full itemized summary, cancel button if eligible, review button if delivered
- `OrderStatusStepper` component — horizontal on desktop, vertical on mobile; current step pulses
- Polls `/orders/:id/track` every 10s as WS fallback (Phase 4 replaces with WS)

### FE-Search (Agent 10) — `features/search/`
- Global search via shadcn `Command` palette (CMD-K / CTRL-K)
- `/search` page with tabs: All / Restaurants / Menu items
- Results grouped; each hit clickable
- `useGlobalSearchShortcut()` — listens for CMD-K, opens the Command palette

---

## Rules

1. All money via `Decimal` server-side, string on wire, `Number()` + Intl formatting on client
2. Order status state machine enforced in service (illegal transitions → 409)
3. Cart single-restaurant rule is business logic (confirm header)
4. Register new routers in `main.py` in a dedicated `PHASE 3` block — each agent appends their own
5. No new Alembic migration
