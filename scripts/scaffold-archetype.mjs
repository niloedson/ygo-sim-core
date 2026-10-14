#!/usr/bin/env node
/**
 * @file scaffold-archetype.mjs
 * @description Generates an ArchetypeDAG JSON file from a .ydk decklist using the local cards.db SQLite database.
 *
 * Usage:
 *   node scripts/scaffold-archetype.mjs <path-to-deck.ydk> [output-json-path]
 * Example:
 *   node scripts/scaffold-archetype.mjs ../obsidian-ygo-suite/decks/"RB (Revol Bots).ydk" data/archetypes/revol_bots.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`Usage: node scripts/scaffold-archetype.mjs <path-to-deck.ydk> [output-json-path]`);
  process.exit(1);
}

const ydkPath = resolve(args[0]);
if (!existsSync(ydkPath)) {
  console.error(`Error: Deck file not found at ${ydkPath}`);
  process.exit(1);
}

// Locate SQLite database
const candidateDbPaths = [
  resolve(__dirname, '../../obsidian-ygo-suite/mcp-servers/ygoprodeck/data/cards.db'),
  resolve(process.cwd(), 'obsidian-ygo-suite/mcp-servers/ygoprodeck/data/cards.db'),
  resolve(process.cwd(), 'data/cards.db')
];

let dbPath = candidateDbPaths.find((p) => existsSync(p));
if (!dbPath) {
  console.error(`Error: cards.db not found. Expected at obsidian-ygo-suite/mcp-servers/ygoprodeck/data/cards.db`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const ydkContent = readFileSync(ydkPath, 'utf-8');
const lines = ydkContent.split(/\r?\n/);

const mainIds = [];
const extraIds = [];
const sideIds = [];
let section = null;

for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed === '#main') {
    section = 'main';
    continue;
  }
  if (trimmed === '#extra') {
    section = 'extra';
    continue;
  }
  if (trimmed === '!side') {
    section = 'side';
    continue;
  }
  if (/^\d+$/.test(trimmed)) {
    if (section === 'main') mainIds.push(trimmed);
    else if (section === 'extra') extraIds.push(trimmed);
    else if (section === 'side') sideIds.push(trimmed);
  }
}

const allUniqueIds = [...new Set([...mainIds, ...extraIds, ...sideIds])];
const baseName = basename(ydkPath).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
const outputPath = args[1]
  ? resolve(args[1])
  : resolve(__dirname, `../data/archetypes/${baseName.toLowerCase()}.json`);

const HAND_TRAPS = new Set([
  '14558127', // Ash Blossom
  '42141493', // Mulcharmy Fuwalos
  '84192580', // Mulcharmy Purulia
  '59438930', // Ghost Ogre
  '73642296', // Ghost Belle
  '94145021', // Droll & Lock Bird
  '10045474', // Infinite Impermanence
  '27204311', // Nibiru, the Primal Being
  '97268402', // Effect Veiler
  '23434538'  // Maxx "C"
]);

const DEFENSIVE_TECH = new Set([
  '24224830', // Called by the Grave
  '65681982', // Crossout Designator
  '41420027'  // Solemn Judgment
]);

const BREAKERS = new Set([
  '24299458', // Forbidden Droplet
  '14532163', // Lightning Storm
  '25311006', // Triple Tactics Talent
  '18144506', // Harpie's Feather Duster
  '55063738', // Evenly Matched
  '49238328'  // Dark Ruler No More
]);

const standardStarters = [];
const primaryExtenders = [];
const insulationTargets = [];
const cards = [];

for (const id of allUniqueIds) {
  // Passcode 27204312 is Primal Being Token - map to Nibiru or skip
  const queryId = id === '27204312' ? 27204311 : Number(id);
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(queryId);
  if (!row) {
    console.warn(`Card passcode ${id} not found in database, skipping.`);
    continue;
  }

  let cardType = 'MONSTER';
  if (row.type.includes('Spell')) cardType = 'SPELL';
  if (row.type.includes('Trap')) cardType = 'TRAP';

  let taxonomyRole = undefined;
  if (HAND_TRAPS.has(String(queryId))) {
    taxonomyRole = 'TECH_HANDTRAP';
  } else if (DEFENSIVE_TECH.has(String(queryId))) {
    taxonomyRole = 'TECH_DEFENSIVE';
    insulationTargets.push(String(row.id));
  } else if (BREAKERS.has(String(queryId))) {
    taxonomyRole = 'TECH_BREAKER';
  } else if (cardType === 'SPELL' && (row.race === 'Field' || row.desc?.toLowerCase().includes('add 1') || row.desc?.toLowerCase().includes('special summon 1'))) {
    taxonomyRole = 'STARTER_SS';
    standardStarters.push(String(row.id));
  } else if (cardType === 'MONSTER' && !row.type.includes('Link') && (row.level <= 4) && (row.desc?.toLowerCase().includes('add 1') || row.desc?.toLowerCase().includes('special summon 1'))) {
    taxonomyRole = 'STARTER_NS';
    standardStarters.push(String(row.id));
  } else if (cardType === 'MONSTER' && (row.desc?.toLowerCase().includes('you can special summon this card') || row.desc?.toLowerCase().includes('if you control'))) {
    taxonomyRole = 'EXTENDER';
    primaryExtenders.push(String(row.id));
  } else if (row.type.includes('Trap')) {
    taxonomyRole = 'ENGINE_BRICK';
  }

  let monsterAttributes = undefined;
  if (cardType === 'MONSTER') {
    let linkRating = undefined;
    let linkArrows = undefined;
    if (row.type.includes('Link')) {
      const markers = row.linkmarkers ? row.linkmarkers.split(',').map((s) => s.trim()) : [];
      linkRating = markers.length || row.level || 1;
      const markerMap = {
        'Top': 'T',
        'Bottom': 'B',
        'Left': 'L',
        'Right': 'R',
        'Top-Left': 'TL',
        'Top-Right': 'TR',
        'Bottom-Left': 'BL',
        'Bottom-Right': 'BR'
      };
      linkArrows = markers.map((m) => markerMap[m]).filter(Boolean);
    }
    monsterAttributes = {
      attribute: row.attribute || 'DARK',
      race: row.race || 'Machine',
      levelOrRank: linkRating ? 0 : (row.level || 1),
      atk: row.atk ?? 0,
      def: linkRating ? undefined : (row.def ?? 0),
      linkRating,
      linkArrows,
      isTuner: row.type.includes('Tuner')
    };
  }

  let spellTrapType = undefined;
  if (cardType === 'SPELL' || cardType === 'TRAP') {
    if (row.race === 'Field') spellTrapType = 'FIELD';
    else if (row.race === 'Quick-Play') spellTrapType = 'QUICK_PLAY';
    else if (row.race === 'Continuous') spellTrapType = 'CONTINUOUS';
    else if (row.race === 'Counter') spellTrapType = 'COUNTER';
    else spellTrapType = 'NORMAL';
  }

  const rawArchetypes = [];
  if (row.archetype) rawArchetypes.push(row.archetype);
  if (row.name.startsWith('R.B.')) rawArchetypes.push('Revol Bots', 'R.B.');
  if (row.name.includes('Sky Striker')) rawArchetypes.push('Sky Striker');
  const archetypes = [...new Set(rawArchetypes)];

  cards.push({
    id: String(row.id),
    name: row.name,
    cardType,
    monsterAttributes,
    spellTrapType,
    archetypes,
    taxonomyRole,
    effects: [
      {
        effectId: `eff_${row.id}`,
        category: cardType === 'SPELL' && spellTrapType === 'QUICK_PLAY' ? 'QUICK' : 'IGNITION',
        activationLocation: cardType === 'MONSTER' ? ['FIELD_M'] : ['HAND'],
        spellSpeed: (cardType === 'SPELL' && spellTrapType === 'QUICK_PLAY') || spellTrapType === 'COUNTER' ? 2 : 1,
        conditions: [],
        costs: [],
        resolution: [
          {
            type: taxonomyRole === 'STARTER_SS' || taxonomyRole === 'STARTER_NS' ? 'SEARCH' : 'SPECIAL_SUMMON'
          }
        ]
      }
    ]
  });
}

const archetypeDAG = {
  archetypeName: baseName,
  version: '1.0.0',
  standardStarters: [...new Set(standardStarters)],
  primaryExtenders: [...new Set(primaryExtenders)],
  insulationTargets: [...new Set(insulationTargets)],
  cards
};

writeFileSync(outputPath, JSON.stringify(archetypeDAG, null, 2), 'utf-8');
console.log(`Successfully generated archetype DAG at: ${outputPath}`);
console.log(`Total indexed cards: ${cards.length} (${standardStarters.length} starters, ${primaryExtenders.length} extenders)`);
