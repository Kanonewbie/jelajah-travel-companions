# Jelajah — Smart Travel Companion (Render Full-stack)

Jelajah is a responsive travel-planning web app based on the supplied Smart Travel Companion specification. This repository keeps the existing HTML/CSS/JavaScript UI and adds an Express API, PostgreSQL migrations, password-based account sessions, and an account-scoped cloud backup for the UI state.

> **MVP boundary:** This is a full-stack web foundation, not yet the final Flutter iOS/Android app. Map/weather/flight/AI providers, Google/Apple/OTP sign-in, encrypted native document vault, SMS sending, and real-time group collaboration require additional integration work and credentials. Do not store actual passport/visa numbers or upload identity documents into this web MVP.

## Requirements

- Node.js 20 or later and npm
- PostgreSQL 15/16 locally, or a PostgreSQL database on Render
- Visual Studio Code (recommended)
- Git and a GitHub account for Render auto-deploys

## Run locally in VS Code

1. Extract/open the `jelajah-render` folder in VS Code.
2. Install packages in VS Code Terminal (first time only):

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in macOS/Linux), then set `DATABASE_URL` to a PostgreSQL database you control. Example for a local PostgreSQL instance:

   ```env
   NODE_ENV=development
   PORT=3000
   SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/jelajah
   PG_POOL_MAX=10
   ```

   Create the database `jelajah` first in PostgreSQL. The application does not create a PostgreSQL server or database itself; it creates the required tables through migrations.

4. Run database migrations and start the app:

   ```bash
   npm run migrate
   npm run dev
   ```

   Or simply run `npm start`: it applies pending migrations and starts Express.

5. Open `http://localhost:3000`. Do **not** use VS Code Live Server for this full-stack version because it bypasses Express and `/api/*` routes.

### Tests and checks

```bash
npm test
npm run check
```

`npm test` checks validation, trip input rules, and privacy sanitization. It does not replace API integration tests against a real PostgreSQL database.

## Render deployment (Blueprint)

The repository includes `render.yaml`, which defines a Node web service, a PostgreSQL database, `DATABASE_URL` wiring, an automatically generated `SESSION_SECRET`, Singapore region, and `/api/health` health check.

1. Push this project folder to a new GitHub repository (steps below).
2. Sign in to Render and choose **New → Blueprint**.
3. Connect your GitHub repository and select the branch containing `render.yaml`.
4. Review the resources and apply the Blueprint. Render sets `DATABASE_URL` from the database's **internal** connection string and generates `SESSION_SECRET`; no real API provider key is needed for the MVP.
5. Follow the deploy logs. `npm start` runs the versioned SQL migrations before Express begins listening.
6. Open the generated `onrender.com` URL. Check `/api/health` and verify `{"status":"ok","database":"connected",...}`.

The sample Blueprint uses Render's **Free** plans for initial evaluation. Render's Free PostgreSQL expires after 30 days and has a 1 GB limit, so it is not suitable for long-term storage of important travel information. Before real users rely on it, change the database to a suitable paid plan and confirm backups/retention. Free web services can sleep when idle. See Render's official docs:

- Node/Express deployment: https://render.com/docs/deploy-node-express-app
- Blueprint reference: https://render.com/docs/blueprint-spec
- Render Postgres connection strings: https://render.com/docs/postgresql-creating-connecting
- Free plan limitations: https://render.com/docs/free

For the Render web service, use the **internal** Postgres URL (Blueprint `fromDatabase` wiring does this). For local development from your computer, use the database's external URL and its TLS requirement (`sslmode=require`); keep the URL only in `.env`, never in source control. Avoid putting real traveler data into the free/demo deployment.

## GitHub from VS Code

1. Create an empty repository on GitHub, for example `jelajah-travel-companion`. Do not add a README/license from GitHub if you plan to push this existing folder as-is.
2. Open the project folder in VS Code and use **Terminal → New Terminal**.
3. Run:

   ```bash
   git init
   git add .
   git commit -m "Initial Jelajah full-stack app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/jelajah-travel-companion.git
   git push -u origin main
   ```

4. Replace `YOUR_USERNAME` with your GitHub username. If Git asks you to sign in, complete the browser login flow.
5. Connect this repository to Render using the Blueprint steps above. Later, commit and push changes to trigger automatic deployment.

