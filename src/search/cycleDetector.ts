/**
 * @file cycleDetector.ts
 * @description Path-based cyclic loop detector to prune infinite repetition combos (CYCLE_DETECTED).
 */

export class CycleDetector {
  private pathHashes: Set<string> = new Set();
  private pathStack: string[] = [];

  /**
   * Enter a state along the active branch.
   * Returns true if a cyclic loop was detected (state hash already present in current path).
   */
  public enterState(hash: string): boolean {
    if (this.pathHashes.has(hash)) {
      return true;
    }
    this.pathHashes.add(hash);
    this.pathStack.push(hash);
    return false;
  }

  /**
   * Exit the state when backtracking out of the branch.
   */
  public exitState(): string | undefined {
    const popped = this.pathStack.pop();
    if (popped) {
      this.pathHashes.delete(popped);
    }
    return popped;
  }

  /**
   * Check if a hash is present in the current search path.
   */
  public contains(hash: string): boolean {
    return this.pathHashes.has(hash);
  }

  /**
   * Reset the detector.
   */
  public clear(): void {
    this.pathHashes.clear();
    this.pathStack = [];
  }

  public get currentDepth(): number {
    return this.pathStack.length;
  }
}
