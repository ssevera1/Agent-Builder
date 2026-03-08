/**
 * Directed Acyclic Graph (DAG) implementation for workflow execution ordering.
 *
 * Provides topological sorting via Kahn's algorithm, cycle detection via DFS,
 * parallel execution layer computation, and comprehensive validation.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** A node in the DAG, wrapping user data with edge tracking. */
export interface DAGNode<T> {
  /** Unique identifier for this node. */
  id: string;
  /** User-provided data associated with this node. */
  data: T;
  /** Set of node IDs that have edges pointing TO this node (parents). */
  inEdges: Set<string>;
  /** Set of node IDs that this node has edges pointing TO (children). */
  outEdges: Set<string>;
}

/** Metadata that can be attached to an edge between two nodes. */
export interface EdgeMetadata {
  /** The source node ID. */
  from: string;
  /** The target node ID. */
  to: string;
  /** Arbitrary metadata for the edge. */
  metadata: Record<string, unknown>;
}

/** Result of validating a DAG for structural correctness. */
export interface DAGValidationResult {
  /** Whether the DAG is structurally valid. */
  valid: boolean;
  /** List of validation error messages. */
  errors: string[];
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * A generic Directed Acyclic Graph implementation.
 *
 * @typeParam T - The type of data stored in each node.
 */
export class DAG<T> {
  private readonly nodes: Map<string, DAGNode<T>> = new Map();
  private readonly edgeMetadata: Map<string, EdgeMetadata> = new Map();

  // ─── Node Operations ───────────────────────────────────────────────

  /**
   * Add a node to the graph. If a node with the same ID exists, its data
   * is updated but edges are preserved.
   */
  addNode(id: string, data: T): void {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.data = data;
    } else {
      this.nodes.set(id, {
        id,
        data,
        inEdges: new Set(),
        outEdges: new Set(),
      });
    }
  }

  /**
   * Remove a node and all its incident edges from the graph.
   */
  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove all edges pointing to this node
    for (const parentId of node.inEdges) {
      const parent = this.nodes.get(parentId);
      if (parent) {
        parent.outEdges.delete(id);
      }
      this.edgeMetadata.delete(this.edgeKey(parentId, id));
    }

    // Remove all edges from this node
    for (const childId of node.outEdges) {
      const child = this.nodes.get(childId);
      if (child) {
        child.inEdges.delete(id);
      }
      this.edgeMetadata.delete(this.edgeKey(id, childId));
    }

