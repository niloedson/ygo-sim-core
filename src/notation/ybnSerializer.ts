/**
 * @file ybnSerializer.ts
 * @description Bidirectional RFC 0001 Yu-Gi-Oh! Board Notation (YBN) Serializer and Parser.
 */

import {
  GameState,
  YBNString,
  PlayerZones,
  CardInstance,
  TurnPhase,
  MonsterPosition,
  SpellTrapPosition,
  MainMonsterZoneId,
  SpellTrapZoneId,
  createInitialGameState,
  createEmptyPlayerZones
} from '../types/state.js';

/**
 * Format a single CardInstance for a monster zone.
 * Example: "#e1:Genius(atk)" or "#e2:River Stormer(atk){#3,#4}" or "Token(def)"
 */
export function formatMonsterCard(card: CardInstance): string {
  const pos: MonsterPosition = card.position || 'atk';
  const prefix = card.instanceId
    ? card.instanceId.startsWith('#')
      ? card.instanceId
      : `#${card.instanceId}`
    : '';
  const label = prefix ? (card.name ? `${prefix}:${card.name}` : prefix) : card.name || 'Unknown';

  let matStr = '';
  if (card.materials && card.materials.length > 0) {
    const mats = card.materials.map((m) =>
      m.instanceId ? (m.instanceId.startsWith('#') ? m.instanceId : `#${m.instanceId}`) : m.name
    );
    matStr = `{${mats.join(',')}}`;
  }

  return `${label}(${pos})${matStr}`;
}

/**
 * Format a single CardInstance for a spell/trap zone.
 * Example: "#5:Purge(set)" or "#5:Purge" or "(set)"
 */
export function formatSpellCard(card: CardInstance): string {
  const prefix = card.instanceId
    ? card.instanceId.startsWith('#')
      ? card.instanceId
      : `#${card.instanceId}`
    : '';
  const label = prefix ? (card.name ? `${prefix}:${card.name}` : prefix) : card.name || '';

  if (card.spellTrapState === 'set') {
    return label ? `${label}(set)` : '(set)';
  }
  return label || '(face-up)';
}

/**
 * Format a pile card instance (GY / Banished / Hand).
 * Example: "#4:Harvester" or "#1:Exceptional"
 */
export function formatPileCard(card: CardInstance): string {
  const prefix = card.instanceId
    ? card.instanceId.startsWith('#')
      ? card.instanceId
      : `#${card.instanceId}`
    : '';
  if (prefix && card.name) return `${prefix}:${card.name}`;
  if (prefix) return prefix;
  return card.name || 'Card';
}

/**
 * Serialize a PlayerZones structure into a comma-delimited RFC 0001 zone string.
 */
export function serializePlayerZones(zones: PlayerZones): string {
  const parts: string[] = [];

  // Extra Monster Zones first if present (ER, EL)
  if (zones.extraMonsters.ER) {
    parts.push(`ER[${formatMonsterCard(zones.extraMonsters.ER)}]`);
  }
  if (zones.extraMonsters.EL) {
    parts.push(`EL[${formatMonsterCard(zones.extraMonsters.EL)}]`);
  }

  // Main Monster Zones M1..M5
  const mmzKeys: MainMonsterZoneId[] = ['M1', 'M2', 'M3', 'M4', 'M5'];
  for (const k of mmzKeys) {
    const monster = zones.monsters[k];
    if (monster) {
      parts.push(`${k}[${formatMonsterCard(monster)}]`);
    }
  }

  // Dedicated Field Spell Zone F
  if (zones.fieldSpell) {
    parts.push(`F[${formatSpellCard(zones.fieldSpell)}]`);
  }

  // Spell & Trap Zones S1..S5
  const stKeys: SpellTrapZoneId[] = ['S1', 'S2', 'S3', 'S4', 'S5'];
  for (const k of stKeys) {
    const spell = zones.spells[k];
    if (spell) {
      parts.push(`${k}[${formatSpellCard(spell)}]`);
    }
  }

  // Graveyard
  if (zones.graveyard.length > 0) {
    const gyCards = zones.graveyard.map(formatPileCard).join(',');
    parts.push(`GY:[${gyCards}]`);
  }

  // Banished
  if (zones.banished.length > 0) {
    const bCards = zones.banished
      .map((c) => {
        const base = formatPileCard(c);
        return c.isFaceDownBanished ? `${base}(fd)` : base;
      })
      .join(',');
    parts.push(`B:[${bCards}]`);
  }

  // Hand: count H:<int> or explicit list H:[...]
  if (zones.hand.length > 0) {
    const isExplicitCard = (c: CardInstance) =>
      c.name && !c.name.startsWith('Unknown Card') && c.name !== 'Card';
    const hasExplicitCards = zones.hand.some(isExplicitCard);

    if (hasExplicitCards) {
      parts.push(`H:[${zones.hand.map(formatPileCard).join(',')}]`);
    } else {
      parts.push(`H:${zones.hand.length}`);
    }
  }

  // Main Deck remaining count
  if (zones.deck.length > 0) {
    parts.push(`D:${zones.deck.length}`);
  }

  // Extra Deck remaining count
  if (zones.extraDeck.length > 0) {
    parts.push(`ED:${zones.extraDeck.length}`);
  }

  return parts.join(',');
}

