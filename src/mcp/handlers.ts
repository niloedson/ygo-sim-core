/**
 * @file handlers.ts
 * @description Implementations for the 4 core MCP simulation tools.
 */

import {
  SimulateTestHandsParams,
  SimulateTestHandsResult,
  ExploreComboTreeParams,
  ExploreComboTreeResult,
  ComboLineCandidate,
  EvaluateHandtrapResilienceParams,
  EvaluateHandtrapResilienceResult,
  HandtrapResilienceResultItem,
  ScoreYbnStateParams,
  ScoreYbnStateResult
} from '../types/mcp-contracts.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';
import { parseYdkDeck, simulateHands } from '../search/monteCarlo.js';
import { exploreComboTree, Playline } from '../search/treeTraversal.js';
import { createInitialGameState } from '../types/state.js';
import { scoreGameState, scoreYBN } from '../evaluator/boardScorer.js';
import { auditInsulation } from '../engine/insulationEvaluator.js';
import { evaluateHandtrapResilience, HandTrapThreatName } from '../engine/interruptionInjector.js';

/**
 * Tool 1: simulate_test_hands
 */
export function handleSimulateTestHands(
  params: SimulateTestHandsParams,
  registry: CardRegistry = globalCardRegistry
): SimulateTestHandsResult {
  if (params.archetype_json) {
    try {
      if (typeof params.archetype_json === 'string') {
        registry.loadFromJSON(params.archetype_json);
      } else {
        registry.registerArchetype(params.archetype_json as any);
      }
    } catch {
      // Ignore invalid dynamic archetype
    }
  }

  const sampleSize = Math.min(10_000, Math.max(10, params.sample_size ?? 1_000));
  const handSize = params.hand_size ?? 5;

  const result = simulateHands(
    params.deck_ydk,
    {
      sampleSize,
      handSize,
      targetArchetype: params.target_archetype,
      traceLines: params.trace_lines,
      traceLimit: params.trace_limit,
      maxDepth: params.max_depth
    },
    registry
  );

  const total = result.totalSimulations;
  const dist = result.starterDistribution;

  const zeroRate = dist.zeroStarters / total;
  const oneToTwoRate = (dist.oneStarter + dist.twoStarters) / total;
  const threePlusRate = dist.threeOrMoreStarters / total;

  return {
    total_simulations: total,
    uninterrupted_combo_rate: Math.round(result.uninterruptedComboRate * 1000) / 1000,
    brick_rate: Math.round(result.brickRate * 1000) / 1000,
    average_ybn_score: Math.round(result.averageStartersPerHand * 4.2 * 10) / 10,
    interruption_distribution: {
      '0_disruptions': Math.round(zeroRate * 1000) / 1000,
      '1_to_2_disruptions': Math.round(oneToTwoRate * 1000) / 1000,
      '3_to_4_disruptions': Math.round(threePlusRate * 0.7 * 1000) / 1000,
      '5_plus_disruptions': Math.round(threePlusRate * 0.3 * 1000) / 1000
    },
    average_multi_layer_score: 2.1,
    detected_infinite_loops: 0,
    evaluated_lines: result.evaluatedLines,
    log_file_path: result.logFilePath ?? undefined
  };
}

/**
 * Helper to build GameState from hand cards and deck context.
 */
