import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadArchetype,
  createInitialGameState,
  auditInsulation,
  evaluateHandtrapResilience,
  applyNibiruWipe,
  Playline
} from '../src/index.js';

describe('Phase 5: Adversarial Hand Trap Injection & Early Insulation Evaluator', () => {
  const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

  beforeEach(() => {
    globalCardRegistry.clear();
    loadArchetype(archetypePath);
  });

  describe('5.1 Early Insulation & Nibiru Protection Auditor', () => {
    it('secures Nibiru protection when Baronne de Fleur is summoned at Summon <= 4', () => {
      const state = createInitialGameState({
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 3, // Total summons = 1 (NS) + 3 (SS) = 4 <= 4
          attacksDeclared: 0
        },
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#bar1',
              passcode: '84815190',
              name: 'Baronne de Fleur',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const audit = auditInsulation(state);

      expect(audit.nibiruSecured).toBe(true);
      expect(audit.nibiruSecuredAtSummon).toBe(4);
      expect(audit.insulationBossName).toBe('Baronne de Fleur');
      expect(audit.activeOmniNegates).toBe(1);
      expect(audit.safetyBonus).toBeGreaterThanOrEqual(2.5);
    });

    it('fails Nibiru protection if no omni/summon negate is present at Summon 5+', () => {
      const state = createInitialGameState({
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 4, // Total summons = 1 (NS) + 4 (SS) = 5
          attacksDeclared: 0
        },
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#harv',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const audit = auditInsulation(state);
      expect(audit.nibiruSecured).toBe(false);
      expect(audit.activeOmniNegates).toBe(0);
    });

    it('identifies pre-Normal Summon baiting when Normal Summon is preserved', () => {
      const state = createInitialGameState({
        gates: {
          normalSummonAvailable: true,
          specialSummonCount: 2,
          attacksDeclared: 0
        }
      });

      const audit = auditInsulation(state);
      expect(audit.normalSummonPreservedAsBait).toBe(true);
    });
  });

  describe('5.2 Adversarial Hand Trap Injection & Resilience Matrix', () => {
    it('confirms 100% resilience against Ash Blossom when Called by the Grave is retained (Acceptance Criterion)', () => {
      const state = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          hand: [
            {
              instanceId: '#cbg',
              passcode: '24224830',
              name: 'Called by the Grave',
              cardType: 'SPELL'
            }
          ],
          monsters: {
            M1: {
              instanceId: '#m1',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            }
          }
        }
      });

      const mockPlayline: Playline = {
        actions: [],
        ygnTranscript: 'N[#m1]>M1',
        terminalState: state,
        terminalYBN: '',
        terminalHash: '0x123',
        depth: 2
      };

      const resilience = evaluateHandtrapResilience(mockPlayline, ['Ash Blossom & Joyous Spring']);
      const ashResult = resilience.resilienceMatrix[0]!;

      expect(ashResult.protectedByInsulation).toBe(true);
      expect(ashResult.insulationCardUsed).toBe('Called by the Grave');
      expect(ashResult.survivalRatio).toBe(1.0);
      expect(ashResult.chokepointSeverity).toBe('Low');
    });

    it('confirms lines summoning Baronne at Summon <= 4 survive Nibiru with 100% survival ratio (Acceptance Criterion)', () => {
      const state = createInitialGameState({
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 3, // Total summons = 4 <= 4
          attacksDeclared: 0
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

      const mockPlayline: Playline = {
        actions: [],
        ygnTranscript: 'S[#b1]>M1',
        terminalState: state,
        terminalYBN: '',
        terminalHash: '0x456',
        depth: 4
      };

      const resilience = evaluateHandtrapResilience(mockPlayline, ['Nibiru, the Primal Being']);
      const nibiruResult = resilience.resilienceMatrix[0]!;

      expect(nibiruResult.protectedByInsulation).toBe(true);
      expect(nibiruResult.survivalRatio).toBe(1.0);
      expect(nibiruResult.chokepointSeverity).toBe('Low');
    });

    it('executes Nibiru board wipe and penalizes survival ratio when uninsulated at Summon 5+', () => {
      const uninsulatedState = createInitialGameState({
        gates: {
          normalSummonAvailable: false,
          specialSummonCount: 4, // Total summons = 5
          attacksDeclared: 0
        },
        p1: {
          ...createInitialGameState().p1,
          monsters: {
            M1: {
              instanceId: '#m1',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER',
              atk: 0,
              def: 2100
            },
            M2: {
              instanceId: '#m2',
              passcode: '25377819',
              name: 'Infinitrack River Stormer',
              cardType: 'MONSTER',
              atk: 2500,
              def: 500
            }
          }
        }
      });

      const mockPlayline: Playline = {
        actions: [],
        ygnTranscript: 'Greedy 5-Summon Line',
        terminalState: uninsulatedState,
        terminalYBN: '',
        terminalHash: '0x789',
        depth: 5
      };

      const resilience = evaluateHandtrapResilience(mockPlayline, ['Nibiru, the Primal Being']);
      const nibiruResult = resilience.resilienceMatrix[0]!;

      expect(nibiruResult.protectedByInsulation).toBe(false);
      expect(nibiruResult.survivalRatio).toBeLessThan(1.0);
      expect(nibiruResult.chokepointSeverity).toBe('High');
      expect(nibiruResult.compromisedYBN).toBeDefined();

      // Check Nibiru wipe state mechanics directly
      const wipedState = applyNibiruWipe(uninsulatedState);
      expect(wipedState.p1.monsters.M1?.name).toBe('Primal Being Token');
      expect(wipedState.p2.monsters.M2?.name).toBe('Nibiru, the Primal Being');
      expect(wipedState.p1.graveyard.length).toBe(2);
    });
  });
});
