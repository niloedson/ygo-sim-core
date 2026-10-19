/**
 * @file boardScorer.ts
 * @description Master Multi-Layer V(YBN) Valuation Engine for competitive end-board analysis.
 */

import { GameState, CardInstance, YBNString } from '../types/state.js';
import type { InterruptionLayer, InterruptionKind } from '../types/card-dsl.js';
import type { ScoreYbnStateResult } from '../types/mcp-contracts.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';
import { parseFromYBN } from '../notation/ybnSerializer.js';

export interface ActiveInterruption {
  sourceCard: CardInstance;
  layer: InterruptionLayer;
  kind: InterruptionKind;
  baseQuality: number;
}

/**
 * Base quality points Q(i) by interruption kind.
 */
export const INTERRUPTION_BASE_QUALITY: Record<InterruptionKind, number> = {
  SUMMON_NEGATE: 3.5,
  OMNI_NEGATE: 3.5,
  MONSTER_NEGATE: 2.5,
  SPOT_REMOVAL: 2.5,
  SPELL_TRAP_NEGATE: 2.0,
  FLOODGATE: 3.0
};

/**
 * Extract all verified active interruptions accessible on opponent's turn.
 */
export function extractActiveInterruptions(
  state: GameState,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): ActiveInterruption[] {
  const pZones = player === 1 ? state.p1 : state.p2;
  const interruptions: ActiveInterruption[] = [];

  // 1. Field Monsters (Main & Extra)
  const monsters = [
    ...Object.values(pZones.monsters),
    ...Object.values(pZones.extraMonsters)
  ].filter((m): m is CardInstance => m !== undefined && !m.isNegated);

  for (const m of monsters) {
    const cardDef = registry.getCardById(m.passcode) ?? registry.getCardByName(m.name);
    cardDef?.effects?.forEach((eff) => {
      if (eff.interruptionProfile && eff.activationLocation.includes('FIELD_M')) {
        interruptions.push({
          sourceCard: m,
          layer: 'FIELD',
          kind: eff.interruptionProfile.kind,
          baseQuality: INTERRUPTION_BASE_QUALITY[eff.interruptionProfile.kind]
        });
      }
    });
  }

  // 2. Backrow (Set Spells/Traps)
  for (const s of Object.values(pZones.spells)) {
    if (!s) continue;
    const cardDef = registry.getCardById(s.passcode) ?? registry.getCardByName(s.name);
    cardDef?.effects?.forEach((eff) => {
      if (eff.interruptionProfile) {
        interruptions.push({
          sourceCard: s,
          layer: 'BACKROW',
          kind: eff.interruptionProfile.kind,
          baseQuality: INTERRUPTION_BASE_QUALITY[eff.interruptionProfile.kind]
        });
      }
    });
  }

  // 3. Graveyard Triggers / Quick Effects
  for (const gyCard of pZones.graveyard) {
    const cardDef = registry.getCardById(gyCard.passcode) ?? registry.getCardByName(gyCard.name);
    cardDef?.effects?.forEach((eff) => {
      if (eff.interruptionProfile && eff.activationLocation.includes('GRAVEYARD')) {
        interruptions.push({
          sourceCard: gyCard,
          layer: 'GRAVEYARD',
          kind: eff.interruptionProfile.kind,
          baseQuality: INTERRUPTION_BASE_QUALITY[eff.interruptionProfile.kind]
        });
      }
    });
  }

  // 4. Retained Hand Traps
  const totalFieldCards =
    Object.keys(pZones.monsters).length +
    Object.keys(pZones.extraMonsters).length +
    Object.keys(pZones.spells).length +
    (pZones.fieldSpell ? 1 : 0);

  for (const hCard of pZones.hand) {
    const cardDef = registry.getCardById(hCard.passcode) ?? registry.getCardByName(hCard.name);
    cardDef?.effects?.forEach((eff) => {
      if (eff.interruptionProfile && eff.activationLocation.includes('HAND')) {
        // Enforce generic activation preconditions for hand traps (e.g. Mulcharmy Fuwalos / Evenly Matched)
        const requiresEmptyField =
          eff.conditions?.some((c) => c.type === 'CONTROL_NO_CARDS') ||
          hCard.name.includes('Fuwalos') ||
          hCard.name.includes('Evenly Matched');
        if (requiresEmptyField && totalFieldCards > 0) {
          // Strictly dead going first if controlling any cards on field
          return;
        }

        interruptions.push({
          sourceCard: hCard,
          layer: 'HAND',
          kind: eff.interruptionProfile.kind,
          baseQuality: 2.0 // Searchable / Retained Hand Trap standard base score
        });
      }
    });
  }

  return interruptions;
}

/**
 * Master V(YBN) Valuation Function decomposing a GameState into granular competitive metrics.
 */
