/**
 * @file monteCarlo.ts
 * @description High-throughput Monte Carlo opening hand simulator and .ydk decklist parser.
 */

import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';
import { Logcat } from '../logging/logcat.js';
import { exploreComboTree, Playline } from './treeTraversal.js';
import { createInitialGameState, GameState } from '../types/state.js';
import { computeStateHash } from '../engine/hasher.js';
import { serializeToYBN } from '../notation/ybnSerializer.js';
import { scoreGameState } from '../evaluator/boardScorer.js';
import { auditInsulation } from '../engine/insulationEvaluator.js';
import type { EvaluatedComboLine } from '../types/mcp-contracts.js';

export interface ParsedDeck {
  mainDeck: string[];
  extraDeck: string[];
  sideDeck: string[];
}

export interface MonteCarloOptions {
  sampleSize?: number | undefined; // e.g. 100 or 10000
  handSize?: number | undefined; // e.g. 5
  targetArchetype?: string | undefined;
  customStarterFilter?: ((passcode: string) => boolean) | undefined;
  traceLines?: boolean | undefined; // Enable combo line exploration for sample hands
  traceLimit?: number | undefined; // Max lines to deeply evaluate (default 10)
  maxDepth?: number | undefined; // Max DFS depth (default 40)
}

export interface MonteCarloResult {
  totalSimulations: number;
  sampleSize: number;
  uninterruptedComboRate: number;
  brickRate: number;
  averageStartersPerHand: number;
  starterDistribution: {
    zeroStarters: number;
    oneStarter: number;
    twoStarters: number;
    threeOrMoreStarters: number;
  };
  durationMs: number;
  evaluatedLines?: EvaluatedComboLine[] | undefined;
  logFilePath?: string | null | undefined;
}

/**
 * Build a hermetic GameState from sample hand, remaining deck, and extra deck.
 */
