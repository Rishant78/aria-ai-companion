from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional
import uuid


@dataclass
class ChatMessage:
    role: str  # "user" or "model"
    content: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SessionState:
    session_id: str
    messages: List[ChatMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class SessionManager:
    """In-memory session manager with sliding-window history and idle TTL eviction."""

    def __init__(self, ttl_seconds: int = 7200, max_history_messages: int = 12):
        self._ttl_seconds = ttl_seconds
        self._max_history = max_history_messages
        self._sessions: Dict[str, SessionState] = {}

    def _is_expired(self, session: SessionState, now: datetime) -> bool:
        return (now - session.last_accessed_at).total_seconds() > self._ttl_seconds

    def clean_expired_sessions(self) -> int:
        """Removes expired sessions. Returns count of purged sessions."""
        now = datetime.now(timezone.utc)
        expired_keys = [
            sid for sid, session in self._sessions.items()
            if self._is_expired(session, now)
        ]
        for sid in expired_keys:
            self._sessions.pop(sid, None)
        return len(expired_keys)

    def create_session(self, session_id: Optional[str] = None) -> str:
        """Creates and registers a new session. Returns the session_id."""
        self.clean_expired_sessions()
        sid = session_id or str(uuid.uuid4())
        self._sessions[sid] = SessionState(session_id=sid)
        return sid

    def get_session(self, session_id: str) -> Optional[SessionState]:
        """Returns session if present and unexpired; refreshes last_accessed_at."""
        now = datetime.now(timezone.utc)
        session = self._sessions.get(session_id)
        if session is None:
            return None

        if self._is_expired(session, now):
            self._sessions.pop(session_id, None)
            return None

        session.last_accessed_at = now
        return session

    def get_or_create_session(self, session_id: str) -> SessionState:
        """Gets existing session or creates a new one with given session_id."""
        session = self.get_session(session_id)
        if session is None:
            now = datetime.now(timezone.utc)
            session = SessionState(session_id=session_id, created_at=now, last_accessed_at=now)
            self._sessions[session_id] = session
        return session

    def add_user_message(self, session_id: str, message: str) -> None:
        """Appends user message and trims history to max_history_messages."""
        session = self.get_or_create_session(session_id)
        session.messages.append(ChatMessage(role="user", content=message))
        self._prune_history(session)

    def add_assistant_message(self, session_id: str, response_text: str) -> None:
        """Appends assistant message and trims history to max_history_messages."""
        session = self.get_or_create_session(session_id)
        session.messages.append(ChatMessage(role="model", content=response_text))
        self._prune_history(session)

    def _prune_history(self, session: SessionState) -> None:
        if len(session.messages) > self._max_history:
            session.messages = session.messages[-self._max_history:]

    def get_history(self, session_id: str) -> List[ChatMessage]:
        """Returns message list for session if active; empty list if not found or expired."""
        session = self.get_session(session_id)
        return list(session.messages) if session else []

    def delete_session(self, session_id: str) -> bool:
        """Deletes session. Returns True if existed."""
        return self._sessions.pop(session_id, None) is not None

    def session_exists(self, session_id: str) -> bool:
        """Checks if session exists and is unexpired."""
        return self.get_session(session_id) is not None

    def clear_all(self) -> None:
        """Clears all sessions (useful for test isolation)."""
        self._sessions.clear()


session_manager = SessionManager()

