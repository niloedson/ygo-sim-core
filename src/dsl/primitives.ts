/**
 * @file primitives.ts
 * @description Atomic resolution operations, cost payment executors, and PSCT condition checkers.
 */

import {
  GameState,
  CardInstance,
  MainMonsterZoneId,
  ExtraMonsterZoneId,
  MonsterPosition,
  cloneGameState,
  cloneCardInstance
} from '../types/state.js';
import type { CostOperation, ResolutionOperation, EffectDefinition } from '../types/card-dsl.js';
import type { TimingState } from '../engine/fastEffectEngine.js';
import type { CardRegistry } from './archetypeLoader.js';

/**
 * Filter matching helper for search/special summon operations.
 */
export function matchesCardFilter(
  card: CardInstance,
  filter?: ResolutionOperation['filter'],
  registryOrLookup?: CardRegistry | ((passcode: string) => string[] | undefined)
): boolean {
  if (!filter) return true;

  if (
    filter.excludeId &&
    (card.passcode === filter.excludeId || card.instanceId === filter.excludeId)
  ) {
    return false;
  }

  if (filter.cardType && card.cardType !== filter.cardType) {
    return false;
  }

  if (filter.levelMax !== undefined && card.levelOrRank !== undefined) {
    if (card.levelOrRank > filter.levelMax) return false;
  }

  if (filter.archetype) {
    let cardArchetypes: string[] = [];
    if (typeof registryOrLookup === 'function') {
      cardArchetypes = registryOrLookup(card.passcode) ?? [];
    } else if (
      registryOrLookup &&
      typeof (registryOrLookup as CardRegistry).getCardById === 'function'
    ) {
      const def =
        (registryOrLookup as CardRegistry).getCardById(card.passcode) ??
        (registryOrLookup as CardRegistry).getCardByName(card.name);
      cardArchetypes = def?.archetypes ?? [];
    }
    if (!cardArchetypes.includes(filter.archetype)) return false;
  }

  return true;
}

/**
 * Find the first available Main Monster Zone for a player.
 */
export function findAvailableMMZ(state: GameState, player: 1 | 2): MainMonsterZoneId | undefined {
  const zones = player === 1 ? state.p1 : state.p2;
  const mmzOrder: MainMonsterZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
  return mmzOrder.find((z) => !zones.monsters[z]);
}

/**
 * Find the first available Extra Monster Zone.
 */
export function findAvailableEMZ(state: GameState, player: 1 | 2): ExtraMonsterZoneId | undefined {
  const zones = player === 1 ? state.p1 : state.p2;
  const opponentZones = player === 1 ? state.p2 : state.p1;

  // Extra Monster Zones (EL and ER) are shared between both players
  const emzOrder: ExtraMonsterZoneId[] = ['ER', 'EL'];
  return emzOrder.find((z) => !zones.extraMonsters[z] && !opponentZones.extraMonsters[z]);
}

/**
 * Atomic SEARCH primitive: moves a card matching filter from source pile to destination.
 */
export function applySearch(
  state: GameState,
  player: 1 | 2,
  filter?: ResolutionOperation['filter'],
  from: 'DECK' | 'GRAVEYARD' = 'DECK',
  to: 'HAND' = 'HAND',
  archetypesLookup?: (passcode: string) => string[]
): { nextState: GameState; foundCard?: CardInstance | undefined } {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;
  const sourcePile = from === 'DECK' ? pZones.deck : pZones.graveyard;

  const foundIndex = sourcePile.findIndex((c) => matchesCardFilter(c, filter, archetypesLookup));
  if (foundIndex === -1) {
    return { nextState: next };
  }

  const [card] = sourcePile.splice(foundIndex, 1);
  if (card && to === 'HAND') {
    pZones.hand.push(card);
  }

  next.stepIndex += 1;
  return { nextState: next, foundCard: card };
}

/**
 * Atomic SPECIAL_SUMMON primitive: places a card into a specified monster zone.
 */
