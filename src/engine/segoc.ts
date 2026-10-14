/**
 * @file segoc.ts
 * @description Official Konami SEGOC (Simultaneous Effects Go On Chain) Hierarchy & Chain Blocking Engine.
 */

import { ChainLink } from './fastEffectEngine.js';

export interface PendingTrigger {
  id: string;
  cardName: string;
  player: 1 | 2;
  isMandatory: boolean;
  priorityScore?: number | undefined; // Higher score indicates higher strategic value to shield (place at earlier CL)
  userOrderPreference?: number | undefined; // Explicit desired 1-based order within tier
}

export type SegocTier = 1 | 2 | 3 | 4;

/**
 * Classify a trigger into one of the 4 official Konami SEGOC tiers.
 * Tier 1: Turn Player Mandatory
 * Tier 2: Non-Turn Player Mandatory
 * Tier 3: Turn Player Optional
 * Tier 4: Non-Turn Player Optional
 */
export function classifySegocTier(trigger: PendingTrigger, turnPlayer: 1 | 2): SegocTier {
  const isTurnPlayer = trigger.player === turnPlayer;

  if (trigger.isMandatory) {
    return isTurnPlayer ? 1 : 2;
  } else {
    return isTurnPlayer ? 3 : 4;
  }
}

/**
 * Build an official SEGOC chain from a collection of simultaneous pending triggers.
 *
 * Sorting rules:
 * 1. Strictly ascending by SEGOC Tier (Tier 1 -> Tier 2 -> Tier 3 -> Tier 4).
 * 2. Within the same tier, if strategic priorityScore is provided:
 *    - Higher value triggers are placed EARLIER (e.g. CL1) so subsequent triggers in the same tier
 *      will CHAIN BLOCK them!
 *    - If userOrderPreference is explicitly provided, it respects that order.
 */
export function buildSegocChain(triggers: PendingTrigger[], turnPlayer: 1 | 2): ChainLink[] {
  if (triggers.length === 0) return [];

  const tierBuckets: Record<SegocTier, PendingTrigger[]> = {
    1: [],
    2: [],
    3: [],
    4: []
  };

  for (const trigger of triggers) {
    const tier = classifySegocTier(trigger, turnPlayer);
    tierBuckets[tier].push(trigger);
  }

  // Sort within each tier
  for (const tier of [1, 2, 3, 4] as const) {
    tierBuckets[tier].sort((a, b) => {
      // Explicit user preference takes precedence
      if (a.userOrderPreference !== undefined && b.userOrderPreference !== undefined) {
        return a.userOrderPreference - b.userOrderPreference;
      }
      // Otherwise, place higher priority targets earlier to receive chain blocking protection
      const scoreA = a.priorityScore ?? 0;
      const scoreB = b.priorityScore ?? 0;
      return scoreB - scoreA;
    });
  }

  const sortedTriggers = [
    ...tierBuckets[1],
    ...tierBuckets[2],
    ...tierBuckets[3],
    ...tierBuckets[4]
  ];

  return sortedTriggers.map((t, index) => ({
    linkNumber: index + 1,
    player: t.player,
    cardName: t.cardName,
    effectId: t.id,
    spellSpeed: 1
  }));
}

/**
 * Determine whether a given chain link is legally "chain blocked" from direct response negations.
 *
 * In Yu-Gi-Oh!, fast effect negations that say "When a card or effect is activated: negate..."
 * (such as Ash Blossom & Joyous Spring, Baronne de Fleur, Crystal Wing, Solemn Strike)
 * MUST directly respond to the chain link they negate.
 *
 * If a chain link is NOT the highest link number on the chain, it is chain blocked against
 * directly responsive negations.
 */
export function isChainBlocked(chain: ChainLink[], targetLinkNumber: number): boolean {
  if (chain.length <= 1) return false;
  // A link is chain blocked if there is at least one subsequent link on the chain
  return targetLinkNumber < chain.length;
}

/**
 * Check if an opponent fast effect can legally target/respond to a specific chain link.
 * Direct responses can ONLY target chain.length (the most recent chain link).
 */
export function canDirectlyRespondToLink(chain: ChainLink[], targetLinkNumber: number): boolean {
  if (chain.length === 0) return false;
  return targetLinkNumber === chain.length;
}
