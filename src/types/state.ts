/**
 * @file state.ts
 * @description Core game state, zone topology, and RFC 0001 YBN data models for ygo-sim-core.
 */

export type TurnPhase = 'DP' | 'SP' | 'M1' | 'BP' | 'M2' | 'EP';

export type MonsterPosition = 'atk' | 'def' | 'set';
export type SpellTrapPosition = 'face-up' | 'set';

export type MainMonsterZoneId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
export type ExtraMonsterZoneId = 'EL' | 'ER';
export type SpellTrapZoneId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface CardInstance {
  instanceId: string; // Unique runtime ID (e.g. "#1", "#e2")
  passcode: string; // 8-digit Konami card passcode
  name: string; // Official card name
  cardType: 'MONSTER' | 'SPELL' | 'TRAP';

  // Monster runtime state
  atk?: number | undefined;
  def?: number | undefined;
  levelOrRank?: number | undefined;
  materials?: CardInstance[] | undefined; // Attached Xyz materials
  position?: MonsterPosition | undefined;
  isNegated?: boolean | undefined;
  canAttack?: boolean | undefined;

  // Spell/Trap runtime state
  spellTrapState?: SpellTrapPosition | undefined;
  turnSet?: number | undefined; // Turn number when this card was set

  // Graveyard / Banished tracking
  turnSentToGY?: number | undefined;
  isFaceDownBanished?: boolean | undefined;
}

export interface PlayerZones {
  // Monster Zones (Main 1-5)
  monsters: Partial<Record<MainMonsterZoneId, CardInstance>>;

  // Spell & Trap Zones (1-5)
  spells: Partial<Record<SpellTrapZoneId, CardInstance>>;

  // Dedicated Field Spell Zone
  fieldSpell?: CardInstance | undefined;

  // Shared Extra Monster Zones (keyed by player perspective)
  extraMonsters: Partial<Record<ExtraMonsterZoneId, CardInstance>>;

  // Piles & Public Resources
  hand: CardInstance[];
  graveyard: CardInstance[];
  banished: CardInstance[];
  deck: CardInstance[];
  extraDeck: CardInstance[];
}

export interface OperationalGates {
  normalSummonAvailable: boolean;
  specialSummonCount: number; // Total special summons conducted this turn
  attacksDeclared: number;
}

export interface OperationalRegistries {
  hoptActivated: Set<string>; // Set of HOPT effect IDs used this turn
  soptActivated: Set<string>; // Set of card instance IDs whose SOPT effect was used
  cardsSentToGYThisTurn: Set<string>;
}

export interface LingeringRestrictions {
  lockedIntoFire: boolean;
  lockedIntoXyz: boolean;
  lockedIntoLink: boolean;
  lockedIntoMachine: boolean;
  cannotSpecialSummonFromExtra: boolean;
  opponentDrawsOnSpecialSummon: boolean; // e.g. Mulcharmy Fuwalos / Maxx "C" active
}

export interface GameState {
  turn: number;
  phase: TurnPhase;
  turnPlayer: 1 | 2;
  priorityHolder: 1 | 2;
  lifePoints: {
    player1: number;
    player2: number;
  };
  p1: PlayerZones;
  p2: PlayerZones;
  gates: OperationalGates;
  registers: OperationalRegistries;
  locks: LingeringRestrictions;

  // History & Provenance
  stepIndex: number;
  parentHash?: string | undefined;
  actionTaken?: string | undefined; // YGN verb that created this state
}

/**
 * Raw RFC 0001 YBN Snapshot string format:
 * "T<turn>|<phase>|LP<P1>:<P2>|P1:<zones>|P2:<zones>|G:<gates>"
 */
export type YBNString = string;

export function createEmptyPlayerZones(): PlayerZones {
  return {
    monsters: {},
    spells: {},
    extraMonsters: {},
    hand: [],
    graveyard: [],
    banished: [],
    deck: [],
    extraDeck: []
  };
}

export function createInitialGameState(overrides?: Partial<GameState>): GameState {
  return {
    turn: 1,
    phase: 'M1',
    turnPlayer: 1,
    priorityHolder: 1,
    lifePoints: {
      player1: 8000,
      player2: 8000
    },
    p1: createEmptyPlayerZones(),
    p2: createEmptyPlayerZones(),
    gates: {
      normalSummonAvailable: true,
      specialSummonCount: 0,
      attacksDeclared: 0
    },
    registers: {
      hoptActivated: new Set<string>(),
      soptActivated: new Set<string>(),
      cardsSentToGYThisTurn: new Set<string>()
    },
    locks: {
      lockedIntoFire: false,
      lockedIntoXyz: false,
      lockedIntoLink: false,
      lockedIntoMachine: false,
      cannotSpecialSummonFromExtra: false,
      opponentDrawsOnSpecialSummon: false
    },
    stepIndex: 0,
    ...overrides
  };
}

export function cloneCardInstance(card: CardInstance): CardInstance {
  return {
    ...card,
    materials: card.materials ? card.materials.map(cloneCardInstance) : undefined
  };
}

export function clonePlayerZones(zones: PlayerZones): PlayerZones {
  const clonedMonsters: Partial<Record<MainMonsterZoneId, CardInstance>> = {};
  for (const [k, v] of Object.entries(zones.monsters) as [
    MainMonsterZoneId,
    CardInstance | undefined
  ][]) {
    if (v) clonedMonsters[k] = cloneCardInstance(v);
  }

  const clonedSpells: Partial<Record<SpellTrapZoneId, CardInstance>> = {};
  for (const [k, v] of Object.entries(zones.spells) as [
    SpellTrapZoneId,
    CardInstance | undefined
  ][]) {
    if (v) clonedSpells[k] = cloneCardInstance(v);
  }

  const clonedExtraMonsters: Partial<Record<ExtraMonsterZoneId, CardInstance>> = {};
  for (const [k, v] of Object.entries(zones.extraMonsters) as [
    ExtraMonsterZoneId,
    CardInstance | undefined
  ][]) {
    if (v) clonedExtraMonsters[k] = cloneCardInstance(v);
  }

  return {
    monsters: clonedMonsters,
    spells: clonedSpells,
    fieldSpell: zones.fieldSpell ? cloneCardInstance(zones.fieldSpell) : undefined,
    extraMonsters: clonedExtraMonsters,
    hand: zones.hand.map(cloneCardInstance),
    graveyard: zones.graveyard.map(cloneCardInstance),
    banished: zones.banished.map(cloneCardInstance),
    deck: zones.deck.map(cloneCardInstance),
    extraDeck: zones.extraDeck.map(cloneCardInstance)
  };
}

export function cloneGameState(state: GameState): GameState {
  return {
    turn: state.turn,
    phase: state.phase,
    turnPlayer: state.turnPlayer,
    priorityHolder: state.priorityHolder,
    lifePoints: { ...state.lifePoints },
    p1: clonePlayerZones(state.p1),
    p2: clonePlayerZones(state.p2),
    gates: { ...state.gates },
    registers: {
      hoptActivated: new Set(state.registers.hoptActivated),
      soptActivated: new Set(state.registers.soptActivated),
      cardsSentToGYThisTurn: new Set(state.registers.cardsSentToGYThisTurn)
    },
    locks: { ...state.locks },
    stepIndex: state.stepIndex,
    parentHash: state.parentHash,
    actionTaken: state.actionTaken
  };
}
