/**
 * scripts/seed-mock-account.js
 *
 * Seeds a duplicate mock account into the database:
 *   Email: purabtest@email.com
 *   Password: @PRITESHsahare107
 * 
 * Clones all data from source user:
 *   ID: PJblzaKDFKjxPTMlkk32osuBJb6YdnPO
 */

const { prisma } = require('../src/config/db');
const { auth } = require('../src/config/auth');

const SOURCE_USER_ID = 'PJblzaKDFKjxPTMlkk32osuBJb6YdnPO';
const TARGET_EMAIL = 'purabtest@email.com';
const TARGET_PASSWORD = '@PRITESHsahare107';
const TARGET_NAME = 'purabsahare';

async function seedMockAccount() {
  console.log('====================================================');
  console.log('🚀 Starting Mock Account Seeding Process');
  console.log(`📌 Source User ID: ${SOURCE_USER_ID}`);
  console.log(`📌 Target Email:   ${TARGET_EMAIL}`);
  console.log('====================================================\n');

  // 1. Fetch complete data tree of source user
  console.log(`1️⃣ Fetching source user data for ID: ${SOURCE_USER_ID}...`);
  const sourceUser = await prisma.user.findUnique({
    where: { id: SOURCE_USER_ID },
    include: {
      profile: true,
      goalHistory: true,
      weightLogs: true,
      mealLogs: true,
      savedMeals: {
        include: {
          items: true,
        },
      },
      waterLogs: true,
      metabolicSnapshots: true,
      adaptiveCheckIns: true,
      activityLogs: true,
      favoriteFoods: true,
    },
  });

  if (!sourceUser) {
    throw new Error(`❌ Source user with ID "${SOURCE_USER_ID}" does not exist in the database.`);
  }

  console.log(`✅ Source user found: ${sourceUser.name} (${sourceUser.email})`);
  console.log(`   - Profile:             ${sourceUser.profile ? 'Present' : 'None'}`);
  console.log(`   - Adaptive Check-Ins:  ${sourceUser.adaptiveCheckIns.length}`);
  console.log(`   - Goal History:        ${sourceUser.goalHistory.length}`);
  console.log(`   - Weight Logs:         ${sourceUser.weightLogs.length}`);
  console.log(`   - Meal Logs:           ${sourceUser.mealLogs.length}`);
  console.log(`   - Saved Meals:         ${sourceUser.savedMeals.length}`);
  console.log(`   - Water Logs:          ${sourceUser.waterLogs.length}`);
  console.log(`   - Metabolic Snapshots: ${sourceUser.metabolicSnapshots.length}`);
  console.log(`   - Activity Logs:       ${sourceUser.activityLogs.length}`);
  console.log(`   - Favorite Foods:      ${sourceUser.favoriteFoods.length}\n`);

  // 2. Check for and clean up existing target account if already present
  console.log(`2️⃣ Checking if target account ${TARGET_EMAIL} already exists...`);
  const existingUser = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
  });

  if (existingUser) {
    console.log(`⚠️ User ${TARGET_EMAIL} already exists (ID: ${existingUser.id}). Deleting for clean re-seed...`);
    // Delete cascading user
    await prisma.user.delete({
      where: { id: existingUser.id },
    });
    console.log(`✅ Deleted existing user ${existingUser.id}.`);
  } else {
    console.log(`✅ Target email is available.`);
  }

  // 3. Create the user using Better-Auth API to properly generate hashed password & credential account
  console.log(`\n3️⃣ Registering new mock user via Better-Auth...`);
  const authResult = await auth.api.signUpEmail({
    body: {
      email: TARGET_EMAIL,
      password: TARGET_PASSWORD,
      name: TARGET_NAME,
    },
  });

  if (!authResult || !authResult.user) {
    throw new Error(`❌ Failed to create user via Better-Auth: ${JSON.stringify(authResult)}`);
  }

  const newUserId = authResult.user.id;
  console.log(`✅ Mock user successfully registered!`);
  console.log(`   New User ID: ${newUserId}`);

  // 4. Clone all records in an atomic transaction
  console.log(`\n4️⃣ Duplicating source user data into new account in an atomic transaction...`);

  await prisma.$transaction(async (tx) => {
    // 4a. User Profile
    if (sourceUser.profile) {
      const { id, userId, ...profileData } = sourceUser.profile;
      await tx.userProfile.upsert({
        where: { userId: newUserId },
        update: profileData,
        create: {
          ...profileData,
          userId: newUserId,
        },
      });
      console.log(`   ✓ Cloned UserProfile`);
    }

    // 4b. Adaptive Check-Ins (Cloned first to map checkInId for GoalHistory)
    const checkInIdMap = new Map(); // oldCheckInId -> newCheckInId
    if (sourceUser.adaptiveCheckIns.length > 0) {
      for (const checkIn of sourceUser.adaptiveCheckIns) {
        const { id, userId, ...checkInData } = checkIn;
        const createdCheckIn = await tx.adaptiveCheckIn.create({
          data: {
            ...checkInData,
            userId: newUserId,
          },
        });
        checkInIdMap.set(id, createdCheckIn.id);
      }
      console.log(`   ✓ Cloned ${sourceUser.adaptiveCheckIns.length} AdaptiveCheckIn records`);
    }

    // 4c. Goal History (preserving link to newly created AdaptiveCheckIn IDs)
    if (sourceUser.goalHistory.length > 0) {
      await tx.goalHistory.createMany({
        data: sourceUser.goalHistory.map(({ id, userId, checkInId, ...gh }) => ({
          ...gh,
          checkInId: checkInId ? (checkInIdMap.get(checkInId) || null) : null,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.goalHistory.length} GoalHistory records`);
    }

    // 4d. Weight Logs
    if (sourceUser.weightLogs.length > 0) {
      await tx.weightLog.createMany({
        data: sourceUser.weightLogs.map(({ id, userId, ...wl }) => ({
          ...wl,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.weightLogs.length} WeightLog records`);
    }

    // 4e. Meal Logs
    if (sourceUser.mealLogs.length > 0) {
      await tx.mealLog.createMany({
        data: sourceUser.mealLogs.map(({ id, userId, ...ml }) => ({
          ...ml,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.mealLogs.length} MealLog records`);
    }

    // 4f. Water Logs
    if (sourceUser.waterLogs.length > 0) {
      await tx.waterLog.createMany({
        data: sourceUser.waterLogs.map(({ id, userId, ...w }) => ({
          ...w,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.waterLogs.length} WaterLog records`);
    }

    // 4g. Metabolic Snapshots
    if (sourceUser.metabolicSnapshots.length > 0) {
      await tx.metabolicSnapshot.createMany({
        data: sourceUser.metabolicSnapshots.map(({ id, userId, ...ms }) => ({
          ...ms,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.metabolicSnapshots.length} MetabolicSnapshot records`);
    }

    // 4h. Saved Meals & Items
    if (sourceUser.savedMeals.length > 0) {
      let totalItemsCloned = 0;
      for (const meal of sourceUser.savedMeals) {
        const { id, userId, items, ...mealData } = meal;
        const newMeal = await tx.savedMeal.create({
          data: {
            ...mealData,
            userId: newUserId,
          },
        });

        if (items && items.length > 0) {
          totalItemsCloned += items.length;
          await tx.savedMealItem.createMany({
            data: items.map(({ id, savedMealId, ...itemData }) => ({
              ...itemData,
              savedMealId: newMeal.id,
            })),
          });
        }
      }
      console.log(`   ✓ Cloned ${sourceUser.savedMeals.length} SavedMeals (${totalItemsCloned} items)`);
    }

    // 4i. Activity Logs (if any)
    if (sourceUser.activityLogs.length > 0) {
      await tx.activityLog.createMany({
        data: sourceUser.activityLogs.map(({ id, userId, ...al }) => ({
          ...al,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.activityLogs.length} ActivityLog records`);
    }

    // 4j. Favorite Foods (if any)
    if (sourceUser.favoriteFoods.length > 0) {
      await tx.favoriteFood.createMany({
        data: sourceUser.favoriteFoods.map(({ id, userId, ...ff }) => ({
          ...ff,
          userId: newUserId,
        })),
      });
      console.log(`   ✓ Cloned ${sourceUser.favoriteFoods.length} FavoriteFood records`);
    }
  });

  // 5. Verification: test signing in with target credentials
  console.log(`\n5️⃣ Verifying login credentials with Better-Auth...`);
  const signInResult = await auth.api.signInEmail({
    body: {
      email: TARGET_EMAIL,
      password: TARGET_PASSWORD,
    },
  });

  if (!signInResult || !signInResult.user) {
    throw new Error(`❌ Verification failed: Unable to sign in with provided password.`);
  }

  console.log(`✅ Verification succeeded: Successfully authenticated as ${signInResult.user.email}`);

  // 6. Verification: verify record counts in database
  const verificationCounts = await prisma.user.findUnique({
    where: { id: newUserId },
    include: {
      profile: true,
      _count: {
        select: {
          goalHistory: true,
          weightLogs: true,
          mealLogs: true,
          savedMeals: true,
          waterLogs: true,
          metabolicSnapshots: true,
          adaptiveCheckIns: true,
          activityLogs: true,
          favoriteFoods: true,
        },
      },
    },
  });

  console.log('\n====================================================');
  console.log('🎉 SEEDING COMPLETED SUCCESSFULLY!');
  console.log('====================================================');
  console.log(`User ID:               ${verificationCounts.id}`);
  console.log(`Email:                 ${verificationCounts.email}`);
  console.log(`Password:              ${TARGET_PASSWORD}`);
  console.log(`Profile Copied:        ${verificationCounts.profile ? 'YES' : 'NO'}`);
  console.log(`Goal History Records:  ${verificationCounts._count.goalHistory}`);
  console.log(`Weight Logs:           ${verificationCounts._count.weightLogs}`);
  console.log(`Meal Logs:             ${verificationCounts._count.mealLogs}`);
  console.log(`Saved Meals:           ${verificationCounts._count.savedMeals}`);
  console.log(`Water Logs:            ${verificationCounts._count.waterLogs}`);
  console.log(`Metabolic Snapshots:   ${verificationCounts._count.metabolicSnapshots}`);
  console.log(`Adaptive Check-Ins:    ${verificationCounts._count.adaptiveCheckIns}`);
  console.log('====================================================');
}

seedMockAccount()
  .catch((err) => {
    console.error('\n❌ Fatal error seeding mock account:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
