const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRecomp, RECOMP_WEIGHT_TOLERANCE_KG_PER_WEEK } = require('../../src/modules/adaptive/algorithms/recompEvaluator');
const { MAINTENANCE_TOLERANCE_KG_PER_WEEK } = require('../../src/modules/adaptive/algorithms/expenditureSolver');

describe('Phase 10: Maintenance Band & RECOMP Evaluator (Improvements 16, 17)', () => {
  it('1. MAINTENANCE_TOLERANCE_KG_PER_WEEK is defined as 0.1 kg/week', () => {
    assert.equal(MAINTENANCE_TOLERANCE_KG_PER_WEEK, 0.1);
  });

  it('2. RECOMP evaluator returns KEEP when weight rate is within tolerance and strength signals present', () => {
    const result = evaluateRecomp({
      observedRateKgPerWeek: 0.05,
      activityLogs: [
        { activityType: 'RESISTANCE_TRAINING', durationMinutes: 45 },
        { activityType: 'RESISTANCE_TRAINING', durationMinutes: 50 },
        { activityType: 'RESISTANCE_TRAINING', durationMinutes: 40 },
      ],
    });

    assert.equal(result.outcome, 'KEEP');
    assert.equal(result.confidence, 'HIGH');
    assert.ok(result.reasoning.includes('stable'));
  });

  it('3. RECOMP evaluator returns DECREASE when weight rate exceeds positive tolerance', () => {
    const result = evaluateRecomp({
      observedRateKgPerWeek: 0.35, // Gaining weight too quickly for recomposition
      activityLogs: [],
    });

    assert.equal(result.outcome, 'DECREASE');
    assert.equal(result.confidence, 'MEDIUM');
    assert.ok(result.reasoning.includes('upward'));
  });

  it('4. RECOMP evaluator returns INCREASE when weight rate drops below negative tolerance', () => {
    const result = evaluateRecomp({
      observedRateKgPerWeek: -0.30, // Losing weight too quickly for lean tissue preservation
      activityLogs: [],
    });

    assert.equal(result.outcome, 'INCREASE');
    assert.equal(result.confidence, 'MEDIUM');
    assert.ok(result.reasoning.includes('dropping'));
  });

  it('5. RECOMP evaluator recognizes declining waist as positive body recomposition marker', () => {
    const result = evaluateRecomp({
      observedRateKgPerWeek: 0.02,
      activityLogs: [],
      waistLogs: [
        { waistCm: 84.5 },
        { waistCm: 83.2 },
      ],
    });

    assert.equal(result.outcome, 'KEEP');
    assert.equal(result.confidence, 'HIGH');
  });
});
