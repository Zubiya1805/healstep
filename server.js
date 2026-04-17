const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('./db');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Gemini Client ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Multer Config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// --- Gemini Helpers ---

/**
 * Reads a file from disk and converts it to a Gemini-compatible inlinePart.
 */
function fileToInlinePart(filePath) {
  const mimeMap = {
    '.pdf':  'application/pdf',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.webp': 'image/webp',
  };
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath).toString('base64');
  return { inlineData: { data, mimeType } };
}

/**
 * Calls Gemini to extract a medical summary and deficiencies from a report file.
 * Returns { extracted_summary, deficiencies }
 */
async function analyzeReport(filePath) {
  const filePart = fileToInlinePart(filePath);
  const prompt = `You are a clinical AI assistant. Analyze the attached medical report.
Return ONLY a raw JSON object (no markdown, no code fences) with exactly these two keys:
{
  "extracted_summary": "<concise 2-4 sentence summary of the patient's condition and surgery outcome>",
  "deficiencies": "<comma-separated list of identified nutritional or physical deficiencies, or 'none'>"
}`;

  const result = await geminiModel.generateContent([prompt, filePart]);
  const text = result.response.text().trim();
  // Strip accidental markdown fences if present
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

/**
 * Calls Gemini to generate a daily recovery plan based on user profile + report summary.
 * Returns { meal_plan, exercise_plan }
 */
async function generateRecoveryPlan(user, report) {
  const prompt = `You are a post-operative recovery specialist AI.
Patient profile:
- Name: ${user.name}, Age: ${user.age}, Weight: ${user.weight} kg
- Surgery type: ${user.surgery_type}
- Discharge date: ${user.discharge_date}
- Medical summary: ${report.extracted_summary}
- Deficiencies: ${report.deficiencies}

Generate a personalized daily recovery plan for today.
Return ONLY a raw JSON object (no markdown, no code fences) with exactly these two keys:
{
  "meal_plan": {
    "breakfast": "<description>",
    "mid_morning_snack": "<description>",
    "lunch": "<description>",
    "evening_snack": "<description>",
    "dinner": "<description>",
    "hydration": "<water and fluids target>"
  },
  "exercise_plan": [
    { "name": "<exercise name>", "duration_minutes": <number>, "intensity": "<low|moderate|high>", "instructions": "<brief instructions>" }
  ]
}`;

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text().trim();
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

/**
 * Calls Gemini to adapt tomorrow's plan based on today's feedback.
 * Returns { meal_plan, exercise_plan }
 */
async function adaptPlan(user, currentPlan, feedback) {
  const prompt = `You are a post-operative recovery specialist AI.
Patient: ${user.name}, Surgery: ${user.surgery_type}

Today's plan:
${JSON.stringify(currentPlan, null, 2)}

End-of-day feedback:
- Compliance score: ${feedback.compliance_score}/100
- Feeling score: ${feedback.feeling_score}/10
- Notes: ${feedback.notes || 'none'}

Adapt the plan for tomorrow considering the feedback. If compliance is low, simplify exercises. If feeling score is low, reduce intensity and add recovery foods.
Return ONLY a raw JSON object (no markdown, no code fences) with exactly these two keys:
{
  "meal_plan": { "breakfast": "", "mid_morning_snack": "", "lunch": "", "evening_snack": "", "dinner": "", "hydration": "" },
  "exercise_plan": [ { "name": "", "duration_minutes": 0, "intensity": "", "instructions": "" } ]
}`;

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text().trim();
  const clean = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

// ==========================================
//  USERS
// ==========================================

// POST /api/users/register
app.post('/api/users/register', async (req, res) => {
  const { name, age, weight, surgery_type, discharge_date, email, password } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (name, age, weight, surgery_type, discharge_date, email, password, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [name, age, weight, surgery_type, discharge_date, email, password]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id
app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
//  REPORTS
// ==========================================

// POST /api/reports/upload
// Uploads the file, immediately calls Gemini to analyze it, stores summary in DB.
app.post('/api/reports/upload', upload.single('report'), async (req, res) => {
  const { user_id } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const file_path = req.file.path.replace(/\\/g, '/');

  try {
    // 1. Insert report record
    const reportResult = await pool.query(
      `INSERT INTO reports (user_id, file_path, upload_date)
       VALUES ($1, $2, NOW()) RETURNING *`,
      [user_id, file_path]
    );
    const report = reportResult.rows[0];

    // 2. Analyze with Gemini
    const { extracted_summary, deficiencies } = await analyzeReport(file_path);

    // 3. Save summary back to DB
    const updatedReport = await pool.query(
      `UPDATE reports SET extracted_summary = $1, deficiencies = $2
       WHERE id = $3 RETURNING *`,
      [extracted_summary, deficiencies, report.id]
    );

    res.status(201).json(updatedReport.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reports/:id/summary  — manual override
app.patch('/api/reports/:id/summary', async (req, res) => {
  const { extracted_summary, deficiencies } = req.body;
  try {
    const result = await pool.query(
      `UPDATE reports SET extracted_summary = $1, deficiencies = $2
       WHERE id = $3 RETURNING *`,
      [extracted_summary, deficiencies, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/user/:user_id
app.get('/api/reports/user/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reports WHERE user_id = $1 ORDER BY upload_date DESC',
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
//  RECOVERY PLANS
// ==========================================

// POST /api/plans/generate
// Calls Gemini to generate a plan from user profile + latest report, saves to DB.
app.post('/api/plans/generate', async (req, res) => {
  const { user_id, report_id, plan_date } = req.body;
  try {
    const userResult   = await pool.query('SELECT * FROM users   WHERE id = $1', [user_id]);
    const reportResult = await pool.query('SELECT * FROM reports WHERE id = $1', [report_id]);

    if (!userResult.rows.length)   return res.status(404).json({ error: 'User not found' });
    if (!reportResult.rows.length) return res.status(404).json({ error: 'Report not found' });

    const { meal_plan, exercise_plan } = await generateRecoveryPlan(
      userResult.rows[0],
      reportResult.rows[0]
    );

    const date = plan_date || new Date().toISOString().split('T')[0];
    const planResult = await pool.query(
      `INSERT INTO recovery_plans (user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [user_id, report_id, date, JSON.stringify(meal_plan), JSON.stringify(exercise_plan)]
    );

    res.status(201).json(planResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/plans  — manual save (pre-built plan)
app.post('/api/plans', async (req, res) => {
  const { user_id, report_id, plan_date, meal_plan, exercise_plan } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO recovery_plans (user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [user_id, report_id, plan_date, JSON.stringify(meal_plan), JSON.stringify(exercise_plan)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/plans/user/:user_id/today
app.get('/api/plans/user/:user_id/today', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM recovery_plans
       WHERE user_id = $1 AND plan_date = CURRENT_DATE
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.user_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No plan for today' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/plans/user/:user_id
app.get('/api/plans/user/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM recovery_plans WHERE user_id = $1 ORDER BY plan_date DESC',
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
//  FEEDBACK
// ==========================================

// POST /api/feedback
// Saves feedback, then calls Gemini to adapt tomorrow's plan automatically.
app.post('/api/feedback', async (req, res) => {
  const { user_id, feedback_date, compliance_score, feeling_score, notes } = req.body;
  try {
    // 1. Save feedback
    const fbResult = await pool.query(
      `INSERT INTO feedback (user_id, feedback_date, compliance_score, feeling_score, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [user_id, feedback_date, compliance_score, feeling_score, notes]
    );
    const feedback = fbResult.rows[0];

    // 2. Fetch user + today's plan
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    const planResult = await pool.query(
      `SELECT * FROM recovery_plans WHERE user_id = $1 AND plan_date = CURRENT_DATE
       ORDER BY created_at DESC LIMIT 1`,
      [user_id]
    );

    let adaptedPlan = null;
    if (userResult.rows.length && planResult.rows.length) {
      const { meal_plan, exercise_plan } = await adaptPlan(
        userResult.rows[0],
        planResult.rows[0],
        feedback
      );

      // 3. Save adapted plan for tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];

      const newPlan = await pool.query(
        `INSERT INTO recovery_plans (user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [user_id, planResult.rows[0].report_id, tomorrowDate,
         JSON.stringify(meal_plan), JSON.stringify(exercise_plan)]
      );
      adaptedPlan = newPlan.rows[0];
    }

    res.status(201).json({ feedback, adapted_plan_for_tomorrow: adaptedPlan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/user/:user_id
app.get('/api/feedback/user/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM feedback WHERE user_id = $1 ORDER BY feedback_date DESC',
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/user/:user_id/latest
app.get('/api/feedback/user/:user_id/latest', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.user_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No feedback found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
//  PROGRESS
// ==========================================

// POST /api/progress
app.post('/api/progress', async (req, res) => {
  const { user_id, weekly_summary, improvement_score } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO progress (user_id, weekly_summary, improvement_score, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [user_id, weekly_summary, improvement_score]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/progress/user/:user_id
app.get('/api/progress/user/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM progress WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
//  HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ==========================================
//  START
// ==========================================
app.listen(PORT, () => console.log(`RecoverRight server running on port ${PORT}`));
