const assert = require('assert');
const { evaluateGroups, matchesCondition, rangesOverlap } = require('../src/filterEngine');
const { extractLocalCompensations, MAX_BATCH_ITEMS, MAX_BATCH_CHARS } = require('../src/compensationAnalyzer');

const record = { sender: '产品组', content: '请查看 https://example.com 的需求文档' };
const chatRecord = { chat: '【小红书成人产品供稿招募】\n预算：10\n费用：300\n预算：30内' };

assert.strictEqual(matchesCondition({ type: 'contains', value: '需求文档' }, record), true);
assert.strictEqual(matchesCondition({ type: 'not_contains', value: '广告' }, record), true);
assert.strictEqual(matchesCondition({ type: 'regex', value: 'https?://\\S+' }, record), true);
assert.strictEqual(matchesCondition({ type: 'has_url', value: true }, record), true);
assert.strictEqual(matchesCondition({ type: 'has_url', value: false }, record), false);
assert.strictEqual(matchesCondition({ type: 'contains', value: '预算：10' }, chatRecord), true);
assert.strictEqual(rangesOverlap({ minAmount: 8000, maxAmount: 20000 }, { minAmount: 20000, maxAmount: 50000 }), true);
assert.strictEqual(rangesOverlap({ minAmount: 8000, maxAmount: 20000 }, { minAmount: 8000, maxAmount: 12000 }), true);
assert.strictEqual(rangesOverlap({ minAmount: 8000, maxAmount: 20000 }, { minAmount: 20001, maxAmount: 50000 }), false);
assert.strictEqual(matchesCondition({ type: 'compensation_range', value: { minAmount: 8000 } }, record, [{ minAmount: 12000, maxAmount: 15000 }]), true);
assert.strictEqual(matchesCondition({ type: 'compensation_range', value: { maxAmount: 8000 } }, record, [{ minAmount: 9000, maxAmount: 15000 }]), false);
assert.strictEqual(MAX_BATCH_ITEMS, 12);
assert.strictEqual(MAX_BATCH_CHARS, 16000);
assert.deepStrictEqual(
  extractLocalCompensations(require('../src/filterEngine').getRecordText(chatRecord)).map(({ minAmount, maxAmount }) => ({ minAmount, maxAmount })),
  [{ minAmount: 10, maxAmount: 10 }, { minAmount: 300, maxAmount: 300 }, { minAmount: 0, maxAmount: 30 }]
);
assert.deepStrictEqual(
  extractLocalCompensations('合作报价 2-5万，单价 80元起').map(({ minAmount, maxAmount }) => ({ minAmount, maxAmount })),
  [{ minAmount: 20000, maxAmount: 50000 }, { minAmount: 80, maxAmount: 999999999 }]
);

const matched = evaluateGroups([
  {
    id: 1,
    enabled: true,
    matchMode: 'all',
    conditions: [
      { id: 11, type: 'contains', value: '需求文档', enabled: true },
      { id: 12, type: 'has_url', value: true, enabled: true }
    ]
  },
  {
    id: 2,
    enabled: true,
    matchMode: 'any',
    conditions: [{ id: 21, type: 'contains', value: '不存在', enabled: true }]
  }
], record);

assert.deepStrictEqual(matched, [{ groupId: 1, conditionIds: [11, 12] }]);
console.log('filterEngine tests passed');
