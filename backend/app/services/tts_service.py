import asyncio
import base64
import io
import logging
import wave
from dataclasses import dataclass
from typing import Dict, Optional

from google import genai
from google.genai.errors import APIError

from app.config import settings

logger = logging.getLogger("companion.tts")

# Centralized emotional delivery mapping (Milestone 7 Requirement)
SPEECH_INTENT_STYLE_MAP: Dict[str, str] = {
    "conversational": "warm, natural and relaxed",
    "excited": "bright, lively and enthusiastic",
    "playful": "warm, playful and mischievous",
    "gentle": "soft, calm and comforting",
    "reassuring": "gentle, caring and reassuring",
    "curious": "interested and intrigued",
    "serious": "composed and deliberate",
    "surprised": "naturally surprised and animated",
}


@dataclass
class TTSResult:
    """Represents synthesized audio and associated technical metadata."""
    audio_data: str  # Base64-encoded audio payload (e.g. WAV)
    audio_mime_type: str  # Container MIME type, default "audio/wav"
    audio_duration: Optional[float]  # Duration in seconds
    audio_sample_rate: Optional[int]  # Sample rate in Hz, e.g. 24000
    byte_length: int  # Raw unencoded byte count


class TTSServiceError(Exception):
    """Base exception for TTS service operations."""
    pass


class TTSConfigurationError(TTSServiceError):
    """Raised when TTS credentials or configuration are missing."""
    pass


class TTSTimeoutError(TTSServiceError):
    """Raised when TTS generation exceeds the timeout threshold."""
    pass


class TTSAPIError(TTSServiceError):
    """Raised when upstream TTS API call fails."""
    pass


class TTSValidationError(TTSServiceError):
    """Raised when generated audio output is missing or invalid."""
    pass


