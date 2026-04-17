# RecoverRight - Project Overview & Architecture

## 1. Project Overview
**RecoverRight** is an AI-powered post-operative recovery platform designed for patients recovering from major surgeries (COVID-19, heart operations, kidney transplants). It analyzes medical reports to generate personalized daily diet and exercise plans. The system uses a feedback loop to adapt the plan daily based on patient progress.

## 2. Tech Stack
* **Frontend:** React.js
* **Backend:** Node.js + Express.js
* **Database:** PostgreSQL (Local)
* **File Storage:** Local File System (`/uploads` directory for medical reports)
* **AI Layer:** Anthropic Claude API (For report analysis & plan generation)

## 3. Core Workflow
1.  **Onboarding:** Patient signs up with basic health/surgery details.
2.  **Report Upload:** Patient uploads medical reports (PDF/Image). Saved locally.
3.  **AI Analysis:** Claude extracts text from the report to identify severity, deficiencies, and physical limits.
4.  **Daily Plan Generation:** Claude generates a personalized meal and exercise plan (JSON format).
5.  **Daily Dashboard:** User views today's tasks.
6.  **End-of-Day Feedback:** User submits compliance (0-100%) and feeling score (1-10).
7.  **Adaptive Update:** Claude adjusts tomorrow's plan based on today's feedback.

## 4. Database Schema (PostgreSQL)

### `users`
* `id` (SERIAL PRIMARY KEY)
* `name` (VARCHAR)
* `age` (INT)
* `weight` (DECIMAL)
* `surgery_type` (VARCHAR)
* `discharge_date` (DATE)
* `email` (VARCHAR UNIQUE)
* `password` (VARCHAR)
* `created_at` (TIMESTAMP)

### `reports`
* `id` (SERIAL PRIMARY KEY)
* `user_id` (INT FK to users)
* `file_path` (VARCHAR) - Local path to file
* `upload_date` (TIMESTAMP)
* `extracted_summary` (TEXT)
* `deficiencies` (TEXT)

### `recovery_plans`
* `id` (SERIAL PRIMARY KEY)
* `user_id` (INT FK to users)
* `report_id` (INT FK to reports)
* `plan_date` (DATE)
* `meal_plan` (JSONB)
* `exercise_plan` (JSONB)
* `created_at` (TIMESTAMP)

### `feedback`
* `id` (SERIAL PRIMARY KEY)
* `user_id` (INT FK to users)
* `feedback_date` (DATE)
* `compliance_score` (INT) - 0 to 100
* `feeling_score` (INT) - 1 to 10
* `notes` (TEXT)
* `created_at` (TIMESTAMP)

### `progress`
* `id` (SERIAL PRIMARY KEY)
* `user_id` (INT FK to users)
* `weekly_summary` (TEXT)
* `improvement_score` (INT)
* `created_at` (TIMESTAMP)

## 5. Agent Instructions (Rules for Execution)
* **Strict Rule:** No explanations or markdown fluff. Just output the requested code or commands.
* **Optimize context:** Use minimal tokens. Complete the given task immediately.
* **Database First:** Assume PostgreSQL is running locally. Use JSONB for plan data.
* **Local Files:** Do not configure AWS S3. Use local file system for uploads.