const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeActivityConsistency } = require('../../src/modules/adaptive/algorithms/activityEvaluator');

describe('Phase 11: Activity Data Integration (Improvement 19)', () => {
  it('1. returns zero metrics for empty activity logs', () => {
    const result = computeActivityConsistency([], 21);
    assert.equal(result.totalActiveDays, 0);
    assert.equal(result.activityDensity, 0);
    assert.equal(result.avgDailyCaloriesBurned, 0);
    assert.equal(result.isConsistent, false);
    assert.equal(result.annotation, null);
  });

  it('2. correctly computes density and marks consistent when >= 40% of days active', () => {
    // 10 active days out of 21 = 47.6% density — consistent
    const logs = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      caloriesBurned: 400,
    }));

    const result = computeActivityConsistency(logs, 21);
    assert.equal(result.totalActiveDays, 10);
    assert.ok(result.activityDensity >= 0.4, `density ${result.activityDensity} should be >= 0.4`);
    assert.equal(result.isConsistent, true);
    assert.ok(result.avgDailyCaloriesBurned > 0);
  });

  it('3. marks inconsistent when fewer than 40% of days have activity', () => {
    // 7 active days out of 21 = 33.3% density — not consistent
    const logs = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      caloriesBurned: 350,
    }));

    const result = computeActivityConsistency(logs, 21);
    assert.equal(result.isConsistent, false);
  });

  it('4. correctly deduplicates multiple sessions on the same day', () => {
    const logs = [
      { date: '2026-09-01', caloriesBurned: 300 },
      { date: '2026-09-01', caloriesBurned: 200 }, // same day, second session
      { date: '2026-09-02', caloriesBurned: 400 },
    ];

    const result = computeActivityConsistency(logs, 21);
    // 2 distinct days, not 3
    assert.equal(result.totalActiveDays, 2);
    assert.equal(result.avgDailyCaloriesBurned, Math.round(900 / 21));
    assert.equal(result.avgSessionCaloriesBurned, 300); // 900 / 3 sessions
  });

  it('5. generates annotation when activity is consistent and calorie burn is significant', () => {
    const logs = Array.from({ length: 12 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      caloriesBurned: 500,
    }));

    const result = computeActivityConsistency(logs, 21);
    assert.ok(result.annotation !== null, 'Should produce annotation for consistent high-volume training');
    assert.ok(result.annotation.includes('training') || result.annotation.includes('Consistent'));
  });
});
