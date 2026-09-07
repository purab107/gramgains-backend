const { prisma } = require('../../config/db');

const DEFAULT_ID = 'default-user';

function calculateMetrics({ age, gender, heightCm, weightKg, activityLevel, goal }) {
  // Mifflin-St Jeor BMR
  let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age;
  bmr += gender.toUpperCase() === 'FEMALE' ? -161 : 5;

  const activityMap = {
    SEDENTARY:    1.2,
    LIGHT:        1.375,
    MODERATE:     1.55,
    VERY_ACTIVE:  1.725,
    EXTRA_ACTIVE: 1.9,
  };
  const tdee = bmr * (activityMap[activityLevel.toUpperCase()] || 1.55);

  let targetCalories = tdee;
  if (goal.toUpperCase() === 'WEIGHT_LOSS') targetCalories = tdee - 500;
  if (goal.toUpperCase() === 'BULK')        targetCalories = tdee + 350;

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

async function getProfile() {
  let profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_ID } });

  if (!profile) {
    const defaults = calculateMetrics({
      age: 25, gender: 'MALE', heightCm: 175, weightKg: 70, activityLevel: 'MODERATE', goal: 'MAINTAIN',
    });
    profile = await prisma.userProfile.create({
      data: { id: DEFAULT_ID, name: 'Athlete', age: 25, gender: 'MALE', heightCm: 175, weightKg: 70, activityLevel: 'MODERATE', goal: 'MAINTAIN', ...defaults },
    });
  }

  return profile;
}

async function updateProfile(input) {
  const current = await getProfile();

  const age           = input.age           ?? current.age;
  const gender        = input.gender        ?? current.gender;
  const heightCm      = input.heightCm      ?? current.heightCm;
  const weightKg      = input.weightKg      ?? current.weightKg;
  const activityLevel = input.activityLevel ?? current.activityLevel;
  const goal          = input.goal          ?? current.goal;

  const calculated = calculateMetrics({ age, gender, heightCm, weightKg, activityLevel, goal });

  return await prisma.userProfile.update({
    where: { id: DEFAULT_ID },
    data: {
      name:           input.name ?? current.name,
      age, gender, heightCm, weightKg, activityLevel, goal,
      bmr:            calculated.bmr,
      tdee:           calculated.tdee,
      targetCalories: input.customTargetCalories ?? calculated.targetCalories,
      targetProtein:  input.customTargetProtein  ?? calculated.targetProtein,
      targetCarbs:    input.customTargetCarbs     ?? calculated.targetCarbs,
      targetFat:      input.customTargetFat       ?? calculated.targetFat,
      targetFiber:    input.customTargetFiber     ?? calculated.targetFiber,
    },
  });
}

module.exports = { getProfile, updateProfile, calculateMetrics };
