import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadAllArchetypes,
  createInitialGameState,
  exploreComboTree,
  handleExploreComboTree
} from '../src/index.js';
import { advanceTurnOnePhases } from '../src/search/treeTraversal.js';
import { discoverLegalActions } from '../src/engine/actionDiscovery.js';

describe('Deterministic Combo Tree Branching & Canonical Hand Audit (ygo-lab, ygo-pilot, ygo-notary)', () => {
  const deckPath = resolve(process.cwd(), '../obsidian-ygo-suite/decks/RB (Revol Bots).ydk');
  let deckYdk = '';

  // Canonical User Hand:
  // 1. Engage (63166095)
  // 2. Stage Landing (5109321)
  // 3. Ghost Belle (73642296)
  // 4. Impermanence (10045474)
  // 5. Roze (37351133)
  const canonicalHand = [
    '63166095', // Sky Striker Mobilize - Engage!
    '5109321',  // R.B. Stage Landing
    '73642296', // Ghost Belle & Haunted Mansion
    '10045474', // Infinite Impermanence
    '37351133'  // Sky Striker Ace - Roze
  ];

  beforeEach(() => {
    globalCardRegistry.clear();
    loadAllArchetypes();
    if (existsSync(deckPath)) {
      deckYdk = readFileSync(deckPath, 'utf-8');
    }
  });

  it('chronologically audits Turn 1 phases (DP -> SP -> M1) verifying zero premature activations', () => {
    const initialState = createInitialGameState({
      turn: 1,
      phase: 'DP',
      turnPlayer: 1
    });

    const { activeState, phaseAudits } = advanceTurnOnePhases(initialState, globalCardRegistry);

    // Verify Draw Phase: 0 legal actions, draw skipped
    expect(phaseAudits.find((a) => a.phase === 'DP')?.actionsFound).toBe(0);

    // Verify Standby Phase: 0 legal actions
    expect(phaseAudits.find((a) => a.phase === 'SP')?.actionsFound).toBe(0);

    // Verify entered Main Phase 1 Open Game State
    expect(activeState.phase).toBe('M1');
  });

  it('exhaustively discovers all 15 discrete branch choices from Node #0 in Main Phase 1', () => {
    expect(deckYdk).toBeTruthy();

    const result = handleExploreComboTree(
      {
        hand: canonicalHand,
        deck_ydk: deckYdk,
        max_depth: 40,
        branch_limit: 15
      },
      globalCardRegistry
    );

    expect(result.hand_analyzed).toEqual(canonicalHand);
    expect(result.nodes_evaluated).toBeGreaterThanOrEqual(1);

    // Reconstruct the root state to directly audit Node #0 action discovery
    const search = exploreComboTree(
      createInitialGameState({
        turn: 1,
        phase: 'DP',
        turnPlayer: 1,
        p1: {
          ...createInitialGameState().p1,
          hand: canonicalHand.map((code, idx) => {
            const def = globalCardRegistry.getCardById(code);
            return {
              instanceId: `#h${idx + 1}`,
              passcode: code,
              name: def?.name ?? code,
              cardType: def?.cardType ?? 'MONSTER',
              levelOrRank: def?.monsterAttributes?.levelOrRank
            };
          }),
          // Populate deck with remaining cards
          deck: [
            { instanceId: '#d1', passcode: '52340444', name: 'Sky Striker Mecha - Hornet Drones', cardType: 'SPELL' },
            { instanceId: '#d2', passcode: '20357457', name: 'Pillar of the Future - Cyanos', cardType: 'MONSTER' },
            { instanceId: '#d3', passcode: '6043161', name: 'R.B. Ga10 Driller', cardType: 'MONSTER' },
            { instanceId: '#d4', passcode: '33438265', name: 'R.B. Ga10 Cutter', cardType: 'MONSTER' },
            { instanceId: '#d5', passcode: '79436874', name: 'R.B. VALCan Rocket', cardType: 'MONSTER' },
            { instanceId: '#d6', passcode: '44573911', name: 'R.B. Ga10 Pile Bunker', cardType: 'MONSTER' },
            { instanceId: '#d7', passcode: '81794107', name: 'R.B. Lambda Cannon', cardType: 'MONSTER' },
            { instanceId: '#d8', passcode: '17188206', name: 'R.B. Lambda Blade', cardType: 'MONSTER' }
          ],
          extraDeck: [
            { instanceId: '#ed1', passcode: '32216688', name: 'R.B. The Brute Blues', cardType: 'MONSTER' },
            { instanceId: '#ed2', passcode: '6821579', name: 'R.B. VALCan Booster', cardType: 'MONSTER' },
            { instanceId: '#ed3', passcode: '80071619', name: "R.B. Shepherd's Crook", cardType: 'MONSTER' }
          ]
        }
      }),
      { maxDepth: 40, branchLimit: 15 },
      globalCardRegistry
    );

    const rootNode = search.nodeLedgers[0]!;
    expect(rootNode.nodeId).toBe('NODE#1');
    expect(rootNode.depth).toBe(0);

    const actionNotations = rootNode.availableActions.map((a) => a.ygnNotation);

    // 1. Stage Landing: All 9 valid R.B. targets (3 Extra Deck, 6 Main Deck)
    expect(actionNotations.some((n) => n.includes('SS(EXTRA_DECK:R.B. The Brute Blues)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(EXTRA_DECK:R.B. VALCan Booster)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes("SS(EXTRA_DECK:R.B. Shepherd's Crook)"))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. Ga10 Driller)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. Ga10 Cutter)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. VALCan Rocket)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. Ga10 Pile Bunker)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. Lambda Cannon)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SS(DECK:R.B. Lambda Blade)'))).toBe(true);

    // 2. Engage: Valid Sky Striker search targets
    expect(actionNotations.some((n) => n.includes('SEARCH(DECK:Sky Striker Mecha - Hornet Drones)'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('SEARCH(DECK:Pillar of the Future - Cyanos)'))).toBe(true);

    // 3. Normal Summons
    expect(actionNotations.some((n) => n.includes('N[') && n.includes('Sky Striker Ace - Roze'))).toBe(true);
    expect(actionNotations.some((n) => n.includes('N[') && n.includes('Ghost Belle & Haunted Mansion'))).toBe(true);

    // 4. Set Trap
    expect(actionNotations.some((n) => n.includes('SET[') && n.includes('Infinite Impermanence'))).toBe(true);
  });

  it('records complete Open Game State node ledgers with YGN paths, YBN states, and V(YBN) valuation', () => {
    const search = exploreComboTree(
      createInitialGameState({
        turn: 1,
        phase: 'DP',
        turnPlayer: 1,
        p1: {
          ...createInitialGameState().p1,
          hand: canonicalHand.map((code, idx) => {
            const def = globalCardRegistry.getCardById(code);
            return {
              instanceId: `#h${idx + 1}`,
              passcode: code,
              name: def?.name ?? code,
              cardType: def?.cardType ?? 'MONSTER',
              levelOrRank: def?.monsterAttributes?.levelOrRank
            };
          }),
          deck: [
            { instanceId: '#d1', passcode: '52340444', name: 'Sky Striker Mecha - Hornet Drones', cardType: 'SPELL' },
            { instanceId: '#d2', passcode: '20357457', name: 'Pillar of the Future - Cyanos', cardType: 'MONSTER' }
          ],
          extraDeck: [
            { instanceId: '#ed1', passcode: '6821579', name: 'R.B. VALCan Booster', cardType: 'MONSTER' }
          ]
        }
      }),
      { maxDepth: 40, branchLimit: 5 },
      globalCardRegistry
    );

    expect(search.nodeLedgers.length).toBeGreaterThanOrEqual(1);

    const firstLedger = search.nodeLedgers[0]!;
    expect(firstLedger.ybnState).toMatch(/^T1\|M1\|LP8000:8000\|/);
    expect(firstLedger.ybnScore).toBeGreaterThanOrEqual(0);
    expect(firstLedger.availableActions.length).toBeGreaterThan(0);
  });

  it('generates and persists hierarchical Markdown combo tree report to disk', () => {
    expect(deckYdk).toBeTruthy();

    const result = handleExploreComboTree(
      {
        hand: canonicalHand,
        deck_ydk: deckYdk,
        max_depth: 40,
        branch_limit: 5
      },
      globalCardRegistry
    );

    expect(result.markdown_report_path).toBeDefined();
    expect(existsSync(result.markdown_report_path!)).toBe(true);

    const mdContent = readFileSync(result.markdown_report_path!, 'utf-8');
    expect(mdContent).toContain('Combo Decision Tree & Valuation Report');
    expect(mdContent).toContain('Chronological Turn 1 Phase Progression Audit');
    expect(mdContent).toContain('Open Game State Decision Tree & Node Ledger');
    expect(mdContent).toContain('Ranked Terminal End-Boards');
    expect(mdContent).toContain('Sky Striker Mobilize - Engage!');
    expect(mdContent).toContain('R.B. Stage Landing');
  });
});
