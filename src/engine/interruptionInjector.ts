/**
 * @file interruptionInjector.ts
 * @description Adversarial Hand Trap Injection Engine stress-testing combo lines against Ash, Imperm, Nibiru, Droll, and Fuwalos.
 */

import { GameState, cloneGameState } from '../types/state.js';
import { Playline } from '../search/treeTraversal.js';
import { auditInsulation, findHandProtectionCards } from './insulationEvaluator.js';
import { serializeToYBN } from '../notation/ybnSerializer.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';

export type HandTrapThreatName =
  | 'Ash Blossom & Joyous Spring'
  | 'Infinite Impermanence'
  | 'Nibiru, the Primal Being'
  | 'Droll & Lock Bird'
  | 'Mulcharmy Fuwalos';

export interface ThreatEvaluationResult {
  threat: string;
  stepInjected: number;
  protectedByInsulation: boolean;
  insulationCardUsed?: string | undefined;
  fallbackYbnScore: number;
  survivalRatio: number;
  chokepointSeverity: 'Low' | 'Medium' | 'High';
  compromisedYBN?: string | undefined;
}

export interface ResilienceReport {
  ceilingYbnScore: number;
  resilienceMatrix: ThreatEvaluationResult[];
  compositeResilienceRating: 'S' | 'A+' | 'A' | 'A-' | 'B' | 'C' | 'F';
  averageSurvivalRatio: number;
}

export const DEFAULT_THREAT_SUITE: HandTrapThreatName[] = [
  'Ash Blossom & Joyous Spring',
  'Infinite Impermanence',
  'Nibiru, the Primal Being',
  'Droll & Lock Bird',
  'Mulcharmy Fuwalos'
];

/**
 * Apply Nibiru board wipe to a state: removes all monsters, spawns Token.
 */
export function applyNibiruWipe(state: GameState, player: 1 | 2 = state.turnPlayer): GameState {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;
  const oppZones = player === 1 ? next.p2 : next.p1;

  let totalTributedAtk = 0;
  let totalTributedDef = 0;

  // Clear main monsters
  for (const [k, m] of Object.entries(pZones.monsters)) {
    if (m) {
      totalTributedAtk += m.atk ?? 1000;
      totalTributedDef += m.def ?? 1000;
      delete pZones.monsters[k as keyof typeof pZones.monsters];
      pZones.graveyard.push(m);
    }
  }

  // Clear extra monsters
  for (const [k, m] of Object.entries(pZones.extraMonsters)) {
    if (m) {
      totalTributedAtk += m.atk ?? 1500;
      totalTributedDef += m.def ?? 1000;
      delete pZones.extraMonsters[k as keyof typeof pZones.extraMonsters];
      pZones.graveyard.push(m);
    }
  }

  // Place Primal Being Token on player's field
  pZones.monsters.M1 = {
    instanceId: '#tok1',
    passcode: '00000000',
    name: 'Primal Being Token',
    cardType: 'MONSTER',
    position: 'def',
    atk: totalTributedAtk,
    def: totalTributedDef
  };

  // Place Nibiru on opponent's field
  oppZones.monsters.M2 = {
    instanceId: '#nib1',
    passcode: '27204311',
    name: 'Nibiru, the Primal Being',
    cardType: 'MONSTER',
    position: 'atk',
    atk: 3000,
    def: 600
  };

  next.stepIndex += 1;
  return next;
}

/**
 * Estimate a baseline end-board quality score for a terminal state.
 * (Full mathematical V(YBN) valuation is codified in Phase 6).
 */
export function estimateTerminalQuality(
  state: GameState,
  player: 1 | 2 = state.turnPlayer
): number {
  const pZones = player === 1 ? state.p1 : state.p2;
  const monsters = [
    ...Object.values(pZones.monsters),
    ...Object.values(pZones.extraMonsters)
  ].filter(Boolean);
  const spells = Object.values(pZones.spells).filter(Boolean);

  let score = monsters.length * 2.5 + spells.length * 1.5 + pZones.hand.length * 0.8;
  if (state.gates.normalSummonAvailable) score += 1.0;
  return Math.round(score * 10) / 10;
}

/**
 * Test an unhindered candidate playline against standard competitive hand traps.
 */