export function applySpecialSummon(
  state: GameState,
  player: 1 | 2,
  card: CardInstance,
  targetZone: MainMonsterZoneId | ExtraMonsterZoneId,
  position: MonsterPosition = 'atk',
  from: 'HAND' | 'DECK' | 'GRAVEYARD' | 'EXTRA_DECK' = 'HAND'
): GameState {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;

  // Remove from source pile
  let sourcePile: CardInstance[];
  switch (from) {
    case 'HAND':
      sourcePile = pZones.hand;
      break;
    case 'DECK':
      sourcePile = pZones.deck;
      break;
    case 'GRAVEYARD':
      sourcePile = pZones.graveyard;
      break;
    case 'EXTRA_DECK':
      sourcePile = pZones.extraDeck;
      break;
  }

  const idx = sourcePile.findIndex(
    (c) =>
      c.instanceId === card.instanceId || (c.name === card.name && c.passcode === card.passcode)
  );
  if (idx !== -1) {
    sourcePile.splice(idx, 1);
  }

  const summonedCard: CardInstance = {
    ...cloneCardInstance(card),
    position
  };

  if (targetZone === 'EL' || targetZone === 'ER') {
    pZones.extraMonsters[targetZone] = summonedCard;
  } else {
    pZones.monsters[targetZone] = summonedCard;
  }

  // Increment special summon counter
  next.gates.specialSummonCount += 1;
  next.stepIndex += 1;

  return next;
}

/**
 * Atomic MILL primitive: sends cards from top of Main Deck to Graveyard.
 */
export function applyMill(state: GameState, player: 1 | 2, count = 1): GameState {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;

  for (let i = 0; i < count && pZones.deck.length > 0; i++) {
    const card = pZones.deck.shift()!;
    card.turnSentToGY = next.turn;
    pZones.graveyard.push(card);
    next.registers.cardsSentToGYThisTurn.add(card.instanceId || card.passcode);
  }

  next.stepIndex += 1;
  return next;
}

/**
 * Atomic ATTACH_MATERIAL primitive: attaches a card from a pile or field as material to an Xyz monster.
 */
export function applyAttachMaterial(
  state: GameState,
  player: 1 | 2,
  materialCard: CardInstance,
  targetZone: MainMonsterZoneId | ExtraMonsterZoneId
): GameState {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;
  const targetMonster =
    targetZone === 'EL' || targetZone === 'ER'
      ? pZones.extraMonsters[targetZone]
      : pZones.monsters[targetZone];

  if (!targetMonster) {
    throw new Error(`Cannot attach material: no monster in target zone ${targetZone}`);
  }

  const materials = targetMonster.materials ? [...targetMonster.materials] : [];
  materials.push(cloneCardInstance(materialCard));
  targetMonster.materials = materials;

  next.stepIndex += 1;
  return next;
}

/**
 * Check whether cost operations can currently be paid.
 */
export function canPayCost(
  state: GameState,
  player: 1 | 2,
  cost: CostOperation,
  sourceCard: CardInstance
): boolean {
  const pZones = player === 1 ? state.p1 : state.p2;
  const currentLP = player === 1 ? state.lifePoints.player1 : state.lifePoints.player2;

  switch (cost.type) {
    case 'DISCARD_THIS_CARD':
      return pZones.hand.some(
        (c) => c.instanceId === sourceCard.instanceId || c.name === sourceCard.name
      );

    case 'DISCARD_GENERIC_CARD':
      return pZones.hand.length >= (cost.amount ?? 1);

    case 'PAY_LP':
      return currentLP > (cost.amount ?? 0);

    case 'BANISH_SELF_FROM_GY':
      return pZones.graveyard.some(
        (c) => c.instanceId === sourceCard.instanceId || c.name === sourceCard.name
      );

    case 'TRIBUTE_SELF':
    case 'SEND_SELF_TO_GY':
      return true;

    case 'DETACH_XYZ_MATERIAL': {
      const allMonsters = [
        ...Object.values(pZones.monsters),
        ...Object.values(pZones.extraMonsters)
      ];
      const target = allMonsters.find(
        (m) => m?.instanceId === sourceCard.instanceId || m?.name === sourceCard.name
      );
      return (target?.materials?.length ?? 0) >= (cost.amount ?? 1);
    }
  }
}

/**
 * Execute a cost operation on the game state.
 */
