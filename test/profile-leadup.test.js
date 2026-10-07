const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prisma } = require('../src/config/db');
const { updateProfile, getProfile, advanceLeadUpStep } = require('../src/modules/profile/profile.service');

const TEST_USER_ID = 'test-leadup-user-' + Date.now();

describe('Profile Calorie Lead-Up & Transition Integration', () => {
  before(async () => {
    await prisma.user.create({
      data: {
        id: TEST_USER_ID,
        name: 'LeadUp Test User',
        email: `leadup-${Date.now()}@test.com`,
        profile: {
          create: {
            age: 28,
            gender: 'MALE',
            heightCm: 178,
            activityLevel: 'MODERATE',
            goal: 'WEIGHT_LOSS',
            targetRateKgPerWeek: -0.5,
            bmr: 1750,
            tdee: 2713,
            targetCalories: 2713,
            targetProtein: 160,
            targetCarbs: 300,
            targetFat: 75,
            targetFiber: 30,
          },
        },
      },
    });

    await prisma.weightLog.create({
      data: {
        userId: TEST_USER_ID,
        weightKg: 80,
        date: new Date(),
      },
    });
  });

  after(async () => {
    await prisma.goalHistory.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.userProfile.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  });

  it('generates lead-up schedule and sets week 1 calories when user tracks food with medium gap', async () => {
    // Current tracked intake: 2800. Target rate -0.5 kg/w gives calculated target ~2163.
    // Gap: 2163 - 2800 = -637 (MEDIUM gap -> 2 steps).
    const updated = await updateProfile(
      {
        currentlyTracksFood: true,
        currentTrackedCalories: 2800,
        targetRateKgPerWeek: -0.5,
        goal: 'WEIGHT_LOSS',
      },
      TEST_USER_ID
    );

    assert.equal(updated.leadUpActive, true);
    assert.equal(updated.leadUpTotalSteps, 2);
    assert.equal(updated.leadUpCurrentStep, 0);
    assert.ok(updated.calculatedGoalTarget < 2400);
    // Active targetCalories should be step 1 calories, NOT calculatedGoalTarget
    assert.ok(updated.targetCalories > updated.calculatedGoalTarget);
    assert.ok(updated.targetCalories < 2800);
  });

  it('advances lead-up step and completes transition on final step', async () => {
    // Current is at step 0. Advance to step 1.
    const step1 = await advanceLeadUpStep(TEST_USER_ID);
    assert.equal(step1.leadUpCurrentStep, 1);
    assert.equal(step1.targetCalories, step1.calculatedGoalTarget);

    // Advance beyond last step completes lead-up
    const completed = await advanceLeadUpStep(TEST_USER_ID);
    assert.equal(completed.leadUpActive, false);
    assert.equal(completed.targetCalories, completed.calculatedGoalTarget);
  });

  it('handles skipLeadUp flag to jump directly to calculated goal target', async () => {
    // Re-enable lead-up
    await updateProfile(
      {
        currentlyTracksFood: true,
        currentTrackedCalories: 3000,
      },
      TEST_USER_ID
    );

    const skipped = await updateProfile(
      {
        skipLeadUp: true,
      },
      TEST_USER_ID
    );

    assert.equal(skipped.leadUpActive, false);
    assert.equal(skipped.targetCalories, skipped.calculatedGoalTarget);
  });
});
