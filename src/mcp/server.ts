/**
 * Stdio MCP Server Stub (Phase 7)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function createServer(): Server {
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
