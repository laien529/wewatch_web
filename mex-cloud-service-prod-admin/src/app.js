
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const auth = require('./auth');
const {
  CONDITION_TYPES,
  evaluateGroups,
  getRecordText,
  normalizeConditionType,
  normalizeMatchMode
} = require('./filterEngine');
const { analyzeCompensations, getLLMStatus, MAX_BATCH_ITEMS, MAX_BATCH_CHARS } = require('./compensationAnalyzer');

const app = express();

function parseMultiValue(input) {
  if (Array.isArray(input)) {
    return input.flatMap(item => String(item).split(',')).map(item => item.trim()).filter(Boolean);
  }
  if (!input) return [];
  return String(input).split(',').map(item => item.trim()).filter(Boolean);
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

async function loadFilterGroups({ enabledOnly = false } = {}) {
  const [groupRows] = await pool.execute(
    `SELECT id, name, match_mode, enabled, created_at, updated_at
     FROM filter_groups
     ${enabledOnly ? 'WHERE enabled = 1' : ''}
     ORDER BY id ASC`
  );
  if (!groupRows.length) return [];

  const groupIds = groupRows.map(group => group.id);
  const placeholders = groupIds.map(() => '?').join(',');
  const [conditionRows] = await pool.execute(
    `SELECT id, group_id, condition_type, condition_value, enabled, sort_order, created_at, updated_at
     FROM filter_conditions
     WHERE group_id IN (${placeholders})
     ORDER BY group_id ASC, sort_order ASC, id ASC`,
    groupIds
  );
  const conditionsByGroup = new Map(groupIds.map(id => [id, []]));
  conditionRows.forEach(condition => {
    conditionsByGroup.get(condition.group_id).push({
      id: condition.id,
      type: condition.condition_type,
      value: condition.condition_type === 'compensation_range'
        ? parseStoredJson(condition.condition_value)
        : condition.condition_value,
      enabled: !!condition.enabled,
      sortOrder: condition.sort_order,
      createdAt: condition.created_at,
      updatedAt: condition.updated_at
    });
  });
  return groupRows.map(group => ({
    id: group.id,
    name: group.name,
    matchMode: group.match_mode,
    enabled: !!group.enabled,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    conditions: conditionsByGroup.get(group.id)
  }));
}

function parseStoredJson(value) {
  try { return JSON.parse(value); } catch (_) { return value; }
}

function parseEnabled(value, fallback = true) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function parseConditionPayload(body = {}) {
  const type = normalizeConditionType(body.type);
  if (!type) return { error: `type must be one of: ${Array.from(CONDITION_TYPES).join(', ')}` };
  if (type === 'compensation_range') {
    const suppliedMin = body.minAmount ?? (body.value && body.value.minAmount);
    const suppliedMax = body.maxAmount ?? (body.value && body.value.maxAmount);
    const minAmount = suppliedMin === undefined || suppliedMin === null || suppliedMin === '' ? null : Number(suppliedMin);
    const maxAmount = suppliedMax === undefined || suppliedMax === null || suppliedMax === '' ? null : Number(suppliedMax);
    if ((minAmount === null && maxAmount === null) ||
      (minAmount !== null && (!Number.isFinite(minAmount) || minAmount < 0)) ||
      (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < 0)) ||
      (minAmount !== null && maxAmount !== null && minAmount > maxAmount)) {
      return { error: 'compensation_range requires a non-negative minAmount or maxAmount; when both are present, minAmount must be <= maxAmount' };
    }
    return {
      type,
      value: JSON.stringify({ minAmount, maxAmount, currency: 'CNY' }),
      enabled: parseEnabled(body.enabled),
      sortOrder: Math.max(Number.parseInt(body.sortOrder || '0', 10) || 0, 0)
    };
  }
  const value = body.value === undefined || body.value === null ? '' : String(body.value).trim();
  if (type !== 'has_url' && !value) return { error: 'value is required for this condition type' };
  if (type === 'regex') {
    try { new RegExp(value, 'i'); } catch (_) { return { error: 'regex value is invalid' }; }
  }
  if (type === 'has_url' && !['1', 'true', 'yes', '0', 'false', 'no'].includes(value.toLowerCase())) {
    return { error: 'has_url value must be true or false' };
  }
  return { type, value, enabled: parseEnabled(body.enabled), sortOrder: Math.max(Number.parseInt(body.sortOrder || '0', 10) || 0, 0) };
}

