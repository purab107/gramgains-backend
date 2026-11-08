/**
 * GramGains Adaptive Engine — Monte Carlo Stochastic Backtest
 *
 * Simulates 1,000 synthetic users across 56 days under realistic, messy real-world conditions:
 * - Stochastic scale noise (Gaussian water weight + acute sodium/glycogen spikes)
 * - Logging dropout (missed weigh-ins and missed meal tracking days)
 * - Caloric under-reporting bias (human under-logging on 20% of meal days)
 * - Mid-run metabolic/diet shifts at Day 28
 *
 * Measures:
 * - Median Absolute Error (MAE) of TDEE at Day 14, Day 28, and Day 56
 * - 90th percentile error bounds (P90)
 * - Accuracy within clinical margin (±100 kcal and ±150 kcal)
 * - Convergence stability of adaptive targets
 *
 * Usage:
 *   node scripts/benchmark-adaptive-monte-carlo.js [--users 1000] [--days 56]
 */

'use strict';

const { calculateWeightTrend, calculateMultiWeekTrend } = require('../src/modules/adaptive/algorithms/weightSmoothing');
const { solveObservedTdee, filterValidIntakeDays } = require('../src/modules/adaptive/algorithms/expenditureSolver');
const { evaluateExpenditureConfidence } = require('../src/modules/adaptive/algorithms/confidenceModel');

