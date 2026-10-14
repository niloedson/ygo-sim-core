/**
 * @file insulationEvaluator.ts
 * @description Evaluates pre-summon 5 Nibiru insulation, pre-Normal Summon baits, and hand protection.
 */

import { GameState, CardInstance } from '../types/state.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';

export interface InsulationReport {
  nibiruSecured: boolean;
  nibiruSecuredAtSummon?: number | undefined;
  insulationBossName?: string | undefined;
  normalSummonPreservedAsBait: boolean;
  activeOmniNegates: number;
  activeMonsterNegates: number;
  activeSummonNegates: number;
  handProtectionCards: string[];
  safetyBonus: number;
}

/**
 * Audit active field monsters to identify active negate and insulation bosses.
 */
export function countActiveFieldNegates(
  state: GameState,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): { omni: number; monster: number; summon: number; bossNames: string[] } {
  const pZones = player === 1 ? state.p1 : state.p2;
  const activeMonsters: CardInstance[] = [
    ...Object.values(pZones.monsters),
    ...Object.values(pZones.extraMonsters)
  ].filter((m): m is CardInstance => m !== undefined && !m.isNegated);

  let omni = 0;
  let monster = 0;
  let summon = 0;
  const bossNames: string[] = [];

  for (const m of activeMonsters) {
    const cardDef = registry.getCardById(m.passcode) ?? registry.getCardByName(m.name);
    if (!cardDef?.effects) continue;

    for (const eff of cardDef.effects) {
      if (eff.interruptionProfile) {
        if (eff.interruptionProfile.kind === 'OMNI_NEGATE') {
          omni++;
          bossNames.push(m.name);
        } else if (eff.interruptionProfile.kind === 'MONSTER_NEGATE') {
          monster++;
          bossNames.push(m.name);
        } else if (eff.interruptionProfile.kind === 'SUMMON_NEGATE') {
          summon++;
          bossNames.push(m.name);
        }
      }
    }
  }

  return { omni, monster, summon, bossNames };
}

/**
 * Scan hand and set backrow for defensive insulation cards (e.g. Called by the Grave, Crossout).
 */
export function findHandProtectionCards(
  state: GameState,
  player: 1 | 2 = state.turnPlayer
): string[] {
  const pZones = player === 1 ? state.p1 : state.p2;
  const protectionCards: string[] = [];

  const candidates = [
    ...pZones.hand,
    ...Object.values(pZones.spells).filter((s): s is CardInstance => s !== undefined)
  ];

  for (const c of candidates) {
    if (
      c.name.includes('Called by the Grave') ||
      c.name.includes('Crossout Designator') ||
      c.passcode === '24224830' // Called by the Grave
    ) {
      if (!protectionCards.includes(c.name)) {
        protectionCards.push(c.name);
      }
    }
  }

  return protectionCards;
}

/**
 * Perform a comprehensive insulation audit on the current state.
 */
export function auditInsulation(
  state: GameState,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): InsulationReport {
  const totalSummons = (state.gates.normalSummonAvailable ? 0 : 1) + state.gates.specialSummonCount;
  const negates = countActiveFieldNegates(state, player, registry);
  const protectionCards = findHandProtectionCards(state, player);

  // The Nibiru Rule: An omni-negate or summon negate deployed at Summon <= 4 guarantees Nibiru insulation
  const hasStrongNegate = negates.omni > 0 || negates.summon > 0;
  const nibiruSecured = totalSummons <= 4 && hasStrongNegate;

  let safetyBonus = 0;
  if (nibiruSecured) safetyBonus += 2.5;
  if (state.gates.normalSummonAvailable) safetyBonus += 1.0;
  if (protectionCards.length > 0) safetyBonus += 1.5;

  return {
    nibiruSecured,
    nibiruSecuredAtSummon: nibiruSecured ? totalSummons : undefined,
    insulationBossName: negates.bossNames[0],
    normalSummonPreservedAsBait: state.gates.normalSummonAvailable,
    activeOmniNegates: negates.omni,
    activeMonsterNegates: negates.monster,
    activeSummonNegates: negates.summon,
    handProtectionCards: protectionCards,
    safetyBonus
  };
}
