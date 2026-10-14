import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  advancePhase,
  advanceTurn,
  getLegalNextPhases,
  initOpenGameState,
  triggerNonChainAction,
  passPriority,
  addChainLink,
  resolveChain,
  buildSegocChain,
  isChainBlocked,
  canDirectlyRespondToLink,
  PendingTrigger,
  evaluateConjunction,
  willMissTiming
} from '../src/index.js';

describe('Phase 2: Fast Effect State Machine & Priority Sequencer', () => {
  describe('2.1 Phase Progression & Turn Advances', () => {
    it('enforces Turn 1 battle phase prohibition (DP -> SP -> M1 -> EP)', () => {
      let state = createInitialGameState({ turn: 1, phase: 'DP' });

      expect(getLegalNextPhases(state)).toEqual(['SP']);
      state = advancePhase(state, 'SP');
      expect(state.phase).toBe('SP');

      expect(getLegalNextPhases(state)).toEqual(['M1']);
      state = advancePhase(state, 'M1');
      expect(state.phase).toBe('M1');

      // On Turn 1, cannot conduct BP: legal transition must only be EP
      expect(getLegalNextPhases(state)).toEqual(['EP']);
      expect(() => advancePhase(state, 'BP')).toThrow(/Illegal phase transition/);

      state = advancePhase(state, 'EP');
      expect(state.phase).toBe('EP');
    });

    it('allows Battle Phase and Main Phase 2 on Turn 2+', () => {
      let state = createInitialGameState({ turn: 2, phase: 'M1' });

      expect(getLegalNextPhases(state)).toContain('BP');
      expect(getLegalNextPhases(state)).toContain('EP');

      state = advancePhase(state, 'BP');
      expect(state.phase).toBe('BP');

      expect(getLegalNextPhases(state)).toContain('M2');
      state = advancePhase(state, 'M2');
      expect(state.phase).toBe('M2');

      state = advancePhase(state, 'EP');
      expect(state.phase).toBe('EP');
    });

    it('resets operational gates and HOPT registries when advancing to next turn', () => {
      const state = createInitialGameState({
        turn: 1,
        phase: 'EP',
        turnPlayer: 1,
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 7,
          attacksDeclared: 2
        },
        registers: {
          hoptActivated: new Set(['HOPT_HARVESTER_SEARCH', 'HOPT_ASH_BLOSSOM']),
          soptActivated: new Set(['#e1']),
          cardsSentToGYThisTurn: new Set(['#1', '#2'])
        },
        locks: {
          lockedIntoFire: true,
          lockedIntoXyz: true,
          lockedIntoLink: false,
          lockedIntoMachine: false,
          cannotSpecialSummonFromExtra: true,
          opponentDrawsOnSpecialSummon: true
        }
      });

      const nextTurnState = advanceTurn(state);

      expect(nextTurnState.turn).toBe(2);
      expect(nextTurnState.phase).toBe('DP');
      expect(nextTurnState.turnPlayer).toBe(2);
      expect(nextTurnState.priorityHolder).toBe(2);

      // Gates reset
      expect(nextTurnState.gates.normalSummonAvailable).toBe(true);
      expect(nextTurnState.gates.specialSummonCount).toBe(0);
      expect(nextTurnState.gates.attacksDeclared).toBe(0);

      // Registries cleared
      expect(nextTurnState.registers.hoptActivated.size).toBe(0);
      expect(nextTurnState.registers.soptActivated.size).toBe(0);
      expect(nextTurnState.registers.cardsSentToGYThisTurn.size).toBe(0);

      // Locks expired
      expect(nextTurnState.locks.lockedIntoFire).toBe(false);
      expect(nextTurnState.locks.lockedIntoXyz).toBe(false);
      expect(nextTurnState.locks.cannotSpecialSummonFromExtra).toBe(false);
      expect(nextTurnState.locks.opponentDrawsOnSpecialSummon).toBe(false);
    });
  });

  describe('2.2 Fast Effect Timing Chart (Boxes A through E)', () => {
    it('models Box A -> Box B -> Box C -> Box A cycle when non-chain action occurs and players pass', () => {
      const state = createInitialGameState({ turnPlayer: 1 });
      let timing = initOpenGameState(state);

      expect(timing.currentBox).toBe('BOX_A');
      expect(timing.priorityPlayer).toBe(1);

      // Turn player conducts Normal Summon (non-chain action) -> Box B
      timing = triggerNonChainAction(timing, 'Normal Summon Harvester');
      expect(timing.currentBox).toBe('BOX_B');
      expect(timing.priorityPlayer).toBe(1);

      // Turn player passes in Box B -> Box C (Opponent Fast Effect Window)
      timing = passPriority(timing);
      expect(timing.currentBox).toBe('BOX_C');
      expect(timing.priorityPlayer).toBe(2);

      // Opponent passes in Box C -> Both passed, returns to Box A
      timing = passPriority(timing);
      expect(timing.currentBox).toBe('BOX_A');
      expect(timing.priorityPlayer).toBe(1);
    });

    it('enforces Spell Speed hierarchy and alternating priority during chain building (Box D)', () => {
      const state = createInitialGameState({ turnPlayer: 1 });
      let timing = initOpenGameState(state);

      // CL1: Turn Player activates Normal Spell (SS1) in Box A
      timing = addChainLink(timing, {
        player: 1,
        cardName: 'Exceptional Schedule',
        effectId: 'exceptional_activation',
        spellSpeed: 1
      });

      expect(timing.currentBox).toBe('BOX_D');
      expect(timing.chain.length).toBe(1);
      expect(timing.priorityPlayer).toBe(2); // Alternates to opponent

      // CL2: Opponent chains Ash Blossom (SS2)
      timing = addChainLink(timing, {
        player: 2,
        cardName: 'Ash Blossom & Joyous Spring',
        effectId: 'ash_negate',
        spellSpeed: 2
      });

      expect(timing.chain.length).toBe(2);
      expect(timing.priorityPlayer).toBe(1); // Alternates back to turn player

      // CL3 attempt: Turn player cannot respond to SS2 with an SS1 effect!
      expect(() =>
        addChainLink(timing, {
          player: 1,
          cardName: 'Ignition Monster',
          effectId: 'ignition_effect',
          spellSpeed: 1
        })
      ).toThrow(/Cannot respond with Spell Speed 1 to Spell Speed 2/);

      // CL3: Turn player chains Quick-Play Called by the Grave (SS2)
      timing = addChainLink(timing, {
        player: 1,
        cardName: 'Called by the Grave',
        effectId: 'called_activation',
        spellSpeed: 2
      });
      expect(timing.chain.length).toBe(3);
      expect(timing.priorityPlayer).toBe(2);

      // CL4: Opponent chains Counter Trap Solemn Judgment (SS3)
      timing = addChainLink(timing, {
        player: 2,
        cardName: 'Solemn Judgment',
        effectId: 'solemn_activation',
        spellSpeed: 3
      });
      expect(timing.chain.length).toBe(4);
      expect(timing.priorityPlayer).toBe(1);

      // CL5 attempt: Turn player cannot respond to SS3 with SS2
      expect(() =>
        addChainLink(timing, {
          player: 1,
          cardName: 'Ghost Belle',
          effectId: 'ghost_belle',
          spellSpeed: 2
        })
      ).toThrow(/Only Spell Speed 3.*can respond to Spell Speed 3/);
    });

    it('resolves chain in strict LIFO order (Box E) and transitions to Box B', () => {
      const state = createInitialGameState({ turnPlayer: 1 });
      let timing = initOpenGameState(state);

      // Build 2-link chain
      timing = addChainLink(timing, {
        player: 1,
        cardName: 'Emergency Teleport',
        effectId: 'e_tele',
        spellSpeed: 2
      });
      timing = addChainLink(timing, {
        player: 2,
        cardName: 'Ash Blossom',
        effectId: 'ash_negate',
        spellSpeed: 2
      });

      // Both players pass priority -> Box E
      timing = passPriority(timing); // P1 passes
      timing = passPriority(timing); // P2 passes
      expect(timing.currentBox).toBe('BOX_E');

      const resolvedOrder: string[] = [];
      const timingAfterResolve = resolveChain(timing, (link, currentState) => {
        resolvedOrder.push(link.cardName);
        return currentState;
      });

      // LIFO: CL2 (Ash Blossom) resolves before CL1 (Emergency Teleport)
      expect(resolvedOrder).toEqual(['Ash Blossom', 'Emergency Teleport']);

      // Transitions to Box B per official Konami timing chart
      expect(timingAfterResolve.currentBox).toBe('BOX_B');
      expect(timingAfterResolve.chain.length).toBe(0);
      expect(timingAfterResolve.priorityPlayer).toBe(1);
    });
  });

  describe('2.3 SEGOC Hierarchy & Chain Blocking', () => {
    it('orders simultaneous triggers across all 4 SEGOC tiers', () => {
      const triggers: PendingTrigger[] = [
        { id: 'p2_opt', cardName: 'P2 Optional', player: 2, isMandatory: false },
        {
          id: 'p1_opt_search',
          cardName: 'P1 Harvester (Search)',
          player: 1,
          isMandatory: false,
          priorityScore: 10
        },
        { id: 'p2_mand', cardName: 'P2 Mandatory', player: 2, isMandatory: true },
        {
          id: 'p1_opt_extender',
          cardName: 'P1 Extender',
          player: 1,
          isMandatory: false,
          priorityScore: 5
        },
        { id: 'p1_mand', cardName: 'P1 Mandatory', player: 1, isMandatory: true }
      ];

      const chain = buildSegocChain(triggers, 1);

      // Hierarchy:
      // CL1: Tier 1 (P1 Mandatory)
      // CL2: Tier 2 (P2 Mandatory)
      // CL3: Tier 3 (P1 Optional - higher priority Harvester placed first)
      // CL4: Tier 3 (P1 Optional - Extender placed second)
      // CL5: Tier 4 (P2 Optional)
      expect(chain.map((c) => c.cardName)).toEqual([
        'P1 Mandatory',
        'P2 Mandatory',
        'P1 Harvester (Search)',
        'P1 Extender',
        'P2 Optional'
      ]);
    });

    it('verifies that CL2 chain-blocks CL1 from opponent direct fast effect responses', () => {
      const triggers: PendingTrigger[] = [
        {
          id: 'harvester',
          cardName: 'Infinitrack Harvester',
          player: 1,
          isMandatory: false,
          priorityScore: 10
        },
        {
          id: 'blue_traveler',
          cardName: 'Night Train Blue Traveler',
          player: 1,
          isMandatory: false,
          priorityScore: 1
        }
      ];

      // Turn player orders CL1: Harvester (high priority search), CL2: Blue Traveler (secondary trigger)
      const chain = buildSegocChain(triggers, 1);

      expect(chain[0]?.cardName).toBe('Infinitrack Harvester');
      expect(chain[1]?.cardName).toBe('Night Train Blue Traveler');

      // Harvester (CL1) is chain-blocked!
      expect(isChainBlocked(chain, 1)).toBe(true);
      expect(canDirectlyRespondToLink(chain, 1)).toBe(false);

      // Blue Traveler (CL2) is NOT chain-blocked (it is the current chain tip)
      expect(isChainBlocked(chain, 2)).toBe(false);
      expect(canDirectlyRespondToLink(chain, 2)).toBe(true);
    });
  });

  describe('2.4 Conjunction Resolution & Missing Timing', () => {
    it('verifies that "then" conjunction causes optional "When... you can" triggers to miss timing', () => {
      // Event A (e.g. destroy monster) then Event B (e.g. inflict damage)
      const result = evaluateConjunction('THEN', true, true);

      expect(result.eventASucceeded).toBe(true);
      expect(result.eventBSucceeded).toBe(true);
      expect(result.lastEventsToOccur).toEqual(['EVENT_B']); // Event B was the only last event!

      // An optional "When... you can" trigger relying on Event A MISSES TIMING!
      const missed = willMissTiming(result, 'WHEN_OPTIONAL', 'EVENT_A');
      expect(missed).toBe(true);

      // However, a modern "If... you can" trigger NEVER misses timing
      const ifMissed = willMissTiming(result, 'IF_OPTIONAL', 'EVENT_A');
      expect(ifMissed).toBe(false);

      // And a mandatory "When..." trigger NEVER misses timing
      const mandMissed = willMissTiming(result, 'WHEN_MANDATORY', 'EVENT_A');
      expect(mandMissed).toBe(false);
    });

    it('verifies that under "then", if Event B fails, Event A remains the last event (no miss timing)', () => {
      const result = evaluateConjunction('THEN', true, false);

      expect(result.lastEventsToOccur).toEqual(['EVENT_A']);

      // Because Event B did not happen, Event A IS the last event -> does NOT miss timing!
      const missed = willMissTiming(result, 'WHEN_OPTIONAL', 'EVENT_A');
      expect(missed).toBe(false);
    });

    it('verifies that "and if you do", "also", and "and" treat both events as simultaneous (never miss timing)', () => {
      for (const conj of ['AND_IF_YOU_DO', 'ALSO', 'AND'] as const) {
        const result = evaluateConjunction(conj, true, true);

        expect(result.lastEventsToOccur).toContain('EVENT_A');
        expect(result.lastEventsToOccur).toContain('EVENT_B');

        // Neither Event A nor Event B causes "When... you can" to miss timing!
        expect(willMissTiming(result, 'WHEN_OPTIONAL', 'EVENT_A')).toBe(false);
        expect(willMissTiming(result, 'WHEN_OPTIONAL', 'EVENT_B')).toBe(false);
      }
    });
  });
});
