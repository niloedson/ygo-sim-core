/**
 * @file fastEffectEngine.ts
 * @description Official Konami Fast Effect Timing Chart State Machine (Boxes A through E).
 */

import { GameState, cloneGameState } from '../types/state.js';

export type TimingBox = 'BOX_A' | 'BOX_B' | 'BOX_C' | 'BOX_D' | 'BOX_E';

export interface ChainLink {
  linkNumber: number;
  player: 1 | 2;
  cardName: string;
  effectId: string;
  spellSpeed: 1 | 2 | 3;
  targetChainLink?: number | undefined;
  isNegated?: boolean | undefined;
  costPaid?: boolean | undefined;
  actionPayload?: unknown | undefined;
}

export interface TimingState {
  currentBox: TimingBox;
  priorityPlayer: 1 | 2;
  consecutivePasses: number;
  chain: ChainLink[];
  gameState: GameState;
  lastActionThatDoesNotStartAChain?: string | undefined;
}

/**
 * Initialize Open Game State (Box A).
 * Turn Player has priority.
 */
export function initOpenGameState(state: GameState): TimingState {
  return {
    currentBox: 'BOX_A',
    priorityPlayer: state.turnPlayer,
    consecutivePasses: 0,
    chain: [],
    gameState: cloneGameState(state)
  };
}

/**
 * Called when an action that does not start a chain occurs (e.g. Normal Summon, Set card).
 * Transitions directly to Box B (Turn Player Fast Effect Window).
 */
export function triggerNonChainAction(timingState: TimingState, actionName: string): TimingState {
  return {
    ...timingState,
    currentBox: 'BOX_B',
    priorityPlayer: timingState.gameState.turnPlayer,
    consecutivePasses: 0,
    chain: [],
    lastActionThatDoesNotStartAChain: actionName
  };
}

/**
 * Pass priority according to the official Fast Effect Timing Chart.
 */
export function passPriority(timingState: TimingState): TimingState {
  const turnPlayer = timingState.gameState.turnPlayer;
  const opponent = turnPlayer === 1 ? 2 : 1;

  switch (timingState.currentBox) {
    case 'BOX_A':
      // Turn player passes in Open Game State -> Opponent fast effect window (Box C)
      return {
        ...timingState,
        currentBox: 'BOX_C',
        priorityPlayer: opponent,
        consecutivePasses: 1
      };

    case 'BOX_B':
      // Turn player passes in Box B -> Box C (Opponent Fast Effect Window)
      return {
        ...timingState,
        currentBox: 'BOX_C',
        priorityPlayer: opponent,
        consecutivePasses: 1
      };

    case 'BOX_C':
      // Opponent passes in Box C -> Both passed, returns to Box A (Open Game State)
      return {
        ...timingState,
        currentBox: 'BOX_A',
        priorityPlayer: turnPlayer,
        consecutivePasses: 0,
        lastActionThatDoesNotStartAChain: undefined
      };

    case 'BOX_D': {
      // Chain building: passing alternates priority until both pass consecutively
      const newPasses = timingState.consecutivePasses + 1;
      if (newPasses >= 2) {
        // Both players passed consecutively -> proceed to Box E (Chain Resolution)
        return {
          ...timingState,
          currentBox: 'BOX_E',
          consecutivePasses: 0
        };
      }
      return {
        ...timingState,
        priorityPlayer: timingState.priorityPlayer === 1 ? 2 : 1,
        consecutivePasses: newPasses
      };
    }

    case 'BOX_E':
      // Chain is ready to resolve
      return timingState;
  }
}

/**
 * Add a chain link to the chain, validating Spell Speed timing legality.
 */
export function addChainLink(
  timingState: TimingState,
  linkSpec: Omit<ChainLink, 'linkNumber'>
): TimingState {
  // If chain is currently empty
  if (timingState.chain.length === 0) {
    // In Box B or C, only Spell Speed 2+ can be activated (Fast Effects)
    if (
      (timingState.currentBox === 'BOX_B' || timingState.currentBox === 'BOX_C') &&
      linkSpec.spellSpeed < 2
    ) {
      throw new Error(
        `Illegal activation: Cannot activate Spell Speed 1 effect in ${timingState.currentBox}`
      );
    }
  } else {
    // Chain building (Box D): Check Spell Speed hierarchy
    const lastLink = timingState.chain[timingState.chain.length - 1]!;

    if (lastLink.spellSpeed === 3 && linkSpec.spellSpeed !== 3) {
      throw new Error(
        'Illegal chain link: Only Spell Speed 3 (Counter Traps) can respond to Spell Speed 3'
      );
    }

    if (linkSpec.spellSpeed < lastLink.spellSpeed) {
      throw new Error(
        `Illegal chain link: Cannot respond with Spell Speed ${linkSpec.spellSpeed} to Spell Speed ${lastLink.spellSpeed}`
      );
    }
  }

  const newLink: ChainLink = {
    ...linkSpec,
    linkNumber: timingState.chain.length + 1
  };

  const nextChain = [...timingState.chain, newLink];
  const nextPriority = linkSpec.player === 1 ? 2 : 1;

  return {
    ...timingState,
    currentBox: 'BOX_D',
    priorityPlayer: nextPriority,
    consecutivePasses: 0,
    chain: nextChain
  };
}

/**
 * Resolve the current chain in strict LIFO order (Box E).
 * After chain resolves, transitions to Box B (Turn Player Fast Effect Window) per official KDE rules.
 */
export function resolveChain(
  timingState: TimingState,
  customResolver?: (link: ChainLink, state: GameState) => GameState
): TimingState {
  let currentState = cloneGameState(timingState.gameState);

  // Resolve in LIFO order (reverse of activation order)
  const linksToResolve = [...timingState.chain].reverse();

  for (const link of linksToResolve) {
    if (link.isNegated) {
      continue; // Negated effects do not resolve
    }

    if (customResolver) {
      currentState = customResolver(link, currentState);
    }
  }

  // After chain finishes resolving, official Konami timing chart dictates moving to Box B
  return {
    ...timingState,
    currentBox: 'BOX_B',
    priorityPlayer: currentState.turnPlayer,
    consecutivePasses: 0,
    chain: [],
    gameState: currentState
  };
}
