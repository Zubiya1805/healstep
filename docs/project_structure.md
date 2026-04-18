# HealStep Project Structure Guide

This document provides a comprehensive overview of the HealStep (recover-right) project directory. It is designed to help new developers quickly understand the architecture, navigation, and purpose of each component within the codebase.

---

## 1. Frontend (User Interface)
The `public/` folder contains all the static assets and HTML files served to the client. This is the user-facing side of the application.

- **`public/`** — The root folder for frontend static files served by Express.
- **`public/css/`** — Contains stylesheets like `base.css` which define the design system, animations, and typography (e.g., the neon-green HealStep theme).
- **`public/js/`** — Contains client-side JavaScript utilities (like `auth.js` for checking login sessions).
- **`public/dashboard.html`** — The main user hub. It displays quick actions, a snapshot of today's routine, and the real-time Recovery Score (rendered dynamically via Chart.js).
- **`public/upload-report.html`** — The interface where patients upload their medical reports (PDF/Images) to trigger the AI analysis. Contains drag-and-drop logic and sleek loading animations.
- **`public/routine.html`** — Displays the user's personalized, AI-generated recovery plan. It extracts and formats the structured JSON (Diet, Exercise, Precautions) into readable checklists.
- **`public/daily-feedback.html`** — The daily tracker where users log their progress, which calculates into their 7-day Recovery Score on the dashboard.

---

## 2. Backend (Server & API)
The core logic handling requests, AI processing, and file storage.

- **`server.js`** — The main entry point for the backend. It initializes the Express.js server and defines all API endpoints (Authentication, File Uploads via Multer, Recovery Plan fetching, and Daily Progress tracking). It also orchestrates the OpenRouter AI integration (`google/gemini-2.0-flash-exp:free`) to analyze files and generate structured JSON outputs.
- **`uploads/`** — A temporary storage directory managed by Multer. When a user uploads a report, it is temporarily stored here to be encoded into Base64 for the AI, and optionally kept as a reference linked to the `reports` table.

---

## 3. Database Layer
These files handle the connection and schema migrations for our PostgreSQL database.

- **`db.js`** — Establishes and exports the `pg` database connection pool, authenticating using environment variables.
- **`init_db.js`** — The initial database setup script. Used to create the core tables (`users`, `reports`, `recovery_plans`).
- **`migrate.js`** — A migration script used to update the `users` table schema, adding patient demographic fields (gender, disease, admission date).
- **`migrate_daily_progress.js`** — The migration script that created the `daily_progress` table required for the feedback tracking loop and Recovery Score calculation.

---

## 4. Configuration & Environment
Root-level files that configure the project dependencies, environment variables, and Git rules.

- **`.env`** — (Not committed to source control) Stores sensitive environment variables such as the `DB_URL` (Postgres connection string) and `OPENROUTER_API_KEY`.
- **`.gitignore`** — Defines which files and directories Git should ignore (e.g., `node_modules/`, `.env`, and potentially the `uploads/` folder so user data isn't tracked in version control).
- **`package.json`** — The Node.js manifest file. It lists project metadata, runtime scripts (like `npm start` or `node server.js`), and all necessary dependencies (e.g., `express`, `pg`, `bcrypt`, `multer`).
