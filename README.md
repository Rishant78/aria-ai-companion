# Aria — 3D VRM AI Companion

Aria is an interactive 3D AI companion powered by Google Gemini, featuring lifelike animations, emotional expressions, natural conversations and real-time voice interaction.

##  Features
- Interactive 3D VRM avatar with natural gaze and movement.
- Dynamic emotions, gestures and autonomous activities.
- Gemini-powered conversations.
- Natural voice synthesis and audio-driven lip-sync.
- Browser-based voice input and natural turn-taking.
- Floating chat interface with theme support.

##  Tech Stack
React · TypeScript · Three.js · VRM · FastAPI · Python · Google Gemini · Web Audio API

##  Getting Started

**Requirements:** Node.js, Python 3.11+ and a Google Gemini API key.

```bash
git clone https://github.com/Rishant78/aria-ai-companion.git
cd aria-ai-companion
```

Install backend dependencies, configure `backend/.env` using `backend/.env.example`, then install frontend dependencies.

Start the application from `frontend/`:

```bash
npm install
npm run dev
```

Open **http://localhost:5173**.

##  Docker

```bash
docker compose --env-file backend/.env up --build -d
```

Open **http://localhost:8000**.

---

**Built by Rishant.**
