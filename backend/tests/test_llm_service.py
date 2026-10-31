from unittest.mock import AsyncMock, MagicMock
import pytest
from pydantic import ValidationError

from app.services.llm_service import (
    LLMService,
    LLMConfigurationError,
    LLMSafetyRefusalError,
    LLMAPIError,
)
from app.api.schemas import (
    CompanionResponse,
    EmotionEnum,
    GestureEnum,
    SpeechIntentEnum,
    MouthAnimationProfileEnum,
)
from app.services.session_manager import ChatMessage


def test_system_prompt_loading():
    service = LLMService()
    prompt = service.get_system_instruction()
    assert len(prompt) > 200
    # Verify core personality weights
    assert "Playfulness: 85%" in prompt
    assert "Warmth: 85%" in prompt
    assert "Curiosity: 75%" in prompt
    assert "Mischievousness: 65%" in prompt
    assert "Shyness: 45%" in prompt
    assert "Seriousness: 65%" in prompt
    # Verify boundaries
    assert "romantic roleplay" in prompt.lower()
    assert "manipulative" in prompt.lower()
    assert "Session-only conversation memory" in prompt


def test_companion_response_valid():
    resp = CompanionResponse(
        response_text="Hello friend!",
        emotion=EmotionEnum.happy,
        emotion_intensity=0.85,
        gesture=GestureEnum.greeting,
        gesture_intensity=0.9,
        speech_intent=SpeechIntentEnum.playful,
        mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
    )
    assert resp.response_text == "Hello friend!"
    assert resp.emotion == EmotionEnum.happy
    assert resp.gesture == GestureEnum.greeting
    assert resp.gesture_intensity == 0.9


def test_companion_response_null_gesture_enforces_zero_intensity():
    resp = CompanionResponse(
        response_text="Just listening...",
        emotion=EmotionEnum.neutral,
        emotion_intensity=0.5,
        gesture=None,
        gesture_intensity=0.75,  # Validator should enforce 0.0
        speech_intent=SpeechIntentEnum.conversational,
        mouth_animation_profile=MouthAnimationProfileEnum.minimal,
    )
    assert resp.gesture is None
    assert resp.gesture_intensity == 0.0


def test_companion_response_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        CompanionResponse(
            response_text="Hello",
            emotion=EmotionEnum.happy,
            emotion_intensity=0.5,
            gesture=None,
            gesture_intensity=0.0,
            speech_intent=SpeechIntentEnum.conversational,
            mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
            unexpected_field="disallowed",
        )


def test_companion_response_invalid_intensity():
    with pytest.raises(ValidationError):
        CompanionResponse(
            response_text="Hello",
            emotion=EmotionEnum.happy,
            emotion_intensity=1.5,  # > 1.0 forbidden
            gesture=None,
            gesture_intensity=0.0,
            speech_intent=SpeechIntentEnum.conversational,
            mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
        )


def test_companion_response_empty_text_forbidden():
    with pytest.raises(ValidationError):
        CompanionResponse(
            response_text="",  # min_length=1
            emotion=EmotionEnum.happy,
            emotion_intensity=0.5,
            gesture=None,
            gesture_intensity=0.0,
            speech_intent=SpeechIntentEnum.conversational,
            mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
        )


def test_llm_service_client_requires_key():
    service = LLMService(api_key="")
    with pytest.raises(LLMConfigurationError) as exc_info:
        service._get_client()
    assert "GEMINI_API_KEY" in str(exc_info.value)


def test_error_message_scrubbing():
    fake_key = "AIzaSyD-SecretKey-123456789"
    service = LLMService(api_key=fake_key)
    raw_error = f"HTTP 403 Forbidden with key {fake_key} on resource"
    scrubbed = service._sanitize_error_message(raw_error)
    assert fake_key not in scrubbed
    assert "[REDACTED_API_KEY]" in scrubbed


@pytest.mark.asyncio
async def test_llm_service_successful_mock():
    service = LLMService(api_key="test-key")
    expected_resp = CompanionResponse(
        response_text="I'm doing splendidly!",
        emotion=EmotionEnum.happy,
        emotion_intensity=0.7,
        gesture=GestureEnum.wave,
        gesture_intensity=0.8,
        speech_intent=SpeechIntentEnum.playful,
        mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
    )

    mock_candidate = MagicMock()
    mock_candidate.finish_reason = "STOP"
    mock_response = MagicMock()
    mock_response.candidates = [mock_candidate]
    mock_response.parsed = expected_resp

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    service._client = mock_client

    history = [ChatMessage(role="user", content="Hello")]
    result = await service.generate_response(history, "How are you?")
    assert result == expected_resp


@pytest.mark.asyncio
async def test_llm_service_safety_refusal_mock():
    service = LLMService(api_key="test-key")

    mock_candidate = MagicMock()
    mock_candidate.finish_reason = "SAFETY"
    mock_response = MagicMock()
    mock_response.candidates = [mock_candidate]

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    service._client = mock_client

    with pytest.raises(LLMSafetyRefusalError) as exc_info:
        await service.generate_response([], "Unsafe content")
    assert "safety policy" in str(exc_info.value)


@pytest.mark.asyncio
async def test_llm_service_empty_response_mock():
    service = LLMService(api_key="test-key")

    mock_response = MagicMock()
    mock_response.candidates = []

    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    service._client = mock_client

    with pytest.raises(LLMSafetyRefusalError):
        await service.generate_response([], "Hello")

