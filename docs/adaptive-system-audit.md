# GramGains Adaptive System — Comprehensive Audit & Baseline Specification

> **Date:** September 2026  
> **Status:** Baseline Stabilisation (Phase 0)  
> **Target Components:** `adaptive.service.js`, `confidenceModel.js`, `expenditureSolver.js`, `weightSmoothing.js`, `profile.service.js`, `profile.prisma`

---

## 1. Executive Summary

This document serves as the formal baseline audit for the GramGains Adaptive TDEE and calorie-target system. It documents the exact current behaviors, mathematical assumptions, data pipelines, and architectural gaps across the backend adaptive subsystem prior to the multi-phase enhancements outlined in the `adaptive_system_implementation_plan.md`.

All subsequent phases will treat this document as the reference point to ensure intentional, non-breaking, and verified evolutions.

---

## 2. Current Architecture & Component Inventory

The adaptive system spans the following core files in `gramgains-backend`:

| Component | File Path | Primary Responsibilities |
|---|---|---|
| **Adaptive Service** | `src/modules/adaptive/adaptive.service.js` | Status aggregation, check-in generation, check-in application, snapshot caching. |
| **Expenditure Solver** | `src/modules/adaptive/algorithms/expenditureSolver.js` | Energy balance calculation, anti-whiplash clamps (±150 kcal), safety floors (1200/1500 kcal). |
| **Confidence Model** | `src/modules/adaptive/algorithms/confidenceModel.js` | Bayesian shrinkage between Mifflin-St Jeor formula TDEE and observed TDEE (7, 14, 21-day thresholds). |
| **Weight Smoothing** | `src/modules/adaptive/algorithms/weightSmoothing.js` | Holt linear double exponential smoothing over daily weight logs. |
| **Macro Allocator** | `src/modules/adaptive/algorithms/macroAllocator.js` | Allocates protein, carbs, fat, and fiber given total calorie target. |
| **Profile Service** | `src/modules/profile/profile.service.js` | User onboarding, profile settings, and baseline metric calculation (`calculateMetrics`). |
| **Prisma Schema** | `prisma/schema/profile.prisma` | Data definitions for `UserProfile`, `WeightLog`, `AdaptiveCheckIn`, `MetabolicSnapshot`, and `GoalHistory`. |

---

## 3. End-to-End Workflow Audit

### 3.1 `getAdaptiveStatus(userId)` Flow

1. **Timeframe:** Sets an evaluation window of `EVALUATION_DAYS = 28` days looking back from `now` (midnight).
2. **Weight Retrieval & Smoothing:**
   - Fetches `WeightLog` where `date >= cutoffDate`, ordered ascending by date.
   - Runs `calculateWeightTrend(weightLogs)` using Holt's linear smoothing ($\alpha = 0.1, \beta = 0.05$).
   - Computes daily rate of change (`velocityKgPerDay`) and weekly rate (`velocityKgPerWeek = velocityKgPerDay * 7`).
   - Resolves `latestWeight` as `latestRawKg` or falls back to `profile.weightKg || 70`.
3. **Meal Retrieval & Filtering:**
   - Fetches all `MealLog` rows where `date >= cutoffDate`.
   - Aggregates calories per calendar date (`YYYY-MM-DD`).
   - Calls `filterValidIntakeDays()` to filter out days with $< 500$ kcal (unless marked fasting).
   - Computes `avgDailyIntake = sum(validCalories) / validFoodDays`.
4. **Observed TDEE Calculation:**
   - Calls `solveObservedTdee({ avgDailyIntake, velocityKgPerDay, bmr: profile.bmr })`.
   - Formula: $\text{dailySurplusKcal} = \text{velocityKgPerDay} \times 7700$.
   - $\text{observedTdee} = \text{avgDailyIntake} - \text{dailySurplusKcal}$.
   - Bound within physiological limits $[0.85 \times \text{bmr}, 2.5 \times \text{bmr}]$.
5. **Bayesian Confidence Blending:**
   - Calls `evaluateExpenditureConfidence({ validFoodDays, validWeightDays, formulaTdee, observedTdee })`.
   - Density: $(0.6 \times \text{validFoodDays} + 0.4 \times \text{validWeightDays}) / 28$.
   - Levels: `INSUFFICIENT` ($<7$ days), `CALIBRATING` ($7-13$ days), `MODERATE` ($14-20$ days), `HIGH` ($\ge 21$ days).
   - Generates `effectiveTdee` via linear blending between formula and observed TDEE.
