const path = require('path');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const pool = require('./db');
const OpenAI = require('openai').default;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- OpenRouter Client (OpenAI-compatible) ---
const ai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:5000',
    'X-Title': 'RecoverRight',
  },
});
// Primary model → fallback in order
const OR_MODEL = 'google/gemini-2.0-flash-exp:free';
const OR_MODEL_AUTO = 'openrouter/auto';

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// --- Multer Config (ensure uploads/ exists) ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ok = /pdf|jpeg|jpg|png|webp/.test(file.mimetype);
    cb(ok ? null : new Error('Only PDF/image files allowed'), ok);
  },
});

// --- AI Helpers (OpenRouter) ---

// aiCall: two-layer resilience
//   Layer 1 — model fallback: if primary model is rejected (404 / invalid model),
//             retry the exact same payload with openrouter/auto
//   Layer 2 — rate-limit retry: on 429 wait the stated delay then retry once
async function aiCall(buildMessages) {
  const models = [OR_MODEL, OR_MODEL_AUTO];
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const attempt = async () => ai.chat.completions.create({
      model,
      ...buildMessages(),           // messages (and any other params) injected here
    });
    try {
      const result = await attempt();
      if (i > 0) console.log(`[openrouter] fell back to ${model}`);
      return result;
    } catch (err) {
      const status = err?.status ?? err?.response?.status ?? 0;
      const msg = (err?.message ?? '').toLowerCase();

      // 429 rate-limit — wait then retry same model
      if (status === 429 || msg.includes('429') || msg.includes('rate limit')) {
        const raw = err?.message ?? '';
        const match = raw.match(/(\d+(?:\.\d+)?)\s*s/) ?? raw.match(/"retrydelay"\s*:\s*"(\d+)/i);
        const wait = Math.min(parseFloat(match?.[1] ?? '30'), 60) * 1000;
        console.log(`[openrouter] 429 on ${model} — retrying in ${wait / 1000}s…`);
        await new Promise(r => setTimeout(r, wait));
        try { return await attempt(); } catch (retryErr) { err = retryErr; }
      }

      // Model-not-found / invalid-model — try next model in list
      const isModelErr = status === 404 || msg.includes('model') || msg.includes('not found') || msg.includes('invalid');
      if (isModelErr && i < models.length - 1) {
        console.log(`[openrouter] model ${model} rejected — trying ${models[i + 1]}`);
        continue;
      }

      throw err;  // unrecoverable
    }
  }
}

// Parse retryDelay from OpenRouter error
function extractText(completion) {
  return completion.choices[0].message.content.trim();
}

function cleanAndParseJSON(raw) {
  try {
    const firstBrace = raw.indexOf('{');
    const firstBracket = raw.indexOf('[');

    let isObject = false;
    let isArray = false;

    if (firstBrace !== -1 && firstBracket !== -1) {
      if (firstBrace < firstBracket) isObject = true;
      else isArray = true;
    } else if (firstBrace !== -1) {
      isObject = true;
    } else if (firstBracket !== -1) {
      isArray = true;
    }

    let firstIdx = -1;
    let lastIdx = -1;

    if (isObject) {
      firstIdx = firstBrace;
      lastIdx = raw.lastIndexOf('}');
    } else if (isArray) {
      firstIdx = firstBracket;
      lastIdx = raw.lastIndexOf(']');
    }

    let jsonStr = raw;
    if (firstIdx !== -1 && lastIdx !== -1 && lastIdx >= firstIdx) {
      jsonStr = raw.substring(firstIdx, lastIdx + 1);
    }

    return JSON.parse(jsonStr);
  } catch (error) {
    throw new Error('Failed to parse AI response as JSON.');
  }
}

