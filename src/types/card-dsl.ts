/**
 * @file card-dsl.ts
 * @description Declarative Card Action Schema, PSCT conditions, costs, and opponent interruption profiling.
 */

export type CardCategory = 'MONSTER' | 'SPELL' | 'TRAP';

export type CardAttribute = 'DARK' | 'LIGHT' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';

export type LinkArrowDirection = 'TL' | 'T' | 'TR' | 'L' | 'R' | 'BL' | 'B' | 'BR';

export interface MonsterAttributes {
  attribute: CardAttribute;
  race: string; // e.g. 'Machine', 'Dragon', 'Cyberse', 'Pyro'
  levelOrRank: number;
  atk: number;
  def?: number; // Undefined for Link monsters
  linkRating?: number;
  linkArrows?: LinkArrowDirection[];
  isTuner?: boolean;
}

export type SpellTrapType = 'NORMAL' | 'CONTINUOUS' | 'QUICK_PLAY' | 'FIELD' | 'EQUIP' | 'COUNTER';

export type EffectCategory = 'IGNITION' | 'TRIGGER' | 'QUICK' | 'PROCEDURE' | 'CONTINUOUS';

export type ZoneLocation =
  'HAND' | 'FIELD_M' | 'FIELD_S' | 'GRAVEYARD' | 'BANISHED' | 'DECK' | 'EXTRA_DECK';

export type InterruptionLayer = 'FIELD' | 'BACKROW' | 'GRAVEYARD' | 'HAND' | 'BANISHED';

export type InterruptionKind =
  | 'OMNI_NEGATE'
  | 'MONSTER_NEGATE'
  | 'SPELL_TRAP_NEGATE'
  | 'SPOT_REMOVAL'
  | 'SUMMON_NEGATE'
  | 'FLOODGATE';

export type BoardWipeType = 'DARK_RULER' | 'EVENLY_MATCHED' | 'SUPER_POLY' | 'RAIGEKI';

export interface InterruptionProfile {
  layer: InterruptionLayer;
  kind: InterruptionKind;
  removalType?: 'DESTROY' | 'BANISH' | 'BOUNCE' | 'SPIN' | 'SEND_TO_GY';
  isTargeting: boolean;
  spellSpeed: 2 | 3;
  resilientAgainstWipes: BoardWipeType[];
}

export interface ConditionCheck {
  type:
    | 'EVENT_IS_NORMAL_OR_SPECIAL_SUMMONED'
    | 'EVENT_IS_SENT_TO_GY'
    | 'EVENT_IS_BANISHED'
    | 'CONTROL_NO_MONSTERS'
    | 'CONTROL_NO_CARDS'
    | 'CONTROL_NO_FACEUP_CARDS'
    | 'OPPONENT_CONTROLS_MONSTER'
    | 'CHAIN_LINK_EXISTS'
    | 'OPPONENT_ACTIVATED_EFFECT'
    | 'EFFECT_INCLUDES_DECK_SEARCH_OR_MILL_OR_SS'
    | 'HOPT_NOT_USED';
  params?: Record<string, unknown>;
}

export interface CostOperation {
  type:
    | 'DISCARD_THIS_CARD'
    | 'DISCARD_GENERIC_CARD'
    | 'TRIBUTE_SELF'
    | 'DETACH_XYZ_MATERIAL'
    | 'PAY_LP'
    | 'BANISH_SELF_FROM_GY'
    | 'SEND_SELF_TO_GY';
  amount?: number;
}

export interface ResolutionOperation {
  type:
    | 'SEARCH'
    | 'SPECIAL_SUMMON'
    | 'MILL'
    | 'ATTACH_MATERIAL'
    | 'DRAW'
    | 'NEGATE_ACTIVATION'
    | 'NEGATE_EFFECT'
    | 'DESTROY'
    | 'BANISH'
    | 'BOUNCE'
    | 'SET_FROM_DECK';
  from?: ZoneLocation;
  fromLocations?: ZoneLocation[];
  to?: ZoneLocation;
  count?: number;
  filter?: {
    archetype?: string;
    cardType?: CardCategory;
    excludeId?: string;
    levelMax?: number;
    race?: string;
    attribute?: CardAttribute;
  };
  target?: 'PREVIOUS_CHAIN_LINK' | 'PREVIOUS_CHAIN_LINK_CARD' | 'FIELD_TARGET';
}

export interface EffectDefinition {
  effectId: string;
  hoptGroup?: string; // Shared HOPT ID across multiple copies of card
  category: EffectCategory;
  activationLocation: ZoneLocation[];
  spellSpeed: 1 | 2 | 3;
  conditions: ConditionCheck[];
  costs: CostOperation[];
  resolution: ResolutionOperation[];

  // Tagging for Tactical Opponent-Turn Evaluation
  interruptionProfile?: InterruptionProfile;
}

export interface CardDefinition {
  id: string; // 8-digit passcode or unique token
  name: string; // Card Name
  cardType: CardCategory;
  monsterAttributes?: MonsterAttributes;
  spellTrapType?: SpellTrapType;
  archetypes: string[];

  // Tactical Engine Taxonomy Tagging
  taxonomyRole?:
    | 'STARTER_NS'
    | 'STARTER_SS'
    | 'STARTER_1_5'
    | 'EXTENDER'
    | 'HARD_BRICK'
    | 'ENGINE_BRICK'
    | 'TECH_HANDTRAP'
    | 'TECH_DEFENSIVE'
    | 'TECH_BREAKER';

  effects: EffectDefinition[];
}

export interface ArchetypeDAG {
  archetypeName: string;
  cards: CardDefinition[];
  standardStarters: string[]; // Card IDs that initiate primary combo lines
  primaryExtenders: string[];
  insulationTargets: string[]; // Bosses/Negates to deploy before Summon #5
}
