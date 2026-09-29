# API authorization

The SDK authorizes each POST separately. Manual clients request `/auth/nonce`
with `wallet`, `method: "POST"`, the exact request `path`, and `bodyHash`.
The hash is Viem's `hashMessage(canonicalJson(body))`; canonical JSON sorts object
keys and preserves array order. Sign the returned message and send the original
body with `x-termbook-wallet`, `x-termbook-signature`, and `x-termbook-nonce`.

The message binds the API domain, wallet, random nonce, expiry, method, path, and
body hash. Nonces include their expiry and issuance does not mutate wallet state.
Only a valid signature consumes a nonce. Mongo's unique primary key enforces
single consumption across replicas, and TTL removes consumed authorizations after
expiry. Storage failure rejects authorization. Contract wallets use ERC-1271 at a
finalized block. Nonce issuance is bounded by an IP rate limiter.

Generic login signatures no longer authorize mutations. SDK clients verify the
challenge contents before requesting a wallet signature. Apps still supply their
public app token; that token carries no wallet or custody authority.

# Queue delivery

Job IDs are deterministic SHA-256 hashes accepted by BullMQ. Mongo fallback jobs
use renewable 60-second leases and exponential retries capped at five minutes.
Completion and retry require the current lease token; an expired worker cannot
remove another worker's claim. Handlers must reconcile confirmed onchain state
before submitting a transaction because queues provide at-least-once delivery.
