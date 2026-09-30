const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { recalculateSnapshots } = require('../../src/scripts/recalculateSnapshots');
const { METABOLIC_MODEL_VERSION } = require('../../src/config/metabolicModelVersion');

describe('Phase 12: Raw Data Preservation & Recalculation Utility (Improvement 23)', () => {
  it('1. METABOLIC_MODEL_VERSION is present and stable', () => {
    assert.equal(typeof METABOLIC_MODEL_VERSION, 'number');
    assert.ok(METABOLIC_MODEL_VERSION >= 1);
  });

  it('2. recalculateSnapshots exports a function', () => {
    assert.equal(typeof recalculateSnapshots, 'function');
  });

  it('3. recalculateSnapshots runs cleanly for a non-existent user without error', async () => {
    // Should not throw even when user has no snapshots
    await assert.doesNotReject(
      () => recalculateSnapshots({ userId: 'non-existent-user', days: 7 }),
    );
  });
});
