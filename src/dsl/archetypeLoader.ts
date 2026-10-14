/**
 * @file archetypeLoader.ts
 * @description Ingestion and registry management for Declarative Archetype Action DAGs.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchetypeDAG, CardDefinition } from '../types/card-dsl.js';
import { validateArchetypeDAG } from './cardSchema.js';

export class CardRegistry {
  private static instance: CardRegistry;
  private cardsById: Map<string, CardDefinition> = new Map();
  private cardsByName: Map<string, CardDefinition> = new Map();
  private archetypes: Map<string, ArchetypeDAG> = new Map();

  public static getInstance(): CardRegistry {
    if (!CardRegistry.instance) {
      CardRegistry.instance = new CardRegistry();
    }
    return CardRegistry.instance;
  }

  /**
   * Register a fully validated ArchetypeDAG into the active engine registry.
   */
  public registerArchetype(dag: ArchetypeDAG): void {
    this.archetypes.set(dag.archetypeName, dag);
    for (const card of dag.cards) {
      this.cardsById.set(card.id, card);
      this.cardsByName.set(card.name, card);
    }
  }

  /**
   * Load and validate an ArchetypeDAG from a JSON file path.
   */
  public loadFromFile(filePath: string): ArchetypeDAG {
    const absolutePath = resolve(filePath);
    const content = readFileSync(absolutePath, 'utf-8');
    const parsed = JSON.parse(content);
    const dag = validateArchetypeDAG(parsed);
    this.registerArchetype(dag);
    return dag;
  }

  /**
   * Load and validate an ArchetypeDAG from a raw JSON string.
   */
  public loadFromJSON(jsonString: string): ArchetypeDAG {
    const parsed = JSON.parse(jsonString);
    const dag = validateArchetypeDAG(parsed);
    this.registerArchetype(dag);
    return dag;
  }

  /**
   * Lookup a CardDefinition by 8-digit passcode or alias ID.
   */
  public getCardById(id: string): CardDefinition | undefined {
    return this.cardsById.get(id);
  }

  /**
   * Lookup a CardDefinition by official card name, case-insensitive or common suffix/alias.
   */
  public getCardByName(name: string): CardDefinition | undefined {
    const direct = this.cardsByName.get(name);
    if (direct) return direct;

    const lower = name.toLowerCase().trim();
    for (const [cardName, def] of this.cardsByName.entries()) {
      const defLower = cardName.toLowerCase();
      if (defLower === lower || defLower.endsWith(lower) || defLower.includes(lower)) {
        return def;
      }
    }
    return undefined;
  }

  /**
   * Retrieve an ArchetypeDAG by archetype name.
   */
  public getArchetype(name: string): ArchetypeDAG | undefined {
    return this.archetypes.get(name);
  }

  /**
   * Return all currently indexed CardDefinitions.
   */
  public getAllCards(): CardDefinition[] {
    return Array.from(this.cardsById.values());
  }

  /**
   * Clear all indexed cards and archetypes (useful for hermetic test isolation).
   */
  public clear(): void {
    this.cardsById.clear();
    this.cardsByName.clear();
    this.archetypes.clear();
  }
}

// Convenience functional helpers
export const globalCardRegistry = CardRegistry.getInstance();

export function loadArchetype(filePathOrJson: string): ArchetypeDAG {
  if (filePathOrJson.trim().startsWith('{')) {
    return globalCardRegistry.loadFromJSON(filePathOrJson);
  }
  return globalCardRegistry.loadFromFile(filePathOrJson);
}

export function getCard(idOrName: string): CardDefinition | undefined {
  return globalCardRegistry.getCardById(idOrName) ?? globalCardRegistry.getCardByName(idOrName);
}

/**
 * Automatically discovers and loads all archetype JSON files from candidate directories.
 */
export function loadAllArchetypes(
  targetDir?: string,
  registry: CardRegistry = globalCardRegistry
): number {
  const candidateDirs: string[] = [];
  if (targetDir) {
    candidateDirs.push(resolve(targetDir));
  } else {
    try {
      const packageArchetypes = fileURLToPath(new URL('../../data/archetypes', import.meta.url));
      candidateDirs.push(packageArchetypes);
    } catch {
      // In bundled or non-ESM environments
    }
    candidateDirs.push(
      resolve(process.cwd(), 'data/archetypes'),
      resolve(process.cwd(), '../data/archetypes'),
      resolve(process.cwd(), '../ygo-sim-core/data/archetypes'),
      resolve(process.cwd(), '../../ygo-sim-core/data/archetypes')
    );
  }

  let totalLoaded = 0;
  for (const dir of candidateDirs) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          try {
            const filePath = resolve(dir, file);
            registry.loadFromFile(filePath);
            totalLoaded++;
          } catch {
            // Ignore non-archetype JSONs
          }
        }
        if (totalLoaded > 0) {
          break; // Successfully loaded from this candidate directory
        }
      } catch {
        // Continue to next candidate
      }
    }
  }
  return totalLoaded;
}

