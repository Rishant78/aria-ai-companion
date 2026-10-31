import pytest
from typing import AsyncGenerator
from httpx import AsyncClient, ASGITransport

from unittest.mock import patch
from app.main import app
from app.services.session_manager import session_manager
from app.api.schemas import (
    CompanionResponse,
    EmotionEnum,
    GestureEnum,
    SpeechIntentEnum,
    MouthAnimationProfileEnum,
)


@pytest.fixture(autouse=True)
def clean_sessions():
    """Ensure in-memory sessions are cleared before every test."""
    session_manager.clear_all()
    yield
    session_manager.clear_all()


@pytest.fixture(autouse=True)
def mock_tts_by_default():
    """By default, mock TTS synthesis to avoid outbound network calls during tests."""
    with patch("app.api.routes.tts_service.synthesize_speech", return_value=None):
        yield


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP test client bound directly to the FastAPI app via ASGITransport."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.fixture
def mock_companion_response() -> CompanionResponse:
    """Standard mocked Gemini companion structured response."""
    return CompanionResponse(
        response_text="Hey there! It's so wonderful to chat with you today!",
        emotion=EmotionEnum.happy,
        emotion_intensity=0.8,
        gesture=GestureEnum.wave,
        gesture_intensity=0.85,
        speech_intent=SpeechIntentEnum.playful,
        mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
    )

