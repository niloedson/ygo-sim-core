#!/usr/bin/env node
/**
 * CLI launcher compiled into dist/bin/ygo-sim-core.js
 */
import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  handleSimulateTestHands,
  handleExploreComboTree,
  handleEvaluateHandtrapResilience,
  handleScoreYbnState
} from '../mcp/handlers.js';
import { loadArchetype, globalCardRegistry } from '../dsl/archetypeLoader.js';

export const program = new Command();

program
  .name('ygo-sim-core')
  .description('High-Performance Deterministic Yu-Gi-Oh! Combo & Valuation Engine')
  .version('1.0.0')
  .option('-d, --deck <path>', 'Path to .ydk deck file')
  .option('-m, --monte-carlo [number]', 'Number of Monte Carlo hands to simulate')
  .option('-h, --hand <cards>', 'Comma-separated opening hand (card names or passcodes)')
  .option('-r, --resilience', 'Run adversarial hand trap resilience evaluation')
  .option('-y, --ybn <state>', 'Score arbitrary RFC 0001 YBN snapshot string')
  .option('-a, --archetype <path>', 'Path to archetype JSON definition')
  .action((options) => {
    // 1. Load Archetype if specified or default
    const archetypePath = options.archetype
      ? resolve(options.archetype)
      : resolve(process.cwd(), 'data/archetypes/sample_archetype.json');

    if (existsSync(archetypePath)) {
      try {
        loadArchetype(archetypePath);
      } catch {
        // Continue even if custom file has errors
      }
    }

    // 2. Score standalone YBN string
    if (options.ybn) {
      const score = handleScoreYbnState({ ybn: options.ybn }, globalCardRegistry);
      console.log(JSON.stringify(score, null, 2));
      return;
    }

    // 3. Read .ydk deck context if provided
    let deckContent = '';
    if (options.deck) {
      const deckPath = resolve(options.deck);
      if (existsSync(deckPath)) {
        deckContent = readFileSync(deckPath, 'utf-8');
      } else {
        console.error(`Error: Deck file not found at ${deckPath}`);
        process.exit(1);
      }
    }

    // 4. Monte Carlo Goldfishing Simulation
    if (options.monteCarlo !== undefined && deckContent) {
      const sampleSize =
        typeof options.monteCarlo === 'string' ? parseInt(options.monteCarlo, 10) : 1000;
      const result = handleSimulateTestHands(
        { deck_ydk: deckContent, sample_size: sampleSize },
        globalCardRegistry
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // 5. Explore Combo Tree for specific hand
    if (options.hand) {
      const handCards = (options.hand as string)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (options.resilience) {
        const resilience = handleEvaluateHandtrapResilience(
          { hand: handCards, deck_ydk: deckContent },
          globalCardRegistry
        );
        console.log(JSON.stringify(resilience, null, 2));
      } else {
        const comboResult = handleExploreComboTree(
          { hand: handCards, deck_ydk: deckContent },
          globalCardRegistry
        );
        console.log(JSON.stringify(comboResult, null, 2));
      }
      return;
    }

    // If no action flags given, output help
    program.outputHelp();
  });

if (
  process.argv[1] &&
  (process.argv[1].endsWith('ygo-sim-core.js') || process.argv[1].endsWith('ygo-sim-core.ts'))
) {
  program.parse(process.argv);
}
