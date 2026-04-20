# Phase 1 Inter-Agent Contracts

This file is the **API contract between parallel agents**. Each agent creates files that export exactly these symbols. If you import from another agent's module, import these exact names — they will exist when phase merges.

---

## Backend Python imports (all under `zerozero_api.*`)

### `zerozero_api.settings` (Agent 1)
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_ENV: str
    APP_DEBUG: bool
    APP_NAME: str
    APP_HOST: str
    APP_PORT: int
    APP_BASE_URL: str
    API_V1_PREFIX: str
    DATABASE_URL: str
    DATABASE_URL_SYNC: str
    REDIS_URL: str
    JWT_SECRET: str
    JWT_ALGORITHM: str
    JWT_ACCESS_TTL_MINUTES: int
    JWT_REFRESH_TTL_DAYS: int
    CORS_ORIGINS: list[str]
    SENTRY_DSN: str | None
    NOMINATIM_BASE_URL: str
    NOMINATIM_USER_AGENT: str
    STORAGE_DRIVER: str
    STORAGE_LOCAL_PATH: str

def get_settings() -> Settings: ...  # cached
```

### `zerozero_api.core.db` (Agent 2)
```python
engine: AsyncEngine                             # async SQLAlchemy engine
async_session_factory: async_sessionmaker       # factory
async def get_db() -> AsyncIterator[AsyncSession]: ...   # FastAPI dep
async def init_engine() -> None: ...            # called at app startup
async def dispose_engine() -> None: ...         # called at app shutdown
async def ping_db() -> bool: ...                # for /health
```

### `zerozero_api.domain.base` (Agent 6)
```python
class Base(DeclarativeBase): ...
class TimestampMixin: created_at, updated_at
class UUIDPk: id: Mapped[UUID] primary_key uuid4 default
```

### `zerozero_api.core.security` (Agent 3)
```python
def hash_password(plain: str) -> str: ...
def verify_password(plain: str, hashed: str) -> bool: ...
def create_access_token(subject: str, extra: dict | None = None) -> str: ...
def create_refresh_token(subject: str) -> str: ...

class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: int
    type: Literal["access", "refresh"]
    role: str | None = None

