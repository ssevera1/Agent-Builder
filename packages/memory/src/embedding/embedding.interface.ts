/**
 * EmbeddingProvider interface — abstraction for generating vector
 * embeddings from text.
 */

export interface EmbeddingProvider {
  /** Unique identifier for this provider (e.g., "openai", "ollama", "local-tfidf"). */
  readonly providerId: string;
  /** Dimensionality of the embeddings produced by this provider. */
  readonly dimensions: number;

  /**
   * Generate an embedding for a single text input.
   * @returns A number array of length `dimensions`.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in a single call.
   * Implementations may batch internally for efficiency.
   * @returns An array of embeddings, one per input text, each of length `dimensions`.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}
