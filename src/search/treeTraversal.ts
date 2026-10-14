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
import { Logcat } from '../logging/logcat.js';

export interface SearchOptions {
  maxDepth?: number;
  maxNodes?: number;
  branchLimit?: number;
  lineSignature?: string;
}

export interface Playline {
  actions: DiscoveredAction[];
  ygnTranscript: string;
  terminalState: GameState;
  terminalYBN: string;
  terminalHash: string;
  depth: number;
  cycleDetected?: boolean;
  lineSignature?: string | undefined;
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
  const maxDepth = options.maxDepth ?? 40;
  const maxNodes = options.maxNodes ?? 500;
  const branchLimit = options.branchLimit ?? 5;
  const lineSig = options.lineSignature;

  Logcat.d(
    'SimCore:TreeTraversal',
    `Starting DFS combo tree search (maxDepth: ${maxDepth}, maxNodes: ${maxNodes}, branchLimit: ${branchLimit})`,
    lineSig
  );

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
      Logcat.w('SimCore:TreeTraversal', `Reached maxNodes budget (${maxNodes}), terminating branch`, lineSig);
      return;
    }
    nodesEvaluated++;

    const currentHash = computeStateHash(currentState);
    Logcat.v(
      'SimCore:TreeTraversal',
      `Visiting Node #${nodesEvaluated} (depth ${currentDepth}, hash: ${currentHash})`,
      lineSig
    );

    // 1. Cycle Detection along the active search path
    if (cycleDetector.enterState(currentHash)) {
      cyclesDetected++;
      Logcat.w(
        'SimCore:TreeTraversal',
        `Cycle loop detected at state ${currentHash}, halting recursive branch`,
        lineSig
      );
      const terminalYBN = serializeToYBN(currentState);
      const playline: Playline = {
        actions: [...pathActions],
        ygnTranscript: pathActions.map((a) => a.ygnNotation).join('\n  '),
        terminalState: currentState,
        terminalYBN,
        terminalHash: currentHash,
        depth: currentDepth,
        cycleDetected: true,
        lineSignature: lineSig
      };
      uniqueTerminals.set(`CYCLE_${currentHash}`, playline);
      return;
    }

    // 2. Transposition Pruning across different branches
    if (transpositionTable.has(currentHash)) {
      transpositionHits++;
      Logcat.v(
        'SimCore:TreeTraversal',
        `Transposition hit for state ${currentHash} at depth ${currentDepth}, pruning duplicate branch`,
        lineSig
      );
      cycleDetector.exitState();
      return;
    }
    transpositionTable.set({ hash: currentHash, depth: currentDepth });

    // 3. Discover legal actions
    const legalActions = discoverLegalActions(currentState, currentState.turnPlayer, registry);

    // Terminal condition: no more actions or max depth reached
    if (legalActions.length === 0 || currentDepth >= maxDepth) {
      const terminalYBN = serializeToYBN(currentState);
      const reason = legalActions.length === 0 ? 'no further legal actions' : `max depth ${maxDepth} reached`;
      Logcat.d(
        'SimCore:TreeTraversal',
        `Terminal state reached (${reason}) at depth ${currentDepth} with ${pathActions.length} actions: YBN=${terminalYBN}`,
        lineSig
      );

      const playline: Playline = {
        actions: [...pathActions],
        ygnTranscript: pathActions.map((a) => a.ygnNotation).join('\n  '),
        terminalState: currentState,
        terminalYBN,
        terminalHash: currentHash,
        depth: currentDepth,
        lineSignature: lineSig
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
        Logcat.v(
          'SimCore:ActionDiscovery',
          `Applying action [${action.ygnNotation}]: ${action.description}`,
          lineSig
        );
        const nextState = applyAction(currentState, action, currentState.turnPlayer, registry);
        dfs(nextState, currentDepth + 1, [...pathActions, action]);
      } catch (err) {
        Logcat.v(
          'SimCore:ActionDiscovery',
          `Discarded illegal branch transition for action ${action.id}: ${String(err)}`,
          lineSig
        );
      }

      if (nodesEvaluated >= maxNodes) break;
    }

    // 5. Backtrack
    cycleDetector.exitState();
  }

  dfs(initialState, 0, []);

  Logcat.i(
    'SimCore:TreeTraversal',
    `Completed DFS search: ${nodesEvaluated} nodes evaluated, ${uniqueTerminals.size} unique terminals, ${cyclesDetected} cycles, ${transpositionHits} transposition hits`,
    lineSig
  );

  return {
    nodesEvaluated,
    transpositionHits,
    cyclesDetected,
    uniqueTerminals,
    topPlaylines: Array.from(uniqueTerminals.values())
  };
}