def decode_token(token: str) -> TokenPayload: ...   # raises InvalidTokenError
class InvalidTokenError(Exception): ...
```

### `zerozero_api.core.deps` (Agent 3)
```python
async def get_current_user(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> User: ...

def require_role(role: UserRole):
    async def _dep(user: User = Depends(get_current_user)) -> User: ...
    return _dep
```

### `zerozero_api.core.ratelimit` (Agent 3)
```python
from slowapi import Limiter
limiter: Limiter  # configured with Redis backend
```

### `zerozero_api.core.logging` (Agent 4)
```python
def configure_logging(env: str, level: str = "INFO") -> None: ...
def get_logger(name: str): ...   # returns structlog BoundLogger
```

### `zerozero_api.core.middleware` (Agent 4)
```python
class RequestIdMiddleware(BaseHTTPMiddleware): ...
class AccessLogMiddleware(BaseHTTPMiddleware): ...
```

### `zerozero_api.core.errors` (Agent 4)
```python
def register_exception_handlers(app: FastAPI) -> None: ...

class AppError(Exception):
    status_code: int = 500
    detail: str = "Internal error"

class NotFoundError(AppError): status_code = 404
class ConflictError(AppError): status_code = 409
class PermissionError_(AppError): status_code = 403
class ValidationError_(AppError): status_code = 422
```

### `zerozero_api.routers.health` (Agent 4)
```python
router: APIRouter  # has GET /health returning {status, db, redis, version}
```

---

## Domain Models (Agent 6) — table names + key columns

All models inherit from `Base`. IDs are UUIDs. Timestamps are `DateTime(timezone=True)`. Money is `Numeric(12, 2)`.

```
users(id, email citext UK, phone, password_hash, full_name, role,
      avatar_url, email_verified, is_active, created_at, updated_at)

addresses(id, user_id FK, label, line1, line2, city, state, pincode,
          location Geography(POINT,4326), is_default, created_at)

cuisines(id, name UK, slug UK, icon, is_veg_only, created_at)

categories(id, name, slug UK, icon, sort_order, created_at)

restaurants(id, owner_id FK users NULL, name, slug UK, description,
            cuisines ARRAY<uuid> (or many-to-many table 'restaurant_cuisines'),
            location Geography(POINT,4326), address_text, delivery_radius_m,
            min_order, delivery_fee_base, avg_prep_minutes,
            rating_avg Numeric(2,1), rating_count, image_url, cover_url,
            opens_at Time, closes_at Time, is_active, is_featured,
            created_at, updated_at)

restaurant_cuisines(restaurant_id FK, cuisine_id FK, PRIMARY KEY both)

menu_items(id, restaurant_id FK, category_id FK, name, description, price,
           image_url, is_veg, is_available, tags ARRAY<str>,
           variants JSONB, sort_order, created_at, updated_at)

cart_items(id, user_id FK, restaurant_id FK, menu_item_id FK,
           qty, options JSONB, created_at, updated_at,
           UNIQUE(user_id, menu_item_id, options_hash))

orders(id, user_id FK, restaurant_id FK, address_id FK, partner_id FK NULL,
       status OrderStatus enum, subtotal, discount, delivery_fee, tax, total,
       payment_method, payment_status, promo_code, placed_at,
       delivered_at NULL, cancelled_at NULL, notes, share_token UK)

order_items(id, order_id FK, menu_item_id FK, name_snapshot, price_snapshot,
            qty, options JSONB)

order_status_events(id, order_id FK, status OrderStatus, note, actor_type,
                    actor_id NULL, created_at)

delivery_partners(id, user_id FK UK, vehicle, license_number, is_online,
                  current_order_id FK NULL, location Geography(POINT,4326))

partner_locations(id, partner_id FK, location Geography(POINT,4326),
                  speed_kmh, heading, recorded_at)

reviews(id, order_id FK UK, user_id FK, restaurant_id FK,
        rating SMALLINT 1-5, comment, images ARRAY<str>, created_at)

promo_codes(id, code UK, discount_type enum(flat,percent), value,
            min_order, max_discount, valid_from, valid_to,
            usage_limit, used_count, is_active, created_at)

notifications(id, user_id FK, type, title, body, payload JSONB,
              is_read, created_at)

theme_presets(id, user_id FK NULL, name, primary_oklch, accent_oklch,
              mode, radius, created_at)

refresh_tokens(id, user_id FK, jti UK, expires_at, revoked_at NULL,
               created_at, user_agent, ip)
```

### Enums
```python
class UserRole(str, Enum):
    CUSTOMER = "customer"
    PARTNER  = "partner"
    OWNER    = "owner"
    ADMIN    = "admin"

class OrderStatus(str, Enum):
    PLACED            = "placed"
    CONFIRMED         = "confirmed"
    PREPARING         = "preparing"
    READY             = "ready"
    OUT_FOR_DELIVERY  = "out_for_delivery"
    DELIVERED         = "delivered"
    CANCELLED         = "cancelled"
    FAILED            = "failed"

class PaymentMethod(str, Enum):
    CARD = "card"; UPI = "upi"; WALLET = "wallet"; COD = "cod"

class PaymentStatus(str, Enum):
    PENDING = "pending"; PAID = "paid"; FAILED = "failed"; REFUNDED = "refunded"
```

---

## Frontend TypeScript imports

### `@/lib/utils` (Agent 9)
```ts
export function cn(...inputs: ClassValue[]): string
```

### `@/lib/api` (Agent 10)
```ts
export const api: ApiClient
export class ApiError extends Error { status: number; detail: string }
// api.get<T>(path), api.post<T>(path, body), api.patch, api.delete, api.upload
```

### `@/lib/ws` (Agent 10)
```ts
export class ReconnectingWS {
  constructor(url: string, opts?: { token?: string; onMessage: (msg: any) => void })
  close(): void
}
```

### `@/store/auth` (Agent 10)
```ts
export const useAuthStore: UseBoundStore<{
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  setSession(tokens, user): void
  logout(): void
}>
```

### `@/store/cart`, `@/store/location` (Agent 10)
Similar Zustand stores with `persist`.

### `@/features/theme` (Agent 9)
```ts
export function ThemeProvider({ children }): JSX.Element
export function useTheme(): {
  mode: 'light'|'dark'|'system'
  primary: OklchColor
  accent: OklchColor
  radius: 'sm'|'md'|'lg'
  setMode, setPrimary, setAccent, setRadius, applyPreset
}
export const PRESETS: ThemePreset[]   // 5 presets
```

### shadcn primitives (Agent 9) at `@/components/ui/*`
```
Button, Card (Header/Content/Footer), Input, Label, Form (RHF),
Dialog, Sheet, DropdownMenu, Avatar, Tabs, Separator, Tooltip, Popover,
Select, Skeleton, Badge, Command, Checkbox, Toaster (sonner)
```

### `@/app/providers` (Agent 10)
```tsx
export function AppProviders({ children }): JSX.Element
// Wraps QueryClientProvider, ThemeProvider, Router, Toaster
```

### `@/app/router` (Agent 10)
```tsx
export const router: ReturnType<typeof createBrowserRouter>
```

---

## WebSocket Message Shapes

```ts
// /ws/orders/{id}
type OrderWsEvent =
  | { type: 'status', status: OrderStatus, note?: string, at: string }
  | { type: 'partner_location', lat: number, lng: number, heading?: number, speed?: number, at: string }
  | { type: 'eta', minutes: number }
  | { type: 'ping' }
```

---

## Rules for All Agents

1. If something is unclear, prefer **minimal stubs over skipping** — define the symbol, `raise NotImplementedError` if logic isn't ready.
2. **Never edit paths outside your assigned list.** Verify before writing.
3. **Don't run `uv sync` or `pnpm install`.** Dependencies are declared in pyproject.toml/package.json; install happens after all agents finish.
4. **Don't commit.** A single commit is made after all agents finish.
5. **Never modify `pyproject.toml` or `package.json`.** If you need a dep that's not there, add a comment in your main file: `# MISSING DEP: xyz` and the coordinator will add it.
6. **Conform to type hints and Pydantic v2 idioms** throughout.
