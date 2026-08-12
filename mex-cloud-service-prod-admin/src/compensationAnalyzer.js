const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const MAX_BATCH_ITEMS = 12;
const MAX_BATCH_CHARS = 16000;

let warnedMissingKey = false;
let llmStatus = { status: 'checking', checkedAt: null, detail: '' };

function getLLMStatus() {
  return { ...llmStatus };
}

async function checkLLMStatus() {
  if (!process.env.DEEPSEEK_API_KEY) {
    llmStatus = { status: 'unconfigured', checkedAt: new Date().toISOString(), detail: '' };
    return getLLMStatus();
  }
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(15000)
    });
    llmStatus = {
      status: response.ok ? 'available' : 'unavailable',
      checkedAt: new Date().toISOString(),
      detail: response.ok ? '' : `HTTP ${response.status}`
    };
  } catch (_) {
    llmStatus = { status: 'unavailable', checkedAt: new Date().toISOString(), detail: 'network error' };
  }
  return getLLMStatus();
}

function cleanOffer(value) {
  if (!value || typeof value !== 'object') return null;
  const minAmount = Number(value.minAmount);
  const maxAmount = Number(value.maxAmount);
  if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount < 0 || maxAmount < minAmount) return null;
  if (String(value.currency || 'CNY').toUpperCase() !== 'CNY') return null;
  const unit = ['one_time', 'monthly', 'daily', 'per_item', 'per_hour'].includes(value.unit)
    ? value.unit
    : 'unspecified';
  return {
    minAmount: Math.round(minAmount * 100) / 100,
    maxAmount: Math.round(maxAmount * 100) / 100,
    currency: 'CNY',
    unit,
    quote: String(value.quote || '').trim().slice(0, 300),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0))
  };
}

function extractJson(content) {
  if (typeof content !== 'string') return {};
  try { return JSON.parse(content); } catch (_) {}
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch (_) { return {}; }
}

function uniqueOffers(offers) {
  const seen = new Set();
  return offers.filter(offer => {
    const key = `${offer.minAmount}|${offer.maxAmount}|${offer.unit}|${offer.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseAmount(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const normalizedUnit = String(unit || '').toLowerCase();
  if (normalizedUnit === '万' || normalizedUnit === 'w') return amount * 10000;
  if (normalizedUnit === '千' || normalizedUnit === 'k') return amount * 1000;
  return amount;
}

function extractLocalCompensations(text) {
  const source = String(text || '');
  const offers = [];
  const matcher = /(?:预算|费用|报价|报酬|薪资|工资|佣金|酬劳|单价|合作费|服务费|结算|稿酬)\s*(?:为|是|：|:|约|大约|预计)?\s*(\d+(?:\.\d+)?)\s*(万|w|千|k|元)?\s*(?:[-~～至到]\s*(\d+(?:\.\d+)?)\s*(万|w|千|k|元)?)?\s*(内|以内|以下|不超过|最多|上限|起|以上|至少)?/gi;
  let match;
  while ((match = matcher.exec(source))) {
    const first = parseAmount(match[1], match[2] || match[4]);
    const second = match[3] ? parseAmount(match[3], match[4] || match[2]) : null;
    if (first === null || (match[3] && second === null)) continue;
    let minAmount = first;
    let maxAmount = second === null ? first : second;
    const qualifier = match[5] || '';
    if (qualifier === '内' || qualifier === '以内' || qualifier === '以下' || qualifier === '不超过' || qualifier === '最多' || qualifier === '上限') {
      minAmount = 0;
      maxAmount = first;
    } else if (qualifier === '起' || qualifier === '以上' || qualifier === '至少') {
      minAmount = first;
      maxAmount = 999999999;
    } else if (second !== null) {
      minAmount = Math.min(first, second);
      maxAmount = Math.max(first, second);
    }
    offers.push({
      minAmount,
      maxAmount,
      currency: 'CNY',
      unit: 'unspecified',
      quote: match[0].trim(),
      confidence: 0.98
    });
  }
  return uniqueOffers(offers);
}

async function analyzeCompensations(records) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const normalizedRecords = (Array.isArray(records) ? records : [])
    .slice(0, MAX_BATCH_ITEMS)
    .map(record => ({ id: String(record.id), text: String(record.text || '').trim() }))
    .filter(record => record.id && record.text);
  let remainingChars = MAX_BATCH_CHARS;
  const boundedRecords = normalizedRecords.filter(record => {
    if (remainingChars <= 0) return false;
    record.text = record.text.slice(0, remainingChars);
    remainingChars -= record.text.length;
    return true;
  });
  if (!boundedRecords.length) return new Map();
  const result = new Map(boundedRecords.map(record => [record.id, extractLocalCompensations(record.text)]));
  if (!apiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[CompensationAnalyzer] DEEPSEEK_API_KEY is not configured; using local compensation extraction only.');
    }
    return result;
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You extract compensation offers from Chinese messages. Return JSON only: {"results":[{"id":string,"offers":[{"minAmount":number,"maxAmount":number,"currency":"CNY","unit":"one_time|monthly|daily|per_item|per_hour|unspecified","quote":string,"confidence":number}]}]}. Return one result for every supplied id, with an empty offers array when absent. Extract actual compensation, budget, salary, fee, guaranteed pay, per-item/day/hour amounts. Convert k/千 to 1000 and 万/w to 10000. A range such as 2-5万 becomes minAmount 20000 and maxAmount 50000. A single cash amount has equal minAmount/maxAmount. Respect bounds: “不超过/最多/上限 2w” is 0 to 20000; “至少/起/最低 8k” is 8000 to an open upper bound represented as 999999999. Do not extract dates, order numbers, counts, percentages, discounts, IDs, or non-compensation prices. If the unit is unclear, use unspecified.'
          },
          { role: 'user', content: JSON.stringify({ records: boundedRecords }) }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const parsed = extractJson(body?.choices?.[0]?.message?.content);
    const inputIds = new Set(boundedRecords.map(record => record.id));
    (Array.isArray(parsed.results) ? parsed.results : []).forEach(item => {
      const id = String(item && item.id || '');
      if (!inputIds.has(id)) return;
      const llmOffers = (Array.isArray(item.offers) ? item.offers : []).map(cleanOffer).filter(Boolean);
      result.set(id, uniqueOffers([...(result.get(id) || []), ...llmOffers]));
    });
  } catch (error) {
    console.warn(`[CompensationAnalyzer] DeepSeek unavailable; using local extraction only: ${error.message}`);
  }
  return result;
}

module.exports = {
  analyzeCompensations,
  checkLLMStatus,
  cleanOffer,
  DEEPSEEK_MODEL,
  extractLocalCompensations,
  getLLMStatus,
  MAX_BATCH_ITEMS,
  MAX_BATCH_CHARS
};
