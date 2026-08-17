#!/usr/bin/env node
// HTTP entry — what the deployed container runs.
//
// Kept even thinner than bin/cli.js: one line, no branches. The boot
// sequence (port, listen, announce, fail-closed refusal) lives in
// src/http.js as `main()` so it stays embeddable and is covered by the
// suite in-process rather than only via a spawned child.
//
//   BOH_HTTP_PORT             default 8091
//   BOH_MEMORY_TOKEN_HASHES   REQUIRED — comma-separated SHA-256 hex of the
//                             tokens you have issued. Without it this exits
//                             2 rather than serving every campaign to
//                             whoever finds the URL.
//   plus the usual BOH_DATA_DIR / BOH_EMBEDDINGS_* / BOH_QDRANT_*

import { main } from '../src/http.js';

process.exitCode = (await main()).code;
