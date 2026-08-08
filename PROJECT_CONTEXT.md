# IT WORKED IN PROD — Project Context

## Project Goal

A developer tool that reconstructs the conditions behind a production failure and reproduces that failure locally. Not an AI chatbot. Not a generic dashboard. A reproduction engine with a polished workflow UI.

**Tagline:** "Reproduce production bugs locally with one click."

**For:** The Zerops Challenge (48-hour hackathon)

## Architecture

```
                         ZEROPS
                           │
                  ┌────────▼────────┐
                  │ Web Application  │
                  │  React frontend  │
                  │  Express API     │
                  │  AI analysis     │
                  │  Scenario engine │
                  └────────┬─────────┘
                           │
                    Reproduction Spec
                           │
                           ▼
                  ┌──────────────────┐
                  │ Local Agent      │
                  │ localhost:4317   │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ Docker Engine    │
                  └────────┬─────────┘
                           │
                 ┌─────────┼─────────┐
                 ▼         ▼         ▼
               App        DB      Redis
                 └─────────┼─────────┘
                           ▼
                    Reproduced Error
                           │
                           ▼
                    Evidence → UI
```

Key principle: The web app on Zerops CANNOT control Docker on the user's laptop. The Local Agent bridges this gap.

## Technology Stack

- **Frontend:** React + Vite (vanilla CSS, no Tailwind)
- **Backend:** Express.js
- **Local Agent:** Standalone Node.js server (localhost:4317)
- **Reproduction:** Docker + Docker Compose
- **AI:** Abstracted AI provider (Gemini/OpenAI/Claude) with deterministic fallbacks
- **Deployment:** Zerops

## Two Execution Modes

1. **Real Mode:** Local Agent + Docker → actual reproduction
2. **Demo Mode:** Deterministic scenario fixtures → same UX, pre-computed results

## Scenarios (3 total)

1. **Missing Configuration** — `DATABASE_URL` undefined → connection error
2. **DB Schema Mismatch** — missing column `subscription` → query error
3. **Service Dependency Failure** — Redis unavailable → ECONNREFUSED

## Core Workflow

```
CAPTURE → ANALYZE → RECONSTRUCT → REPRODUCE → VERIFY → FIX
```

## Current Implementation

- Phase 0: Completed (Built 3 scenarios: missing-config, db-schema, service-down)
- Phase 1: Completed (Built Local Agent at localhost:4317)
- Phase 2: Completed (Built Express API, deterministic analysis engine, and Zerops config)
- Phase 3: Completed (Built React Frontend with 6-step workflow, split-screen logs comparison, and simulated execution panel)
- Phase 4: Completed (Integrated Gemini API for analysis, fully documented in README)

## Completed Phases

- Phase 0 — Reproduction Engine (Docker scenarios)
- Phase 1 — Local Agent (localhost:4317)
- Phase 2 — Backend/API (Express.js)
- Phase 3 — Frontend (React + Vite)
- Phase 4 — AI & Documentation (Gemini API & README)

## Current Phase

Phase 5 — Deploy & Verify (Zerops Production Deployment)

## Known Bugs

(none yet)

## Known Limitations

- Docker must be available locally for real reproduction
- AI analysis requires an API key (falls back to deterministic analysis)

## Environment Variables

```
# AI Provider (optional — deterministic fallback exists)
AI_PROVIDER=gemini|openai|claude
AI_API_KEY=<key>

# Server
PORT=3001
NODE_ENV=development

# Local Agent Port
LOCAL_AGENT_PORT=4317
```

## How to Run Locally

```bash
# Run local agent
cd local-agent && npm install && npm start
```

## Important Architecture Decisions

1. LLM produces STRUCTURED specs, not arbitrary Docker Compose files
2. Deterministic scenario engine handles actual reproduction
3. Local Agent is minimal — receives spec, runs Docker, returns results
4. Demo mode uses same pipeline abstraction with fixture data
5. No auth, no accounts, no billing for MVP

## Next Task

Deploy the Node.js application service to Zerops and verify web page access and demo scenario execution in production.
