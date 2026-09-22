import type { FoodRecord, AuditIssue } from '../types.ts';

/**
 * Audits FoodSource, layer combinations, and branded metadata completeness.
 */
export function auditSourceRules(food: FoodRecord): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // 1. Soft-deleted record check
  if (food.deletedAt) {
    issues.push({
      id: `soft-deleted-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'INFO',
      issueCategory: 'METADATA_SOURCE',
      issueCode: 'INFO_SOFT_DELETED_RECORD',
      field: 'deletedAt',
      storedValue: food.deletedAt.toISOString(),
      expectedValue: 'Active (null)',
      explanation: `Food record is soft-deleted as of ${food.deletedAt.toISOString()}.`,
    });
  }

  // 2. Source vs Layer mapping validation
  const EXPECTED_LAYER_MAP: Record<string, number> = {
    IFCT_2017: 1,
    INDB: 2,
    OPEN_FOOD_FACTS: 3,
    USER_CREATED: 4,
  };

  const expectedLayer = EXPECTED_LAYER_MAP[food.source];
  if (expectedLayer !== undefined && food.layer !== expectedLayer) {
    issues.push({
      id: `source-layer-mismatch-${food.id}`,
      foodId: food.id,
      foodName: food.name,
      source: food.source,
      layer: food.layer,
      category: food.category,
      brand: food.brand,
      severity: 'ERROR',
      issueCategory: 'METADATA_SOURCE',
      issueCode: 'ERR_INVALID_SOURCE_LAYER',
      field: 'layer',
      storedValue: `source=${food.source}, layer=${food.layer}`,
      expectedValue: `layer=${expectedLayer}`,
      explanation: `Invalid FoodSource/layer combination: ${food.source} must map to layer ${expectedLayer}, but found layer ${food.layer}.`,
    });
  }

  // 3. Branded / packaged foods check (Layer 3 / OPEN_FOOD_FACTS)
  if (food.source === 'OPEN_FOOD_FACTS' || food.layer === 3) {
    const hasBrand = (food.brand && food.brand.trim().length > 0) ||
                     (food.brandOwner && food.brandOwner.trim().length > 0);
    if (!hasBrand) {
      issues.push({
        id: `off-no-brand-${food.id}`,
        foodId: food.id,
        foodName: food.name,
        source: food.source,
        layer: food.layer,
        category: food.category,
        severity: 'WARNING',
        issueCategory: 'METADATA_SOURCE',
        issueCode: 'WARN_BRANDED_LACKS_MANUFACTURER',
        field: 'brand',
        storedValue: 'null',
        expectedValue: 'Manufacturer / Brand Name',
        explanation: `Packaged food from OpenFoodFacts lacks manufacturer or brand metadata.`,
      });
    }
  }

  return issues;
}
