#!/usr/bin/env node
/**
 * CLI launcher compiled into dist/bin/ygo-sim-core.js
 */
import { Command } from 'commander';

export const program = new Command();

program
  .name('ygo-sim-core')
  .description('High-Performance Deterministic Yu-Gi-Oh! Combo & Valuation Engine')
  .version('1.0.0')
  .option('-d, --deck <path>', 'Path to .ydk deck file')
  .option('-m, --monte-carlo <number>', 'Number of Monte Carlo hands to simulate', '1000')
  .option('-h, --hand <cards>', 'Comma-separated opening hand')
  .option('-r, --resilience', 'Run adversarial hand trap resilience evaluation')
  .action((_options) => {
    // Engine invocation will be wired in Phase 4 & 7
  });

if (
  process.argv[1] &&
  (process.argv[1].endsWith('ygo-sim-core.js') || process.argv[1].endsWith('ygo-sim-core.ts'))
) {
  program.parse(process.argv);
}
