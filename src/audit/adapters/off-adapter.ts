import fs from 'fs';
import readline from 'readline';
import type { FoodRecord, AuditIssue } from '../types.ts';

/**
 * Local Reference Dataset Adapter for OpenFoodFacts CSV.
 * Reads the curated import CSV and indexes by barcode for validation.
 * Strictly read-only, never modifies data.
 */
export class OffReferenceAdapter {
  private barcodeMap = new Map<string, { calories: number; protein: number; carbs: number; fat: number; brand: string }>();
  private loaded = false;

  private csvPath: string;

  constructor(csvPath: string) {
    this.csvPath = csvPath;
  }

  public async load(maxRecords = 25000): Promise<boolean> {
    if (!fs.existsSync(this.csvPath)) {
      return false;
    }
    try {
      const rl = readline.createInterface({
        input: fs.createReadStream(this.csvPath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      let header: string[] | null = null;
      let headerMap: Record<string, number> = {};
      let count = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (!header) {
          header = line.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
          header.forEach((name, idx) => {
            headerMap[name] = idx;
          });
          continue;
        }

        const cols = line.split(',').map((val) => val.replace(/^"|"$/g, '').trim());
        const barcode = cols[headerMap['barcode']];
        if (barcode && barcode.length > 3) {
          this.barcodeMap.set(barcode, {
            calories: parseFloat(cols[headerMap['calories']]) || 0,
            protein: parseFloat(cols[headerMap['protein']]) || 0,
            carbs: parseFloat(cols[headerMap['carbohydrates']]) || 0,
            fat: parseFloat(cols[headerMap['fat']]) || 0,
            brand: cols[headerMap['brand']] || '',
          });
        }
        count++;
        if (count >= maxRecords) break;
      }

      this.loaded = true;
      return true;
    } catch {
      return false;
    }
  }

  public auditFood(food: FoodRecord): AuditIssue[] {
    if (!this.loaded || food.source !== 'OPEN_FOOD_FACTS' || !food.barcode) return [];

    const ref = this.barcodeMap.get(food.barcode);
    if (!ref) return [];

    const issues: AuditIssue[] = [];

    if (Math.abs(food.calories - ref.calories) > 5.0) {
      issues.push({
        id: `off-diff-kcal-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        brand: food.brand,
        barcode: food.barcode,
        severity: 'WARNING',
        issueCategory: 'REFERENCE_DIFF',
        issueCode: 'WARN_REFERENCE_MISMATCH',
        field: 'calories',
        storedValue: food.calories,
        expectedValue: ref.calories,
        discrepancy: `${(food.calories - ref.calories).toFixed(1)} kcal`,
        explanation: `Database calories (${food.calories}) diverge from raw OpenFoodFacts CSV entry (${ref.calories} kcal).`,
      });
    }

    return issues;
  }
}
