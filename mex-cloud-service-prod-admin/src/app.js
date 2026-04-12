
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const auth = require('./auth');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

app.get('/health', (req, res) => res.json({ code: 0, message: 'ok' }));

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    if (!rows.length) return res.json({ code: 1, message: 'user not found' });

    const user = rows[0];
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.json({ code: 1, message: 'wrong password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.json({ code: 0, message: 'ok', data: { token, username: user.username } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/upload/batch', async (req, res) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    const taskId = String(Date.now());

    let inserted = 0;
    const seen = new Set();

    for (const item of records) {
      const key = item && item.recordKey ? item.recordKey : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      const sender = item && (item.sender || item.from || item.senderName) ? (item.sender || item.from || item.senderName) : '';
      await pool.execute(
        'INSERT INTO upload_records(task_id, record_key, sender, content_json, is_read) VALUES (?,?,?,?,0)',
        [taskId, key, sender, JSON.stringify(item || {})]
      );
      inserted += 1;
    }

    res.json({ code: 0, message: 'ok', data: { taskId, batchCount: inserted } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = (page - 1) * pageSize;

    let whereSql = ' WHERE 1=1 ';
    const params = [];

    if (req.query.startTime) {
      whereSql += ' AND created_at >= ?';
      params.push(req.query.startTime);
    }
    if (req.query.endTime) {
      whereSql += ' AND created_at <= ?';
      params.push(req.query.endTime);
    }
    if (req.query.sender) {
      whereSql += ' AND sender LIKE ?';
      params.push(`%${req.query.sender}%`);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM upload_records ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [unreadRows] = await pool.execute(
      'SELECT COUNT(*) AS unreadTotal FROM upload_records WHERE is_read = 0'
    );
    const unreadTotal = unreadRows[0]?.unreadTotal || 0;

    const [rows] = await pool.execute(
      `SELECT id, task_id, record_key, sender, content_json, created_at, is_read
       FROM upload_records
       ${whereSql}
       ORDER BY id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const list = rows.map(item => ({
      id: item.id,
      taskId: item.task_id,
      recordKey: item.record_key,
      sender: item.sender || '',
      contentJson: typeof item.content_json === 'string' ? JSON.parse(item.content_json) : item.content_json,
      createdAt: item.created_at,
      isRead: !!item.is_read
    }));

    res.json({
      code: 0,
      message: 'ok',
      data: {
        list,
        unreadTotal,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize))
        }
      }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.get('/api/messages/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, task_id, record_key, sender, content_json, created_at, is_read FROM upload_records WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ code: 1, message: 'not found' });

    const item = rows[0];
    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: item.id,
        taskId: item.task_id,
        recordKey: item.record_key,
        sender: item.sender || '',
        contentJson: typeof item.content_json === 'string' ? JSON.parse(item.content_json) : item.content_json,
        createdAt: item.created_at,
        isRead: !!item.is_read
      }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/messages/read', auth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v => parseInt(v, 10)).filter(Boolean) : [];
    if (!ids.length) return res.json({ code: 1, message: 'ids is empty' });
    const placeholders = ids.map(() => '?').join(',');
    await pool.execute(`UPDATE upload_records SET is_read = 1 WHERE id IN (${placeholders})`, ids);
    res.json({ code: 0, message: 'ok', data: { updated: ids.length } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/messages/read-all', auth, async (req, res) => {
  try {
    const [result] = await pool.execute('UPDATE upload_records SET is_read = 1 WHERE is_read = 0');
    res.json({ code: 0, message: 'ok', data: { updated: result.affectedRows || 0 } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.delete('/api/messages', auth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v => parseInt(v, 10)).filter(Boolean) : [];
    if (!ids.length) return res.json({ code: 1, message: 'ids is empty' });
    const placeholders = ids.map(() => '?').join(',');
    await pool.execute(`DELETE FROM upload_records WHERE id IN (${placeholders})`, ids);
    res.json({ code: 0, message: 'ok', data: { deleted: ids.length } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.delete('/api/messages/clear', auth, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM upload_records');
    res.json({ code: 0, message: 'ok', data: { deleted: result.affectedRows || 0 } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

module.exports = app;