/**
 * Serialize OperationalGates & LingeringRestrictions into RFC 0001 G: string.
 */
export function serializeGates(state: GameState): string {
  const parts: string[] = [];

  // Normal Summon available flag
  parts.push(`NS=${state.gates.normalSummonAvailable ? 1 : 0}`);

  // Special summon count
  if (state.gates.specialSummonCount > 0) {
    parts.push(`SS=${state.gates.specialSummonCount}`);
  }

  // Attacks declared
  if (state.gates.attacksDeclared > 0) {
    parts.push(`ATK=${state.gates.attacksDeclared}`);
  }

  // Lingering Locks
  if (state.locks.lockedIntoFire) parts.push('LOCK_FIRE');
  if (state.locks.lockedIntoXyz) parts.push('LOCK_XYZ');
  if (state.locks.lockedIntoLink) parts.push('LOCK_LINK');
  if (state.locks.lockedIntoMachine) parts.push('LOCK_MACHINE');
  if (state.locks.cannotSpecialSummonFromExtra) parts.push('LOCK_NO_EXTRA');
  if (state.locks.opponentDrawsOnSpecialSummon) {
    parts.push('LING(o.+H<D on S<H>)');
  }

  return parts.join(',');
}

/**
 * Serialize full GameState to RFC 0001 YBN string.
 * Format: "T<turn>|<phase>|LP<P1>:<P2>|P1:<zones>|P2:<zones>|G:<gates>"
 */
export function serializeToYBN(state: GameState): YBNString {
  const turnStr = `T${state.turn}`;
  const phaseStr = state.phase;
  const lpStr = `LP${state.lifePoints.player1}:${state.lifePoints.player2}`;
  const p1Str = `P1:${serializePlayerZones(state.p1)}`;
  const p2Str = `P2:${serializePlayerZones(state.p2)}`;
  const gStr = `G:${serializeGates(state)}`;

  return `${turnStr}|${phaseStr}|${lpStr}|${p1Str}|${p2Str}|${gStr}`;
}

/**
 * Helper to parse a card description like "#e1:Genius(atk){#3,#4}" or "Token(def)"
 */
