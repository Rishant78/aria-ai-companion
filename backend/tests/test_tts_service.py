import asyncio
import base64
import io
import struct
import uuid
import wave
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.api.schemas import (
    ChatResponse,
    CompanionResponse,
    EmotionEnum,
    GestureEnum,
    MouthAnimationProfileEnum,
    SpeechIntentEnum,
)
from app.config import settings
from app.services.tts_service import (
    SPEECH_INTENT_STYLE_MAP,
    TTSAPIError,
    TTSConfigurationError,
    TTSResult,
    TTSService,
    TTSTimeoutError,
    TTSValidationError,
    tts_service,
)


def create_synthetic_wav_base64(duration_seconds: float = 1.0, sample_rate: int = 24000) -> str:
    """Generates a valid PCM mono WAV file in base64 format."""
    num_samples = int(sample_rate * duration_seconds)
    # Generate 16-bit silence/simple samples
    raw_pcm = struct.pack(f"<{num_samples}h", *(0 for _ in range(num_samples)))

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(raw_pcm)

    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def test_speech_intent_style_mapping():
    """Verifies all 8 defined speech intents map strictly to natural speech_metadata style instructions."""
    expected_mappings = {
        "conversational": "warm, natural and relaxed",
        "excited": "bright, lively and enthusiastic",
        "playful": "warm, playful and mischievous",
        "gentle": "soft, calm and comforting",
        "reassuring": "gentle, caring and reassuring",
        "curious": "interested and intrigued",
        "serious": "composed and deliberate",
        "surprised": "naturally surprised and animated",
    }

    for intent, expected_style in expected_mappings.items():
        assert SPEECH_INTENT_STYLE_MAP[intent] == expected_style
        style = TTSService.get_speech_style(intent)
        assert style == expected_style

    # Case-insensitivity and whitespace trimming
    assert TTSService.get_speech_style("  PLAYFUL  ") == "warm, playful and mischievous"
    # Fallback to conversational for unknown
    assert TTSService.get_speech_style("unknown_style") == "warm, natural and relaxed"
    # Emotion fallback when intent is empty
    assert TTSService.get_speech_style("", emotion="happy") == "bright, lively and enthusiastic"


@pytest.mark.asyncio
async def test_tts_request_configuration_and_voice():
    """Verifies exact model, voice ('Sulafat'), and speech_metadata style configuration in API call."""
    service = TTSService(
        api_key="mock-api-key-12345",
        model="gemini-3.8-flash-lite-tts",
        voice="Sulafat",
    )

    mock_interaction = MagicMock()
    mock_audio = MagicMock()
    mock_audio.data = create_synthetic_wav_base64(duration_seconds=0.5, sample_rate=24000)
    mock_audio.mime_type = "audio/wav"
    mock_audio.sample_rate = 24000
    mock_interaction.output_audio = mock_audio

    mock_create = AsyncMock(return_value=mock_interaction)
    mock_client = MagicMock()
    mock_client.aio.interactions.create = mock_create
    service._client = mock_client

    result = await service.synthesize_speech(
        text="Hello world, I am Aria!",
        speech_intent="playful",
        emotion="happy",
    )

    assert result is not None
    assert result.audio_mime_type == "audio/wav"
    assert result.audio_sample_rate == 24000
    assert result.audio_duration == 0.5
    assert result.byte_length > 44

    mock_create.assert_called_once()
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["model"] == "gemini-3.8-flash-lite-tts"
    assert call_kwargs["response_format"] == {"type": "audio"}
    assert call_kwargs["generation_config"] == {"speech_config": [{"voice": "Sulafat"}]}

    input_payload = call_kwargs["input"]
    assert input_payload[0]["content"][0]["text"] == "Hello world, I am Aria!"
    assert input_payload[0]["content"][0]["annotations"][0]["type"] == "speech_metadata"
    assert input_payload[0]["content"][0]["annotations"][0]["style"] == "warm, playful and mischievous"


def test_tts_service_default_model_and_env_override():
    """Verifies that TTSService defaults to settings.tts_model and respects environment overrides."""
    svc = TTSService(api_key="test-key")
    assert svc._model == "gemini-3.8-flash-lite-tts"
    assert svc._voice == "Sulafat"

    custom_svc = TTSService(api_key="test-key", model="custom-tts-model", voice="Aoede")
    assert custom_svc._model == "custom-tts-model"
    assert custom_svc._voice == "Aoede"