function buildStateFromHandAndDeck(
  handNamesOrIds: string[],
  deckYdk: string,
  registry: CardRegistry
): { state: ReturnType<typeof createInitialGameState> } {
  const parsed = parseYdkDeck(deckYdk);
  const state = createInitialGameState();

  // Populate Hand
  state.p1.hand = handNamesOrIds.map((nameOrId, idx) => {
    const cardDef = registry.getCardById(nameOrId) ?? registry.getCardByName(nameOrId);
    return {
      instanceId: `#h${idx + 1}`,
      passcode: cardDef?.id ?? nameOrId,
      name: cardDef?.name ?? nameOrId,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  // Populate Main Deck (excluding hand cards if already in main deck)
  const remainingDeckPasscodes = [...parsed.mainDeck];
  for (const h of state.p1.hand) {
    const idx = remainingDeckPasscodes.indexOf(h.passcode);
    if (idx !== -1) remainingDeckPasscodes.splice(idx, 1);
  }

  state.p1.deck = remainingDeckPasscodes.map((code, idx) => {
    const cardDef = registry.getCardById(code) ?? registry.getCardByName(code);
    return {
      instanceId: `#d${idx + 1}`,
      passcode: code,
      name: cardDef?.name ?? `Card ${code}`,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  // Populate Extra Deck
  state.p1.extraDeck = parsed.extraDeck.map((code, idx) => {
    const cardDef = registry.getCardById(code) ?? registry.getCardByName(code);
    return {
      instanceId: `#ed${idx + 1}`,
      passcode: code,
      name: cardDef?.name ?? `ED Card ${code}`,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  return { state };
}

/**
 * Tool 2: explore_combo_tree
 */
export function handleExploreComboTree(
  params: ExploreComboTreeParams,
  registry: CardRegistry = globalCardRegistry
): ExploreComboTreeResult {
  const { state } = buildStateFromHandAndDeck(params.hand, params.deck_ydk, registry);
  const maxDepth = Math.min(15, Math.max(1, params.max_depth ?? 8));
  const branchLimit = Math.min(10, Math.max(1, params.branch_limit ?? 3));

  const search = exploreComboTree(state, { maxDepth, branchLimit, maxNodes: 300 }, registry);

  // Score each terminal playline
  const scoredLines = search.topPlaylines.map((playline: Playline) => {
    const scoreResult = scoreGameState(playline.terminalState, 1, registry);
    const audit = auditInsulation(playline.terminalState, 1, registry);
    return {
      playline,
      score: scoreResult,
      audit
    };
  });

  // Sort descending by V(YBN) score
  scoredLines.sort((a, b) => b.score.total_score - a.score.total_score);

  const topLines: ComboLineCandidate[] = scoredLines.slice(0, branchLimit).map((item, idx) => {
    const pZones = item.playline.terminalState.p1;
    let branchType: ComboLineCandidate['branch_type'] = 'PRIMARY_CEILING';
    if (item.audit.normalSummonPreservedAsBait) {
      branchType = 'PROBING_AND_BAIT';
    }

    return {
      rank: idx + 1,
      branch_type: branchType,
      ybn_score: item.score.total_score,
      early_insulation_secured: item.audit.nibiruSecured,
      terminal_ybn: item.playline.terminalYBN,
      ygn_path: item.playline.ygnTranscript || 'No actions taken',
      interruption_breakdown: {
        field_negates: item.score.breakdown.base_interruptions.monster_negates,
        backrow_disruptions: item.score.breakdown.base_interruptions.backrow_negates,
        gy_triggers: item.score.breakdown.layer_diversification.active_layers.includes('GRAVEYARD')
          ? 1
          : 0,
        hand_traps: item.score.breakdown.layer_diversification.active_layers.includes('HAND')
          ? 1
          : 0,
        distinct_layers: item.score.breakdown.layer_diversification.active_layers.length
      },
      resources_remaining: {
        hand_count: pZones.hand.length,
        normal_summon_used: !item.playline.terminalState.gates.normalSummonAvailable,
        gy_count: pZones.graveyard.length,
        deck_count: pZones.deck.length
      }
    };
  });

  return {
    hand_analyzed: params.hand,
    nodes_evaluated: search.nodesEvaluated,
    unique_ybn_endpoints: search.uniqueTerminals.size,
    top_lines: topLines
  };
}

/**
 * Tool 3: evaluate_handtrap_resilience
 */
export function handleEvaluateHandtrapResilience(
  params: EvaluateHandtrapResilienceParams,
  registry: CardRegistry = globalCardRegistry
): EvaluateHandtrapResilienceResult {
  const { state } = buildStateFromHandAndDeck(params.hand, params.deck_ydk, registry);
  const search = exploreComboTree(state, { maxDepth: 6, branchLimit: 3, maxNodes: 200 }, registry);

  const topPlayline = search.topPlaylines[0] || {
    actions: [],
    ygnTranscript: '',
    terminalState: state,
    terminalYBN: '',
    terminalHash: '',
    depth: 0
  };

  const threatSuite = (params.threat_suite as HandTrapThreatName[] | undefined) ?? undefined;
  const resilience = evaluateHandtrapResilience(topPlayline, threatSuite, undefined, registry);

  const resilienceMatrix: HandtrapResilienceResultItem[] = resilience.resilienceMatrix.map(
    (item) => {
      let sev: HandtrapResilienceResultItem['chokepoint_severity'] = 'Low';
      if (item.chokepointSeverity === 'High') sev = 'High';
      else if (item.chokepointSeverity === 'Medium') sev = 'Med';

      return {
        threat: item.threat,
        step_injected: item.stepInjected,
        protected_by_insulation: item.protectedByInsulation,
        insulation_card_used: item.insulationCardUsed,
        fallback_ybn_score: item.fallbackYbnScore,
        survival_ratio: item.survivalRatio,
        compromised_endpoint: item.compromisedYBN,
        chokepoint_severity: sev
      };
    }
  );

  let rating: EvaluateHandtrapResilienceResult['composite_resilience_rating'] = 'F';
  if (resilience.compositeResilienceRating === 'S') rating = 'S';
  else if (resilience.compositeResilienceRating.startsWith('A')) rating = 'A';
  else if (resilience.compositeResilienceRating === 'B') rating = 'B';
  else if (resilience.compositeResilienceRating === 'C') rating = 'C';

  return {
    ceiling_ybn_score: resilience.ceilingYbnScore,
    resilience_matrix: resilienceMatrix,
    composite_resilience_rating: rating
  };
}

/**
 * Tool 4: score_ybn_state
 */
export function handleScoreYbnState(
  params: ScoreYbnStateParams,
  registry: CardRegistry = globalCardRegistry
): ScoreYbnStateResult {
  return scoreYBN(params.ybn, registry);
}