// Encode file as base64 data-URI for vision models
function fileToDataURI(filePath) {
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  const b64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

async function analyzeAndGeneratePlan(filePath, user, previousReportText) {
  const dataURI = fileToDataURI(filePath);

  let promptText = '';
  if (previousReportText) {
    promptText = `You are a medical recovery expert. Analyze this new medical report image and compare it with the previous findings provided here: [${previousReportText}].`;
  } else {
    promptText = `You are a medical recovery expert. Analyze this medical report image.`;
  }

  // Instruction set for Analysis and Indian Diet
  if (previousReportText) {
    promptText = `You are a medical recovery expert. Analyze this new medical report image and compare it with: [${previousReportText}].`;
  } else {
    promptText = `You are a medical recovery expert. Analyze this medical report image.`;
  }

  promptText += `
## THE UNIVERSAL UNDERSTANDING RULE (MANDATORY)
You are speaking to someone with NO medical knowledge. 
- You MUST follow every medical term or clinical marker (like Hemoglobin, Platelets, LDL, etc.) with a simple, 10-15 word explanation in brackets.
- The explanation must tell the user WHAT it is and WHY it matters.
- Example: "Your Platelet Count [the tiny cells that help your blood clot to stop bleeding; if these are low, you might bruise easily or bleed for longer] is borderline."

## YOUR TASK
1. **Simplified Summary**: Provide a short, structured breakdown of findings using the Universal Understanding Rule.
2. **Comparison**: State if markers are improving or worsening based on previous data.
3. **Indian Diet**: Suggest a full-day Indian meal plan tailored to these specific markers.

## JSON STRUCTURE (STRICT COMPLIANCE)
Return ONLY valid JSON. Use this EXACT structure:

{
  "simple_summary": "1. Identify the main issue. 2. List the key markers. EVERY marker MUST include the [Detailed simple explanation in brackets].",
  "comparison": "<Clear progress statement or null>",
  "recovery_plan": {
    "diet": {
      "morning": [
        {"time": "08:30 AM", "title": "Main Option (e.g., Poha)", "desc": "Benefit.", "alternate": "If you don't have Poha, you can eat [Alternate Name]", "tags": ["Iron Rich"]}
      ],
      "afternoon": [
        {"time": "01:30 PM", "title": "Main Option (e.g., Dal Roti)", "desc": "Benefit.", "alternate": "If not Dal Roti, try [Alternate Name]", "tags": ["High Protein"]}
      ],
      "evening": [
        {"time": "08:00 PM", "title": "Main Option (e.g., Khichdi)", "desc": "Benefit.", "alternate": "If not Khichdi, you can have [Alternate Name]", "tags": ["Light Meal"]}
      ]
    },
    "exercises": [
      {
        "title": "Specific Name (e.g., Bhujangasana / Neck Rotations)",
        "pose_type": "Category (e.g., Standing, Seated, Lying Down, Inversion)",
        "movement_type": "Style (e.g., Static Hold, Dynamic Movement, Breathing Control)",
        "what_it_is": "A simple explanation of the exercise.",
        "steps": "Clear, numbered steps on how to perform it.",
        "benefit": "How it helps your specific markers.",
        "timing": "Best time (e.g., Morning)",
        "schedule": "e.g., 3 rounds / 20 seconds",
        "note": "Safety tip."
      }
    ],
    "precautions": ["Simple precaution 1", "Simple precaution 2"]
  }
}

## YOGA & STRETCHING RULES:
1. **SPECIFIC NAMES**: When suggesting Yoga or Stretching, do NOT use generic titles like "Yoga". You MUST use the specific name of the pose (e.g., Bhujangasana, Pranayama, Neck Rotations).
2. **DETAILED PERFORMANCE**: In the "steps" field, provide exact physical instructions so the user knows where to put their hands, how to breathe, and how to hold the pose.
3. **HOUSEHOLD FRIENDLY**: Ensure all stretches and yoga poses can be done easily at home without any special gym equipment.

## VARIETY & ALTERNATE RULES:
1. **DAILY VARIETY**: If the patient asks for a plan daily, you MUST suggest different Indian meals each time to avoid boredom. Do not repeat the same breakfast/lunch/dinner daily.
2. **MANDATORY ALTERNATES**: For every meal suggested, you MUST provide a common Indian alternative in the "alternate" field. This helps the user if they don't have the main ingredient at home.
3. **HOUSEHOLD AVAILABILITY**: All meals and alternates must be common items found in an average Indian kitchen.

## STYLE GUIDE:
- Format: Short, structured, and easy to scan at a glance.
- Diet: Specifically Indian household meals.
- Forbidden: Never list a medical term without its [bracketed meaning].";
## STYLE & BRACKET RULES:
- TONE: Like a helpful peer explaining things clearly.
- NO JARGON ALONE: Every complex term (Platelets, WBC, LDL, etc.) MUST have a [simple, larger explanation] in brackets.
- DIET: Must focus on Indian meals (Vegetarian/Non-Vegetarian) easily found at home.
- FORMAT: Short, structured, and easy to read at a glance.";

## STYLE & BRACKET RULES:
- REQUIRED DETAIL: Bracketed explanations must explain NOT ONLY what the marker is, but why it matters for health.
- Example: Hemoglobin [the protein that carries oxygen; low levels mean your body parts aren't getting enough air, making you feel tired].
- Diet Style: Recommendations must be specific to common Indian household meals and in native language they pronounce names.
- Output: Valid JSON only. No extra text.";

## QUANTITY REQUIREMENTS:
- morning: 2-3 items
- afternoon: 2 items
- evening: 2 items
- exercises: 3-5 items
- precautions: 2-4 items

## STYLE GUIDELINES:
- Food: All  food recommendations must be common veg/nonveg choosen by the  person and the food schedule should be easy to follow and commonly indian household eats and the foods name must be that idians mostly use not in native language.
- Exercises: Use common names that an Indian person would easily recognize and understand.
- Language: Friendly, encouraging, and extremely simple.`;

  const completion = await aiCall(() => ({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: dataURI } },
      ],
    }],
  }));

  return cleanAndParseJSON(extractText(completion));
}

