# IT WORKED IN PROD — "Reproduce production bugs locally with one click"

**IT WORKED IN PROD** is a developer-facing tool designed to reconstruct the conditions behind a production failure and recreate the exact same error signature locally inside a controlled Docker sandbox.

Instead of generic AI chat or simple log parsers, this tool focuses on **environmental reconstruction**. It maps production variables, schema revisions, and dependent service configurations, and sets up a matching local replica to prove the reproduction.

Built for **The Zerops Challenge**.

---

## ⚡ The Architecture

The web application runs on **Zerops**, separating the platform backend from the developer's local docker daemon. The **Local Agent** acts as a secure local broker to orchestration tasks.

```
                         ZEROPS
                           │
                  ┌────────▼────────┐
                  │ Web Application  │
                  │  React frontend  │
                  │  Express API     │
                  │  AI Analysis     │
                  │  Scenario Engine │
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

---

## 🛠️ Technology Stack

- **Frontend:** React + Vite (Vanilla CSS, no Tailwind for clean styles)
- **Backend:** Express.js
- **Local Agent:** Standalone Node.js server (runs locally on port `4317`)
- **Containerization:** Docker & Docker Compose
- **AI Integration:** Google Gemini API (via `@google/generative-ai`)
- **Deployment Platform:** Zerops (Native Node.js Service configuration)

---

## 📂 Core reproduction Presets

We prioritize 3 extremely reliable, deterministic incident scenarios:

1. **Missing Configuration**
   - *Error:* `DATABASE_URL is not defined`
   - *Reproduction:* Sandbox starts the application container with `DATABASE_URL` unset, triggers the endpoint, and captures the config missing error.
2. **Database Schema Mismatch**
   - *Error:* `column "subscription" does not exist`
   - *Reproduction:* Sandbox spins up Postgres with a `v16` schema (missing subscription) while the application queries for v17 subscription status, verifying schema differences.
3. **Service Dependency Failure**
   - *Error:* `ECONNREFUSED` connecting to Redis
   - *Reproduction:* Sandbox starts the application container while leaving the dependent Redis container shut down, recreating the topology failure.

---

## ⚙️ Quick Start

### 1. Prerequisites
- **Node.js** (v20+)
- **Docker** and **Docker Compose** installed and running on your local machine

### 2. Local Setup
Clone the repository and install all project dependencies:
```bash
# Install root, backend server, and React client dependencies
npm run install:all
```

### 3. Start the Local Agent
The Local Agent manages the Docker lifecycle on your machine:
```bash
# Start Local Agent on http://localhost:4317
npm run agent
```

### 4. Run the Web App Backend (API & Static Frontend)
```bash
# Start Web Backend on http://localhost:3001
npm start
```
Open your browser and navigate to `http://localhost:3001` to view the tool.

---

## ☁️ Zerops Deployment Guide

To deploy the application to Zerops:

1. Connect your GitHub repository containing this project to your **Zerops account**.
2. Create a new project and add a **Node.js service** named `app`.
3. In the environment variables configuration on Zerops, optionally specify your API keys:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
4. Trigger a build. Zerops will read the `zerops.yml` file in the root directory to automatically build the client React application and deploy the Express server.

---

## 🧭 The Workflow

1. **CAPTURE:** Paste a production error stacktrace or click one of the preset presets.
2. **ANALYZE:** The analysis engine classifies the incident category and isolates the affected microservice.
3. **RECONSTRUCT:** View the generated `reproduction_spec.json` defining the container configurations.
4. **REPRODUCE:** The web frontend calls the Local Agent to launch the Docker sandbox and trigger the target endpoint.
5. **VERIFY:** View side-by-side logs of Production vs. Local Sandbox with verified match confidence.
6. **FIX:** Get actionable advice and the exact command to patch the bug.
