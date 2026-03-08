/**
 * Tree formatter — renders hierarchical data as an ASCII tree structure.
 *
 * Used for visualizing workflow DAGs, agent hierarchies, and directory
 * structures in the terminal.
 */

import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreeNode {
  /** Display label for this node. */
  label: string;
  /** Optional status indicator. */
  status?: 'running' | 'completed' | 'failed' | 'pending' | 'skipped';
  /** Optional additional info displayed after the label. */
  detail?: string;
  /** Child nodes. */
  children?: TreeNode[];
}

// ---------------------------------------------------------------------------
// Status icons and colors
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, string> = {
  running: chalk.yellow('\u25cf'), // filled circle
  completed: chalk.green('\u2713'), // checkmark
  failed: chalk.red('\u2717'), // X mark
  pending: chalk.gray('\u25cb'), // empty circle
  skipped: chalk.gray('\u2013'), // en dash
};

function getStatusIcon(status?: string): string {
  if (!status) return '';
  return (STATUS_ICONS[status] ?? '') + ' ';
}

function colorLabel(label: string, status?: string): string {
  switch (status) {
    case 'running':
      return chalk.yellow(label);
    case 'completed':
      return chalk.green(label);
    case 'failed':
      return chalk.red(label);
    case 'skipped':
      return chalk.gray(label);
    case 'pending':
      return chalk.gray(label);
    default:
      return label;
  }
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

/**
 * Render a tree structure as formatted text.
 *
 * @param node - The root node of the tree.
 * @returns A multi-line string representing the tree.
 *
 * @example
 * ```
 * Workflow: data-pipeline
 * +-- Fetch Data
 * |   +-- Parse JSON
 * |   \-- Validate
 * +-- Process
 * \-- Export
 * ```
 */
export function formatTree(node: TreeNode): string {
  const lines: string[] = [];
  renderNode(node, '', true, true, lines);
  return lines.join('\n');
}

/**
 * Render a flat list of nodes as a tree (no hierarchy, just a list with tree decorations).
 */
export function formatFlatTree(title: string, nodes: TreeNode[]): string {
  const root: TreeNode = {
    label: title,
    children: nodes,
  };
  return formatTree(root);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  lines: string[],
): void {
  const statusIcon = getStatusIcon(node.status);
  const label = colorLabel(node.label, node.status);
  const detail = node.detail ? chalk.dim(` (${node.detail})`) : '';

  if (isRoot) {
    lines.push(`${statusIcon}${label}${detail}`);
  } else {
    const connector = isLast ? '\\-- ' : '+-- ';
    lines.push(`${prefix}${connector}${statusIcon}${label}${detail}`);
  }

  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const isChildLast = i === children.length - 1;
    const childPrefix = isRoot
      ? prefix
      : prefix + (isLast ? '    ' : '|   ');

    renderNode(child, childPrefix, isChildLast, false, lines);
  }
}

/**
 * Build a tree representation of a workflow graph from node and edge lists.
 *
 * @param nodes - Workflow nodes with id, name, type, and status.
 * @param edges - Edges as [sourceId, targetId] pairs.
 * @param entryNodeId - The entry point node ID.
 * @param workflowName - Name to display as the root node.
 * @returns A TreeNode that can be passed to formatTree().
 */
export function buildWorkflowTree(
  nodes: Array<{ id: string; name: string; type: string; status?: string }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
  entryNodeId: string,
  workflowName: string,
): TreeNode {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const childMap = new Map<string, string[]>();

  for (const edge of edges) {
    const children = childMap.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childMap.set(edge.sourceNodeId, children);
  }

  function buildNode(nodeId: string, visited: Set<string>): TreeNode {
    if (visited.has(nodeId)) {
      return { label: `${nodeId} (circular)`, status: 'skipped' };
    }
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) {
      return { label: `${nodeId} (missing)`, status: 'failed' };
    }

    const children = (childMap.get(nodeId) ?? []).map((childId) =>
      buildNode(childId, new Set(visited)),
    );

    return {
      label: node.name,
      status: node.status as TreeNode['status'],
      detail: node.type,
      children: children.length > 0 ? children : undefined,
    };
  }

  const rootChildren = buildNode(entryNodeId, new Set());

  return {
    label: workflowName,
    children: rootChildren.children ?? [rootChildren],
  };
}
