import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { program } from '../src/bin/ygo-sim-core.js';
import { createServer } from '../src/mcp/server.js';
import type { CardDefinition, GameState } from '../src/index.js';

describe('Phase 0 Scaffolding & Toolchain Verification', () => {
  it('loads sample archetype data file successfully', () => {
    const archetypePath = resolve(process.cwd(), 'data/archetypes/sample_archetype.json');
    expect(existsSync(archetypePath)).toBe(true);

    const raw = readFileSync(archetypePath, 'utf-8');
    const data = JSON.parse(raw);

    expect(data.archetypeName).toBe('Earth_Machine_Sample');
    expect(Array.isArray(data.cards)).toBe(true);
    expect(data.cards.length).toBeGreaterThan(0);

    const harvester = data.cards.find((c: CardDefinition) => c.name === 'Infinitrack Harvester');
    expect(harvester).toBeDefined();
    expect(harvester?.cardType).toBe('MONSTER');
    expect(harvester?.monsterAttributes?.attribute).toBe('EARTH');
  });

  it('instantiates CLI program with expected command options', () => {
    expect(program.name()).toBe('ygo-sim-core');
    const optionNames = program.options.map((opt) => opt.long);
    expect(optionNames).toContain('--deck');
    expect(optionNames).toContain('--monte-carlo');
    expect(optionNames).toContain('--hand');
    expect(optionNames).toContain('--resilience');
  });

  it('instantiates Stdio MCP Server without error', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('verifies type declarations can be imported and compile', () => {
    const mockState: Partial<GameState> = {
      turn: 1,
      phase: 'M1',
      lp: [8000, 8000]
    };
    expect(mockState.turn).toBe(1);
    expect(mockState.phase).toBe('M1');
  });
});
