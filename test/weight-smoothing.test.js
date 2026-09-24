const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateWeightTrend } = require('../src/modules/adaptive/algorithms/weightSmoothing');

describe('Weight Trend Smoothing Algorithm (Holt Linear Double Exponential)', () => {
  it('returns empty result for empty logs', () => {
    const result = calculateWeightTrend([]);
    assert.equal(result.smoothedLogs.length, 0);
    assert.equal(result.latestRawKg, 0);
    assert.equal(result.latestTrendKg, 0);
  });

  it('handles a single weight log cleanly', () => {
    const logs = [{ date: '2026-09-01', weightKg: 75.0 }];
    const result = calculateWeightTrend(logs);
    assert.equal(result.smoothedLogs.length, 1);
    assert.equal(result.latestRawKg, 75.0);
    assert.equal(result.latestTrendKg, 75.0);
    assert.equal(result.velocityKgPerDay, 0);
  });

  it('dampens sudden single-day sodium/water scale spikes', () => {
    // Sequence of 75kg, followed by sudden 78kg spike, then back to 75kg
    const logs = [
      { date: '2026-09-01', weightKg: 75.0 },
      { date: '2026-09-02', weightKg: 75.0 },
      { date: '2026-09-03', weightKg: 75.1 },
      { date: '2026-09-04', weightKg: 78.0 }, // +2.9 kg acute water spike
      { date: '2026-09-05', weightKg: 75.2 },
    ];
    const result = calculateWeightTrend(logs);
    assert.equal(result.smoothedLogs.length, 5);
    const spikeDay = result.smoothedLogs[3];
    // The smoothed trend should resist the +2.9 kg scale jump and stay under 75.8 kg
    assert.ok(spikeDay.trendWeightKg < 75.8, `Expected smoothed trend < 75.8kg, got ${spikeDay.trendWeightKg}`);
  });

  it('smooths steady weight loss and computes negative velocity', () => {
    const logs = [];
    const startDate = new Date('2026-08-01');
    for (let i = 0; i < 28; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      // Losing ~0.07 kg/day (~0.5 kg/week) with small scale fluctuations
      const noise = (Math.sin(i) * 0.3);
      logs.push({
        date: d.toISOString().split('T')[0],
        weightKg: 80 - 0.07 * i + noise,
      });
    }

    const result = calculateWeightTrend(logs);
    assert.equal(result.smoothedLogs.length, 28);
    assert.ok(result.velocityKgPerWeek < -0.3 && result.velocityKgPerWeek > -0.7,
      `Expected velocity near -0.5 kg/wk, got ${result.velocityKgPerWeek}`);
    assert.ok(result.latestTrendKg < 79 && result.latestTrendKg > 77);
  });

  it('correctly handles excluded logs (e.g. sickness days)', () => {
    const logs = [
      { date: '2026-09-01', weightKg: 70.0 },
      { date: '2026-09-02', weightKg: 70.0 },
      { date: '2026-09-03', weightKg: 67.5, isExcluded: true }, // Sick / dehydrated
      { date: '2026-09-04', weightKg: 70.1 },
    ];
    const result = calculateWeightTrend(logs);
    assert.equal(result.smoothedLogs[2].isExcluded, true);
    // Excluded day does not crash or drag trend down to 67.5
    assert.ok(result.smoothedLogs[2].trendWeightKg > 69.5);
  });
});