function buildSampleGameState(
  handPasscodes: string[],
  remainingPasscodes: string[],
  extraDeckPasscodes: string[],
  registry: CardRegistry
): GameState {
  const state = createInitialGameState();

  state.p1.hand = handPasscodes.map((code, idx) => {
    const cardDef = registry.getCardById(code) ?? registry.getCardByName(code);
    return {
      instanceId: `#h${idx + 1}`,
      passcode: cardDef?.id ?? code,
      name: cardDef?.name ?? `Card ${code}`,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  state.p1.deck = remainingPasscodes.map((code, idx) => {
    const cardDef = registry.getCardById(code) ?? registry.getCardByName(code);
    return {
      instanceId: `#d${idx + 1}`,
      passcode: code,
      name: cardDef?.name ?? `Card ${code}`,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  state.p1.extraDeck = extraDeckPasscodes.map((code, idx) => {
    const cardDef = registry.getCardById(code) ?? registry.getCardByName(code);
    return {
      instanceId: `#ed${idx + 1}`,
      passcode: code,
      name: cardDef?.name ?? `ED Card ${code}`,
      cardType: cardDef?.cardType ?? 'MONSTER',
      levelOrRank: cardDef?.monsterAttributes?.levelOrRank
    };
  });

  return state;
}

/**
 * Parse a standard .ydk deck file format into main, extra, and side deck passcode lists.
 */
export function parseYdkDeck(content: string): ParsedDeck {
  const lines = content.split(/\r?\n/);
  const mainDeck: string[] = [];
  const extraDeck: string[] = [];
  const sideDeck: string[] = [];

  let currentSection: 'main' | 'extra' | 'side' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#created by')) continue;

    if (trimmed === '#main') {
      currentSection = 'main';
      continue;
    } else if (trimmed === '#extra') {
      currentSection = 'extra';
      continue;
    } else if (trimmed === '!side') {
      currentSection = 'side';
      continue;
    }

    // Passcode lines
    if (/^\d+$/.test(trimmed)) {
      if (currentSection === 'main') mainDeck.push(trimmed);
      else if (currentSection === 'extra') extraDeck.push(trimmed);
      else if (currentSection === 'side') sideDeck.push(trimmed);
    }
  }

  return { mainDeck, extraDeck, sideDeck };
}

/**
 * Fast in-place Fisher-Yates array shuffle.
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i]!;
    array[i] = array[j]!;
    array[j] = temp;
  }
  return array;
}

/**
 * Execute high-throughput Monte Carlo simulation across simulated hands.
 * Designed to execute 10,000 hands in <2.5 seconds, or deep line tracing with sampleSize <= 100.
 */
export function simulateHands(
  deck: ParsedDeck | string,
  options: MonteCarloOptions = {},
  registry: CardRegistry = globalCardRegistry
): MonteCarloResult {
  const startTime = performance.now();

  const parsed = typeof deck === 'string' ? parseYdkDeck(deck) : deck;
  const sampleSize = options.sampleSize ?? 10_000;
  const handSize = options.handSize ?? 5;
  const maxDepth = options.maxDepth ?? 40;
  const shouldTrace = options.traceLines ?? sampleSize <= 100;
  const traceLimit = options.traceLimit ?? Math.min(sampleSize, 10);
  const mainDeckTemplate = [...parsed.mainDeck];

  if (mainDeckTemplate.length < handSize) {
    Logcat.e(
      'SimCore:MonteCarlo',
      `Main deck size (${mainDeckTemplate.length}) is smaller than hand size (${handSize})`
    );
    throw new Error(
      `Main deck size (${mainDeckTemplate.length}) is smaller than hand size (${handSize})`
    );
  }

  Logcat.i(
    'SimCore:MonteCarlo',
    `Initiating Monte Carlo simulation: sampleSize=${sampleSize}, handSize=${handSize}, maxDepth=${maxDepth}, shouldTrace=${shouldTrace}`
  );

  // Pre-classify starters in the deck for maximum throughput
  const isStarterCache = new Map<string, boolean>();
  for (const passcode of mainDeckTemplate) {
    if (!isStarterCache.has(passcode)) {
      if (options.customStarterFilter) {
        isStarterCache.set(passcode, options.customStarterFilter(passcode));
      } else {
        const cardDef = registry.getCardById(passcode);
        const isStarter =
          cardDef?.taxonomyRole === 'STARTER_NS' ||
          cardDef?.taxonomyRole === 'STARTER_SS' ||
          cardDef?.taxonomyRole === 'STARTER_1_5';
        isStarterCache.set(passcode, Boolean(isStarter));
      }
    }
  }

  let totalCombos = 0;
  let totalBricks = 0;
  let totalStartersCount = 0;

  const distribution = {
    zeroStarters: 0,
    oneStarter: 0,
    twoStarters: 0,
    threeOrMoreStarters: 0
  };

  const evaluatedLines: EvaluatedComboLine[] = [];

  // Reusable working deck buffer to avoid object reallocation in the loop
  const workingDeck = [...mainDeckTemplate];
  const deckLen = workingDeck.length;

  for (let s = 0; s < sampleSize; s++) {
    // Partial Fisher-Yates shuffle only for the first `handSize` elements
    for (let i = 0; i < handSize; i++) {
      const j = i + Math.floor(Math.random() * (deckLen - i));
      const temp = workingDeck[i]!;
      workingDeck[i] = workingDeck[j]!;
      workingDeck[j] = temp;
    }

    const handPasscodes = workingDeck.slice(0, handSize);
    let startersInHand = 0;
    for (let i = 0; i < handSize; i++) {
      const passcode = handPasscodes[i]!;
      if (isStarterCache.get(passcode)) {
        startersInHand++;
      }
    }

    totalStartersCount += startersInHand;

    if (startersInHand === 0) {
      totalBricks++;
      distribution.zeroStarters++;
    } else if (startersInHand === 1) {
      totalCombos++;
      distribution.oneStarter++;
    } else if (startersInHand === 2) {
      totalCombos++;
      distribution.twoStarters++;
    } else {
      totalCombos++;
      distribution.threeOrMoreStarters++;
    }

    // Line Tracing (for sample hands up to traceLimit)
    if (shouldTrace && evaluatedLines.length < traceLimit) {
      const sampleState = buildSampleGameState(
        handPasscodes,
        workingDeck.slice(handSize),
        parsed.extraDeck,
        registry
      );
      const handHash = computeStateHash(sampleState).slice(0, 4);
      const lineSig = `LINE#${String(s + 1).padStart(3, '0')}:${handHash}`;

      const handNames = sampleState.p1.hand.map((c) => c.name);
      const isBrick = startersInHand === 0;

      if (isBrick) {
        evaluatedLines.push({
          line_signature: lineSig,
          hand_index: s + 1,
          opening_hand: handNames,
          branch_type: 'BRICK',
          depth_reached: 0,
          ybn_score: 0,
          terminal_ybn: serializeToYBN(sampleState),
          ygn_path: '(No starters in opening hand - Brick)',
          interruption_breakdown: {
            field_negates: 0,
            backrow_disruptions: 0,
            gy_triggers: 0,
            hand_traps: 0,
            distinct_layers: 0
          },
          early_insulation_secured: false
        });
        Logcat.w(
          'SimCore:SimGame',
          `[GAME#${String(s + 1).padStart(3, '0')}:${handHash}] HAND=[${handNames.join(', ')}] | STARTERS=0 | BRICK=1 | LINE=PASS | END_YBN=${serializeToYBN(sampleState)} | V(YBN)=0.0 | STATUS=BRICK`,
          lineSig
        );
      } else {
        const searchResult = exploreComboTree(
          sampleState,
          { maxDepth, maxNodes: 300, branchLimit: 3, lineSignature: lineSig },
          registry
        );

        // Pick highest-scoring playline
        let bestPlayline: Playline | undefined;
        let bestScore = -1;
        let bestReport: ReturnType<typeof scoreGameState> | undefined;
        let bestInsulation: ReturnType<typeof auditInsulation> | undefined;

        for (const pl of searchResult.topPlaylines) {
          const score = scoreGameState(pl.terminalState, 1, registry);
          if (score.total_score > bestScore) {
            bestScore = score.total_score;
            bestPlayline = pl;
            bestReport = score;
            bestInsulation = auditInsulation(pl.terminalState, 1, registry);
          }
        }

        if (bestPlayline && bestReport && bestInsulation) {
          const breakdown = bestReport.breakdown.layer_diversification;
          const pZones = bestPlayline.terminalState.p1;
          const bestLineYgn =
            bestPlayline.actions.map((a) => a.ygnNotation).join(' ➔ ') || '(No actions)';

          evaluatedLines.push({
            line_signature: lineSig,
            hand_index: s + 1,
            opening_hand: handNames,
            branch_type: bestScore >= 4.0 ? 'PRIMARY_CEILING' : 'COMPROMISED_FALLBACK',
            depth_reached: bestPlayline.depth,
            ybn_score: bestScore,
            terminal_ybn: bestPlayline.terminalYBN,
            ygn_path: bestPlayline.ygnTranscript,
            interruption_breakdown: {
              field_negates: bestReport.breakdown.base_interruptions.monster_negates,
              backrow_disruptions: bestReport.breakdown.base_interruptions.backrow_negates,
              gy_triggers: bestReport.breakdown.followup_recursion.recyclable_gy_loopers,
              hand_traps: pZones.hand.length,
              distinct_layers: breakdown.active_layers.length
            },
            early_insulation_secured: bestInsulation.nibiruSecured
          });

          // Log primary game resolution
          Logcat.i(
            'SimCore:SimGame',
            `[GAME#${String(s + 1).padStart(3, '0')}:${handHash}] HAND=[${handNames.join(', ')}] | STARTERS=${startersInHand} | BRICK=0 | LINE=${bestLineYgn} | END_YBN=${bestPlayline.terminalYBN} | V(YBN)=${bestScore} | STATUS=${bestScore >= 4.0 ? 'SUCCESS' : 'COMPROMISED'}`,
            lineSig
          );

          // Log Top-3 Principal Variations for full tree traceability
          for (let pvi = 0; pvi < Math.min(3, searchResult.topPlaylines.length); pvi++) {
            const pl = searchResult.topPlaylines[pvi]!;
            const plScore = scoreGameState(pl.terminalState, 1, registry).total_score;
            const plPath =
              pl.actions.map((a) => a.ygnNotation).join(' ➔ ') || '(No actions)';
            Logcat.d(
              'SimCore:PV',
              `PV#${pvi + 1} [V(YBN)=${plScore}]: ${plPath} | TERMINAL_YBN=${pl.terminalYBN}`,
              lineSig
            );
          }
        }
      }
    }
  }

  const durationMs = performance.now() - startTime;

  Logcat.i(
    'SimCore:MonteCarlo',
    `Monte Carlo complete in ${durationMs.toFixed(1)}ms. Combo Rate: ${(
      (totalCombos / sampleSize) *
      100
    ).toFixed(1)}%, Brick Rate: ${((totalBricks / sampleSize) * 100).toFixed(1)}%`
  );

  Logcat.i(
    'SimCore:SimSummary',
    `TOTAL_GAMES=${sampleSize} | COMBOS=${totalCombos} (${((totalCombos / sampleSize) * 100).toFixed(1)}%) | BRICKS=${totalBricks} (${((totalBricks / sampleSize) * 100).toFixed(1)}%) | AVG_STARTERS=${(totalStartersCount / sampleSize).toFixed(2)} | DURATION=${durationMs.toFixed(1)}ms | LOG_FILE=${Logcat.getLogFilePath() ?? 'N/A'}`
  );

  return {
    totalSimulations: sampleSize,
    sampleSize,
    uninterruptedComboRate: totalCombos / sampleSize,
    brickRate: totalBricks / sampleSize,
    averageStartersPerHand: totalStartersCount / sampleSize,
    starterDistribution: distribution,
    durationMs,
    evaluatedLines: evaluatedLines.length > 0 ? evaluatedLines : undefined,
    logFilePath: Logcat.getLogFilePath()
  };
}
