/**
 * Energy Balance Service
 *
 * Isolates the conversion between weight velocity and energy surplus.
 * This abstraction allows for future model upgrades (e.g., body-composition-aware models).
 *
 * Model v1: Simple 7700 kcal/kg approximation (standard tissue caloric equivalent)
 * Future: Model v2 could differentiate between fat (9441 kcal/kg) and lean mass (~1000 kcal/kg)
 */

const CURRENT_MODEL_VERSION = 1;
const CALORIES_PER_KG = 7700; // Standard tissue caloric equivalent

/**
 * Converts a weight velocity (kg/day) to daily energy surplus (kcal/day).
 *
 * @param {number} velocityKgPerDay - Weight change rate in kg/day (positive = gain, negative = loss)
 * @param {Object} [options]
 * @param {number} [options.modelVersion=CURRENT_MODEL_VERSION] - Model version to use
 * @returns {number} Daily energy surplus in kcal/day
 */
function weightVelocityToEnergy(velocityKgPerDay, { modelVersion = CURRENT_MODEL_VERSION } = {}) {
  if (typeof velocityKgPerDay !== 'number' || isNaN(velocityKgPerDay)) {
    return 0;
  }

  if (modelVersion === 1) {
    return Math.round(velocityKgPerDay * CALORIES_PER_KG);
  }

  throw new Error(`Unsupported model version: ${modelVersion}`);
}

/**
 * Converts a daily energy surplus (kcal/day) to weight velocity (kg/day).
 *
 * @param {number} dailySurplusKcal - Daily energy surplus in kcal/day (positive = surplus, negative = deficit)
 * @param {Object} [options]
 * @param {number} [options.modelVersion=CURRENT_MODEL_VERSION] - Model version to use
 * @returns {number} Weight velocity in kg/day
 */
function energyToWeightVelocity(dailySurplusKcal, { modelVersion = CURRENT_MODEL_VERSION } = {}) {
  if (typeof dailySurplusKcal !== 'number' || isNaN(dailySurplusKcal)) {
    return 0;
  }

  if (modelVersion === 1) {
    return dailySurplusKcal / CALORIES_PER_KG;
  }

  throw new Error(`Unsupported model version: ${modelVersion}`);
}

module.exports = {
  weightVelocityToEnergy,
  energyToWeightVelocity,
  CURRENT_MODEL_VERSION,
  CALORIES_PER_KG,
};