    this.nodes.delete(id);
  }

  /**
   * Retrieve a node by its ID.
   */
  getNode(id: string): DAGNode<T> | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all node IDs in the graph.
   */
  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get the total number of nodes.
   */
  get size(): number {
    return this.nodes.size;
  }

  // ─── Edge Operations ───────────────────────────────────────────────

  /**
   * Add a directed edge from one node to another.
   *
   * @throws Error if either node does not exist.
   */
  addEdge(from: string, to: string, metadata?: Record<string, unknown>): void {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);

    if (!fromNode) {
      throw new Error(`Cannot add edge: source node '${from}' does not exist`);
    }
    if (!toNode) {
      throw new Error(`Cannot add edge: target node '${to}' does not exist`);
    }
    if (from === to) {
      throw new Error(`Cannot add self-loop edge on node '${from}'`);
    }

    fromNode.outEdges.add(to);
    toNode.inEdges.add(from);

    if (metadata) {
      this.edgeMetadata.set(this.edgeKey(from, to), { from, to, metadata });
    }
  }

  /**
   * Remove a directed edge between two nodes.
   */
  removeEdge(from: string, to: string): void {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);

    if (fromNode) {
      fromNode.outEdges.delete(to);
    }
    if (toNode) {
      toNode.inEdges.delete(from);
    }
    this.edgeMetadata.delete(this.edgeKey(from, to));
  }

  /**
   * Get metadata associated with an edge.
   */
  getEdgeMetadata(from: string, to: string): Record<string, unknown> | undefined {
    return this.edgeMetadata.get(this.edgeKey(from, to))?.metadata;
  }

  /**
   * Check whether an edge exists between two nodes.
   */
  hasEdge(from: string, to: string): boolean {
    const fromNode = this.nodes.get(from);
    return fromNode ? fromNode.outEdges.has(to) : false;
  }

  // ─── Graph Queries ─────────────────────────────────────────────────

  /**
   * Get the IDs of all children (direct successors) of a node.
   */
  getChildren(id: string): string[] {
    const node = this.nodes.get(id);
    return node ? Array.from(node.outEdges) : [];
  }

  /**
   * Get the IDs of all parents (direct predecessors) of a node.
   */
  getParents(id: string): string[] {
    const node = this.nodes.get(id);
    return node ? Array.from(node.inEdges) : [];
  }

  /**
   * Get all root nodes (nodes with no incoming edges).
   */
  getRoots(): string[] {
    const roots: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.inEdges.size === 0) {
        roots.push(id);
      }
    }
    return roots;
  }

  /**
   * Get all leaf nodes (nodes with no outgoing edges).
   */
  getLeaves(): string[] {
    const leaves: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.outEdges.size === 0) {
        leaves.push(id);
      }
    }
    return leaves;
  }

  // ─── Topological Sort (Kahn's Algorithm) ───────────────────────────

  /**
   * Compute a topological ordering of all nodes using Kahn's algorithm.
   *
   * @throws Error if the graph contains a cycle.
   * @returns Array of node IDs in topological order.
   */
  topologicalSort(): string[] {
    // Build in-degree map
    const inDegree = new Map<string, number>();
    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.inEdges.size);
    }

    // Initialize queue with all roots (in-degree 0)
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const sorted: string[] = [];

    while (queue.length > 0) {
      // Sort the queue for deterministic output
      queue.sort();
      const current = queue.shift()!;
      sorted.push(current);

      const node = this.nodes.get(current)!;
      for (const childId of node.outEdges) {
        const newDegree = (inDegree.get(childId) ?? 0) - 1;
        inDegree.set(childId, newDegree);
        if (newDegree === 0) {
          queue.push(childId);
        }
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error(
        'Graph contains a cycle: topological sort could not process all nodes'
      );
    }

    return sorted;
  }

  // ─── Cycle Detection (DFS) ────────────────────────────────────────

  /**
   * Detect whether the graph contains any cycles using iterative DFS
   * with three-color marking.
   *
   * WHITE (unvisited) -> GRAY (in current path) -> BLACK (fully processed)
   */
  hasCycle(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }

    for (const startId of this.nodes.keys()) {
      if (color.get(startId) !== WHITE) continue;

      // Iterative DFS using an explicit stack
      const stack: Array<{ nodeId: string; childIterator: Iterator<string> }> = [];
      color.set(startId, GRAY);
      const node = this.nodes.get(startId)!;
      stack.push({ nodeId: startId, childIterator: node.outEdges.values() });

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const next = top.childIterator.next();

        if (next.done) {
          // All children processed — mark as BLACK
          color.set(top.nodeId, BLACK);
          stack.pop();
        } else {
          const childId = next.value;
          const childColor = color.get(childId);

          if (childColor === GRAY) {
            // Back edge found — cycle detected
            return true;
          }
          if (childColor === WHITE) {
            color.set(childId, GRAY);
            const childNode = this.nodes.get(childId)!;
            stack.push({ nodeId: childId, childIterator: childNode.outEdges.values() });
          }
          // BLACK nodes are already fully processed — skip
        }
      }
    }

    return false;
  }

  // ─── Execution Layers ─────────────────────────────────────────────

  /**
   * Compute execution layers — groups of nodes that can be executed in
   * parallel. Nodes in the same layer have no dependencies on each other;
   * all their dependencies are in earlier layers.
   *
   * This is essentially a BFS-based level assignment using Kahn's algorithm.
   *
   * @throws Error if the graph contains a cycle.
   * @returns Array of arrays, where each inner array is a layer of
   *          parallelizable node IDs.
   */
  getExecutionLayers(): string[][] {
    if (this.nodes.size === 0) return [];

    // Build in-degree map
    const inDegree = new Map<string, number>();
    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.inEdges.size);
    }

    // Start with root nodes as the first layer
    let currentLayer: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        currentLayer.push(id);
      }
    }

    const layers: string[][] = [];
    let processed = 0;

    while (currentLayer.length > 0) {
      currentLayer.sort(); // deterministic ordering
      layers.push(currentLayer);
      processed += currentLayer.length;

      const nextLayer: string[] = [];
      for (const nodeId of currentLayer) {
        const node = this.nodes.get(nodeId)!;
        for (const childId of node.outEdges) {
          const newDegree = (inDegree.get(childId) ?? 0) - 1;
          inDegree.set(childId, newDegree);
          if (newDegree === 0) {
            nextLayer.push(childId);
          }
        }
      }

      currentLayer = nextLayer;
    }

    if (processed !== this.nodes.size) {
      throw new Error(
        'Graph contains a cycle: could not assign all nodes to execution layers'
      );
    }

    return layers;
  }

  // ─── Validation ───────────────────────────────────────────────────

  /**
   * Validate the DAG for structural correctness.
   *
   * Checks:
   * 1. No cycles
   * 2. No orphan nodes (nodes unreachable from any root AND that are not roots)
   * 3. Edge consistency (all edge references point to existing nodes)
   */
  validate(): DAGValidationResult {
    const errors: string[] = [];

    // Check for empty graph
    if (this.nodes.size === 0) {
      return { valid: true, errors: [] };
    }

    // Check for cycles
    if (this.hasCycle()) {
      errors.push('Graph contains one or more cycles');
    }

    // Check edge consistency — all edge targets must exist
    for (const [id, node] of this.nodes) {
      for (const childId of node.outEdges) {
        if (!this.nodes.has(childId)) {
          errors.push(
            `Node '${id}' has an outgoing edge to non-existent node '${childId}'`
          );
        }
      }
      for (const parentId of node.inEdges) {
        if (!this.nodes.has(parentId)) {
          errors.push(
            `Node '${id}' has an incoming edge from non-existent node '${parentId}'`
          );
        }
      }
    }

    // Check for orphan nodes — nodes that cannot be reached from any root
    const roots = this.getRoots();
    if (roots.length === 0 && this.nodes.size > 0) {
      errors.push('Graph has no root nodes — every node has at least one incoming edge (likely a cycle)');
    } else {
      const reachable = new Set<string>();
      const bfsQueue = [...roots];
      while (bfsQueue.length > 0) {
        const current = bfsQueue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        const node = this.nodes.get(current);
        if (node) {
          for (const childId of node.outEdges) {
            if (!reachable.has(childId)) {
              bfsQueue.push(childId);
            }
          }
        }
      }

      for (const id of this.nodes.keys()) {
        if (!reachable.has(id)) {
          errors.push(`Node '${id}' is unreachable from any root node`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  private edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
  }
}
