const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateProportionalAdjustment } = require('../../src/modules/adaptive/algorithms/expenditureSolver');

describe('Phase 7: Proportional Adjustment Algorithm (Improvement 14)', () => {
  it('1. returns currentCalories when delta is 0', () => {
    const result = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 2000,
      observedRateKgPerWeek: -0.5,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(result, 2000);
  });

  it('2. returns rawTargetCalories if currentCalories is not provided or <= 0', () => {
    const result = calculateProportionalAdjustment({
      currentCalories: 0,
      rawTargetCalories: 1850,
      observedRateKgPerWeek: -0.3,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(result, 1850);
  });

  it('3. small deviation (< 50% off target): moves 50% toward target, capped at 75 kcal', () => {
    // targetRate = -0.5 kg/week, observedRate = -0.4 kg/week
    // deviation = |-0.4 - (-0.5)| / 0.5 = 0.1 / 0.5 = 0.2 (< 0.5, small)
    // delta = 1800 - 2000 = -200
    // 50% of -200 = -100, but capped at 75 kcal max -> adjustment = -75 kcal -> 1925
    const resultCapped = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 1800,
      observedRateKgPerWeek: -0.4,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(resultCapped, 1925);

    // smaller delta: delta = 1950 - 2000 = -50
    // 50% of -50 = -25 (< 75 cap) -> adjustment = -25 kcal -> 1975
    const resultUncapped = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 1950,
      observedRateKgPerWeek: -0.4,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(resultUncapped, 1975);
  });

  it('4. medium deviation (50–100% off target): moves 75% toward target, capped at 100 kcal', () => {
    // targetRate = -0.5 kg/week, observedRate = -0.15 kg/week
    // deviation = |-0.15 - (-0.5)| / 0.5 = 0.35 / 0.5 = 0.70 (50–100%, medium)
    // delta = 1800 - 2000 = -200
    // 75% of -200 = -150, but capped at 100 kcal max -> adjustment = -100 kcal -> 1900
    const resultCapped = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 1800,
      observedRateKgPerWeek: -0.15,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(resultCapped, 1900);

    // smaller delta: delta = 1920 - 2000 = -80
    // 75% of -80 = -60 (< 100 cap) -> adjustment = -60 kcal -> 1940
    const resultUncapped = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 1920,
      observedRateKgPerWeek: -0.15,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(resultUncapped, 1940);
  });

  it('5. large deviation (> 100% off target or opposite direction): moves 100%, capped at 150 kcal', () => {
    // targetRate = -0.5 kg/week, observedRate = +0.2 kg/week (gaining weight while cutting)
    // deviation = |0.2 - (-0.5)| / 0.5 = 0.7 / 0.5 = 1.4 (> 1.0, large)
    // delta = 1700 - 2000 = -300
    // 100% of -300 = -300, capped at maxAdjustmentKcal (150) -> adjustment = -150 kcal -> 1850
    const resultCapped = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 1700,
      observedRateKgPerWeek: 0.2,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(resultCapped, 1850);
  });

  it('6. upward adjustments (calorie increases) are handled symmetrically', () => {
    // targetRate = -0.5 kg/week, observedRate = -1.2 kg/week (losing weight too fast)
    // deviation = |-1.2 - (-0.5)| / 0.5 = 0.7 / 0.5 = 1.4 (> 1.0, large)
    // delta = 2300 - 2000 = +300
    // 100% of +300 = +300, capped at +150 kcal -> 2150
    const result = calculateProportionalAdjustment({
      currentCalories: 2000,
      rawTargetCalories: 2300,
      observedRateKgPerWeek: -1.2,
      targetRateKgPerWeek: -0.5,
    });
    assert.equal(result, 2150);
  });
});
