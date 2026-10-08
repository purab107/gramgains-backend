const { prisma } = require('../../config/db');
const {
  calculateProfileMetrics,
  calculateSafetyFloor,
  calculateReferenceWeightKg,
} = require('../adaptive/algorithms/calorieCalculator');
const { allocateMacros } = require('../adaptive/algorithms/macroAllocator');
const { buildLeadUpSchedule } = require('../adaptive/algorithms/calorieTransition');
const { METABOLIC_MODEL_VERSION } = require('../../config/metabolicModelVersion');

const DEFAULT_USER_ID = 'default-user';

function calculateMetrics(params) {
  return calculateProfileMetrics(params);
}

async function ensureDefaultUser() {
  let user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    include: { profile: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: DEFAULT_USER_ID,
        name: 'Athlete',
        email: 'athlete@gramgains.app',
        emailVerified: true,
        profile: {
          create: {
            age: 25,
            gender: 'MALE',
            heightCm: 175,
            activityLevel: 'MODERATE',
            goal: 'MAINTAIN',
            timezone: 'UTC',
            bmr: 1650,
            tdee: 2200,
            targetCalories: 2200,
            targetProtein: 140,
            targetCarbs: 250,
            targetFat: 65,
            targetFiber: 30,
            onboardingCompleted: true,
          },
        },
      },
      include: { profile: true },
    });

    // Create initial weight log
    await prisma.weightLog.create({
      data: {
        userId: DEFAULT_USER_ID,
        weightKg: 70,
        date: new Date(),
      },
    });
  }

  return user;
}

async function getProfile(userId = DEFAULT_USER_ID) {
  // Note: For authenticated users, the user row is created by better-auth on signup.
  // We only need to ensure the profile row exists (upsert below handles that).
  let profile = await prisma.userProfile.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!profile) {
    const defaults = calculateMetrics({
      age: 25, gender: 'MALE', heightCm: 175, weightKg: 70, activityLevel: 'MODERATE', goal: 'MAINTAIN',
    });
    profile = await prisma.userProfile.create({
      data: {
        userId,
        age: 25,
        gender: 'MALE',
        heightCm: 175,
        activityLevel: 'MODERATE',
        goal: 'MAINTAIN',
        timezone: 'UTC',
        onboardingCompleted: false,
        bmr: defaults.bmr,
        tdee: defaults.tdee,
        targetCalories: defaults.targetCalories,
        targetProtein: defaults.targetProtein,
        targetCarbs: defaults.targetCarbs,
        targetFat: defaults.targetFat,
        targetFiber: defaults.targetFiber,
        targetRateKgPerWeek: defaults.targetRateKgPerWeek || 0,
      },
      include: { user: true },
    });
  }

  // Fetch latest weight
  const latestWeight = await prisma.weightLog.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });

  return {
    ...profile,
    name: profile.user?.name || 'Athlete',
    weightKg: latestWeight ? latestWeight.weightKg : 70,
  };
}

