/**
 * @file transpositionTable.ts
 * @description In-memory transposition table caching visited game states by compact 64-bit state hash.
 */

export interface TranspositionEntry {
  hash: string;
  depth: number;
  evalScore?: number | undefined;
  bestActionId?: string | undefined;
  terminalYBN?: string | undefined;
}

export class TranspositionTable {
  private map: Map<string, TranspositionEntry> = new Map();

  public get(hash: string): TranspositionEntry | undefined {
    return this.map.get(hash);
  }

  public set(entry: TranspositionEntry): void {
    const existing = this.map.get(entry.hash);
    if (!existing || entry.depth >= existing.depth) {
      this.map.set(entry.hash, entry);
    }
  }

  public has(hash: string): boolean {
    return this.map.has(hash);
  }

  public clear(): void {
    this.map.clear();
  }

  public get size(): number {
    return this.map.size;
  }
}