6. **Target Recommendation:**
   - Calls `calculateRecommendedCalories({ effectiveTdee, targetRateKgPerWeek, currentCalories, gender, bodyWeightKg })`.
   - Clamps calorie change to $\pm 150$ kcal/week vs current calories.
   - Checks safety floor ($1200$ female / $1500$ male).
7. **Macro Allocation:**
   - Calls `allocateMacros` with recommended calories.
8. **Snapshot Upsert & Profile Update:**
   - Upserts today's `MetabolicSnapshot` with raw weight, trend weight, intake, formula TDEE, observed TDEE, effective TDEE, and confidence metrics.
   - Updates `UserProfile` with `adaptiveTdee`, `confidenceLevel`, `confidenceDays`.
9. **Pending Check-In Discovery:**
   - Checks for `AdaptiveCheckIn` with status `PENDING` to populate `isCheckInAvailable` and `pendingCheckInId`.

### 3.2 `getCheckIn(userId)` Flow

1. **Pending Check:** Queries `prisma.adaptiveCheckIn.findFirst` for status `PENDING` ordered by `date` desc. If found, returns it immediately.
2. **On-Demand Generation:**
   - If no pending check-in exists, generates one immediately:
   - Fetches `getAdaptiveStatus(userId)` and `getProfile(userId)`.
   - Evaluates adherence across the **last 7 days only** (`today - 7 days`).
   - Counts days where daily calorie intake is within $\pm 10\%$ (or $\pm 100$ kcal) of target.
   - Computes `adherenceScore = (adheredDays / loggedDays) * 100`.
   - Chooses headline and rationale based on confidence level and adjustment magnitude ($>50$ or $<-50$).
   - Creates a new `AdaptiveCheckIn` record with status `PENDING`.

### 3.3 `applyCheckIn({ checkInId, action, customCalories }, userId)` Flow

1. Finds `AdaptiveCheckIn` by `id` and `userId`.
2. If `action === 'DISMISS'`, sets `status = 'DISMISSED'` on the check-in record.
3. If `action === 'ACCEPT'`, uses `checkIn.suggestedCalories`.
4. If `action === 'ADJUST'`, uses `customCalories`.
5. Allocates new macros using `allocateMacros`.
6. Executes `prisma.userProfile.update` to update `targetCalories`, `targetProtein`, `targetCarbs`, `targetFat`, `targetFiber`, `lastCheckInDate`.
7. Executes `prisma.adaptiveCheckIn.update` to set `status` to `ACCEPTED` or `ADJUSTED`, and records `appliedAt = new Date()`.
8. Returns `{ success: true, action, profile }`.

---

## 4. Key Gaps & Inconsistencies Audited

### Gap 1: Lack of Idempotency Guard in Check-In Generation (Improvement 22)
- **Current Behavior:** Whenever `getCheckIn` is called and there is no `PENDING` record (e.g., after the user just accepted or dismissed one), a brand-new `PENDING` record is immediately computed and inserted into the database.
- **Problem:** If a user accepts their check-in on Monday morning and returns to the check-in screen on Monday afternoon, the system generates a new check-in rather than recognizing that this week's review has already concluded.

### Gap 2: Non-Transactional Target Updates (Improvement 21)
- **Current Behavior:** `applyCheckIn` executes two consecutive independent Prisma queries:
  1. `prisma.userProfile.update(...)`
  2. `prisma.adaptiveCheckIn.update(...)`
- **Problem:** If the second write fails (e.g., connection drop, constraint failure), the user's profile targets are modified while the check-in remains in `PENDING` status, allowing the user to re-apply it or leading to corrupt state.

### Gap 3: Missing `GoalHistory` Writes (Improvement 11)
- **Current Behavior:** The `GoalHistory` model exists in `prisma/schema/profile.prisma` with fields for `goal`, `targetCalories`, `targetProtein`, `targetCarbs`, `targetFat`, `targetFiber`, `effectiveFrom`, and `effectiveTo`.
- **Problem:** Nowhere in `adaptive.service.js` or `profile.service.js` is `prisma.goalHistory.create` or `update` ever called. Historical target changes and adjustments are lost over time.

### Gap 4: Observation Window Discrepancy & Cadence (Improvements 1 & 12)
- **Current Behavior:**
  - `getAdaptiveStatus` uses a 28-day window (`EVALUATION_DAYS = 28`).
  - `confidenceModel.js` expects 7, 14, and 21 days for its confidence tiers.
  - `getCheckIn` calculates adherence over an isolated 7-day window (`today - 7 days`).
  - `getCheckIn` does not enforce server-side check-in day of week (`profile.checkInDayOfWeek`), meaning check-ins can be requested and created on arbitrary days.