function compensationBatches(records) {
  const result = [];
  let current = [];
  let currentChars = 0;
  records.forEach(record => {
    const textLength = Math.min(getRecordText(record.item).length, MAX_BATCH_CHARS);
    if (current.length && (current.length >= MAX_BATCH_ITEMS || currentChars + textLength > MAX_BATCH_CHARS)) {
      result.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(record);
    currentChars += textLength;
  });
  if (current.length) result.push(current);
  return result;
}

async function analyzeRecordsCompensation(records, required, onBatchComplete = null) {
  const output = new Map(records.map(record => [record.index, []]));
  if (!required || !records.length) return { offersByIndex: output, batches: 0 };
  let batches = 0;
  for (const batch of compensationBatches(records)) {
    const result = await analyzeCompensations(batch.map(record => ({
      id: String(record.index),
      text: getRecordText(record.item)
    })));
    batch.forEach(record => output.set(record.index, result.get(String(record.index)) || []));
    batches += 1;
    if (onBatchComplete) await onBatchComplete(batches);
  }
  return { offersByIndex: output, batches };
}

async function persistCompensations(connection, recordId, offers) {
  for (const offer of offers) {
    await connection.execute(
      `INSERT INTO upload_record_compensations
       (record_id, min_amount, max_amount, currency, unit, quote, confidence)
       VALUES (?,?,?,?,?,?,?)`,
      [recordId, offer.minAmount, offer.maxAmount, offer.currency, offer.unit, offer.quote, offer.confidence]
    );
  }
}

async function loadCompensationsForRecords(recordIds) {
  const result = new Map(recordIds.map(id => [id, []]));
  if (!recordIds.length) return result;
  const placeholders = recordIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT record_id, min_amount, max_amount, currency, unit, quote, confidence
     FROM upload_record_compensations WHERE record_id IN (${placeholders}) ORDER BY id ASC`,
    recordIds
  );
  rows.forEach(row => result.get(row.record_id).push({
    minAmount: Number(row.min_amount), maxAmount: Number(row.max_amount), currency: row.currency,
    unit: row.unit, quote: row.quote, confidence: Number(row.confidence)
  }));
  return result;
}

let analysisWorkerRunning = false;
const queuedAnalysisTasks = new Set();

function queueAnalysisTask(taskId) {
  queuedAnalysisTasks.add(String(taskId));
  if (analysisWorkerRunning) return;
  analysisWorkerRunning = true;
  setImmediate(async () => {
    try {
      while (queuedAnalysisTasks.size) {
        const [nextTaskId] = queuedAnalysisTasks;
        queuedAnalysisTasks.delete(nextTaskId);
        await processUploadAnalysisTask(nextTaskId);
      }
    } finally {
      analysisWorkerRunning = false;
      if (queuedAnalysisTasks.size) queueAnalysisTask(queuedAnalysisTasks.values().next().value);
    }
  });
}

async function processUploadAnalysisTask(taskId) {
  try {
    const [recordRows] = await pool.execute(
      'SELECT id, content_json FROM upload_records WHERE task_id = ? ORDER BY id ASC',
      [taskId]
    );
    const records = recordRows.map(row => ({
      index: row.id,
      item: typeof row.content_json === 'string' ? parseStoredJson(row.content_json) : row.content_json
    }));
    const filterGroups = await loadFilterGroups({ enabledOnly: true });
    const { offersByIndex, batches } = await analyzeRecordsCompensation(
      records,
      true,
      completedBatches => pool.execute(
        'UPDATE upload_tasks SET analysis_batches = ? WHERE task_id = ?',
        [completedBatches, taskId]
      )
    );
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `DELETE compensation FROM upload_record_compensations compensation
         INNER JOIN upload_records record ON record.id = compensation.record_id
         WHERE record.task_id = ?`,
        [taskId]
      );
      await connection.execute(
        `DELETE match_row FROM upload_record_filter_matches match_row
         INNER JOIN upload_records record ON record.id = match_row.record_id
         WHERE record.task_id = ?`,
        [taskId]
      );
      let unmatched = 0;
      for (const record of records) {
        const offers = offersByIndex.get(record.index) || [];
        await persistCompensations(connection, record.index, offers);
        const matches = evaluateGroups(filterGroups, record.item || {}, offers);
        if (!matches.length) unmatched += 1;
        for (const match of matches) {
          for (const conditionId of match.conditionIds) {
            await connection.execute(
              'INSERT IGNORE INTO upload_record_filter_matches(record_id, group_id, condition_id) VALUES (?,?,?)',
              [record.index, match.groupId, conditionId]
            );
          }
        }
      }
      await connection.execute(
        `UPDATE upload_tasks
         SET status = 'completed', inserted_count = ?, filtered_count = ?, analysis_batches = ?, completed_at = CURRENT_TIMESTAMP, last_error = NULL
         WHERE task_id = ?`,
        [records.length, unmatched, batches, taskId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    await pool.execute(
      `UPDATE upload_tasks
       SET status = 'failed', last_error = ?
       WHERE task_id = ?`,
      [String(error.message || error).slice(0, 1000), taskId]
    );
    console.error(`[AnalysisQueue] task ${taskId} failed:`, error.message);
  }
}

async function resumePendingAnalysisTasks() {
  const [tasks] = await pool.execute(
    "SELECT task_id FROM upload_tasks WHERE status = 'analyzing' ORDER BY created_at ASC"
  );
  tasks.forEach(task => queueAnalysisTask(task.task_id));
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

app.get('/health', (req, res) => res.json({ code: 0, message: 'ok' }));

app.get('/api/llm-status', (req, res) => {
  res.json({ code: 0, message: 'ok', data: getLLMStatus() });
});

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

app.get('/api/filter-groups', auth, async (req, res) => {
  try {
    res.json({ code: 0, message: 'ok', data: { list: await loadFilterGroups() } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/filter-groups', auth, async (req, res) => {
  try {
    const name = String(req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ code: 1, message: 'name is required' });
    const matchMode = normalizeMatchMode(req.body && req.body.matchMode);
    const enabled = parseEnabled(req.body && req.body.enabled);
    const [result] = await pool.execute(
      'INSERT INTO filter_groups(name, match_mode, enabled) VALUES (?,?,?)',
      [name, matchMode, enabled ? 1 : 0]
    );
    res.status(201).json({ code: 0, message: 'ok', data: { id: result.insertId, name, matchMode, enabled, conditions: [] } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.put('/api/filter-groups/:id', auth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const [rows] = await pool.execute('SELECT id, name, match_mode, enabled FROM filter_groups WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ code: 1, message: 'filter group not found' });
    const old = rows[0];
    const name = req.body && req.body.name === undefined ? old.name : String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ code: 1, message: 'name is required' });
    const matchMode = req.body && req.body.matchMode === undefined ? old.match_mode : normalizeMatchMode(req.body.matchMode);
    const enabled = req.body && req.body.enabled === undefined ? !!old.enabled : parseEnabled(req.body.enabled);
    await pool.execute('UPDATE filter_groups SET name = ?, match_mode = ?, enabled = ? WHERE id = ?', [name, matchMode, enabled ? 1 : 0, id]);
    res.json({ code: 0, message: 'ok', data: { id, name, matchMode, enabled } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.delete('/api/filter-groups/:id', auth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const [result] = await pool.execute('DELETE FROM filter_groups WHERE id = ?', [id]);
    await pool.execute('DELETE FROM filter_conditions WHERE group_id = ?', [id]);
    await pool.execute('DELETE FROM upload_record_filter_matches WHERE group_id = ?', [id]);
    res.json({ code: 0, message: 'ok', data: { deleted: result.affectedRows || 0 } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/filter-groups/:id/conditions', auth, async (req, res) => {
  try {
    const groupId = Number.parseInt(req.params.id, 10);
    const [groups] = await pool.execute('SELECT id FROM filter_groups WHERE id = ? LIMIT 1', [groupId]);
    if (!groups.length) return res.status(404).json({ code: 1, message: 'filter group not found' });
    const condition = parseConditionPayload(req.body);
    if (condition.error) return res.status(400).json({ code: 1, message: condition.error });
    const [result] = await pool.execute(
      'INSERT INTO filter_conditions(group_id, condition_type, condition_value, enabled, sort_order) VALUES (?,?,?,?,?)',
      [groupId, condition.type, condition.value, condition.enabled ? 1 : 0, condition.sortOrder]
    );
    res.status(201).json({ code: 0, message: 'ok', data: { id: result.insertId, groupId, ...condition } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.put('/api/filter-conditions/:id', auth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const [rows] = await pool.execute('SELECT id, group_id, condition_type, condition_value, enabled, sort_order FROM filter_conditions WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ code: 1, message: 'filter condition not found' });
    const old = rows[0];
    const condition = parseConditionPayload({
      type: req.body && req.body.type === undefined ? old.condition_type : req.body.type,
      value: req.body && req.body.value === undefined ? parseStoredJson(old.condition_value) : req.body.value,
      enabled: req.body && req.body.enabled === undefined ? !!old.enabled : req.body.enabled,
      sortOrder: req.body && req.body.sortOrder === undefined ? old.sort_order : req.body.sortOrder
    });
    if (condition.error) return res.status(400).json({ code: 1, message: condition.error });
    await pool.execute(
      'UPDATE filter_conditions SET condition_type = ?, condition_value = ?, enabled = ?, sort_order = ? WHERE id = ?',
      [condition.type, condition.value, condition.enabled ? 1 : 0, condition.sortOrder, id]
    );
    res.json({ code: 0, message: 'ok', data: { id, groupId: old.group_id, ...condition } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.delete('/api/filter-conditions/:id', auth, async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const [result] = await pool.execute('DELETE FROM filter_conditions WHERE id = ?', [id]);
    await pool.execute('DELETE FROM upload_record_filter_matches WHERE condition_id = ?', [id]);
    res.json({ code: 0, message: 'ok', data: { deleted: result.affectedRows || 0 } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/filter-groups/reindex', auth, async (req, res) => {
  try {
    const groups = await loadFilterGroups({ enabledOnly: true });
    const [records] = await pool.execute('SELECT id, content_json FROM upload_records ORDER BY id ASC');

    const sourceRecords = records.map(record => ({
      index: record.id,
      item: typeof record.content_json === 'string' ? parseStoredJson(record.content_json) : record.content_json
    }));
    const requiresCompensation = groups.some(group => group.conditions.some(condition =>
      condition.enabled && condition.type === 'compensation_range'
    ));
    const { offersByIndex, batches } = await analyzeRecordsCompensation(sourceRecords, requiresCompensation);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM upload_record_filter_matches');
      await connection.execute('DELETE FROM upload_record_compensations');

      let matchesWritten = 0;
      for (const record of sourceRecords) {
        const offers = offersByIndex.get(record.index) || [];
        await persistCompensations(connection, record.index, offers);
        for (const match of evaluateGroups(groups, record.item || {}, offers)) {
        for (const conditionId of match.conditionIds) {
          await connection.execute(
            'INSERT INTO upload_record_filter_matches(record_id, group_id, condition_id) VALUES (?,?,?)',
              [record.index, match.groupId, conditionId]
          );
          matchesWritten += 1;
        }
      }
    }
      await connection.commit();
      res.json({ code: 0, message: 'ok', data: { indexed: records.length, matchesWritten, analysisBatches: batches } });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.get('/api/upload-tasks/:taskId', auth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT task_id, status, received_count, inserted_count, filtered_count, analysis_batches, last_error, created_at, completed_at
       FROM upload_tasks WHERE task_id = ? LIMIT 1`,
      [String(req.params.taskId)]
    );
    if (!rows.length) return res.status(404).json({ code: 1, message: 'upload task not found' });
    const task = rows[0];
    res.json({
      code: 0,
      message: 'ok',
      data: {
        taskId: task.task_id,
        status: task.status,
        receivedCount: task.received_count,
        insertedCount: task.inserted_count,
        unmatchedCount: task.filtered_count,
        analysisBatches: task.analysis_batches,
        lastError: task.last_error,
        createdAt: task.created_at,
        completedAt: task.completed_at
      }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.post('/api/upload/batch', async (req, res) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const seen = new Set();
    const uniqueRecords = [];

    records.forEach((item, index) => {
      const key = item && item.recordKey ? item.recordKey : null;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      uniqueRecords.push({ index, item: item || {} });
    });
    await pool.execute(
      `INSERT INTO upload_tasks(task_id, status, received_count, analysis_batches)
       VALUES (?, 'analyzing', ?, 0)`,
      [taskId, uniqueRecords.length]
    );
    const connection = await pool.getConnection();
    let inserted = 0;
    try {
      await connection.beginTransaction();
      for (const record of uniqueRecords) {
        const { item } = record;
        const key = item.recordKey || null;
        const sender = item.sender || item.from || item.senderName || '';
        const [result] = await connection.execute(
          'INSERT INTO upload_records(task_id, record_key, sender, content_json, is_read) VALUES (?,?,?,?,0)',
          [taskId, key, sender, JSON.stringify(item || {})]
        );
        inserted += 1;
      }
      await connection.execute(
        'UPDATE upload_tasks SET inserted_count = ? WHERE task_id = ?',
        [inserted, taskId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      await pool.execute(
        "UPDATE upload_tasks SET status = 'failed', last_error = ? WHERE task_id = ?",
        [String(error.message || error).slice(0, 1000), taskId]
      );
      throw error;
    } finally {
      connection.release();
    }

    queueAnalysisTask(taskId);
    res.status(202).json({
      code: 0,
      message: 'analysis queued',
      data: { taskId, batchCount: inserted, unmatchedCount: null, analysisBatches: 0, status: 'analyzing' }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = (page - 1) * pageSize;
    const contentSql = 'CAST(content_json AS CHAR)';
    const q = String(req.query.q || req.query.sender || '').trim();
    const keywords = parseMultiValue(req.query.keyword);
    const quickHours = Math.max(parseInt(req.query.quickHours || '0', 10), 0);
    const unreadOnly = ['1', 'true', 'yes'].includes(String(req.query.unreadOnly || '').toLowerCase());
    const groupId = Math.max(Number.parseInt(req.query.groupId || '0', 10) || 0, 0);
    const conditionType = req.query.conditionType ? normalizeConditionType(req.query.conditionType) : null;
    const compensationMin = req.query.compensationMin === undefined || req.query.compensationMin === '' ? null : Number(req.query.compensationMin);
    const compensationMax = req.query.compensationMax === undefined || req.query.compensationMax === '' ? null : Number(req.query.compensationMax);

    let whereSql = ' WHERE 1=1 ';
    const params = [];

    if (quickHours > 0) {
      const quickStart = new Date(Date.now() - quickHours * 60 * 60 * 1000);
      whereSql += ' AND created_at >= ?';
      params.push(formatDateTime(quickStart));
    }
    if (req.query.startTime) {
      whereSql += ' AND created_at >= ?';
      params.push(req.query.startTime);
    }
    if (req.query.endTime) {
      whereSql += ' AND created_at <= ?';
      params.push(req.query.endTime);
    }
    if (q) {
      whereSql += ` AND (sender LIKE ? OR ${contentSql} LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    if (unreadOnly) {
      whereSql += ' AND is_read = 0';
    }
    if (req.query.conditionType && !conditionType) {
      return res.status(400).json({ code: 1, message: `conditionType must be one of: ${Array.from(CONDITION_TYPES).join(', ')}` });
    }
    if ((compensationMin !== null && (!Number.isFinite(compensationMin) || compensationMin < 0)) ||
      (compensationMax !== null && (!Number.isFinite(compensationMax) || compensationMax < 0)) ||
      (compensationMin !== null && compensationMax !== null && compensationMax < compensationMin)) {
      return res.status(400).json({ code: 1, message: 'compensationMin and compensationMax must be non-negative; when both are present, compensationMin must be <= compensationMax' });
    }
    if (groupId || conditionType) {
      let matchSql = ' EXISTS (SELECT 1 FROM upload_record_filter_matches fm';
      const matchParams = [];
      if (conditionType) {
        matchSql += ' INNER JOIN filter_conditions fc ON fc.id = fm.condition_id';
      }
      matchSql += ' WHERE fm.record_id = upload_records.id';
      if (groupId) {
        matchSql += ' AND fm.group_id = ?';
        matchParams.push(groupId);
      }
      if (conditionType) {
        matchSql += ' AND fc.condition_type = ?';
        matchParams.push(conditionType);
      }
      matchSql += ')';
      whereSql += ` AND ${matchSql}`;
      params.push(...matchParams);
    }
    if (compensationMin !== null || compensationMax !== null) {
      whereSql += ` AND EXISTS (
        SELECT 1 FROM upload_record_compensations compensation
        WHERE compensation.record_id = upload_records.id
          ${compensationMax !== null ? 'AND compensation.min_amount <= ?' : ''}
          ${compensationMin !== null ? 'AND compensation.max_amount >= ?' : ''}
      )`;
      if (compensationMax !== null) params.push(compensationMax);
      if (compensationMin !== null) params.push(compensationMin);
    }

    if (keywords.length) {
      const keywordConditions = [];

      keywords.forEach(keyword => {
        if (keyword === 'direct') {
          keywordConditions.push(`${contentSql} LIKE ?`);
          params.push('%直发%');
        }
        if (keyword === 'miniapp') {
          keywordConditions.push(`${contentSql} LIKE ?`);
          params.push('%小程序%');
        }
        if (keyword === 'link') {
          keywordConditions.push(`(${contentSql} LIKE ? OR ${contentSql} LIKE ? OR ${contentSql} LIKE ?)`);
          params.push('%http://%', '%https://%', '%链接%');
        }
      });

      if (keywordConditions.length) {
        whereSql += ` AND (${keywordConditions.join(' OR ')})`;
      }
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

    const compensationsByRecord = await loadCompensationsForRecords(rows.map(row => row.id));
    const list = rows.map(item => ({
      id: item.id,
      taskId: item.task_id,
      recordKey: item.record_key,
      sender: item.sender || '',
      contentJson: typeof item.content_json === 'string' ? JSON.parse(item.content_json) : item.content_json,
      createdAt: item.created_at,
      isRead: !!item.is_read,
      compensations: compensationsByRecord.get(item.id) || []
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

app.resumePendingAnalysisTasks = resumePendingAnalysisTasks;

module.exports = app;