@pytest.mark.asyncio
async def test_tts_successful_wav_metadata_extraction():
    """Verifies parsing of WAV duration, sample rate, and byte length."""
    service = TTSService(api_key="mock-key")
    expected_duration = 1.25
    expected_rate = 24000
    wav_b64 = create_synthetic_wav_base64(duration_seconds=expected_duration, sample_rate=expected_rate)

    mock_interaction = MagicMock()
    mock_interaction.output_audio = MagicMock(data=wav_b64, mime_type="audio/wav", sample_rate=expected_rate)

    service._client = MagicMock()
    service._client.aio.interactions.create = AsyncMock(return_value=mock_interaction)

    result = await service.synthesize_speech("Testing audio playback extraction.")
    assert result is not None
    assert result.audio_data == wav_b64
    assert result.audio_mime_type == "audio/wav"
    assert result.audio_sample_rate == expected_rate
    assert result.audio_duration == expected_duration
    assert result.byte_length == len(base64.b64decode(wav_b64))


@pytest.mark.asyncio
async def test_tts_fallback_from_steps_if_output_audio_missing():
    """Verifies audio extraction fallback from interaction.steps when output_audio attribute is not set."""
    service = TTSService(api_key="mock-key")
    wav_b64 = create_synthetic_wav_base64(duration_seconds=0.75, sample_rate=24000)

    step_audio = MagicMock()
    step_audio.type = "audio"
    step_audio.data = wav_b64
    step_audio.mime_type = "audio/wav"
    step_audio.sample_rate = 24000

    step = MagicMock()
    step.content = [step_audio]

    mock_interaction = MagicMock()
    mock_interaction.output_audio = None
    mock_interaction.steps = [step]

    service._client = MagicMock()
    service._client.aio.interactions.create = AsyncMock(return_value=mock_interaction)

    result = await service.synthesize_speech("Testing step content audio fallback.")
    assert result is not None
    assert result.audio_data == wav_b64
    assert result.audio_duration == 0.75


@pytest.mark.asyncio
async def test_tts_empty_or_whitespace_text_skips_synthesis():
    """Verifies empty or whitespace-only text returns None without making API calls."""
    service = TTSService(api_key="mock-key")
    service._client = MagicMock()
    mock_create = AsyncMock()
    service._client.aio.interactions.create = mock_create

    assert await service.synthesize_speech("") is None
    assert await service.synthesize_speech("   \n\t  ") is None
    mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_tts_missing_audio_output_raises_validation_error():
    """Verifies that an interaction with no audio content raises TTSValidationError."""
    service = TTSService(api_key="mock-key")
    mock_interaction = MagicMock()
    mock_interaction.output_audio = None
    mock_interaction.steps = []

    service._client = MagicMock()
    service._client.aio.interactions.create = AsyncMock(return_value=mock_interaction)

    with pytest.raises(TTSValidationError, match="No valid audio content returned"):
        await service.synthesize_speech("Text that failed to produce audio.")


@pytest.mark.asyncio
async def test_tts_malformed_base64_raises_validation_error():
    """Verifies malformed base64 raises TTSValidationError."""
    service = TTSService(api_key="mock-key")
    mock_interaction = MagicMock()
    mock_interaction.output_audio = MagicMock(data="!!!not-valid-base64???")

    service._client = MagicMock()
    service._client.aio.interactions.create = AsyncMock(return_value=mock_interaction)

    with pytest.raises(TTSValidationError, match="Failed to decode base64"):
        await service.synthesize_speech("Valid text with invalid base64.")


@pytest.mark.asyncio
async def test_tts_undersized_payload_raises_validation_error():
    """Verifies undersized audio payload (< 44 bytes) raises TTSValidationError."""
    service = TTSService(api_key="mock-key")
    mock_interaction = MagicMock()
    # 10 bytes payload is below minimum 44-byte WAV header
    mock_interaction.output_audio = MagicMock(data=base64.b64encode(b"short12345").decode("utf-8"))

    service._client = MagicMock()
    service._client.aio.interactions.create = AsyncMock(return_value=mock_interaction)

    with pytest.raises(TTSValidationError, match="Audio payload too small"):
        await service.synthesize_speech("Text resulting in corrupted short payload.")