export function evaluateHandtrapResilience(
  playline: Playline,
  threatSuite: HandTrapThreatName[] = DEFAULT_THREAT_SUITE,
  ceilingScore?: number,
  registry: CardRegistry = globalCardRegistry
): ResilienceReport {
  const baseCeiling = ceilingScore ?? estimateTerminalQuality(playline.terminalState);
  const results: ThreatEvaluationResult[] = [];

  const handProtection = findHandProtectionCards(playline.terminalState);
  const insulation = auditInsulation(playline.terminalState, 1, registry);

  for (const threat of threatSuite) {
    switch (threat) {
      case 'Ash Blossom & Joyous Spring': {
        // Search/dump interception: Protected if player retains Called by the Grave or Crossout
        const hasCalled = handProtection.length > 0;
        if (hasCalled) {
          results.push({
            threat: 'Ash Blossom & Joyous Spring on Starter Search',
            stepInjected: 1,
            protectedByInsulation: true,
            insulationCardUsed: handProtection[0],
            fallbackYbnScore: baseCeiling,
            survivalRatio: 1.0,
            chokepointSeverity: 'Low'
          });
        } else {
          // Unprotected Ash Blossom drops starter search by ~40%
          const fallbackScore = Math.max(2.0, Math.round(baseCeiling * 0.6 * 10) / 10);
          results.push({
            threat: 'Ash Blossom & Joyous Spring on Starter Search',
            stepInjected: 1,
            protectedByInsulation: false,
            fallbackYbnScore: fallbackScore,
            survivalRatio: Math.round((fallbackScore / baseCeiling) * 100) / 100,
            chokepointSeverity: 'High'
          });
        }
        break;
      }

      case 'Nibiru, the Primal Being': {
        const totalSummons =
          (playline.terminalState.gates.normalSummonAvailable ? 0 : 1) +
          playline.terminalState.gates.specialSummonCount;

        if (totalSummons < 5) {
          // Playline never reached 5 summons: immune to Nibiru!
          results.push({
            threat: 'Nibiru, the Primal Being at Summon 5',
            stepInjected: 5,
            protectedByInsulation: true,
            fallbackYbnScore: baseCeiling,
            survivalRatio: 1.0,
            chokepointSeverity: 'Low'
          });
        } else if (insulation.nibiruSecured) {
          // Summon 5 reached, but omni-negate (e.g. Baronne, Caesar) was established beforehand
          results.push({
            threat: 'Nibiru, the Primal Being at Summon 5',
            stepInjected: 5,
            protectedByInsulation: true,
            insulationCardUsed: insulation.insulationBossName ?? 'Active Omni-Negate',
            fallbackYbnScore: baseCeiling,
            survivalRatio: 1.0,
            chokepointSeverity: 'Low'
          });
        } else {
          // Uninsulated Summon 5+: Nibiru board wipe occurs!
          const wipedState = applyNibiruWipe(playline.terminalState);
          const fallbackScore = estimateTerminalQuality(wipedState);
          results.push({
            threat: 'Nibiru, the Primal Being at Summon 5',
            stepInjected: 5,
            protectedByInsulation: false,
            fallbackYbnScore: fallbackScore,
            survivalRatio: Math.round((fallbackScore / baseCeiling) * 100) / 100,
            compromisedYBN: serializeToYBN(wipedState),
            chokepointSeverity: 'High'
          });
        }
        break;
      }

      case 'Infinite Impermanence': {
        const isProtected = handProtection.length > 0 || insulation.activeOmniNegates > 0;
        const fallbackScore = isProtected ? baseCeiling : Math.round(baseCeiling * 0.75 * 10) / 10;
        results.push({
          threat: 'Infinite Impermanence on Normal Summon',
          stepInjected: 1,
          protectedByInsulation: isProtected,
          insulationCardUsed: isProtected ? handProtection[0] : undefined,
          fallbackYbnScore: fallbackScore,
          survivalRatio: Math.round((fallbackScore / baseCeiling) * 100) / 100,
          chokepointSeverity: isProtected ? 'Low' : 'Medium'
        });
        break;
      }

      case 'Droll & Lock Bird': {
        // Droll locks further searches: hurts pure search combos
        const fallbackScore = Math.round(baseCeiling * 0.7 * 10) / 10;
        results.push({
          threat: 'Droll & Lock Bird after First Search',
          stepInjected: 1,
          protectedByInsulation: false,
          fallbackYbnScore: fallbackScore,
          survivalRatio: Math.round((fallbackScore / baseCeiling) * 100) / 100,
          chokepointSeverity: 'Medium'
        });
        break;
      }

      case 'Mulcharmy Fuwalos': {
        // Fuwalos draws cards on SS from Deck/Extra Deck: compromises score
        const fallbackScore = Math.round(baseCeiling * 0.65 * 10) / 10;
        results.push({
          threat: 'Mulcharmy Fuwalos at Special Summon #1',
          stepInjected: 1,
          protectedByInsulation: false,
          fallbackYbnScore: fallbackScore,
          survivalRatio: Math.round((fallbackScore / baseCeiling) * 100) / 100,
          chokepointSeverity: 'High'
        });
        break;
      }
    }
  }

  const avgSurvival = results.reduce((acc, r) => acc + r.survivalRatio, 0) / (results.length || 1);

  let rating: ResilienceReport['compositeResilienceRating'] = 'F';
  if (avgSurvival >= 0.95) rating = 'S';
  else if (avgSurvival >= 0.9) rating = 'A+';
  else if (avgSurvival >= 0.8) rating = 'A';
  else if (avgSurvival >= 0.7) rating = 'A-';
  else if (avgSurvival >= 0.55) rating = 'B';
  else if (avgSurvival >= 0.4) rating = 'C';

  return {
    ceilingYbnScore: baseCeiling,
    resilienceMatrix: results,
    compositeResilienceRating: rating,
    averageSurvivalRatio: Math.round(avgSurvival * 100) / 100
  };
}
