/**
 * @file treeTraversal.ts
 * @description Directed combo graph traversal engine with transposition pruning, cycle detection,
 * Turn 1 phase progression (DP -> SP -> M1), and Open Game State node ledger recording.
 */

import { GameState } from '../types/state.js';
import { DiscoveredAction, discoverLegalActions, applyAction } from '../engine/actionDiscovery.js';
import { computeStateHash } from '../engine/hasher.js';
import { serializeToYBN } from '../notation/ybnSerializer.js';
import { TranspositionTable } from './transpositionTable.js';
import { CycleDetector } from './cycleDetector.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';
import { Logcat } from '../logging/logcat.js';
import { scoreGameState } from '../evaluator/boardScorer.js';
import { advancePhase } from '../engine/phaseMachine.js';

export interface SearchOptions {
  maxDepth?: number;
  maxNodes?: number;
  branchLimit?: number;
  lineSignature?: string;
  startInDrawPhase?: boolean;
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

export interface PhaseAuditReport {
  phase: 'DP' | 'SP' | 'M1';
  actionsFound: number;
  notes: string;
}

export interface GameStateNodeLedger {
  nodeId: string;
  depth: number;
  phase: string;
  ygnPath: string;
  ybnState: string;
  ybnScore: number;
  interruptions: {
    field_negates: number;
    backrow_disruptions: number;
    gy_triggers: number;
    hand_traps: number;
    distinct_layers: number;
  };
  availableActions: DiscoveredAction[];
  isTerminal: boolean;
}

export interface TreeSearchResult {
  nodesEvaluated: number;
  transpositionHits: number;
  cyclesDetected: number;
  uniqueTerminals: Map<string, Playline>;
  topPlaylines: Playline[];
  nodeLedgers: GameStateNodeLedger[];
  phaseAudits: PhaseAuditReport[];
}

/**
 * Advance through Turn 1 initial phases (DP -> SP -> M1) checking for fast effect triggers.
 */
export function advanceTurnOnePhases(
  state: GameState,
  registry: CardRegistry = globalCardRegistry,
  lineSig?: string
): { activeState: GameState; phaseAudits: PhaseAuditReport[] } {
  const phaseAudits: PhaseAuditReport[] = [];
  let current = state;

  if (current.turn === 1 && current.phase === 'DP') {
    Logcat.i(
      'SimCore:PhaseMachine',
      'Turn 1 Draw Phase: Player 1 (going first) does not draw a card',
      lineSig
    );
    const dpActions = discoverLegalActions(current, current.turnPlayer, registry);
    Logcat.d(
      'SimCore:PhaseMachine',
      `Draw Phase activation check: ${dpActions.length} legal activations found`,
      lineSig
    );
    phaseAudits.push({
      phase: 'DP',
      actionsFound: dpActions.length,
      notes: 'Going first player skips normal draw. No legal DP activations found.'
    });

    current = advancePhase(current, 'SP', lineSig);
  }

  if (current.turn === 1 && current.phase === 'SP') {
    Logcat.i('SimCore:PhaseMachine', 'Entering Turn 1 Standby Phase', lineSig);
    const spActions = discoverLegalActions(current, current.turnPlayer, registry);
    Logcat.d(
      'SimCore:PhaseMachine',
      `Standby Phase activation check: ${spActions.length} legal activations found`,
      lineSig
    );
    phaseAudits.push({
      phase: 'SP',
      actionsFound: spActions.length,
      notes: 'Standby Phase check completed. No legal SP activations found.'
    });

    current = advancePhase(current, 'M1', lineSig);
  }

  if (current.phase === 'M1') {
    Logcat.i(
      'SimCore:PhaseMachine',
      'Entering Main Phase 1 Open Game State (Node #0)',
      lineSig
    );
    phaseAudits.push({
      phase: 'M1',
      actionsFound: 0,
      notes: 'Main Phase 1 Open Game State active.'
    });
  }

  return { activeState: current, phaseAudits };
}

/**
 * Stockfish Move Ordering Heuristic for Yu-Gi-Oh!
 * Prioritizes non-committal gates and high-value value-generating actions:
 * 1. Empty MMZ conditional spells (Engage, Hornet Drones) -> Priority 100
 * 2. Inherent Search/SS spells (Stage Landing, Terraforming) -> Priority 85
 * 3. Extra Deck Summons (Link, Xyz) -> Priority 70
 * 4. On-field ignition activations -> Priority 60
 * 5. Archetype Normal Summons -> Priority 40
 * 6. Setting Traps / Quick-Plays -> Priority 20
 * 7. Non-engine hand trap normal summons (Ash, Belle) -> Priority 5
 */
export function getActionPriority(
  action: DiscoveredAction,
  state: GameState,
  registry: CardRegistry
): number {
  const cardDef =
    registry.getCardById(action.sourceCard.passcode) ??
    registry.getCardByName(action.sourceCard.name);
  const name = action.sourceCard.name.toLowerCase();

  // Milestone Guidance Bonus: A* heuristic guiding toward the next unreached milestone
  const milestones = registry.getMilestones();
  if (milestones.length > 0) {
    for (const ms of milestones) {
      const p1Monsters = Object.values(state.p1.monsters).concat(Object.values(state.p1.extraMonsters));
      const p1Spells = Object.values(state.p1.spells).concat(state.p1.fieldSpell ? [state.p1.fieldSpell] : []);
      const allP1FieldCards = p1Monsters.concat(p1Spells).filter(Boolean);

      const requiredSatisfied = ms.requiredCardsOnField?.every((req: string) =>
        allP1FieldCards.some((fc) => fc?.passcode === req || fc?.name.includes(req))
      );

      if (!requiredSatisfied) {
        const actionTargetsRequired = ms.requiredCardsOnField?.some((req: string) =>
          action.sourceCard.passcode === req ||
          action.sourceCard.name.includes(req) ||
          action.targetSelection?.passcode === req ||
          action.targetSelection?.name.includes(req) ||
          (action.materialsUsed && action.materialsUsed.some((m) => m.passcode === req || m.name.includes(req)))
        );

        if (actionTargetsRequired) {
          return 110 + (ms.priorityWeight ?? 10);
        }
        break; // Guide toward the earliest unreached milestone
      }
    }
  }

  // 1. Empty MMZ requirement cards (Sky Striker Mobilize - Engage!, Hornet Drones)
  if (
    name.includes('engage') ||
    name.includes('hornet drones') ||
    name.includes('mobilize')
  ) {
    const mmzCount = Object.keys(state.p1.monsters).length;
    if (mmzCount === 0) return 100;
  }

  // 2. Field Monster Trigger & Ignition Activations (resolve triggers immediately!)
  if (action.verb === 'ACTIVATE_FIELD') {
    return 95;
  }

  // 3. Special Summons from Hand (Roze hand trigger, Ga10 Cutter inherent swarm)
  if (action.verb === 'SPECIAL_SUMMON') {
    return 90;
  }

  // 4. Free Spells / Special Summons from Hand/Deck that advance game state
  if (action.verb === 'ACTIVATE_HAND' && action.sourceCard.cardType === 'SPELL') {
    return 80;
  }

  // 5. Extra Deck summons (Link, Xyz)
  if (action.verb === 'LINK_SUMMON' || action.verb === 'XYZ_SUMMON') {
    return 70;
  }

  // 6. GY Activations (Cyanos revive)
  if (action.verb === 'ACTIVATE_GY') {
    return 65;
  }

  // 7. Normal Summon of Archetype Starters (e.g. Cyanos, Harvester, VALCan)
  if (action.verb === 'NORMAL_SUMMON') {
    if (
      cardDef?.taxonomyRole === 'STARTER_NS' ||
      cardDef?.taxonomyRole === 'STARTER_1_5' ||
      cardDef?.taxonomyRole === 'STARTER_SS' ||
      name.includes('cyanos')
    ) {
      return 55;
    }
    // Normal Summon of non-engine hand trap without on-field trigger (Ash, Belle, Fuwalos)
    if (cardDef?.taxonomyRole === 'TECH_HANDTRAP' || name.includes('ash') || name.includes('fuwalos')) {
      return -50; // Heavily deprioritize: hand traps must be preserved in hand!
    }
    return 20;
  }

  // 8. Setting Traps / Quick-Plays
  if (action.verb === 'SET_SPELL_TRAP') {
    return 15;
  }

  return 10;
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
  const branchLimit = options.branchLimit ?? 15; // Raised to 15 to accommodate all 9 Stage Landing targets + Engage + NS + Sets
  const lineSig = options.lineSignature;

  // 1. Advance phases if starting in DP or SP
  const { activeState, phaseAudits } = advanceTurnOnePhases(initialState, registry, lineSig);

  Logcat.d(
    'SimCore:TreeTraversal',
    `Starting DFS combo tree search (maxDepth: ${maxDepth}, maxNodes: ${maxNodes}, branchLimit: ${branchLimit})`,
    lineSig
  );

  const transpositionTable = new TranspositionTable();
  const cycleDetector = new CycleDetector();
  const uniqueTerminals = new Map<string, Playline>();
  const nodeLedgers: GameStateNodeLedger[] = [];

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
    const nodeId = `NODE#${nodesEvaluated}`;

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

    // 3. Discover legal actions and evaluate board state at this Open Game State node
    const legalActions = discoverLegalActions(currentState, currentState.turnPlayer, registry);
    const ybnState = serializeToYBN(currentState);
    const scoreResult = scoreGameState(currentState, 1, registry);
    const isTerminal = legalActions.length === 0 || currentDepth >= maxDepth;
    const ygnPath = pathActions.map((a) => a.ygnNotation).join('\n  ');

    // Record node ledger for this Open Game State
    nodeLedgers.push({
      nodeId,
      depth: currentDepth,
      phase: currentState.phase,
      ygnPath: ygnPath || '(Initial Hand)',
      ybnState,
      ybnScore: scoreResult.total_score,
      interruptions: {
        field_negates: scoreResult.breakdown.base_interruptions.monster_negates,
        backrow_disruptions: scoreResult.breakdown.base_interruptions.backrow_negates,
        gy_triggers: scoreResult.breakdown.followup_recursion.recyclable_gy_loopers,
        hand_traps: currentState.p1.hand.length,
        distinct_layers: scoreResult.breakdown.layer_diversification.active_layers.length
      },
      availableActions: legalActions,
      isTerminal
    });

    Logcat.i(
      'SimCore:TreeTraversal',
      `OGS ${nodeId} (Depth ${currentDepth}): YBN=${ybnState} | V(YBN)=${scoreResult.total_score} | ${legalActions.length} Actions Available: [${legalActions.map((a) => a.ygnNotation).join(', ')}]`,
      lineSig
    );

    // Terminal condition: no more actions or max depth reached
    if (isTerminal) {
      const reason = legalActions.length === 0 ? 'no further legal actions' : `max depth ${maxDepth} reached`;
      Logcat.d(
        'SimCore:TreeTraversal',
        `Terminal state reached (${reason}) at depth ${currentDepth} with ${pathActions.length} actions: YBN=${ybnState}`,
        lineSig
      );

      const playline: Playline = {
        actions: [...pathActions],
        ygnTranscript: ygnPath || '(No actions taken)',
        terminalState: currentState,
        terminalYBN: ybnState,
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

    // 4. Explore child branches (ordered by Gate-Preserving Move Priority)
    const sortedActions = [...legalActions].sort((a, b) => {
      return (
        getActionPriority(b, currentState, registry) -
        getActionPriority(a, currentState, registry)
      );
    });
    const actionsToExplore = sortedActions.slice(0, branchLimit);

    for (const action of actionsToExplore) {
      try {
        Logcat.v(
          'SimCore:ActionDiscovery',
          `Branching on action [${action.ygnNotation}]: ${action.description}`,
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

  dfs(activeState, 0, []);

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
    topPlaylines: Array.from(uniqueTerminals.values()),
    nodeLedgers,
    phaseAudits
  };
}
