// Tool result helpers.
//
// MCP tool responses are content arrays; an AI client always sees
// the `text` block, while a structured client (an automated host
// driving the engine programmatically) can grab `structuredContent`
// without re-parsing JSON. We hand both back from every tool so the
// same server works for "Claude Desktop talking to a DM" and for
// "an in-process orchestrator running rules-correct simulations."

/**
 * Wrap a plain-object engine result as an MCP tool response.
 *
 * Why both `content` and `structuredContent`: text is the
 * universal channel (every MCP client renders it), but the AI
 * loop then has to re-parse JSON to act on it. Shipping the same
 * payload as `structuredContent` lets programmatic hosts skip
 * the round-trip. The duplication is cheap; the alternative is
 * forcing one of the two audiences to do extra work.
 */
export function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

/**
 * Wrap an error as an MCP tool response with `isError: true`.
 *
 * Why we don't just throw: the MCP SDK does catch thrown errors,
 * but a structured tool response with a human-readable message is
 * more useful to the AI than the SDK's generic `Tool execution
 * failed`. Errors from the engine often carry plugin-author
 * pointers ("extraSpecies.half-elf missing field: size") that we
 * want to preserve verbatim.
 */
export function toolError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}
