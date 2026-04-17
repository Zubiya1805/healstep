const pool = require('./db');
pool.query(`
CREATE TABLE IF NOT EXISTS daily_progress (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  date DATE DEFAULT CURRENT_DATE,
  completed_diet_items JSONB,
  completed_exercise_items JSONB,
  health_status VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
`).then(() => { console.log('daily_progress table created'); process.exit(0); });