### Gap 5: Missing Adjustment Cooldown (Improvement 2)
- **Current Behavior:** There is no tracking of `lastAdjustmentAppliedAt` on `UserProfile`.
- **Problem:** A user can apply an adjustment and immediately trigger another calorie shift the following week or even the following day without allowing biological adaptation to manifest (minimum recommended: 14 days).

### Gap 6: Duplicated Calorie Math (Improvement 6)
- **Current Behavior:**
  - `profile.service.js` has its own `calculateMetrics` implementing Mifflin-St Jeor, activity multipliers, and `(rate * 7700) / 7`.
  - `expenditureSolver.js` implements `(targetRateKgPerWeek * CALORIES_PER_KG_WEIGHT) / 7` and safety floors.
- **Problem:** Multiple sources of truth for calorie and BMR/TDEE calculations increase risk of divergence.

### Gap 7: Absence of Maintenance / Recomposition Bands (Improvements 16 & 17)
- **Current Behavior:** The system attempts to apply linear adjustments even when weight fluctuations are within normal biological water weight variance ($\pm 0.1\text{ kg/week}$).
- **Problem:** For maintenance goals (`MAINTAIN`), users experience spurious micro-adjustments instead of holding steady within a tolerance band. RECOMP is not supported as a distinct adaptive goal mode.

### Gap 8: Unidimensional Confidence Model (Improvement 8)
- **Current Behavior:** Confidence is derived strictly as a linear combination of log counts: $(0.6 \times \text{foodDays} + 0.4 \times \text{weightDays}) / 28$.
- **Problem:** It ignores logging density, clustering (e.g., logging 7 days straight vs 1 day per week for 7 weeks), and trend velocity stability/noise.

---

## 5. API Contracts Baseline

### 5.1 `getAdaptiveStatus(userId)`
```typescript
interface AdaptiveStatusResponse {
  isAdaptiveEnabled: boolean;
  confidence: {
    level: 'INSUFFICIENT' | 'CALIBRATING' | 'MODERATE' | 'HIGH';
    score: number;
    validFoodDays: number;
    validWeightDays: number;
    evaluationWindowDays: number;
    message: string;
  };
  expenditure: {
    formulaBaselineTdee: number;
    observedTdee: number | null;
    effectiveTdee: number;
    dailyEnergySurplusKcal: number;
    unit: 'kcal';
  };
  weightTrend: {
    latestRawKg: number;
    latestTrendKg: number;
    velocityKgPerDay: number;
    velocityKgPerWeek: number;
    targetVelocityKgPerWeek: number;
  };
  targets: {
    currentCalories: number;
    recommendedCalories: number;
    adjustmentKcal: number;
    isBelowSafetyFloor: boolean;
    safetyFloorKcal: number;
    isAggressiveRate: boolean;
    recommendedMacros: {
      calories: number;
      proteinGrams: number;
      carbsGrams: number;
      fatGrams: number;
      fiberGrams: number;
      macroPreset: string;
      breakdown: { proteinPct: number; carbsPct: number; fatPct: number };
    };
    isCheckInAvailable: boolean;
    pendingCheckInId: string | null;
  };
}
```

### 5.2 `getCheckIn(userId)`
```typescript
interface AdaptiveCheckInRecord {
  id: string;
  userId: string;
  date: Date;
  status: 'PENDING' | 'ACCEPTED' | 'ADJUSTED' | 'DISMISSED';
  startWeightKg: number;
  endWeightKg: number;
  trendChangeKg: number;
  avgIntakeKcal: number;
  adherenceScore: number;
  currentCalories: number;
  suggestedCalories: number;
  suggestedProtein: number;
  suggestedCarbs: number;
  suggestedFat: number;
  adjustmentKcal: number;
  headline: string;
  rationaleText: string;
  confidenceLevel: 'INSUFFICIENT' | 'CALIBRATING' | 'MODERATE' | 'HIGH';
  appliedAt: Date | null;
  userFeedback: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.3 `applyCheckIn({ checkInId, action, customCalories }, userId)`
```typescript
interface ApplyCheckInResponse {
  success: boolean;
  action: 'ACCEPT' | 'ADJUST' | 'DISMISS';
  profile?: UserProfile;
}
```

---

## 6. Verification and Regression Guard Strategy

1. **Unit Testing:** `test/adaptive/baseline.test.js` will verify the exact baseline contracts of `getAdaptiveStatus`, `getCheckIn`, and `applyCheckIn` under existing schema constraints.
2. **Continuous Verification:** Future phases (Phase 1 schema additions, Phase 2 calorie centralisation, etc.) must maintain backward-compatibility with these baseline expectations.
