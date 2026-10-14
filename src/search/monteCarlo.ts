/**
 * @file monteCarlo.ts
 * @description High-throughput Monte Carlo opening hand simulator and .ydk decklist parser.
 */

import { CardRegistry, globalCardRegistry } from '../dsl/archetypeLoader.js';

export interface ParsedDeck {
  mainDeck: string[];
  extraDeck: string[];
  sideDeck: string[];
}

export interface MonteCarloOptions {
  sampleSize?: number; // e.g. 10000
  handSize?: number; // e.g. 5
  targetArchetype?: string;
  customStarterFilter?: (passcode: string) => boolean;
}

export interface MonteCarloResult {
  totalSimulations: number;
  sampleSize: number;
  uninterruptedComboRate: number;
  brickRate: number;
  averageStartersPerHand: number;
  starterDistribution: {
    zeroStarters: number;
    oneStarter: number;
    twoStarters: number;
    threeOrMoreStarters: number;
  };
  durationMs: number;
}

/**
 * Parse a standard .ydk deck file format into main, extra, and side deck passcode lists.
 */
export function parseYdkDeck(content: string): ParsedDeck {
  const lines = content.split(/\r?\n/);
  const mainDeck: string[] = [];
  const extraDeck: string[] = [];
  const sideDeck: string[] = [];

  let currentSection: 'main' | 'extra' | 'side' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#created by')) continue;

    if (trimmed === '#main') {
      currentSection = 'main';
      continue;
    } else if (trimmed === '#extra') {
      currentSection = 'extra';
      continue;
    } else if (trimmed === '!side') {
      currentSection = 'side';
      continue;
    }

    // Passcode lines
    if (/^\d+$/.test(trimmed)) {
      if (currentSection === 'main') mainDeck.push(trimmed);
      else if (currentSection === 'extra') extraDeck.push(trimmed);
      else if (currentSection === 'side') sideDeck.push(trimmed);
    }
  }

  return { mainDeck, extraDeck, sideDeck };
}

/**
 * Fast in-place Fisher-Yates array shuffle.
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i]!;
    array[i] = array[j]!;
    array[j] = temp;
  }
  return array;
}

/**
 * Execute high-throughput Monte Carlo simulation across simulated hands.
 * Designed to execute 10,000 hands in <2.5 seconds.
 */
export function simulateHands(
  deck: ParsedDeck | string,
  options: MonteCarloOptions = {},
  registry: CardRegistry = globalCardRegistry
): MonteCarloResult {
  const startTime = performance.now();

  const parsed = typeof deck === 'string' ? parseYdkDeck(deck) : deck;
  const sampleSize = options.sampleSize ?? 10_000;
  const handSize = options.handSize ?? 5;
  const mainDeckTemplate = [...parsed.mainDeck];

  if (mainDeckTemplate.length < handSize) {
    throw new Error(
      `Main deck size (${mainDeckTemplate.length}) is smaller than hand size (${handSize})`
    );
  }

  // Pre-classify starters in the deck for maximum throughput
  const isStarterCache = new Map<string, boolean>();
  for (const passcode of mainDeckTemplate) {
    if (!isStarterCache.has(passcode)) {
      if (options.customStarterFilter) {
        isStarterCache.set(passcode, options.customStarterFilter(passcode));
      } else {
        const cardDef = registry.getCardById(passcode);
        const isStarter =
          cardDef?.taxonomyRole === 'STARTER_NS' ||
          cardDef?.taxonomyRole === 'STARTER_SS' ||
          cardDef?.taxonomyRole === 'STARTER_1_5';
        isStarterCache.set(passcode, Boolean(isStarter));
      }
    }
  }

  let totalCombos = 0;
  let totalBricks = 0;
  let totalStartersCount = 0;

  const distribution = {
    zeroStarters: 0,
    oneStarter: 0,
    twoStarters: 0,
    threeOrMoreStarters: 0
  };

  // Reusable working deck buffer to avoid object reallocation in the loop
  const workingDeck = [...mainDeckTemplate];
  const deckLen = workingDeck.length;

  for (let s = 0; s < sampleSize; s++) {
    // Partial Fisher-Yates shuffle only for the first `handSize` elements
    for (let i = 0; i < handSize; i++) {
      const j = i + Math.floor(Math.random() * (deckLen - i));
      const temp = workingDeck[i]!;
      workingDeck[i] = workingDeck[j]!;
      workingDeck[j] = temp;
    }

    let startersInHand = 0;
    for (let i = 0; i < handSize; i++) {
      const passcode = workingDeck[i]!;
      if (isStarterCache.get(passcode)) {
        startersInHand++;
      }
    }

    totalStartersCount += startersInHand;

    if (startersInHand === 0) {
      totalBricks++;
      distribution.zeroStarters++;
    } else if (startersInHand === 1) {
      totalCombos++;
      distribution.oneStarter++;
    } else if (startersInHand === 2) {
      totalCombos++;
      distribution.twoStarters++;
    } else {
      totalCombos++;
      distribution.threeOrMoreStarters++;
    }
  }

  const durationMs = performance.now() - startTime;

  return {
    totalSimulations: sampleSize,
    sampleSize,
    uninterruptedComboRate: totalCombos / sampleSize,
    brickRate: totalBricks / sampleSize,
    averageStartersPerHand: totalStartersCount / sampleSize,
    starterDistribution: distribution,
    durationMs
  };
}
