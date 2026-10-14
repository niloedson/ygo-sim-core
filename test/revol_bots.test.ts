import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  globalCardRegistry,
  loadArchetype,
  loadAllArchetypes,
  validateArchetypeDAG,
  createInitialGameState,
  scoreGameState,
  auditInsulation
} from '../src/index.js';

describe('Revol Bots Archetype & Modular Staples Architecture (ygo-lab, ygo-judge, ygo-pilot, ygo-deck-architect)', () => {
  const archetypesDir = resolve(process.cwd(), 'data/archetypes');

  beforeEach(() => {
    globalCardRegistry.clear();
  });

  it('validates revol_bots.json encapsulates core R.B., Sky Striker splash, and Machine support', () => {
    const revolPath = resolve(archetypesDir, 'revol_bots.json');
    expect(existsSync(revolPath)).toBe(true);

    const revolDag = validateArchetypeDAG(JSON.parse(readFileSync(revolPath, 'utf-8')));
    expect(revolDag.archetypeName).toBe('RB_Revol_Bots');
    expect(revolDag.cards.length).toBe(29); // 14 R.B. Core + 10 Sky Striker + 5 Machine Support

    // Starters specifically tuned for Revol Bots lines
    expect(revolDag.standardStarters).toEqual([
      '5109321',  // R.B. Stage Landing (STARTER_SS)
      '78710386', // R.B. Funk Dock (STARTER_SS)
      '73628505', // Terraforming (STARTER_SS)
      '20357457', // Pillar of the Future - Cyanos (STARTER_NS)
      '63166095', // Sky Striker Mobilize - Engage! (STARTER_SS)
      '52340444'  // Sky Striker Mecha - Hornet Drones (STARTER_SS)
    ]);

    // Primary Extenders
    expect(revolDag.primaryExtenders.length).toBe(10);
    expect(revolDag.primaryExtenders).toContain('44573911'); // Pile Bunker
    expect(revolDag.primaryExtenders).toContain('33438265'); // Cutter
    expect(revolDag.primaryExtenders).toContain('37351133'); // Roze
    expect(revolDag.primaryExtenders).toContain('10604644'); // Regulus

    // In-Engine & Splash Insulation Targets
    expect(revolDag.insulationTargets).toEqual([
      '10604644', // Regulus (Omni-negate Machine boss)
      '79859067', // Next Phase (Counter Trap)
      '33438265', // Cutter (Quick Effect Spell/Trap negate)
      '25072579'  // Amatsu (Effect redirection)
    ]);

    // Verify Cyanos role is specifically STARTER_NS within Revol Bots
    const cyanos = revolDag.cards.find((c) => c.id === '20357457');
    expect(cyanos?.taxonomyRole).toBe('STARTER_NS');
  });

  it('validates the 3 universal staple datasets (Hand Traps, Breakers, Defensive)', () => {
    // 1. staples_hand_traps.json (8 Cards)
    const htPath = resolve(archetypesDir, 'staples_hand_traps.json');
    expect(existsSync(htPath)).toBe(true);
    const htDag = validateArchetypeDAG(JSON.parse(readFileSync(htPath, 'utf-8')));
    expect(htDag.archetypeName).toBe('Staples_Hand_Traps');
    expect(htDag.cards.length).toBe(8);
    expect(htDag.cards.every((c) => c.taxonomyRole === 'TECH_HANDTRAP')).toBe(true);
    expect(htDag.cards.map((c) => c.name)).toContain('Ash Blossom & Joyous Spring');
    expect(htDag.cards.map((c) => c.name)).toContain('Mulcharmy Fuwalos');
    expect(htDag.cards.map((c) => c.name)).toContain('Infinite Impermanence');

    // 2. staples_board_breakers.json (3 Cards)
    const breakerPath = resolve(archetypesDir, 'staples_board_breakers.json');
    expect(existsSync(breakerPath)).toBe(true);
    const breakerDag = validateArchetypeDAG(JSON.parse(readFileSync(breakerPath, 'utf-8')));
    expect(breakerDag.archetypeName).toBe('Staples_Board_Breakers');
    expect(breakerDag.cards.length).toBe(3);
    expect(breakerDag.cards.every((c) => c.taxonomyRole === 'TECH_BREAKER')).toBe(true);
    expect(breakerDag.cards.map((c) => c.name)).toContain('Forbidden Droplet');
    expect(breakerDag.cards.map((c) => c.name)).toContain('Lightning Storm');
    expect(breakerDag.cards.map((c) => c.name)).toContain('Triple Tactics Talent');

    // 3. staples_defensive.json (2 Cards)
    const defPath = resolve(archetypesDir, 'staples_defensive.json');
    expect(existsSync(defPath)).toBe(true);
    const defDag = validateArchetypeDAG(JSON.parse(readFileSync(defPath, 'utf-8')));
    expect(defDag.archetypeName).toBe('Staples_Defensive');
    expect(defDag.cards.length).toBe(2);
    expect(defDag.cards.every((c) => c.taxonomyRole === 'TECH_DEFENSIVE')).toBe(true);
    expect(defDag.insulationTargets).toEqual(['24224830', '41420027']); // Called by the Grave, Solemn Judgment
  });

  it('verifies loadAllArchetypes seamlessly registers all 42 tournament cards from RB deck', () => {
    const loadedCount = loadAllArchetypes(archetypesDir);
    expect(loadedCount).toBeGreaterThanOrEqual(4); // revol_bots + 3 staples + sample

    const allCards = globalCardRegistry.getAllCards();
    expect(allCards.length).toBeGreaterThanOrEqual(42);

    // Verify retrieval across all integrated categories
    expect(globalCardRegistry.getCardByName('R.B. The Brute Blues')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Pillar of the Future - Cyanos')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Sky Striker Ace - Kagari')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Therion "King" Regulus')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Clockwork Knight')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Ash Blossom & Joyous Spring')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Forbidden Droplet')).toBeDefined();
    expect(globalCardRegistry.getCardByName('Called by the Grave')).toBeDefined();
  });

  it('audits Link monsters for accurate Link Ratings, Link Arrows, and undefined DEF', () => {
    loadAllArchetypes(archetypesDir);

    const bruteBlues = globalCardRegistry.getCardByName('R.B. The Brute Blues');
    expect(bruteBlues?.monsterAttributes?.linkRating).toBe(3);
    expect(bruteBlues?.monsterAttributes?.linkArrows).toEqual(['BL', 'B', 'BR']);
    expect(bruteBlues?.monsterAttributes?.def).toBeUndefined();
    expect(bruteBlues?.monsterAttributes?.levelOrRank).toBe(0);

    const booster = globalCardRegistry.getCardByName('R.B. VALCan Booster');
    expect(booster?.monsterAttributes?.linkRating).toBe(2);
    expect(booster?.monsterAttributes?.linkArrows).toEqual(['T', 'B']);

    const crook = globalCardRegistry.getCardByName("R.B. Shepherd's Crook");
    expect(crook?.monsterAttributes?.linkRating).toBe(3);
    expect(crook?.monsterAttributes?.linkArrows).toEqual(['L', 'B', 'BR']);

    const knight = globalCardRegistry.getCardByName('Clockwork Knight');
    expect(knight?.monsterAttributes?.linkRating).toBe(1);
    expect(knight?.monsterAttributes?.linkArrows).toEqual(['L']);

    const kagari = globalCardRegistry.getCardByName('Sky Striker Ace - Kagari');
    expect(kagari?.monsterAttributes?.linkRating).toBe(1);
    expect(kagari?.monsterAttributes?.linkArrows).toEqual(['TL']);

    const shizuku = globalCardRegistry.getCardByName('Sky Striker Ace - Shizuku');
    expect(shizuku?.monsterAttributes?.linkRating).toBe(1);
    expect(shizuku?.monsterAttributes?.linkArrows).toEqual(['TR']);

    const hayate = globalCardRegistry.getCardByName('Sky Striker Ace - Hayate');
    expect(hayate?.monsterAttributes?.linkRating).toBe(1);
    expect(hayate?.monsterAttributes?.linkArrows).toEqual(['BL']);

    const amatsu = globalCardRegistry.getCardByName('Prototype Sky Striker Ace - Amatsu');
    expect(amatsu?.monsterAttributes?.linkRating).toBe(1);
    expect(amatsu?.monsterAttributes?.linkArrows).toEqual(['B']);
  });

  it('validates comprehensive interruption profiles across all 4 operational layers (V(YBN))', () => {
    loadAllArchetypes(archetypesDir);

    // Hand Layer
    const ash = globalCardRegistry.getCardByName('Ash Blossom & Joyous Spring');
    expect(ash?.effects[0]?.interruptionProfile?.layer).toBe('HAND');
    expect(ash?.effects[0]?.interruptionProfile?.kind).toBe('MONSTER_NEGATE');

    const fuwalos = globalCardRegistry.getCardByName('Mulcharmy Fuwalos');
    expect(fuwalos?.effects[0]?.interruptionProfile?.layer).toBe('HAND');
    expect(fuwalos?.effects[0]?.interruptionProfile?.kind).toBe('FLOODGATE');

    // Backrow Layer
    const imperm = globalCardRegistry.getCardByName('Infinite Impermanence');
    expect(imperm?.effects[0]?.interruptionProfile?.layer).toBe('BACKROW');
    expect(imperm?.effects[0]?.interruptionProfile?.kind).toBe('MONSTER_NEGATE');

    const nextPhase = globalCardRegistry.getCardByName('R.B. Next Phase');
    expect(nextPhase?.effects[0]?.interruptionProfile?.layer).toBe('BACKROW');
    expect(nextPhase?.effects[0]?.interruptionProfile?.kind).toBe('MONSTER_NEGATE');
    expect(nextPhase?.effects[0]?.spellSpeed).toBe(3);

    const cbg = globalCardRegistry.getCardByName('Called by the Grave');
    expect(cbg?.effects[0]?.interruptionProfile?.layer).toBe('BACKROW');
    expect(cbg?.effects[0]?.interruptionProfile?.removalType).toBe('BANISH');

    // Field Layer
    const regulus = globalCardRegistry.getCardByName('Therion "King" Regulus');
    expect(regulus?.effects[1]?.interruptionProfile?.layer).toBe('FIELD');
    expect(regulus?.effects[1]?.interruptionProfile?.kind).toBe('OMNI_NEGATE');

    const cutter = globalCardRegistry.getCardByName('R.B. Ga10 Cutter');
    expect(cutter?.effects[1]?.interruptionProfile?.layer).toBe('FIELD');
    expect(cutter?.effects[1]?.interruptionProfile?.kind).toBe('SPELL_TRAP_NEGATE');

    // Graveyard Layer
    const lastStand = globalCardRegistry.getCardByName('R.B. Last Stand');
    expect(lastStand?.effects[1]?.interruptionProfile?.layer).toBe('GRAVEYARD');
    expect(lastStand?.effects[1]?.interruptionProfile?.kind).toBe('MONSTER_NEGATE');
  });

  it('successfully scores multi-layer Revol Bots end-board under boardScorer with consolidated engine', () => {
    loadAllArchetypes(archetypesDir);

    // Realistic Revol Bots endboard:
    // Field: Shepherd's Crook + Regulus
    // Backrow: Set R.B. Next Phase + Set Called by the Grave
    // Hand: Ash Blossom
    const gameState = createInitialGameState({
      gates: {
        normalSummonAvailable: false,
        specialSummonCount: 3, // 1 (NS) + 3 (SS) = 4 <= 4 (Nibiru safe)
        attacksDeclared: 0
      },
      p1: {
        ...createInitialGameState().p1,
        monsters: {
          M1: {
            instanceId: '#reg1',
            passcode: '10604644',
            name: 'Therion "King" Regulus',
            cardType: 'MONSTER'
          }
        },
        extraMonsters: {
          EM: {
            instanceId: '#crook1',
            passcode: '80071619',
            name: "R.B. Shepherd's Crook",
            cardType: 'MONSTER'
          }
        },
        spells: {
          S1: {
            instanceId: '#np1',
            passcode: '79859067',
            name: 'R.B. Next Phase',
            cardType: 'TRAP',
            spellTrapState: 'set'
          },
          S2: {
            instanceId: '#cbg1',
            passcode: '24224830',
            name: 'Called by the Grave',
            cardType: 'SPELL',
            spellTrapState: 'set'
          }
        },
        hand: [
          {
            instanceId: '#ash1',
            passcode: '14558127',
            name: 'Ash Blossom & Joyous Spring',
            cardType: 'MONSTER'
          }
        ]
      }
    });

    const score = scoreGameState(gameState);
    expect(score.total_score).toBeGreaterThan(5.0);
    expect(score.breakdown.layer_diversification.active_layers).toContain('FIELD');
    expect(score.breakdown.layer_diversification.active_layers).toContain('BACKROW');
    expect(score.breakdown.layer_diversification.active_layers).toContain('HAND');
    expect(score.breakdown.layer_diversification.bonus_applied).toBe(3.0);

    // Insulation Audit: Regulus is an omni-negate deployed at Summon <= 4 -> Nibiru Secured!
    const insulation = auditInsulation(gameState);
    expect(insulation.nibiruSecured).toBe(true);
    expect(insulation.activeOmniNegates).toBe(1);
    expect(insulation.handProtectionCards).toContain('Called by the Grave');
  });
});
