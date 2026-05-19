#!/usr/bin/env node
// stdio CLI entry — what Claude Desktop and other MCP hosts spawn.
//
// We deliberately keep this file tiny: instantiate the server,
// open stdio, connect. All the interesting logic lives in
// `src/server.js` so it stays embeddable.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.js';

const { server } = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
