import asyncio
import logging
from pathlib import Path
from typing import List, Optional
from pydantic import ValidationError

from google import genai
from google.genai import types
from google.genai.errors import APIError

from app.config import settings
from app.api.schemas import CompanionResponse
from app.services.session_manager import ChatMessage

logger = logging.getLogger("companion.llm")


class LLMServiceError(Exception):
    """Base exception for LLM operations."""
    pass


class LLMConfigurationError(LLMServiceError):
    """Raised when the Gemini API key or critical configuration is missing."""
    pass


class LLMTimeoutError(LLMServiceError):
    """Raised when Gemini request exceeds the timeout threshold."""
    pass


class LLMAPIError(LLMServiceError):
    """Raised when Gemini API encounters an error (rate limit, quota, service outage)."""
    pass


class LLMSafetyRefusalError(LLMServiceError):
    """Raised when Gemini refuses to generate content due to safety policy."""
    pass


class LLMResponseValidationError(LLMServiceError):
    """Raised when Gemini output cannot be validated against CompanionResponse schema."""
    pass


class LLMService:
    """Service encapsulating Google Gemini structured conversational generation."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self._api_key = api_key if api_key is not None else settings.gemini_api_key
        self._model = model or settings.gemini_model
        self._system_prompt: Optional[str] = None
        self._client: Optional[genai.Client] = None

    def _sanitize_error_message(self, message: str) -> str:
        """Strips API key patterns or sensitive headers from error strings."""
        if self._api_key and len(self._api_key) > 6:
            message = message.replace(self._api_key, "[REDACTED_API_KEY]")
        return message

    def get_system_instruction(self) -> str:
        """Loads and caches system instruction from the personality file."""
        if self._system_prompt is None:
            prompt_path = Path(settings.personality_prompt_path)
            if not prompt_path.is_file():
                raise LLMConfigurationError(
                    f"Personality prompt file not found at {prompt_path}"
                )
            try:
                self._system_prompt = prompt_path.read_text(encoding="utf-8").strip()
            except Exception as e:
                raise LLMConfigurationError(
                    f"Failed to read personality prompt file: {e}"
                )
        return self._system_prompt

    def _get_client(self) -> genai.Client:
        """Initializes or returns cached Google GenAI client."""
        if not self._api_key or not self._api_key.strip():
            raise LLMConfigurationError(
                "Gemini API key is not configured. Set GEMINI_API_KEY in backend/.env"
            )
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key.strip())
        return self._client

    @staticmethod
    def _clean_schema_for_gemini(schema: object) -> object:
        """Removes fields like additionalProperties unsupported by Gemini API Schema proto."""
        if isinstance(schema, dict):
            return {
                k: LLMService._clean_schema_for_gemini(v)
                for k, v in schema.items()
                if k not in ("additionalProperties", "additional_properties")
            }
        elif isinstance(schema, list):
            return [LLMService._clean_schema_for_gemini(item) for item in schema]
        return schema

    async def generate_response(
        self,
        history: List[ChatMessage],
        user_message: str,
    ) -> CompanionResponse:
        """
        Sends conversation history and the latest user message to Gemini,
        enforcing structured output according to CompanionResponse.
        """
        system_instruction = self.get_system_instruction()
        client = self._get_client()

        # Build conversation contents
        contents: List[types.Content] = []
        for msg in history:
            contents.append(
                types.Content(
                    role=msg.role,
                    parts=[types.Part.from_text(text=msg.content)],
                )
            )

        contents.append(
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)],
            )
        )

        gemini_schema = self._clean_schema_for_gemini(CompanionResponse.model_json_schema())
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=gemini_schema,
            temperature=0.75,
        )

        try:
            call_coro = client.aio.models.generate_content(
                model=self._model,
                contents=contents,
                config=config,
            )
            response = await asyncio.wait_for(call_coro, timeout=settings.gemini_timeout_seconds)

        except asyncio.TimeoutError:
            logger.warning("Gemini API call timed out after %s seconds", settings.gemini_timeout_seconds)
            raise LLMTimeoutError("The companion took too long to reply. Please try again.")

        except APIError as e:
            safe_msg = self._sanitize_error_message(str(e))
            logger.error("Gemini API error: %s", safe_msg)
            raise LLMAPIError(f"Gemini API error: {safe_msg}")

        except LLMConfigurationError:
            raise

        except Exception as e:
            safe_msg = self._sanitize_error_message(str(e))
            logger.error("Unexpected error calling Gemini: %s", safe_msg)
            raise LLMAPIError(f"Unexpected LLM failure: {safe_msg}")

        # Check for safety refusals or empty responses
        if not response or not response.candidates:
            raise LLMSafetyRefusalError("No response candidates returned by Gemini.")

        candidate = response.candidates[0]
        finish_reason = getattr(candidate, "finish_reason", None)
        if finish_reason and str(finish_reason).upper() in ("SAFETY", "RECITATION", "BLOCKLIST"):
            raise LLMSafetyRefusalError("Response generation was refused due to content safety policy.")

        # Parse structured output
        if hasattr(response, "parsed") and isinstance(response.parsed, CompanionResponse):
            return response.parsed

        response_text = getattr(response, "text", None)
        if not response_text or not response_text.strip():
            raise LLMAPIError("Gemini returned an empty text response.")

        try:
            return CompanionResponse.model_validate_json(response_text)
        except ValidationError as e:
            logger.error("Failed to validate Gemini response against CompanionResponse: %s", e)
            raise LLMResponseValidationError("Gemini response did not match the expected schema.")


llm_service = LLMService()

