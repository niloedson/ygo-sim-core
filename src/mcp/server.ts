/**
 * @file server.ts
 * @description Standard Stdio Model Context Protocol (MCP) Server for ygo-sim-core.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import {
  handleSimulateTestHands,
  handleExploreComboTree,
  handleEvaluateHandtrapResilience,
  handleScoreYbnState
} from './handlers.js';
import { CardRegistry, globalCardRegistry, loadAllArchetypes } from '../dsl/archetypeLoader.js';

export function createServer(registry: CardRegistry = globalCardRegistry): Server {
  // Ensure archetypes are loaded if registry is empty
  if (registry.getAllCards().length === 0) {
    loadAllArchetypes(undefined, registry);
  }

  const server = new Server(
    {
      name: 'ygo-sim-core',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // 1. Register available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'simulate_test_hands',
          description:
            'Simulate Monte Carlo test hands from a .ydk decklist to evaluate consistency, brick rates, and disruption distributions.',
          inputSchema: {
            type: 'object',
            properties: {
              deck_ydk: { type: 'string', description: 'Raw .ydk deck file content' },
              sample_size: {
                type: 'number',
                description: 'Number of hands to simulate (10-10000)'
              },
              hand_size: { type: 'number', description: 'Opening hand size (5 or 6)' },
              target_archetype: { type: 'string', description: 'Optional archetype filter' },
              archetype_json: {
                type: 'string',
                description: 'Optional JSON string containing custom ArchetypeDAG definition'
              }
            },
            required: ['deck_ydk']
          }
        },
        {
          name: 'explore_combo_tree',
          description:
            'Explore the directed combo state tree for a specific hand and deck context, returning top playlines ranked by V(YBN).',
          inputSchema: {
            type: 'object',
            properties: {
              hand: {
                type: 'array',
                items: { type: 'string' },
                description: 'Opening hand card names or passcodes'
              },
              deck_ydk: { type: 'string', description: 'Remaining decklist in .ydk format' },
              max_depth: { type: 'number', description: 'Maximum DFS exploration depth' },
              branch_limit: { type: 'number', description: 'Top N playline branches to return' },
              archetype_json: {
                type: 'string',
                description: 'Optional JSON string containing custom ArchetypeDAG definition'
              }
            },
            required: ['hand', 'deck_ydk']
          }
        },
        {
          name: 'evaluate_handtrap_resilience',
          description:
            'Stress-test a combo playline by injecting competitive hand traps (Ash, Imperm, Nibiru, Droll, Fuwalos) and computing survival ratios.',
          inputSchema: {
            type: 'object',
            properties: {
              hand: { type: 'array', items: { type: 'string' } },
              deck_ydk: { type: 'string' },
              threat_suite: { type: 'array', items: { type: 'string' } }
            },
            required: ['hand', 'deck_ydk']
          }
        },
        {
          name: 'score_ybn_state',
          description:
            'Evaluate any arbitrary RFC 0001 YBN snapshot and return granular V(YBN) valuation breakdown.',
          inputSchema: {
            type: 'object',
            properties: {
              ybn: { type: 'string', description: 'Valid RFC 0001 YBN snapshot string' }
            },
            required: ['ybn']
          }
        }
      ]
    };
  });

  // 2. Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'simulate_test_hands': {
          const result = handleSimulateTestHands(args as never, registry);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        }

        case 'explore_combo_tree': {
          const result = handleExploreComboTree(args as never, registry);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        }

        case 'evaluate_handtrap_resilience': {
          const result = handleEvaluateHandtrapResilience(args as never, registry);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        }

        case 'score_ybn_state': {
          const result = handleScoreYbnState(args as never, registry);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-start when executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  runServer().catch(console.error);
}
