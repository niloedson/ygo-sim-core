import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import {
  globalCardRegistry,
  loadArchetype,
  getCard,
  validateCardDefinition,
  validateArchetypeDAG,
  createInitialGameState,
  applySearch,
  applySpecialSummon,
  applyMill,
  applyAttachMaterial,
  applyCost,
  canPayCost,
  checkConditions,
  findAvailableMMZ,
  findAvailableEMZ,
  initOpenGameState,
  addChainLink
} from '../src/index.js';

describe('Phase 3: Declarative Card DSL & Archetype Action DAG Loader', () => {
  const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

  beforeEach(() => {
    globalCardRegistry.clear();
  });

  describe('3.1 Schema Validation & Archetype Ingestion', () => {
    it('successfully loads and validates sample_archetype.json against Zod schemas', () => {
      const dag = loadArchetype(archetypePath);

      expect(dag.archetypeName).toBe('Earth_Machine_Sample');
      expect(dag.cards.length).toBeGreaterThanOrEqual(10);

      // Verify standalone schema validator on loaded DAG
      const validated = validateArchetypeDAG(dag);
      expect(validated.archetypeName).toBe('Earth_Machine_Sample');

      // Verify all cards are indexed in global registry
      expect(globalCardRegistry.getAllCards().length).toBe(dag.cards.length);
    });

    it('verifies baseline cards are present, correctly typed, and have interruption profiles', () => {
      loadArchetype(archetypePath);

      // 1. Earth Machine Starters & Extenders
      const harvester = getCard('Infinitrack Harvester');
      expect(harvester).toBeDefined();
      expect(harvester?.cardType).toBe('MONSTER');
      expect(harvester?.taxonomyRole).toBe('STARTER_NS');

      const riverStormer = getCard('Infinitrack River Stormer');
      expect(riverStormer).toBeDefined();
      expect(riverStormer?.monsterAttributes?.levelOrRank).toBe(5);

      const genius = getCard('Qliphort Genius');
      expect(genius).toBeDefined();
      expect(genius?.monsterAttributes?.linkRating).toBe(2);

      // 2. Standard Hand Traps
      const ash = getCard('Ash Blossom & Joyous Spring');
      expect(ash).toBeDefined();
      expect(ash?.effects[0]?.interruptionProfile?.layer).toBe('HAND');
      expect(ash?.effects[0]?.interruptionProfile?.kind).toBe('MONSTER_NEGATE');

      const imperm = getCard('Infinite Impermanence');
      expect(imperm).toBeDefined();
      expect(imperm?.cardType).toBe('TRAP');
      expect(imperm?.effects[0]?.interruptionProfile?.layer).toBe('BACKROW');

      const nibiru = getCard('Nibiru, the Primal Being');
      expect(nibiru).toBeDefined();
      expect(nibiru?.effects[0]?.interruptionProfile?.kind).toBe('SPOT_REMOVAL');

      // 3. Early Protection / Bosses
      const baronne = getCard('Baronne de Fleur');
      expect(baronne).toBeDefined();
      expect(baronne?.effects[0]?.interruptionProfile?.kind).toBe('OMNI_NEGATE');

      const caesar = getCard('D/D/D Wave High King Caesar');
      expect(caesar).toBeDefined();
      expect(caesar?.effects[0]?.interruptionProfile?.kind).toBe('SUMMON_NEGATE');
    });

    it('rejects invalid card definitions via Zod runtime validation', () => {
      const invalidCard = {
        id: '12345678',
        name: 'Invalid Card',
        cardType: 'INVALID_TYPE',
        archetypes: [],
        effects: []
      };

      expect(() => validateCardDefinition(invalidCard)).toThrow();
    });
  });

  describe('3.2 Atomic Resolution Primitives Execution', () => {
    it('executes SEARCH primitive from Deck to Hand', () => {
      const state = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          deck: [
            {
              instanceId: '#1',
              passcode: '67234805',
              name: 'Infinitrack Harvester',
              cardType: 'MONSTER'
            },
            {
              instanceId: '#2',
              passcode: '83487532',
              name: 'Exceptional Schedule',
              cardType: 'SPELL'
            }
          ],
          hand: []
        }
      });

      const { nextState, foundCard } = applySearch(state, 1, { cardType: 'MONSTER' });

      expect(foundCard).toBeDefined();
      expect(foundCard?.name).toBe('Infinitrack Harvester');
      expect(nextState.p1.hand.length).toBe(1);
      expect(nextState.p1.hand[0]?.name).toBe('Infinitrack Harvester');
      expect(nextState.p1.deck.length).toBe(1);
      expect(nextState.stepIndex).toBe(state.stepIndex + 1);
    });

    it('executes SPECIAL_SUMMON primitive to open MMZ or EMZ', () => {
      const state = createInitialGameState();
      const card = {
        instanceId: '#h1',
        passcode: '67234805',
        name: 'Infinitrack Harvester',
        cardType: 'MONSTER' as const
      };
      state.p1.hand.push(card);

      const targetMMZ = findAvailableMMZ(state, 1);
      expect(targetMMZ).toBe('M1');

      const summonedState = applySpecialSummon(state, 1, card, targetMMZ!, 'def', 'HAND');

      expect(summonedState.p1.monsters.M1?.name).toBe('Infinitrack Harvester');
      expect(summonedState.p1.monsters.M1?.position).toBe('def');
      expect(summonedState.p1.hand.length).toBe(0);
      expect(summonedState.gates.specialSummonCount).toBe(1);

      // Now summon to Extra Monster Zone
      const targetEMZ = findAvailableEMZ(summonedState, 1);
      expect(targetEMZ).toBe('ER');

      const geniusCard = {
        instanceId: '#ed1',
        passcode: '58858807',
        name: 'Qliphort Genius',
        cardType: 'MONSTER' as const
      };
      summonedState.p1.extraDeck.push(geniusCard);

      const linkSummonState = applySpecialSummon(
        summonedState,
        1,
        geniusCard,
        targetEMZ!,
        'atk',
        'EXTRA_DECK'
      );
      expect(linkSummonState.p1.extraMonsters.ER?.name).toBe('Qliphort Genius');
      expect(linkSummonState.gates.specialSummonCount).toBe(2);
    });

    it('executes MILL primitive to dump cards from Deck to GY and logs them', () => {
      const state = createInitialGameState({
        p1: {
          ...createInitialGameState().p1,
          deck: [
            { instanceId: '#1', passcode: '11111111', name: 'Card 1', cardType: 'MONSTER' },
            { instanceId: '#2', passcode: '22222222', name: 'Card 2', cardType: 'MONSTER' }
          ],
          graveyard: []
        }
      });

      const milledState = applyMill(state, 1, 2);

      expect(milledState.p1.deck.length).toBe(0);
      expect(milledState.p1.graveyard.length).toBe(2);
      expect(milledState.registers.cardsSentToGYThisTurn.has('#1')).toBe(true);
      expect(milledState.registers.cardsSentToGYThisTurn.has('#2')).toBe(true);
    });

    it('executes ATTACH_MATERIAL primitive to stack materials onto Xyz monsters', () => {
      const state = createInitialGameState();
      const xyzMonster = {
        instanceId: '#x1',
        passcode: '25377819',
        name: 'River Stormer',
        cardType: 'MONSTER' as const,
        materials: []
      };
      state.p1.monsters.M1 = xyzMonster;

      const materialCard = {
        instanceId: '#m1',
        passcode: '67234805',
        name: 'Harvester',
        cardType: 'MONSTER' as const
      };

      const attachedState = applyAttachMaterial(state, 1, materialCard, 'M1');
      expect(attachedState.p1.monsters.M1?.materials?.length).toBe(1);
      expect(attachedState.p1.monsters.M1?.materials?.[0]?.name).toBe('Harvester');
    });

    it('validates costs and executes cost payment (discarding Ash Blossom, paying LP, detaching materials)', () => {
      const state = createInitialGameState();
      const ashCard = {
        instanceId: '#ash1',
        passcode: '14558127',
        name: 'Ash Blossom & Joyous Spring',
        cardType: 'MONSTER' as const
      };
      state.p1.hand.push(ashCard);

      // Cost 1: Discard this card
      const discardCost = { type: 'DISCARD_THIS_CARD' as const };
      expect(canPayCost(state, 1, discardCost, ashCard)).toBe(true);

      const discardedState = applyCost(state, 1, discardCost, ashCard);
      expect(discardedState.p1.hand.length).toBe(0);
      expect(discardedState.p1.graveyard.length).toBe(1);
      expect(discardedState.p1.graveyard[0]?.name).toBe('Ash Blossom & Joyous Spring');

      // Cost 2: Pay LP
      const payLpCost = { type: 'PAY_LP' as const, amount: 2000 };
      expect(canPayCost(discardedState, 1, payLpCost, ashCard)).toBe(true);
      const paidState = applyCost(discardedState, 1, payLpCost, ashCard);
      expect(paidState.lifePoints.player1).toBe(6000);

      // Cost 3: Detach Xyz Material
      paidState.p1.monsters.M2 = {
        instanceId: '#caesar1',
        passcode: '24224830',
        name: 'D/D/D Wave High King Caesar',
        cardType: 'MONSTER',
        materials: [{ instanceId: '#mat1', passcode: '111', name: 'Material', cardType: 'MONSTER' }]
      };

      const detachCost = { type: 'DETACH_XYZ_MATERIAL' as const, amount: 1 };
      expect(canPayCost(paidState, 1, detachCost, paidState.p1.monsters.M2)).toBe(true);

      const detachedState = applyCost(paidState, 1, detachCost, paidState.p1.monsters.M2);
      expect(detachedState.p1.monsters.M2?.materials?.length).toBe(0);
      expect(detachedState.p1.graveyard.some((c) => c.instanceId === '#mat1')).toBe(true);
    });

    it('enforces conditions including HOPT restriction', () => {
      const state = createInitialGameState();
      state.registers.hoptActivated.add('HOPT_ASH_BLOSSOM');

      loadArchetype(archetypePath);
      const ash = getCard('Ash Blossom & Joyous Spring')!;

      // HOPT is already used this turn: condition check must fail!
      const canActivate = checkConditions(state, 1, ash.effects[0]!);
      expect(canActivate).toBe(false);

      // New turn state with cleared HOPT
      const freshState = createInitialGameState();
      let timing = initOpenGameState(freshState);
      timing = addChainLink(timing, {
        player: 2, // Opponent activated
        cardName: 'Pot of Greed',
        effectId: 'pot_activate',
        spellSpeed: 1
      });

      // Now condition check succeeds
      const canActivateNow = checkConditions(freshState, 1, ash.effects[0]!, timing);
      expect(canActivateNow).toBe(true);
    });
  });
});