@pytest.mark.asyncio
async def test_tts_timeout_raises_tts_timeout_error():
    """Verifies that asyncio.TimeoutError is caught and raised as TTSTimeoutError."""
    service = TTSService(api_key="mock-key")

    async def timeout_coro(*args, **kwargs):
        raise asyncio.TimeoutError()

    service._client = MagicMock()
    service._client.aio.interactions.create = timeout_coro

    with pytest.raises(TTSTimeoutError, match="timed out"):
        await service.synthesize_speech("Text that times out.")


@pytest.mark.asyncio
async def test_tts_unconfigured_api_key_raises_configuration_error():
    """Verifies missing API key raises TTSConfigurationError."""
    service = TTSService(api_key="")
    with pytest.raises(TTSConfigurationError, match="Gemini API key is not configured"):
        await service.synthesize_speech("Hello")


@pytest.mark.asyncio
async def test_api_chat_attaches_audio_on_success(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies /api/chat attaches audio payload when TTS synthesis succeeds."""
    session_id = str(uuid.uuid4())
    wav_b64 = create_synthetic_wav_base64(duration_seconds=1.2, sample_rate=24000)

    mock_tts_result = TTSResult(
        audio_data=wav_b64,
        audio_mime_type="audio/wav",
        audio_duration=1.2,
        audio_sample_rate=24000,
        byte_length=len(base64.b64decode(wav_b64)),
    )

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
        return_value=mock_tts_result,
    ) as mock_tts_call:
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Can you speak to me?"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["response_text"] == mock_companion_response.response_text
        assert data["audio_data"] == wav_b64
        assert data["audio_mime_type"] == "audio/wav"
        assert data["audio_duration"] == 1.2
        assert data["audio_sample_rate"] == 24000

        mock_tts_call.assert_called_once()
        assert mock_tts_call.call_args.kwargs["text"] == mock_companion_response.response_text
        assert mock_tts_call.call_args.kwargs["speech_intent"] == "playful"
        assert mock_tts_call.call_args.kwargs["emotion"] == "happy"


@pytest.mark.asyncio
async def test_api_chat_fallback_when_tts_fails(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies /api/chat gracefully falls back with audio_data=None when TTS fails, keeping text intact."""
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
        side_effect=TTSAPIError("Rate limit exceeded"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Tell me a joke."},
        )

        # HTTP must still be 200 OK!
        assert response.status_code == 200
        data = response.json()
        assert data["response_text"] == mock_companion_response.response_text
        assert data["emotion"] == "happy"
        assert data["gesture"] == "wave"
        assert data["audio_data"] is None
        assert data["audio_mime_type"] is None
        assert data["audio_duration"] is None
        assert data["audio_sample_rate"] is None


@pytest.mark.asyncio
async def test_api_chat_skips_tts_when_disabled(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies /api/chat skips TTS call entirely when settings.tts_enabled is False."""
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
    ) as mock_tts_call, patch.object(
        settings, "tts_enabled", False
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello Aria"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["audio_data"] is None
        mock_tts_call.assert_not_called()


@pytest.mark.asyncio
async def test_api_chat_skips_tts_when_voice_enabled_is_false(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies /api/chat skips TTS call when client request has voice_enabled=False."""
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
    ) as mock_tts_call:
        response = await async_client.post(
            "/api/chat",
            json={
                "session_id": session_id,
                "message": "Hello Aria with voice disabled",
                "voice_enabled": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["response_text"] == mock_companion_response.response_text
        assert data["audio_data"] is None
        assert data["audio_mime_type"] is None
        assert data["audio_duration"] is None
        assert data["audio_sample_rate"] is None
        mock_tts_call.assert_not_called()


@pytest.mark.asyncio
async def test_api_chat_defaults_voice_enabled_to_true(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies /api/chat defaults voice_enabled to True when omitted from request."""
    session_id = str(uuid.uuid4())
    wav_b64 = create_synthetic_wav_base64(duration_seconds=1.0, sample_rate=24000)
    mock_tts_result = TTSResult(
        audio_data=wav_b64,
        audio_mime_type="audio/wav",
        audio_duration=1.0,
        audio_sample_rate=24000,
        byte_length=48044,
    )

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
        return_value=mock_tts_result,
    ) as mock_tts_call:
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello Aria with default voice"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["audio_data"] == wav_b64
        mock_tts_call.assert_called_once()


def test_speech_intent_and_emotion_blending_without_contradiction():
    """Verifies that speech intent and emotion blend naturally without allowing contradictory instructions."""
    # When intent is conversational, emotion adds nuance
    assert TTSService.get_speech_style("conversational", "curious") == "interested and intrigued"
    assert TTSService.get_speech_style("conversational", "happy") == "warm, cheerful and relaxed"
    assert TTSService.get_speech_style("conversational", "sad") == "soft, calm and comforting"
    assert TTSService.get_speech_style("conversational", "shy") == "warm, gentle and modest"
    assert TTSService.get_speech_style("conversational", "surprised") == "naturally surprised and animated"

    # When intent is explicit (e.g. serious), it prevents contradictory cues from emotion (e.g. happy)
    assert TTSService.get_speech_style("serious", "happy") == "composed and deliberate"
    assert TTSService.get_speech_style("reassuring", "excited") == "gentle, caring and reassuring"
    assert TTSService.get_speech_style("playful", "sad") == "warm, playful and mischievous"


def test_chat_response_schema_compatibility():
    """Verifies ChatResponse schema validation with and without audio fields."""
    # 1. Without audio fields (backward compatible)
    resp1 = ChatResponse(
        session_id=str(uuid.uuid4()),
        response_text="Hello!",
        emotion=EmotionEnum.neutral,
        emotion_intensity=0.5,
        gesture=None,
        gesture_intensity=0.0,
        speech_intent=SpeechIntentEnum.conversational,
        mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
        created_at="2026-10-31T12:00:00Z",
    )
    dump1 = resp1.model_dump()
    assert dump1["audio_data"] is None
    assert dump1["audio_duration"] is None

    # 2. With voice synthesis fields
    resp2 = ChatResponse(
        session_id=str(uuid.uuid4()),
        response_text="Listen to my voice!",
        emotion=EmotionEnum.happy,
        emotion_intensity=0.8,
        gesture=GestureEnum.greeting,
        gesture_intensity=0.7,
        speech_intent=SpeechIntentEnum.playful,
        mouth_animation_profile=MouthAnimationProfileEnum.energetic,
        created_at="2026-10-31T12:00:00Z",
        audio_data="UklGRsamplebase64==",
        audio_mime_type="audio/wav",
        audio_duration=2.45,
        audio_sample_rate=24000,
    )
    dump2 = resp2.model_dump()
    assert dump2["audio_data"] == "UklGRsamplebase64=="
    assert dump2["audio_mime_type"] == "audio/wav"
    assert dump2["audio_duration"] == 2.45
    assert dump2["audio_sample_rate"] == 24000

    # 3. Validation constraints: negative duration or sample rate must be rejected
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ChatResponse(
            session_id=str(uuid.uuid4()),
            response_text="Test",
            emotion=EmotionEnum.neutral,
            emotion_intensity=0.5,
            speech_intent=SpeechIntentEnum.conversational,
            mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
            created_at="2026-10-31T12:00:00Z",
            audio_duration=-1.0,
        )

    with pytest.raises(ValidationError):
        ChatResponse(
            session_id=str(uuid.uuid4()),
            response_text="Test",
            emotion=EmotionEnum.neutral,
            emotion_intensity=0.5,
            speech_intent=SpeechIntentEnum.conversational,
            mouth_animation_profile=MouthAnimationProfileEnum.soft_conversation,
            created_at="2026-10-31T12:00:00Z",
            audio_sample_rate=0,
        )


@pytest.mark.asyncio
async def test_session_history_preserved_when_tts_fails(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    """Verifies that conversation history is fully committed even when audio generation fails."""
    from app.services.session_manager import session_manager

    session_id = str(uuid.uuid4())
    user_msg = "Please remember this message even if voice fails."

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ), patch(
        "app.api.routes.tts_service.synthesize_speech",
        side_effect=TTSAPIError("TTS server down"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": user_msg},
        )
        assert response.status_code == 200

    # Check session history
    history = session_manager.get_history(session_id)
    assert len(history) == 2
    assert history[0].role == "user"
    assert history[0].content == user_msg
    assert history[1].role == "model"
    assert history[1].content == mock_companion_response.response_text


