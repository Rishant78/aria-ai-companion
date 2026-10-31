from datetime import datetime, timezone
import uuid
import logging
from fastapi import APIRouter, HTTPException, status

from app.config import settings
from app.api.schemas import (
    ChatRequest,
    ChatResponse,
    CreateSessionResponse,
    DeleteSessionResponse,
    HealthResponse,
)
from app.services.session_manager import session_manager
from app.services.llm_service import (
    llm_service,
    LLMConfigurationError,
    LLMTimeoutError,
    LLMAPIError,
    LLMSafetyRefusalError,
    LLMResponseValidationError,
)
from app.services.tts_service import tts_service

logger = logging.getLogger("companion.api")
router = APIRouter()


def _validate_uuid(val: str) -> None:
    """Validates that a string is a valid UUID."""
    try:
        uuid.UUID(str(val))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid UUID format for session_id.",
        )


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Service health and model metadata check."""
    return HealthResponse(
        status="ok",
        model=settings.gemini_model,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/session", response_model=CreateSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session() -> CreateSessionResponse:
    """Generates a new conversation session."""
    session_id = session_manager.create_session()
    return CreateSessionResponse(
        session_id=session_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


@router.delete("/session/{session_id}", response_model=DeleteSessionResponse)
async def delete_session(session_id: str) -> DeleteSessionResponse:
    """Terminates and purges conversation session history."""
    _validate_uuid(session_id)
    deleted = session_manager.delete_session(session_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found or already expired.",
        )
    return DeleteSessionResponse(
        session_id=session_id,
        deleted=True,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat_interaction(request: ChatRequest) -> ChatResponse:
    """
    Submits a user message to the Gemini companion engine, returning
    a validated dialogue response accompanied by facial emotion, gesture,
    and mouth animation parameters.
    """
    _validate_uuid(request.session_id)

    # Retrieve existing conversational turns
    history = session_manager.get_history(request.session_id)

    try:
        companion_resp = await llm_service.generate_response(
            history=history,
            user_message=request.message,
        )
    except LLMConfigurationError as e:
        logger.error("LLM Configuration Error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini service is unconfigured. Please configure GEMINI_API_KEY.",
        )
    except LLMTimeoutError as e:
        logger.warning("LLM Timeout: %s", e)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The companion took too long to reply. Please try again.",
        )
    except LLMSafetyRefusalError as e:
        logger.warning("LLM Safety Refusal: %s", e)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The companion could not generate a response for this topic due to safety policy.",
        )
    except LLMResponseValidationError as e:
        logger.error("LLM Validation Error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The companion generated an invalid response schema.",
        )
    except LLMAPIError as e:
        logger.error("LLM API Error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream conversational service error. Please try again.",
        )

    # Commit only after successful generation to prevent corrupting session history
    session_manager.add_user_message(request.session_id, request.message)
    session_manager.add_assistant_message(request.session_id, companion_resp.response_text)

    # Milestone 7: Synthesize voice audio if enabled (resilient: failures never lose text dialogue)
    tts_result = None
    if settings.tts_enabled and (request.voice_enabled is None or request.voice_enabled):
        try:
            intent_val = (
                companion_resp.speech_intent.value
                if hasattr(companion_resp.speech_intent, "value")
                else str(companion_resp.speech_intent)
            )
            emotion_val = (
                companion_resp.emotion.value
                if hasattr(companion_resp.emotion, "value")
                else str(companion_resp.emotion)
            )
            tts_result = await tts_service.synthesize_speech(
                text=companion_resp.response_text,
                speech_intent=intent_val,
                emotion=emotion_val,
            )
        except Exception as e:
            logger.warning(
                "TTS synthesis failed for session %s: %s. Returning text response without audio.",
                request.session_id,
                tts_service.sanitize_error_message(str(e)),
            )
            tts_result = None

    return ChatResponse(
        session_id=request.session_id,
        response_text=companion_resp.response_text,
        emotion=companion_resp.emotion,
        emotion_intensity=companion_resp.emotion_intensity,
        gesture=companion_resp.gesture,
        gesture_intensity=companion_resp.gesture_intensity,
        speech_intent=companion_resp.speech_intent,
        mouth_animation_profile=companion_resp.mouth_animation_profile,
        created_at=datetime.now(timezone.utc).isoformat(),
        audio_data=tts_result.audio_data if tts_result else None,
        audio_mime_type=tts_result.audio_mime_type if tts_result else None,
        audio_duration=tts_result.audio_duration if tts_result else None,
        audio_sample_rate=tts_result.audio_sample_rate if tts_result else None,
    )
