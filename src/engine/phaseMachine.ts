/**
 * @file phaseMachine.ts
 * @description Official Turn Phase Progression State Machine (DP -> SP -> M1 -> BP -> M2 -> EP).
 */

import { GameState, TurnPhase, cloneGameState } from '../types/state.js';
import { Logcat } from '../logging/logcat.js';

export const OFFICIAL_PHASE_ORDER: readonly TurnPhase[] = [
  'DP',
  'SP',
  'M1',
  'BP',
  'M2',
  'EP'
] as const;

/**
 * Determine the legal next phase transitions from the current phase and turn state.
 */
export function getLegalNextPhases(state: GameState): TurnPhase[] {
  switch (state.phase) {
    case 'DP':
      return ['SP'];
    case 'SP':
      return ['M1'];
    case 'M1':
      // Under official Konami rules, Turn 1 player cannot conduct Battle Phase (BP)
      if (state.turn === 1) {
        return ['EP'];
      }
      return ['BP', 'EP'];
    case 'BP':
      return ['M2', 'EP'];
    case 'M2':
      return ['EP'];
    case 'EP':
      return ['DP']; // Transitions to next turn Draw Phase
    default:
      return [];
  }
}

/**
 * Advance the game state to the next phase according to the Konami Turn Sequence.
 * If targetPhase is provided, validates that the transition is legal.
 */
export function advancePhase(
  state: GameState,
  targetPhase?: TurnPhase,
  lineSignature?: string
): GameState {
  const legalNext = getLegalNextPhases(state);
  if (legalNext.length === 0) {
    Logcat.e('SimCore:PhaseMachine', `Cannot advance from invalid phase: ${state.phase}`, undefined, lineSignature);
    throw new Error(`Cannot advance from invalid phase: ${state.phase}`);
  }

  const nextPhase = targetPhase ?? legalNext[0]!;
  if (!legalNext.includes(nextPhase)) {
    Logcat.e(
      'SimCore:PhaseMachine',
      `Illegal phase transition: ${state.phase} -> ${nextPhase} on Turn ${state.turn}`,
      undefined,
      lineSignature
    );
    throw new Error(
      `Illegal phase transition: cannot transition from ${state.phase} to ${nextPhase} on Turn ${state.turn}`
    );
  }

  Logcat.i(
    'SimCore:PhaseMachine',
    `Phase transition: ${state.phase} -> ${nextPhase} (Turn ${state.turn}, Player ${state.turnPlayer})`,
    lineSignature
  );

  // If advancing from EP to DP, advance turn counter, swap active player, and reset turn resources
  if (state.phase === 'EP' && nextPhase === 'DP') {
    return advanceTurn(state, lineSignature);
  }

  const nextState = cloneGameState(state);
  nextState.phase = nextPhase;
  nextState.priorityHolder = nextState.turnPlayer;
  nextState.stepIndex += 1;

  return nextState;
}

/**
 * Advance to the next turn: switches turn player, resets gates and HOPT registries.
 */
export function advanceTurn(state: GameState, lineSignature?: string): GameState {
  const nextState = cloneGameState(state);

  const prevTurn = nextState.turn;
  nextState.turn += 1;
  nextState.phase = 'DP';
  nextState.turnPlayer = nextState.turnPlayer === 1 ? 2 : 1;
  nextState.priorityHolder = nextState.turnPlayer;

  Logcat.i(
    'SimCore:PhaseMachine',
    `Turn advanced: Turn ${prevTurn} -> Turn ${nextState.turn} (Turn Player: P${nextState.turnPlayer})`,
    lineSignature
  );

  // Reset operational gates for new turn
  nextState.gates = {
    normalSummonAvailable: true,
    specialSummonCount: 0,
    attacksDeclared: 0
  };

  // Clear turn-scoped registries
  nextState.registers = {
    hoptActivated: new Set<string>(),
    soptActivated: new Set<string>(),
    cardsSentToGYThisTurn: new Set<string>()
  };

  // Reset lingering end-of-turn locks
  nextState.locks = {
    ...nextState.locks,
    lockedIntoFire: false,
    lockedIntoXyz: false,
    lockedIntoLink: false,
    lockedIntoMachine: false,
    cannotSpecialSummonFromExtra: false,
    opponentDrawsOnSpecialSummon: false
  };

  nextState.stepIndex += 1;
  return nextState;
}