`.env`, `node_modules`, logs, and coverage outputs are in `.gitignore`. Never commit passwords, database connection strings, session secrets, provider API keys, or personal data exports.

## What is implemented

- Existing Jelajah responsive front end and local-first interactions
- Express serves static files and API from the same origin
- PostgreSQL migrations run in order and record applied versions
- Account registration/login with bcrypt password hashing, PostgreSQL-backed HTTP sessions, HTTP-only cookies, SameSite=Lax, CSRF token validation, rate limiting, Helmet security headers, input limits, and ownership checks
- `GET /api/auth/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `DELETE /api/account`
- `GET /api/state` / `PUT /api/state` for account-scoped snapshot backup with version conflict checks
- Normalized trip starter API: `GET /api/trips`, `POST /api/trips`, `PATCH /api/trips/:id`, `DELETE /api/trips/:id`
- `GET /api/health`
- Cloud-sync UI controls; explicit consent is required before registering or signing in to enable cloud save
- Cloud conflict prompt when a different version is detected
- Contacts/phone numbers, browser location/analytics consent flags, and document reminder notes are stripped from the cloud snapshot and remain local-only
- Export and delete-local-data behaviors inherited from the original UI
- Tests for validation and privacy snapshot rules

## API quick reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health + database availability |
| GET | `/api/auth/csrf` | Issue same-origin CSRF token |
| POST | `/api/auth/register` | Create account and session |
| POST | `/api/auth/login` | Authenticate and create session |
| GET | `/api/auth/me` | Current session user |
| POST | `/api/auth/logout` | End session |
| GET | `/api/state` | Fetch sanitized account backup |
| PUT | `/api/state` | Save backup with `baseVersion` |
| DELETE | `/api/state` | Delete account cloud snapshot |
| GET | `/api/trips` | List owned relational trips |
| POST | `/api/trips` | Create owned relational trip |
| PATCH | `/api/trips/:id` | Update an owned trip |
| DELETE | `/api/trips/:id` | Soft-delete an owned trip |
| DELETE | `/api/account` | Delete account and its relational data |

For mutation routes, first call `/api/auth/csrf` and send its token as `X-CSRF-Token`. The front end does this automatically.

## Data model and sync behavior

`db/migrations/001_core.sql` creates relational foundations for profiles/preferences, trips/members, itinerary days/items, votes/responses, notes, expenses/splits/settlements, packing, document metadata, bookings, photos, published routes, badges, and sync operations. `db/migrations/002_auth_and_app_state.sql` adds app accounts, session storage, and `user_app_state`.

The current UI's first cloud integration stores a single sanitized JSON snapshot per account so existing screens can persist without a risky large rewrite. It is versioned; concurrent updates return HTTP 409, and the user chooses whether to load the cloud version or overwrite it with the version on the current device. The normalized trip endpoints are available for a subsequent migration of UI writes into separate relational endpoints; the screens do not yet use those endpoints directly.

Local browser storage stays available if the API is unreachable. Cloud sync is not offline-queued across different sessions; local-first data remains safe on the current browser and the UI reports sync errors. The app does not automatically overwrite conflicts.

## Security and missing credentials

- `SESSION_SECRET` is generated by Render; local `.env` needs a unique random value.
- `DATABASE_URL` is wired from Render PostgreSQL or entered locally.
- **No third-party API keys are required to run this MVP.** When adding AI, maps, weather, flights, email OTP, SMS, or translation, create server-side environment variables/Render secrets and proxy requests from Express. Never place provider keys in `public/app.js` or HTML.
- Google/Apple sign-in and WhatsApp/SMS OTP are not active; account sign-in currently uses email + password. Email verification and password reset/recovery are **not implemented**, so this starter should not be opened to untrusted public users until those flows and an independent security review are complete.
- The document vault is reminder metadata, not AES-256 encrypted document storage. Contacts and document notes stay local-only; actual files and passport/visa identifiers should not be entered.
- Location is requested only when the panic/location action is used. The app prepares a message/map link; it does not send an SOS automatically.
- Keep dependencies updated, add integration/security tests, set a real privacy policy and account recovery flow, and run a security review before production launch.
