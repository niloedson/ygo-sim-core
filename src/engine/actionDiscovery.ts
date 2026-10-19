/**
 * @file actionDiscovery.ts
 * @description Dynamic discovery of all legal actions A(S) and state transition dispatcher.
 */

import {
  GameState,
  CardInstance,
  MainMonsterZoneId,
  ExtraMonsterZoneId,
  SpellTrapZoneId,
  cloneGameState,
  cloneCardInstance
} from '../types/state.js';
import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';
import {
  findAvailableMMZ,
  findAvailableEMZ,
  canPayCost,
  applyCost,
  applySearch,
  applySpecialSummon,
  matchesCardFilter
} from '../dsl/primitives.js';

export type ActionVerb =
  | 'NORMAL_SUMMON'
  | 'SPECIAL_SUMMON'
  | 'SET_SPELL_TRAP'
  | 'ACTIVATE_HAND'
  | 'ACTIVATE_FIELD'
  | 'ACTIVATE_GY'
  | 'LINK_SUMMON'
  | 'XYZ_SUMMON'
  | 'ADVANCE_PHASE';

export interface ActionTargetSelection {
  passcode: string;
  name: string;
  fromLocation: 'DECK' | 'EXTRA_DECK' | 'GRAVEYARD' | 'HAND';
}

export interface DiscoveredAction {
  id: string;
  verb: ActionVerb;
  description: string;
  ygnNotation: string;
  sourceCard: CardInstance;
  targetZone?: MainMonsterZoneId | ExtraMonsterZoneId | SpellTrapZoneId | undefined;
  materialsUsed?: CardInstance[] | undefined;
  effectIndex?: number | undefined;
  targetSelection?: ActionTargetSelection | undefined;
}

/**
 * Scan the current game state for all legal actions available to the active priority player.
 */
