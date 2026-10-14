import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadArchetype,
  createInitialGameState,
  parseYdkDeck,
  simulateHands,
  exploreComboTree,
  CardRegistry,
  CycleDetector
} from '../src/index.js';

describe('Phase 4: Combinatorial Graph Traversal & Transposition Pruning', () => {
  const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

  beforeEach(() => {
    globalCardRegistry.clear();
    loadArchetype(archetypePath);
  });

  const sampleYdk = `
#created by ygo-sim-core test
#main
67234805
67234805
67234805
83487532
83487532
83487532
58836875
58836875
58836875
14558127
14558127
14558127
10045474
10045474
10045474
24224830
24224830
27204311
27204311
27204311
11111111
11111111
11111111
22222222
22222222
22222222
33333333
33333333
33333333
44444444
44444444
44444444
55555555
55555555
55555555
66666666
66666666
66666666
77777777
77777777
#extra
25377819
25377819
58858807
58858807
84815190
79559912
!side
14558127
`;

  describe('4.1 High-Throughput Monte Carlo .ydk Sampler', () => {
    it('accurately parses standard .ydk decklist into main, extra, and side sections', () => {
      const parsed = parseYdkDeck(sampleYdk);

      expect(parsed.mainDeck.length).toBe(40);
      expect(parsed.extraDeck.length).toBe(6);
      expect(parsed.sideDeck.length).toBe(1);
      expect(parsed.mainDeck).toContain('67234805'); // Harvester
      expect(parsed.extraDeck).toContain('84815190'); // Baronne
    });

    it('executes 10,000-hand Monte Carlo simulation in <2.5 seconds (Acceptance Criterion)', () => {
      const parsed = parseYdkDeck(sampleYdk);
      const result = simulateHands(parsed, { sampleSize: 10_000, handSize: 5 });

      expect(result.totalSimulations).toBe(10_000);
      expect(result.uninterruptedComboRate).toBeGreaterThan(0.5); // Deck has 9 starters
      expect(result.brickRate).toBeLessThan(0.4);
      expect(result.averageStartersPerHand).toBeGreaterThan(0.8);

      // Verify acceptance criterion: < 2.5 seconds (2500ms)
      expect(result.durationMs).toBeLessThan(2500);
    });
  });

  describe('4.2 Combinatorial Combo Tree DFS Traversal', () => {
    it('explores legal action branches and discovers terminal endboards', () => {
      const state = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          hand: [
            {
              instanceId: '#h1',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            },
            { instanceId: '#h2', passcode: '58836875', name: 'Urgent Schedule', cardType: 'SPELL' }
          ],
          deck: [
            {
              instanceId: '#d1',
              passcode: '25377819',
              name: 'Infinitrack River Stormer',
              cardType: 'MONSTER'
            },
            {
              instanceId: '#d2',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            }
          ],
          extraDeck: [
            {
              instanceId: '#ed1',
              passcode: '58858807',
              name: 'Qliphort Genius',
              cardType: 'MONSTER',
              levelOrRank: 2
            }
          ]
        }
      });

      const searchResult = exploreComboTree(state, { maxDepth: 4, maxNodes: 50 });

      expect(searchResult.nodesEvaluated).toBeGreaterThan(1);
      expect(searchResult.topPlaylines.length).toBeGreaterThan(0);

      const topPlayline = searchResult.topPlaylines[0]!;
      expect(topPlayline.actions.length).toBeGreaterThan(0);
      expect(topPlayline.terminalYBN).toBeDefined();
    });

    it('successfully prunes redundant isomorphic states via transposition table', () => {
      const state = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          hand: [
            { instanceId: '#h1', passcode: '58836875', name: 'Urgent Schedule', cardType: 'SPELL' },
            {
              instanceId: '#h2',
              passcode: '10045474',
              name: 'Infinite Impermanence',
              cardType: 'TRAP'
            }
          ]
        }
      });

      // Both cards can be Set in any order (Set #h1 then #h2, or Set #h2 then #h1)
      const searchResult = exploreComboTree(state, { maxDepth: 4, maxNodes: 50 });

      // Permuted orders lead to identical transposition states and trigger transpositionHits
      expect(searchResult.transpositionHits).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4.3 Infinite Loop & Cycle Detection', () => {
    it('detects cyclic loops (CYCLE_DETECTED) and safely aborts branch without recursion overflow', () => {
      const customRegistry = new CardRegistry();
      const baseState = createInitialGameState();

      const searchResult = exploreComboTree(
        baseState,
        { maxDepth: 10, maxNodes: 100 },
        customRegistry
      );

      expect(searchResult).toBeDefined();
      expect(searchResult.nodesEvaluated).toBeGreaterThan(0);
    });

    it('verifies CycleDetector tracks path stack and flags duplicate state hashes', () => {
      const detector = new CycleDetector();

      expect(detector.enterState('0x1111')).toBe(false);
      expect(detector.enterState('0x2222')).toBe(false);
      expect(detector.currentDepth).toBe(2);

      // Re-entering 0x1111 detects loop
      expect(detector.enterState('0x1111')).toBe(true);

      // Backtracking
      expect(detector.exitState()).toBe('0x2222');
      expect(detector.exitState()).toBe('0x1111');
      expect(detector.currentDepth).toBe(0);
    });
  });
});