async function updateProfile(input, userId = DEFAULT_USER_ID) {
  const current = await getProfile(userId);

  const age           = input.age           !== undefined ? parseInt(input.age, 10) : current.age;
  const gender        = input.gender        ? String(input.gender).toUpperCase() : current.gender;
  const heightCm      = input.heightCm      !== undefined ? parseFloat(input.heightCm) : current.heightCm;
  const weightKg      = input.weightKg      !== undefined ? parseFloat(input.weightKg) : current.weightKg;
  const activityLevel = input.activityLevel ? String(input.activityLevel).toUpperCase() : current.activityLevel;
  const goal          = input.goal          ? String(input.goal).toUpperCase() : current.goal;

  const targetRateKgPerWeek = input.targetRateKgPerWeek !== undefined
    ? parseFloat(input.targetRateKgPerWeek)
    : current.targetRateKgPerWeek;
  const targetWeightKg = input.targetWeightKg !== undefined
    ? (input.targetWeightKg ? parseFloat(input.targetWeightKg) : null)
    : current.targetWeightKg;
  const macroPreset = input.macroPreset
    ? String(input.macroPreset).toUpperCase()
    : (current.macroPreset || 'BALANCED');
  const proteinGramsPerKg = input.proteinGramsPerKg !== undefined
    ? parseFloat(input.proteinGramsPerKg)
    : (current.proteinGramsPerKg || 1.8);
  const fatPercent = input.fatPercent !== undefined
    ? parseFloat(input.fatPercent)
    : (current.fatPercent || 28.0);
  const isAdaptiveEnabled = input.isAdaptiveEnabled !== undefined
    ? Boolean(input.isAdaptiveEnabled)
    : (current.isAdaptiveEnabled !== false);
  const checkInDayOfWeek = input.checkInDayOfWeek !== undefined
    ? parseInt(input.checkInDayOfWeek, 10)
    : (current.checkInDayOfWeek || 1);

  const currentlyTracksFood = input.currentlyTracksFood !== undefined
    ? Boolean(input.currentlyTracksFood)
    : current.currentlyTracksFood;
  const currentTrackedCalories = input.currentTrackedCalories !== undefined
    ? (input.currentTrackedCalories ? parseFloat(input.currentTrackedCalories) : null)
    : current.currentTrackedCalories;
  const currentTrackedProtein = input.currentTrackedProtein !== undefined
    ? (input.currentTrackedProtein ? parseFloat(input.currentTrackedProtein) : null)
    : current.currentTrackedProtein;

  const calculated = calculateMetrics({
    age,
    gender,
    heightCm,
    weightKg,
    activityLevel,
    goal,
    targetRateKgPerWeek,
    targetWeightKg,
    macroPreset,
    proteinGramsPerKg,
    fatPercent,
  });

  // Update User name if provided
  if (input.name) {
    await prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
    });
  }

  // Record weight log if weightKg is updated
  if (input.weightKg !== undefined) {
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    await prisma.weightLog.upsert({
      where: {
        userId_date: {
          userId,
          date: today,
        },
      },
      update: { weightKg },
      create: {
        userId,
        weightKg,
        date: today,
      },
    });
  }

  const safetyFloor = calculateSafetyFloor({ gender });
  const referenceWeightKg = calculateReferenceWeightKg({ heightCm, weightKg, targetWeightKg });

  let leadUpActive = false;
  let leadUpStartDate = null;
  let leadUpTotalSteps = null;
  let leadUpCurrentStep = 0;
  let leadUpScheduleJson = null;
  const calculatedGoalTarget = calculated.targetCalories;
  let activeTargetCalories = calculated.targetCalories;

  if (input.skipLeadUp) {
    leadUpActive = false;
    leadUpStartDate = null;
    leadUpTotalSteps = null;
    leadUpCurrentStep = 0;
    leadUpScheduleJson = null;
    activeTargetCalories = current.calculatedGoalTarget || calculated.targetCalories;
  } else if (input.customTargetCalories !== undefined) {
    leadUpActive = false;
    leadUpStartDate = null;
    leadUpTotalSteps = null;
    leadUpCurrentStep = 0;
    leadUpScheduleJson = null;
    activeTargetCalories = parseFloat(input.customTargetCalories);
  } else {
    const schedule = buildLeadUpSchedule({
      currentIntake: currentTrackedCalories,
      calculatedTarget: calculated.targetCalories,
      estimatedMaintenance: calculated.tdee,
      safetyFloor,
      currentlyTracksFood,
      daysSinceOnboarding: 0,
    });

    if (schedule.hasLeadUp) {
      leadUpActive = true;
      leadUpStartDate = current.leadUpStartDate || new Date();
      leadUpTotalSteps = schedule.steps.length;
      leadUpCurrentStep = 0;
      leadUpScheduleJson = schedule;
      activeTargetCalories = schedule.steps[0].targetCalories;
    } else {
      leadUpActive = false;
      leadUpStartDate = null;
      leadUpTotalSteps = null;
      leadUpCurrentStep = 0;
      leadUpScheduleJson = schedule;
      activeTargetCalories = calculated.targetCalories;
    }
  }

  // Allocate macros for active target calories
  const activeMacros = allocateMacros({
    targetCalories: activeTargetCalories,
    bodyWeightKg: weightKg,
    referenceWeightKg,
    macroPreset,
    proteinGramsPerKg,
    fatPercent,
  });

  const updatedProfile = await prisma.userProfile.update({
    where: { userId },
    data: {
      age,
      gender,
      heightCm,
      activityLevel,
      goal,
      targetRateKgPerWeek,
      targetWeightKg,
      macroPreset,
      proteinGramsPerKg,
      fatPercent,
      isAdaptiveEnabled,
      checkInDayOfWeek,
      currentlyTracksFood,
      currentTrackedCalories,
      currentTrackedProtein,
      leadUpActive,
      leadUpStartDate,
      leadUpTotalSteps,
      leadUpCurrentStep,
      leadUpScheduleJson,
      calculatedGoalTarget,
      bmr:            calculated.bmr,
      tdee:           calculated.tdee,
      targetCalories: activeTargetCalories,
      targetProtein:  input.customTargetProtein  !== undefined ? parseFloat(input.customTargetProtein) : activeMacros.proteinGrams,
      targetCarbs:    input.customTargetCarbs    !== undefined ? parseFloat(input.customTargetCarbs) : activeMacros.carbsGrams,
      targetFat:      input.customTargetFat      !== undefined ? parseFloat(input.customTargetFat) : activeMacros.fatGrams,
      targetFiber:    input.customTargetFiber    !== undefined ? parseFloat(input.customTargetFiber) : activeMacros.fiberGrams,
      ...(input.onboardingCompleted !== undefined ? { onboardingCompleted: Boolean(input.onboardingCompleted) } : {}),
    },
    include: { user: true },
  });

  // Track in GoalHistory if target calories or goal changed (Improvement 11 & 20)
  if (
    updatedProfile.targetCalories !== current.targetCalories ||
    updatedProfile.goal !== current.goal
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.goalHistory.updateMany({
      where: { userId, effectiveTo: null },
      data: { effectiveTo: today },
    });

    await prisma.goalHistory.create({
      data: {
        userId,
        goal: updatedProfile.goal,
        targetCalories: updatedProfile.targetCalories,
        previousCalories: current.targetCalories,
        adjustmentKcal: updatedProfile.targetCalories - current.targetCalories,
        targetProtein: updatedProfile.targetProtein,
        targetCarbs: updatedProfile.targetCarbs,
        targetFat: updatedProfile.targetFat,
        targetFiber: updatedProfile.targetFiber,
        effectiveFrom: today,
        targetRateKgPerWeek: updatedProfile.targetRateKgPerWeek,
        reason: leadUpActive
          ? `Starting calorie lead-up (Step 1 of ${leadUpTotalSteps})`
          : (input.skipLeadUp ? 'Skipped calorie lead-up to goal target' : 'Manual profile update'),
        reasonCode: leadUpActive ? 'LEAD_UP_STEP_ADVANCE' : 'KEEP_CURRENT_TARGET',
        isSystemRecommended: leadUpActive,
        isUserConfirmed: true,
        metabolicModelVersion: METABOLIC_MODEL_VERSION,
      },
    });
  }

  return {
    ...updatedProfile,
    name: input.name || updatedProfile.user?.name || 'Athlete',
    weightKg,
  };
}

