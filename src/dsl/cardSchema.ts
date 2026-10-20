/**
 * @file cardSchema.ts
 * @description Zod runtime schema validators for CardDefinition, EffectDefinition, and ArchetypeDAG.
 */

import { z } from 'zod';
import type { CardDefinition, ArchetypeDAG } from '../types/card-dsl.js';

export const CardCategorySchema = z.enum(['MONSTER', 'SPELL', 'TRAP']);

export const CardAttributeSchema = z.enum([
  'DARK',
  'LIGHT',
  'EARTH',
  'WATER',
  'FIRE',
  'WIND',
  'DIVINE'
]);

export const LinkArrowDirectionSchema = z.enum(['TL', 'T', 'TR', 'L', 'R', 'BL', 'B', 'BR']);

export const MonsterAttributesSchema = z.object({
  attribute: CardAttributeSchema,
  race: z.string().min(1),
  levelOrRank: z.number().int().min(0).max(13),
  atk: z.number().int().min(0),
  def: z.number().int().min(0).optional(),
  linkRating: z.number().int().min(1).max(6).optional(),
  linkArrows: z.array(LinkArrowDirectionSchema).optional(),
  isTuner: z.boolean().optional()
});

export const SpellTrapTypeSchema = z.enum([
  'NORMAL',
  'CONTINUOUS',
  'QUICK_PLAY',
  'FIELD',
  'EQUIP',
  'COUNTER'
]);

export const EffectCategorySchema = z.enum([
  'IGNITION',
  'TRIGGER',
  'QUICK',
  'PROCEDURE',
  'CONTINUOUS'
]);

export const ZoneLocationSchema = z.enum([
  'HAND',
  'FIELD_M',
  'FIELD_S',
  'GRAVEYARD',
  'BANISHED',
  'DECK',
  'EXTRA_DECK'
]);

export const InterruptionLayerSchema = z.enum([
  'FIELD',
  'BACKROW',
  'GRAVEYARD',
  'HAND',
  'BANISHED'
]);

export const InterruptionKindSchema = z.enum([
  'OMNI_NEGATE',
  'MONSTER_NEGATE',
  'SPELL_TRAP_NEGATE',
  'SPOT_REMOVAL',
  'SUMMON_NEGATE',
  'FLOODGATE'
]);

export const BoardWipeTypeSchema = z.enum([
  'DARK_RULER',
  'EVENLY_MATCHED',
  'SUPER_POLY',
  'RAIGEKI'
]);

export const InterruptionProfileSchema = z.object({
  layer: InterruptionLayerSchema,
  kind: InterruptionKindSchema,
  removalType: z.enum(['DESTROY', 'BANISH', 'BOUNCE', 'SPIN', 'SEND_TO_GY']).optional(),
  isTargeting: z.boolean(),
  spellSpeed: z.union([z.literal(2), z.literal(3)]),
  resilientAgainstWipes: z.array(BoardWipeTypeSchema)
});

export const ConditionCheckSchema = z.object({
  type: z.enum([
    'EVENT_IS_NORMAL_OR_SPECIAL_SUMMONED',
    'EVENT_IS_SENT_TO_GY',
    'EVENT_IS_BANISHED',
    'CONTROL_NO_MONSTERS',
    'CONTROL_NO_CARDS',
    'CONTROL_NO_FACEUP_CARDS',
    'OPPONENT_CONTROLS_MONSTER',
    'CHAIN_LINK_EXISTS',
    'OPPONENT_ACTIVATED_EFFECT',
    'EFFECT_INCLUDES_DECK_SEARCH_OR_MILL_OR_SS',
    'HOPT_NOT_USED'
  ]),
  params: z.record(z.unknown()).optional()
});

export const CostOperationSchema = z.object({
  type: z.enum([
    'DISCARD_THIS_CARD',
    'DISCARD_GENERIC_CARD',
    'TRIBUTE_SELF',
    'DETACH_XYZ_MATERIAL',
    'PAY_LP',
    'BANISH_SELF_FROM_GY',
    'SEND_SELF_TO_GY'
  ]),
  amount: z.number().int().positive().optional()
});

export const ResolutionOperationSchema = z.object({
  type: z.enum([
    'SEARCH',
    'SPECIAL_SUMMON',
    'MILL',
    'ATTACH_MATERIAL',
    'DRAW',
    'NEGATE_ACTIVATION',
    'NEGATE_EFFECT',
    'DESTROY',
    'BANISH',
    'BOUNCE',
    'SET_FROM_DECK'
  ]),
  from: ZoneLocationSchema.optional(),
  fromLocations: z.array(ZoneLocationSchema).optional(),
  to: ZoneLocationSchema.optional(),
  count: z.number().int().positive().optional(),
  filter: z
    .object({
      archetype: z.string().optional(),
      cardType: CardCategorySchema.optional(),
      excludeId: z.string().optional(),
      levelMax: z.number().int().optional(),
      race: z.string().optional(),
      attribute: CardAttributeSchema.optional()
    })
    .optional(),
  target: z.enum(['PREVIOUS_CHAIN_LINK', 'PREVIOUS_CHAIN_LINK_CARD', 'FIELD_TARGET']).optional()
});

export const EffectDefinitionSchema = z.object({
  effectId: z.string().min(1),
  hoptGroup: z.string().optional(),
  category: EffectCategorySchema,
  activationLocation: z.array(ZoneLocationSchema).min(1),
  spellSpeed: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  conditions: z.array(ConditionCheckSchema),
  costs: z.array(CostOperationSchema),
  resolution: z.array(ResolutionOperationSchema),
  interruptionProfile: InterruptionProfileSchema.optional()
});

export const TaxonomyRoleSchema = z.enum([
  'STARTER_NS',
  'STARTER_SS',
  'STARTER_1_5',
  'EXTENDER',
  'HARD_BRICK',
  'ENGINE_BRICK',
  'TECH_HANDTRAP',
  'TECH_DEFENSIVE',
  'TECH_BREAKER'
]);

export const CardDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cardType: CardCategorySchema,
  monsterAttributes: MonsterAttributesSchema.optional(),
  spellTrapType: SpellTrapTypeSchema.optional(),
  archetypes: z.array(z.string()),
  taxonomyRole: TaxonomyRoleSchema.optional(),
  effects: z.array(EffectDefinitionSchema)
});

export const ArchetypeMilestoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  targetYBN: z.string().optional(),
  requiredCardsOnField: z.array(z.string()).optional(),
  requiredZones: z.record(z.string()).optional(),
  targetV_YBN: z.number().optional(),
  priorityWeight: z.number().optional()
});

export const ArchetypeDAGSchema = z.object({
  archetypeName: z.string().min(1),
  version: z.string().optional(),
  standardStarters: z.array(z.string()),
  primaryExtenders: z.array(z.string()),
  insulationTargets: z.array(z.string()),
  milestones: z.array(ArchetypeMilestoneSchema).optional(),
  cards: z.array(CardDefinitionSchema)
});

/**
 * Validate a card definition object against the CardDefinition schema.
 */
export function validateCardDefinition(data: unknown): CardDefinition {
  return CardDefinitionSchema.parse(data) as CardDefinition;
}

/**
 * Validate an archetype DAG object against the ArchetypeDAG schema.
 */
export function validateArchetypeDAG(data: unknown): ArchetypeDAG {
  return ArchetypeDAGSchema.parse(data) as ArchetypeDAG;
}