async function adaptPlan(user, currentPlan, feedback) {
  const prompt = `You are a post - operative recovery specialist AI.
    Patient: ${user.name}, Surgery: ${user.surgery_type}

Today's plan:
${JSON.stringify(currentPlan, null, 2)}

  End - of - day feedback:
  - Compliance score: ${feedback.compliance_score}/100
    - Feeling score: ${feedback.feeling_score}/10
      - Notes: ${feedback.notes || 'none'}

Adapt the plan for tomorrow considering the feedback.If compliance is low, simplify exercises.If feeling score is low, reduce intensity and add recovery foods.
Return ONLY a raw JSON object(no markdown, no code fences) with exactly these two keys:
  {
    "meal_plan": { "breakfast": "", "mid_morning_snack": "", "lunch": "", "evening_snack": "", "dinner": "", "hydration": "" },
    "exercise_plan": [{ "name": "", "duration_minutes": 0, "intensity": "", "instructions": "" }]
  } `;
  const completion = await aiCall(() => ({
    messages: [{ role: 'user', content: prompt }],
  }));
  return cleanAndParseJSON(extractText(completion));
}

// ==========================================
//  HOMEPAGE
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
//  AUTH
// ==========================================

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { name, email, password, gender, age } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, and password are required.' });
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users(name, email, gender, age, password, created_at)
  VALUES($1, $2, $3, $4, $5, NOW()) RETURNING id, name, email`,
      [name, email, gender || null, age || null, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ user_id: user.id, name: user.name, email: user.email });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
    console.error('[register]', err.message);
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    res.json({ user_id: user.id, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// ==========================================
//  USERS
// ==========================================

// POST /api/users/register
app.post('/api/users/register', async (req, res) => {
  const { name, age, weight, surgery_type, discharge_date, email, password } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users(name, age, weight, surgery_type, discharge_date, email, password, created_at)
  VALUES($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING * `,
      [name, age, weight, surgery_type, discharge_date, email, password]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// GET /api/users/:id
