import type { CompanionResponsePayload } from './ConversationTypes';

export class ChatApiError extends Error {
  public readonly status?: number;
  public readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
    this.detail = detail;
  }
}

export class ChatNetworkError extends ChatApiError {
  constructor(message = 'Unable to connect to companion service. Please check your network or server.') {
    super(message, 0);
    this.name = 'ChatNetworkError';
  }
}

export class ChatTimeoutError extends ChatApiError {
  constructor(message = 'Companion response timed out. Please try asking again.') {
    super(message, 408);
    this.name = 'ChatTimeoutError';
  }
}

interface CreateSessionResponse {
  session_id: string;
  created_at: string;
}

interface DeleteSessionResponse {
  session_id: string;
  deleted: boolean;
}

interface HealthResponse {
  status: string;
  model: string;
  timestamp: string;
}

const DEFAULT_TIMEOUT_MS = 35000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = options;
  const controller = new AbortController();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (callerSignal) {
    callerSignal.addEventListener('abort', () => {
      controller.abort();
    });
  }

  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
    });
    return res;
  } catch (err: unknown) {
    if (timedOut) {
      throw new ChatTimeoutError();
    }
    if (callerSignal?.aborted) {
      throw new DOMException('Request cancelled by user', 'AbortError');
    }
    if (err instanceof ChatApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ChatNetworkError(`Network error: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function createSession(signal?: AbortSignal): Promise<string> {
  const res = await fetchWithTimeout('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new ChatApiError(`Failed to initialize session (${res.status})`, res.status, errorBody);
  }

  const data = (await res.json()) as CreateSessionResponse;
  return data.session_id;
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  voiceEnabled: boolean = true,
): Promise<CompanionResponsePayload> {
  const res = await fetchWithTimeout('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      voice_enabled: voiceEnabled,
    }),
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson.detail || JSON.stringify(errJson);
    } catch {
      detail = await res.text().catch(() => '');
    }

    if (res.status === 404) {
      throw new ChatApiError('Session expired or not found. Please start a new conversation.', 404, detail);
    }
    if (res.status === 503) {
      throw new ChatApiError('Companion AI is currently unavailable or unconfigured.', 503, detail);
    }
    if (res.status === 504) {
      throw new ChatTimeoutError(detail || 'Companion request timed out.');
    }
    throw new ChatApiError(detail || `Chat request failed with status ${res.status}`, res.status, detail);
  }

  const data = (await res.json()) as CompanionResponsePayload;
  return data;
}

export async function deleteSession(sessionId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`/api/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      signal,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as DeleteSessionResponse;
    return !!data.deleted;
  } catch {
    return false;
  }
}

export async function checkBackendHealth(signal?: AbortSignal): Promise<HealthResponse | null> {
  try {
    const res = await fetchWithTimeout('/api/health', {
      method: 'GET',
      signal,
    }, 5000);
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