export function applyCost(
  state: GameState,
  player: 1 | 2,
  cost: CostOperation,
  sourceCard: CardInstance
): GameState {
  const next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;

  switch (cost.type) {
    case 'DISCARD_THIS_CARD': {
      const idx = pZones.hand.findIndex(
        (c) => c.instanceId === sourceCard.instanceId || c.name === sourceCard.name
      );
      if (idx !== -1) {
        const [discarded] = pZones.hand.splice(idx, 1);
        if (discarded) {
          discarded.turnSentToGY = next.turn;
          pZones.graveyard.push(discarded);
          next.registers.cardsSentToGYThisTurn.add(discarded.instanceId || discarded.passcode);
        }
      }
      break;
    }

    case 'DISCARD_GENERIC_CARD': {
      const amount = cost.amount ?? 1;
      for (let i = 0; i < amount && pZones.hand.length > 0; i++) {
        const discarded = pZones.hand.pop()!;
        discarded.turnSentToGY = next.turn;
        pZones.graveyard.push(discarded);
        next.registers.cardsSentToGYThisTurn.add(discarded.instanceId || discarded.passcode);
      }
      break;
    }

    case 'PAY_LP': {
      const amount = cost.amount ?? 0;
      if (player === 1) {
        next.lifePoints.player1 = Math.max(0, next.lifePoints.player1 - amount);
      } else {
        next.lifePoints.player2 = Math.max(0, next.lifePoints.player2 - amount);
      }
      break;
    }

    case 'BANISH_SELF_FROM_GY': {
      const idx = pZones.graveyard.findIndex(
        (c) => c.instanceId === sourceCard.instanceId || c.name === sourceCard.name
      );
      if (idx !== -1) {
        const [banished] = pZones.graveyard.splice(idx, 1);
        if (banished) {
          pZones.banished.push(banished);
        }
      }
      break;
    }

    case 'DETACH_XYZ_MATERIAL': {
      const allMonsters = [
        ...Object.values(pZones.monsters),
        ...Object.values(pZones.extraMonsters)
      ];
      const target = allMonsters.find(
        (m) => m?.instanceId === sourceCard.instanceId || m?.name === sourceCard.name
      );
      if (target && target.materials && target.materials.length >= (cost.amount ?? 1)) {
        const detached = target.materials.shift()!;
        detached.turnSentToGY = next.turn;
        pZones.graveyard.push(detached);
        next.registers.cardsSentToGYThisTurn.add(detached.instanceId || detached.passcode);
      }
      break;
    }

    case 'TRIBUTE_SELF':
    case 'SEND_SELF_TO_GY': {
      // Find on field and move to GY
      for (const [k, m] of Object.entries(pZones.monsters) as [
        MainMonsterZoneId,
        CardInstance | undefined
      ][]) {
        if (m && (m.instanceId === sourceCard.instanceId || m.name === sourceCard.name)) {
          delete pZones.monsters[k];
          m.turnSentToGY = next.turn;
          pZones.graveyard.push(m);
          next.registers.cardsSentToGYThisTurn.add(m.instanceId || m.passcode);
          break;
        }
      }
      break;
    }
  }

  return next;
}

/**
 * Check if all preconditions of an effect are currently met.
 */
export function checkConditions(
  state: GameState,
  player: 1 | 2,
  effect: EffectDefinition,
  timingState?: TimingState
): boolean {
  // 1. Check HOPT registry
  if (effect.hoptGroup && state.registers.hoptActivated.has(effect.hoptGroup)) {
    return false;
  }

  const pZones = player === 1 ? state.p1 : state.p2;
  const oppZones = player === 1 ? state.p2 : state.p1;

  for (const cond of effect.conditions) {
    switch (cond.type) {
      case 'HOPT_NOT_USED':
        if (effect.hoptGroup && state.registers.hoptActivated.has(effect.hoptGroup)) return false;
        break;

      case 'CONTROL_NO_MONSTERS': {
        const count =
          Object.keys(pZones.monsters).length + Object.keys(pZones.extraMonsters).length;
        if (count > 0) return false;
        break;
      }

      case 'OPPONENT_CONTROLS_MONSTER': {
        const count =
          Object.keys(oppZones.monsters).length + Object.keys(oppZones.extraMonsters).length;
        if (count === 0) return false;
        break;
      }

      case 'CHAIN_LINK_EXISTS':
        if (!timingState || timingState.chain.length === 0) return false;
        break;

      case 'OPPONENT_ACTIVATED_EFFECT': {
        if (!timingState || timingState.chain.length === 0) return false;
        const lastLink = timingState.chain[timingState.chain.length - 1]!;
        const opponent = player === 1 ? 2 : 1;
        if (lastLink.player !== opponent) return false;
        break;
      }

      case 'EFFECT_INCLUDES_DECK_SEARCH_OR_MILL_OR_SS':
      case 'EVENT_IS_NORMAL_OR_SPECIAL_SUMMONED':
      case 'EVENT_IS_SENT_TO_GY':
      case 'EVENT_IS_BANISHED':
        // Event triggers are verified at dispatch/trigger time
        break;
    }
  }

  return true;
}
