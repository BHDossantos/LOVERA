from __future__ import annotations

from fastapi import APIRouter

from app.modules.account.router import router as account_router
from app.modules.admin.router import router as admin_router
from app.modules.ai.router import router as ai_router
from app.modules.availability.router import router as availability_router
from app.modules.billing.router import router as billing_router
from app.modules.blueprint.router import router as blueprint_router
from app.modules.conversations.router import router as conversations_router
from app.modules.dates.router import router as dates_router
from app.modules.introductions.router import router as introductions_router
from app.modules.notifications.router import router as notifications_router
from app.modules.privacy.router import router as privacy_router
from app.modules.profile.router import router as profile_router
from app.modules.safety.router import router as safety_router
from app.modules.today.router import router as today_router
from app.modules.verification.router import router as verification_router

api_router = APIRouter()
for r in (
    account_router,
    verification_router,
    profile_router,
    blueprint_router,
    availability_router,
    introductions_router,
    conversations_router,
    ai_router,
    dates_router,
    safety_router,
    billing_router,
    notifications_router,
    privacy_router,
    today_router,
    admin_router,
):
    api_router.include_router(r)
