const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGap,
  computeActiveStepIndex,
  buildLeadUpSchedule,
  getActiveCalorieTarget,
} = require('../src/modules/adaptive/algorithms/calorieTransition');

describe('Calorie Transition & Lead-Up Algorithm', () => {
  it('identifies NEGLIGIBLE gap (|gap| < 150) with no lead-up schedule', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2200,
      calculatedTarget: 2250,
      estimatedMaintenance: 2500,
    });

    assert.equal(result.hasLeadUp, false);
    assert.equal(result.gapClass, 'NEGLIGIBLE');
    assert.equal(result.steps.length, 0);
    assert.equal(result.calculatedTarget, 2250);
  });

  it('generates 1 step for SMALL gap in cut direction (150 <= |gap| <= 350)', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2500,
      calculatedTarget: 2200,
      estimatedMaintenance: 2700,
    });

    assert.equal(result.hasLeadUp, true);
    assert.equal(result.gapClass, 'SMALL');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].targetCalories, 2200);
    assert.equal(result.steps[0].deltaFromPrevious, -300);
    assert.equal(result.steps[0].isInitialTarget, true);
    assert.equal(result.steps[0].weekNumber, 1);
  });

  it('generates 2 steps for MEDIUM gap in cut direction (350 < |gap| <= 700)', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2800,
      calculatedTarget: 2200,
      estimatedMaintenance: 2700,
    });

    assert.equal(result.hasLeadUp, true);
    assert.equal(result.gapClass, 'MEDIUM');
    assert.equal(result.steps.length, 2);
    assert.deepEqual(
      result.steps.map((s) => s.targetCalories),
      [2500, 2200]
    );
    assert.equal(result.steps[0].isInitialTarget, false);
    assert.equal(result.steps[0].deltaFromPrevious, -300);
    assert.equal(result.steps[1].isInitialTarget, true);
    assert.equal(result.steps[1].deltaFromPrevious, -300);
  });

  it('generates 3 steps for LARGE gap in cut direction (|gap| > 700) with exact target convergence', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 3500,
      calculatedTarget: 2200,
      estimatedMaintenance: 2700,
    });

    assert.equal(result.hasLeadUp, true);
    assert.equal(result.gapClass, 'LARGE');
    assert.equal(result.steps.length, 3);
    // Monotonically decreasing
    assert.ok(result.steps[0].targetCalories < 3500);
    assert.ok(result.steps[1].targetCalories < result.steps[0].targetCalories);
    assert.equal(result.steps[2].targetCalories, 2200);
    assert.equal(result.steps[2].isInitialTarget, true);
  });

  it('generates 1 step for SMALL gap in bulk direction', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2200,
      calculatedTarget: 2550,
      estimatedMaintenance: 2300,
    });

    assert.equal(result.hasLeadUp, true);
    assert.equal(result.gapClass, 'SMALL');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].targetCalories, 2550);
    assert.equal(result.steps[0].deltaFromPrevious, 350);
    assert.equal(result.steps[0].isInitialTarget, true);
  });

  it('clamps all steps to clinical safety floor and forces final step to floor', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2000,
      calculatedTarget: 900,
      estimatedMaintenance: 2000,
      safetyFloor: 1500,
    });

    assert.equal(result.hasLeadUp, true);
    assert.ok(result.steps.length > 0);
    for (const step of result.steps) {
      assert.ok(step.targetCalories >= 1500, `Step ${step.weekNumber} calories (${step.targetCalories}) must be >= 1500`);
    }
    const lastStep = result.steps[result.steps.length - 1];
    assert.equal(lastStep.targetCalories, 1500);
    assert.equal(lastStep.isInitialTarget, true);
  });

  it('does not generate lead-up when user does not currently track food', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 2800,
      calculatedTarget: 2200,
      estimatedMaintenance: 2700,
      currentlyTracksFood: false,
    });

    assert.equal(result.hasLeadUp, false);
    assert.equal(result.steps.length, 0);
    assert.equal(result.calculatedTarget, 2200);
  });

  it('does not generate lead-up when current intake is below safety floor', () => {
    const result = buildLeadUpSchedule({
      currentIntake: 1100,
      calculatedTarget: 2000,
      safetyFloor: 1500,
      currentlyTracksFood: true,
    });

    assert.equal(result.hasLeadUp, false);
    assert.equal(result.steps.length, 0);
  });

  it('computes active step index correctly for 2-step schedule at day 3', () => {
    const schedule = buildLeadUpSchedule({
      currentIntake: 2800,
      calculatedTarget: 2200,
    });

    const index = computeActiveStepIndex(schedule, 3);
    assert.equal(index, 0);
  });

  it('computes active step index correctly for 2-step schedule at day 8', () => {
    const schedule = buildLeadUpSchedule({
      currentIntake: 2800,
      calculatedTarget: 2200,
    });

    const index = computeActiveStepIndex(schedule, 8);
    assert.equal(index, 1);
  });

  it('returns last step calories when active target is queried beyond final week', () => {
    const schedule = buildLeadUpSchedule({
      currentIntake: 2800,
      calculatedTarget: 2200,
    });

    const targetAtDay14 = getActiveCalorieTarget(schedule, 14);
    assert.equal(targetAtDay14, 2200);

    const targetAtDay30 = getActiveCalorieTarget(schedule, 30);
    assert.equal(targetAtDay30, 2200);
  });

  it('returns direct calculated target if no lead-up schedule exists', () => {
    const schedule = buildLeadUpSchedule({
      currentIntake: 2200,
      calculatedTarget: 2250,
    });

    assert.equal(getActiveCalorieTarget(schedule, 5), 2250);
  });
});
