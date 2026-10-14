import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadArchetype,
  createServer,
  handleSimulateTestHands,
  handleExploreComboTree,
  handleEvaluateHandtrapResilience,
  handleScoreYbnState
} from '../src/index.js';

describe('Phase 7: Headless CLI & MCP Server Packaging', () => {
  const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

  const sampleYdk = `
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

  beforeEach(() => {
    globalCardRegistry.clear();
    loadArchetype(archetypePath);
  });

  describe('7.1 MCP Server Factory & Tool Registration', () => {
    it('initializes stdio MCP server without errors and configures tools capability', () => {
      const server = createServer();
      expect(server).toBeDefined();
    });
  });

  describe('7.2 Core MCP Tool Handlers', () => {
    it('executes simulate_test_hands (Tool 1)', () => {
      const result = handleSimulateTestHands({
        deck_ydk: sampleYdk,
        sample_size: 1000,
        hand_size: 5
      });

      expect(result.total_simulations).toBe(1000);
      expect(result.uninterrupted_combo_rate).toBeGreaterThan(0.5);
      expect(result.average_ybn_score).toBeGreaterThan(0);
      expect(result.interruption_distribution['0_disruptions']).toBeDefined();
    });

    it('executes explore_combo_tree in <100ms (Acceptance Criterion) (Tool 2)', () => {
      const startTime = performance.now();

      const result = handleExploreComboTree({
        hand: ['Infinitrack Harvester', 'Urgent Schedule', 'Called by the Grave'],
        deck_ydk: sampleYdk,
        max_depth: 6,
        branch_limit: 3
      });

      const durationMs = performance.now() - startTime;

      expect(result.hand_analyzed.length).toBe(3);
      expect(result.nodes_evaluated).toBeGreaterThan(0);
      expect(result.top_lines.length).toBeGreaterThan(0);

      // Verify response time acceptance criterion: < 100ms
      expect(durationMs).toBeLessThan(100);
    });

    it('executes evaluate_handtrap_resilience (Tool 3)', () => {
      const result = handleEvaluateHandtrapResilience({
        hand: ['Infinitrack Harvester', 'Called by the Grave'],
        deck_ydk: sampleYdk,
        threat_suite: ['Ash Blossom & Joyous Spring', 'Nibiru, the Primal Being']
      });

      expect(result.ceiling_ybn_score).toBeGreaterThan(0);
      expect(result.resilience_matrix.length).toBe(2);
      expect(result.composite_resilience_rating).toMatch(/^[SABCDF]$/);

      // Called by the Grave should protect against Ash Blossom
      const ashResult = result.resilience_matrix.find((r) => r.threat.includes('Ash Blossom'));
      expect(ashResult?.protected_by_insulation).toBe(true);
    });

    it('executes score_ybn_state (Tool 4)', () => {
      const ybn =
        'T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],S2[#5:Called by the Grave(set)],H:2,D:34,ED:13|P2:M3[Token(def)],H:5|G:NS=1';

      const result = handleScoreYbnState({ ybn });

      expect(result.total_score).toBeGreaterThan(0);
      expect(result.breakdown.layer_diversification.active_layers).toContain('FIELD');
      expect(result.breakdown.layer_diversification.active_layers).toContain('BACKROW');
    });
  });
});
