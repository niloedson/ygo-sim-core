# ygo-sim-core: High-Performance Deterministic Yu-Gi-Oh! Combo & Valuation Engine

**Repository:** `ygo-sim-core`  
**Pattern:** "Stockfish" Engine to `obsidian-ygo-suite` ("Grandmaster")  
**Standard:** RFC 0001 (Yu-Gi-Oh! Game Notation [YGN] & Board Notation [YBN])  
**Execution Surface:** Headless CLI & stdio Model Context Protocol (MCP) Server  

---

## 1. Overview

`ygo-sim-core` is an autonomous, high-speed computational simulation engine for Yu-Gi-Oh! TCG competitive play. It executes deterministic tree search across opening hands, advances through official turn phases (Draw $\to$ Standby $\to$ Main 1 $\to$ Battle $\to$ Main 2 $\to$ End), resolves chains under Konami Fast Effect Timing and SEGOC rules, and computes mathematical valuations $V(\text{YBN})$ for terminal end-boards.

### Key Capabilities:
* **14-Zone Full Memory Model:** Accurately tracks `M1..M5`, `S1..S5`, `EL`, `ER`, `Field`, `GY`, `Banish`, `Hand`, `Deck`, and `ExtraDeck`.
* **Multi-Layer Interruption Accounting:** Evaluates disruptions across distinct spatial layers (Field, Backrow, Graveyard, Hand, Banished) rather than naive monster negate counting.
* **Early Insulation Auditing:** Detects whether an omni-negate or monster negate is summoned at or before Summon #4 to insulate the combo against *Nibiru, the Primal Being*.
* **Adversarial Hand Trap Injection:** Stress-tests candidate lines against *Ash Blossom*, *Infinite Impermanence*, *Nibiru*, *Droll & Lock Bird*, and *Mulcharmy Fuwalos*.
* **Cyclic Loop & Exploit Detection:** Hashes game states ($\mathcal{H}(S)$) to prevent infinite loops and prune redundant transposition paths.
* **Zero-Hallucination MCP Tools:** Serves exact playlines and YBN snapshots directly to AI agents via JSON-RPC.

---

## 2. Quickstart & Installation

```bash
# Clone the repository
git clone https://github.com/your-org/ygo-sim-core.git
cd ygo-sim-core

# Install dependencies
npm install

# Run comprehensive test suite
npm test

# Build production binary
npm run build
```

---

## 3. CLI Usage

### Monte Carlo Goldfishing (10,000 Hands)
```bash
node dist/bin/ygo-sim-core.js --deck ./decks/machina_earth.ydk --monte-carlo 10000 --output report.json
```

### Specific 5-Card Hand Tree Exploration
```bash
node dist/bin/ygo-sim-core.js \
  --deck ./decks/machina_earth.ydk \
  --hand "Infinitrack Harvester, Exceptional Schedule, Urgent Schedule, Dominus Purge, Called by the Grave" \
  --explore --depth 10
```

### Adversarial Hand Trap Resilience Evaluation
```bash
node dist/bin/ygo-sim-core.js \
  --deck ./decks/machina_earth.ydk \
  --hand "Infinitrack Harvester, Heavy Forward, Infinitrack Trencher, Ash Blossom, Crossout Designator" \
  --resilience
```

---

## 4. MCP Server Integration

Add `ygo-sim-core` to your AI agent configuration (e.g., Cursor, Claude Desktop, or Gemini CLI):

```json
{
  "mcpServers": {
    "ygo-sim-core": {
      "command": "node",
      "args": ["/absolute/path/to/ygo-sim-core/dist/mcp/server.js"]
    }
  }
}
```

### Exposed MCP Tools:
1. `simulate_test_hands`: Monte Carlo consistency analysis from raw `.ydk`.
2. `explore_combo_tree`: Branched playlines ranked by $V(\text{YBN})$.
3. `evaluate_handtrap_resilience`: Chokepoint stress-testing and fallback matrix.
4. `score_ybn_state`: Multi-layer breakdown and scoring of any RFC 0001 YBN string.

---

## 5. Directory Structure

```text
ygo-sim-core/
├── bin/
│   └── ygo-sim-core.ts          # CLI entrypoint
├── data/
│   └── archetypes/              # Declarative Archetype Action DAGs (JSON)
├── src/
│   ├── dsl/                     # Card schema validation & loader
│   ├── engine/                  # Fast Effect state machine, SEGOC, phases
│   ├── evaluator/               # Master V(YBN) multi-layer valuation
│   ├── mcp/                     # Stdio MCP Server (@modelcontextprotocol/sdk)
│   ├── notation/                # RFC 0001 YBN/YGN serializers & parsers
│   ├── search/                  # Tree search, transposition table, cycle detector
│   └── types/                   # TypeScript schemas & contracts
└── test/                        # Vitest unit & integration test suites
```

---

## 6. License
MIT License. Grounded in RFC 0001 Algebraic Game Notation.