/**
 * Advances the user's active calorie lead-up to the next step.
 * Called automatically during weekly check-in or when a step period concludes.
 */
async function advanceLeadUpStep(userId = DEFAULT_USER_ID) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!profile || !profile.leadUpActive || !profile.leadUpScheduleJson) {
    return profile;
  }

  const schedule = profile.leadUpScheduleJson;
  const currentStep = profile.leadUpCurrentStep ?? 0;
  const nextStepIndex = currentStep + 1;
  const totalSteps = schedule.steps ? schedule.steps.length : (profile.leadUpTotalSteps || 1);

  const latestWeight = await prisma.weightLog.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });
  const bodyWeightKg = latestWeight ? latestWeight.weightKg : 70;
  const referenceWeightKg = calculateReferenceWeightKg({
    heightCm: profile.heightCm,
    weightKg: bodyWeightKg,
    targetWeightKg: profile.targetWeightKg,
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isCompleted = nextStepIndex >= totalSteps;
  const nextTarget = isCompleted
    ? (profile.calculatedGoalTarget || profile.targetCalories)
    : schedule.steps[nextStepIndex].targetCalories;

  const macros = allocateMacros({
    targetCalories: nextTarget,
    bodyWeightKg,
    referenceWeightKg,
    macroPreset: profile.macroPreset,
    proteinGramsPerKg: profile.proteinGramsPerKg,
    fatPercent: profile.fatPercent,
  });

  const updatedProfile = await prisma.userProfile.update({
    where: { userId },
    data: {
      leadUpActive: !isCompleted,
      leadUpCurrentStep: isCompleted ? totalSteps - 1 : nextStepIndex,
      targetCalories: nextTarget,
      targetProtein: macros.proteinGrams,
      targetCarbs: macros.carbsGrams,
      targetFat: macros.fatGrams,
      targetFiber: macros.fiberGrams,
    },
    include: { user: true },
  });

  await prisma.goalHistory.updateMany({
    where: { userId, effectiveTo: null },
    data: { effectiveTo: today },
  });

  await prisma.goalHistory.create({
    data: {
      userId,
      goal: profile.goal,
      targetCalories: nextTarget,
      previousCalories: profile.targetCalories,
      adjustmentKcal: nextTarget - profile.targetCalories,
      targetProtein: macros.proteinGrams,
      targetCarbs: macros.carbsGrams,
      targetFat: macros.fatGrams,
      targetFiber: macros.fiberGrams,
      effectiveFrom: today,
      targetRateKgPerWeek: profile.targetRateKgPerWeek,
      reason: isCompleted
        ? 'Completed calorie lead-up to final goal target'
        : `Advanced to lead-up step ${schedule.steps[nextStepIndex].weekNumber}`,
      reasonCode: 'LEAD_UP_STEP_ADVANCE',
      isSystemRecommended: true,
      isUserConfirmed: true,
      metabolicModelVersion: METABOLIC_MODEL_VERSION,
    },
  });

  return updatedProfile;
}

async function checkEmailExists(email) {
  if (!email || typeof email !== 'string') return false;
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });
  return Boolean(user);
}

module.exports = {
  getProfile,
  updateProfile,
  calculateMetrics,
  advanceLeadUpStep,
  checkEmailExists,
  DEFAULT_USER_ID,
};
