import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateArchetypeDAG } from '../dist/dsl/cardSchema.js';

// Load our validated 42 cards
import { readFileSync } from 'node:fs';
const monolithic = JSON.parse(readFileSync(resolve('data/archetypes/revol_bots.json'), 'utf-8'));
const allCards = monolithic.cards;
const cardMap = new Map(allCards.map(c => [c.id, c]));

// 1. REVOL BOTS (Archetype Core)
const revolBotsIds = [
  '5109321',  // R.B. Stage Landing
  '78710386', // R.B. Funk Dock
  '16066654', // R.B. Operation Test
  '44573911', // R.B. Ga10 Pile Bunker
  '33438265', // R.B. Ga10 Cutter
  '6043161',  // R.B. Ga10 Driller
  '79436874', // R.B. VALCan Rocket
  '81794107', // R.B. Lambda Cannon
  '17188206', // R.B. Lambda Blade
  '43450363', // R.B. Last Stand
  '79859067', // R.B. Next Phase
  '32216688', // R.B. The Brute Blues
  '6821579',  // R.B. VALCan Booster
  '80071619'  // R.B. Shepherd's Crook
];

const revolBotsDAG = {
  archetypeName: 'Revol_Bots',
  version: '1.0.0',
  standardStarters: ['5109321', '78710386'],
  primaryExtenders: ['44573911', '33438265', '6043161', '79436874', '16066654'],
  insulationTargets: ['79859067', '33438265'],
  cards: revolBotsIds.map(id => cardMap.get(id))
};

// 2. SKY STRIKER (Secondary Engine Splash)
const skyStrikerIds = [
  '20357457', // Pillar of the Future - Cyanos
  '37351133', // Sky Striker Ace - Roze
  '63166095', // Sky Striker Mobilize - Engage!
  '52340444', // Sky Striker Mecha - Hornet Drones
  '63288573', // Sky Striker Ace - Kagari
  '90673288', // Sky Striker Ace - Shizuku
  '8491308',  // Sky Striker Ace - Hayate
  '63013339', // Sky Striker Ace - Camellia
  '75147529', // Sky Striker Ace - Zeke
  '25072579'  // Prototype Sky Striker Ace - Amatsu
];

const skyStrikerDAG = {
  archetypeName: 'Sky_Striker',
  version: '1.0.0',
  standardStarters: ['20357457', '63166095', '52340444'],
  primaryExtenders: ['37351133', '63288573'],
  insulationTargets: ['25072579'],
  cards: skyStrikerIds.map(id => cardMap.get(id))
};

// 3. MACHINE SUPPORT (Generic Machine & Field Support)
const machineSupportIds = [
  '10604644', // Therion "King" Regulus
  '84797028', // Clockwork Night
  '41739381', // Clockwork Knight
  '13117073', // Barricadeborg Blocker
  '73628505'  // Terraforming
];

const machineSupportDAG = {
  archetypeName: 'Machine_Support',
  version: '1.0.0',
  standardStarters: ['73628505'],
  primaryExtenders: ['10604644', '41739381', '13117073'],
  insulationTargets: ['10604644'],
  cards: machineSupportIds.map(id => cardMap.get(id))
};

// 4. STAPLES: HAND TRAPS ([TECH-HANDTRAP])
const handTrapIds = [
  '14558127', // Ash Blossom & Joyous Spring
  '73642296', // Ghost Belle & Haunted Mansion
  '59438930', // Ghost Ogre & Snow Rabbit
  '94145021', // Droll & Lock Bird
  '42141493', // Mulcharmy Fuwalos
  '84192580', // Mulcharmy Purulia
  '27204311', // Nibiru, the Primal Being
  '10045474'  // Infinite Impermanence
];

const handTrapsDAG = {
  archetypeName: 'Staples_Hand_Traps',
  version: '1.0.0',
  standardStarters: [],
  primaryExtenders: [],
  insulationTargets: [],
  cards: handTrapIds.map(id => cardMap.get(id))
};

// 5. STAPLES: BOARD BREAKERS ([TECH-BREAKER])
const boardBreakerIds = [
  '24299458', // Forbidden Droplet
  '14532163', // Lightning Storm
  '25311006'  // Triple Tactics Talent
];

const boardBreakersDAG = {
  archetypeName: 'Staples_Board_Breakers',
  version: '1.0.0',
  standardStarters: [],
  primaryExtenders: [],
  insulationTargets: [],
  cards: boardBreakerIds.map(id => cardMap.get(id))
};

// 6. STAPLES: DEFENSIVE ([TECH-DEFENSIVE])
const defensiveIds = [
  '24224830', // Called by the Grave
  '41420027'  // Solemn Judgment
];

const defensiveDAG = {
  archetypeName: 'Staples_Defensive',
  version: '1.0.0',
  standardStarters: [],
  primaryExtenders: [],
  insulationTargets: ['24224830', '41420027'],
  cards: defensiveIds.map(id => cardMap.get(id))
};

// Array of all modular DAGs to generate
const modularFiles = [
  { file: 'revol_bots.json', dag: revolBotsDAG },
  { file: 'sky_striker.json', dag: skyStrikerDAG },
  { file: 'machine_support.json', dag: machineSupportDAG },
  { file: 'staples_hand_traps.json', dag: handTrapsDAG },
  { file: 'staples_board_breakers.json', dag: boardBreakersDAG },
  { file: 'staples_defensive.json', dag: defensiveDAG }
];

let totalCardsCount = 0;
for (const { file, dag } of modularFiles) {
  console.log(`Validating ${file} (${dag.archetypeName})...`);
  const validated = validateArchetypeDAG(dag);
  console.log(`✓ ${file}: Validated ${validated.cards.length} cards`);
  totalCardsCount += validated.cards.length;

  const outPath = resolve('data/archetypes', file);
  writeFileSync(outPath, JSON.stringify(dag, null, 2), 'utf-8');
}

console.log(`\nAll 6 modular datasets generated! Total cards partitioned: ${totalCardsCount} (Expected: 42)`);
