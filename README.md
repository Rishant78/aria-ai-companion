# ARIA — 3D VRM AI Companion

**Aria** is an interactive, real-time 3D VRM AI Companion powered by Google Gemini. She features expressive lifelike animation (natural gaze tracking, procedural breathing, autonomous activities, emotional expressions, gestures), real-time conversational voice synthesis, audio-driven lip synchronization, and browser-native voice input with natural turn-taking.

---

## Key Features

1. **3D Avatar Rendering & Camera Framing**
   - High-fidelity Three.js WebGL rendering for VRM 1.0/0.x avatars (`@pixiv/three-vrm`).
   - Soft 3-point anime lighting optimized for MToon shaders.
   - Smooth camera framing transitions between portrait close-up (`waist`) and full-body (`full`).
   - Orbit controls with user-interaction yielding and automatic resize observer.

2. **Life-Like Behavioral Animation System**
   - **Attention System:** Canonical state machine (`ATTENTIVE`, `EXPLORING`, `SEEKING_ATTENTION`, `LISTENING`, `SPEAKING`).
   - **Gaze & Saccades:** Smooth head and eye tracking toward user pointer; conversational glancing during speech.
   - **Facial Expressions & Blinking:** Dual-channel emotion blending (`conversation` vs `idle` priority) with spontaneous and speech blinking.
   - **Gestures & Posture Shifts:** 8 active character gestures (`wave`, `greeting`, `explain`, `think`, `shrug`, `laugh`, `shy`, `reassure`) and 3 lower-body weight shifts.
   - **Harmonic Breathing & Autonomous Activities:** Continuous procedural breathing and 6 autonomous idling activities that yield instantly on interaction.

3. **Gemini Dialogue & Structured Reasoning**
   - Dialogue generation powered by `gemini-3.5-flash-lite`.
   - Structured JSON output containing companion reply, emotional intent, gestures, and mouth animation profile.
   - Sliding-window in-memory conversation history (retains up to 12 turns) with idle TTL eviction (2 hours).

4. **Gemini Real-Time Voice Synthesis (TTS)**
   - High-speed voice synthesis using `gemini-3.8-flash-lite-tts` via Google GenAI Interactions API.
   - Distinctive **Sulafat** voice persona with emotional tone modulation.
   - Resilient text-only fallback: quota exhaustion, rate limits, or network timeouts automatically degrade to text without breaking dialogue flow.

5. **Audio-Driven Lip-Sync**
   - Web Audio API hardware audio clock tracking.
   - Real-time RMS energy modulation over procedural phonetic viseme timelines (`aa`, `ih`, `ou`, `ee`, `oh`).
   - Seamless fallback to text delta clock when audio is disabled or unavailable.

6. **Voice Input & Natural Turn-Taking**
   - Browser-native Web Speech API speech recognition.
   - Real-time interim transcription streaming and preview badge.
   - Single-utterance auto-submission with strict duplicate protection (`hasSubmittedFinalRef`).
   - Natural turn-taking interruption: speaking or clicking the microphone instantly stops Aria's active speech audio, resets mouth visemes, and switches attention to `LISTENING`.

7. **Immersive Floating Interface**
   - Floating glassmorphism HUD with theme support (Light, Dark, and System).
   - Expandable chat drawer history.
   - Dialogue speech bubble with replay audio button.
   - Comprehensive Error Boundary domains isolating 3D stage and UI overlays.

---

## Architecture & Technology Stack

```mermaid
graph TD
    User([User / Browser])
    
    subgraph Frontend [Frontend - React 19 + Vite]
        UI[Glassmorphism Floating UI]
        VoiceInput[Web Speech API useVoiceInput]
        AudioMgr[Web Audio AudioManager]
        ThreeScene[Three.js + @pixiv/three-vrm Stage]
        AnimEngine[Attention / Gaze / Expression / Gesture Engine]
        LipSync[SpeechMouthController Lip-Sync]
    end

    subgraph Backend [Backend - FastAPI]
        Routes[/api/chat, /api/session, /api/health]
        LLM[LLMService - gemini-3.5-flash-lite]
        TTS[TTSService - gemini-3.8-flash-lite-tts]
        SessionMgr[In-Memory Session Manager]
    end

    User <-->|Mic & Pointer / Visual & Audio| Frontend
    Frontend <-->|REST API JSON / Base64 Audio| Backend
    Backend <-->|Google GenAI SDK| GeminiAPI[Google Gemini API]
```

- **Frontend:** React 19, TypeScript, Vite, Three.js, `@pixiv/three-vrm`, Web Audio API, Web Speech API, Happy DOM (testing), Oxlint.
- **Backend:** FastAPI, Python 3.11+, Pydantic v2, Pydantic-Settings, Uvicorn, `google-genai` SDK (`>=2.25.0,<3.0.0`), Pytest.

---

## Directory Structure

