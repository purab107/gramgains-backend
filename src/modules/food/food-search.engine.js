/**
 * Relevance-based and token-aware food search engine.
 */

/**
 * Normalizes text by removing diacritics, punctuation, converting to lowercase,
 * and collapsing whitespace.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits normalized text into individual non-empty tokens.
 */
function tokenize(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Scores a food record against a normalized query and its tokens.
 *
 * Scoring Hierarchy:
 * 1. Exact full-name match: +15,000 points (highest boost)
 * 2. Full-phrase match / prefix in name:
 *    - Name starts with query: +4,000 points
 *    - Name contains full query phrase: +2,000 points
 * 3. Query term completeness (satisfaction across any field):
 *    - All query tokens satisfied by the same record: +5,000 points
 *    - Partial token coverage: (satisfied / total) * 2,000 points
 * 4. Name token matches:
 *    - Exact token match in name: +1,500 points per token
 *    - Prefix token match in name: +750 points per token
 *    - Substring match in name: +250 points per token
 * 5. Alias matches:
 *    - Exact alias match to full query: +4,000 points
 *    - Full query phrase inside an alias: +2,000 points
 *    - Exact token in alias: +600 points
 *    - Prefix token in alias: +300 points
 *    - Substring in alias: +120 points
 * 6. Brand matches:
 *    - Exact brand match to full query: +3,000 points
 *    - Full query phrase in brand: +1,500 points
 *    - Exact token in brand: +600 points
 *    - Prefix token in brand: +300 points
 *    - Substring in brand: +120 points
 * 7. GenericName matches:
 *    - Exact genericName match to full query: +3,000 points
 *    - Full query phrase in genericName: +1,500 points
 *    - Exact token in genericName: +500 points
 *    - Prefix token in genericName: +250 points
 *    - Substring in genericName: +100 points
 * 8. Dynamic simple/generic food adjustments (no hardcoded word lists):
 *    - Layer adjustments: Layer 1 (raw whole foods) +1,200, Layer 2 (standard recipes) +400, Layer 3 (packaged) +0
 *    - Name token coverage ratio: (matchedNameTokens / totalNameTokens) * 800
 *    - Unmatched name token penalty: -75 per extra unmatched word in name to favor direct concise matches
 */
function scoreFood(food, rawQuery, queryTokens, normalizedQuery) {
  if (!food) return 0;

  const normName = normalizeText(food.name);
  const normBrand = normalizeText(food.brand);
  const normGeneric = normalizeText(food.genericName);
  const normAliases = (food.aliases || []).map(normalizeText).filter(Boolean);

  const nameTokens = tokenize(food.name);
  const brandTokens = tokenize(food.brand);
  const genericTokens = tokenize(food.genericName);
  const aliasTokensList = normAliases.map(tokenize);
  const allAliasTokens = [].concat(...aliasTokensList);

  let score = 0;
  let satisfiedTokensCount = 0;
  let matchedNameTokensCount = 0;

  // 1. Exact full-name match (Strongest boost)
  if (normName === normalizedQuery) {
    score += 15000;
  } else if (normName.startsWith(normalizedQuery + ' ') || normName.startsWith(normalizedQuery)) {
    score += 4000;
  } else if (normName.includes(normalizedQuery)) {
    score += 2000;
  }

  // 2. Full query phrase matches in aliases, genericName, brand
  for (const alias of normAliases) {
    if (alias === normalizedQuery) {
      score += 4000;
      break;
    } else if (alias.startsWith(normalizedQuery + ' ') || alias.startsWith(normalizedQuery)) {
      score += 2000;
      break;
    } else if (alias.includes(normalizedQuery)) {
      score += 1000;
      break;
    }
  }

  if (normBrand) {
    if (normBrand === normalizedQuery) {
      score += 3000;
    } else if (normBrand.startsWith(normalizedQuery + ' ') || normBrand.startsWith(normalizedQuery)) {
      score += 1500;
    } else if (normBrand.includes(normalizedQuery)) {
      score += 800;
    }
  }

  if (normGeneric) {
    if (normGeneric === normalizedQuery) {
      score += 3000;
    } else if (normGeneric.startsWith(normalizedQuery + ' ') || normGeneric.startsWith(normalizedQuery)) {
      score += 1500;
    } else if (normGeneric.includes(normalizedQuery)) {
      score += 800;
    }
  }

  // 3. Token-by-token evaluation across all fields
  const totalQueryTokens = queryTokens.length;

  for (const qToken of queryTokens) {
    let tokenSatisfied = false;

    // Check name tokens (exact > prefix > substring)
    let matchedInName = false;
    for (const nToken of nameTokens) {
      if (nToken === qToken) {
        score += 1500;
        tokenSatisfied = true;
        matchedInName = true;
        matchedNameTokensCount += 1.0;
        break;
      } else if (nToken.startsWith(qToken)) {
        score += 750;
        tokenSatisfied = true;
        matchedInName = true;
        matchedNameTokensCount += 0.75;
        break;
      }
    }
    if (!matchedInName && normName.includes(qToken)) {
      score += 250;
      tokenSatisfied = true;
      matchedNameTokensCount += 0.5;
    }

    // Check brand tokens
    let matchedInBrand = false;
    for (const bToken of brandTokens) {
      if (bToken === qToken) {
        score += 600;
        tokenSatisfied = true;
        matchedInBrand = true;
        break;
      } else if (bToken.startsWith(qToken)) {
        score += 300;
        tokenSatisfied = true;
        matchedInBrand = true;
        break;
      }
    }
    if (!matchedInBrand && normBrand.includes(qToken)) {
      score += 120;
      tokenSatisfied = true;
    }

    // Check genericName tokens
    let matchedInGeneric = false;
    for (const gToken of genericTokens) {
      if (gToken === qToken) {
        score += 500;
        tokenSatisfied = true;
        matchedInGeneric = true;
        break;
      } else if (gToken.startsWith(qToken)) {
        score += 250;
        tokenSatisfied = true;
        matchedInGeneric = true;
        break;
      }
    }
    if (!matchedInGeneric && normGeneric.includes(qToken)) {
      score += 100;
      tokenSatisfied = true;
    }

    // Check alias tokens
    let matchedInAlias = false;
    for (const aToken of allAliasTokens) {
      if (aToken === qToken) {
        score += 600;
        tokenSatisfied = true;
        matchedInAlias = true;
        break;
      } else if (aToken.startsWith(qToken)) {
        score += 300;
        tokenSatisfied = true;
        matchedInAlias = true;
        break;
      }
    }
    if (!matchedInAlias && normAliases.some(a => a.includes(qToken))) {
      score += 120;
      tokenSatisfied = true;
    }

    if (tokenSatisfied) {
      satisfiedTokensCount++;
    }
  }

  // 4. Token satisfaction boost (substantial boost when all query tokens are satisfied)
  if (totalQueryTokens > 0) {
    const coverageRatio = satisfiedTokensCount / totalQueryTokens;
    if (coverageRatio >= 1) {
      score += 5000;
    } else {
      score += Math.round(coverageRatio * 2000);
    }
  }

  // 5. Generic / Simple Food Identity vs Compound Adjustments (Dynamic, without hardcoded lists)
  // Layer hierarchy: Layer 1 (raw agricultural ingredients) > Layer 2 (prepared recipes) > Layer 3 (branded products)
  if (food.layer === 1) {
    score += 1200;
  } else if (food.layer === 2) {
    score += 400;
  }

  // Name conciseness & coverage:
  // - High ratio of name words matching query = simple/direct item
  // - Many unmatched words in name = composite recipe or verbose branded product
  if (nameTokens.length > 0) {
    const nameRatio = Math.min(1, matchedNameTokensCount / nameTokens.length);
    score += Math.round(nameRatio * 800);

    const unmatchedTokens = Math.max(0, nameTokens.length - matchedNameTokensCount);
    score -= unmatchedTokens * 75;
  }

  return score;
}

module.exports = {
  normalizeText,
  tokenize,
  scoreFood,
};
