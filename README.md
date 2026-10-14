# ygo-sim-core: High-Performance Deterministic Yu-Gi-Oh! Combo & Valuation Engine

**Document Standard:** RFC 0001 (Yu-Gi-Oh! Game Notation [YGN] & Board Notation [YBN])  
**Architectural Blueprint:** `SPEC-SIM-2026-001` (see [`BLUEPRINT.md`](BLUEPRINT.md))  
**Design Pattern:** "Stockfish" Pure Compute Engine to `obsidian-ygo-suite` ("Grandmaster" Reasoning Layer)  
**Execution Surface:** Standalone Headless CLI & stdio Model Context Protocol (MCP) Server  

---

## 1. Overview & Core Philosophy

`ygo-sim-core` is an autonomous, high-performance computational simulation engine for competitive Yu-Gi-Oh! TCG play. Grounded in tournament theory from World Champions Joshua Schmidt and Jesse Kotton, it evaluates opening hands, models official turn phases and Fast Effect timing, traverses combinatorial state trees, stress-tests playlines against opponent interruptions, and outputs mathematically scored end-boards.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        UPSTREAM STANDARDS BODY                         │
│                    ygn-standard (RFC 0001 YGN/YBN)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────────────┐
│     STANDALONE ENGINE REPO            │   │        AI AGENT REASONING LAYER        │
│             ygo-sim-core              │   │           obsidian-ygo-suite           │
├───────────────────────────────────────┤   ├────────────────────────────────────────┤
│ • 14-Zone Full Memory State Model     │   │ • Tactical Pilot & Coaching            │
│ • Fast Effect Timing (Box A through E)│   │ • Ratio Optimization Guidance          │
│ • Declarative Card DSL & Archetype DAG│   │ • Match Transcription Referee          │
│ • Legal Action Discovery & DFS Search │   │ • PSCT Adjudication                    │
│ • Adversarial Hand Trap Injection     │   │ • Local SQLite Card Database           │
│ • Early Insulation / Bait Evaluator   │   │                                        │
│ • Master Multi-Layer V(YBN) Engine    │   │                                        │
│ • Stdio MCP Server & Headless CLI     │   │                                        │
└───────────────────▲───────────────────┘   └────────────────────▲───────────────────┘
                    │                                            │
                    └─────────── MCP TOOL CONTRACT BOUNDARY ─────┘
                                 (JSON-RPC over stdio)
                                 - simulate_test_hands
                                 - explore_combo_tree
                                 - evaluate_handtrap_resilience
                                 - score_ybn_state
```

### Key Technical Innovations:
* **14-Zone Full Memory State Model:** Models `M1..M5`, `S1..S5`, `EL`, `ER`, `Field`, `GY`, `Banish`, `Hand`, `Deck`, and `ExtraDeck` with deep immutability.
* **Official Fast Effect Timing State Machine:** Codifies Konami Boxes A, B, C, D, and E with alternating priority and Spell Speed 1–3 enforcement.
* **SEGOC & Chain Blocking Engine:** Hierarchically orders simultaneous triggers across all 4 official tiers and detects chain-blocking shielding high-value effects from direct negation.
* **PSCT Conjunction Truth Tables:** Accurately evaluates `"then"` (sequential last-event timing and missed timing checks), `"and if you do"`, `"also"`, and `"and"`.
* **Zero-Collision 64-bit State Hasher:** xxHash64 hashing with canonical permutation sorting of unordered piles for transposition table pruning and cyclic loop detection.
* **Master Multi-Layer $V(\text{YBN})$ Valuation Engine:** Evaluates end-boards based on spatial zone diversification, anti-board breaker resilience (*Dark Ruler*, *Evenly Matched*, *Super Poly*), and Turn 3 follow-up recursion.

---

## 2. Quickstart & Installation

### Requirements:
* Node.js $\ge 20.0.0$ (Node 22 LTS recommended)
* npm $\ge 10.0.0$

```bash
# Clone the repository
git clone https://github.com/niloedson/ygo-sim-core.git
cd ygo-sim-core

# Install dependencies
npm install

# Run the test suite (52 tests across 8 test suites)
npm test

# Build production binaries and types into dist/
npm run build

