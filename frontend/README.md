# Aria AI Companion — Frontend

This is the React 19 frontend application for the **Aria 3D VRM AI Companion**. It provides the real-time Three.js WebGL viewport, lifelike behavioral animation controllers, Web Audio API sound playback, Web Speech API voice input, and floating glassmorphism chat interface.

For full project architecture, backend configuration, and deployment instructions, refer to the [Root README](../README.md).

---

## Tech Stack

- **Framework:** React 19 + TypeScript
- **Bundler & Dev Server:** Vite 8
- **3D Graphics:** Three.js + `@pixiv/three-vrm`
- **Audio & Speech:** Web Audio API (`AudioManager`) & Web Speech API (`useVoiceInput`)
- **Linter & Tester:** Oxlint & Node.js Native Test Runner (`node --test`)

---

## Available Scripts

From the `frontend/` directory, you can run:

### `npm run dev`
Launches the concurrent development environment. Runs `scripts/start-backend.js` (FastAPI backend on port 8000 via `.venv`) and `vite` dev server (on port 5173).

### `npm run dev:frontend`
Starts only the Vite frontend development server on `http://localhost:5173`. Proxies `/api` requests to `http://127.0.0.1:8000`.

### `npm run dev:backend`
Executes `scripts/start-backend.js` to run the FastAPI backend using `backend/.venv`.

### `npm test`
Runs the complete frontend automated test suite (13 test suites, 139 tests) using the native Node test runner and Happy DOM.

### `npm run lint`
Runs Oxlint on all TypeScript/TSX source and test files.

### `npm run build`
Compiles TypeScript (`tsc -b`) and bundles production assets into `dist/` using Vite.

### `npm run preview`
Serves the production build locally from `dist/`.

---

## Directory Layout

```
frontend/
├── scripts/
│   └── start-backend.js            # Node script spawning backend with venv python
├── public/
│   └── models/
│       └── companion.vrm           # Companion VRM model asset
├── src/
│   ├── App.tsx                     # Top-level composition & turn-taking coordinator
│   ├── audio/                      # AudioManager, AnalyserNode, useAudioManager hook
│   ├── character/                  # VRM bone & expression animation controllers:
│   │   ├── AttentionController.ts  # Attention state machine (Attentive, Listening, etc.)
│   │   ├── GazeController.ts       # Pointer tracking and speaking glances
│   │   ├── ExpressionController.ts # Dual-channel facial emotion blending
│   │   ├── BlinkController.ts      # Spontaneous and conversational blinking
│   │   ├── GestureController.ts    # Procedural arm and hand gestures
│   │   ├── BreathingController.ts  # Natural harmonic spine breathing
│   │   ├── NaturalIdleController.ts# Lower-body weight shifts and idle fidgeting
│   │   ├── AutonomousActivityScheduler.ts # Autonomous idle activity system
│   │   ├── SpeechMouthController.ts# Audio-driven viseme lip-sync
│   │   └── ReactionDispatcher.ts   # Unified reaction & replay coordinator
│   ├── components/
│   │   ├── AvatarScene.tsx         # Three.js WebGL viewport component
│   │   ├── chat/                   # FloatingTopBar, SpeechBubbleOverlay, ChatInput...
│   │   └── common/ErrorBoundary.tsx# Isolated error boundary domains
│   ├── conversation/               # REST API client & useCompanionChat hook
│   ├── hooks/                      # useAvatarViewer, useAttentionSystem, useTheme
│   └── voice/                      # Web Speech API useVoiceInput hook & types
└── tests/                          # 13 automated test suites
```

---

## Environment & Prerequisites

1. Ensure the backend virtual environment is created and configured at `../backend/.venv`.
2. Ensure `../backend/.env` has a valid `GEMINI_API_KEY`.
3. Avatar asset must be located at `public/models/companion.vrm`.
