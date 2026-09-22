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
 * Strips regional Indian-language and classification prefixes commonly found in
 * national food composition databases (e.g., IFCT format: "H. Kela", "Mar. Kele", "B. Aloo").
 */
function stripLangPrefix(text) {
  if (!text) return '';
  return text.replace(/^(b|g|h|kan|kash|kh|mal|m|mar|n|o|p|s|tam|tel|u|e)\s+/, '');
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
 * 2. Exact alias match (including regional Indian-language names like "H. Kela" -> "kela"): +10,000 points
 * 3. Full-phrase match / prefix in name:
 *    - Name starts with query: +4,000 points
 *    - Name contains full query phrase: +2,000 points
 * 4. Query term completeness (satisfaction across any field):
 *    - All query tokens satisfied by the same record: +5,000 points
 *    - Partial token coverage: (satisfied / total) * 2,000 points
 * 5. Name token matches:
 *    - Exact token match in name: +1,500 points per token
 *    - Prefix token match in name: +750 points per token
 *    - Substring in name (weak match): +100 points
 * 6. Alias matches:
 *    - Alias starts with query: +2,500 points
 *    - Full query phrase inside alias: +1,200 points
 *    - Exact token in alias: +800 points
 *    - Prefix token in alias: +400 points
 * 7. Brand matches:
 *    - Exact brand match to full query: +4,000 points
 *    - Full query phrase in brand: +2,000 points
 *    - Exact token in brand: +800 points
 *    - Prefix token in brand: +400 points
 * 8. GenericName matches:
 *    - Exact genericName match to full query: +3,000 points
 *    - Full query phrase in genericName: +1,500 points
 *    - Exact token in genericName: +600 points
 *    - Prefix token in genericName: +300 points
 * 9. Dynamic simple/generic food adjustments (no hardcoded word lists):
 *    - Layer adjustments: Layer 1 (raw whole foods) +1,500, Layer 2 (standard recipes) +500, Layer 3 (packaged) +0
 *    - Name token coverage ratio: (matchedNameTokens / totalNameTokens) * 1,000
 *    - Unmatched name token penalty: -80 per extra unmatched word in name to favor direct concise matches
 */
function scoreFood(food, rawQuery, queryTokens, normalizedQuery) {
  if (!food) return 0;

  const normName = normalizeText(food.name);
  const normBrand = normalizeText(food.brand);
  const normGeneric = normalizeText(food.genericName);
  const rawNormAliases = (food.aliases || []).map(normalizeText).filter(Boolean);

  const nameTokens = tokenize(food.name);
  const brandTokens = tokenize(food.brand);
  const genericTokens = tokenize(food.genericName);
  const aliasTokensList = rawNormAliases.map(tokenize);
  const allAliasTokens = [].concat(...aliasTokensList);

  let score = 0;
  let satisfiedTokensCount = 0;
  let matchedNameTokensCount = 0;
  let exactAliasMatched = false;

  // 1. Exact full-name match (Strongest boost)
  if (normName === normalizedQuery) {
    score += 15000;
  } else if (normName.startsWith(normalizedQuery + ' ') || normName.startsWith(normalizedQuery)) {
    score += 4000;
  } else if (normName.includes(normalizedQuery)) {
    score += 2000;
  }

  // 2. Full query phrase matches in aliases (including Indian-language prefix stripping: "H. Kela" -> "kela")
  for (const alias of rawNormAliases) {
    const strippedAlias = stripLangPrefix(alias);
    if (alias === normalizedQuery || strippedAlias === normalizedQuery) {
      score += 10000;
      exactAliasMatched = true;
      break;
    } else if (alias.startsWith(normalizedQuery + ' ') || strippedAlias.startsWith(normalizedQuery + ' ')) {
      score += 2500;
      break;
    } else if (alias.includes(normalizedQuery) || strippedAlias.includes(normalizedQuery)) {
      score += 1200;
      break;
    }
  }

  // 3. Brand full phrase match
  if (normBrand) {
    if (normBrand === normalizedQuery) {
      score += 4000;
    } else if (normBrand.startsWith(normalizedQuery + ' ') || normBrand.startsWith(normalizedQuery)) {
      score += 2000;
    } else if (normBrand.includes(normalizedQuery)) {
      score += 1000;
    }
  }

  // 4. GenericName full phrase match
  if (normGeneric) {
    if (normGeneric === normalizedQuery) {
      score += 3000;
    } else if (normGeneric.startsWith(normalizedQuery + ' ') || normGeneric.startsWith(normalizedQuery)) {
      score += 1500;
    } else if (normGeneric.includes(normalizedQuery)) {
      score += 800;
    }
  }

  // 5. Token-by-token evaluation across all fields
  const totalQueryTokens = queryTokens.length;

  for (const qToken of queryTokens) {
    let tokenSatisfied = false;

    // Check name tokens (exact > prefix)
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
    // Weak internal substring match in name (does not count as satisfied token)
    if (!matchedInName && normName.includes(qToken)) {
      score += 100;
    }

    // Check brand tokens (exact > prefix)
    let matchedInBrand = false;
    for (const bToken of brandTokens) {
      if (bToken === qToken) {
        score += 800;
        tokenSatisfied = true;
        matchedInBrand = true;
        break;
      } else if (bToken.startsWith(qToken)) {
        score += 400;
        tokenSatisfied = true;
        matchedInBrand = true;
        break;
      }
    }
    if (!matchedInBrand && normBrand && normBrand.includes(qToken)) {
      score += 80;
    }

    // Check genericName tokens (exact > prefix)
    let matchedInGeneric = false;
    for (const gToken of genericTokens) {
      if (gToken === qToken) {
        score += 600;
        tokenSatisfied = true;
        matchedInGeneric = true;
        break;
      } else if (gToken.startsWith(qToken)) {
        score += 300;
        tokenSatisfied = true;
        matchedInGeneric = true;
        break;
      }
    }
    if (!matchedInGeneric && normGeneric && normGeneric.includes(qToken)) {
      score += 60;
    }

    // Check alias tokens (exact > prefix)
    let matchedInAlias = false;
    for (const aToken of allAliasTokens) {
      if (aToken === qToken) {
        score += 800;
        tokenSatisfied = true;
        matchedInAlias = true;
        break;
      } else if (aToken.startsWith(qToken)) {
        score += 400;
        tokenSatisfied = true;
        matchedInAlias = true;
        break;
      }
    }
    if (!matchedInAlias && rawNormAliases.some(a => a.includes(qToken))) {
      score += 60;
    }

    if (tokenSatisfied || exactAliasMatched) {
      satisfiedTokensCount++;
    }
  }

  // 6. Token satisfaction boost (substantial boost when all query tokens are satisfied)
  if (totalQueryTokens > 0) {
    const coverageRatio = satisfiedTokensCount / totalQueryTokens;
    if (coverageRatio >= 1 || exactAliasMatched) {
      score += 5000;
    } else {
      score += Math.round(coverageRatio * 2000);
    }
  }

  // 7. Generic / Simple Food Identity vs Compound Adjustments (Dynamic, without hardcoded lists)
  // Layer hierarchy: Layer 1 (raw agricultural ingredients) > Layer 2 (prepared recipes) > Layer 3 (branded products)
  if (food.layer === 1) {
    score += 1500;
  } else if (food.layer === 2) {
    score += 500;
  }

  // Name conciseness & coverage:
  // - High ratio of name words matching query = simple/direct item
  // - Many unmatched words in name = composite recipe or verbose branded product
  if (nameTokens.length > 0) {
    const nameRatio = Math.min(1, matchedNameTokensCount / nameTokens.length);
    score += Math.round(nameRatio * 1000);

    const unmatchedTokens = Math.max(0, nameTokens.length - matchedNameTokensCount);
    score -= unmatchedTokens * 80;
  }

  return score;
}

module.exports = {
  normalizeText,
  stripLangPrefix,
  tokenize,
  scoreFood,
};
