const pool = require('./db');

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  age INT,
  weight DECIMAL,
  surgery_type VARCHAR(255),
  discharge_date DATE,
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  created_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  file_path VARCHAR(500),
  upload_date TIMESTAMP,
  extracted_summary TEXT,
  deficiencies TEXT
);
CREATE TABLE IF NOT EXISTS recovery_plans (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  report_id INT REFERENCES reports(id),
  plan_date DATE,
  meal_plan JSONB,
  exercise_plan JSONB,
  created_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  feedback_date DATE,
  compliance_score INT CHECK (compliance_score BETWEEN 0 AND 100),
  feeling_score INT CHECK (feeling_score BETWEEN 1 AND 10),
  notes TEXT,
  created_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS progress (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  weekly_summary TEXT,
  improvement_score INT,
  created_at TIMESTAMP
);
`;

pool.query(sql)
  .then(() => { console.log('All tables created.'); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
