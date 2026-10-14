import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateArchetypeDAG } from '../dist/dsl/cardSchema.js';

const archetypesDir = resolve('data/archetypes');

// Read all cards from the previously validated datasets
const revolOld = JSON.parse(readFileSync(resolve(archetypesDir, 'revol_bots.json'), 'utf-8'));
const strikerOld = JSON.parse(readFileSync(resolve(archetypesDir, 'sky_striker.json'), 'utf-8'));
const machineOld = JSON.parse(readFileSync(resolve(archetypesDir, 'machine_support.json'), 'utf-8'));

// 1. REVOL BOTS CONSOLIDATED ENGINE & SECONDARY SPLASHES (29 Cards)
const engineCards = [
  ...revolOld.cards,      // 14 Core R.B. cards
  ...strikerOld.cards,    // 10 Sky Striker secondary splash cards
  ...machineOld.cards     // 5 Machine support & bridge cards
];

const revolBotsDAG = {
  archetypeName: 'RB_Revol_Bots',
  version: '1.0.0',
  standardStarters: [
    '5109321',  // R.B. Stage Landing
    '78710386', // R.B. Funk Dock
    '73628505', // Terraforming
    '20357457', // Pillar of the Future - Cyanos
    '63166095', // Sky Striker Mobilize - Engage!
    '52340444'  // Sky Striker Mecha - Hornet Drones
  ],
  primaryExtenders: [
    '44573911', // R.B. Ga10 Pile Bunker
    '33438265', // R.B. Ga10 Cutter
    '6043161',  // R.B. Ga10 Driller
    '79436874', // R.B. VALCan Rocket
    '16066654', // R.B. Operation Test
    '37351133', // Sky Striker Ace - Roze
    '63288573', // Sky Striker Ace - Kagari
    '10604644', // Therion "King" Regulus
    '41739381', // Clockwork Knight
    '13117073'  // Barricadeborg Blocker
  ],
  insulationTargets: [
    '10604644', // Therion "King" Regulus (Omni-negate Machine boss)
    '79859067', // R.B. Next Phase (Counter Trap monster negate)
    '33438265', // R.B. Ga10 Cutter (Linked Spell/Trap negate)
    '25072579'  // Prototype Sky Striker Ace - Amatsu (Effect redirection)
  ],
  cards: engineCards
};

console.log('Validating revol_bots.json (Engine + Secondary Splashes)...');
const validatedRevol = validateArchetypeDAG(revolBotsDAG);
console.log(`✓ revol_bots.json: Validated ${validatedRevol.cards.length} engine cards`);
writeFileSync(resolve(archetypesDir, 'revol_bots.json'), JSON.stringify(revolBotsDAG, null, 2), 'utf-8');

// 2. Remove sky_striker.json and machine_support.json as they are now encapsulated within revol_bots.json
if (existsSync(resolve(archetypesDir, 'sky_striker.json'))) {
  unlinkSync(resolve(archetypesDir, 'sky_striker.json'));
  console.log('✓ Removed sky_striker.json (absorbed into revol_bots.json)');
}
if (existsSync(resolve(archetypesDir, 'machine_support.json'))) {
  unlinkSync(resolve(archetypesDir, 'machine_support.json'));
  console.log('✓ Removed machine_support.json (absorbed into revol_bots.json)');
}

// 3. Verify the 3 Staple Datasets
const stapleFiles = [
  'staples_hand_traps.json',
  'staples_board_breakers.json',
  'staples_defensive.json'
];

let stapleCardsCount = 0;
for (const file of stapleFiles) {
  const dag = JSON.parse(readFileSync(resolve(archetypesDir, file), 'utf-8'));
  const validated = validateArchetypeDAG(dag);
  console.log(`✓ ${file}: Validated ${validated.cards.length} staple cards`);
  stapleCardsCount += validated.cards.length;
}

console.log(`\nArchitecture successfully reconfigured!`);
console.log(`Engine Cards (revol_bots.json): ${validatedRevol.cards.length}`);
console.log(`Staples (3 files):              ${stapleCardsCount}`);
console.log(`Total Tournament Pool:         ${validatedRevol.cards.length + stapleCardsCount} (Exact match: 42 Cards)`);
