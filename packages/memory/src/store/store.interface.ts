/**
 * VectorStore interface — abstraction over vector storage backends.
 */

// ---------------------------------------------------------------------------
// Search result
// ---------------------------------------------------------------------------

export interface VectorSearchResult {
  /** The unique identifier of the stored vector. */
  id: string;
  /** Cosine similarity score (0.0 – 1.0, higher is more similar). */
  score: number;
  /** Metadata attached to this vector entry. */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Vector store interface
// ---------------------------------------------------------------------------

export interface VectorStore {
  /**
   * Initialize the store (create tables, open connections, etc.).
   */
  initialize(): Promise<void>;

  /**
   * Insert a vector with its id and metadata.
   * If an entry with the same id exists, it is overwritten.
   */
  insert(
    id: string,
    embedding: number[],
    metadata: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Search for the top-K most similar vectors to `queryEmbedding`.
   * An optional filter narrows results by metadata key-value equality.
   */
  search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]>;

  /**
   * Delete a vector by id.
   */
  delete(id: string): Promise<void>;

  /**
   * Close the store, releasing any resources.
   */
  close(): Promise<void>;
}
