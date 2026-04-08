const bcrypt = require('bcryptjs');
const pool = require('../db');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDb(maxRetries = 20, delayMs = 3000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await pool.execute('SELECT 1');
      return;
    } catch (err) {
      console.log(`[INIT] waiting for database... (${i}/${maxRetries})`);
      await sleep(delayMs);
    }
  }
  throw new Error('database not ready after retries');
}

async function initDefaultUser() {
  try {
    await waitForDb();
    const [tableRows] = await pool.execute("SHOW TABLES LIKE 'users'");
    if (!tableRows.length) {
      console.log('[INIT] users table not found, skip default user init');
      return;
    }

    const username = process.env.DEFAULT_ADMIN_USER || 'admin';
    const password = process.env.DEFAULT_ADMIN_PASS || '123456';
    const [rows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (rows.length > 0) {
      console.log('[INIT] default user already exists');
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    await pool.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    console.log(`[INIT] default user created: ${username}`);
  } catch (err) {
    console.error('[INIT] init user failed:', err.message);
  }
}

module.exports = initDefaultUser;
