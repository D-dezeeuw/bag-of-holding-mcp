// Embeddings client — the semantic half of memory search.
//
// Talks to a LOCAL embedding service (the docker-compose stack
// ships Qwen3-Embedding-0.6B behind Text Embeddings Inference) over
// the OpenAI-compatible `/embeddings` shape, which TEI, Ollama,
// vLLM, LM Studio and llama.cpp's server all speak. Plain `fetch`,
// no SDK: the server keeps zero heavy dependencies and the same
// client works against a future hosted tier unchanged.
//
// Multi-tenancy: the embedding service is shared, stateless
// compute — nothing tenant-specific persists in it. Isolation
// lives where vectors land (Qdrant payloads, see qdrant.js).
//
// Model notes (Qwen3-Embedding):
//   - queries take an instruction prefix, documents don't — the
//     serving layer won't add it, so the client does;
//   - Matryoshka-capable: truncating the 1024-dim output to the
//     first N dims and re-normalising keeps most of the quality at
//     a fraction of the storage. Default 256, applied client-side
//     so it works on any serving stack.

export const DEFAULT_EMBEDDINGS_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
export const DEFAULT_EMBEDDINGS_DIM = 256;

const QUERY_INSTRUCT =
  'Instruct: Given a query about a tabletop RPG campaign, retrieve the campaign memory records that answer it\nQuery: ';

// Records are 1-3 sentences by protocol; these caps only matter if
// a host stuffs a transcript in anyway — we embed the head rather
// than erroring, because a truncated vector still retrieves.
const MAX_DOC_CHARS = 2000;
const MAX_QUERY_CHARS = 500;
const MAX_BATCH = 32;

/**
 * Truncate to `dim` and L2-normalise (in that order — that is the
 * Matryoshka contract). Returns a plain Float32Array; a zero vector
 * stays zero rather than dividing by zero.
 */
export function truncateNormalize(vector, dim) {
  const out = Float32Array.from(vector.slice(0, dim));
  let sumSq = 0;
  for (const v of out) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= norm;
  }
  return out;
}

/**
 * Create a client for an OpenAI-compatible embeddings endpoint.
 *
 * `url` is the API base (e.g. "http://localhost:8080/v1"); the
 * client POSTs to `<url>/embeddings`. `apiKey` is optional —
 * local services rarely need it, a hosted tier will.
 *
 * `fetchImpl` exists for tests; the default is the platform fetch.
 *
 * @param {{
 *   url: string, model?: string, dim?: number, apiKey?: string,
 *   fetchImpl?: typeof fetch
 * }} opts
 */
export function createEmbeddingsClient(opts) {
  const {
    url,
    model = DEFAULT_EMBEDDINGS_MODEL,
    dim = DEFAULT_EMBEDDINGS_DIM,
    apiKey,
    fetchImpl = fetch
  } = opts;
  if (typeof url !== 'string' || url === '') {
    throw new Error('Embeddings client needs a url (e.g. http://localhost:8080/v1).');
  }
  const endpoint = `${url.replace(/\/+$/, '')}/embeddings`;
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  async function requestBatch(inputs) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: inputs })
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(`Embeddings service ${response.status} at ${endpoint}: ${body}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.data) || payload.data.length !== inputs.length) {
      throw new Error(`Embeddings service returned ${payload?.data?.length ?? 'no'} vectors for ${inputs.length} inputs.`);
    }
    // The OpenAI shape tags each vector with its input index;
    // order by it rather than trusting array order.
    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    return ordered.map((d) => truncateNormalize(d.embedding, dim));
  }

  async function embedBatch(texts, cap) {
    const inputs = texts.map((t) => String(t).slice(0, cap));
    const out = [];
    for (let i = 0; i < inputs.length; i += MAX_BATCH) {
      out.push(...await requestBatch(inputs.slice(i, i + MAX_BATCH)));
    }
    return out;
  }

  return {
    model,
    dim,
    /** Embed memory-record texts (no instruction prefix). */
    embedDocuments: (texts) => embedBatch(texts, MAX_DOC_CHARS),
    /** Embed a search query (instruction-prefixed per the model card). */
    embedQuery: async (text) =>
      (await requestBatch([QUERY_INSTRUCT + String(text).slice(0, MAX_QUERY_CHARS)]))[0]
  };
}