export function scoreGameState(
  state: GameState,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): ScoreYbnStateResult {
  const pZones = player === 1 ? state.p1 : state.p2;
  const activeInterruptions = extractActiveInterruptions(state, player, registry);

  // Component 1: Base Interruption Quality
  let omniNegates = 0;
  let monsterNegates = 0;
  let spellTrapNegates = 0;
  let quickRemovals = 0;
  let backrowNegates = 0;
  let baseQualitySubtotal = 0;

  for (const inter of activeInterruptions) {
    baseQualitySubtotal += inter.baseQuality;
    switch (inter.kind) {
      case 'OMNI_NEGATE':
        omniNegates++;
        break;
      case 'MONSTER_NEGATE':
        monsterNegates++;
        if (inter.layer === 'BACKROW') backrowNegates++;
        break;
      case 'SPELL_TRAP_NEGATE':
        spellTrapNegates++;
        break;
      case 'SPOT_REMOVAL':
        quickRemovals++;
        break;
      case 'SUMMON_NEGATE':
        omniNegates++; // Summon negates provide premium tier coverage
        break;
      default:
        break;
    }
  }

  // Component 2: Multi-Layer Zone Diversification Bonus
  const activeLayersSet = new Set<InterruptionLayer>(activeInterruptions.map((i) => i.layer));
  const activeLayers = Array.from(activeLayersSet);
  let layerBonus = 0.0;
  if (activeLayers.length === 2) {
    layerBonus = 1.5;
  } else if (activeLayers.length >= 3) {
    layerBonus = 3.0;
  }

  // Component 3: Anti-Board Breaker Resilience Adjustments
  // Dark Ruler No More Penalty: all negates/interruptions reside strictly on Field
  const allOnField =
    activeInterruptions.length > 0 && activeInterruptions.every((i) => i.layer === 'FIELD');
  const darkRulerVulnerable = allOnField;
  const drnmPenalty = darkRulerVulnerable ? 2.5 : 0.0;

  // Evenly Matched Penalty: zero Spell/Trap or Omni-negates exist
  const canShieldEvenly = omniNegates > 0 || spellTrapNegates > 0;
  const evenlyMatchedVulnerable = !canShieldEvenly && activeInterruptions.length > 0;
  const evenlyPenalty = evenlyMatchedVulnerable ? 2.0 : 0.0;

  // Super Polymerization Clumping Penalty: >= 2 DARK or LIGHT monsters on field
  const fieldMonsters = [
    ...Object.values(pZones.monsters),
    ...Object.values(pZones.extraMonsters)
  ].filter((m): m is CardInstance => m !== undefined);

  let darkLightCount = 0;
  for (const fm of fieldMonsters) {
    const cardDef = registry.getCardById(fm.passcode) ?? registry.getCardByName(fm.name);
    const attr = cardDef?.monsterAttributes?.attribute;
    if (attr === 'DARK' || attr === 'LIGHT') darkLightCount++;
  }
  const superPolyVulnerable = darkLightCount >= 2;
  const superPolyPenalty = superPolyVulnerable ? 1.5 : 0.0;

  const totalBlowoutPenalties = drnmPenalty + evenlyPenalty + superPolyPenalty;

  // Component 4: Turn 3 Follow-Up Recursion
  const handCount = pZones.hand.length;
  // Recyclable starters in GY (e.g. Infinitrack Harvester or Trencher)
  let recyclableStarters = 0;
  for (const gyCard of pZones.graveyard) {
    const cardDef = registry.getCardById(gyCard.passcode) ?? registry.getCardByName(gyCard.name);
    if (cardDef?.taxonomyRole === 'STARTER_NS' || cardDef?.taxonomyRole === 'EXTENDER') {
      recyclableStarters++;
    }
  }

  let followupSubtotal = handCount * 0.8 + recyclableStarters * 1.5;
  if (state.gates.normalSummonAvailable) followupSubtotal += 1.0;

  // Component 5: Conceded Draws Penalty under Fuwalos / Maxx "C"
  let concededDrawsPenalty = 0.0;
  if (state.locks.opponentDrawsOnSpecialSummon) {
    const excessSummons = Math.max(0, state.gates.specialSummonCount - 2);
    concededDrawsPenalty = excessSummons * 3.5;
  }

  // Calculate Net Total Score
  const rawScore =
    baseQualitySubtotal +
    layerBonus +
    followupSubtotal -
    totalBlowoutPenalties -
    concededDrawsPenalty;

  const totalScore = Math.max(0, Math.round(rawScore * 10) / 10);

  return {
    total_score: totalScore,
    breakdown: {
      base_interruptions: {
        omni_negates: omniNegates,
        monster_negates: monsterNegates,
        spell_trap_negates: spellTrapNegates,
        quick_removals: quickRemovals,
        backrow_negates: backrowNegates,
        subtotal: Math.round(baseQualitySubtotal * 10) / 10
      },
      layer_diversification: {
        active_layers: activeLayers,
        bonus_applied: layerBonus
      },
      followup_recursion: {
        hand_count: handCount,
        normal_summon_preserved: state.gates.normalSummonAvailable,
        recyclable_gy_loopers: recyclableStarters,
        subtotal: Math.round(followupSubtotal * 10) / 10
      },
      blowout_vulnerabilities: {
        dark_ruler_vulnerable: darkRulerVulnerable,
        evenly_matched_vulnerable: evenlyMatchedVulnerable,
        super_poly_vulnerable: superPolyVulnerable,
        penalties_applied: Math.round(totalBlowoutPenalties * 10) / 10
      }
    }
  };
}

/**
 * Score any arbitrary RFC 0001 YBN snapshot string directly.
 */
export function scoreYBN(
  ybn: YBNString,
  registry: CardRegistry = globalCardRegistry
): ScoreYbnStateResult {
  const state = parseFromYBN(ybn);
  return scoreGameState(state, state.turnPlayer, registry);
}
