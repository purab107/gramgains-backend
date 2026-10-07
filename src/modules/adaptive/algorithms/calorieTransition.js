/**
 * Calorie Transition & Lead-Up Algorithm
 *
 * Intelligently bridges the gap between a user's current daily calorie intake (Anchor A)
 * and the calculated goal target (Anchor B) over a structured weekly lead-up schedule.
 *
 * Avoids abrupt metabolic or behavioural shocks by staging adjustments in 1–3 manageable
 * weekly steps when a meaningful gap exists.
 */

const GAP_THRESHOLDS = {
  NEGLIGIBLE: 150,
  SMALL: 350,
  MEDIUM: 700,
};

const STEP_COUNTS = {
  NEGLIGIBLE: 0,
  SMALL: 1,
  MEDIUM: 2,
  LARGE: 3,
};

const DAYS_PER_STEP = 7;

/**
 * Classifies the calorie gap into qualitative magnitude buckets.
 *
 * @param {number} gap - Signed or unsigned calorie difference (target - intake)
 * @returns {'NEGLIGIBLE'|'SMALL'|'MEDIUM'|'LARGE'}
 */
function classifyGap(gap) {
  const absGap = Math.abs(Number(gap) || 0);
  if (absGap < GAP_THRESHOLDS.NEGLIGIBLE) return 'NEGLIGIBLE';
  if (absGap <= GAP_THRESHOLDS.SMALL) return 'SMALL';
  if (absGap <= GAP_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LARGE';
}

/**
 * Computes the 0-based active step index given the schedule and elapsed days.
 *
 * @param {object} schedule - CalorieLeadUpSchedule
 * @param {number} daysSinceOnboarding - Elapsed days since leadUpStartDate
 * @returns {number}
 */
function computeActiveStepIndex(schedule, daysSinceOnboarding = 0) {
  if (!schedule || !schedule.steps || schedule.steps.length === 0) {
    return 0;
  }
  const days = Math.max(0, Number(daysSinceOnboarding) || 0);
  const index = Math.floor(days / DAYS_PER_STEP);
  return Math.min(index, schedule.steps.length - 1);
}

/**
 * Builds the gradual calorie lead-up schedule.
 *
 * @param {object} params
 * @param {number} params.currentIntake - Anchor A (current tracked calories)
 * @param {number} params.calculatedTarget - Anchor B (algorithm goal calories)
 * @param {number} [params.estimatedMaintenance=0] - Anchor C (TDEE baseline)
 * @param {number} [params.safetyFloor=0] - Clinical safety floor (e.g. 1500 M / 1200 F)
 * @param {boolean} [params.currentlyTracksFood=true] - Whether user already tracks
 * @param {number} [params.daysSinceOnboarding=0] - Days elapsed since lead-up start
 * @returns {object} CalorieLeadUpSchedule
 */
function buildLeadUpSchedule({
  currentIntake,
  calculatedTarget,
  estimatedMaintenance = 0,
  safetyFloor = 0,
  currentlyTracksFood = true,
  daysSinceOnboarding = 0,
} = {}) {
  const intake = Math.round(Number(currentIntake) || 0);
  const target = Math.round(Number(calculatedTarget) || 0);
  const maintenance = Math.round(Number(estimatedMaintenance) || 0);
  const floor = Math.round(Number(safetyFloor) || 0);

  const effectiveTarget = floor > 0 ? Math.max(floor, target) : target;
  const gapCalories = effectiveTarget - intake;
  const gapClass = classifyGap(gapCalories);

  // Eligibility requirements:
  // 1. User tracks food at onboarding
  // 2. Intake is positive
  // 3. Gap is not negligible (|gap| >= 150 kcal)
  // 4. Current intake is not below clinical safety floor (undereating requires direct intervention)
  const isEligible = Boolean(
    currentlyTracksFood &&
    intake > 0 &&
    gapClass !== 'NEGLIGIBLE' &&
    (floor === 0 || intake >= floor)
  );

  if (!isEligible) {
    return {
      hasLeadUp: false,
      currentIntake: intake,
      calculatedTarget: effectiveTarget,
      estimatedMaintenance: maintenance,
      gapCalories,
      gapClass,
      steps: [],
      activeStepIndex: 0,
    };
  }

  const stepCount = STEP_COUNTS[gapClass];
  const stepDelta = Math.round(gapCalories / stepCount);

  const steps = [];
  let prevCalories = intake;

  for (let i = 1; i <= stepCount; i++) {
    const isLast = i === stepCount;
    let stepTarget;

    if (isLast) {
      stepTarget = effectiveTarget;
    } else {
      stepTarget = intake + stepDelta * i;
      if (floor > 0) {
        stepTarget = Math.max(floor, stepTarget);
      }
    }

    const deltaFromPrevious = stepTarget - prevCalories;
    prevCalories = stepTarget;

    steps.push({
      weekNumber: i,
      targetCalories: stepTarget,
      deltaFromPrevious,
      isInitialTarget: isLast,
    });
  }

  const activeStepIndex = computeActiveStepIndex({ steps }, daysSinceOnboarding);

  return {
    hasLeadUp: true,
    currentIntake: intake,
    calculatedTarget: effectiveTarget,
    estimatedMaintenance: maintenance,
    gapCalories,
    gapClass,
    steps,
    activeStepIndex,
  };
}

/**
 * Returns the active calorie target for a given schedule and elapsed days.
 *
 * @param {object} schedule - CalorieLeadUpSchedule
 * @param {number} [daysSinceOnboarding] - Elapsed days (optional if activeStepIndex is set)
 * @returns {number}
 */
function getActiveCalorieTarget(schedule, daysSinceOnboarding) {
  if (!schedule) return 0;
  if (!schedule.hasLeadUp || !schedule.steps || schedule.steps.length === 0) {
    return schedule.calculatedTarget || 0;
  }

  const index = daysSinceOnboarding !== undefined
    ? computeActiveStepIndex(schedule, daysSinceOnboarding)
    : (schedule.activeStepIndex ?? 0);

  const step = schedule.steps[index] || schedule.steps[schedule.steps.length - 1];
  return step ? step.targetCalories : (schedule.calculatedTarget || 0);
}

module.exports = {
  GAP_THRESHOLDS,
  STEP_COUNTS,
  DAYS_PER_STEP,
  classifyGap,
  computeActiveStepIndex,
  buildLeadUpSchedule,
  getActiveCalorieTarget,
};