export function parseMonsterCardString(desc: string): CardInstance {
  let working = desc.trim();
  const materials: CardInstance[] = [];

  // Check for materials {#m1,#m2}
  const matMatch = working.match(/\{(.*?)\}$/);
  if (matMatch && matMatch[1] !== undefined) {
    const matTokens = matMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const token of matTokens) {
      materials.push({
        instanceId: token,
        passcode: '',
        name: token.replace(/^#/, ''),
        cardType: 'MONSTER'
      });
    }
    working = working.slice(0, working.indexOf('{')).trim();
  }

  // Check for position (atk|def|set)
  let position: MonsterPosition = 'atk';
  const posMatch = working.match(/\((atk|def|set)\)$/);
  if (posMatch && posMatch[1]) {
    position = posMatch[1] as MonsterPosition;
    working = working.slice(0, working.indexOf('(')).trim();
  }

  // Parse instanceId and name: "#e1:Genius" or "Token"
  let instanceId = '';
  let name = working;
  if (working.includes(':')) {
    const colonIdx = working.indexOf(':');
    instanceId = working.slice(0, colonIdx).trim();
    name = working.slice(colonIdx + 1).trim();
  } else if (working.startsWith('#')) {
    instanceId = working;
    name = working.replace(/^#/, '');
  }

  return {
    instanceId,
    passcode: '',
    name,
    cardType: 'MONSTER',
    position,
    materials: materials.length > 0 ? materials : undefined
  };
}

/**
 * Helper to parse a spell/trap description like "#5:Purge(set)" or "(set)" or "#5:Purge"
 */
export function parseSpellCardString(desc: string): CardInstance {
  let working = desc.trim();
  let state: SpellTrapPosition = 'face-up';

  if (working.endsWith('(set)')) {
    state = 'set';
    working = working.slice(0, -5).trim();
  } else if (working === '(set)') {
    return {
      instanceId: '',
      passcode: '',
      name: 'Set Spell/Trap',
      cardType: 'SPELL',
      spellTrapState: 'set'
    };
  } else if (working.endsWith('(face-up)')) {
    state = 'face-up';
    working = working.slice(0, -9).trim();
  }

  let instanceId = '';
  let name = working;
  if (working.includes(':')) {
    const colonIdx = working.indexOf(':');
    instanceId = working.slice(0, colonIdx).trim();
    name = working.slice(colonIdx + 1).trim();
  } else if (working.startsWith('#')) {
    instanceId = working;
    name = working.replace(/^#/, '');
  }

  return {
    instanceId,
    passcode: '',
    name,
    cardType: 'SPELL',
    spellTrapState: state
  };
}

/**
 * Helper to parse a pile item like "#1:Exceptional" or "Token"
 */
export function parsePileItemString(item: string): CardInstance {
  const trimmed = item.trim();
  let instanceId = '';
  let name = trimmed;
  let isFaceDownBanished = false;

  let clean = trimmed;
  if (clean.endsWith('(fd)')) {
    isFaceDownBanished = true;
    clean = clean.slice(0, -4).trim();
  }

  if (clean.includes(':')) {
    const idx = clean.indexOf(':');
    instanceId = clean.slice(0, idx).trim();
    name = clean.slice(idx + 1).trim();
  } else if (clean.startsWith('#')) {
    instanceId = clean;
    name = clean.replace(/^#/, '');
  }

  return {
    instanceId,
    passcode: '',
    name,
    cardType: 'MONSTER', // default representation
    isFaceDownBanished
  };
}

/**
 * Parse a zone string (from P1: or P2:) into a PlayerZones object.
 */
export function parsePlayerZones(zoneString: string): PlayerZones {
  const zones = createEmptyPlayerZones();
  if (!zoneString || zoneString.trim() === '') return zones;

  // Split tokens while respecting nested brackets [ ... ]
  const tokens: string[] = [];
  let bracketDepth = 0;
  let currentToken = '';

  for (let i = 0; i < zoneString.length; i++) {
    const char = zoneString[i];
    if (char === '[') {
      bracketDepth++;
      currentToken += char;
    } else if (char === ']') {
      bracketDepth--;
      currentToken += char;
    } else if (char === ',' && bracketDepth === 0) {
      if (currentToken.trim()) tokens.push(currentToken.trim());
      currentToken = '';
    } else {
      currentToken += char;
    }
  }
  if (currentToken.trim()) tokens.push(currentToken.trim());

  for (const token of tokens) {
    // 1. Extra Monster Zones
    if (token.startsWith('ER[') && token.endsWith(']')) {
      const content = token.slice(3, -1);
      zones.extraMonsters.ER = parseMonsterCardString(content);
      continue;
    }
    if (token.startsWith('EL[') && token.endsWith(']')) {
      const content = token.slice(3, -1);
      zones.extraMonsters.EL = parseMonsterCardString(content);
      continue;
    }

    // 2. Main Monster Zones
    const mmzMatch = token.match(/^(M[1-5])\[(.*)\]$/);
    if (mmzMatch && mmzMatch[1] && mmzMatch[2]) {
      const zoneId = mmzMatch[1] as MainMonsterZoneId;
      zones.monsters[zoneId] = parseMonsterCardString(mmzMatch[2]);
      continue;
    }

    // 3. Field Spell Zone
    if (token.startsWith('F[') && token.endsWith(']')) {
      const content = token.slice(2, -1);
      zones.fieldSpell = parseSpellCardString(content);
      continue;
    }

    // 4. Spell/Trap Zones
    const stMatch = token.match(/^(S[1-5])\[(.*)\]$/);
    if (stMatch && stMatch[1] && stMatch[2]) {
      const zoneId = stMatch[1] as SpellTrapZoneId;
      zones.spells[zoneId] = parseSpellCardString(stMatch[2]);
      continue;
    }

    // 5. Graveyard
    if (token.startsWith('GY:[') && token.endsWith(']')) {
      const content = token.slice(4, -1);
      const items = content
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      zones.graveyard = items.map(parsePileItemString);
      continue;
    }

    // 6. Banished
    if (token.startsWith('B:[') && token.endsWith(']')) {
      const content = token.slice(3, -1);
      const items = content
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      zones.banished = items.map(parsePileItemString);
      continue;
    }

    // 7. Hand: either count H:<int> or explicit list H:[...]
    if (token.startsWith('H:[')) {
      const content = token.slice(3, -1);
      const items = content
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      zones.hand = items.map(parsePileItemString);
      continue;
    }
    const hMatch = token.match(/^H:(\d+)$/);
    if (hMatch && hMatch[1]) {
      const count = parseInt(hMatch[1], 10);
      zones.hand = Array.from({ length: count }, (_, i) => ({
        instanceId: `#h${i + 1}`,
        passcode: '',
        name: `Unknown Card ${i + 1}`,
        cardType: 'MONSTER'
      }));
      continue;
    }

    // 8. Main Deck count
    const dMatch = token.match(/^D:(\d+)$/);
    if (dMatch && dMatch[1]) {
      const count = parseInt(dMatch[1], 10);
      zones.deck = Array.from({ length: count }, (_, i) => ({
        instanceId: `#d${i + 1}`,
        passcode: '',
        name: `Deck Card ${i + 1}`,
        cardType: 'MONSTER'
      }));
      continue;
    }

    // 9. Extra Deck count
    const edMatch = token.match(/^ED:(\d+)$/);
    if (edMatch && edMatch[1]) {
      const count = parseInt(edMatch[1], 10);
      zones.extraDeck = Array.from({ length: count }, (_, i) => ({
        instanceId: `#ed${i + 1}`,
        passcode: '',
        name: `Extra Deck Card ${i + 1}`,
        cardType: 'MONSTER'
      }));
      continue;
    }
  }

  return zones;
}

/**
 * Parse an RFC 0001 YBN snapshot string into a full GameState tuple.
 */
export function parseFromYBN(ybn: YBNString): GameState {
  const parts = ybn.split('|');
  const state = createInitialGameState();

  for (const part of parts) {
    const trimmed = part.trim();

    // Turn: T<int>
    if (/^T\d+$/.test(trimmed)) {
      state.turn = parseInt(trimmed.slice(1), 10);
      continue;
    }

    // Phase: DP | SP | M1 | BP | M2 | EP
    if (['DP', 'SP', 'M1', 'BP', 'M2', 'EP'].includes(trimmed)) {
      state.phase = trimmed as TurnPhase;
      continue;
    }

    // LP: LP<int>:<int>
    const lpMatch = trimmed.match(/^LP(\d+):(\d+)$/);
    if (lpMatch && lpMatch[1] && lpMatch[2]) {
      state.lifePoints.player1 = parseInt(lpMatch[1], 10);
      state.lifePoints.player2 = parseInt(lpMatch[2], 10);
      continue;
    }

    // Player 1 zones: P1:<zones>
    if (trimmed.startsWith('P1:')) {
      state.p1 = parsePlayerZones(trimmed.slice(3));
      continue;
    }

    // Player 2 zones: P2:<zones>
    if (trimmed.startsWith('P2:')) {
      state.p2 = parsePlayerZones(trimmed.slice(3));
      continue;
    }

    // Gates: G:<gates>
    if (trimmed.startsWith('G:')) {
      const gateTokens = trimmed
        .slice(2)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const token of gateTokens) {
        if (token === 'NS=1') state.gates.normalSummonAvailable = true;
        else if (token === 'NS=0') state.gates.normalSummonAvailable = false;
        else if (token.startsWith('SS='))
          state.gates.specialSummonCount = parseInt(token.slice(3), 10);
        else if (token.startsWith('ATK='))
          state.gates.attacksDeclared = parseInt(token.slice(4), 10);
        else if (token === 'LOCK_FIRE') state.locks.lockedIntoFire = true;
        else if (token === 'LOCK_XYZ') state.locks.lockedIntoXyz = true;
        else if (token === 'LOCK_LINK') state.locks.lockedIntoLink = true;
        else if (token === 'LOCK_MACHINE') state.locks.lockedIntoMachine = true;
        else if (token === 'LOCK_NO_EXTRA') state.locks.cannotSpecialSummonFromExtra = true;
        else if (token.startsWith('LING')) state.locks.opponentDrawsOnSpecialSummon = true;
      }
      continue;
    }
  }

  return state;
}
