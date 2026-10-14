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
import { loadArchetype, loadAllArchetypes, globalCardRegistry } from '../dsl/archetypeLoader.js';
import { Logcat, LogLevel } from '../logging/logcat.js';

export const program = new Command();

program
  .name('ygo-sim-core')
  .description('High-Performance Deterministic Yu-Gi-Oh! Combo & Valuation Engine')
  .version('1.0.0')
  .option('-d, --deck <path>', 'Path to .ydk deck file')
  .option('-m, --monte-carlo [number]', 'Number of Monte Carlo hands to simulate (default: 100)')
  .option('-h, --hand <cards>', 'Comma-separated opening hand (card names or passcodes)')
  .option('-r, --resilience', 'Run adversarial hand trap resilience evaluation')
  .option('-y, --ybn <state>', 'Score arbitrary RFC 0001 YBN snapshot string')
  .option('-a, --archetype <path>', 'Path to archetype JSON definition')
  .option('--max-depth <number>', 'Maximum combo tree search depth (default: 40)', '40')
  .option('--trace-limit <number>', 'Maximum sample hands to deeply evaluate in Monte Carlo (default: 10)', '10')
  .option('--log-dir <path>', 'Directory to write execution-differentiated Logcat files (default: ./logs)')
  .option('--log-level <level>', 'Logcat priority filter: VERBOSE, DEBUG, INFO, WARN, ERROR (default: DEBUG)', 'DEBUG')
  .option('--no-log', 'Disable writing Logcat log file to disk')
  .action((options) => {
    // 0. Initialize Android Logcat logging engine
    Logcat.configure({
      logDir: options.logDir,
      logLevel: options.logLevel as LogLevel,
      enableFile: !options.noLog
    });
    Logcat.i('SimCore:CLI', `Invoking ygo-sim-core CLI [PID: ${process.pid}]`);

    // 1. Load Archetypes: either explicitly specified or all discovered in candidate paths
    if (options.archetype) {
      const archetypePath = resolve(options.archetype);
      if (existsSync(archetypePath)) {
        try {
          loadArchetype(archetypePath);
          Logcat.i('SimCore:CLI', `Loaded custom archetype from ${archetypePath}`);
        } catch (err) {
          Logcat.e('SimCore:CLI', `Failed loading custom archetype from ${archetypePath}`, err);
        }
      }
    } else {
      const count = loadAllArchetypes();
      Logcat.i('SimCore:CLI', `Discovered and loaded ${count} archetypes into globalCardRegistry`);
    }

    // 2. Score standalone YBN string
    if (options.ybn) {
      Logcat.d('SimCore:CLI', `Scoring standalone YBN snapshot: ${options.ybn}`);
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
        Logcat.i('SimCore:CLI', `Loaded deck file from ${deckPath}`);
      } else {
        Logcat.e('SimCore:CLI', `Deck file not found at ${deckPath}`);
        console.error(`Error: Deck file not found at ${deckPath}`);
        process.exit(1);
      }
    }

    // 4. Monte Carlo Goldfishing Simulation
    if (options.monteCarlo !== undefined && deckContent) {
      const sampleSize =
        typeof options.monteCarlo === 'string' ? parseInt(options.monteCarlo, 10) : 100;
      const maxDepth = parseInt(options.maxDepth, 10) || 40;
      const traceLimit = parseInt(options.traceLimit, 10) || 10;

      Logcat.i(
        'SimCore:CLI',
        `Running Monte Carlo simulation (sampleSize: ${sampleSize}, maxDepth: ${maxDepth}, traceLimit: ${traceLimit})`
      );

      const result = handleSimulateTestHands(
        {
          deck_ydk: deckContent,
          sample_size: sampleSize,
          max_depth: maxDepth,
          trace_limit: traceLimit,
          trace_lines: true
        },
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
      const maxDepth = parseInt(options.maxDepth, 10) || 40;

      if (options.resilience) {
        Logcat.i('SimCore:CLI', `Evaluating handtrap resilience for hand: [${handCards.join(', ')}]`);
        const resilience = handleEvaluateHandtrapResilience(
          { hand: handCards, deck_ydk: deckContent },
          globalCardRegistry
        );
        console.log(JSON.stringify(resilience, null, 2));
      } else {
        Logcat.i(
          'SimCore:CLI',
          `Exploring combo tree for hand: [${handCards.join(', ')}] (maxDepth: ${maxDepth})`
        );
        const comboResult = handleExploreComboTree(
          { hand: handCards, deck_ydk: deckContent, max_depth: maxDepth },
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
