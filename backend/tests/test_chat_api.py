import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import pytest
from httpx import AsyncClient

from app.services.session_manager import session_manager
from app.services.llm_service import (
    LLMConfigurationError,
    LLMTimeoutError,
    LLMSafetyRefusalError,
    LLMAPIError,
    LLMResponseValidationError,
)
from app.api.schemas import (
    CompanionResponse,
    EmotionEnum,
    GestureEnum,
    SpeechIntentEnum,
    MouthAnimationProfileEnum,
)


@pytest.mark.asyncio
async def test_health_endpoint(async_client: AsyncClient):
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "model" in data
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_create_session(async_client: AsyncClient):
    response = await async_client.post("/api/session")
    assert response.status_code == 201
    data = response.json()
    assert "session_id" in data
    # Validate it is a valid UUID
    parsed_uuid = uuid.UUID(data["session_id"])
    assert parsed_uuid.version == 4
    assert "created_at" in data


@pytest.mark.asyncio
async def test_delete_session_success(async_client: AsyncClient):
    create_resp = await async_client.post("/api/session")
    session_id = create_resp.json()["session_id"]

    del_resp = await async_client.delete(f"/api/session/{session_id}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"session_id": session_id, "deleted": True}

    # Second delete returns 404
    del_resp2 = await async_client.delete(f"/api/session/{session_id}")
    assert del_resp2.status_code == 404


@pytest.mark.asyncio
async def test_delete_session_invalid_uuid(async_client: AsyncClient):
    response = await async_client.delete("/api/session/not-a-valid-uuid")
    assert response.status_code == 400
    assert "Invalid UUID" in response.json()["detail"]


@pytest.mark.asyncio
async def test_chat_invalid_uuid_rejected(async_client: AsyncClient):
    response = await async_client.post(
        "/api/chat",
        json={"session_id": "invalid-uuid-string", "message": "Hello!"},
    )
    assert response.status_code == 400
    assert "Invalid UUID" in response.json()["detail"]


@pytest.mark.asyncio
async def test_chat_empty_message_rejected(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    response = await async_client.post(
        "/api/chat",
        json={"session_id": session_id, "message": ""},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_oversized_message_rejected(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    oversized = "a" * 2001
    response = await async_client.post(
        "/api/chat",
        json={"session_id": session_id, "message": oversized},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_successful_mocked_interaction(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ) as mock_llm:
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hi, how are you today?"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == session_id
        assert data["response_text"] == mock_companion_response.response_text
        assert data["emotion"] == "happy"
        assert data["emotion_intensity"] == 0.8
        assert data["gesture"] == "wave"
        assert data["gesture_intensity"] == 0.85
        assert data["speech_intent"] == "playful"
        assert data["mouth_animation_profile"] == "soft_conversation"
        assert "created_at" in data

        mock_llm.assert_called_once()
        # Verify first call had empty history
        call_history = mock_llm.call_args.kwargs["history"]
        assert len(call_history) == 0
        assert mock_llm.call_args.kwargs["user_message"] == "Hi, how are you today?"


@pytest.mark.asyncio
async def test_chat_null_gesture_enforces_zero_intensity(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    response_with_null_gesture = CompanionResponse(
        response_text="I'm thinking quietly...",
        emotion=EmotionEnum.curious,
        emotion_intensity=0.6,
        gesture=None,
        gesture_intensity=0.0,
        speech_intent=SpeechIntentEnum.curious,
        mouth_animation_profile=MouthAnimationProfileEnum.gentle,
    )

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=response_with_null_gesture,
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "What are you pondering?"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["gesture"] is None
        assert data["gesture_intensity"] == 0.0


@pytest.mark.asyncio
async def test_multi_turn_history(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ) as mock_llm:
        # Turn 1
        resp1 = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Message 1"},
        )
        assert resp1.status_code == 200

        # Turn 2
        resp2 = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Message 2"},
        )
        assert resp2.status_code == 200

        # Turn 2 should have received 2 history items: user message 1, model response 1
        turn2_history = mock_llm.call_args.kwargs["history"]
        assert len(turn2_history) == 2
        assert turn2_history[0].role == "user"
        assert turn2_history[0].content == "Message 1"
        assert turn2_history[1].role == "model"
        assert turn2_history[1].content == mock_companion_response.response_text


@pytest.mark.asyncio
async def test_session_isolation(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    session_a = str(uuid.uuid4())
    session_b = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ) as mock_llm:
        # Message in Session A
        await async_client.post(
            "/api/chat",
            json={"session_id": session_a, "message": "Secret A"},
        )

        # Message in Session B
        await async_client.post(
            "/api/chat",
            json={"session_id": session_b, "message": "Message B"},
        )

        # Session B should have zero history from Session A
        turn_b_history = mock_llm.call_args.kwargs["history"]
        assert len(turn_b_history) == 0


@pytest.mark.asyncio
async def test_session_ttl_expiration(
    async_client: AsyncClient,
    mock_companion_response: CompanionResponse,
):
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ):
        await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello before expiration"},
        )

    # Artificially age the session past TTL (7200 seconds)
    state = session_manager._sessions[session_id]
    state.last_accessed_at = datetime.now(timezone.utc) - timedelta(seconds=7201)

    # Next access should treat session as expired and start clean
    with patch(
        "app.api.routes.llm_service.generate_response",
        return_value=mock_companion_response,
    ) as mock_llm:
        await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello after expiration"},
        )
        history = mock_llm.call_args.kwargs["history"]
        assert len(history) == 0  # History was purged due to TTL expiration


@pytest.mark.asyncio
async def test_gemini_unconfigured_error(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMConfigurationError("Missing GEMINI_API_KEY"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        assert response.status_code == 503
        assert "unconfigured" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_gemini_timeout_error(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMTimeoutError("Request timed out"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        assert response.status_code == 504
        assert "too long to reply" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_gemini_safety_refusal_error(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMSafetyRefusalError("Content blocked"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        assert response.status_code == 422
        assert "safety policy" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_gemini_api_error(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMAPIError("Upstream quota exceeded"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        assert response.status_code == 502
        assert "upstream conversational service error" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_gemini_invalid_schema_error(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMResponseValidationError("Missing required emotion field"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        assert response.status_code == 502
        assert "invalid response schema" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_failed_chat_does_not_corrupt_history(async_client: AsyncClient):
    session_id = str(uuid.uuid4())
    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMTimeoutError("Timed out"),
    ):
        await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Failed message"},
        )

    # History should be empty because request failed before commit
    history = session_manager.get_history(session_id)
    assert len(history) == 0


@pytest.mark.asyncio
async def test_no_api_key_leakage_in_error_response(async_client: AsyncClient):
    fake_key = "AIzaSyD-SecretKey-123456789"
    session_id = str(uuid.uuid4())

    with patch(
        "app.api.routes.llm_service.generate_response",
        side_effect=LLMAPIError(f"Error calling endpoint with key {fake_key}"),
    ):
        response = await async_client.post(
            "/api/chat",
            json={"session_id": session_id, "message": "Hello"},
        )
        raw_response_text = response.text
        assert fake_key not in raw_response_text


@pytest.mark.asyncio
async def test_spa_static_serving(async_client: AsyncClient):
    response = await async_client.get("/")
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        assert "html" in response.headers.get("content-type", "").lower()


