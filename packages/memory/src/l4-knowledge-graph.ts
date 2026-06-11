/**
 * @agentos/memory — L4 Knowledge Graph
 * Entity relationships and graph traversal. Nodes for agents, tasks,
 * capabilities, projects, decisions, memories, outcomes. Edges for typed
 * relationships between them.
 *
 * Constitutional basis: MemoryTier.L3 (archival) — slowest access, richest structure.
 */

import { createUUID } from '@agentos/types';
import type { MemoryID } from '@agentos/types';
import type {
  GraphNode,
  GraphEdge,
  GraphNodeType,
  GraphEdgeType,
  GraphTraversalOptions,
  GraphTraversalResult,
} from './types.js';

// ─── L4 Knowledge Graph ────────────────────────────────────────────────────

export class L4KnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private outgoingEdges: Map<string, Set<string>> = new Map(); // nodeId → edge IDs
  private incomingEdges: Map<string, Set<string>> = new Map(); // nodeId → edge IDs
  private nodeTypeIndex: Map<string, Set<string>> = new Map(); // nodeType → node IDs
  private edgeTypeIndex: Map<string, Set<string>> = new Map(); // edgeType → edge IDs
  private now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? Date.now;
  }

  // ─── Nodes ──────────────────────────────────────────────────────────────

  /**
   * Add a node to the knowledge graph.
   */
  addNode(
    type: GraphNodeType,
    label: string,
    properties: Record<string, unknown> = {},
    options?: { id?: string; memoryId?: MemoryID },
  ): GraphNode {
    const now = this.now();
    const id = options?.id ?? createUUID();

    const node: GraphNode = {
      id,
      type,
      label,
      properties,
      memoryId: options?.memoryId,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.set(id, node);

    // Update type index
    let typeEntries = this.nodeTypeIndex.get(type);
    if (!typeEntries) {
      typeEntries = new Set();
      this.nodeTypeIndex.set(type, typeEntries);
    }
    typeEntries.add(id);

    return { ...node };
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): GraphNode | null {
    const node = this.nodes.get(id);
    return node ? { ...node } : null;
  }

  /**
   * Get all nodes of a specific type.
   */
  getNodesByType(type: GraphNodeType): GraphNode[] {
    const ids = this.nodeTypeIndex.get(type);
    if (!ids) return [];

    const results: GraphNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) results.push({ ...node });
    }
    return results;
  }

  /**
   * Update a node's properties.
   */
  updateNode(id: string, properties: Record<string, unknown>): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    node.properties = { ...node.properties, ...properties };
    node.updatedAt = this.now();
    return true;
  }

  /**
   * Remove a node and all its connected edges.
   */
  removeNode(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;

    let edgesRemoved = 0;

    // Remove outgoing edges
    const outEdges = this.outgoingEdges.get(id);
    if (outEdges) {
      for (const edgeId of outEdges) {
        this.removeEdge(edgeId);
        edgesRemoved++;
      }
    }

    // Remove incoming edges
    const inEdges = this.incomingEdges.get(id);
    if (inEdges) {
      for (const edgeId of inEdges) {
        this.removeEdge(edgeId);
        edgesRemoved++;
      }
    }

    // Remove from type index
    const typeEntries = this.nodeTypeIndex.get(node.type);
    if (typeEntries) {
      typeEntries.delete(id);
      if (typeEntries.size === 0) this.nodeTypeIndex.delete(node.type);
    }

    this.nodes.delete(id);
    this.outgoingEdges.delete(id);
    this.incomingEdges.delete(id);

    return edgesRemoved;
  }

  // ─── Edges ─────────────────────────────────────────────────────────────

  /**
   * Add an edge between two nodes.
   */
  addEdge(
    sourceId: string,
    targetId: string,
    type: GraphEdgeType,
    weight: number = 1.0,
    properties: Record<string, unknown> = {},
  ): GraphEdge | null {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return null;

    const now = this.now();
    const id = createUUID();

    const edge: GraphEdge = {
      id,
      sourceId,
      targetId,
      type,
      weight,
      properties,
      createdAt: now,
    };

    this.edges.set(id, edge);

    // Update outgoing edges index
    let outEdges = this.outgoingEdges.get(sourceId);
    if (!outEdges) {
      outEdges = new Set();
      this.outgoingEdges.set(sourceId, outEdges);
    }
    outEdges.add(id);

    // Update incoming edges index
    let inEdges = this.incomingEdges.get(targetId);
    if (!inEdges) {
      inEdges = new Set();
      this.incomingEdges.set(targetId, inEdges);
    }
    inEdges.add(id);

    // Update type index
    let typeEntries = this.edgeTypeIndex.get(type);
    if (!typeEntries) {
      typeEntries = new Set();
      this.edgeTypeIndex.set(type, typeEntries);
    }
    typeEntries.add(id);

    return { ...edge };
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id: string): GraphEdge | null {
    const edge = this.edges.get(id);
    return edge ? { ...edge } : null;
  }

  /**
   * Get all edges of a specific type.
   */
  getEdgesByType(type: GraphEdgeType): GraphEdge[] {
    const ids = this.edgeTypeIndex.get(type);
    if (!ids) return [];

    const results: GraphEdge[] = [];
    for (const id of ids) {
      const edge = this.edges.get(id);
      if (edge) results.push({ ...edge });
    }
    return results;
  }

  /**
   * Get all outgoing edges from a node.
   */
  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const edgeIds = this.outgoingEdges.get(nodeId);
    if (!edgeIds) return [];

    const results: GraphEdge[] = [];
    for (const id of edgeIds) {
      const edge = this.edges.get(id);
      if (edge) results.push({ ...edge });
    }
    return results;
  }

  /**
   * Get all incoming edges to a node.
   */
  getIncomingEdges(nodeId: string): GraphEdge[] {
    const edgeIds = this.incomingEdges.get(nodeId);
    if (!edgeIds) return [];

    const results: GraphEdge[] = [];
    for (const id of edgeIds) {
      const edge = this.edges.get(id);
      if (edge) results.push({ ...edge });
    }
    return results;
  }

  /**
   * Remove an edge.
   */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    // Remove from outgoing index
    const outEdges = this.outgoingEdges.get(edge.sourceId);
    if (outEdges) outEdges.delete(id);

    // Remove from incoming index
    const inEdges = this.incomingEdges.get(edge.targetId);
    if (inEdges) inEdges.delete(id);

    // Remove from type index
    const typeEntries = this.edgeTypeIndex.get(edge.type);
    if (typeEntries) typeEntries.delete(id);

    this.edges.delete(id);
    return true;
  }

  // ─── Traversal ────────────────────────────────────────────────────────

  /**
   * Traverse the graph starting from given nodes.
   * Follows edges up to maxDepth, filtering by edge/node types.
   */
  traverse(options: GraphTraversalOptions): GraphTraversalResult {
    const {
      startNodeIds,
      edgeTypes,
      nodeTypes,
      maxDepth = 3,
      limit = 100,
      direction = 'outgoing',
    } = options;

    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const collectedNodes: GraphNode[] = [];
    const collectedEdges: GraphEdge[] = [];
    const paths: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];

    // BFS traversal
    const queue: Array<{ nodeId: string; depth: number; path: { nodeIds: string[]; edgeIds: string[] } }> = [];

    for (const startId of startNodeIds) {
      if (this.nodes.has(startId)) {
        queue.push({ nodeId: startId, depth: 0, path: { nodeIds: [startId], edgeIds: [] } });
        visitedNodes.add(startId);
      }
    }

    while (queue.length > 0 && collectedNodes.length < limit) {
      const { nodeId, depth, path } = queue.shift()!;

      if (depth >= maxDepth) continue;

      const node = this.nodes.get(nodeId);
      if (!node) continue;

      // Filter by node type
      if (nodeTypes && !nodeTypes.includes(node.type)) continue;

      if (!collectedNodes.some((n) => n.id === nodeId)) {
        collectedNodes.push({ ...node });
      }

      // Get edges based on direction
      let edgesToFollow: GraphEdge[] = [];

      if (direction === 'outgoing' || direction === 'both') {
        edgesToFollow = edgesToFollow.concat(this.getOutgoingEdges(nodeId));
      }
      if (direction === 'incoming' || direction === 'both') {
        edgesToFollow = edgesToFollow.concat(this.getIncomingEdges(nodeId));
      }

      // Filter by edge type
      if (edgeTypes) {
        edgesToFollow = edgesToFollow.filter((e) => edgeTypes.includes(e.type));
      }

      for (const edge of edgesToFollow) {
        if (visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);

        if (!collectedEdges.some((e) => e.id === edge.id)) {
          collectedEdges.push({ ...edge });
        }

        // Determine the next node
        const nextNodeId = direction === 'incoming'
          ? edge.sourceId
          : edge.targetId;

        if (!visitedNodes.has(nextNodeId) && this.nodes.has(nextNodeId)) {
          visitedNodes.add(nextNodeId);

          const newPath = {
            nodeIds: [...path.nodeIds, nextNodeId],
            edgeIds: [...path.edgeIds, edge.id],
          };

          paths.push(newPath);
          queue.push({ nodeId: nextNodeId, depth: depth + 1, path: newPath });
        }
      }
    }

    return {
      nodes: collectedNodes,
      edges: collectedEdges,
      paths,
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  /**
   * Find all nodes connected to a given node (1-hop neighbors).
   */
  getNeighbors(nodeId: string, edgeType?: GraphEdgeType): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const neighbors: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Outgoing
    for (const edge of this.getOutgoingEdges(nodeId)) {
      if (edgeType && edge.type !== edgeType) continue;
      const target = this.nodes.get(edge.targetId);
      if (target && !neighbors.some((n) => n.id === target.id)) {
        neighbors.push({ ...target });
        edges.push(edge);
      }
    }

    // Incoming
    for (const edge of this.getIncomingEdges(nodeId)) {
      if (edgeType && edge.type !== edgeType) continue;
      const source = this.nodes.get(edge.sourceId);
      if (source && !neighbors.some((n) => n.id === source.id)) {
        neighbors.push({ ...source });
        edges.push(edge);
      }
    }

    return { nodes: neighbors, edges };
  }

  /**
   * Find the shortest path between two nodes (BFS).
   */
  shortestPath(fromId: string, toId: string): Array<{ nodeIds: string[]; edgeIds: string[] }> | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    if (fromId === toId) return [{ nodeIds: [fromId], edgeIds: [] }];

    const visited = new Set<string>([fromId]);
    const queue: Array<{ nodeId: string; path: { nodeIds: string[]; edgeIds: string[] } }> = [
      { nodeId: fromId, path: { nodeIds: [fromId], edgeIds: [] } },
    ];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      for (const edge of this.getOutgoingEdges(nodeId)) {
        if (visited.has(edge.targetId)) continue;
        visited.add(edge.targetId);

        const newPath = {
          nodeIds: [...path.nodeIds, edge.targetId],
          edgeIds: [...path.edgeIds, edge.id],
        };

        if (edge.targetId === toId) {
          return [newPath];
        }

        queue.push({ nodeId: edge.targetId, path: newPath });
      }
    }

    return null; // No path found
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  getStats(): {
    nodes: number;
    edges: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
  } {
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};

    for (const [type, ids] of this.nodeTypeIndex) {
      nodesByType[type] = ids.size;
    }

    for (const [type, ids] of this.edgeTypeIndex) {
      edgesByType[type] = ids.size;
    }

    return { nodes: this.nodes.size, edges: this.edges.size, nodesByType, edgesByType };
  }
}