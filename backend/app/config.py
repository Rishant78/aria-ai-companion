import os
from pathlib import Path
from typing import List, Optional, Union
import json
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    # Gemini Configuration
    gemini_api_key: str = Field(default="", description="Google Gemini API Key")
    gemini_model: str = Field(default="gemini-3.5-flash-lite", description="Gemini model identifier")
    gemini_timeout_seconds: float = Field(default=30.0, description="Timeout for Gemini requests in seconds")

    # Voice Synthesis Configuration (Milestone 7)
    tts_enabled: bool = Field(default=True, description="Enable real-time voice synthesis")
    tts_model: str = Field(default="gemini-3.8-flash-lite-tts", description="Gemini TTS model identifier")
    tts_voice: str = Field(default="Sulafat", description="Voice identifier for Aria")
    tts_timeout_seconds: float = Field(default=15.0, description="Timeout for TTS generation in seconds")

    # Application Server Configuration
    app_host: str = Field(default="127.0.0.1", description="FastAPI host")
    app_port: int = Field(default=8000, description="FastAPI port")
    allowed_origins: List[str] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"],
        description="Allowed CORS origin domains",
    )
    static_dir: Optional[Path] = Field(
        default=None,
        description="Custom path to built frontend distribution directory",
    )

    # In-Memory Session Storage
    session_ttl_seconds: int = Field(default=7200, description="Session idle time-to-live in seconds (2 hours)")
    max_history_messages: int = Field(default=12, description="Maximum number of conversation turns retained")

    # Prompts
    personality_prompt_path: Path = Field(
        default=BASE_DIR / "prompts" / "companion_personality.txt",
        description="Path to companion personality system prompt",
    )

    model_config = SettingsConfigDict(
        env_file=[BASE_DIR.parent / ".env", ".env"],
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("app_port", mode="before")
    @classmethod
    def resolve_port(cls, value: Union[int, str, None]) -> int:
        port_env = os.environ.get("PORT")
        if port_env:
            try:
                return int(port_env)
            except ValueError:
                pass
        return int(value) if value is not None else 8000

    def get_static_dir(self) -> Optional[Path]:
        """Resolves the directory containing built frontend static assets."""
        if self.static_dir and self.static_dir.is_dir():
            return self.static_dir.resolve()
        # Local development / production monorepo fallback
        candidate = (BASE_DIR.parent.parent / "frontend" / "dist").resolve()
        if candidate.is_dir():
            return candidate
        # Container fallback
        container_candidate = Path("/app/frontend/dist").resolve()
        if container_candidate.is_dir():
            return container_candidate
        return None

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: Union[str, List[str]]) -> List[str]:
        if isinstance(value, list):
            return [origin.strip() for origin in value if origin.strip()]
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, list):
                        return [str(origin).strip() for origin in parsed if str(origin).strip()]
                except json.JSONDecodeError:
                    pass
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()