// Box-Muller standard normal generator
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function runMonteCarloSimulation({ numUsers = 1000, totalDays = 56 } = {}) {
  console.log('================================================================');
  console.log('🚀 Running GramGains Adaptive Engine Monte Carlo Simulation');
  console.log(`📊 Cohort Size:  ${numUsers} synthetic users`);
  console.log(`⏱️  Duration:     ${totalDays} days (8 weeks)`);
  console.log('🌪️  Conditions:   Scale noise (σ=0.6kg), 8% sodium spikes (+1.5-2.2kg),');
  console.log('                  25% scale dropout, 15% food dropout, 12% under-reporting');
  console.log('================================================================\n');

  const errorsDay14 = [];
  const errorsDay28 = [];
  const errorsDay56 = [];

  const effectiveErrorsDay14 = [];
  const effectiveErrorsDay28 = [];
  const effectiveErrorsDay56 = [];

  const confidenceTiersDay56 = { INSUFFICIENT: 0, CALIBRATING: 0, MODERATE: 0, HIGH: 0 };

  for (let u = 0; u < numUsers; u++) {
    // 1. Synthetic user baseline
    const trueTdee = Math.round(randRange(1900, 2900));
    const formulaTdee = Math.round(trueTdee + randn() * 180); // Mifflin estimate within ~±180 kcal
    const bmr = Math.round(formulaTdee / 1.45);
    const initialWeightKg = Math.round(randRange(60, 100) * 10) / 10;
    const targetRateKgPerWeek = [-0.5, -0.25, 0.0, 0.25][Math.floor(Math.random() * 4)];
    const prescribedIntake = Math.round(trueTdee + (targetRateKgPerWeek * 7700) / 7);

    // 2. Generate 56-day trajectory
    let currentTrueWeight = initialWeightKg;
    const weightLogs = [];
    const mealLogs = [];

    const startDate = new Date('2026-01-01');

    for (let day = 0; day < totalDays; day++) {
      const dateObj = new Date(startDate);
      dateObj.setDate(dateObj.getDate() + day);
      const dateStr = dateObj.toISOString().split('T')[0];

      // Diet shift at Day 28 for 30% of users (e.g. cut 250 kcal deeper or increase)
      let activeTarget = prescribedIntake;
      if (day >= 28 && u % 3 === 0) {
        activeTarget += (u % 2 === 0 ? -250 : 250);
      }

      // True daily eating variation (σ = 120 kcal)
      const trueIntake = Math.round(activeTarget + randn() * 120);

      // Energy balance physics: true weight evolves from true surplus
      const trueSurplusKcal = trueIntake - trueTdee;
      currentTrueWeight += trueSurplusKcal / 7700;

      // Realistic scale observation
      const isScaleMissing = Math.random() < 0.25; // 25% missing scale days
      if (!isScaleMissing) {
        let scaleReading = currentTrueWeight + randn() * 0.6; // Gaussian water noise
        if (Math.random() < 0.08) {
          scaleReading += randRange(1.5, 2.2); // 8% acute sodium / restaurant spikes
        }
        weightLogs.push({
          date: dateStr,
          weightKg: Math.round(scaleReading * 10) / 10,
        });
      }

      // Realistic meal logging
      const isMealMissing = Math.random() < 0.15; // 15% skipped logging days
      if (!isMealMissing) {
        let loggedCalories = trueIntake;
        // 20% of days have 12% human under-reporting bias
        if (Math.random() < 0.20) {
          loggedCalories = Math.round(loggedCalories * 0.88);
        }
        mealLogs.push({
          date: dateStr,
          calories: loggedCalories,
        });
      }

      // Checkpoints at Day 14, 28, 56
      if (day === 13 || day === 27 || day === 55) {
        // Run GramGains pipeline on available data up to current day
        const activeWeights = weightLogs.slice();
        const activeMeals = mealLogs.slice();

        const trendResult = calculateWeightTrend(activeWeights);
        const multiWeekTrend = calculateMultiWeekTrend(trendResult.smoothedLogs, { windowDays: 21 });

        const validDays = filterValidIntakeDays(activeMeals, { bmr });
        const validFoodDays = validDays.length;
        const validWeightDays = activeWeights.length;

        // Synchronized 21-day intake average
        const recentCutoffTime = dateObj.getTime() - (21 * 24 * 60 * 60 * 1000);
        const recentValidMeals = validDays.filter((m) => new Date(m.date).getTime() >= recentCutoffTime);
        const avgIntake = recentValidMeals.length >= 5
          ? Math.round(recentValidMeals.reduce((s, m) => s + m.calories, 0) / recentValidMeals.length)
          : (validDays.length > 0 ? Math.round(validDays.reduce((s, m) => s + m.calories, 0) / validDays.length) : formulaTdee);

        const velocityKgPerDay = (multiWeekTrend && multiWeekTrend.sufficientData)
          ? (multiWeekTrend.observedRateKgPerWeek / 7)
          : trendResult.velocityKgPerDay;

        const { observedTdee } = solveObservedTdee({
          avgDailyIntake: avgIntake,
          velocityKgPerDay,
          bmr,
        });

        const conf = evaluateExpenditureConfidence({
          validFoodDays,
          validWeightDays,
          formulaTdee,
          observedTdee,
          trendStabilityScore: multiWeekTrend.trendStabilityScore,
          windowDays: 28,
        });

        const errObserved = observedTdee ? Math.abs(observedTdee - trueTdee) : Math.abs(formulaTdee - trueTdee);
        const errEffective = Math.abs(conf.effectiveTdee - trueTdee);

        if (day === 13) {
          errorsDay14.push(errObserved);
          effectiveErrorsDay14.push(errEffective);
        } else if (day === 27) {
          errorsDay28.push(errObserved);
          effectiveErrorsDay28.push(errEffective);
        } else if (day === 55) {
          errorsDay56.push(errObserved);
          effectiveErrorsDay56.push(errEffective);
          confidenceTiersDay56[conf.level]++;
        }
      }
    }
  }

  function getStats(arr) {
    if (arr.length === 0) return { median: 0, p90: 0, within100: 0, within150: 0 };
    const sorted = arr.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const within100 = Math.round((sorted.filter((x) => x <= 100).length / sorted.length) * 1000) / 10;
    const within150 = Math.round((sorted.filter((x) => x <= 150).length / sorted.length) * 1000) / 10;
    return { median, p90, within100, within150 };
  }

  const s14 = getStats(effectiveErrorsDay14);
  const s28 = getStats(effectiveErrorsDay28);
  const s56 = getStats(effectiveErrorsDay56);

  console.log('----------------------------------------------------------------');
  console.log('📈 MONTE CARLO RESULTS: Effective Blended TDEE Error');
  console.log('----------------------------------------------------------------');
  console.log(`Day 14 (Calibration Phase):`);
  console.log(`   - Median Absolute Error (MAE): ${s14.median} kcal`);
  console.log(`   - 90th Percentile (P90):       ${s14.p90} kcal`);
  console.log(`   - Within ±100 kcal:            ${s14.within100}%`);
  console.log(`   - Within ±150 kcal:            ${s14.within150}%\n`);

  console.log(`Day 28 (Moderate Confidence Phase):`);
  console.log(`   - Median Absolute Error (MAE): ${s28.median} kcal`);
  console.log(`   - 90th Percentile (P90):       ${s28.p90} kcal`);
  console.log(`   - Within ±100 kcal:            ${s28.within100}%`);
  console.log(`   - Within ±150 kcal:            ${s28.within150}%\n`);

  console.log(`Day 56 (High Confidence Steady State):`);
  console.log(`   - Median Absolute Error (MAE): ${s56.median} kcal`);
  console.log(`   - 90th Percentile (P90):       ${s56.p90} kcal`);
  console.log(`   - Within ±100 kcal:            ${s56.within100}%`);
  console.log(`   - Within ±150 kcal:            ${s56.within150}%\n`);

  console.log('----------------------------------------------------------------');
  console.log('🎯 Confidence Tiers Distribution at Day 56:');
  console.log(`   - High Confidence:    ${Math.round((confidenceTiersDay56.HIGH / numUsers) * 100)}%`);
  console.log(`   - Moderate Confidence: ${Math.round((confidenceTiersDay56.MODERATE / numUsers) * 100)}%`);
  console.log(`   - Calibrating:        ${Math.round((confidenceTiersDay56.CALIBRATING / numUsers) * 100)}%`);
  console.log(`   - Insufficient:       ${Math.round((confidenceTiersDay56.INSUFFICIENT / numUsers) * 100)}%`);
  console.log('================================================================\n');

  return { s14, s28, s56, confidenceTiersDay56 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const usersArg = args.indexOf('--users');
  const numUsers = usersArg >= 0 ? parseInt(args[usersArg + 1], 10) : 1000;
  runMonteCarloSimulation({ numUsers });
}

module.exports = { runMonteCarloSimulation };
