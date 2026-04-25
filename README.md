# 🩺 HealStep – AI-Powered Recovery & Health Tracking System

## 🚀 Overview

**HealStep** is a smart healthcare platform designed to assist patients in their recovery journey after surgery or during ongoing health conditions. It combines report analysis, structured onboarding, and daily progress tracking to provide a guided and personalized recovery experience.

---

## 🎯 Problem Statement

Recovery after surgery is often unstructured:

* Patients don’t understand medical data clearly
* No personalized recovery guidance
* No system to track daily health progress
* Important routines and follow-ups are missed

---

## 💡 Solution

HealStep provides:

* 📄 Structured health data onboarding
* 📊 Daily progress tracking system
* 🧠 Smart backend logic for recovery insights
* 🗂️ Organized data storage for reports and user inputs

---

## ✨ Key Features

### 📋 User Onboarding System

* Collects patient details and health data
* Structured onboarding workflow

### 📊 Daily Progress Tracking

* Tracks recovery metrics day-by-day
* Helps monitor improvement trends

### 🗂️ Report & File Upload System

* Upload and manage health-related files
* Stored securely in the system

### 🧠 Data Processing & Migration

* Handles structured data updates
* Migration scripts for onboarding and progress

### 🔐 Backend-Driven Logic

* Server-side handling using Node.js
* Database integration for persistent data

---

## 🛠️ Tech Stack

* **Frontend:** HTML, CSS, JavaScript (in `/public`)
* **Backend:** Node.js (Express-based server)
* **Database:** (Configured via `db.js`)
* **File Handling:** Upload system (`/uploads`)
* **Version Control:** Git & GitHub

---

## 📁 Project Structure

```bash
healstep/
│── docs/                     # Documentation files
│── public/                   # Frontend (HTML, CSS, UI)
│── uploads/                  # Uploaded files storage
│── node_modules/             # Dependencies (ignored in production)
│
│── server.js                 # Main backend server
│── db.js                     # Database configuration
│── init_db.js                # Initial database setup
│
│── migrate.js                # General migration script
│── migrate_onboarding.js     # Onboarding data migration
│── migrate_daily_progress.js # Daily progress migration
│
│── package.json              # Project dependencies & scripts
│── package-lock.json         # Dependency lock file
│── .gitignore                # Ignored files
```

---

## ⚙️ Setup Instructions

### 1️⃣ Clone the repository

```bash
git clone https://github.com/Zubiya1805/healstep.git
cd healstep
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Initialize database (if required)

```bash
node init_db.js
```

### 4️⃣ Run the server

```bash
node server.js
```

---

## 🔄 Data Migration Scripts

Run these when needed:

```bash
node migrate.js
node migrate_onboarding.js
node migrate_daily_progress.js
```

---

## 🌐 Future Enhancements

* 🤖 AI-based medical report analysis
* 📱 Mobile-friendly interface
* 📊 Advanced analytics dashboard
* 🧑‍⚕️ Doctor integration system
* 🔔 Smart notifications & reminders

---

## 👩‍💻 Author

* Sakshi Dubey

---

## 📌 Notes

* `node_modules/` should ideally not be pushed (use `.gitignore`)
* Ensure environment variables are configured if database requires

---

## 💙 Vision

To simplify recovery by combining **data tracking, structured guidance, and intelligent insights** into one platform.

---
