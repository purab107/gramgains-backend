import type { AuditConfig } from './types.ts';

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  calorieRelThreshold: 0.20, // 20% relative discrepancy warning
  calorieAbsThreshold: 25, // 25 kcal absolute discrepancy warning
  calorieRelErrorThreshold: 0.50, // 50% relative discrepancy error
  calorieAbsErrorThreshold: 60, // 60 kcal absolute discrepancy error
  maxPlausibleKcalPer100g: 900, // pure fat is ~900 kcal/100g
  extremeKcalThreshold: 1000,
  maxMacroGramsPer100g: 100,
  macroSumToleranceGrams: 102.0, // accounts for moisture/ash/organic acids/rounding
  duplicateSimilarityThreshold: 0.85,
  batchSize: 2000,
  outDir: '.',
  strict: false,
  skipReferenceAdapters: false,
};

/**
 * Common Indian staple food stems that exhibit huge nutritional differences between raw and cooked states.
 * If a food contains these base words but lacks preparation state tokens, it creates high risk of 2x-3x logging errors.
 */
export const STAPLE_RAW_VS_COOKED_STEMS = [
  { stem: 'rice', vernacular: 'chawal', cookedDensityKcal: 130, rawDensityKcal: 350 },
  { stem: 'dal', vernacular: 'daal', cookedDensityKcal: 100, rawDensityKcal: 340 },
  { stem: 'lentil', vernacular: 'dal', cookedDensityKcal: 110, rawDensityKcal: 340 },
  { stem: 'rajma', vernacular: 'kidney beans', cookedDensityKcal: 110, rawDensityKcal: 330 },
  { stem: 'chole', vernacular: 'chana', cookedDensityKcal: 130, rawDensityKcal: 360 },
  { stem: 'chickpea', vernacular: 'chana', cookedDensityKcal: 130, rawDensityKcal: 360 },
  { stem: 'soya chunk', vernacular: 'soy chunks', cookedDensityKcal: 110, rawDensityKcal: 345 },
  { stem: 'soy chunk', vernacular: 'soya bari', cookedDensityKcal: 110, rawDensityKcal: 345 },
  { stem: 'soya granule', vernacular: 'soya keema', cookedDensityKcal: 110, rawDensityKcal: 345 },
  { stem: 'oat', vernacular: 'jaee', cookedDensityKcal: 70, rawDensityKcal: 380 },
  { stem: 'pasta', vernacular: 'macaroni', cookedDensityKcal: 130, rawDensityKcal: 350 },
  { stem: 'macaroni', vernacular: 'pasta', cookedDensityKcal: 130, rawDensityKcal: 350 },
  { stem: 'noodle', vernacular: 'maggi/noodles', cookedDensityKcal: 140, rawDensityKcal: 380 },
  { stem: 'potato', vernacular: 'aloo', cookedDensityKcal: 85, rawDensityKcal: 77 },
  { stem: 'sweet potato', vernacular: 'shakarkandi', cookedDensityKcal: 90, rawDensityKcal: 86 },
];

/**
 * Tokens that indicate the preparation state of a food.
 */
export const PREPARATION_STATE_TOKENS = [
  'raw',
  'dry',
  'uncooked',
  'kachha',
  'cooked',
  'boiled',
  'steamed',
  'roasted',
  'fried',
  'deep fried',
  'shallow fried',
  'baked',
  'toasted',
  'soaked',
  'prepared',
  'ready to eat',
  'paka hua',
];

/**
 * Generic unqualified food names that are overly ambiguous for users to reliably pick.
 */
export const GENERIC_AMBIGUOUS_NAMES = new Set([
  'rice',
  'dal',
  'daal',
  'roti',
  'chapati',
  'milk',
  'curd',
  'dahi',
  'paneer',
  'banana',
  'apple',
  'egg',
  'bread',
  'butter',
  'ghee',
  'oil',
  'sugar',
  'salt',
  'tea',
  'chai',
  'coffee',
  'poha',
  'upma',
  'idli',
  'dosa',
  'paratha',
  'khichdi',
  'salad',
  'soup',
  'sabzi',
  'curry',
]);

/**
 * Mapping of generic items that ideally should have common Hindi/Indian aliases.
 */
