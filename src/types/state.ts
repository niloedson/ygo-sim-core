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
  atk?: number;
  def?: number;
  levelOrRank?: number;
  materials?: CardInstance[]; // Attached Xyz materials
  position?: MonsterPosition;
  isNegated?: boolean;
  canAttack?: boolean;

  // Spell/Trap runtime state
  spellTrapState?: SpellTrapPosition;
  turnSet?: number; // Turn number when this card was set

  // Graveyard / Banished tracking
  turnSentToGY?: number;
  isFaceDownBanished?: boolean;
}

export interface PlayerZones {
  // Monster Zones (Main 1-5)
  monsters: Partial<Record<MainMonsterZoneId, CardInstance>>;

  // Spell & Trap Zones (1-5)
  spells: Partial<Record<SpellTrapZoneId, CardInstance>>;

  // Dedicated Field Spell Zone
  fieldSpell?: CardInstance;

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
  parentHash?: string;
  actionTaken?: string; // YGN verb that created this state
}

/**
 * Raw RFC 0001 YBN Snapshot string format:
 * "T<turn>|<phase>|LP<P1>:<P2>|P1:<zones>|P2:<zones>|G:<gates>"
 */
export type YBNString = string;
