# Master Architectural Blueprint: Standalone Deterministic Combo Simulator (`ygo-sim-core`)

**Document ID:** `SPEC-SIM-2026-001`
**Date:** October 13, 2026
**Status:** Implemented, Operational & Dual-MCP Verified (All 7 Phases Complete, 52/52 Tests Passing)
**Upstream Standard:** [RFC 0001: YGN & YBN Algebraic Notation Standards](https://github.com/niloedson/ygn-standard)
**Parent Monorepo:** `obsidian-ygo-suite` (Operational Reasoning Layer)
**Target Repository:** `ygo-sim-core` (Standalone Computational Simulation Engine)
**Parent Architectural Decision:** [ADR-010: Standalone Deterministic Combo Simulator & Dual-MCP Integration](https://github.com/niloedson/obsidian-ygo-suite/blob/main/docs/decisions/ADR-010-standalone-combo-simulator-and-dual-mcp.md)

---

## Executive Summary & Charter

This document provides the exhaustive, formal step-by-step engineering blueprint for implementing **`ygo-sim-core`** as an autonomous, high-performance external repository.

In competitive Yu-Gi-Oh!, high-level theory relies on desk test hands ("goldfishing"), opening hand consistency, resilience against hand traps, and the establishment of **multi-layered end-boards** capable of interrupting the opponent across multiple distinct operational zones (Field, Backrow, Graveyard, Hand, and Banished).

`ygo-sim-core` serves as the **"Stockfish"** of Yu-Gi-Oh!: a pure, headless, deterministic state-tree computation engine. It models turn phases, prioritizes legal activations, simulates game-state transitions, detects cyclic loops, stress-tests playlines against opponent hand traps, and outputs mathematically ranked **YBN (Yu-Gi-Oh! Board Notation)** states and **YGN (Yu-Gi-Oh! Game Notation)** action transcripts.

The companion repository `obsidian-ygo-suite` acts as the **"Grandmaster"** (the tactical AI agent and coaching suite), delegating heavy state-space exploration to `ygo-sim-core` via standard Model Context Protocol (MCP) tool contracts.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        UPSTREAM STANDARDS BODY                         │
│                    ygn-standard (RFC 0001 YGN/YBN)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────────────┐
│     NEW STANDALONE ENGINE REPO        │   │        CURRENT SUITE MONOREPO          │
│             ygo-sim-core              │   │           obsidian-ygo-suite           │
├───────────────────────────────────────┤   ├────────────────────────────────────────┤
│ • 14-Zone Memory State Model          │   │ • Agent Reasoning Layer:               │
│ • Turn Phase & Fast Effect Sequencer  │   │   - ygo-pilot (Tactical Decision)      │
│ • Declarative Card DSL & Archetype DAG│   │   - ygo-deck-architect (Math Ratios)   │
│ • Legal Activation Discovery          │   │   - ygo-notary (Match Transcription)   │
│ • Adversarial Hand Trap Injection     │   │   - ygo-judge (PSCT Adjudication)      │
│ • Early Insulation / Bait Evaluator   │   │ • Local Data Layer (ygoprodeck-mcp)    │
│ • Master Multi-Layer V(YBN) Engine    │   │ • Obsidian Vault Publishing            │
│ • Headless CLI & MCP Server Binary    │   │ • Rapid CI (<3s Test Suite)            │
└───────────────────▲───────────────────┘   └────────────────────▲───────────────────┘
                    │                                            │
                    └─────────── MCP TOOL CONTRACT BOUNDARY ─────┘
                                 (JSON-RPC over stdio)
                                 - simulate_test_hands
                                 - explore_combo_tree
                                 - evaluate_handtrap_resilience
                                 - score_ybn_state
```

---

## 1. Architectural Philosophy & System Boundaries

### 1.1 The "Stockfish vs. Grandmaster" Pattern
* **Decoupling Heavy Compute from LLM Context:** Full-depth combo tree exploration evaluates hundreds of state nodes per second. Running this inside an LLM prompt or within the agent monorepo wastes tokens and degrades CI agility.
* **Hermetic Determinism:** Given an identical random seed or 5-card opening hand, `ygo-sim-core` guarantees 100% bit-exact, reproducible state transitions and YBN representations.
* **Separation of Concerns Matrix:**

| Domain / Capability | Standalone Engine (`ygo-sim-core`) | Local Agent Suite (`obsidian-ygo-suite`) |
| :--- | :---: | :---: |
| **Card Database & Full PSCT** | Consumes declarative card DSL / cache | Authoritative local SQLite (`ygoprodeck-mcp`) |
| **Algebraic Grammar & Notation** | Implements RFC 0001 (YBN/YGN generation) | Standards owner & referee (`ygo-notary`) |
| **Phase & Priority Simulation** | Authoritative state machine (DP $\to$ EP) | Contextual guidance (`ygo-judge`) |
| **Legal Activation Resolution** | Computes valid actions & resolves costs | Arbitrates ambiguous rules / disputes |
| **Combinatorial State Traversal**| DFS / MCTS with Transposition Pruning | Interprets high-level tactical intent |
| **Multi-Layer End-Board Scoring**| Computes mathematical $V(\text{YBN})$ score | Weighs human psychological matchup factors |
| **Adversarial Interruption Injection**| Simulates Ash/Imperm/Nibiru at Step $k$ | Models opponent pilot tendencies |
| **Execution Surface** | Headless CLI & Stdio MCP Server | Obsidian Desktop / Cursor / Gemini CLI |

---

## 2. Turn Phase Simulation & Fast Effect Timing Engine

Modern Yu-Gi-Oh! rules are governed by strict phase progressions and the official **Konami Fast Effect Timing Chart**. `ygo-sim-core` models this state machine without simplification.

```text
       ┌─────────────┐
       │ Draw Phase  │ (DP: Turn Draw, Fast Effects)
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │Standby Phase│ (SP: Standby Triggers, Fast Effects)
       └──────┬──────┘
              ▼
       ┌─────────────┐
  ┌───>│Main Phase 1 │ (M1: Open Game State, Ignition, Summons, SEGOC Chains)
  │    └──────┬──────┘
  │           ▼
  │    ┌─────────────┐
  │    │Battle Phase │ (BP: Start Step, Battle Step, Damage Step [5 sub-steps], End Step)
  │    └──────┬──────┘
  │           ▼
  │    ┌─────────────┐
  │    │Main Phase 2 │ (M2: Open Game State, Recovery Lines, MP2 Control Pivots)
  │    └──────┬──────┘
  │           ▼
  │    ┌─────────────┐
  │    │  End Phase  │ (EP: "Until end of turn" expiration, Discard to 6)
  │    └─────────────┘
```

### 2.1 The Fast Effect Timing State Machine (Box A through E)
At any point during a Phase, the game operates under one of five timing states:
1. **Box A (Open Game State):**
   - Turn Player ($P_1$) possesses priority.
   - Legal actions: Normal Summon, Set, Special Summon via procedure, Ignition effect activation, Spell activation (Normal/Field/Continuous/Ritual/Equip), Phase transition declaration.
2. **Box B (Turn Player Fast Effect Window):**
   - When an action is taken that does not start a chain (e.g. Normal Summon, setting a card, advancing phase) or an action has just resolved:
   - $P_1$ has the right to activate a Spell Speed 2+ effect.
3. **Box C (Opponent Fast Effect Window):**
   - If $P_1$ passes in Box B, Opponent ($P_2$) receives priority to activate a Spell Speed 2+ effect.
4. **Box D (Chain Building):**
   - Whenever an effect is activated, a Chain begins:
   - Priority alternates back and forth: $P_1 \to P_2 \to P_1 \to P_2$.
   - Any activated effect must be $\ge$ the Spell Speed of the previous chain link (except Spell Speed 3 Counter Traps, which can only be responded to by Spell Speed 3).
5. **Box E (Chain Resolution):**
   - When both players pass priority without adding to the chain, the chain resolves in **strict Last-In-First-Out (LIFO)** order.
   - No effects can be activated while a chain is resolving.

### 2.2 SEGOC (Simultaneous Effects Go On Chain) & Chain Blocking
When an action (such as a summon or board wipe) causes multiple trigger conditions to be met simultaneously, `ygo-sim-core` orders the chain according to official KDE SEGOC hierarchy:
1. **Tier 1:** Turn Player’s Mandatory Trigger Effects.
2. **Tier 2:** Opponent’s Mandatory Trigger Effects.
3. **Tier 3:** Turn Player’s Optional Trigger Effects.
4. **Tier 4:** Opponent’s Optional Trigger Effects.

#### Chain Blocking Mechanics:
If $P_1$ has two optional triggers simultaneously (e.g., *Infinitrack Harvester* and an on-summon searcher):
* $P_1$ orders them as CL1 (high-value target) and CL2 (secondary trigger).
* Since fast effects like *Ash Blossom & Joyous Spring* must directly chain to the effect they negate, CL2 legally shields ("chain blocks") CL1! The engine automatically detects and prioritizes chain-blocking sequences during tree traversal.

### 2.3 Conjunction Resolution & Timing Preservation
The engine accurately resolves all four Konami PSCT conjunctions:
* **"then" (Sequential, B depends on A):** A happens, then B happens. Event B is the **only** "last event to occur". Any *"When... you can"* optional trigger reliant on Event A will **MISS TIMING**.
* **"and if you do" (Simultaneous, B depends on A):** Both A and B happen simultaneously for timing purposes. Both qualify as the last event.
* **"also" (Simultaneous, Independent):** A and B resolve independently. Both qualify as the last event.
* **"and" (Simultaneous, Both Required):** Both A and B must succeed. Both qualify as the last event.

---

## 3. Game State Representation & 14-Zone Memory Model

`ygo-sim-core` implements an immutable, zero-allocation game state struct representing the complete 14-zone board topology:

```text
               [ OPPONENT (Player 2 / P2) ]
   [S5]   [S4]   [S3]   [S2]   [S1]   [Field_P2]
   [M5]   [M4]   [M3]   [M2]   [M1]   [GY_P2] [Banish_P2]
          [EMZ-L]       [EMZ-R]
   [M1]   [M2]   [M3]   [M4]   [M5]   [GY_P1] [Banish_P1]
   [Field_P1] [S1] [S2] [S3]   [S4]   [S5]
               [ TURN PLAYER (Player 1 / P1) ]
```

### 3.1 Formal State Tuple ($S$)
$$S = \langle T, \Phi, \mathbf{LP}, \mathbf{Zones}_1, \mathbf{Zones}_2, \mathbf{Gates}, \mathbf{Flags}, \mathbf{Registers} \rangle$$

1. **Turn ($T$) & Phase ($\Phi$):** Integer turn counter and active phase enum (`DP`, `SP`, `M1`, `BP`, `M2`, `EP`).
2. **Life Points ($\mathbf{LP}$):** Pair $\langle LP_1, LP_2 \rangle$ (default 8000:8000).
3. **Player Zones ($\mathbf{Zones}_1, \mathbf{Zones}_2$):**
   * `M1..M5` (Main Monster Zones): Card entity, battle position (`atk`, `def`, `set`), attached Xyz materials array, current ATK/DEF modifiers, negated status.
   * `EL, ER` (Extra Monster Zones): Shared zone slots, orientation ownership, Link arrow pointers.
   * `S1..S5` (Spell & Trap Zones): Card entity, state (`face-up`, `set`), turn set timestamp (to enforce Quick-Play/Trap 1-turn delay).
   * `F` (Field Zone): Active Field Spell.
   * `GY` (Graveyard): Ordered stack of cards, flags for "sent to GY this turn".
   * `B` (Banished): Cards banished face-up or face-down.
   * `H` (Hand): Array of cards currently in hand.
   * `D` (Main Deck): Ordered stack of remaining cards.
   * `ED` (Extra Deck): Fusion, Synchro, Xyz, Link card pool.
4. **Resource Gates ($\mathbf{Gates}$):**
   * `normal_summon_available`: Boolean flag ($1 \to 0$ upon normal summon/set).
   * `special_summon_count`: Integer counter tracking total summons conducted this turn (evaluated against *Nibiru* threshold $\ge 5$, *El Shaddoll Winda* cap $= 1$).
5. **Hard Once Per Turn (HOPT) Registry ($\mathbf{Registers}$):**
   * Set of activated card/effect IDs during the current turn.
6. **Operational Locks & Xenolocks ($\mathbf{Flags}$):**
   * Bitmask tracking lingering restrictions:
     - `LOCK_FIRE_ONLY`: Only FIRE monsters can be Special Summoned.
     - `LOCK_XYZ_ONLY`: Locked into Xyz monsters from Extra Deck.
     - `LOCK_LINK_ONLY`: Locked into Link monsters from Extra Deck.
     - `LOCK_NO_SPECIAL_FROM_EXTRA`: Total Extra Deck summon lockout.
     - `LINGERING_OPPONENT_DRAW`: e.g. under *Mulcharmy Fuwalos* / *Maxx "C"*.

### 3.2 RFC 0001 YBN Serialization & Deserialization
The engine bi-directionally serializes state $S$ to and from standard YBN strings:

```text
T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],M4[#e2:River Stormer(atk){#3,#4}],S2[#5:Purge(set)],GY:[#1:Exceptional,#2:Urgent],H:2,D:34,ED:13|P2:M3[Token(def)],H:5,D:35,ED:15|G:NS=0,SS=4
```

### 3.3 Zero-Collision State Hashing for Transposition Pruning
To prevent exponential branching during combo graph traversal, every game state generates a 64-bit compact hash $\mathcal{H}(S)$:
$$\mathcal{H}(S) = \text{XXH64}(\text{Canonicalize}(YBN(S)))$$
* **Canonicalization Rule:** Zone cards, GY contents, and hand cards are sorted by canonical card passcode before hashing to ensure equivalent permutations map to the identical transposition key.
* **Cyclic Loop Detection:** If $\mathcal{H}(S_t) == \mathcal{H}(S_{t-k})$ and resource delta $\Delta R \ge 0$, an infinite loop is identified and pruned with an alert flag.

---

## 4. Declarative Card DSL & Archetype Action DAG Architecture

Rather than succumbing to the "13,000-Card Full Engine Trap," `ygo-sim-core` uses a **Declarative Card Action DSL**. A competitive deck only utilizes 12–18 unique engine cards plus standard tech staples. Each card is expressed as an Action DAG node.

### 4.1 Card Schema Definition

```typescript
export interface CardDefinition {
  id: string;                      // 8-digit passcode or unique alias (e.g. "89631139")
  name: string;                    // Card Name
  cardType: 'MONSTER' | 'SPELL' | 'TRAP';
  monsterAttributes?: {
    attribute: 'DARK' | 'LIGHT' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';
    race: string;                  // e.g. 'Dragon', 'Machine', 'Cyberse'
    levelOrRank: number;
    atk: number;
    def?: number;                  // Undefined for Link monsters
    linkRating?: number;
    linkArrows?: ('TL' | 'T' | 'TR' | 'L' | 'R' | 'BL' | 'B' | 'BR')[];
  };
  spellTrapType?: 'NORMAL' | 'CONTINUOUS' | 'QUICK_PLAY' | 'FIELD' | 'EQUIP' | 'COUNTER';
  archetypes: string[];            // e.g. ['Snake-Eye', 'Sinful Spoils']
  effects: EffectDefinition[];
}

export interface EffectDefinition {
  effectId: string;
  hoptGroup?: string;              // Shared HOPT key across card copies
  category: 'IGNITION' | 'TRIGGER' | 'QUICK' | 'PROCEDURE' | 'CONTINUOUS';
  activationLocation: ('HAND' | 'FIELD_M' | 'FIELD_S' | 'GRAVEYARD' | 'BANISHED')[];
  spellSpeed: 1 | 2 | 3;

  // Activation Preconditions
  conditions: ConditionCheck[];
  costs: CostOperation[];
  targets?: TargetCriteria[];

  // Chain Resolution
  resolution: ResolutionOperation[];
  lingeringLocks?: XenolockRestriction[];

  // Tactical Evaluation Tagging (for Opponent's Turn Interruption Accounting)
  interruptionProfile?: InterruptionProfile;
}

export interface InterruptionProfile {
  layer: 'FIELD' | 'BACKROW' | 'GRAVEYARD' | 'HAND' | 'BANISHED';
  kind: 'OMNI_NEGATE' | 'MONSTER_NEGATE' | 'SPELL_TRAP_NEGATE' | 'SPOT_REMOVAL' | 'SUMMON_NEGATE' | 'FLOODGATE';
  removalType?: 'DESTROY' | 'BANISH' | 'BOUNCE' | 'SPIN' | 'SEND_TO_GY';
  isTargeting: boolean;
  spellSpeed: 2 | 3;
  resilientAgainstWipes: ('DARK_RULER' | 'EVENLY_MATCHED' | 'SUPER_POLY' | 'RAIGEKI')[];
}
```

### 4.2 Declarative Primitives
Effects execute sequences of atomic operations:
* `SEARCH(source, filter, destination)`
* `SPECIAL_SUMMON(source, filter, targetZone, position)`
* `SEND_TO_GY(source, target)`
* `BANISH(source, target, faceDown?)`
* `ATTACH_MATERIAL(source, targetXyz)`
* `DETACH_MATERIAL(sourceXyz, count)`
* `APPLY_LOCK(restriction)`
* `NEGATE_ACTIVATION(targetChainLink)`
* `NEGATE_EFFECT(targetCard)`

### 4.3 Concrete Card DSL Implementations

#### Example 1: 1-Card Starter (*Infinitrack Harvester*)
```json
{
  "id": "67234805",
  "name": "Infinitrack Harvester",
  "cardType": "MONSTER",
  "monsterAttributes": {
    "attribute": "EARTH",
    "race": "Machine",
    "levelOrRank": 2,
    "atk": 0,
    "def": 2100
  },
  "archetypes": ["Infinitrack"],
  "effects": [
    {
      "effectId": "harvester_on_summon",
      "hoptGroup": "HOPT_HARVESTER_SEARCH",
      "category": "TRIGGER",
      "activationLocation": ["FIELD_M"],
      "spellSpeed": 1,
      "conditions": [{ "type": "EVENT_IS_NORMAL_OR_SPECIAL_SUMMONED" }],
      "costs": [],
      "resolution": [
        {
          "type": "SEARCH",
          "from": "DECK",
          "to": "HAND",
          "filter": { "archetype": "Infinitrack", "cardType": "MONSTER", "excludeId": "67234805" }
        }
      ]
    }
  ]
}
```

#### Example 2: Hand Trap & Turn 0 Interruption (*Ash Blossom & Joyous Spring*)
```json
{
  "id": "14558127",
  "name": "Ash Blossom & Joyous Spring",
  "cardType": "MONSTER",
  "monsterAttributes": {
    "attribute": "FIRE",
    "race": "Zombie",
    "levelOrRank": 3,
    "atk": 0,
    "def": 1800
  },
  "archetypes": [],
  "effects": [
    {
      "effectId": "ash_blossom_negate",
      "hoptGroup": "HOPT_ASH_BLOSSOM",
      "category": "QUICK",
      "activationLocation": ["HAND"],
      "spellSpeed": 2,
      "conditions": [
        { "type": "OPPONENT_ACTIVATED_EFFECT" },
        { "type": "EFFECT_INCLUDES_DECK_SEARCH_OR_MILL_OR_SS" }
      ],
      "costs": [{ "type": "DISCARD_THIS_CARD" }],
      "resolution": [{ "type": "NEGATE_EFFECT", "target": "PREVIOUS_CHAIN_LINK" }],
      "interruptionProfile": {
        "layer": "HAND",
        "kind": "MONSTER_NEGATE",
        "isTargeting": false,
        "spellSpeed": 2,
        "resilientAgainstWipes": ["DARK_RULER", "EVENLY_MATCHED", "SUPER_POLY", "RAIGEKI"]
      }
    }
  ]
}
```

#### Example 3: Early Insulation Boss (*Baronne de Fleur*)
```json
{
  "id": "84815190",
  "name": "Baronne de Fleur",
  "cardType": "MONSTER",
  "monsterAttributes": {
    "attribute": "WIND",
    "race": "Warrior",
    "levelOrRank": 10,
    "atk": 3000,
    "def": 2400
  },
  "archetypes": [],
  "effects": [
    {
      "effectId": "baronne_omni_negate",
      "category": "QUICK",
      "activationLocation": ["FIELD_M"],
      "spellSpeed": 2,
      "conditions": [
        { "type": "CHAIN_LINK_EXISTS" },
        { "type": "ONCE_WHILE_FACE_UP_FLAG_NOT_SET" }
      ],
      "costs": [{ "type": "SET_ONCE_WHILE_FACE_UP_FLAG" }],
      "resolution": [
        { "type": "NEGATE_ACTIVATION", "target": "PREVIOUS_CHAIN_LINK" },
        { "type": "DESTROY", "target": "PREVIOUS_CHAIN_LINK_CARD" }
      ],
      "interruptionProfile": {
        "layer": "FIELD",
        "kind": "OMNI_NEGATE",
        "removalType": "DESTROY",
        "isTargeting": false,
        "spellSpeed": 2,
        "resilientAgainstWipes": ["EVENLY_MATCHED"]
      }
    }
  ]
}
```

---

## 5. Legal Action Discovery & Combo Graph Traversal Engine

At any point in the simulation, `ygo-sim-core` dynamically discovers the set of all legal actions $A(S)$ and expands the state tree.

```text
                                [ Game State S_k ]
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
   [ Action a1: Normal ]       [ Action a2: Spell ]         [ Action a3: Procedure ]
           │                            │                            │
           ▼                            ▼                            ▼
    [ Game State S1 ]            [ Game State S2 ]            [ Game State S3 ]
      Hash: 0x8F9C...              Hash: 0x4B2E...              Hash: 0x8F9C... (Pruned:
                                                                  Transposition match!)
```

### 5.1 The Action Discovery Algorithm
For state $S_k$:
1. **Audit Phase & Priority:** If in Box A ($M1$ or $M2$), initialize discovery.
2. **Scan Monster Summons:**
   * Normal Summon / Set: Check `gates.normal_summon_available == true`. If true, scan hand for Level 1–4 monsters (no tribute), or Level 5–6 / 7+ (if sufficient tribute bodies exist on `M1..M5`).
   * Extra Deck Procedures: Scan Extra Deck against current field materials for:
     - **Link Summons:** Match material criteria, Link Rating $= \sum \text{materials}$, placement restricted to open `EMZ` or zones pointed to by Link Arrows.
     - **Xyz Summons:** Match matching-level monsters on field, stack materials underneath target card.
     - **Synchro Summons:** Match 1 Tuner + 1+ Non-Tuners with exact level sum.
     - **Fusion Summons:** Check availability of active fusion card or contact procedure.
3. **Scan Activations:**
   * Hand: Normal Spells, Quick-Play Spells, Field Spells, ignition monster effects.
   * Field Spells & Traps: Face-up continuous effects, face-down traps set on previous turns.
   * Field Monsters: Ignition effects whose costs can currently be paid.
   * Graveyard & Banished: Ignition/trigger effects with valid activation conditions.
4. **Filter by Operational Gates:**
   * Exclude actions if card effect HOPT is present in `registers.hopt`.
   * Exclude summons violating active `flags.xenolocks`.
   * Exclude activations where costs cannot be paid (e.g. required discard target does not exist).

### 5.2 Search Tree Strategy & Pruning Rules
The simulation explores the combinatorial space using Depth-First Search with heuristic evaluation:

* **Transposition Table:** Visited states are cached in a hash map `Visited[Hash(S)] = max_eval`. If an identical YBN hash is reached with equal or lesser resource efficiency, the branch is immediately pruned.
* **Solitaire Overextension Pruner:** If an action expends the last card in hand and GY without increasing the net interruption count or establishing follow-up recursion, it is penalized and de-prioritized.
* **Three Strategic Branch Profiles:**
  1. **Branch A (Primary Ceiling Line):** Unhindered maximization under zero opponent disruption.
  2. **Branch B (Probing & Bait Line):** Prioritizes non-committal spell/hand baits to extract negations *before* committing the Normal Summon.
  3. **Branch C (Compromised Fallback Line):** Restricts Special Summon count to $\le 2$ when format turn-enders (*Mulcharmy Fuwalos* / *Nibiru*) are active.

---

## 6. Early Insulation & Adversarial Hand Trap Injection Engine

A common duelist critique of naive combo simulators is that they optimize for glass-cannon boards in a vacuum. `ygo-sim-core` incorporates an **Adversarial Interruption Injection Engine**.

```text
Candidate Combo Line:
Step 1: Activate Spell A ────> [Opponent Ash Blossom Injected]
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
       [Path Fails: Brick]                         [Extender B Deployed]
       (Score: 0.0, Dead)                                     │
                                                   Step 2: Normal Summon C
                                                              │
                                                   Step 3: Overlay Boss D
                                                              │
                                                   [Terminal Fallback YBN]
                                                   (Score: 7.5, Resilient)
```

### 6.1 The Pre-Summon 5 Nibiru Protection Window
* **The Nibiru Rule:** *Nibiru, the Primal Being* can only be activated as a Quick Effect during the Main Phase after the turn player has Normal or Special Summoned **5 or more monsters** this turn.
* **Insulation Audit:** The engine monitors `gates.special_summon_count`. If an active summon negate or omni-negate (*Baronne de Fleur*, *D/D/D Wave High King Caesar*, *Evolzar Lars*, *Azamina Silvera*) is summoned at **Summon $\le 4$**, the playline is tagged with:
  $$\text{INSULATION\_NIBIRU\_SECURED} = \text{true}$$
  Any subsequent branch along this path receives an insulation safety multiplier ($+2.5$).

### 6.2 Pre-Normal Summon Baiting
* The engine evaluates whether the player can activate high-tempo spells (*Bonfire*, *Emergency Teleport*, *Fiendsmith Engraver*, *Wanted*) to force out the opponent's 1-for-1 interruption *before* expending `gates.normal_summon_available`.
* Preserving the Normal Summon as an untouched pivot after opponent interaction yields a higher resilience rating.

### 6.3 The Adversarial Hand Trap Injection Matrix
For every candidate combo line, `ygo-sim-core` tests resilience by injecting standard competitive hand traps at each legal chokepoint $k$:
1. **Threat 1: *Ash Blossom & Joyous Spring*** $\to$ Injected at the first search/dump from Deck.
2. **Threat 2: *Infinite Impermanence* / *Effect Veiler*** $\to$ Injected on the Normal Summon on-field trigger.
3. **Threat 3: *Nibiru, the Primal Being*** $\to$ Injected immediately upon Summon #5.
4. **Threat 4: *Droll & Lock Bird*** $\to$ Injected immediately after the first card is added to hand.
5. **Threat 5: *Mulcharmy Fuwalos*** $\to$ Injected at Special Summon #1 from Deck/Extra Deck.

#### Resilience Metric Formulation:
For each threat $i$ injected at step $k$:
$$\text{Survival Ratio}_i = \frac{V(\text{YBN}_{\text{compromised}, i})}{V(\text{YBN}_{\text{ceiling}})}$$
$$\text{Net Hand Resilience} = \sum_{i=1}^{M} w_i \cdot \text{Survival Ratio}_i$$

---

## 7. Master YBN Valuation Function: Multi-Layer Interruption Accounting

The engine selects the most valuable terminal board state by executing the **Master YBN Valuation Function** $V(\text{YBN})$.

Rather than simply counting on-field monster negates, $V(\text{YBN})$ evaluates **Multi-Layer Zone Diversification**, **Anti-Board Breaker Resilience**, and **Turn 3 Follow-Up Recursion** (grounded in World Champion Joshua Schmidt's 7 Pillars and Jesse Kotton's principles).

### 7.1 Mathematical Formulation

$$V(\text{YBN}) = \sum_{i \in \text{Interactions}} Q(i) + \text{Bonus}_{\text{layers}} + \text{Val}_{\text{followup}} - \text{Pen}_{\text{blowout}} - \text{Pen}_{\text{draws}}$$

### 7.2 Component 1: Base Interruption Quality ($Q(i)$)
Every active disruption accessible during the opponent's turn is weighted by its mechanical efficacy:

| Interruption Category | Base Points ($Q$) | Rationale & Examples |
| :--- | :---: | :--- |
| **Summon Negate** | **+3.5** | Stops summons without starting a chain (*Solemn Judgment*, *King Caesar*). Dodges targeting immunity. |
| **Omni-Negate** | **+3.5** | Negates Monster, Spell, or Trap (*Baronne de Fleur*, *Borreload Savage Dragon*). |
| **Monster Negate (Quick)** | **+2.5** | Negates monster effect (*Apollousa*, *Crystal Wing*). |
| **Quick Spot Removal (Non-Target / Banish / Spin)** | **+2.5** | Premium interaction (*S:P Little Knight*, *Mirrorjade the Iceblade Dragon*). |
| **Quick Spot Removal (Target / Destroy)** | **+1.5** | Standard disruption (*Promethean Princess*, *R.B. VALCan Booster*). |
| **Spell / Trap Negate** | **+2.0** | Shields backrow (*Naturia Beast*, *Shi En*). |
| **Continuous Floodgate / Lock** | **+3.0** | Lingering restriction (*Abyss Dweller*, *Archnemeses Protos*). |
| **Searchable Hand Trap** | **+2.0** | Added to hand during combo (*Ash Blossom*, *Bystial Magnamhut*). |

---

### 7.3 Component 2: Multi-Layer Zone Diversification ($\text{Bonus}_{\text{layers}}$)
Top-tier tournament boards distribute interaction across multiple spatial zones to survive single-zone blowouts (*Dark Ruler No More*, *Raigeki*, *Lightning Storm*, *Evenly Matched*).

Let $\mathcal{Z}_{\text{active}} \subseteq \{ \text{FIELD\_M}, \text{BACKROW}, \text{GRAVEYARD}, \text{HAND}, \text{BANISHED} \}$ be the set of zones holding at least one verified point of interaction:

$$\text{Bonus}_{\text{layers}} = \begin{cases}
0.0 & \text{if } |\mathcal{Z}_{\text{active}}| = 1 \quad \text{(Fragile single-layer board)} \\
+1.5 & \text{if } |\mathcal{Z}_{\text{active}}| = 2 \quad \text{(Dual-layer resilience)} \\
+3.0 & \text{if } |\mathcal{Z}_{\text{active}}| \ge 3 \quad \text{(Elite multi-layer defense)}
\end{cases}$$

* **Example Dual-Layer:** Monster on Field (`M4`) + Set Counter Trap (`S2`).
* **Example Triple-Layer:** Monster on Field (`ER`) + GY Quick-Effect (`GY`) + Retained Hand Trap (`H`).

---

### 7.4 Component 3: Anti-Board Breaker Resilience Adjustments ($\text{Pen}_{\text{blowout}}$)
If a board concentrates 100% of its interaction on face-up monsters in the Main/Extra Monster Zones:
* **The *Dark Ruler No More* / *Forbidden Droplet* Vulnerability Penalty:**
  $$\text{Pen}_{\text{DRNM}} = -2.5 \quad \text{if all negates reside on } \text{FIELD\_M}$$
* **The *Evenly Matched* Vulnerability Penalty:**
  $$\text{Pen}_{\text{EVENLY}} = -2.0 \quad \text{if zero Spell/Trap or Omni-negates exist}$$
* **The *Super Polymerization* Clumping Penalty:**
  $$\text{Pen}_{\text{SUPERPOLY}} = -1.5 \quad \text{if } \ge 2 \text{ DARK or LIGHT monsters share field zones without protection}$$

If an end-board maintains interactions in the Graveyard (*Promethean Princess*) or Backrow (*Infinite Impermanence*), these penalties evaluate to **$0.0$** because the non-field layers remain 100% active.

---

### 7.5 Component 4: Turn 3 Follow-Up Recursion ($\text{Val}_{\text{followup}}$)
Winning a match requires closing the game on Turn 3. The engine rewards boards that do not exhaust their entire resource pool:
$$\text{Val}_{\text{followup}} = (0.8 \times N_{\text{cards\_in\_hand}}) + (1.5 \times N_{\text{GY\_recyclable\_starters}}) + (1.0 \times N_{\text{deck\_searches\_ready}})$$
* Expending 5 cards in hand to make 4 negates with 0 cards in hand and 0 GY triggers scores **lower** than 3 negates with +2 cards in hand and a guaranteed GY search loop.

---

### 7.6 Component 5: Conceded Draws Penalty ($\text{Pen}_{\text{draws}}$)
When evaluating playlines under lingering draw effects (*Mulcharmy Fuwalos* / *Maxx "C"*):
$$\text{Pen}_{\text{draws}} = 3.5 \times \max(0, N_{\text{SpecialSummons}} - 2)$$
This enforces the compromised fallback line, penalizing greedy 10-summon lines that draw the opponent into full board breakers.

---

## 8. Simulation Request/Response Architecture & System Ingestion

`ygo-sim-core` exposes its capabilities via two primary interfaces:
1. **Standardized Stdio MCP Server** (consumed by `obsidian-ygo-suite` and AI agents).
2. **Headless CLI Binary** (consumed by scripts, benchmarks, and external pipelines).

```text
       ┌────────────────────────┐      ┌────────────────────────┐
       │   obsidian-ygo-suite   │      │ Headless CI / Terminal │
       │  (AI Agent Reasoning)  │      │   (Batch Benchmarks)   │
       └───────────┬────────────┘      └───────────┬────────────┘
                   │                               │
       JSON-RPC over stdio (MCP)               CLI Args / STDIN
                   │                               │
                   ▼                               ▼
       ┌────────────────────────────────────────────────────────┐
       │                      ygo-sim-core                      │
       │              Request Ingestion Dispatcher              │
       ├────────────────────────────────────────────────────────┤
       │ 1. Ingest & Validate Input (.ydk, Hand, Flags)         │
       │ 2. Load Archetype Action DAG Definitions               │
       │ 3. Execute State Engine (Traversal / Monte Carlo)      │
       │ 4. Score Terminals via V(YBN) Engine                   │
       │ 5. Format & Serialize Response (JSON / YBN / YGN)      │
       └────────────────────────────────────────────────────────┘
```

### 8.1 The 4 Core MCP Tool Interfaces

#### Tool 1: `simulate_test_hands`
Conducts Monte Carlo goldfishing across 1,000 to 10,000 simulated hands drawn from a `.ydk` decklist.

* **Input Request:**
```json
{
  "deck_ydk": "#main\n67234805\n67234805\n...",
  "sample_size": 5000,
  "hand_size": 5,
  "target_archetype": "Infinitrack"
}
```
* **Output Response:**
```json
{
  "total_simulations": 5000,
  "uninterrupted_combo_rate": 0.892,
  "brick_rate": 0.038,
  "average_ybn_score": 8.74,
  "interruption_distribution": {
    "0_disruptions": 0.038,
    "1_to_2_disruptions": 0.142,
    "3_to_4_disruptions": 0.584,
    "5_plus_disruptions": 0.236
  },
  "average_multi_layer_score": 2.4,
  "detected_infinite_loops": 0
}
```

---

#### Tool 2: `explore_combo_tree`
Evaluates a specific 5-card opening hand and returns the top $N$ optimal playlines ranked by $V(\text{YBN})$.

* **Input Request:**
```json
{
  "hand": ["Infinitrack Harvester", "Exceptional Schedule", "Urgent Schedule", "Dominus Purge", "Called by the Grave"],
  "deck_ydk": "#main\n...",
  "max_depth": 10,
  "branch_limit": 3
}
```
* **Output Response:**
```json
{
  "hand_analyzed": ["Infinitrack Harvester", "Exceptional Schedule", "Urgent Schedule", "Dominus Purge", "Called by the Grave"],
  "nodes_evaluated": 312,
  "unique_ybn_endpoints": 5,
  "top_lines": [
    {
      "rank": 1,
      "branch_type": "PROBING_AND_BAIT",
      "ybn_score": 10.2,
      "early_insulation_secured": true,
      "terminal_ybn": "T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],M4[#e2:River Stormer(atk){#3}],S2[#5:Purge(set)],S3[#6:Called(set)],GY:[#4:Harvester,#3:Blue Traveler,#1:Exceptional,#2:Urgent],H:2,D:34,ED:13|P2:M3[Token(def)],H:5,D:35,ED:15|G:NS=1",
      "ygn_path": "T1: P1 vs AI\n@M1\n  [C1: A(H)[#1:Exceptional]>S3 // R1: +H[#2:Urgent]<D, S[Token]>o.M3, [#1]>GY]\n  [C1: A(H)[#2:Urgent]>S3 // R1: S[#3:Blue Traveler](def)>M4<D, S[#4:Harvester](def)>M3<D, [#2]>GY]\n  L[#4:M3 + #3:M4]>ER[#e1:Genius](atk)<ED\n  SET[#5:Purge]>S2\n  SET[#6:Called]>S3",
      "interruption_breakdown": {
        "field_negates": 1,
        "backrow_disruptions": 2,
        "gy_triggers": 1,
        "hand_traps": 0,
        "distinct_layers": 3
      },
      "resources_remaining": {
        "hand_count": 2,
        "normal_summon_used": false,
        "gy_count": 4,
        "deck_count": 34
      }
    }
  ]
}
```

---

#### Tool 3: `evaluate_handtrap_resilience`
Injects competitive hand traps at each chokepoint of the optimal line and returns the fallback survival matrix.

* **Input Request:**
```json
{
  "hand": ["Infinitrack Harvester", "Heavy Forward", "Infinitrack Trencher", "Ash Blossom", "Crossout Designator"],
  "deck_ydk": "#main\n...",
  "threat_suite": ["Ash Blossom & Joyous Spring", "Infinite Impermanence", "Nibiru, the Primal Being", "Droll & Lock Bird"]
}
```
* **Output Response:**
```json
{
  "ceiling_ybn_score": 9.8,
  "resilience_matrix": [
    {
      "threat": "Ash Blossom & Joyous Spring on Harvester Search",
      "step_injected": 2,
      "protected_by_insulation": true,
      "insulation_card_used": "Crossout Designator",
      "fallback_ybn_score": 9.8,
      "survival_ratio": 1.0,
      "chokepoint_severity": "Low"
    },
    {
      "threat": "Nibiru, the Primal Being at Summon 5",
      "step_injected": 5,
      "protected_by_insulation": false,
      "fallback_ybn_score": 5.2,
      "survival_ratio": 0.53,
      "compromised_endpoint": "T1|M1|LP8000:8000|P1:M1[Token(def)],GY:[...],H:2|P2:M2[#o1:Nibiru(atk)],H:4|G:NS=0",
      "chokepoint_severity": "High"
    }
  ],
  "composite_resilience_rating": "A-"
}
```

---

#### Tool 4: `score_ybn_state`
Takes any arbitrary RFC 0001 YBN snapshot and decomposes it into granular $V(\text{YBN})$ metrics.

* **Input Request:**
```json
{
  "ybn": "T1|M1|LP8000:8000|P1:ER[#e1:Genius(atk)],M4[#e2:River Stormer(atk){#3}],S2[#5:Purge(set)],GY:[#4:Harvester,#3:Blue Traveler,#1:Exceptional,#2:Urgent],H:2,D:34,ED:13|P2:M3[Token(def)],H:5|G:NS=1"
}
```
* **Output Response:**
```json
{
  "total_score": 9.7,
  "breakdown": {
    "base_interruptions": {
      "omni_negates": 0,
      "monster_negates": 1,
      "spell_trap_negates": 0,
      "quick_removals": 1,
      "backrow_negates": 1,
      "subtotal": 5.5
    },
    "layer_diversification": {
      "active_layers": ["FIELD", "BACKROW", "GRAVEYARD"],
      "bonus_applied": 3.0
    },
    "followup_recursion": {
      "hand_count": 2,
      "normal_summon_preserved": true,
      "recyclable_gy_loopers": 1,
      "subtotal": 2.2
    },
    "blowout_vulnerabilities": {
      "dark_ruler_vulnerable": false,
      "evenly_matched_vulnerable": false,
      "penalties_applied": 0.0
    }
  }
}
```

---

## 9. Phased Step-by-Step Implementation Roadmap for `ygo-sim-core`

```text
Phase 0: Toolchain & Repository Scaffolding
   │
Phase 1: 14-Zone State Model & RFC 0001 Parser
   │
Phase 2: Fast Effect State Machine & Priority Sequencer
   │
Phase 3: Declarative Card DSL & Archetype Action DAG Loader
   │
Phase 4: Combinatorial Graph Traversal & Transposition Pruning
   │
Phase 5: Adversarial Hand Trap Injection & Early Insulation Evaluator
   │
Phase 6: Master Multi-Layer V(YBN) Valuation Engine
   │
Phase 7: Headless CLI, MCP Server Packaging & Monorepo Validation
```

---

### Phase 0: Toolchain & Repository Scaffolding (Sprint 1)
* **Goal:** Initialize `ygo-sim-core` repository with modern, high-velocity infrastructure.
* **Tech Stack:** TypeScript / Node.js 22 LTS (ESM), Vitest test runner, `@modelcontextprotocol/sdk`.
* **Tasks:**
  1. Configure `package.json`, `tsconfig.json` with strict type checking (`noImplicitAny`, `strictNullChecks`).
  2. Setup linting and formatting via Prettier and ESLint.
  3. Create directory layout:
     ```text
     ygo-sim-core/
     ├── bin/                  # CLI launcher
     ├── data/
     │   └── archetypes/       # Declarative JSON/YAML archetype DAGs
     ├── src/
     │   ├── dsl/              # Card DSL parsers & validation
     │   ├── engine/           # State transitions, phase machine, SEGOC
     │   ├── evaluator/        # V(YBN) multi-layer scoring formulas
     │   ├── mcp/              # MCP server & JSON-RPC tools
     │   ├── notation/         # YBN / YGN serializers
     │   ├── search/           # Graph traversal, transposition cache, MCTS
     │   └── types/            # Core TypeScript interfaces
     └── test/                 # Vitest test suites
     ```
* **Acceptance Criteria:** `npm test` runs in $<500\text{ms}$ with zero errors.

---

### Phase 1: 14-Zone State Model & RFC 0001 Parser (Sprint 1–2)
* **Goal:** Implement the immutable 14-zone memory model and bidirectional YBN/YGN parsing.
* **Tasks:**
  1. Author `src/types/state.ts` defining all zones, LP, Gates, Registers, and Flags.
  2. Implement `src/notation/ybnSerializer.ts` converting state $S \to \text{YBN}$ and $\text{YBN} \to S$.
  3. Implement `src/engine/hasher.ts` computing canonical 64-bit state hashes.
  4. Write unit tests round-tripping complex board states from `duel_log_example.txt`.
* **Acceptance Criteria:** 100% fidelity on YBN serialization round-trips; hash collision rate $0\%$ across 100,000 synthetic state mutations.

---

### Phase 2: Fast Effect State Machine & Priority Sequencer (Sprint 2)
* **Goal:** Model the official Konami Fast Effect Timing Chart and SEGOC chain builder.
* **Tasks:**
  1. Implement `src/engine/phaseMachine.ts` advancing phases (`DP` $\to$ `SP` $\to$ `M1` $\to$ `BP` $\to$ `M2` $\to$ `EP`).
  2. Implement Box A, B, C, D, E state progression in `src/engine/fastEffectEngine.ts`.
  3. Codify SEGOC hierarchy (Mandatory P1 $\to$ Mandatory P2 $\to$ Optional P1 $\to$ Optional P2) in `src/engine/segoc.ts`.
  4. Codify conjunction truth table (`then`, `and if you do`, `also`, `and`) in `src/engine/conjunctions.ts`.
* **Acceptance Criteria:** Unit tests verifying that optional triggers miss timing under "then" conjunctions and that chain blocking successfully prevents fast effect targeting.

---

### Phase 3: Declarative Card DSL & Archetype Action DAG Loader (Sprint 3)
* **Goal:** Author and validate the declarative card schema and ingest archetype files.
* **Tasks:**
  1. Author `src/dsl/cardSchema.ts` and Zod validation rules.
  2. Implement card loader `src/dsl/archetypeLoader.ts` reading JSON archetype specifications.
  3. Implement atomic resolution primitives (`SEARCH`, `SPECIAL_SUMMON`, `MILL`, `ATTACH`, `NEGATE`).
  4. Encode baseline archetypes:
     - Machine / Earth Machine (Harvester, Urgent Schedule, River Stormer, Qliphort Genius).
     - Standard Hand Traps (Ash Blossom, Infinite Impermanence, Nibiru).
     - Early Protection / Bosses (Baronne de Fleur, D/D/D Wave High King Caesar, Called by the Grave).
* **Acceptance Criteria:** All baseline cards pass schema validation and execute their costs and effects deterministically.

---

### Phase 4: Combinatorial Graph Traversal & Transposition Pruning (Sprint 3–4)
* **Goal:** Build the legal action discovery engine and directed graph traversal.
* **Tasks:**
  1. Implement `src/engine/actionDiscovery.ts` scanning active zones for legal actions.
  2. Implement `src/search/treeTraversal.ts` exploring paths up to configurable `max_depth`.
  3. Implement `src/search/transpositionTable.ts` caching visited states by `Hash(S)`.
  4. Implement `src/search/cycleDetector.ts` flagging cyclic loops ($YBN_t == YBN_{t-k}$).
  5. Implement Monte Carlo sampler shuffling `.ydk` decklists for 10,000 hands.
* **Acceptance Criteria:** 10,000-hand Monte Carlo executes in $<2.5\text{ seconds}$; infinite loop combos cleanly abort with `CYCLE_DETECTED`.

---

### Phase 5: Adversarial Hand Trap Injection & Early Insulation Evaluator (Sprint 4)
* **Goal:** Stress-test combo paths against simulated opponent interactions.
* **Tasks:**
  1. Implement `src/engine/insulationEvaluator.ts` checking for active negates prior to Summon #5 or prior to Normal Summon.
  2. Implement `src/engine/interruptionInjector.ts` simulating opponent responses (Ash, Imperm, Nibiru, Droll, Fuwalos) at Step $k$.
  3. Calculate survival ratios and build fallback subtree branches (Branch C).
* **Acceptance Criteria:** Test suite confirms that an opening hand with *Called by the Grave* + starter produces 100% resilience against *Ash Blossom*, and lines summoning *Baronne* at Summon #4 survive *Nibiru*.

---

### Phase 6: Master Multi-Layer $V(\text{YBN})$ Valuation Engine (Sprint 5)
* **Goal:** Implement the multi-factor scoring formula grounded in competitive tournament theory.
* **Tasks:**
  1. Implement `src/evaluator/boardScorer.ts` evaluating base points, layer bonuses, and recursion values.
  2. Implement blowout vulnerability audits (Dark Ruler, Evenly Matched, Super Poly).
  3. Implement conceded draw penalties under Fuwalos/Maxx "C".
* **Acceptance Criteria:** Multi-layer end-boards (Field + Backrow + GY) mathematically outscore glass-cannon single-layer boards; pure monster boards incur verified Dark Ruler penalties.

---

### Phase 7: Headless CLI, MCP Server Packaging & Monorepo Validation (Sprint 5–6)
* **Goal:** Package the engine as a standalone CLI and stdio MCP server for agent integration.
* **Tasks:**
  1. Author `bin/ygo-sim-core.ts` providing command-line arguments (`--deck`, `--monte-carlo`, `--hand`, `--resilience`).
  2. Author `src/mcp/server.ts` registering the 4 tools (`simulate_test_hands`, `explore_combo_tree`, `evaluate_handtrap_resilience`, `score_ybn_state`).
  3. Author integration tests connecting `obsidian-ygo-suite` agents (`ygo-pilot`, `ygo-deck-architect`) to the running MCP server.
* **Acceptance Criteria:** Air-gapped, zero-network execution; response times $<100\text{ms}$ per combo tree inquiry; zero regression to `obsidian-ygo-suite` CI.

---

## 10. Bootstrap Starter Artifacts Catalog

To enable immediate initialization of the new repository, the accompanying bootstrap bundle provides production-ready starter files in `reports/architecture/ygo-sim-core-bootstrap/`:

1. **`README.md`**: Complete repository documentation, installation, CLI commands, and MCP configuration.
2. **`package.json`**: Package manifest with scripts, TypeScript 5.8+, Vitest, and MCP SDK dependencies.
3. **`tsconfig.json`**: Hardened ESM TypeScript configuration.
4. **`src/types/state.ts`**: Complete TypeScript interfaces for the 14-zone board model, gates, and RFC 0001 YBN serialization.
5. **`src/types/card-dsl.ts`**: Complete TypeScript definitions for the Declarative Card DSL, actions, and interruption tags.
6. **`src/types/mcp-contracts.ts`**: Immutable JSON-RPC schemas and TypeScript types for the 4 MCP tools.
7. **`data/archetypes/sample_archetype.json`**: Battle-tested sample archetype dataset modeling starters, extenders, bosses, and hand traps.

This architectural blueprint and bootstrap package guarantee a clean, decoupled foundation for `ygo-sim-core`, bringing tournament-grade deterministic simulation to the competitive Yu-Gi-Oh! ecosystem.
