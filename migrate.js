const pool = require('./db');

const sql = `
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
    ADD COLUMN IF NOT EXISTS disease VARCHAR(255),
    ADD COLUMN IF NOT EXISTS treatment_type VARCHAR(255),
    ADD COLUMN IF NOT EXISTS admission_date DATE;
`;

pool.query(sql)
  .then(() => { console.log('Migration done: gender, disease, treatment_type, admission_date added.'); process.exit(0); })
  .catch(e => { console.error('Migration error:', e.message); process.exit(1); });
