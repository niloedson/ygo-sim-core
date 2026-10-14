/**
 * @file mcp-contracts.ts
 * @description Immutable JSON-RPC Schemas and TypeScript contracts for the 4 core ygo-sim-core MCP Tools.
 */

import { YBNString } from './state.js';
import { InterruptionLayer } from './card-dsl.js';

// ============================================================================
// Tool 1: simulate_test_hands
// ============================================================================

export interface EvaluatedComboLine {
  line_signature: string; // e.g. "LINE#001:a3f9"
  hand_index: number;
  opening_hand: string[];
  branch_type: 'PRIMARY_CEILING' | 'PROBING_AND_BAIT' | 'COMPROMISED_FALLBACK' | 'BRICK';
  depth_reached: number;
  ybn_score: number;
  terminal_ybn: YBNString;
  ygn_path: string; // RFC 0001 YGN Action Transcript
  interruption_breakdown: {
    field_negates: number;
    backrow_disruptions: number;
    gy_triggers: number;
    hand_traps: number;
    distinct_layers: number;
  };
  early_insulation_secured: boolean;
}

export interface SimulateTestHandsParams {
  deck_ydk: string; // Raw .ydk deck file string
  sample_size?: number | undefined; // Default 100, Max 10000
  hand_size?: (5 | 6) | undefined; // Default 5 (Turn 1 / Turn 0 window)
  target_archetype?: string | undefined; // Optional archetype filter
  archetype_json?: string | Record<string, unknown> | undefined; // Optional dynamic ArchetypeDAG definition
  trace_lines?: boolean | undefined; // Enable deep combo tree line tracing
  trace_limit?: number | undefined; // Maximum hands to evaluate in full depth (default 5-20)
  max_depth?: number | undefined; // Search depth per line (default 40)
}

export interface SimulateTestHandsResult {
  total_simulations: number;
  uninterrupted_combo_rate: number;
  brick_rate: number;
  average_ybn_score: number;
  interruption_distribution: {
    '0_disruptions': number;
    '1_to_2_disruptions': number;
    '3_to_4_disruptions': number;
    '5_plus_disruptions': number;
  };
  average_multi_layer_score: number;
  detected_infinite_loops: number;
  evaluated_lines?: EvaluatedComboLine[] | undefined;
  log_file_path?: string | undefined;
}

// ============================================================================
// Tool 2: explore_combo_tree
// ============================================================================

export interface ExploreComboTreeParams {
  hand: string[]; // 5-6 Card Names or Passcodes
  deck_ydk: string; // Remaining deck context
  max_depth?: number | undefined; // Traversal search depth (default 8, max 15)
  branch_limit?: number | undefined; // Top N distinct terminal paths (default 3, max 10)
}

export interface ComboLineCandidate {
  rank: number;
  branch_type: 'PRIMARY_CEILING' | 'PROBING_AND_BAIT' | 'COMPROMISED_FALLBACK';
  ybn_score: number;
  early_insulation_secured: boolean;
  terminal_ybn: YBNString;
  ygn_path: string; // RFC 0001 YGN Action Transcript
  interruption_breakdown: {
    field_negates: number;
    backrow_disruptions: number;
    gy_triggers: number;
    hand_traps: number;
    distinct_layers: number;
  };
  resources_remaining: {
    hand_count: number;
    normal_summon_used: boolean;
    gy_count: number;
    deck_count: number;
  };
}

export interface ExploreComboTreeResult {
  hand_analyzed: string[];
  nodes_evaluated: number;
  unique_ybn_endpoints: number;
  top_lines: ComboLineCandidate[];
  markdown_report_path?: string | undefined;
  log_file_path?: string | undefined;
}

// ============================================================================
// Tool 3: evaluate_handtrap_resilience
// ============================================================================

export interface EvaluateHandtrapResilienceParams {
  hand: string[];
  deck_ydk: string;
  threat_suite?: string[] | undefined; // e.g. ["Ash Blossom", "Infinite Impermanence", "Nibiru"]
}

export interface HandtrapResilienceResultItem {
  threat: string;
  step_injected: number;
  protected_by_insulation: boolean;
  insulation_card_used?: string | undefined;
  fallback_ybn_score: number;
  survival_ratio: number; // V(YBN_fallback) / V(YBN_ceiling)
  compromised_endpoint?: YBNString | undefined;
  chokepoint_severity: 'Low' | 'Med' | 'High' | 'Fatal';
}

export interface EvaluateHandtrapResilienceResult {
  ceiling_ybn_score: number;
  resilience_matrix: HandtrapResilienceResultItem[];
  composite_resilience_rating: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

// ============================================================================
// Tool 4: score_ybn_state
// ============================================================================

export interface ScoreYbnStateParams {
  ybn: YBNString; // Valid RFC 0001 YBN snapshot string
}

export interface ScoreYbnStateResult {
  total_score: number;
  breakdown: {
    base_interruptions: {
      omni_negates: number;
      monster_negates: number;
      spell_trap_negates: number;
      quick_removals: number;
      backrow_negates: number;
      subtotal: number;
    };
    layer_diversification: {
      active_layers: InterruptionLayer[];
      bonus_applied: number;
    };
    followup_recursion: {
      hand_count: number;
      normal_summon_preserved: boolean;
      recyclable_gy_loopers: number;
      subtotal: number;
    };
    blowout_vulnerabilities: {
      dark_ruler_vulnerable: boolean;
      evenly_matched_vulnerable: boolean;
      super_poly_vulnerable?: boolean;
      penalties_applied: number;
    };
  };
}
