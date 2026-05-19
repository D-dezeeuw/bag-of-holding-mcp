// Test helpers — kept tiny on purpose. Anything beyond
// `runTool` + `parse` is a code smell (it means tests are
// reaching too far behind the public surface).

import { createSessions } from '../src/sessions.js';

/**
 * Build a fresh session registry for each test so state
 * doesn't leak between cases. Returns a `(toolsFactory, args)`
 * helper that runs a single tool and parses its response.
 */
export function setup(toolsFactory) {
  const sessions = createSessions();
  const tools = toolsFactory(sessions);
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    sessions,
    tools,
    /** Run a tool by name and return its parsed result. */
    async run(name, args = {}) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`No such tool: ${name}`);
      const result = await tool.handler(args);
      return parse(result);
    }
  };
}

/**
 * Turn an MCP tool response into `{ data, isError }` so tests
 * can assert on the engine payload without re-parsing JSON each
 * time. Falls back to the text content when `structuredContent`
 * is absent (i.e. errors, which only have text).
 */
export function parse(result) {
  if (result.isError) {
    return { isError: true, message: result.content[0].text };
  }
  const data = result.structuredContent ?? JSON.parse(result.content[0].text);
  return { isError: false, data };
}
