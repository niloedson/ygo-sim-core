/**
 * @file hasher.ts
 * @description Canonical 64-bit State Hasher using xxHash64 for transposition tables and cycle detection.
 */

import xxhashjs from 'xxhashjs';
import { GameState, YBNString, CardInstance, PlayerZones, SpellTrapZoneId } from '../types/state.js';
import { serializeToYBN } from '../notation/ybnSerializer.js';

// Default 32-bit prime seed for XXH64
export const DEFAULT_HASH_SEED = 0x9747b28c;

/**
 * Compare two CardInstances deterministically for sorting.
 * Prioritizes passcode, then name, then instanceId.
 */
export function compareCards(a: CardInstance, b: CardInstance): number {
  const codeA = a.passcode || '';
  const codeB = b.passcode || '';
  if (codeA !== codeB) return codeA.localeCompare(codeB);

  const nameA = a.name || '';
  const nameB = b.name || '';
  if (nameA !== nameB) return nameA.localeCompare(nameB);

  const idA = a.instanceId || '';
  const idB = b.instanceId || '';
  return idA.localeCompare(idB);
}

/**
 * Canonicalize a PlayerZones structure by sorting unordered piles (GY, banished, hand)
 * and attached materials to ensure permutation-invariant hashing.
 */
export function canonicalizePlayerZones(zones: PlayerZones): PlayerZones {
  const sortCardMaterials = (card?: CardInstance): CardInstance | undefined => {
    if (!card) return undefined;
    if (!card.materials || card.materials.length <= 1) return card;
    return {
      ...card,
      materials: [...card.materials].sort(compareCards)
    };
  };

  const canonicalMonsters: PlayerZones['monsters'] = {};
  for (const [k, v] of Object.entries(zones.monsters) as [
    keyof PlayerZones['monsters'],
    CardInstance | undefined
  ][]) {
    if (v) {
      const sorted = sortCardMaterials(v);
      if (sorted) canonicalMonsters[k] = sorted;
    }
  }

  const canonicalExtraMonsters: PlayerZones['extraMonsters'] = {};
  for (const [k, v] of Object.entries(zones.extraMonsters) as [
    keyof PlayerZones['extraMonsters'],
    CardInstance | undefined
  ][]) {
    if (v) {
      const sorted = sortCardMaterials(v);
      if (sorted) canonicalExtraMonsters[k] = sorted;
    }
  }

  const canonicalSpells: Partial<Record<SpellTrapZoneId, CardInstance>> = {};
  const activeSpellCards = (
    Object.entries(zones.spells) as [SpellTrapZoneId, CardInstance | undefined][]
  )
    .filter(([, c]) => c !== undefined)
    .map(([, c]) => c!)
    .sort(compareCards);

  const stKeys: SpellTrapZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];
  activeSpellCards.forEach((card, idx) => {
    if (idx < stKeys.length) {
      canonicalSpells[stKeys[idx]!] = card;
    }
  });

  return {
    monsters: canonicalMonsters,
    spells: canonicalSpells,
    fieldSpell: zones.fieldSpell,
    extraMonsters: canonicalExtraMonsters,
    hand: zones.hand.length > 1 ? [...zones.hand].sort(compareCards) : zones.hand,
    graveyard:
      zones.graveyard.length > 1 ? [...zones.graveyard].sort(compareCards) : zones.graveyard,
    banished: zones.banished.length > 1 ? [...zones.banished].sort(compareCards) : zones.banished,
    deck: zones.deck, // Main Deck order is preserved or tracked by count
    extraDeck: zones.extraDeck
  };
}

/**
 * Produce a canonical string representation of a GameState for hashing.
 */
export function canonicalizeGameState(state: GameState): string {
  const canonicalP1 = canonicalizePlayerZones(state.p1);
  const canonicalP2 = canonicalizePlayerZones(state.p2);

  const canonicalState: GameState = {
    ...state,
    p1: canonicalP1,
    p2: canonicalP2
  };

  // Base YBN snapshot representation of the canonicalized state
  const ybn = serializeToYBN(canonicalState);

  // Append sorted registries for full deterministic state representation
  const hopt = Array.from(state.registers.hoptActivated).sort().join(',');
  const sopt = Array.from(state.registers.soptActivated).sort().join(',');
  const sentGY = Array.from(state.registers.cardsSentToGYThisTurn).sort().join(',');

  return `${ybn}|R:HOPT=[${hopt}],SOPT=[${sopt}],GY=[${sentGY}]`;
}

/**
 * Compute the 64-bit compact xxHash64 hex string (16 characters) for a given state.
 */
export function computeStateHash(state: GameState, seed = DEFAULT_HASH_SEED): string {
  const canonicalStr = canonicalizeGameState(state);
  return xxhashjs.h64(canonicalStr, seed).toString(16).padStart(16, '0');
}

/**
 * Compute 64-bit compact xxHash64 directly from a YBN string.
 */
export function hashYBN(ybn: YBNString, seed = DEFAULT_HASH_SEED): string {
  return xxhashjs.h64(ybn.trim(), seed).toString(16).padStart(16, '0');
}
