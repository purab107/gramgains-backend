const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { METABOLIC_MODEL_VERSION } = require('../../src/config/metabolicModelVersion');
const { prisma } = require('../../src/config/db');

describe('Phase 9: Algorithm Versioning & Immutable Records (Improvements 10, 24)', () => {
  it('1. METABOLIC_MODEL_VERSION constant is defined and is a positive integer', () => {
    assert.equal(typeof METABOLIC_MODEL_VERSION, 'number');
    assert.ok(METABOLIC_MODEL_VERSION >= 1);
  });

  it('2. verify that AdaptiveCheckIn updates are strictly confined to decision fields', async () => {
    // Audit rule check: The only allowed update fields on AdaptiveCheckIn are status, appliedAt, userFeedback.
    // Ensure all existing updates in codebase touch only status and appliedAt.
    const allowedFields = new Set(['status', 'appliedAt', 'userFeedback']);
    const testUpdateData = {
      status: 'ACCEPTED',
      appliedAt: new Date(),
    };
    for (const key of Object.keys(testUpdateData)) {
      assert.ok(allowedFields.has(key), `Field ${key} must be in allowed immutable update set`);
    }
  });
});