```
hey/
├── companion.vrm                      # Master VRM 3D avatar model asset
├── backend/                           # FastAPI Backend application
│   ├── .env.example                   # Environment configuration template
│   ├── pyproject.toml                 # Backend project metadata & pytest config
│   ├── requirements.txt               # Pinned Python package dependencies
│   ├── app/
│   │   ├── main.py                    # FastAPI app entry point & lifespan
│   │   ├── config.py                  # Pydantic BaseSettings configuration
│   │   ├── api/
│   │   │   ├── routes.py              # /api/chat, /api/session, /api/health
│   │   │   └── schemas.py             # Pydantic request/response schemas
│   │   ├── prompts/
│   │   │   └── companion_personality.txt # Aria's core persona system prompt
│   │   └── services/
│   │       ├── llm_service.py         # Gemini dialogue structured generator
│   │       ├── tts_service.py         # Gemini TTS synthesis (Interactions API)
│   │       └── session_manager.py     # In-memory sliding-window history
│   └── tests/
│       ├── conftest.py
│       ├── test_chat_api.py           # FastAPI endpoint tests
│       ├── test_llm_service.py        # Dialogue generation tests
│       └── test_tts_service.py        # Voice synthesis tests
└── frontend/                          # React 19 Vite application
    ├── package.json                   # Scripts and dependencies
    ├── vite.config.ts                 # Proxy configuration & pre-bundling
    ├── scripts/
    │   └── start-backend.js           # Concurrent backend launcher
    ├── public/
    │   └── models/
    │       └── companion.vrm          # Public avatar asset loaded by Three.js
    ├── src/
    │   ├── App.tsx                    # Top-level composition & turn-taking
    │   ├── audio/                     # AudioManager & Web Audio integration
    │   ├── character/                 # VRM controllers (attention, gaze, gestures...)
    │   ├── components/                # 3D stage and floating chat UI
    │   ├── conversation/              # API client and conversation state hook
    │   ├── hooks/                     # Custom viewer and system hooks
    │   └── voice/                     # Web Speech API voice input hook
    └── tests/                         # Node.js test runner test suites (13 suites)
```

---

## Development & Setup Guide

### Prerequisites
- **Node.js:** v20.18+ or v22+
- **Python:** v3.11, v3.12, or v3.13
- **Operating System:** Windows 10/11 (or macOS / Linux)
- **Google Gemini API Key:** Required for live conversations and voice synthesis.

---

### Step 1: Clone and Navigate
```powershell
git clone <repository-url>
cd hey
```

---

### Step 2: Backend Virtual Environment Setup

Open PowerShell or terminal:
```powershell
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows:
.\.venv\Scripts\Activate.ps1
# On macOS / Linux:
# source .venv/bin/activate

# Upgrade pip and install backend dependencies
pip install -r requirements.txt
```

---

### Step 3: Configure Gemini API Key

1. Copy the example configuration:
   ```powershell
   # In backend directory:
   Copy-Item .env.example .env
   # Or on macOS/Linux: cp .env.example .env
   ```
2. Edit `backend/.env` and insert your Gemini API Key:
   ```ini
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```
   *(All other defaults for `GEMINI_MODEL`, `TTS_MODEL`, and ports are pre-configured.)*

---

### Step 4: Frontend Installation

Open terminal in `frontend`:
```powershell
cd ../frontend
npm install
```

---

### Step 5: Verify VRM Avatar Asset

Verify that `companion.vrm` is located in `frontend/public/models/`:
```powershell
# From project root:
Test-Path frontend/public/models/companion.vrm
```
If missing, copy the root `companion.vrm` into `frontend/public/models/companion.vrm`.

---

## Launching the Application

Run the unified development command from `frontend/`:

```powershell
cd frontend
npm run dev
```

This concurrently launches:
1. **FastAPI Backend:** Spawned via virtual environment python on `http://127.0.0.1:8000`
2. **Vite Frontend Dev Server:** Running on `http://localhost:5173` with reverse proxy routing `/api/*` to FastAPI.

### Local Service URLs

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **Frontend Application** | [http://localhost:5173](http://localhost:5173) | Main 3D companion interface |
| **FastAPI Backend Root** | [http://127.0.0.1:8000](http://127.0.0.1:8000) | Backend REST API server |
| **API Documentation (Swagger)** | [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) | Interactive API exploration |
| **Health Check** | [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health) | Service & model health check |

---

## Testing & Quality Assurance

### Run Frontend Tests (13 Suites / 139 Tests)
```powershell
cd frontend
npm test
```

### Run Backend Tests (50 Tests)
```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest
```

### Run Linter
```powershell
cd frontend
npm run lint
```

### Run Production Build & Type Check
```powershell
cd frontend
npm run build
```

---

## Production & Cloud Deployment Guide

Aria is packaged as a **Unified Multi-Stage Docker Container** where FastAPI serves both the `/api` endpoints and the optimized React 19 single-page application from a single port/domain.

### 1. Build & Run with Docker Locally

```bash
# Build the multi-stage production image
docker build -t aria-companion .

# Run container (injecting your Gemini API key)
docker run -p 8000:8000 -e GEMINI_API_KEY="your-gemini-api-key" aria-companion
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

---

### 2. Run with Docker Compose

Ensure `backend/.env` contains your `GEMINI_API_KEY`, then run:

```bash
docker compose up --build
```

---

### 3. Deploy to Google Cloud Run

Google Cloud Run provides serverless scaling and automatic HTTPS (required for browser microphone access):

```bash
# Deploy directly from source
gcloud run deploy aria-companion \
  --source . \
  --port 8000 \
  --set-env-vars GEMINI_API_KEY="your-gemini-api-key" \
  --allow-unauthenticated \
  --region us-central1
```

---

### 4. Deploy to Railway or Render

1. Push your repository to GitHub or GitLab.
2. In Railway / Render, create a **New Web Service** and connect your repository.
3. Select **Docker** as the runtime (it will automatically use the root `Dockerfile`).
4. In the Environment Variables settings, add:
   - `GEMINI_API_KEY` = your actual Gemini API key.
5. Deploy. The platform will automatically bind `$PORT` and provide an HTTPS URL.

---

## Browser Support Notes

- **Google Chrome & Microsoft Edge:** Full native support for 3D WebGL, Web Audio API, and Web Speech API voice input.
- **Apple Safari (macOS/iOS):** Supported with prefix `webkitSpeechRecognition`. Requires explicit user gesture to initialize audio playback.
- **Mozilla Firefox:** Full WebGL and 3D rendering support. Web Speech API voice recognition is disabled by default in desktop Firefox; the application gracefully falls back to interactive text chat with clear UI feedback.

