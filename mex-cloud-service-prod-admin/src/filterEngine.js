const CONDITION_TYPES = new Set(['contains', 'not_contains', 'regex', 'has_url', 'compensation_range']);

function normalizeMatchMode(value) {
  return String(value || '').toLowerCase() === 'all' ? 'all' : 'any';
}

function normalizeConditionType(value) {
  const type = String(value || '').trim().toLowerCase();
  return CONDITION_TYPES.has(type) ? type : null;
}

function hasUrl(text) {
  return /https?:\/\/\S+/i.test(text);
}

function getRecordText(record) {
  if (!record || typeof record !== 'object') return '';
  return [
    record.sender,
    record.from,
    record.senderName,
    record.title,
    record.content,
    record.message,
    record.text,
    record.chat,
    record.body,
    record.description,
    record.desc,
    record.summary,
    record.text_extra,
    record.textExtra
  ].filter(value => value !== undefined && value !== null).join('\n');
}

function parseCompensationRange(value) {
  const parsed = typeof value === 'string' ? (() => {
    try { return JSON.parse(value); } catch (_) { return null; }
  })() : value;
  const rawMin = parsed && parsed.minAmount;
  const rawMax = parsed && parsed.maxAmount;
  if (rawMin === null || rawMin === undefined) {
    if (rawMax === null || rawMax === undefined) return null;
    const maxAmount = Number(rawMax);
    return Number.isFinite(maxAmount) && maxAmount >= 0 ? { minAmount: 0, maxAmount } : null;
  }
  if (rawMax === null || rawMax === undefined) {
    const minAmount = Number(rawMin);
    return Number.isFinite(minAmount) && minAmount >= 0 ? { minAmount, maxAmount: Number.MAX_SAFE_INTEGER } : null;
  }
  const minAmount = Number(rawMin);
  const maxAmount = Number(rawMax);
  if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount < 0 || maxAmount < minAmount) return null;
  return { minAmount, maxAmount };
}

function rangesOverlap(left, right) {
  return left.minAmount <= right.maxAmount && left.maxAmount >= right.minAmount;
}

function matchesCondition(condition, record, compensations = []) {
  const type = normalizeConditionType(condition && condition.type);
  if (!type) return false;

  const text = getRecordText(record);
  const value = condition.value === undefined || condition.value === null
    ? ''
    : String(condition.value).trim();

  if (type === 'compensation_range') {
    const range = parseCompensationRange(condition.value);
    return !!range && compensations.some(offer => rangesOverlap(range, offer));
  }
  if (type === 'contains') return value.length > 0 && text.toLowerCase().includes(value.toLowerCase());
  if (type === 'not_contains') return value.length > 0 && !text.toLowerCase().includes(value.toLowerCase());
  if (type === 'has_url') return hasUrl(text) === ['1', 'true', 'yes'].includes(value.toLowerCase());
  if (type === 'regex') {
    if (!value) return false;
    try {
      return new RegExp(value, 'i').test(text);
    } catch (_) {
      return false;
    }
  }
  return false;
}

function evaluateGroups(groups, record, compensations = []) {
  return (Array.isArray(groups) ? groups : []).flatMap(group => {
    if (!group || !group.enabled) return [];
    const conditions = (Array.isArray(group.conditions) ? group.conditions : [])
      .filter(condition => condition && condition.enabled);
    if (!conditions.length) return [];

    const matchedConditionIds = conditions
      .filter(condition => matchesCondition(condition, record, compensations))
      .map(condition => condition.id);
    const matched = normalizeMatchMode(group.matchMode) === 'all'
      ? matchedConditionIds.length === conditions.length
      : matchedConditionIds.length > 0;

    return matched ? [{ groupId: group.id, conditionIds: matchedConditionIds }] : [];
  });
}

module.exports = {
  CONDITION_TYPES,
  evaluateGroups,
  getRecordText,
  matchesCondition,
  normalizeConditionType,
  normalizeMatchMode,
  parseCompensationRange,
  rangesOverlap
};
