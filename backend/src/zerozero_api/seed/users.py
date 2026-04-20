"""User + delivery-partner seeder.

Creates:
    - 4 fixed demo accounts (customer / partner / owner / admin) with stable
      emails so UI test flows can rely on them.
    - 16 random Indian customers via ``Faker('en_IN')``.
    - 3 delivery partners wired up to ``DeliveryPartner`` rows (vehicle +
      online flag).

All accounts share the password ``test1234`` (argon2 hashed via
:func:`zerozero_api.core.security.hash_password`). Idempotent on email.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from faker import Faker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zerozero_api.core.security import hash_password
from zerozero_api.domain.enums import UserRole, VehicleType
from zerozero_api.seed.utils import random_delhi_point, to_wkt

__all__ = [
    "DEMO_ADMIN",
    "DEMO_CUSTOMER",
    "DEMO_OWNER",
    "DEMO_PARTNER",
    "SeededUsers",
    "seed_users",
]


DEMO_CUSTOMER = "customer@test.com"
DEMO_PARTNER = "partner@test.com"
DEMO_OWNER = "owner@test.com"
DEMO_ADMIN = "admin@test.com"
DEMO_PASSWORD = "test1234"


@dataclass(slots=True)
class SeededUsers:
    """Return value of :func:`seed_users`.

    Exposes the small subset of IDs other seeders actually need — keeps the
    runner from having to know about every seeded user.
    """

    total: int
    customers_total: int
    partners_total: int
    owner_id: UUID
    by_email: dict[str, UUID]


async def seed_users(session: AsyncSession) -> SeededUsers:
    """Seed users and delivery partners. Returns summary + key IDs."""
    from zerozero_api.domain.partner import DeliveryPartner
    from zerozero_api.domain.user import User

    fake = Faker("en_IN")
    Faker.seed(42)
    rng = random.Random(42)

    # Pre-load existing users once so we can upsert by email without
    # hammering the DB with one SELECT per row.
    existing_users = {
        u.email: u for u in (await session.scalars(select(User))).all()
    }

    password_hash = hash_password(DEMO_PASSWORD)

    demo_accounts: list[dict[str, Any]] = [
        {
            "email": DEMO_CUSTOMER,
            "full_name": "Demo Customer",
            "phone": "+919810000001",
            "role": UserRole.CUSTOMER,
        },
        {
            "email": DEMO_PARTNER,
            "full_name": "Demo Partner",
            "phone": "+919810000002",
            "role": UserRole.PARTNER,
        },
        {
            "email": DEMO_OWNER,
            "full_name": "Demo Owner",
            "phone": "+919810000003",
            "role": UserRole.OWNER,
        },
        {
            "email": DEMO_ADMIN,
            "full_name": "Demo Admin",
            "phone": "+919810000004",
            "role": UserRole.ADMIN,
        },
    ]

    by_email: dict[str, UUID] = {}

    def _upsert(
        email: str,
        full_name: str,
        phone: str,
        role: UserRole,
    ) -> "User":
        user = existing_users.get(email)
        if user is not None:
            by_email[email] = user.id
            return user
        user = User(
            email=email,
            phone=phone,
            password_hash=password_hash,
            full_name=full_name,
            role=role,
            email_verified=True,
            is_active=True,
        )
        session.add(user)
        return user

    new_users: list[User] = []
    for demo in demo_accounts:
        u = _upsert(demo["email"], demo["full_name"], demo["phone"], demo["role"])
        if u not in existing_users.values():
            new_users.append(u)

    # 16 random customers. Use a set to enforce unique emails — Faker
    # occasionally repeats under a fixed seed, and the `email UK` would
    # then abort the whole transaction.
    generated_emails: set[str] = set(existing_users.keys())
    customers_created = 0
    attempts = 0
    while customers_created < 16 and attempts < 500:
        attempts += 1
        email = fake.unique.email()
        if email in generated_emails:
            continue
        generated_emails.add(email)
        phone = f"+9198{rng.randint(10_000_000, 99_999_999)}"
        u = _upsert(email, fake.name(), phone, UserRole.CUSTOMER)
        if u not in existing_users.values():
            new_users.append(u)
        customers_created += 1

    # 3 delivery partners (in addition to the demo partner).
    partner_emails: list[str] = []
    partners_created = 0
    while partners_created < 3 and attempts < 1000:
        attempts += 1
        email = fake.unique.email()
        if email in generated_emails:
            continue
        generated_emails.add(email)
        phone = f"+9198{rng.randint(10_000_000, 99_999_999)}"
        u = _upsert(email, fake.name(), phone, UserRole.PARTNER)
        if u not in existing_users.values():
            new_users.append(u)
        partner_emails.append(email)
        partners_created += 1

    # Flush so every new User has its UUID populated before we attach
    # DeliveryPartner rows (which carry a user_id FK).
    await session.flush()

    # Populate by_email for users we just inserted.
    for u in new_users:
        by_email[u.email] = u.id
    # And for pre-existing users we touched above.
    for email, u in existing_users.items():
        by_email.setdefault(email, u.id)

    # Delivery partners: demo partner + 3 generated.
    existing_partner_user_ids = {
        p.user_id
        for p in (await session.scalars(select(DeliveryPartner))).all()
    }

    vehicles = [VehicleType.BIKE, VehicleType.SCOOTER, VehicleType.BICYCLE]

    partner_user_emails = [DEMO_PARTNER, *partner_emails]
    for idx, email in enumerate(partner_user_emails):
        user_id = by_email[email]
        if user_id in existing_partner_user_ids:
            continue
        lat, lng = random_delhi_point(rng=rng)
        dp = DeliveryPartner(
            user_id=user_id,
            vehicle=vehicles[idx % len(vehicles)],
            license_number=f"DL-{rng.randint(1000, 9999)}-{rng.randint(100000, 999999)}",
            is_online=True,
            location=f"SRID=4326;{to_wkt(lat, lng)}",
        )
        session.add(dp)

    await session.flush()

    return SeededUsers(
        total=len(by_email),
        customers_total=customers_created + 1,  # +1 = demo customer
        partners_total=len(partner_user_emails),
        owner_id=by_email[DEMO_OWNER],
        by_email=by_email,
    )
