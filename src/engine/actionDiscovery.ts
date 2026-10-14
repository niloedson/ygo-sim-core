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

                    for (const candidate of sourceList) {
                      if (matchesCardFilter(candidate, targetedRes.filter)) {
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

  // 3. Field Monster Ignition Activations
  for (const [zoneKey, monster] of Object.entries(pZones.monsters) as [
    MainMonsterZoneId,
    CardInstance | undefined
  ][]) {
    if (monster && !monster.isNegated) {
      const cardDef =
        registry.getCardById(monster.passcode) ?? registry.getCardByName(monster.name);
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

  // 4. Extra Deck Summons (Link & Xyz)
  const openEMZ = findAvailableEMZ(state, player);
  const openMMZ = findAvailableMMZ(state, player);
  const targetSummonZone = openEMZ ?? openMMZ;

  if (targetSummonZone && !state.locks.cannotSpecialSummonFromExtra) {
    const activeMonsters = Object.entries(pZones.monsters)
      .filter(([, m]) => m !== undefined)
      .map(([z, m]) => ({ zone: z as MainMonsterZoneId, card: m! }));

    for (const edCard of pZones.extraDeck) {
      const edDef = registry.getCardById(edCard.passcode) ?? registry.getCardByName(edCard.name);
      if (!edDef?.monsterAttributes) continue;

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

      // Link Summon: 2 matching materials
      if (!state.locks.lockedIntoXyz && edDef.monsterAttributes.linkRating === 2) {
        if (activeMonsters.length >= 2) {
          const mat1 = activeMonsters[0]!;
          const mat2 = activeMonsters[1]!;

          actions.push({
            id: `LINK_${edCard.instanceId}_${mat1.card.instanceId}_${mat2.card.instanceId}`,
            verb: 'LINK_SUMMON',
            description: `Link Summon ${edCard.name} using ${mat1.card.name} and ${mat2.card.name}`,
            ygnNotation: `L[${mat1.card.instanceId}:${mat1.zone}+${mat2.card.instanceId}:${mat2.zone}]>${targetSummonZone}[${edCard.instanceId}:${edCard.name}](atk)<ED`,
            sourceCard: edCard,
            targetZone: targetSummonZone,
            materialsUsed: [mat1.card, mat2.card]
          });
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

      // Pay costs and execute resolution operations
      if (effect) {
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
                  const openMMZ = findAvailableMMZ(next, player);
                  const targetZone = openEMZ ?? openMMZ;
                  if (targetZone) {
                    next = applySpecialSummon(next, player, cardToSS, targetZone, 'atk', 'EXTRA_DECK');
                  }
                }
              } else if (sourceLoc === 'GRAVEYARD') {
                const gyIdx = pZones.graveyard.findIndex((c) => c.passcode === targetCode);
                if (gyIdx !== -1) {
                  const cardToSS = pZones.graveyard[gyIdx]!;
                  const mmz = findAvailableMMZ(next, player);
                  if (mmz) {
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'GRAVEYARD');
                  }
                }
              } else {
                // From DECK
                const deckIdx = pZones.deck.findIndex((c) => c.passcode === targetCode);
                if (deckIdx !== -1) {
                  const cardToSS = pZones.deck[deckIdx]!;
                  const mmz = findAvailableMMZ(next, player);
                  if (mmz) {
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'DECK');
                  }
                }
              }
            } else {
              const count = res.count ?? 1;
              for (let i = 0; i < count; i++) {
                const mmz = findAvailableMMZ(next, player);
                if (mmz && pZones.deck.length > 0) {
                  const deckIdx = pZones.deck.findIndex((c) => matchesCardFilter(c, res.filter));
                  if (deckIdx !== -1) {
                    const cardToSS = pZones.deck[deckIdx]!;
                    next = applySpecialSummon(next, player, cardToSS, mmz, 'atk', 'DECK');
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
        action.targetZone || findAvailableEMZ(next, player) || findAvailableMMZ(next, player);
      if (!targetZone) throw new Error('No available zone for Link Summon');

      // Send materials to GY
      if (action.materialsUsed) {
        for (const mat of action.materialsUsed) {
          for (const [z, m] of Object.entries(pZones.monsters) as [
            MainMonsterZoneId,
            CardInstance | undefined
          ][]) {
            if (m && m.instanceId === mat.instanceId) {
              delete pZones.monsters[z];
              m.turnSentToGY = next.turn;
              pZones.graveyard.push(cloneCardInstance(m));
              next.registers.cardsSentToGYThisTurn.add(m.instanceId || m.passcode);
              break;
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