class TTSService:
    """Service encapsulating Google Gemini Text-to-Speech synthesis for Aria."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        voice: Optional[str] = None,
    ):
        self._api_key = api_key if api_key is not None else settings.gemini_api_key
        self._model = model or settings.tts_model
        self._voice = voice or settings.tts_voice
        self._client: Optional[genai.Client] = None

    def sanitize_error_message(self, message: str) -> str:
        """Strips API key patterns or sensitive headers from error strings."""
        if self._api_key and len(self._api_key) > 6:
            message = message.replace(self._api_key, "[REDACTED_API_KEY]")
        return message

    def _get_client(self) -> genai.Client:
        """Initializes or returns cached Google GenAI client."""
        if not self._api_key or not self._api_key.strip():
            raise TTSConfigurationError(
                "Gemini API key is not configured for TTS. Set GEMINI_API_KEY in backend/.env"
            )
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key.strip())
            # Latency Optimization: Disable Speakeasy's default 30-second exponential retry loop
            # on 429/5XX so rate limits and server errors fail fast within the TTS budget
            # rather than stalling async request handling and causing false timeout cancellations.
            try:
                if hasattr(self._client.aio, "interactions") and hasattr(
                    self._client.aio.interactions, "sdk_configuration"
                ):
                    self._client.aio.interactions.sdk_configuration.retry_config = None
            except Exception:
                pass
        return self._client

    @staticmethod
    def get_speech_style(speech_intent: str, emotion: Optional[str] = None) -> str:
        """
        Maps conversational speech_intent and emotion to natural speech_metadata style instructions.
        Maintains consistent warm persona while adapting emotional delivery without contradictory cues.
        """
        intent_key = (speech_intent or "").lower().strip()
        emotion_key = (emotion or "").lower().strip() if emotion else ""

        # Non-contradictory blending: when intent is conversational, emotion can add nuance
        if intent_key == "conversational" and emotion_key:
            if emotion_key in ("curious", "confused"):
                return "interested and intrigued"
            elif emotion_key in ("happy", "excited"):
                return "warm, cheerful and relaxed"
            elif emotion_key in ("sad", "gentle"):
                return "soft, calm and comforting"
            elif emotion_key == "shy":
                return "warm, gentle and modest"
            elif emotion_key == "surprised":
                return "naturally surprised and animated"

        if intent_key in SPEECH_INTENT_STYLE_MAP:
            return SPEECH_INTENT_STYLE_MAP[intent_key]

        if emotion_key:
            if emotion_key == "happy":
                return "bright, lively and enthusiastic"
            elif emotion_key in ("sad", "reassuring"):
                return "gentle, caring and reassuring"
            elif emotion_key == "shy":
                return "warm, gentle and modest"
            elif emotion_key in ("curious", "confused"):
                return "interested and intrigued"

        return SPEECH_INTENT_STYLE_MAP["conversational"]

    async def synthesize_speech(
        self,
        text: str,
        speech_intent: str = "conversational",
        emotion: Optional[str] = None,
    ) -> Optional[TTSResult]:
        """
        Synthesizes audio from dialogue text using gemini-3.8-flash-lite-tts.
        Preserves original dialogue text without alteration.
        """
        trimmed = text.strip() if text else ""
        if not trimmed:
            logger.debug("Empty or whitespace-only text passed to synthesize_speech; skipping synthesis.")
            return None

        client = self._get_client()
        style_instruction = self.get_speech_style(speech_intent, emotion)

        input_payload = [
            {
                "type": "user_input",
                "content": [
                    {
                        "type": "text",
                        "text": trimmed,
                        "annotations": [
                            {
                                "type": "speech_metadata",
                                "style": style_instruction,
                            }
                        ],
                    }
                ],
            }
        ]

        generation_config = {
            "speech_config": [
                {"voice": self._voice},
            ]
        }

        try:
            coro = client.aio.interactions.create(
                model=self._model,
                input=input_payload,
                response_format={"type": "audio"},
                generation_config=generation_config,
            )
            interaction = await asyncio.wait_for(coro, timeout=settings.tts_timeout_seconds)

        except asyncio.TimeoutError:
            logger.warning(
                "TTS API call timed out after %s seconds for text: %.40s...",
                settings.tts_timeout_seconds,
                trimmed,
            )
            raise TTSTimeoutError(f"TTS request timed out after {settings.tts_timeout_seconds}s")

        except APIError as e:
            safe_msg = self.sanitize_error_message(str(e))
            logger.error("Gemini TTS API error: %s", safe_msg)
            raise TTSAPIError(f"Gemini TTS API error: {safe_msg}")

        except TTSConfigurationError:
            raise

        except Exception as e:
            safe_msg = self.sanitize_error_message(str(e))
            logger.error("Unexpected error calling Gemini TTS: %s", safe_msg)
            raise TTSAPIError(f"Unexpected TTS failure: {safe_msg}")

        # Extract audio content from interaction
        audio_content = None
        if hasattr(interaction, "output_audio") and interaction.output_audio:
            audio_content = interaction.output_audio
        elif hasattr(interaction, "steps") and interaction.steps:
            for step in interaction.steps:
                if hasattr(step, "content") and step.content:
                    for item in step.content:
                        if getattr(item, "type", None) == "audio" or hasattr(item, "data"):
                            audio_content = item
                            break
                if audio_content:
                    break

        if not audio_content or not getattr(audio_content, "data", None):
            raise TTSValidationError("No valid audio content returned by Gemini TTS.")

        raw_b64 = audio_content.data.strip()
        if not raw_b64:
            raise TTSValidationError("Gemini TTS returned empty audio data.")

        try:
            audio_bytes = base64.b64decode(raw_b64)
        except Exception as e:
            raise TTSValidationError(f"Failed to decode base64 audio data: {e}")

        if len(audio_bytes) < 44:  # Minimum valid WAV header is 44 bytes
            raise TTSValidationError(f"Audio payload too small ({len(audio_bytes)} bytes) to be valid.")

        mime_type = getattr(audio_content, "mime_type", None) or "audio/wav"
        reported_sample_rate = getattr(audio_content, "sample_rate", None)
        duration: Optional[float] = None
        sample_rate: Optional[int] = reported_sample_rate

        # Attempt precise duration extraction from WAV container header
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                framerate = wf.getframerate()
                nframes = wf.getnframes()
                if framerate > 0:
                    duration = round(nframes / float(framerate), 3)
                    sample_rate = framerate
        except Exception as e:
            logger.debug("Non-fatal: could not parse WAV header directly: %s", e)
            if reported_sample_rate and reported_sample_rate > 0:
                # Fallback estimation assuming 16-bit mono PCM
                duration = round(len(audio_bytes) / (reported_sample_rate * 2), 3)

        return TTSResult(
            audio_data=raw_b64,
            audio_mime_type=mime_type,
            audio_duration=duration,
            audio_sample_rate=sample_rate or 24000,
            byte_length=len(audio_bytes),
        )


tts_service = TTSService()
