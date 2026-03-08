/**
 * Accuracy metrics for evaluating agent responses.
 *
 * Includes exact match, fuzzy match (Levenshtein), contains match,
 * and semantic similarity (TF-IDF cosine similarity).
 */

// ─── Exact Match ────────────────────────────────────────────────────────────

/**
 * Check if two strings are exactly equal (case-sensitive).
 */
export function exactMatch(expected: string, actual: string): boolean {
  return expected === actual;
}

/**
 * Check if two strings are exactly equal (case-insensitive).
 */
export function exactMatchIgnoreCase(expected: string, actual: string): boolean {
  return expected.toLowerCase() === actual.toLowerCase();
}

// ─── Contains Match ─────────────────────────────────────────────────────────

/**
 * Check if the actual string contains the expected string.
 */
export function containsMatch(expected: string, actual: string): boolean {
  return actual.includes(expected);
}

/**
 * Check if the actual string contains the expected string (case-insensitive).
 */
export function containsMatchIgnoreCase(expected: string, actual: string): boolean {
  return actual.toLowerCase().includes(expected.toLowerCase());
}

// ─── Levenshtein Distance ───────────────────────────────────────────────────

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic dynamic programming approach with O(min(m,n)) space
 * optimization (two-row DP).
 *
 * @returns The minimum number of single-character edits (insertions,
 *          deletions, substitutions) to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Handle trivial cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Two-row DP: previousRow and currentRow
  let previousRow = new Array<number>(m + 1);
  let currentRow = new Array<number>(m + 1);

  // Initialize the first row
  for (let j = 0; j <= m; j++) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    currentRow[0] = i;

    for (let j = 1; j <= m; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        (previousRow[j] ?? 0) + 1,        // deletion
        (currentRow[j - 1] ?? 0) + 1,     // insertion
        (previousRow[j - 1] ?? 0) + cost,  // substitution
      );
    }

    // Swap rows
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[m] ?? 0;
}

/**
 * Compute the similarity ratio between two strings using Levenshtein distance.
 *
 * @returns A number between 0 (completely different) and 1 (identical).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1; // Both empty strings are identical
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

// ─── Fuzzy Match ────────────────────────────────────────────────────────────

/**
 * Check if two strings are similar enough based on Levenshtein similarity.
 *
 * @param expected - The expected string.
 * @param actual - The actual string to compare.
 * @param threshold - Minimum similarity ratio (0-1). Defaults to 0.8.
 * @returns True if the similarity ratio >= threshold.
 */
export function fuzzyMatch(
  expected: string,
  actual: string,
  threshold = 0.8,
): boolean {
  return levenshteinSimilarity(expected, actual) >= threshold;
}

// ─── Semantic Similarity (TF-IDF Cosine) ────────────────────────────────────

/**
 * Tokenize a string into normalized terms.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)               // Split on whitespace
    .filter((t) => t.length > 0);
}

/**
 * Compute term frequency (TF) for a list of tokens.
 */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by total tokens
  const total = tokens.length;
  for (const [term, count] of tf) {
    tf.set(term, count / total);
  }
  return tf;
}

/**
 * Compute inverse document frequency (IDF) across a set of documents.
 */
function computeIDF(documents: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const totalDocs = documents.length;

  // Count how many documents contain each term
  const docFreq = new Map<string, number>();
  for (const doc of documents) {
    const uniqueTerms = new Set(doc);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  // IDF = log(N / df)
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log(totalDocs / df));
  }

  return idf;
}

/**
 * Compute a TF-IDF vector for a document.
 */
function computeTFIDF(
  tf: Map<string, number>,
  idf: Map<string, number>,
): Map<string, number> {
  const tfidf = new Map<string, number>();
  for (const [term, tfValue] of tf) {
    const idfValue = idf.get(term) ?? 0;
    tfidf.set(term, tfValue * idfValue);
  }
  return tfidf;
}

/**
 * Compute cosine similarity between two vectors represented as Maps.
 */
function cosineSimilarity(
  vecA: Map<string, number>,
  vecB: Map<string, number>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  // Compute dot product and norm of A
  for (const [term, valueA] of vecA) {
    normA += valueA * valueA;
    const valueB = vecB.get(term);
    if (valueB !== undefined) {
      dotProduct += valueA * valueB;
    }
  }

  // Compute norm of B
  for (const [, valueB] of vecB) {
    normB += valueB * valueB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compute semantic similarity between two strings using TF-IDF cosine similarity.
 *
 * This is a lightweight approximation of semantic similarity that works
 * without external embeddings. For production use, consider using actual
 * embedding models.
 *
 * @returns A number between 0 (completely different) and 1 (identical).
 */
export function semanticSimilarity(expected: string, actual: string): number {
  const tokensA = tokenize(expected);
  const tokensB = tokenize(actual);

  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // Compute IDF across both documents
  const idf = computeIDF([tokensA, tokensB]);

  // Compute TF-IDF vectors
  const tfA = computeTF(tokensA);
  const tfB = computeTF(tokensB);
  const tfidfA = computeTFIDF(tfA, idf);
  const tfidfB = computeTFIDF(tfB, idf);

  return cosineSimilarity(tfidfA, tfidfB);
}

/**
 * Compute a regex match against the actual string.
 */
export function regexMatch(pattern: string, actual: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(actual);
  } catch {
    return false;
  }
}