app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// PUT /api/users/:id/onboarding — save medical + onboarding details
app.put('/api/users/:id/onboarding', async (req, res) => {
  const {
    // existing medical fields
    disease, treatment_type, admission_date, discharge_date,
    // new onboarding fields
    recovery_conditions, secondary_conditions, food_preference,
  } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users
       SET disease = COALESCE($1, disease),
    treatment_type = COALESCE($2, treatment_type),
    admission_date = COALESCE($3, admission_date),
    discharge_date = COALESCE($4, discharge_date),
    recovery_conditions = COALESCE($5, recovery_conditions),
    secondary_conditions = COALESCE($6, secondary_conditions),
    food_preference = COALESCE($7, food_preference)
       WHERE id = $8
       RETURNING id, name, email, gender, age, disease, treatment_type,
    admission_date, discharge_date,
    recovery_conditions, secondary_conditions, food_preference`,
      [
        disease || null,
        treatment_type || null,
        admission_date || null,
        discharge_date || null,
        recovery_conditions ? JSON.stringify(recovery_conditions) : null,
        secondary_conditions ? JSON.stringify(secondary_conditions) : null,
        food_preference || null,
        req.params.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[onboarding]', err.message);
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// ==========================================
//  REPORTS
// ==========================================

// POST /api/reports/upload  — full pipeline: analyze → plan → save
app.post('/api/reports/upload', upload.single('report'), async (req, res) => {
  const { user_id } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

  const file_path = req.file.path.replace(/\\/g, '/');

  try {
    // 1. Fetch user profile
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found.' });
    const user = userResult.rows[0];

    // 2. Fetch previous report history
    const prevReportResult = await pool.query(
      'SELECT extracted_summary FROM reports WHERE user_id = $1 ORDER BY upload_date DESC LIMIT 1',
      [user_id]
    );
    const previousReportText = prevReportResult.rows.length > 0 ? prevReportResult.rows[0].extracted_summary : null;

    // 3. AI Analysis and Plan Generation
    const aiResult = await analyzeAndGeneratePlan(file_path, user, previousReportText);

    let finalSummary = aiResult.simple_summary;
    if (aiResult.comparison) {
      finalSummary += '\n\nComparison: ' + aiResult.comparison;
    }

    // 4. Save report to DB
    const reportInsert = await pool.query(
      `INSERT INTO reports(user_id, file_path, upload_date, extracted_summary)
  VALUES($1, $2, NOW(), $3) RETURNING * `,
      [user_id, file_path, finalSummary]
    );
    const finalReport = reportInsert.rows[0];

    // 5. Save recovery plan
    const today = new Date().toISOString().split('T')[0];
    // Extract diet — new format is an object {morning, afternoon, evening}, old format was an array
    const rawDiet = aiResult?.recovery_plan?.diet;
    const dietPayload = (rawDiet && !Array.isArray(rawDiet))
      ? rawDiet  // new granular object
      : { morning: [], afternoon: [], evening: [], _legacy: rawDiet || aiResult?.meal_plan || ['General healthy diet'] };
    // Extract exercises — new format is an array of objects {title, duration, note}
    const exercisesPayload = aiResult?.recovery_plan?.exercises || aiResult?.recovery_plan?.exercise || aiResult?.exercise_plan || ['Light walking'];
    const precautionsPayload = aiResult?.recovery_plan?.precautions || [];
    const planInsert = await pool.query(
      `INSERT INTO recovery_plans(user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
  VALUES($1, $2, $3, $4, $5, NOW()) RETURNING * `,
      [
        user_id,
        finalReport.id,
        today,
        JSON.stringify(dietPayload),
        JSON.stringify({ exercises: exercisesPayload, precautions: precautionsPayload })
      ]
    );

    res.status(201).json({
      report: finalReport,
      plan: planInsert.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// PATCH /api/reports/:id/summary
app.patch('/api/reports/:id/summary', async (req, res) => {
  const { extracted_summary, deficiencies } = req.body;
  try {
    const result = await pool.query(
      `UPDATE reports SET extracted_summary = $1, deficiencies = $2
       WHERE id = $3 RETURNING * `,
      [extracted_summary, deficiencies, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
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
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// ==========================================
//  RECOVERY PLANS
// ==========================================

// POST /api/plans/generate
app.post('/api/plans/generate', async (req, res) => {
  const { user_id, report_id, plan_date } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users   WHERE id = $1', [user_id]);
    const reportResult = await pool.query('SELECT * FROM reports WHERE id = $1', [report_id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    if (!reportResult.rows.length) return res.status(404).json({ error: 'Report not found' });

    const prevReportResult = await pool.query(
      'SELECT extracted_summary FROM reports WHERE user_id = $1 AND id != $2 ORDER BY upload_date DESC LIMIT 1',
      [user_id, report_id]
    );
    const previousReportText = prevReportResult.rows.length > 0 ? prevReportResult.rows[0].extracted_summary : null;

    const aiResult = await analyzeAndGeneratePlan(
      reportResult.rows[0].file_path,
      userResult.rows[0],
      previousReportText
    );
    const date = plan_date || new Date().toISOString().split('T')[0];
    // Extract diet — new format is an object {morning, afternoon, evening}, old format was an array
    const rawDiet2 = aiResult?.recovery_plan?.diet;
    const dietPayload2 = (rawDiet2 && !Array.isArray(rawDiet2))
      ? rawDiet2
      : { morning: [], afternoon: [], evening: [], _legacy: rawDiet2 || aiResult?.meal_plan || ['General healthy diet'] };
    const exercisesPayload2 = aiResult?.recovery_plan?.exercises || aiResult?.recovery_plan?.exercise || aiResult?.exercise_plan || ['Light walking'];
    const precautionsPayload2 = aiResult?.recovery_plan?.precautions || [];
    const planResult = await pool.query(
      `INSERT INTO recovery_plans(user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
  VALUES($1, $2, $3, $4, $5, NOW()) RETURNING * `,
      [
        user_id,
        report_id,
        date,
        JSON.stringify(dietPayload2),
        JSON.stringify({ exercises: exercisesPayload2, precautions: precautionsPayload2 })
      ]
    );
    res.status(201).json(planResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// POST /api/plans  — manual save
app.post('/api/plans', async (req, res) => {
  const { user_id, report_id, plan_date, meal_plan, exercise_plan } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO recovery_plans(user_id, report_id, plan_date, meal_plan, exercise_plan, created_at)
  VALUES($1, $2, $3, $4, $5, NOW()) RETURNING * `,
      [user_id, report_id, plan_date, JSON.stringify(meal_plan), JSON.stringify(exercise_plan)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
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
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// GET /api/recovery-plan/:user_id  — latest plan (today first, then most recent)
app.get('/api/recovery-plan/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM recovery_plans
       WHERE user_id = $1
       ORDER BY plan_date DESC, created_at DESC
       LIMIT 1`,
      [req.params.user_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No recovery plan found. Please upload a report first.' });
    const row = result.rows[0];

    const reportResult = await pool.query(
      `SELECT extracted_summary FROM reports WHERE id = $1`,
      [row.report_id]
    );
    const extracted_summary = reportResult.rows.length ? reportResult.rows[0].extracted_summary : null;

    // Ensure meal_plan and exercise_plan are objects (not strings)
    res.json({
      ...row,
      extracted_summary,
      meal_plan: typeof row.meal_plan === 'string' ? JSON.parse(row.meal_plan) : row.meal_plan,
      exercise_plan: typeof row.exercise_plan === 'string' ? JSON.parse(row.exercise_plan) : row.exercise_plan,
    });
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
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
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// ==========================================
//  FEEDBACK & PROGRESS
// ==========================================

// POST /api/feedback
app.post('/api/feedback', async (req, res) => {
  const { user_id, completed_diet_items, completed_exercise_items, health_status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO daily_progress(user_id, completed_diet_items, completed_exercise_items, health_status, created_at)
  VALUES($1, $2, $3, $4, NOW()) RETURNING * `,
      [user_id, JSON.stringify(completed_diet_items || []), JSON.stringify(completed_exercise_items || []), health_status]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// GET /api/progress/:user_id
app.get('/api/progress/:user_id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM daily_progress 
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY date ASC`,
      [req.params.user_id]
    );

    const records = result.rows;
    let completedItems = 0;
    records.forEach(r => {
      const diet = typeof r.completed_diet_items === 'string' ? JSON.parse(r.completed_diet_items) : r.completed_diet_items;
      const ex = typeof r.completed_exercise_items === 'string' ? JSON.parse(r.completed_exercise_items) : r.completed_exercise_items;
      completedItems += (diet ? diet.length : 0) + (ex ? ex.length : 0);
    });

    // Assume 4 tasks per day for 7 days = 28 max tasks. Or just base it on the days they logged.
    const totalPossible = Math.max(records.length * 4, 1);
    const score = Math.min(100, Math.round((completedItems / totalPossible) * 100));

    res.json({ records, score: records.length > 0 ? score : 0 });
  } catch (err) {
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// ==========================================
//  HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- Homepage ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
//  START
// ==========================================
app.listen(PORT, () => console.log(`RecoverRight server running on port ${PORT} `));

// This allows you to access files at http://localhost:PORT/uploads/filename
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));