# Verify code formatting and linting
npm run lint
```

---

## 3. Comprehensive Guide: Allowed Use Cases

`ygo-sim-core` is engineered for 6 primary competitive use cases:

### Use Case 1: Deck Consistency & Brick Rate Auditing (Monte Carlo)
**Problem:** Duelists often debate deck size ratios (e.g., 40 vs 42 cards) or how many starters are required to reliably achieve an uninterrupted opening playline.  
**Engine Solution:** Ingests any `.ydk` decklist file and conducts 1,000 to 10,000 virtual hand shuffles using a high-throughput partial Fisher-Yates deal (~200ms for 10,000 hands). Computes exact probability distributions for 0-starter bricks, 1–2 starter hands, and multiple starter extensions.

**CLI Command:**
```bash
node dist/bin/ygo-sim-core.js -d path/to/deck.ydk -m 10000
```

**Output:**
```json
{
  "total_simulations": 10000,
  "uninterrupted_combo_rate": 0.885,
  "brick_rate": 0.042,
  "average_ybn_score": 8.7,
  "interruption_distribution": {
    "0_disruptions": 0.042,
    "1_to_2_disruptions": 0.621,
    "3_to_4_disruptions": 0.236,
    "5_plus_disruptions": 0.101
  },
  "average_multi_layer_score": 2.1,
  "detected_infinite_loops": 0
}
```

---

### Use Case 2: Opening Hand Combo Tree Exploration & Line Ranking
**Problem:** When testing specific 5-card opening hands ("goldfishing"), players want to identify the highest-value end-board and see the exact move-by-move algebraic playline.  
**Engine Solution:** Discovers all legal actions in the game state, explores candidate branches up to configurable `max_depth`, prunes redundant permutations using 64-bit transposition caching, and ranks terminal boards by $V(\text{YBN})$. Outputs standard RFC 0001 YGN move transcripts.

**CLI Command:**
```bash
node dist/bin/ygo-sim-core.js -h "Infinitrack Harvester, Urgent Schedule, Called by the Grave"
```

**Output:**
```json
{
  "hand_analyzed": ["Infinitrack Harvester", "Urgent Schedule", "Called by the Grave"],
  "nodes_evaluated": 184,
  "unique_ybn_endpoints": 3,
  "top_lines": [
    {
      "rank": 1,
      "branch_type": "PRIMARY_CEILING",
      "ybn_score": 9.7,
      "early_insulation_secured": true,
      "terminal_ybn": "T1|M1|LP8000:8000|P1:ER[#ed1:Qliphort Genius(atk)],S2[#h3:Called by the Grave(set)],GY:[...],H:2,D:34,ED:13|P2:H:5|G:NS=0,SS=3",
      "ygn_path": "N[#h1:Infinitrack Harvester](atk)>M1\n  A(H)[#h2:Urgent Schedule]\n  SET[#h3:Called by the Grave]>S2\n  L[#h1:M1+#d1:M2]>ER[#ed1:Qliphort Genius](atk)<ED",
      "interruption_breakdown": {
        "field_negates": 1,
        "backrow_disruptions": 1,
        "gy_triggers": 1,
        "hand_traps": 0,
        "distinct_layers": 3
      },
      "resources_remaining": {
        "hand_count": 2,
        "normal_summon_used": true,
        "gy_count": 3,
        "deck_count": 34
      }
    }
  ]
}
```

---

### Use Case 3: Adversarial Hand Trap Resilience & Chokepoint Auditing
**Problem:** Naive combo tools optimize for solitaire combos in a vacuum that crumble to a single interruption. Players need to know where their line breaks and whether they have defensive insulation.  
**Engine Solution:** Systematically injects standard competitive hand traps at critical sequence points:
1. *Ash Blossom & Joyous Spring* (injected at initial Deck search/dump)
2. *Infinite Impermanence* (injected on the Normal Summon on-field trigger)
3. *Nibiru, the Primal Being* (injected immediately upon Summon #5)
4. *Droll & Lock Bird* (injected following the first card added to hand)
5. *Mulcharmy Fuwalos* (injected at Special Summon #1 from Deck/Extra Deck)

Calculates the fallback survival ratio $\frac{V(\text{YBN}_{\text{compromised}})}{V(\text{YBN}_{\text{ceiling}})}$ and assigns a composite resilience grade (`S`, `A`, `B`, `C`, `D`, `F`).

**CLI Command:**
```bash
node dist/bin/ygo-sim-core.js -h "Infinitrack Harvester, Called by the Grave" -r
```

**Output:**
```json
{
  "ceiling_ybn_score": 9.2,
  "resilience_matrix": [
    {
      "threat": "Ash Blossom & Joyous Spring on Starter Search",
      "step_injected": 1,
      "protected_by_insulation": true,
      "insulation_card_used": "Called by the Grave",
      "fallback_ybn_score": 9.2,
      "survival_ratio": 1.0,
      "chokepoint_severity": "Low"
    },
    {
      "threat": "Nibiru, the Primal Being at Summon 5",
      "step_injected": 5,
      "protected_by_insulation": true,
      "fallback_ybn_score": 9.2,
      "survival_ratio": 1.0,
      "chokepoint_severity": "Low"
    }
  ],
  "composite_resilience_rating": "A"
}
```

---

### Use Case 4: Mathematical Multi-Layer Board Valuation ($V(\text{YBN})$)
**Problem:** In modern Yu-Gi-Oh!, an end-board with 4 monster negates on field is vulnerable to single-card board wipes (*Dark Ruler No More*, *Forbidden Droplet*), whereas an end-board distributed across Field, Backrow, and Graveyard is resilient.  
**Engine Solution:** Implements the Master $V(\text{YBN})$ scoring formula:
$$V(\text{YBN}) = \sum Q(i) + \text{Bonus}_{\text{layers}} + \text{Val}_{\text{followup}} - \text{Pen}_{\text{blowout}} - \text{Pen}_{\text{draws}}$$

* **Base Quality ($Q(i)$):** Omni-Negate (+3.5), Summon Negate (+3.5), Monster Negate (+2.5), Spot Removal (+2.5), S/T Negate (+2.0), Floodgate (+3.0), Retained Hand Trap (+2.0).
* **Spatial Diversification Bonus ($\text{Bonus}_{\text{layers}}$):** Dual-layer resilience ($+1.5$), Triple-layer defense ($+3.0$).
* **Anti-Board Breaker Vulnerability Penalties ($\text{Pen}_{\text{blowout}}$):**
  - Dark Ruler No More Penalty ($-2.5$ if 100% of interruptions are concentrated on Field monsters).
  - Evenly Matched Penalty ($-2.0$ if zero Omni or Spell/Trap negates exist).
  - Super Polymerization Clumping Penalty ($-1.5$ if $\ge 2$ DARK/LIGHT monsters cluster on field).
* **Turn 3 Follow-Up Recursion ($\text{Val}_{\text{followup}}$):** Hand size ($+0.8$ per card), recyclable GY starters ($+1.5$), preserved Normal Summon ($+1.0$).
* **Conceded Draws Penalty ($\text{Pen}_{\text{draws}}$):** $-3.5 \times \max(0, \text{Summons} - 2)$ under active *Fuwalos* or *Maxx "C"*.

**CLI Command:**
```bash
node dist/bin/ygo-sim-core.js -y "T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],S2[#5:Called by the Grave(set)],H:2,D:34,ED:13|P2:M3[Token(def)],H:5|G:NS=1"
```

---

### Use Case 5: AI Agent Delegation via Model Context Protocol (MCP)
**Problem:** Large Language Models (LLMs) hallucinate legal plays, cannot simulate thousands of state nodes per second, and exhaust token context windows when doing combo arithmetic.  
**Engine Solution:** Exposes the engine as a standardized JSON-RPC stdio server via `@modelcontextprotocol/sdk`. AI agent suites (such as `obsidian-ygo-suite`, Claude Desktop, Cursor, and Gemini CLI) delegate heavy compute to `ygo-sim-core` with sub-100ms response times.

**Configuration for Claude Desktop or Cursor (`mcp.json`):**
```json
{
  "mcpServers": {
    "ygo-sim-core": {
      "command": "node",
      "args": ["C:\\Users\\nedsonbr\\Documents\\GitHub\\ygo-sim-core\\dist\\mcp\\server.js"]
    }
  }
}
```

**Standard MCP Tools Provided:**
| Tool Name | Input Parameters | Purpose |
| :--- | :--- | :--- |
| `simulate_test_hands` | `deck_ydk`, `sample_size`, `hand_size` | Monte Carlo deck consistency simulation |
| `explore_combo_tree` | `hand`, `deck_ydk`, `max_depth`, `branch_limit` | Directed combo search with YGN transcripts |
| `evaluate_handtrap_resilience` | `hand`, `deck_ydk`, `threat_suite` | Adversarial hand trap stress-testing |
| `score_ybn_state` | `ybn` | Real-time multi-layer $V(\text{YBN})$ decomposition |

---

### Use Case 6: Programmatic TypeScript / Node.js Library
**Problem:** Developers building custom web apps, match reporting bots, or tournament tooling need direct access to state structures and serialization routines.  
**Engine Solution:** Re-exports the full domain API in `dist/index.js`.

**TypeScript Example:**
```typescript
import { 
  scoreYBN, 
  parseFromYBN, 
  serializeToYBN, 
  computeStateHash, 
  exploreComboTree,
  simulateHands,
  parseYdkDeck
} from '@ygo/sim-core';

