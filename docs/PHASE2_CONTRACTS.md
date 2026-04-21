# Phase 2 — Inter-Agent Contracts

Each Phase 2 agent codes against these exact endpoint shapes and schema names. Frontend agents import TS types from `@/features/<slice>/types.ts` which each BE-paired agent exports.

---

## Auth (Agent 1 BE-Auth-API, Agent 7 FE-Auth)

### REST endpoints (prefix `/api/v1`)

```
POST /auth/signup       → 201  {user: UserOut, tokens: TokensOut}
POST /auth/login        → 200  {user: UserOut, tokens: TokensOut}
POST /auth/refresh      → 200  {tokens: TokensOut}
POST /auth/logout       → 204
GET  /auth/me           → 200  UserOut
```

### Pydantic schemas (`schemas/auth.py`)

```python
class SignupIn(BaseModel):
    email: EmailStr
    password: constr(min_length=8)
    full_name: constr(min_length=2, max_length=120)
    phone: str | None = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class RefreshIn(BaseModel):
    refresh_token: str

class TokensOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access-token exp

class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    phone: str | None
    role: UserRole
    avatar_url: str | None
    email_verified: bool
    created_at: datetime
```

### Service responsibilities
- Passwords: argon2 hash via `core.security.hash_password`
- Duplicate email → `ConflictError("email_exists")`
- Refresh flow rotates: old refresh marked revoked in `refresh_tokens`, new one issued
- Logout: revoke the refresh token's jti
- Rate limit login: `@limiter.limit("5/minute")`

---

## Users + Addresses (folded into Agent 1 scope if simple, else can spill into Agent 4)

```
GET    /users/me                   → UserOut
PATCH  /users/me                   → UserOut   (partial update: phone, full_name, avatar_url)
GET    /users/me/addresses         → list[AddressOut]
POST   /users/me/addresses         → 201 AddressOut
PATCH  /users/me/addresses/{id}    → AddressOut
DELETE /users/me/addresses/{id}    → 204
POST   /users/me/addresses/{id}/default → AddressOut (marks as default; unsets prior)
```

### Address schemas (`schemas/address.py`)
```python
class AddressIn(BaseModel):
    label: str          # "home" | "work" | custom
    line1: str
    line2: str | None = None
    city: str
    state: str
    pincode: str
    lat: float          # -90..90
    lng: float          # -180..180
    is_default: bool = False

class AddressOut(AddressIn):
    id: UUID
    user_id: UUID
    created_at: datetime
```

---

## Restaurants (Agent 3 BE-Restaurants-API, Agent 8 FE-Restaurants)

```
GET /restaurants?lat=&lng=&cuisine=&q=&veg=&sort=&page=&page_size=
  → PageOut[RestaurantCard]

GET /restaurants/{slug}
  → RestaurantDetail

GET /restaurants/{slug}/menu
  → RestaurantMenu  (categories → items)

GET /categories
  → list[CategoryOut]

GET /cuisines
  → list[CuisineOut]
```

### Query semantics
- `lat`/`lng` required for default sort by distance + enforces `ST_DWithin(r.location, point, r.delivery_radius_m)`
- `cuisine` = cuisine slug (accept CSV for multi)
- `q` = fuzzy match via `name ILIKE %q%` + trigram similarity threshold 0.15
- `veg` = true → only restaurants whose **all** cuisines are `is_veg_only` (approximation)
- `sort` in {`distance` (default if lat/lng), `rating`, `popular`, `new`}
- `page` default 1, `page_size` default 20 max 50

### Schemas (`schemas/restaurant.py`)
```python
class CuisineOut(BaseModel):
    id: UUID; name: str; slug: str; icon: str | None; is_veg_only: bool

class CategoryOut(BaseModel):
    id: UUID; name: str; slug: str; icon: str | None; sort_order: int

class RestaurantCard(BaseModel):
    id: UUID
    slug: str
    name: str
    cover_url: str | None
    cuisines: list[CuisineOut]
    rating_avg: Decimal
    rating_count: int
    avg_prep_minutes: int
    distance_km: float | None      # computed when lat/lng passed
    delivers_here: bool            # computed when lat/lng passed
    is_open: bool                  # from opens_at/closes_at (server-side time comparison)
    min_order: Decimal
    delivery_fee_base: Decimal

class RestaurantDetail(RestaurantCard):
    description: str | None
    image_url: str | None
    address_text: str
    lat: float
    lng: float
    opens_at: time
    closes_at: time
    is_featured: bool

class MenuItemOut(BaseModel):
    id: UUID
    category_id: UUID
    name: str
    description: str | None
    price: Decimal
    image_url: str | None
    is_veg: bool
    is_available: bool
    tags: list[str]
    variants: list[dict] | None

class MenuCategory(BaseModel):
    category: CategoryOut
    items: list[MenuItemOut]

class RestaurantMenu(BaseModel):
    restaurant_id: UUID
    categories: list[MenuCategory]

class PageOut(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    has_next: bool
```

