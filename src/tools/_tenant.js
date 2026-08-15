// Tenant plumbing shared by every token-scoped tool family.
//
// Two tenancy modes, and the tool schemas differ between them:
//
//   - stdio (local): the token is an optional tool parameter, so a single
//     desktop process can serve several tables.
//   - HTTP (deployed): the tenant is pinned by the transport — the token
//     lives in the URL path — and the `token` parameter is REMOVED from
//     every schema. The model then cannot see, supply, or leak it, and
//     cannot reach another tenant's shelf by guessing a string.
//
// This used to live as near-identical copies in the memory tools and the
// image tools, with the world tools about to need a third. The pattern is
// load-bearing security — the spread-`{}`-when-pinned trick is what keeps
// the URL token out of the model's hands — and three copies is how one of
// them quietly stops matching the other two.

import { z } from 'zod';

export const TokenField = z.string().optional().describe(
  'Memory token — an opaque string that namespaces your storage (never stored, only hashed). Omit it for the shared local namespace. Required when the server runs with a token allowlist (hosted mode). Treat it like a password; never write it into memory records.'
);

/**
 * Resolve the tenancy mode for a tool family.
 *
 * Returns `{ tokenField, tokenOf }`: spread `tokenField` into each input
 * schema (it is `{}` when the transport pinned the token, so the field is
 * absent rather than present-and-ignored — an ignored parameter the model
 * can still fill in is an invitation to leak a secret into the transcript),
 * and call `tokenOf(args)` for the effective token.
 */
export function tenantFields(pinnedToken) {
  const pinned = typeof pinnedToken === 'string' && pinnedToken !== '';
  return {
    tokenField: pinned ? {} : { token: TokenField },
    tokenOf: pinned ? () => pinnedToken : (args) => args.token,
  };
}
