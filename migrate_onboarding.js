// Migration: add recovery_conditions (JSONB), secondary_conditions (JSONB),
// and food_preference (VARCHAR) columns to users table for onboarding flow.
const pool = require('./db');

const sql = `
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS recovery_conditions  JSONB,
    ADD COLUMN IF NOT EXISTS secondary_conditions JSONB,
    ADD COLUMN IF NOT EXISTS food_preference      VARCHAR(100);
`;

pool.query(sql)
  .then(() => {
    console.log('Migration done: recovery_conditions, secondary_conditions, food_preference added to users.');
    process.exit(0);
  })
  .catch(e => {
    console.error('Migration error:', e.message);
    process.exit(1);
  });
