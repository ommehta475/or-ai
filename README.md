# ORLIXA AI

**ORLIXA AI** is a production-minded AI chat platform developed by **Orlixa Labs**, powered by the **OpenRouter API**, **Supabase Authentication & PostgreSQL (with RLS)**, and a streaming API backend.

> **Your AI. Your Ideas. Your Possibilities.**

---

## Repository Layout

This repository includes:

1. **Production Split-Deployment Codebase** (Cloudflare Pages + FastAPI + OpenRouter + Supabase):
   - `frontend/` — Lightweight HTML5, CSS3, and modular ES JavaScript (`index.html`, `login.html`, `register.html`, `styles.css`, `app.js`, `auth.js`, `supabase.js`, `config.example.js`) for **Cloudflare Pages**.
   - `backend/` — Python 3.11+ **FastAPI** server (`app/main.py`, `app/auth.py`, `app/database.py`, `app/ai.py`, `app/rate_limit.py`, `app/routes/*`, `requirements.txt`, `.env.example`).
   - `database/` — Complete PostgreSQL schema (`schema.sql`) and Row Level Security policies (`policies.sql`).
2. **Integrated Full-Stack Preview Runtime** (`server.ts` + `src/`):
   - Express + Vite runtime serving the ORLIXA AI workspace and `/api/*` endpoints on port `3000`.

---

## 1. Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in Supabase and run:
   1. `database/schema.sql`
   2. `database/policies.sql`
3. In **Authentication -> URL Configuration**:
   - Set **Site URL** to your frontend URL (e.g., `https://orlixa-ai.pages.dev` or your preview URL).
   - Add redirect URLs for password reset (`https://orlixa-ai.pages.dev/login.html?type=recovery`, `http://localhost:3000/?type=recovery`).
4. In **Authentication -> Providers -> Email**:
   - Enable Email + Password authentication and **Confirm email** for email verification.
5. Note your project credentials:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (publishable/anon key — safe for browser)
   - `SUPABASE_SERVICE_ROLE_KEY` (private server-only secret — **never** expose in frontend)

To promote an initial admin user for moderation endpoints:
```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'admin@orlixa.example';
```

---

## 2. OpenRouter API Configuration

ORLIXA AI routes all chat completions through the **OpenRouter API** from the backend server (`OPENROUTER_API_KEY` is never exposed to frontend JavaScript):

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_TEMPERATURE=0.7
MAX_OUTPUT_TOKENS=2048
AI_REQUEST_TIMEOUT_SECONDS=120
```

- Browse available model IDs at [openrouter.ai/models](https://openrouter.ai/models).
- `GET /health` reports backend, Supabase, and OpenRouter configuration status (without reporting AI as connected merely because an API key exists).
- `POST /api/chat/test` (authenticated) runs a real, minimal OpenRouter completion (`max_tokens: 1`) to verify live API connectivity, credits, and model validity.

---

## 3. FastAPI Backend Deployment

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
# OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL, and ALLOWED_ORIGINS
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### API Endpoints
- `GET /health` — Backend, Supabase, and OpenRouter configuration status
- `POST /api/chat/test` — Authenticated real OpenRouter connectivity test
- `GET /api/me` / `PATCH /api/me` — Authenticated user profile & settings
- `GET /api/conversations` / `POST /api/conversations`
- `GET /api/conversations/{id}` / `DELETE /api/conversations/{id}`
- `POST /api/chat/stream` — Authenticated SSE token streaming from OpenRouter
- `POST /api/chat/stop` — Cancels active generation stream
- `POST /api/reports` — Abuse report submission
- `GET /api/admin/overview`, `PATCH /api/admin/users/{id}/status`, `PATCH /api/admin/reports/{id}` — Admin-only moderation routes

---

## 4. Cloudflare Pages Frontend Deployment

1. Copy `frontend/config.example.js` to `frontend/config.js` (gitignored) or inject during build:
   ```js
   window.ORLIXA_CONFIG = {
     SUPABASE_URL: "https://your-project-ref.supabase.co",
     SUPABASE_ANON_KEY: "your-supabase-anon-publishable-key",
     BACKEND_API_URL: "https://api.orlixa.yourdomain.com",
   };
   ```
2. Deploy the `frontend/` directory to **Cloudflare Pages** (Framework preset: *None*, Build output directory: `frontend`).
3. Ensure `ALLOWED_ORIGINS` on your FastAPI backend includes your exact Cloudflare Pages URL (e.g., `https://orlixa-ai.pages.dev`).
