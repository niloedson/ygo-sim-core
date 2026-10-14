/**
 * @file treeTraversal.ts
 * @description Directed combo graph traversal engine with transposition pruning and cycle detection.
 */

import { GameState } from '../types/state.js';
import { DiscoveredAction, discoverLegalActions, applyAction } from '../engine/actionDiscovery.js';
import { computeStateHash } from '../engine/hasher.js';
import { serializeToYBN } from '../notation/ybnSerializer.js';
import { TranspositionTable } from './transpositionTable.js';
import { CycleDetector } from './cycleDetector.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';

export interface SearchOptions {
  maxDepth?: number;
  maxNodes?: number;
  branchLimit?: number;
}

export interface Playline {
  actions: DiscoveredAction[];
  ygnTranscript: string;
  terminalState: GameState;
  terminalYBN: string;
  terminalHash: string;
  depth: number;
  cycleDetected?: boolean;
}

export interface TreeSearchResult {
  nodesEvaluated: number;
  transpositionHits: number;
  cyclesDetected: number;
  uniqueTerminals: Map<string, Playline>;
  topPlaylines: Playline[];
}

/**
 * Explore combo state tree starting from an initial game state using Depth-First Search (DFS).
 */
export function exploreComboTree(
  initialState: GameState,
  options: SearchOptions = {},
  registry: CardRegistry = globalCardRegistry
): TreeSearchResult {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodes ?? 500;
  const branchLimit = options.branchLimit ?? 5;

  const transpositionTable = new TranspositionTable();
  const cycleDetector = new CycleDetector();
  const uniqueTerminals = new Map<string, Playline>();

  let nodesEvaluated = 0;
  let transpositionHits = 0;
  let cyclesDetected = 0;

  function dfs(
    currentState: GameState,
    currentDepth: number,
    pathActions: DiscoveredAction[]
  ): void {
    if (nodesEvaluated >= maxNodes) {
      return;
    }
    nodesEvaluated++;

    const currentHash = computeStateHash(currentState);

    // 1. Cycle Detection along the active search path
    if (cycleDetector.enterState(currentHash)) {
      cyclesDetected++;
      const terminalYBN = serializeToYBN(currentState);
      const playline: Playline = {
        actions: [...pathActions],
        ygnTranscript: pathActions.map((a) => a.ygnNotation).join('\n  '),
        terminalState: currentState,
        terminalYBN,
        terminalHash: currentHash,
        depth: currentDepth,
        cycleDetected: true
      };
      uniqueTerminals.set(`CYCLE_${currentHash}`, playline);
      return;
    }

    // 2. Transposition Pruning across different branches
    if (transpositionTable.has(currentHash)) {
      transpositionHits++;
      cycleDetector.exitState();
      return;
    }
    transpositionTable.set({ hash: currentHash, depth: currentDepth });

    // 3. Discover legal actions
    const legalActions = discoverLegalActions(currentState, currentState.turnPlayer, registry);

    // Terminal condition: no more actions or max depth reached
    if (legalActions.length === 0 || currentDepth >= maxDepth) {
      const terminalYBN = serializeToYBN(currentState);
      const playline: Playline = {
        actions: [...pathActions],
        ygnTranscript: pathActions.map((a) => a.ygnNotation).join('\n  '),
        terminalState: currentState,
        terminalYBN,
        terminalHash: currentHash,
        depth: currentDepth
      };
      if (!uniqueTerminals.has(currentHash)) {
        uniqueTerminals.set(currentHash, playline);
      }
      cycleDetector.exitState();
      return;
    }

    // 4. Explore child branches (bounded by branchLimit)
    const actionsToExplore = legalActions.slice(0, branchLimit);

    for (const action of actionsToExplore) {
      try {
        const nextState = applyAction(currentState, action, currentState.turnPlayer, registry);
        dfs(nextState, currentDepth + 1, [...pathActions, action]);
      } catch {
        // Discard illegal branch transitions safely
      }

      if (nodesEvaluated >= maxNodes) break;
    }

    // 5. Backtrack
    cycleDetector.exitState();
  }

  dfs(initialState, 0, []);

  return {
    nodesEvaluated,
    transpositionHits,
    cyclesDetected,
    uniqueTerminals,
    topPlaylines: Array.from(uniqueTerminals.values())
  };
}