---

## Admin Restaurants (Agent 4 BE-Restaurants-Admin)

```
POST   /admin/restaurants              → 201 RestaurantDetail
PATCH  /admin/restaurants/{id}         → RestaurantDetail
DELETE /admin/restaurants/{id}         → 204 (soft: is_active=False)
POST   /admin/menu-items               → 201 MenuItemOut
PATCH  /admin/menu-items/{id}          → MenuItemOut
DELETE /admin/menu-items/{id}          → 204
```
All guarded by `Depends(require_role(UserRole.OWNER, UserRole.ADMIN))`.
Owner can only edit their own restaurants (enforce `owner_id == current_user.id OR role==ADMIN`).

---

## Location & Geocoding (Agent 5 BE-Location, Agent 9 FE-Location)

```
GET /geo/search?q=                     → list[PlaceOut]       (autocomplete via Nominatim)
GET /geo/reverse?lat=&lng=             → PlaceOut             (reverse geocode)
```

### Schemas
```python
class PlaceOut(BaseModel):
    label: str            # display string
    lat: float
    lng: float
    city: str | None
    state: str | None
    country: str | None
    pincode: str | None
    osm_place_id: str | None
```

### Rules
- Cache Nominatim responses in Redis: `geo:search:{q}` and `geo:reverse:{lat:.4f}:{lng:.4f}` for 24h
- Respect `User-Agent: zerozero-dev/<contact>` per Nominatim ToS
- Rate-limit: max 1 req/sec to Nominatim (use a redis-based semaphore)

---

## Uploads (Agent 6 BE-Upload)

```
POST /uploads/image       multipart/form-data, field=file
  → {url: str, key: str, size: int, width: int, height: int}
```

- Local driver (default dev): writes to `./uploads/<yyyy>/<mm>/<uuid>.<ext>` and returns `{url: f"{APP_BASE_URL}/uploads/..."}`. Mount StaticFiles.
- Max size 5 MB. Allowed content types: image/jpeg, image/png, image/webp.
- Auth: logged-in users only (`Depends(get_current_user)`).
- Don't process images server-side in Phase 2 (Pillow can come in Phase 3+).

---

## Frontend slice conventions

Each FE feature slice `frontend/src/features/<slice>/` contains:
```
index.ts         — re-exports
api.ts           — TanStack Query hooks: useXxxQuery, useXxxMutation
types.ts         — TS types mirroring backend Pydantic (can be manual for now)
components/      — feature components (PascalCase)
pages/           — route-level pages
routes.tsx       — Route[] exported for merge into features/routes.ts
hooks.ts         — custom hooks (optional)
```

Each FE agent appends their `routes` to `features/routes.ts` via a shared pattern — **Agent 10 (FE-Layout) is the coordinator** that merges route exports; other FE agents write `export const routes: RouteObject[] = [...]` in their own `routes.tsx` and Agent 10 imports them into the root routes array.

---

## FE-Layout (Agent 10) extras

Owns `frontend/src/components/layout/{Header,Footer,Sidebar,AppShell,MobileNav}.tsx` + `features/home/HomePage.tsx`.

- Header: logo, location picker trigger, search input, auth menu (login button if signed out, avatar dropdown if signed in), theme toggle
- AppShell: `<Header /> <main>{children}</main> <Footer />`
- HomePage (real one): hero, restaurant grid (calls `useRestaurantsQuery({lat, lng})`), filters sidebar
- The old `features/_placeholder/*` files are now **deprecated** — delete them and wire home via `features/home/HomePage.tsx`

---

## Rules

1. Every endpoint uses Pydantic v2 response_model on the route decorator
2. Services return domain models or raise typed errors — routers convert to schemas
3. Every query that takes lat/lng accepts them as optional; when absent, sort falls back to `rating` + `is_featured` desc
4. All timestamps serialized as ISO-8601 UTC (Pydantic default)
5. Money serialized as string-decimal (`str(value)`) to avoid JS float loss — use `Decimal -> str` via pydantic `field_serializer`
6. Frontend queries default staleTime 30s; mutations invalidate per-feature query keys