export function discoverLegalActions(
  state: GameState,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): DiscoveredAction[] {
  const actions: DiscoveredAction[] = [];
  const pZones = player === 1 ? state.p1 : state.p2;

  // Actions are only discovered in Open Game State during Main Phases (M1 or M2)
  if (state.phase !== 'M1' && state.phase !== 'M2') {
    return actions;
  }

  // 1. Normal Summon / Set from Hand
  if (state.gates.normalSummonAvailable) {
    const openMMZ = findAvailableMMZ(state, player);
    if (openMMZ) {
      for (const card of pZones.hand) {
        if (card.cardType === 'MONSTER') {
          const cardDef = registry.getCardById(card.passcode) ?? registry.getCardByName(card.name);
          const level = card.levelOrRank ?? cardDef?.monsterAttributes?.levelOrRank ?? 4;

          // Level 1-4 monsters require 0 tributes
          if (level <= 4) {
            actions.push({
              id: `NS_${card.instanceId}_${openMMZ}`,
              verb: 'NORMAL_SUMMON',
              description: `Normal Summon ${card.name} to ${openMMZ}`,
              ygnNotation: `N[${card.instanceId}:${card.name}](atk)>${openMMZ}`,
              sourceCard: card,
              targetZone: openMMZ
            });
          }
        }
      }
    }
  }

  // 2. Spell / Trap Activations and Sets from Hand
  const openSTZ: SpellTrapZoneId | undefined = (
    ['S1', 'S2', 'S3', 'S4', 'S5'] as SpellTrapZoneId[]
  ).find((z) => !pZones.spells[z]);

  for (const card of pZones.hand) {
    const cardDef = registry.getCardById(card.passcode) ?? registry.getCardByName(card.name);

    if (card.cardType === 'SPELL') {
      const spellType = cardDef?.spellTrapType ?? 'NORMAL';

      // Spells with activation effects from hand (Ignition / Normal / Field)
      if (cardDef?.effects) {
        cardDef.effects.forEach((eff, idx) => {
          if (eff.activationLocation.includes('HAND')) {
            // Reactive effects requiring chain link or opponent activation cannot be activated in Open Game State
            const isReactive = eff.conditions.some(
              (c) => c.type === 'CHAIN_LINK_EXISTS' || c.type === 'OPPONENT_ACTIVATED_EFFECT'
            );
            if (!isReactive) {
              // Check HOPT
              if (!eff.hoptGroup || !state.registers.hoptActivated.has(eff.hoptGroup)) {
                // Check if effect defines discrete search or special summon target choices
                const targetedRes = eff.resolution.find(
                  (r) => r.type === 'SEARCH' || r.type === 'SPECIAL_SUMMON'
                );

                if (targetedRes) {
                  const targetLocations = targetedRes.fromLocations ?? (targetedRes.from ? [targetedRes.from] : ['DECK']);
                  const uniqueCandidates: { card: CardInstance; loc: 'DECK' | 'EXTRA_DECK' | 'GRAVEYARD' }[] = [];
                  const seenPasscodes = new Set<string>();

                  for (const loc of targetLocations) {
                    let sourceList: CardInstance[] = [];
                    if (loc === 'DECK') sourceList = pZones.deck;
                    else if (loc === 'EXTRA_DECK') sourceList = pZones.extraDeck;
                    else if (loc === 'GRAVEYARD') sourceList = pZones.graveyard;

                    const isSS = targetedRes.type === 'SPECIAL_SUMMON';

                    for (const candidate of sourceList) {
                      if (isSS && candidate.cardType !== 'MONSTER') {
                        continue;
                      }

                      if (matchesCardFilter(candidate, targetedRes.filter, registry)) {
                        // Check ATK restriction for R.B. Stage Landing: Machine monsters with <= 1500 original ATK
                        if (card.name === 'R.B. Stage Landing' && loc === 'EXTRA_DECK') {
                          const candidateDef =
                            registry.getCardById(candidate.passcode) ??
                            registry.getCardByName(candidate.name);
                          const atk = candidateDef?.monsterAttributes?.atk ?? 0;
                          const race = candidateDef?.monsterAttributes?.race;
                          if (atk > 1500 || race !== 'Machine') continue;
                        }

                        // Also Stage Landing requires a different name than cards currently controlled
                        if (card.name === 'R.B. Stage Landing') {
                          const controlledNames = new Set(
                            Object.values(pZones.monsters)
                              .concat(Object.values(pZones.extraMonsters))
                              .filter((m): m is CardInstance => m !== undefined)
                              .map((m) => m.name)
                          );
                          if (controlledNames.has(candidate.name)) continue;
                        }

                        if (!seenPasscodes.has(candidate.passcode)) {
                          seenPasscodes.add(candidate.passcode);
                          uniqueCandidates.push({
                            card: candidate,
                            loc: loc as 'DECK' | 'EXTRA_DECK' | 'GRAVEYARD'
                          });
                        }
                      }
                    }
                  }

                  if (uniqueCandidates.length > 0) {
                    for (const tgt of uniqueCandidates) {
                      const verbStr = targetedRes.type === 'SEARCH' ? 'SEARCH' : 'SS';
                      actions.push({
                        id: `ACT_H_${card.instanceId}_eff${idx}_to_${tgt.card.passcode}`,
                        verb: 'ACTIVATE_HAND',
                        description: `Activate ${card.name} -> ${targetedRes.type === 'SEARCH' ? 'Add' : 'Special Summon'} ${tgt.card.name} from ${tgt.loc}`,
                        ygnNotation: `A(H)[${card.instanceId}:${card.name}]>${verbStr}(${tgt.loc}:${tgt.card.name})`,
                        sourceCard: card,
                        effectIndex: idx,
                        targetSelection: {
                          passcode: tgt.card.passcode,
                          name: tgt.card.name,
                          fromLocation: tgt.loc
                        }
                      });
                    }
                  } else {
                    // No valid target exists for this search/summon effect
                  }
                } else {
                  // Standard hand activation without target choice
                  actions.push({
                    id: `ACT_H_${card.instanceId}_${idx}`,
                    verb: 'ACTIVATE_HAND',
                    description: `Activate ${card.name} from hand`,
                    ygnNotation: `A(H)[${card.instanceId}:${card.name}]`,
                    sourceCard: card,
                    effectIndex: idx
                  });
                }
              }
            }
          }
        });
      }

      // Quick-Play Spells can also be Set to backrow
      if (spellType === 'QUICK_PLAY' && openSTZ) {
        actions.push({
          id: `SET_${card.instanceId}_${openSTZ}`,
          verb: 'SET_SPELL_TRAP',
          description: `Set Quick-Play Spell ${card.name} to ${openSTZ}`,
          ygnNotation: `SET[${card.instanceId}:${card.name}]>${openSTZ}`,
          sourceCard: card,
          targetZone: openSTZ
        });
      }
    } else if (card.cardType === 'TRAP' && openSTZ) {
      // Traps can be Set to backrow
      actions.push({
        id: `SET_${card.instanceId}_${openSTZ}`,
        verb: 'SET_SPELL_TRAP',
        description: `Set Trap ${card.name} to ${openSTZ}`,
        ygnNotation: `SET[${card.instanceId}:${card.name}]>${openSTZ}`,
        sourceCard: card,
        targetZone: openSTZ
      });
    }
  }

  // 3. Special Summons from Hand (Inherent & Hand Triggers)
  for (const card of pZones.hand) {
    if (card.name === 'Sky Striker Ace - Roze') {
      const hasSkyStriker = Object.values(pZones.monsters)
        .concat(Object.values(pZones.extraMonsters))
        .some(
          (m) =>
            m &&
            (m.name.includes('Sky Striker') || m.passcode === '52340445') &&
            m.name !== 'Sky Striker Ace - Roze'
        );

      if (hasSkyStriker && !state.registers.hoptActivated.has('HOPT_ROZE_SS')) {
        const mmz = findAvailableMMZ(state, player, registry);
        if (mmz) {
          actions.push({
            id: `SS_H_${card.instanceId}_${mmz}`,
            verb: 'SPECIAL_SUMMON',
            description: `Special Summon ${card.name} from hand`,
            ygnNotation: `S(H)[${card.instanceId}:${card.name}]>${mmz}`,
            sourceCard: card,
            targetZone: mmz
          });
        }
      }
    } else if (card.name === 'R.B. Ga10 Cutter') {
      const allControlled = Object.values(pZones.monsters)
        .concat(Object.values(pZones.extraMonsters))
        .filter((m): m is CardInstance => m !== undefined);
      const onlyRb =
        allControlled.length > 0 && allControlled.every((m) => m.name.includes('R.B.'));
      if (onlyRb && !state.registers.hoptActivated.has('HOPT_GA10_CUTTER_SS')) {
        const mmz = findAvailableMMZ(state, player, registry);
        if (mmz) {
          actions.push({
            id: `SS_H_${card.instanceId}_${mmz}`,
            verb: 'SPECIAL_SUMMON',
            description: `Special Summon ${card.name} from hand to linked zone`,
            ygnNotation: `S(H)[${card.instanceId}:${card.name}]>${mmz}`,
            sourceCard: card,
            targetZone: mmz
          });
        }
      }
    }
  }

  // 4. Field Monster Ignition & Trigger Activations
  const allFieldMonsters: Array<{
    zone: MainMonsterZoneId | ExtraMonsterZoneId;
    card: CardInstance;
  }> = [
    ...(Object.entries(pZones.monsters) as [MainMonsterZoneId, CardInstance | undefined][])
      .filter(([, m]) => m !== undefined)
      .map(([z, m]) => ({ zone: z, card: m! })),
    ...(Object.entries(pZones.extraMonsters) as [ExtraMonsterZoneId, CardInstance | undefined][])
      .filter(([, m]) => m !== undefined)
      .map(([z, m]) => ({ zone: z, card: m! }))
  ];

  for (const { zone: zoneKey, card: monster } of allFieldMonsters) {
    if (!monster.isNegated) {
      const cardDef =
        registry.getCardById(monster.passcode) ?? registry.getCardByName(monster.name);

      // Kagari on-summon salvage
      if (
        monster.name === 'Sky Striker Ace - Kagari' &&
        !state.registers.hoptActivated.has('HOPT_KAGARI_SALVAGE')
      ) {
        const gySpells = pZones.graveyard.filter(
          (c) => c.cardType === 'SPELL' && c.name.includes('Sky Striker')
        );
        for (const sp of gySpells) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_kagari_salvage_${sp.passcode}`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate Kagari -> Retrieve ${sp.name} from GY`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>RETRIEVE(GY:${sp.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: sp.passcode, name: sp.name, fromLocation: 'GRAVEYARD' }
          });
        }
      }

      // Camellia mill
      if (
        monster.name === 'Sky Striker Ace - Camellia' &&
        !state.registers.hoptActivated.has('HOPT_CAMELLIA_MILL')
      ) {
        const cyanosInDeck = pZones.deck.find(
          (c) => c.name.includes('Cyanos') || c.name.includes('Sky Striker')
        );
        if (cyanosInDeck) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_camellia_mill`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate Camellia -> Mill ${cyanosInDeck.name} from Deck to GY`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>MILL(DECK:${cyanosInDeck.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: cyanosInDeck.passcode, name: cyanosInDeck.name, fromLocation: 'DECK' }
          });
        }
      }

      // VALCan Booster search
      if (
        monster.name === 'R.B. VALCan Booster' &&
        !state.registers.hoptActivated.has('HOPT_VALCAN_SEARCH')
      ) {
        const rbSpells = pZones.deck.filter(
          (c) => c.name.includes('Funk Dock') || c.name.includes('Stage Landing')
        );
        for (const sp of rbSpells) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_valcan_search_${sp.passcode}`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate VALCan Booster -> Add ${sp.name} from Deck to hand`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>SEARCH(DECK:${sp.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: sp.passcode, name: sp.name, fromLocation: 'DECK' }
          });
        }
      }

      // VALCan Booster EMZ Revive
      if (
        monster.name === 'R.B. VALCan Booster' &&
        (zoneKey === 'EL' || zoneKey === 'ER') &&
        !state.registers.hoptActivated.has('HOPT_VALCAN_REVIVE')
      ) {
        const rbInGy = pZones.graveyard.filter(
          (c) => c.name.includes('Lambda Cannon') || c.name.includes('R.B.')
        );
        for (const target of rbInGy) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_valcan_revive_${target.passcode}`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate VALCan Booster in EMZ -> Special Summon ${target.name} from GY`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>SS(GY:${target.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: target.passcode, name: target.name, fromLocation: 'GRAVEYARD' }
          });
        }
      }

      // Lambda Cannon hand-rip & self-destruction
      if (
        monster.name === 'R.B. Lambda Cannon' &&
        !state.registers.hoptActivated.has('HOPT_LAMBDA_CANNON_PEEK')
      ) {
        actions.push({
          id: `ACT_M_${monster.instanceId}_lambda_cannon_peek`,
          verb: 'ACTIVATE_FIELD',
          description: `Activate Lambda Cannon -> Pay 1200 LP, destroy self, reveal opponent hand`,
          ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>PEEK_AND_POP`,
          sourceCard: monster,
          targetZone: zoneKey
        });
      }

      // Lambda Cannon salvage from GY on summon
      if (
        monster.name === 'R.B. Lambda Cannon' &&
        !state.registers.hoptActivated.has('HOPT_LAMBDA_CANNON_SALVAGE')
      ) {
        const rbInGy = pZones.graveyard.filter(
          (c) => c.name.includes('R.B.') && !c.name.includes('Lambda Cannon')
        );
        for (const target of rbInGy) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_lambda_cannon_salvage_${target.passcode}`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate Lambda Cannon -> Add ${target.name} from GY to hand`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>RETRIEVE(GY:${target.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: target.passcode, name: target.name, fromLocation: 'GRAVEYARD' }
          });
        }
      }

      // Lambda Blade mill
      if (
        monster.name === 'R.B. Lambda Blade' &&
        !state.registers.hoptActivated.has('HOPT_LAMBDA_BLADE_MILL')
      ) {
        const cutterInDeck = pZones.deck.find((c) => c.name.includes('Ga10 Cutter'));
        if (cutterInDeck) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_lambda_blade_mill`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate Lambda Blade -> Mill ${cutterInDeck.name} from Deck to GY`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>MILL(DECK:${cutterInDeck.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: cutterInDeck.passcode, name: cutterInDeck.name, fromLocation: 'DECK' }
          });
        }
      }

      // The Brute Blues search
      if (
        monster.name === 'R.B. The Brute Blues' &&
        !state.registers.hoptActivated.has('HOPT_BRUTE_BLUES_SEARCH')
      ) {
        const stageLanding = pZones.deck.find((c) => c.name.includes('Stage Landing'));
        if (stageLanding) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_brute_blues_search`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate The Brute Blues -> Add ${stageLanding.name} from Deck to hand`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>SEARCH(DECK:${stageLanding.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: stageLanding.passcode, name: stageLanding.name, fromLocation: 'DECK' }
          });
        }
      }

      // Shepherd's Crook set trap
      if (
        monster.name === "R.B. Shepherd's Crook" &&
        !state.registers.hoptActivated.has('HOPT_SHEPHERD_SET_TRAP')
      ) {
        const nextPhase = pZones.deck.find((c) => c.name.includes('Next Phase'));
        if (nextPhase) {
          actions.push({
            id: `ACT_M_${monster.instanceId}_shepherds_crook_set_trap`,
            verb: 'ACTIVATE_FIELD',
            description: `Activate Shepherd's Crook -> Set ${nextPhase.name} directly from Deck`,
            ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]>SET_TRAP(DECK:${nextPhase.name})`,
            sourceCard: monster,
            targetZone: zoneKey,
            targetSelection: { passcode: nextPhase.passcode, name: nextPhase.name, fromLocation: 'DECK' }
          });
        }
      }

      // General cardDef ignition
      cardDef?.effects?.forEach((eff, idx) => {
        if (eff.category === 'IGNITION' && eff.activationLocation.includes('FIELD_M')) {
          if (!eff.hoptGroup || !state.registers.hoptActivated.has(eff.hoptGroup)) {
            const canAffordCosts = eff.costs.every((c) => canPayCost(state, player, c, monster));
            if (canAffordCosts) {
              actions.push({
                id: `ACT_M_${monster.instanceId}_${zoneKey}_${idx}`,
                verb: 'ACTIVATE_FIELD',
                description: `Activate ${monster.name} effect on ${zoneKey}`,
                ygnNotation: `A(${zoneKey})[${monster.instanceId}:${monster.name}]`,
                sourceCard: monster,
                targetZone: zoneKey,
                effectIndex: idx
              });
            }
          }
        }
      });
    }
  }

  // Funk Dock Field Spell trigger float
  if (
    pZones.fieldSpell &&
    pZones.fieldSpell.name.includes('Funk Dock') &&
    !state.registers.hoptActivated.has('HOPT_FUNK_DOCK_FLOAT')
  ) {
    if (
      state.registers.lastDestroyedCard &&
      state.registers.lastDestroyedCard.name.includes('R.B.')
    ) {
      const bladeInDeck = pZones.deck.find((c) => c.name.includes('Lambda Blade'));
      if (bladeInDeck) {
        actions.push({
          id: `ACT_F_${pZones.fieldSpell.instanceId}_funk_dock_float`,
          verb: 'ACTIVATE_FIELD',
          description: `Activate Funk Dock -> Special Summon ${bladeInDeck.name} from Deck`,
          ygnNotation: `A(F)[${pZones.fieldSpell.instanceId}:R.B. Funk Dock]>SS(DECK:${bladeInDeck.name})`,
          sourceCard: pZones.fieldSpell,
          targetSelection: { passcode: bladeInDeck.passcode, name: bladeInDeck.name, fromLocation: 'DECK' }
        });
      }
    }
  }

  // 5. Graveyard Ignitions
  for (const gyCard of pZones.graveyard) {
    if (gyCard.name.includes('Cyanos') && !state.registers.hoptActivated.has('HOPT_CYANOS_GY')) {
      const rozeInGy = pZones.graveyard.find((c) => c.name.includes('Roze'));
      if (rozeInGy) {
        actions.push({
          id: `ACT_GY_${gyCard.instanceId}_cyanos_recycle`,
          verb: 'ACTIVATE_GY',
          description: `Banish Cyanos from GY -> Special Summon Roze from GY`,
          ygnNotation: `A(GY)[${gyCard.instanceId}:${gyCard.name}]>REVIVE(GY:${rozeInGy.name})`,
          sourceCard: gyCard,
          targetSelection: { passcode: rozeInGy.passcode, name: rozeInGy.name, fromLocation: 'GRAVEYARD' }
        });
      }
    }
  }

  // 6. Extra Deck Summons (Link & Xyz)
  const openEMZ = findAvailableEMZ(state, player);
  const openMMZ = findAvailableMMZ(state, player, registry);
  const targetSummonZone = openEMZ ?? openMMZ;

  if (targetSummonZone && !state.locks.cannotSpecialSummonFromExtra) {
    const activeMonsters = allFieldMonsters;

    for (const edCard of pZones.extraDeck) {
      const edDef = registry.getCardById(edCard.passcode) ?? registry.getCardByName(edCard.name);
      if (!edDef?.monsterAttributes) continue;
      const linkRating = edDef.monsterAttributes.linkRating;

      // Xyz Summon: 2 matching-level monsters
      if (!state.locks.lockedIntoLink && edDef.monsterAttributes.levelOrRank) {
        const requiredRank = edDef.monsterAttributes.levelOrRank;
        const matchingMaterials = activeMonsters.filter(
          (m) => (m.card.levelOrRank ?? 4) === requiredRank
        );

        if (matchingMaterials.length >= 2) {
          const mat1 = matchingMaterials[0]!;
          const mat2 = matchingMaterials[1]!;

          actions.push({
            id: `XYZ_${edCard.instanceId}_${mat1.card.instanceId}_${mat2.card.instanceId}`,
            verb: 'XYZ_SUMMON',
            description: `Xyz Summon ${edCard.name} using ${mat1.card.name} and ${mat2.card.name}`,
            ygnNotation: `X[${mat1.card.instanceId}:${mat1.zone}+${mat2.card.instanceId}:${mat2.zone}]>${targetSummonZone}[${edCard.instanceId}:${edCard.name}](atk)<ED`,
            sourceCard: edCard,
            targetZone: targetSummonZone,
            materialsUsed: [mat1.card, mat2.card]
          });
        }
      }

      // Link-1 Summon
      if (!state.locks.lockedIntoXyz && linkRating === 1) {
        for (const m of activeMonsters) {
          const mDef =
            registry.getCardById(m.card.passcode) ?? registry.getCardByName(m.card.name);
          let isLegal = false;

          if (edCard.name === 'Sky Striker Ace - Kagari') {
            isLegal =
              (mDef?.archetypes?.includes('Sky Striker') ||
                m.card.name.includes('Sky Striker') ||
                m.card.passcode === '52340445') &&
              mDef?.monsterAttributes?.attribute !== 'FIRE';
          } else if (edCard.name === 'Sky Striker Ace - Shizuku') {
            isLegal =
              (mDef?.archetypes?.includes('Sky Striker') ||
                m.card.name.includes('Sky Striker') ||
                m.card.passcode === '52340445') &&
              mDef?.monsterAttributes?.attribute !== 'WATER';
          } else if (edCard.name === 'Sky Striker Ace - Hayate') {
            isLegal =
              (mDef?.archetypes?.includes('Sky Striker') ||
                m.card.name.includes('Sky Striker') ||
                m.card.passcode === '52340445') &&
              mDef?.monsterAttributes?.attribute !== 'WIND';
          } else if (edCard.name.includes('Amatsu')) {
            isLegal =
              mDef?.archetypes?.includes('Sky Striker') || m.card.name.includes('Sky Striker');
          }

          if (isLegal) {
            const landingZone =
              m.zone === 'EL' || m.zone === 'ER' ? m.zone : (openEMZ ?? openMMZ);
            if (landingZone) {
              actions.push({
                id: `LINK1_${edCard.instanceId}_${m.card.instanceId}`,
                verb: 'LINK_SUMMON',
                description: `Link Summon ${edCard.name} using ${m.card.name}`,
                ygnNotation: `L[${m.card.instanceId}:${m.zone}]>${landingZone}[${edCard.instanceId}:${edCard.name}](atk)<ED`,
                sourceCard: edCard,
                targetZone: landingZone,
                materialsUsed: [m.card]
              });
            }
          }
        }
      }

      // Link-2 Summon: 2 matching materials
      if (!state.locks.lockedIntoXyz && linkRating === 2) {
        for (let i = 0; i < activeMonsters.length; i++) {
          for (let j = i + 1; j < activeMonsters.length; j++) {
            const m1 = activeMonsters[i]!;
            const m2 = activeMonsters[j]!;
            const m1Def =
              registry.getCardById(m1.card.passcode) ?? registry.getCardByName(m1.card.name);
            const m2Def =
              registry.getCardById(m2.card.passcode) ?? registry.getCardByName(m2.card.name);

            let isLegal = false;
            if (edCard.name === 'R.B. VALCan Booster') {
              const r1 =
                m1Def?.monsterAttributes?.race ??
                (m1.card.name.includes('R.B.') ||
                m1.card.name.includes('Cyanos') ||
                m1.card.name.includes('Camellia') ||
                m1.card.name.includes('Kagari') ||
                m1.card.name.includes('Shizuku')
                  ? 'Machine'
                  : undefined);
              const r2 =
                m2Def?.monsterAttributes?.race ??
                (m2.card.name.includes('R.B.') ||
                m2.card.name.includes('Cyanos') ||
                m2.card.name.includes('Camellia') ||
                m2.card.name.includes('Kagari') ||
                m2.card.name.includes('Shizuku')
                  ? 'Machine'
                  : undefined);
              isLegal = r1 === 'Machine' && r2 === 'Machine';
            } else if (edCard.name === 'Sky Striker Ace - Camellia') {
              const isSs1 =
                m1Def?.archetypes?.includes('Sky Striker') ||
                m1.card.name.includes('Sky Striker') ||
                m1.card.passcode === '52340445';
              const isSs2 =
                m2Def?.archetypes?.includes('Sky Striker') ||
                m2.card.name.includes('Sky Striker') ||
                m2.card.passcode === '52340445';
              isLegal = (isSs1 || isSs2) && m1.card.name !== m2.card.name;
            } else if (edCard.name === 'Barricadeborg Blocker') {
              isLegal = m1.card.name !== m2.card.name;
            }

            if (isLegal) {
              const freedEmz =
                m1.zone === 'EL' || m2.zone === 'EL'
                  ? 'EL'
                  : m1.zone === 'ER' || m2.zone === 'ER'
                    ? 'ER'
                    : undefined;
              const landingZone = freedEmz ?? openEMZ ?? openMMZ;
              if (landingZone) {
                actions.push({
                  id: `LINK2_${edCard.instanceId}_${m1.card.instanceId}_${m2.card.instanceId}`,
                  verb: 'LINK_SUMMON',
                  description: `Link Summon ${edCard.name} using ${m1.card.name} and ${m2.card.name}`,
                  ygnNotation: `L[${m1.card.instanceId}:${m1.zone}+${m2.card.instanceId}:${m2.zone}]>${landingZone}[${edCard.instanceId}:${edCard.name}](atk)<ED`,
                  sourceCard: edCard,
                  targetZone: landingZone,
                  materialsUsed: [m1.card, m2.card]
                });
              }
            }
          }
        }
      }

      // Link-3 Summon
      if (!state.locks.lockedIntoXyz && linkRating === 3) {
        for (const m1 of activeMonsters) {
          const m1Def =
            registry.getCardById(m1.card.passcode) ?? registry.getCardByName(m1.card.name);
          if (m1Def?.monsterAttributes?.linkRating === 2) {
            for (const m2 of activeMonsters) {
              if (m1.card.instanceId === m2.card.instanceId) continue;
              const m2Def =
                registry.getCardById(m2.card.passcode) ?? registry.getCardByName(m2.card.name);

              let isLegal = false;
              if (edCard.name === 'R.B. The Brute Blues') {
                const r1 = m1Def?.monsterAttributes?.race ?? 'Machine';
                const r2 = m2Def?.monsterAttributes?.race ?? 'Machine';
                isLegal = r1 === 'Machine' && r2 === 'Machine';
              } else if (edCard.name === "R.B. Shepherd's Crook") {
                const isRb1 = m1.card.name.includes('R.B.');
                const isRb2 = m2.card.name.includes('R.B.');
                isLegal = isRb1 || isRb2;
              }

              if (isLegal) {
                const freedEmz =
                  m1.zone === 'EL' || m2.zone === 'EL'
                    ? 'EL'
                    : m1.zone === 'ER' || m2.zone === 'ER'
                      ? 'ER'
                      : undefined;
                const preferredEmz =
                  edCard.name === 'R.B. The Brute Blues' &&
                  (!pZones.extraMonsters['ER'] || freedEmz === 'ER')
                    ? 'ER'
                    : undefined;
                const landingZone = preferredEmz ?? freedEmz ?? openEMZ ?? openMMZ;
                if (landingZone) {
                  actions.push({
                    id: `LINK3_${edCard.instanceId}_${m1.card.instanceId}_${m2.card.instanceId}`,
                    verb: 'LINK_SUMMON',
                    description: `Link Summon ${edCard.name} using ${m1.card.name} and ${m2.card.name}`,
                    ygnNotation: `L[${m1.card.instanceId}:${m1.zone}+${m2.card.instanceId}:${m2.zone}]>${landingZone}[${edCard.instanceId}:${edCard.name}](atk)<ED`,
                    sourceCard: edCard,
                    targetZone: landingZone,
                    materialsUsed: [m1.card, m2.card]
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return actions;
}

/**
 * Apply a discovered legal action to transition from state S to S'.
 */
export function applyAction(
  state: GameState,
  action: DiscoveredAction,
  player: 1 | 2 = state.turnPlayer,
  registry: CardRegistry = globalCardRegistry
): GameState {
  let next = cloneGameState(state);
  const pZones = player === 1 ? next.p1 : next.p2;

  switch (action.verb) {
    case 'NORMAL_SUMMON': {
      const targetZone = (action.targetZone as MainMonsterZoneId) || findAvailableMMZ(next, player);
      if (!targetZone) throw new Error('No available MMZ for Normal Summon');

      const handIdx = pZones.hand.findIndex((c) => c.instanceId === action.sourceCard.instanceId);
      if (handIdx !== -1) {
        const [card] = pZones.hand.splice(handIdx, 1);
        if (card) {
          card.position = 'atk';
          pZones.monsters[targetZone] = card;
        }
      }

      next.gates.normalSummonAvailable = false;
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'SET_SPELL_TRAP': {
      const targetZone = (action.targetZone as SpellTrapZoneId) || 'S1';
      const handIdx = pZones.hand.findIndex((c) => c.instanceId === action.sourceCard.instanceId);
      if (handIdx !== -1) {
        const [card] = pZones.hand.splice(handIdx, 1);
        if (card) {
          card.spellTrapState = 'set';
          card.turnSet = next.turn;
          pZones.spells[targetZone] = card;
        }
      }
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'SPECIAL_SUMMON': {
      const targetZone =
        (action.targetZone as MainMonsterZoneId) || findAvailableMMZ(next, player, registry);
      if (!targetZone) throw new Error('No available MMZ for Special Summon');

      const handIdx = pZones.hand.findIndex((c) => c.instanceId === action.sourceCard.instanceId);
      if (handIdx !== -1) {
        const [card] = pZones.hand.splice(handIdx, 1);
        if (card) {
          card.position = 'atk';
          pZones.monsters[targetZone] = card;
          next.registers.lastSummonedCard = cloneCardInstance(card);
          if (card.name === 'Sky Striker Ace - Roze') {
            next.registers.hoptActivated.add('HOPT_ROZE_SS');
          } else if (card.name === 'R.B. Ga10 Cutter') {
            next.registers.hoptActivated.add('HOPT_GA10_CUTTER_SS');
          }
        }
      }

      next.gates.specialSummonCount += 1;
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'ACTIVATE_HAND': {
      const cardDef =
        registry.getCardById(action.sourceCard.passcode) ??
        registry.getCardByName(action.sourceCard.name);
      const effect = cardDef?.effects[action.effectIndex ?? 0];

      // Remove card from hand
      const handIdx = pZones.hand.findIndex((c) => c.instanceId === action.sourceCard.instanceId);
      if (handIdx !== -1) {
        const [card] = pZones.hand.splice(handIdx, 1);
        if (card) {
          card.turnSentToGY = next.turn;
          pZones.graveyard.push(card);
          next.registers.cardsSentToGYThisTurn.add(card.instanceId || card.passcode);
        }
      }

      // Record HOPT
      if (effect?.hoptGroup) {
        next.registers.hoptActivated.add(effect.hoptGroup);
      }

      // 1. Hornet Drones -> Spawns Sky Striker Ace Token!
      if (action.sourceCard.name.includes('Hornet Drones')) {
        const openMMZ = findAvailableMMZ(next, player, registry);
        if (openMMZ) {
          const token: CardInstance = {
            instanceId: `#tok_${next.stepIndex}`,
            passcode: '52340445',
            name: 'Sky Striker Ace Token',
            cardType: 'MONSTER',
            levelOrRank: 1,
            position: 'def'
          };
          pZones.monsters[openMMZ] = token;
          next.gates.specialSummonCount += 1;
          next.registers.lastSummonedCard = cloneCardInstance(token);
        }
      }
      // 2. Funk Dock -> Placed in Field Spell zone and searches Stage Landing!
      else if (action.sourceCard.name.includes('Funk Dock')) {
        const fieldCard = cloneCardInstance(action.sourceCard);
        fieldCard.spellTrapState = 'face-up';
        pZones.fieldSpell = fieldCard;
        const slIdx = pZones.deck.findIndex((c) => c.name.includes('Stage Landing'));
        if (slIdx !== -1) {
          const [sl] = pZones.deck.splice(slIdx, 1);
          if (sl) pZones.hand.push(sl);
        }
      }
      // 3. Standard spell resolution
      else if (effect) {
        for (const cost of effect.costs) {
          next = applyCost(next, player, cost, action.sourceCard);
        }
        for (const res of effect.resolution) {
          if (res.type === 'SEARCH') {
            if (action.targetSelection) {
              const targetCode = action.targetSelection.passcode;
              const sourceLoc = action.targetSelection.fromLocation;
              let targetIdx = -1;
              if (sourceLoc === 'GRAVEYARD') {
                targetIdx = pZones.graveyard.findIndex((c) => c.passcode === targetCode);
                if (targetIdx !== -1) {
                  const [found] = pZones.graveyard.splice(targetIdx, 1);
                  if (found) pZones.hand.push(found);
                }
              } else {
                targetIdx = pZones.deck.findIndex((c) => c.passcode === targetCode);
                if (targetIdx !== -1) {
                  const [found] = pZones.deck.splice(targetIdx, 1);
                  if (found) pZones.hand.push(found);
                }
              }
            } else {
              const searchResult = applySearch(next, player, res.filter);
              next = searchResult.nextState;
            }
          } else if (res.type === 'SPECIAL_SUMMON') {
            if (action.targetSelection) {
              const targetCode = action.targetSelection.passcode;
              const sourceLoc = action.targetSelection.fromLocation;
              if (sourceLoc === 'EXTRA_DECK') {
                const edIdx = pZones.extraDeck.findIndex((c) => c.passcode === targetCode);
                if (edIdx !== -1) {
                  const cardToSS = pZones.extraDeck[edIdx]!;
                  const openEMZ = findAvailableEMZ(next, player);
                  const openMMZ = findAvailableMMZ(next, player, registry);
                  const targetZone = openEMZ ?? openMMZ;
                  if (targetZone) {
                    next = applySpecialSummon(next, player, cardToSS, targetZone, 'atk', 'EXTRA_DECK');
                    next.registers.lastSummonedCard = cloneCardInstance(cardToSS);
                  }
                }
              } else if (sourceLoc === 'GRAVEYARD') {
                const gyIdx = pZones.graveyard.findIndex((c) => c.passcode === targetCode);
                if (gyIdx !== -1) {
                  const cardToSS = pZones.graveyard[gyIdx]!;
                  const mmz = findAvailableMMZ(next, player, registry);
                  if (mmz) {
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'GRAVEYARD');
                    next.registers.lastSummonedCard = cloneCardInstance(cardToSS);
                  }
                }
              } else {
                const deckIdx = pZones.deck.findIndex((c) => c.passcode === targetCode);
                if (deckIdx !== -1) {
                  const cardToSS = pZones.deck[deckIdx]!;
                  const mmz = findAvailableMMZ(next, player, registry);
                  if (mmz) {
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'DECK');
                    next.registers.lastSummonedCard = cloneCardInstance(cardToSS);
                  }
                }
              }
            } else {
              const count = res.count ?? 1;
              for (let i = 0; i < count; i++) {
                const mmz = findAvailableMMZ(next, player, registry);
                if (mmz && pZones.deck.length > 0) {
                  const deckIdx = pZones.deck.findIndex((c) => matchesCardFilter(c, res.filter));
                  if (deckIdx !== -1) {
                    const cardToSS = pZones.deck[deckIdx]!;
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'DECK');
                    next.registers.lastSummonedCard = cloneCardInstance(cardToSS);
                  }
                }
              }
            }
          }
        }
      }

      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'ACTIVATE_FIELD': {
      // 1. Kagari salvage
      if (action.sourceCard.name === 'Sky Striker Ace - Kagari' && action.targetSelection) {
        const gyIdx = pZones.graveyard.findIndex(
          (c) => c.passcode === action.targetSelection!.passcode
        );
        if (gyIdx !== -1) {
          const [sp] = pZones.graveyard.splice(gyIdx, 1);
          if (sp) pZones.hand.push(sp);
        }
        next.registers.hoptActivated.add('HOPT_KAGARI_SALVAGE');
      }
      // 2. Camellia mill
      else if (action.sourceCard.name === 'Sky Striker Ace - Camellia' && action.targetSelection) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        if (dIdx !== -1) {
          const [milled] = pZones.deck.splice(dIdx, 1);
          if (milled) {
            milled.turnSentToGY = next.turn;
            pZones.graveyard.push(milled);
            next.registers.cardsSentToGYThisTurn.add(milled.instanceId || milled.passcode);
          }
        }
        next.registers.hoptActivated.add('HOPT_CAMELLIA_MILL');
      }
      // 3. VALCan Booster search
      else if (
        action.sourceCard.name === 'R.B. VALCan Booster' &&
        action.id.includes('valcan_search') &&
        action.targetSelection
      ) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        if (dIdx !== -1) {
          const [searched] = pZones.deck.splice(dIdx, 1);
          if (searched) pZones.hand.push(searched);
        }
        next.registers.hoptActivated.add('HOPT_VALCAN_SEARCH');
      }
      // 4. VALCan Booster revive from GY and shift zone
      else if (
        action.sourceCard.name === 'R.B. VALCan Booster' &&
        action.id.includes('valcan_revive') &&
        action.targetSelection
      ) {
        const gyIdx = pZones.graveyard.findIndex(
          (c) => c.passcode === action.targetSelection!.passcode
        );
        if (gyIdx !== -1) {
          const [revived] = pZones.graveyard.splice(gyIdx, 1);
          const mmz = findAvailableMMZ(next, player, registry);
          if (revived && mmz) {
            revived.position = 'def';
            pZones.monsters[mmz] = revived;
            next.registers.lastSummonedCard = cloneCardInstance(revived);
            next.gates.specialSummonCount += 1;
          }
        }
        const emzKey =
          pZones.extraMonsters['EL']?.instanceId === action.sourceCard.instanceId
            ? 'EL'
            : pZones.extraMonsters['ER']?.instanceId === action.sourceCard.instanceId
              ? 'ER'
              : undefined;
        if (emzKey) {
          const b = pZones.extraMonsters[emzKey]!;
          delete pZones.extraMonsters[emzKey];
          const newMmz = findAvailableMMZ(next, player, registry);
          if (newMmz) pZones.monsters[newMmz] = b;
        }
        next.registers.hoptActivated.add('HOPT_VALCAN_REVIVE');
      }
      // 5. Lambda Cannon hand-rip & self-destruction
      else if (
        action.sourceCard.name === 'R.B. Lambda Cannon' &&
        action.id.includes('lambda_cannon_peek')
      ) {
        next.lifePoints.player1 = Math.max(0, next.lifePoints.player1 - 1200);
        for (const [z, m] of Object.entries(pZones.monsters) as [
          MainMonsterZoneId,
          CardInstance | undefined
        ][]) {
          if (m && m.instanceId === action.sourceCard.instanceId) {
            delete pZones.monsters[z];
            m.turnSentToGY = next.turn;
            pZones.graveyard.push(cloneCardInstance(m));
            next.registers.cardsSentToGYThisTurn.add(m.instanceId || m.passcode);
            next.registers.lastDestroyedCard = cloneCardInstance(m);
            break;
          }
        }
        next.registers.hoptActivated.add('HOPT_LAMBDA_CANNON_PEEK');
      }
      // 6. Funk Dock float trigger
      else if (action.sourceCard.name.includes('Funk Dock') && action.targetSelection) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        if (dIdx !== -1) {
          const [blade] = pZones.deck.splice(dIdx, 1);
          const mmz = findAvailableMMZ(next, player, registry);
          if (blade && mmz) {
            blade.position = 'atk';
            pZones.monsters[mmz] = blade;
            next.registers.lastSummonedCard = cloneCardInstance(blade);
            next.gates.specialSummonCount += 1;
          }
        }
        next.registers.hoptActivated.add('HOPT_FUNK_DOCK_FLOAT');
      }
      // 7. Lambda Blade mill
      else if (action.sourceCard.name === 'R.B. Lambda Blade' && action.targetSelection) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        if (dIdx !== -1) {
          const [milled] = pZones.deck.splice(dIdx, 1);
          if (milled) {
            milled.turnSentToGY = next.turn;
            pZones.graveyard.push(milled);
            next.registers.cardsSentToGYThisTurn.add(milled.instanceId || milled.passcode);
          }
        }
        next.registers.hoptActivated.add('HOPT_LAMBDA_BLADE_MILL');
      }
      // 8. Lambda Cannon salvage from GY
      else if (
        action.sourceCard.name === 'R.B. Lambda Cannon' &&
        action.id.includes('lambda_cannon_salvage') &&
        action.targetSelection
      ) {
        const gyIdx = pZones.graveyard.findIndex(
          (c) => c.passcode === action.targetSelection!.passcode
        );
        if (gyIdx !== -1) {
          const [cutter] = pZones.graveyard.splice(gyIdx, 1);
          if (cutter) pZones.hand.push(cutter);
        }
        next.registers.hoptActivated.add('HOPT_LAMBDA_CANNON_SALVAGE');
      }
      // 9. The Brute Blues search
      else if (action.sourceCard.name === 'R.B. The Brute Blues' && action.targetSelection) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        if (dIdx !== -1) {
          const [sl] = pZones.deck.splice(dIdx, 1);
          if (sl) pZones.hand.push(sl);
        }
        next.registers.hoptActivated.add('HOPT_BRUTE_BLUES_SEARCH');
      }
      // 10. Shepherd's Crook set trap
      else if (action.sourceCard.name === "R.B. Shepherd's Crook" && action.targetSelection) {
        const dIdx = pZones.deck.findIndex((c) => c.passcode === action.targetSelection!.passcode);
        const openSTZ: SpellTrapZoneId | undefined = (
          ['S1', 'S2', 'S3', 'S4', 'S5'] as SpellTrapZoneId[]
        ).find((z) => !pZones.spells[z]);
        if (dIdx !== -1 && openSTZ) {
          const [trap] = pZones.deck.splice(dIdx, 1);
          if (trap) {
            trap.spellTrapState = 'set';
            trap.turnSet = next.turn;
            pZones.spells[openSTZ] = trap;
          }
        }
        next.registers.hoptActivated.add('HOPT_SHEPHERD_SET_TRAP');
      }
      // 11. Generic cardDef effects
      else {
        const cardDef =
          registry.getCardById(action.sourceCard.passcode) ??
          registry.getCardByName(action.sourceCard.name);
        const effect = cardDef?.effects[action.effectIndex ?? 0];

        if (effect?.hoptGroup) {
          next.registers.hoptActivated.add(effect.hoptGroup);
        }

        if (effect) {
          for (const cost of effect.costs) {
            next = applyCost(next, player, cost, action.sourceCard);
          }
          for (const res of effect.resolution) {
            if (res.type === 'SEARCH') {
              const searchResult = applySearch(next, player, res.filter);
              next = searchResult.nextState;
            }
          }
        }
      }

      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'ACTIVATE_GY': {
      // Banish self from GY, revive target
      const gyIdx = pZones.graveyard.findIndex(
        (c) => c.instanceId === action.sourceCard.instanceId
      );
      if (gyIdx !== -1) {
        const [banished] = pZones.graveyard.splice(gyIdx, 1);
        if (banished) {
          pZones.banished.push(banished);
        }
      }

      if (action.targetSelection && action.targetSelection.fromLocation === 'GRAVEYARD') {
        const targetIdx = pZones.graveyard.findIndex(
          (c) => c.passcode === action.targetSelection!.passcode
        );
        if (targetIdx !== -1) {
          const [revived] = pZones.graveyard.splice(targetIdx, 1);
          const mmz = findAvailableMMZ(next, player, registry);
          if (revived && mmz) {
            revived.position = 'atk';
            pZones.monsters[mmz] = revived;
            next.registers.lastSummonedCard = cloneCardInstance(revived);
            next.gates.specialSummonCount += 1;
          }
        }
      }

      next.registers.hoptActivated.add('HOPT_CYANOS_GY');
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'XYZ_SUMMON': {
      const targetZone = action.targetZone || findAvailableMMZ(next, player);
      if (!targetZone) throw new Error('No available zone for Xyz Summon');

      // Remove materials from field
      const materials: CardInstance[] = [];
      if (action.materialsUsed) {
        for (const mat of action.materialsUsed) {
          for (const [z, m] of Object.entries(pZones.monsters) as [
            MainMonsterZoneId,
            CardInstance | undefined
          ][]) {
            if (m && m.instanceId === mat.instanceId) {
              delete pZones.monsters[z];
              materials.push(cloneCardInstance(m));
              break;
            }
          }
        }
      }

      // Remove Xyz monster from Extra Deck
      const edIdx = pZones.extraDeck.findIndex(
        (c) => c.instanceId === action.sourceCard.instanceId
      );
      if (edIdx !== -1) {
        const [xyzCard] = pZones.extraDeck.splice(edIdx, 1);
        if (xyzCard) {
          xyzCard.position = 'atk';
          xyzCard.materials = materials;
          if (targetZone === 'EL' || targetZone === 'ER') {
            pZones.extraMonsters[targetZone] = xyzCard;
          } else if (targetZone in pZones.monsters || targetZone.startsWith('M')) {
            pZones.monsters[targetZone as MainMonsterZoneId] = xyzCard;
          }
        }
      }

      next.gates.specialSummonCount += 1;
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'LINK_SUMMON': {
      const targetZone =
        action.targetZone ||
        findAvailableEMZ(next, player) ||
        findAvailableMMZ(next, player, registry);
      if (!targetZone) throw new Error('No available zone for Link Summon');

      // Send materials to GY (from MMZ or EMZ)
      if (action.materialsUsed) {
        for (const mat of action.materialsUsed) {
          let found = false;
          for (const [z, m] of Object.entries(pZones.monsters) as [
            MainMonsterZoneId,
            CardInstance | undefined
          ][]) {
            if (m && m.instanceId === mat.instanceId) {
              delete pZones.monsters[z];
              m.turnSentToGY = next.turn;
              pZones.graveyard.push(cloneCardInstance(m));
              next.registers.cardsSentToGYThisTurn.add(m.instanceId || m.passcode);
              found = true;
              break;
            }
          }
          if (!found) {
            for (const [z, m] of Object.entries(pZones.extraMonsters) as [
              ExtraMonsterZoneId,
              CardInstance | undefined
            ][]) {
              if (m && m.instanceId === mat.instanceId) {
                delete pZones.extraMonsters[z];
                m.turnSentToGY = next.turn;
                pZones.graveyard.push(cloneCardInstance(m));
                next.registers.cardsSentToGYThisTurn.add(m.instanceId || m.passcode);
                break;
              }
            }
          }
        }
      }

      // Place Link monster from Extra Deck
      const edIdx = pZones.extraDeck.findIndex(
        (c) => c.instanceId === action.sourceCard.instanceId
      );
      if (edIdx !== -1) {
        const [linkCard] = pZones.extraDeck.splice(edIdx, 1);
        if (linkCard) {
          linkCard.position = 'atk';
          if (targetZone === 'EL' || targetZone === 'ER') {
            pZones.extraMonsters[targetZone] = linkCard;
          } else if (targetZone in pZones.monsters || targetZone.startsWith('M')) {
            pZones.monsters[targetZone as MainMonsterZoneId] = linkCard;
          }
          next.registers.lastSummonedCard = cloneCardInstance(linkCard);
        }
      }

      next.gates.specialSummonCount += 1;
      next.stepIndex += 1;
      next.actionTaken = action.ygnNotation;
      break;
    }

    case 'ADVANCE_PHASE':
      next.stepIndex += 1;
      break;
  }

  return next;
}
