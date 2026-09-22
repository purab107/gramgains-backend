import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import type { FoodRecord, AuditIssue } from '../types.ts';
import { normalizeText } from '../normalizer.ts';

/**
 * Local Reference Dataset Adapter for INDB 2024.
 * Compares database records against Anuvaad_INDB_2024.11 (1).xlsx.
 * Strictly read-only, never modifies data.
 */
export class IndbReferenceAdapter {
  private indbMap = new Map<string, any>();
  private loaded = false;

  private xlsxPath: string;

  constructor(xlsxPath: string) {
    this.xlsxPath = xlsxPath;
  }

  public load(): boolean {
    if (!fs.existsSync(this.xlsxPath)) {
      return false;
    }
    try {
      const workbook = XLSX.readFile(this.xlsxPath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any>(sheet);

      for (const r of rows) {
        const foodCode = (r['food_code'] || r['foodcode'] || r['code'] || '').toString().trim();
        const foodName = (r['food_name'] || r['foodname'] || r['name'] || '').toString().trim();
        if (foodCode) {
          this.indbMap.set(foodCode, r);
        }
        if (foodName) {
          this.indbMap.set(`name::${normalizeText(foodName)}`, r);
        }
      }
      this.loaded = true;
      return true;
    } catch {
      return false;
    }
  }

  public auditFood(food: FoodRecord): AuditIssue[] {
    if (!this.loaded || food.source !== 'INDB') return [];

    const issues: AuditIssue[] = [];
    // foodCode is stored in aliases[0]
    const foodCode = food.aliases && food.aliases.length > 0 ? food.aliases[0] : null;
    let refRow = foodCode ? this.indbMap.get(foodCode) : null;
    if (!refRow) {
      refRow = this.indbMap.get(`name::${normalizeText(food.name)}`);
    }

    if (!refRow) return [];

    const refKcal = parseFloat(refRow['energy_kcal']);
    const refProtein = parseFloat(refRow['protein_g']);
    const refCarbs = parseFloat(refRow['carb_g']);
    const refFat = parseFloat(refRow['fat_g']);

    if (!isNaN(refKcal) && Math.abs(food.calories - refKcal) > 2.0) {
      issues.push({
        id: `ref-diff-kcal-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        severity: 'WARNING',
        issueCategory: 'REFERENCE_DIFF',
        issueCode: 'WARN_REFERENCE_MISMATCH',
        field: 'calories',
        storedValue: food.calories,
        expectedValue: refKcal,
        discrepancy: `${(food.calories - refKcal).toFixed(1)} kcal`,
        explanation: `Database calories (${food.calories}) differ from authoritative INDB 2024 source row (${refKcal} kcal).`,
      });
    }

    if (!isNaN(refProtein) && Math.abs(food.protein - refProtein) > 1.0) {
      issues.push({
        id: `ref-diff-protein-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        severity: 'WARNING',
        issueCategory: 'REFERENCE_DIFF',
        issueCode: 'WARN_REFERENCE_MISMATCH',
        field: 'protein',
        storedValue: food.protein,
        expectedValue: refProtein,
        discrepancy: `${(food.protein - refProtein).toFixed(1)} g`,
        explanation: `Database protein (${food.protein}g) differs from authoritative INDB 2024 source row (${refProtein}g).`,
      });
    }

    return issues;
  }
}
