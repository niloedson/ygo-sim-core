import { describe, it, expect } from 'vitest';
import {
  parseFromYBN,
  serializeToYBN,
  computeStateHash,
  hashYBN,
  canonicalizeGameState
} from '../src/index.js';

describe('Phase 1: 14-Zone State Model & RFC 0001 YBN Serializer', () => {
  const exampleTurn1MachineYBN =
    'T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],GY:[#4:Harvester,#3:Blue Traveler,#1:Exceptional,#2:Urgent],H:3,D:35,ED:14|P2:M3[Token(def)],GY:[#o1:Purulia],H:4,D:35,ED:15|G:NS=1,LING(o.+H<D on S<H>)';

  const complexEndBoardYBN =
    'T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],M4[#e2:River Stormer(atk){#3,#4}],S2[#5:Purge(set)],GY:[#1:Exceptional,#2:Urgent],H:2,D:34,ED:13|P2:M3[Token(def)],H:5,D:35,ED:15|G:NS=0,SS=4';

  it('accurately parses Turn 1 Machine combo state from duel_log_example.txt', () => {
    const state = parseFromYBN(exampleTurn1MachineYBN);

    expect(state.turn).toBe(1);
    expect(state.phase).toBe('M1');
    expect(state.lifePoints.player1).toBe(8000);
    expect(state.lifePoints.player2).toBe(8000);

    // P1 verification
    expect(state.p1.extraMonsters.ER?.name).toBe('Genius');
    expect(state.p1.extraMonsters.ER?.position).toBe('atk');
    expect(state.p1.graveyard.length).toBe(4);
    expect(state.p1.graveyard.map((c) => c.name)).toEqual([
      'Harvester',
      'Blue Traveler',
      'Exceptional',
      'Urgent'
    ]);
    expect(state.p1.hand.length).toBe(3);
    expect(state.p1.deck.length).toBe(35);
    expect(state.p1.extraDeck.length).toBe(14);

    // P2 verification
    expect(state.p2.monsters.M3?.name).toBe('Token');
    expect(state.p2.monsters.M3?.position).toBe('def');
    expect(state.p2.graveyard[0]?.name).toBe('Purulia');
    expect(state.p2.hand.length).toBe(4);

    // Gates verification
    expect(state.gates.normalSummonAvailable).toBe(true);
    expect(state.locks.opponentDrawsOnSpecialSummon).toBe(true);
  });

  it('guarantees 100% round-trip fidelity on RFC 0001 YBN strings', () => {
    // Round-trip example 1: duel_log_example
    const state1 = parseFromYBN(exampleTurn1MachineYBN);
    const serialized1 = serializeToYBN(state1);
    expect(serialized1).toBe(exampleTurn1MachineYBN);

    // Verify direct YBN hashing
    const ybnHash = hashYBN(exampleTurn1MachineYBN);
    expect(ybnHash).toBeDefined();
    expect(ybnHash.length).toBe(16);

    // Round-trip example 2: complex Xyz endboard
    const state2 = parseFromYBN(complexEndBoardYBN);
    const serialized2 = serializeToYBN(state2);
    expect(serialized2).toBe(complexEndBoardYBN);
  });

  it('ensures permutation invariance in canonical state hashing', () => {
    const stateA = parseFromYBN(exampleTurn1MachineYBN);
    const stateB = parseFromYBN(exampleTurn1MachineYBN);

    // Permute GY order in stateB
    stateB.p1.graveyard = [
      stateA.p1.graveyard[3]!,
      stateA.p1.graveyard[0]!,
      stateA.p1.graveyard[2]!,
      stateA.p1.graveyard[1]!
    ];

    const hashA = computeStateHash(stateA);
    const hashB = computeStateHash(stateB);

    expect(hashA).toBe(hashB);
    expect(canonicalizeGameState(stateA)).toBe(canonicalizeGameState(stateB));
  });

  it('validates 0% hash collision rate across 100,000 synthetic state mutations', () => {
    const baseState = parseFromYBN(complexEndBoardYBN);
    const hashes = new Set<string>();
    const totalMutations = 100_000;

    for (let i = 0; i < totalMutations; i++) {
      // Synthetic mutations across turn, LP, SS count, and zone cards
      const mutated = {
        ...baseState,
        turn: 1 + (i % 10),
        lifePoints: {
          player1: 8000 - (i % 8000),
          player2: 8000 - Math.floor(i / 10)
        },
        gates: {
          ...baseState.gates,
          specialSummonCount: i % 20,
          attacksDeclared: i % 3
        },
        p1: {
          ...baseState.p1,
          deck: Array.from({ length: 30 - (i % 15) }, (_, idx) => ({
            instanceId: `#d${idx}`,
            passcode: `${10000000 + i}`,
            name: `Card ${idx}`,
            cardType: 'MONSTER' as const
          }))
        }
      };

      const h = computeStateHash(mutated);
      expect(hashes.has(h)).toBe(false);
      hashes.add(h);
    }

    expect(hashes.size).toBe(totalMutations);
  });
});