// 1. Evaluate any board snapshot
const result = scoreYBN("T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],S2[#5:Called by the Grave(set)],H:2,D:34,ED:13|P2:H:5|G:NS=1");
console.log(`V(YBN) Score: ${result.total_score}`);
console.log(`Active Layers: ${result.breakdown.layer_diversification.active_layers.join(', ')}`);

// 2. Compute canonical 64-bit state hash for transposition caching
const state = parseFromYBN("T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],H:2|P2:H:5|G:NS=1");
const hash = computeStateHash(state);
console.log(`State Hash: ${hash}`);
```

---

## 4. CLI Arguments Reference

| Option | Shorthand | Description | Default |
| :--- | :---: | :--- | :---: |
| `--deck <path>` | `-d` | Path to `.ydk` deck file | `undefined` |
| `--monte-carlo [number]` | `-m` | Number of Monte Carlo hands to simulate | `1000` |
| `--hand <cards>` | `-h` | Comma-separated opening hand cards (names or passcodes) | `undefined` |
| `--resilience` | `-r` | Run adversarial hand trap resilience stress-testing | `false` |
| `--ybn <state>` | `-y` | Score arbitrary RFC 0001 YBN snapshot string | `undefined` |
| `--archetype <path>` | `-a` | Path to custom archetype JSON definition | `sample_archetype.json` |
| `--help` | | Display command-line options help | |
| `--version` | `-V` | Output version number | `1.0.0` |

---

## 5. Repository Layout

```text
ygo-sim-core/
├── bin/
│   └── ygo-sim-core.ts          # Root CLI launcher proxy
├── data/
│   └── archetypes/
│       └── sample_archetype.json # Earth Machine & Tech Staples Dataset
├── src/
│   ├── bin/
│   │   └── ygo-sim-core.ts      # Compiled CLI binary entrypoint
│   ├── dsl/
│   │   ├── cardSchema.ts        # Zod validation schemas
│   │   ├── archetypeLoader.ts   # Archetype DAG loader & CardRegistry
│   │   └── primitives.ts        # Atomic operations (SEARCH, SS, MILL, ATTACH)
│   ├── engine/
│   │   ├── actionDiscovery.ts   # Legal action discovery A(S) and state transitions
│   │   ├── conjunctions.ts      # PSCT truth tables ('then', 'and if you do', 'also', 'and')
│   │   ├── fastEffectEngine.ts  # Konami Fast Effect Timing Chart (Boxes A–E)
│   │   ├── hasher.ts            # Canonical xxHash64 state hasher
│   │   ├── insulationEvaluator.ts # Pre-Summon 5 Nibiru & bait auditor
│   │   ├── interruptionInjector.ts # Adversarial Hand Trap stress-tester
│   │   ├── phaseMachine.ts      # Turn sequence (DP -> SP -> M1 -> BP -> M2 -> EP)
│   │   └── segoc.ts             # 4-tier SEGOC chain builder & chain blocking
│   ├── evaluator/
│   │   └── boardScorer.ts       # Master Multi-Layer V(YBN) valuation engine
│   ├── mcp/
│   │   ├── handlers.ts          # Core handlers for the 4 MCP tools
│   │   └── server.ts            # Stdio MCP Server (@modelcontextprotocol/sdk)
│   ├── notation/
│   │   └── ybnSerializer.ts     # Bidirectional RFC 0001 YBN serializer & parser
│   ├── search/
│   │   ├── cycleDetector.ts     # Path-based cyclic loop detector (CYCLE_DETECTED)
│   │   ├── monteCarlo.ts        # .ydk deck parser & Monte Carlo hand simulator
│   │   ├── transpositionTable.ts # Visited state hash cache
│   │   └── treeTraversal.ts     # Directed combo tree DFS exploration
│   ├── types/
│   │   ├── card-dsl.ts          # TypeScript interfaces for cards, costs, effects
│   │   ├── mcp-contracts.ts     # Immutable JSON-RPC MCP schemas
│   │   └── state.ts             # 14-Zone State Model, gates, locks, registers
│   └── index.ts                 # Root public library export
└── test/                        # Vitest unit & integration test suites (Phases 0–7)
```

---

## 6. Upstream Standards Alignment

* **RFC 0001 (YGN & YBN Algebraic Notation):** Developed in synergy with [`obsidian-ygo-suite`](https://github.com/niloedson/obsidian-ygo-suite) and `ygo-notary`.
* **Zero Network Execution:** All simulations, Monte Carlo deals, and state tree calculations operate 100% locally with zero external network dependencies.
* **Hermetic Determinism:** Bit-exact, reproducible state transitions and canonical state hashing.

---

## 7. License
MIT License. Grounded in the RFC 0001 Algebraic Game Notation Specification.