export const INDIAN_VERNACULAR_DICTIONARY: Record<string, string[]> = {
  spinach: ['palak'],
  curd: ['dahi', 'yogurt'],
  yogurt: ['dahi'],
  paneer: ['cottage cheese'],
  'cottage cheese': ['paneer'],
  fenugreek: ['methi'],
  coriander: ['dhania'],
  cumin: ['jeera'],
  turmeric: ['haldi'],
  ginger: ['adrak'],
  garlic: ['lahsun', 'lehsun'],
  chickpea: ['chana', 'chhole'],
  lentil: ['dal', 'daal'],
  wheat: ['gehu', 'atta'],
  'wheat flour': ['atta'],
  flour: ['atta', 'maida'],
  'refined flour': ['maida'],
  'gram flour': ['besan'],
  semolina: ['sooji', 'rava'],
  'kidney bean': ['rajma'],
  clarified: ['ghee'],
  buttermilk: ['chaas', 'chach', 'mattha'],
  jaggery: ['gur', 'gud'],
  cauliflower: ['gobhi', 'gobi'],
  cabbage: ['patta gobhi'],
  okra: ['bhindi', 'ladyfinger'],
  ladyfinger: ['bhindi'],
  brinjal: ['baingan', 'eggplant'],
  eggplant: ['baingan'],
  potato: ['aloo'],
  onion: ['pyaaz', 'pyaz'],
  tomato: ['tamatar'],
  pea: ['matar'],
  bittergourd: ['karela'],
  'bitter gourd': ['karela'],
  bottlegourd: ['lauki', 'ghiya'],
  'bottle gourd': ['lauki', 'ghiya'],
};

/**
 * Categories expected to have specific household units in real-world Indian diet tracking.
 */
export const HOUSEHOLD_UNIT_CATEGORY_MAP: Record<string, string[]> = {
  'Prepared Breads': ['piece', 'roti', 'paratha', 'naan', 'puri', 'phulka'],
  Breads: ['piece', 'slice', 'roti'],
  'South Indian Breakfast': ['piece', 'idli', 'dosa', 'vada', 'plate'],
  'Breakfast Dishes': ['plate', 'bowl', 'katori', 'cup'],
  'Prepared Lentils & Curries': ['bowl', 'katori', 'cup', 'serving'],
  'Dal & Legumes': ['bowl', 'katori', 'cup', 'serving'],
  'Rice & Pulao': ['bowl', 'plate', 'katori', 'cup'],
  'Prepared Rice Dishes': ['bowl', 'plate', 'katori', 'cup'],
  Beverages: ['cup', 'glass', 'mug', 'ml'],
  Soups: ['bowl', 'cup', 'mug'],
  'Chutneys & Pickles': ['tbsp', 'tsp', 'spoon'],
  'Salads & Raita': ['bowl', 'katori', 'cup'],
};

/**
 * Plausible weight ranges (in grams/ml) for common serving unit labels.
 */
export const SERVING_UNIT_PLAUSIBLE_RANGES: Record<string, { min: number; max: number }> = {
  g: { min: 0.1, max: 2000 },
  gram: { min: 0.1, max: 2000 },
  grams: { min: 0.1, max: 2000 },
  ml: { min: 1, max: 2500 },
  '100g': { min: 99, max: 101 },
  '100 g': { min: 99, max: 101 },
  piece: { min: 2, max: 500 },
  slice: { min: 5, max: 150 },
  biscuit: { min: 3, max: 60 },
  cookie: { min: 5, max: 100 },
  roti: { min: 15, max: 120 },
  chapati: { min: 15, max: 120 },
  paratha: { min: 30, max: 250 },
  bowl: { min: 50, max: 600 },
  katori: { min: 50, max: 350 },
  cup: { min: 30, max: 450 },
  glass: { min: 50, max: 600 },
  tbsp: { min: 3, max: 50 },
  tablespoon: { min: 3, max: 50 },
  tsp: { min: 1, max: 20 },
  teaspoon: { min: 1, max: 20 },
  scoop: { min: 10, max: 100 },
  plate: { min: 100, max: 800 },
  serving: { min: 10, max: 800 },
};
