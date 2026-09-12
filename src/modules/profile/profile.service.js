const { prisma } = require('../../config/db');

const DEFAULT_USER_ID = 'default-user';

function calculateMetrics({ age, gender, heightCm, weightKg = 70, activityLevel, goal }) {
  // Mifflin-St Jeor BMR
  let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age;
  bmr += String(gender).toUpperCase() === 'FEMALE' ? -161 : 5;

  const activityMap = {
    SEDENTARY:    1.2,
    LIGHT:        1.375,
    MODERATE:     1.55,
    VERY_ACTIVE:  1.725,
    EXTRA_ACTIVE: 1.9,
  };
  const normalizedActivity = String(activityLevel || 'MODERATE').toUpperCase();
  const tdee = bmr * (activityMap[normalizedActivity] || 1.55);

  let targetCalories = tdee;
  const normalizedGoal = String(goal || 'MAINTAIN').toUpperCase();
  if (normalizedGoal === 'WEIGHT_LOSS') targetCalories = tdee - 500;
  if (normalizedGoal === 'BULK')        targetCalories = tdee + 350;

  const targetProtein = Math.round(weightKg * 2.0);
  const fatCalories   = targetCalories * 0.25;
  const targetFat     = Math.round(fatCalories / 9);
  const targetCarbs   = Math.round(Math.max(0, targetCalories - targetProtein * 4 - fatCalories) / 4);
  const targetFiber   = Math.round((targetCalories / 1000) * 14);

  return {
    bmr:            Math.round(bmr),
    tdee:           Math.round(tdee),
    targetCalories: Math.round(targetCalories),
    targetProtein,
    targetCarbs,
    targetFat,
    targetFiber,
  };
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
        ...defaults,
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

  const calculated = calculateMetrics({ age, gender, heightCm, weightKg, activityLevel, goal });

  // Update User name if provided
  if (input.name) {
    await prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
    });
  }

  // Record weight log if weightKg is updated
  if (input.weightKg !== undefined) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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

  const updatedProfile = await prisma.userProfile.update({
    where: { userId },
    data: {
      age,
      gender,
      heightCm,
      activityLevel,
      goal,
      bmr:            calculated.bmr,
      tdee:           calculated.tdee,
      targetCalories: input.customTargetCalories !== undefined ? parseFloat(input.customTargetCalories) : calculated.targetCalories,
      targetProtein:  input.customTargetProtein  !== undefined ? parseFloat(input.customTargetProtein) : calculated.targetProtein,
      targetCarbs:    input.customTargetCarbs    !== undefined ? parseFloat(input.customTargetCarbs) : calculated.targetCarbs,
      targetFat:      input.customTargetFat      !== undefined ? parseFloat(input.customTargetFat) : calculated.targetFat,
      targetFiber:    input.customTargetFiber    !== undefined ? parseFloat(input.customTargetFiber) : calculated.targetFiber,
    },
    include: { user: true },
  });

  return {
    ...updatedProfile,
    name: input.name || updatedProfile.user?.name || 'Athlete',
    weightKg,
  };
}

module.exports = { getProfile, updateProfile, calculateMetrics, DEFAULT_USER_ID };
