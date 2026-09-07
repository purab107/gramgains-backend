import { prisma } from '../../config/db';

export interface ProfileInput {
  name?: string;
  age?: number;
  gender?: 'MALE' | 'FEMALE';
  heightCm?: number;
  weightKg?: number;
  activityLevel?: 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'VERY_ACTIVE' | 'EXTRA_ACTIVE';
  goal?: 'WEIGHT_LOSS' | 'MAINTAIN' | 'BULK';
  customTargetCalories?: number;
  customTargetProtein?: number;
  customTargetCarbs?: number;
  customTargetFat?: number;
  customTargetFiber?: number;
}

export class ProfileService {
  private static DEFAULT_ID = 'default-user';

  static calculateMetrics(data: {
    age: number;
    gender: string;
    heightCm: number;
    weightKg: number;
    activityLevel: string;
    goal: string;
  }) {
    // 1. Calculate BMR using Mifflin-St Jeor Equation
    let bmr = 10 * data.weightKg + 6.25 * data.heightCm - 5 * data.age;
    if (data.gender.toUpperCase() === 'FEMALE') {
      bmr -= 161;
    } else {
      bmr += 5;
    }

    // 2. Activity Multiplier for TDEE
    let activityMultiplier = 1.55; // MODERATE
    switch (data.activityLevel.toUpperCase()) {
      case 'SEDENTARY':
        activityMultiplier = 1.2;
        break;
      case 'LIGHT':
        activityMultiplier = 1.375;
        break;
      case 'MODERATE':
        activityMultiplier = 1.55;
        break;
      case 'VERY_ACTIVE':
        activityMultiplier = 1.725;
        break;
      case 'EXTRA_ACTIVE':
        activityMultiplier = 1.9;
        break;
    }

    const tdee = bmr * activityMultiplier;

    // 3. Goal Adjustment for Target Calories
    let targetCalories = tdee;
    if (data.goal.toUpperCase() === 'WEIGHT_LOSS') {
      targetCalories = tdee - 500;
    } else if (data.goal.toUpperCase() === 'BULK') {
      targetCalories = tdee + 350;
    }

    // 4. Macro Calculation (Protein: 2g/kg, Fat: 25% of cals, Carbs: remainder)
    const targetProtein = Math.round(data.weightKg * 2.0); // 2g per kg
    const fatCalories = targetCalories * 0.25;
    const targetFat = Math.round(fatCalories / 9);

    const proteinCalories = targetProtein * 4;
    const remainingCarbCalories = Math.max(0, targetCalories - (proteinCalories + fatCalories));
    const targetCarbs = Math.round(remainingCarbCalories / 4);
    const targetFiber = Math.round((targetCalories / 1000) * 14);

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      targetCalories: Math.round(targetCalories),
      targetProtein,
      targetCarbs,
      targetFat,
      targetFiber,
    };
  }

  static async getProfile() {
    let profile = await prisma.userProfile.findUnique({
      where: { id: this.DEFAULT_ID },
    });

    if (!profile) {
      const defaultMetrics = this.calculateMetrics({
        age: 25,
        gender: 'MALE',
        heightCm: 175,
        weightKg: 70,
        activityLevel: 'MODERATE',
        goal: 'MAINTAIN',
      });

      profile = await prisma.userProfile.create({
        data: {
          id: this.DEFAULT_ID,
          name: 'Athlete',
          age: 25,
          gender: 'MALE',
          heightCm: 175,
          weightKg: 70,
          activityLevel: 'MODERATE',
          goal: 'MAINTAIN',
          ...defaultMetrics,
        },
      });
    }

    return profile;
  }

  static async updateProfile(input: ProfileInput) {
    const current = await this.getProfile();

    const age = input.age ?? current.age;
    const gender = input.gender ?? current.gender;
    const heightCm = input.heightCm ?? current.heightCm;
    const weightKg = input.weightKg ?? current.weightKg;
    const activityLevel = input.activityLevel ?? current.activityLevel;
    const goal = input.goal ?? current.goal;

    const calculated = this.calculateMetrics({
      age,
      gender,
      heightCm,
      weightKg,
      activityLevel,
      goal,
    });

    const targetCalories = input.customTargetCalories ?? calculated.targetCalories;
    const targetProtein = input.customTargetProtein ?? calculated.targetProtein;
    const targetCarbs = input.customTargetCarbs ?? calculated.targetCarbs;
    const targetFat = input.customTargetFat ?? calculated.targetFat;
    const targetFiber = input.customTargetFiber ?? calculated.targetFiber;

    return await prisma.userProfile.update({
      where: { id: this.DEFAULT_ID },
      data: {
        name: input.name ?? current.name,
        age,
        gender,
        heightCm,
        weightKg,
        activityLevel,
        goal,
        bmr: calculated.bmr,
        tdee: calculated.tdee,
        targetCalories,
        targetProtein,
        targetCarbs,
        targetFat,
        targetFiber,
      },
    });
  }
}
