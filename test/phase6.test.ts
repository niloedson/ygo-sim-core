import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadArchetype,
  createInitialGameState,
  scoreGameState,
  scoreYBN
} from '../src/index.js';
import { extractActiveInterruptions } from '../src/evaluator/boardScorer.js';

describe('Phase 6: Master Multi-Layer V(YBN) Valuation Engine', () => {
  const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

  beforeEach(() => {
    globalCardRegistry.clear();
    loadArchetype(archetypePath);
  });

  describe('6.1 Multi-Layer Zone Diversification Bonus', () => {
    it('mathematically rewards multi-layer end-boards over single-layer boards (Acceptance Criterion)', () => {
      // Board A: Pure Monster Zone board (Baronne de Fleur on Field only)
      const boardA = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#b1',
              passcode: '84815190',
              name: 'Baronne de Fleur',
              cardType: 'MONSTER'
            }
          }
        }
      });

      // Board B: Multi-Layer board (Genius on Field + Set Called by the Grave in Backrow + GY trigger)
      const boardB = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#g1',
              passcode: '58858807',
              name: 'Qliphort Genius',
              cardType: 'MONSTER'
            }
          },
          spells: {
            S1: {
              instanceId: '#c1',
              passcode: '24224830',
              name: 'Called by the Grave',
              cardType: 'SPELL',
              spellTrapState: 'set'
            }
          },
          hand: [
            {
              instanceId: '#a1',
              passcode: '14558127',
              name: 'Ash Blossom & Joyous Spring',
              cardType: 'MONSTER'
            }
          ]
        }
      });

      const scoreA = scoreGameState(boardA);
      const scoreB = scoreGameState(boardB);

      expect(scoreA.breakdown.layer_diversification.active_layers).toEqual(['FIELD']);
      expect(scoreA.breakdown.layer_diversification.bonus_applied).toBe(0.0);

      // Board B holds interaction across 3 distinct zones (FIELD, BACKROW, HAND) -> +3.0 Bonus!
      expect(scoreB.breakdown.layer_diversification.active_layers.length).toBe(3);
      expect(scoreB.breakdown.layer_diversification.bonus_applied).toBe(3.0);
    });
  });

  describe('6.2 Anti-Board Breaker Blowout Penalties', () => {
    it('penalizes pure monster boards with Dark Ruler No More penalty (-2.5) (Acceptance Criterion)', () => {
      // Pure Monster board (Qliphort Genius + River Stormer on Field)
      const pureMonsterState = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#g1',
              passcode: '58858807',
              name: 'Qliphort Genius',
              cardType: 'MONSTER'
            },
            M2: {
              instanceId: '#r1',
              passcode: '25377819',
              name: 'Infinitrack River Stormer',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const score = scoreGameState(pureMonsterState);

      expect(score.breakdown.blowout_vulnerabilities.dark_ruler_vulnerable).toBe(true);
      expect(score.breakdown.blowout_vulnerabilities.penalties_applied).toBeGreaterThanOrEqual(2.5);
    });

    it('waives Dark Ruler penalty when backrow or hand interaction is retained', () => {
      // Board with Field monster + Set Infinite Impermanence in Backrow
      const diversifiedState = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#g1',
              passcode: '58858807',
              name: 'Qliphort Genius',
              cardType: 'MONSTER'
            }
          },
          spells: {
            S1: {
              instanceId: '#imp',
              passcode: '10045474',
              name: 'Infinite Impermanence',
              cardType: 'TRAP',
              spellTrapState: 'set'
            }
          }
        }
      });

      const score = scoreGameState(diversifiedState);
      expect(score.breakdown.blowout_vulnerabilities.dark_ruler_vulnerable).toBe(false);
    });

    it('applies Evenly Matched penalty (-2.0) if board lacks omni-negates or spell/trap negates', () => {
      // Board with only monster negate and spot removal (no omni or S/T negate)
      const noOmniState = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#g1',
              passcode: '58858807',
              name: 'Qliphort Genius',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const score = scoreGameState(noOmniState);
      expect(score.breakdown.blowout_vulnerabilities.evenly_matched_vulnerable).toBe(true);
    });
  });

  describe('6.3 Conceded Draws Penalty & Turn 3 Recursion', () => {
    it('heavily penalizes greedy special summon lines under lingering Fuwalos draw lock', () => {
      const stateUnderFuwalos = createInitialGameState({
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 6, // 4 excess summons beyond 2
          attacksDeclared: 0
        },
        locks: {
          lockedIntoFire: false,
          lockedIntoXyz: false,
          lockedIntoLink: false,
          lockedIntoMachine: false,
          cannotSpecialSummonFromExtra: false,
          opponentDrawsOnSpecialSummon: true // Active Fuwalos lock!
        },
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#b1',
              passcode: '84815190',
              name: 'Baronne de Fleur',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const score = scoreGameState(stateUnderFuwalos);

      // (6 - 2) * 3.5 = 14.0 points penalty!
      // This wipes out the base points and floors score
      expect(score.total_score).toBeLessThan(5.0);
    });

    it('rewards boards with high hand counts and recyclable GY starters', () => {
      const highResourceState = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          hand: [
            { instanceId: '#h1', passcode: '11111111', name: 'Hand Card 1', cardType: 'MONSTER' },
            { instanceId: '#h2', passcode: '22222222', name: 'Hand Card 2', cardType: 'MONSTER' },
            { instanceId: '#h3', passcode: '33333333', name: 'Hand Card 3', cardType: 'MONSTER' }
          ],
          graveyard: [
            {
              instanceId: '#gy1',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            }
          ]
        }
      });

      const score = scoreGameState(highResourceState);

      // Hand: 3 * 0.8 = 2.4, Harvester in GY = 1.5, Normal Summon preserved = 1.0 -> 4.9 subtotal
      expect(score.breakdown.followup_recursion.subtotal).toBeCloseTo(4.9);
    });

    it('enforces CONTROL_NO_CARDS on Mulcharmy Fuwalos: dead on established board, live on empty field', () => {
      loadArchetype(resolve(process.cwd(), 'data/archetypes/staples_hand_traps.json'));

      // 1. Established board with monsters/spells -> Fuwalos must be dead (0.0)
      const establishedBoard = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M3: {
              instanceId: '#m1',
              passcode: '6821579',
              name: 'R.B. VALCan Booster',
              cardType: 'MONSTER'
            }
          },
          spells: {
            S2: {
              instanceId: '#s1',
              passcode: '79859067',
              name: 'R.B. Next Phase',
              cardType: 'TRAP',
              isSet: true
            }
          },
          hand: [
            {
              instanceId: '#h1',
              passcode: '42141493',
              name: 'Mulcharmy Fuwalos',
              cardType: 'MONSTER'
            }
          ]
        }
      });

      const intersEstablished = extractActiveInterruptions(establishedBoard);
      const fuwalosInEstablished = intersEstablished.find(
        (i) => i.sourceCard.name.includes('Fuwalos')
      );
      expect(fuwalosInEstablished).toBeUndefined();

      // 2. Empty board -> Fuwalos is live (2.0)
      const emptyBoard = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          hand: [
            {
              instanceId: '#h1',
              passcode: '42141493',
              name: 'Mulcharmy Fuwalos',
              cardType: 'MONSTER'
            }
          ]
        }
      });

      const intersEmpty = extractActiveInterruptions(emptyBoard);
      const fuwalosInEmpty = intersEmpty.find(
        (i) => i.sourceCard.name.includes('Fuwalos')
      );
      expect(fuwalosInEmpty).toBeDefined();
      expect(fuwalosInEmpty?.baseQuality).toBe(2.0);
    });
  });

  describe('6.4 Standalone RFC 0001 YBN String Scoring', () => {
    it('scores an arbitrary YBN string directly and decomposes metrics accurately', () => {
      const ybn =
        'T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],S2[#5:Called by the Grave(set)],H:2,D:34,ED:13|P2:M3[Token(def)],H:5|G:NS=1';

      const result = scoreYBN(ybn);

      expect(result.total_score).toBeGreaterThan(0);
      expect(result.breakdown.layer_diversification.active_layers).toContain('FIELD');
      expect(result.breakdown.layer_diversification.active_layers).toContain('BACKROW');
      expect(result.breakdown.layer_diversification.bonus_applied).toBe(1.5);
    });
  });
});
