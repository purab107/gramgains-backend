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
 * Checks if candidate word matches query token exactly or via basic plural stem (s/es).
 */
function isExactOrStemMatch(word, qToken) {
  if (!word || !qToken) return false;
  if (word === qToken) return true;
  if (word === qToken + 's' || word + 's' === qToken) return true;
  if (word === qToken + 'es' || word + 'es' === qToken) return true;
  return false;
}

/**
 * Evaluates a food candidate against the query and returns detailed match metrics.
 *
 * Returned object:
 * {
 *   score: number,
 *   isFullMatch: boolean,
 *   satisfiedTokensCount: number,
 *   brandConstraintMatched: boolean,
 *   productConstraintMatched: boolean,
 * }
 */
function evaluateFood(food, rawQuery, queryTokens, normalizedQuery) {
  if (!food) {
    return {
      score: 0,
      isFullMatch: false,
      satisfiedTokensCount: 0,
      brandConstraintMatched: false,
      productConstraintMatched: false,
    };
  }

  const normName = normalizeText(food.name);
  const normBrand = normalizeText(food.brand);
  const normGeneric = normalizeText(food.genericName);
  const rawNormAliases = (food.aliases || []).map(normalizeText).filter(Boolean);

  const nameTokens = tokenize(food.name);
  const brandTokens = tokenize(food.brand);
  const genericTokens = tokenize(food.genericName);
  const aliasTokensList = rawNormAliases.map((a) => tokenize(stripLangPrefix(a)));
  const allAliasTokens = [].concat(...aliasTokensList);

  let score = 0;
  let satisfiedTokensCount = 0;
  let matchedNameTokensCount = 0;
  let exactAliasMatched = false;
  let brandConstraintMatched = false;
  let productConstraintMatched = false;

  // 1. Exact full-name match (Strongest boost)
  if (normName === normalizedQuery) {
    score += 15000;
  } else if (normName.startsWith(normalizedQuery + ' ')) {
    score += 4000;
  } else if (
    normName.includes(' ' + normalizedQuery + ' ') ||
    normName.endsWith(' ' + normalizedQuery)
  ) {
    score += 2500;
  } else if (normName.startsWith(normalizedQuery)) {
    // Sub-word prefix collision (e.g. "rotini" for "roti") gets minimal boost
    score += 200;
  } else if (normName.includes(normalizedQuery)) {
    score += 100;
  }

  // 2. Full query phrase matches in aliases (including Indian-language prefix stripping: "H. Kela" -> "kela")
  for (const alias of rawNormAliases) {
    const strippedAlias = stripLangPrefix(alias);
    if (alias === normalizedQuery || strippedAlias === normalizedQuery) {
      score += 10000;
      exactAliasMatched = true;
      break;
    } else if (
      alias.startsWith(normalizedQuery + ' ') ||
      strippedAlias.startsWith(normalizedQuery + ' ')
    ) {
      score += 2500;
      break;
    } else if (
      alias.includes(normalizedQuery) ||
      strippedAlias.includes(normalizedQuery)
    ) {
      score += 1200;
      break;
    }
  }

  // 3. Brand full phrase / multi-word brand match
  if (normBrand) {
    if (normBrand === normalizedQuery) {
      score += 5000;
      brandConstraintMatched = true;
    } else if (
      normBrand.startsWith(normalizedQuery + ' ') ||
      normalizedQuery.startsWith(normBrand + ' ')
    ) {
      score += 3000;
      brandConstraintMatched = true;
    } else if (
      normBrand.includes(normalizedQuery) ||
      normalizedQuery.includes(normBrand)
    ) {
      score += 2000;
      brandConstraintMatched = true;
    }
  }

  // 4. GenericName full phrase match
  if (normGeneric) {
    if (normGeneric === normalizedQuery) {
      score += 3000;
    } else if (normGeneric.startsWith(normalizedQuery + ' ')) {
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
      if (isExactOrStemMatch(nToken, qToken)) {
        score += 2000;
        tokenSatisfied = true;
        matchedInName = true;
        productConstraintMatched = true;
        matchedNameTokensCount += 1.0;
        break;
      }
    }

    if (!matchedInName) {
      for (const nToken of nameTokens) {
        // Prefix match only if token is at least 3 chars
        if (qToken.length >= 3 && nToken.startsWith(qToken)) {
          score += 250;
          matchedInName = true;
          matchedNameTokensCount += 0.25;
          break;
        }
      }
    }

    // Check brand tokens (exact > prefix)
    let matchedInBrand = false;
    for (const bToken of brandTokens) {
      if (isExactOrStemMatch(bToken, qToken)) {
        score += 1200;
        tokenSatisfied = true;
        matchedInBrand = true;
        brandConstraintMatched = true;
        break;
      }
    }

    if (!matchedInBrand) {
      for (const bToken of brandTokens) {
        if (qToken.length >= 3 && bToken.startsWith(qToken)) {
          score += 150;
          matchedInBrand = true;
          brandConstraintMatched = true;
          break;
        }
      }
    }

    // Check genericName tokens (exact > prefix)
    let matchedInGeneric = false;
    for (const gToken of genericTokens) {
      if (isExactOrStemMatch(gToken, qToken)) {
        // Full score if this token wasn't already satisfied in name, modest corroboration if already matched
        score += matchedInName ? 100 : 1000;
        tokenSatisfied = true;
        matchedInGeneric = true;
        productConstraintMatched = true;
        break;
      }
    }

    if (!matchedInGeneric && !matchedInName) {
      for (const gToken of genericTokens) {
        if (qToken.length >= 3 && gToken.startsWith(qToken)) {
          score += 100;
          matchedInGeneric = true;
          break;
        }
      }
    }

    // Check alias tokens (exact > prefix)
    let matchedInAlias = false;
    for (const aToken of allAliasTokens) {
      if (isExactOrStemMatch(aToken, qToken)) {
        score += matchedInName ? 100 : 1200;
        tokenSatisfied = true;
        matchedInAlias = true;
        productConstraintMatched = true;
        break;
      }
    }

    if (!matchedInAlias && !matchedInName) {
      for (const aToken of allAliasTokens) {
        if (qToken.length >= 3 && aToken.startsWith(qToken)) {
          score += 100;
          matchedInAlias = true;
          break;
        }
      }
    }

    if (tokenSatisfied || exactAliasMatched) {
      satisfiedTokensCount++;
    }
  }

  // 6. Multi-token intent & core completeness
  const isFullMatch =
    totalQueryTokens > 0
      ? satisfiedTokensCount === totalQueryTokens ||
        exactAliasMatched ||
        normName === normalizedQuery
      : false;

  if (isFullMatch) {
    score += 5000;

    // Structured Intent Boost: Brand constraint + Product constraint both satisfied
    if (brandConstraintMatched && productConstraintMatched) {
      score += 5000;
    }
  } else {
    // Partial Match (Tier 2 fallback)
    if (totalQueryTokens > 0) {
      score += Math.round((satisfiedTokensCount / totalQueryTokens) * 1000);
    }
    // Brand Affinity Boost in Tier 2 fallback:
    // If user specified brand+food (e.g. "amul milk"), brand items ("Amul Cheese")
    // rank above generic partial items ("Almond Dairy Milk") in fallback
    if (brandConstraintMatched) {
      score += 3500;
    }
  }

  // 7. Generic / Simple Food Identity vs Compound Adjustments
  // Layer hierarchy: Layer 1 (raw agricultural ingredients) > Layer 2 (prepared recipes) > Layer 3 (branded products)
  if (food.layer === 1) {
    score += 2500;
  } else if (food.layer === 2) {
    score += 800;
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

  return {
    score,
    isFullMatch,
    satisfiedTokensCount,
    brandConstraintMatched,
    productConstraintMatched,
  };
}

/**
 * Convenience wrapper returning numeric score for backward compatibility.
 */
function scoreFood(food, rawQuery, queryTokens, normalizedQuery) {
  return evaluateFood(food, rawQuery, queryTokens, normalizedQuery).score;
}

module.exports = {
  normalizeText,
  stripLangPrefix,
  tokenize,
  isExactOrStemMatch,
  evaluateFood,
  scoreFood,
};
