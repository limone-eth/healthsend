# HealthSend: one upload, many grants, and expiry without a centralized KV

Research and architecture review, 2026-09-12. This is an options paper, not an approved implementation plan. Application code was inspected but not changed. No end-to-end TACo/Arkiv integration was executed. User constraint: upload the underlying data once, then create potentially many entities and sharing links.

## Recommendation

Separate an **asset** from a **grant**. Encrypt and upload the asset once. Create a separate Arkiv grant and protected key package for each sharing arrangement. For genuinely different subsets of the same upload, encrypt the independently shareable units separately before that first upload.

For asynchronous bearer links that stop receiving new decryption material after expiry, a threshold release service is the most promising way to remove HealthSend's centralized secret store. TACo has a documented arbitrary HTTPS JSON-RPC condition that could consult Arkiv directly. This is a credible integration candidate, not a demonstrated integration in this repository. See [the threshold research](threshold-expiry-alternatives.md) for current capabilities and limitations.

If removing infrastructure matters more than blocking a first unlock after expiry, a simpler invitation model works with Swarm and Arkiv alone. It must promise invitation expiry, not that the original link becomes cryptographically unusable. Another strong product is a lease for future health updates, with fresh keys for future data.

## What the repository does today

- `lib/sends.ts:createSend` reads the selected files, includes filenames/MIME types/sizes in a bundle envelope, generates a fresh content key, encrypts everything with AES-256-GCM, and uploads `12-byte IV || ciphertext-and-tag` to Swarm. It performs this upload for each send.
- `lib/swarm.ts:uploadEncryptedBlob` invokes Swarm ID's `uploadData(ciphertext)`. HealthSend performs application encryption first; this is not Swarm's built-in encrypted-reference mode or ACT.
- Recipient reads use the public download gateway's `/bytes/<reference>`. A reference provides access to ciphertext without a wallet. The current fetch implementation downloads the entire blob.
- `lib/arkiv.ts` writes one v2 grant with `{v:2, ref, authCommitment}` plus public/queryable attributes: app, kind, sender, filetype, recipient HMAC, file_count, label HMAC, created_at, expires_block. The entity has a native owner and expiry as well.
- A URL fragment contains a random secret. Separate HKDF domains derive the link key-share and an authentication key. The held share is the content key XOR the derived link share.
- `lib/holder-store.ts` stores that held share, access records, revocation tombstones and degraded-log markers in Redis. `resolveUnlock` reads Arkiv, checks the auth commitment, reads the share again, records access, and returns the share to the browser. The browser reconstructs the content key and decrypts locally.
- Early revocation currently deletes/tombstones the held share while leaving the Arkiv grant live.
- `lib/archive.ts` defines an encrypted record archive and creates scoped plaintext exports. Repository searches found no application integration of its archive functions; `docs/archive-model.md` also states that no screen uses it. It currently seals the entire archive with one sender key. Passing that key to a recipient would expose the complete archive.

This means the requested single-upload/many-grant model is an architectural change, not a description of existing behavior.

## Claims in the Desktop scenarios that need correction

1. **A forwarded split-key link works during the grant window.** The current holder authenticates possession of a secret derived from that very link. It does not authenticate the intended recipient. A blinded recipient label is dashboard metadata, not an ACL. The comparison table saying that a forwarded link opens nothing is wrong.
2. **The precise promise is that new key releases stop.** Someone can fetch and save the held share before expiry without opening the file, then decrypt later. This is stronger than merely hiding a link, but narrower than ending all access.
3. **Redis TTL is not proof of irreversible erasure.** It removes an active database key. Backups, copies and a compromised holder remain outside that guarantee. Upstash explicitly supports immediate and daily backups. This review did not inspect the deployed database's backup settings. [Upstash backup documentation](https://upstash.com/docs/redis/features/backup)
4. **Arkiv does not force a secret holder to obey.** A malicious holder can serve a share despite an expired grant. The chain makes the intended policy independently inspectable; enforcement still depends on the holder, an honest threshold, or attested hardware.
5. **Four digits do not defend against holder compromise plus a leaked link.** Once an attacker has the held share and link, mixing a four-digit PIN into a derivation leaves only 10,000 candidates, testable offline using the authentication tag. A rate limiter helps only while the attacker must go through the enforcing service. A strong separately delivered secret is a different option.
6. **Swarm availability is not guaranteed forever.** Postage funds retention. Exhaustion can make data unavailable, but does not establish deletion of every copy. Neither postage exhaustion nor gateway refusal is reliable timed access revocation. [Swarm postage documentation](https://docs.ethswarm.org/docs/desktop/postage-stamps/)
7. **Block expiry is not an exact wall-clock deadline.** Absolute blocks avoid inclusion-delay extension, but block production can drift or stop. A fixed Redis grace hour cannot mathematically guarantee it will always outlast a live grant. [Arkiv expiry resolution](https://docs.arkiv.network/typescript-sdk/api-reference/main/functions/resolveexpiry/)
8. **Metadata is linkable.** A public Swarm reference connects grants to the same ciphertext; sender addresses connect activity; deterministic HMAC labels reveal equality. The holder can join its public entity key to that public metadata. It does not have literally no idea what it guards.
9. **The TTL description differs from the code.** `recordAccessWith` adds the same one-hour grace to logs. `performShare` accepts a client-provided TTL rather than deriving it from authoritative entity expiry, and the share signature binds action/entity/timestamp, not the supplied TTL or share bytes. The reviewed document's exact retention claims are consequently too strong.
10. **URL fragments avoid ordinary HTTP request transmission; they do not escape the browser trust model.** HealthSend's own JavaScript handles secrets and plaintext. Serving malicious frontend code could expose them. The statement that the operator cannot read files applies to the intended client and protocol, not arbitrary future code served by that operator.

The calldata warning is correct for the inspected v1 design. `scripts/payload-survives.mjs` contains the recovery method and the repository records a public test transaction. The key distinction is whether a permanent ciphertext can be decrypted with secrets the link holder already possesses. Publishing a threshold-encrypted key package is not equivalent to publishing a key wrapped only by the link secret.

## Single upload: choose the unit of encryption

### Whole bundle

One uploaded ciphertext, one content key, many independently expiring grants. Each grant gets a distinct link secret and distinct held-share or wrapped-key package for the same content key. The sender needs a durable way to recover that content key to create subsequent grants; today the key is generated transiently during a send.

This is the smallest change if every recipient should receive the same bundle. A recipient who learned the content key through any grant can keep decrypting that bundle. Revoking another grant cannot undo that knowledge. Separate key wrappers do not turn the same ciphertext into independently revocable copies.

### Individually encrypted units within one uploaded container

A single upload can contain an owner-encrypted directory plus separately sealed components:

- original PDF, available only to the owner unless explicitly shared;
- individual files for file-level sharing;
- extracted marker records for marker-level sharing;
- date or period segments for wearable time-range sharing.

Each component has its own key and nonce; authenticated context binds it to the asset, component identity and format version. The owner directory maps meaningful metadata to opaque positions/identifiers and keys. Recipients receive only the keys and descriptive metadata for the selected components. Never release the owner directory's master key.

A grant can therefore select three markers without uploading the underlying data again. The current archive's one-key encryption cannot implement that property by filtering the UI. If a PDF is one encrypted component, a key for it reveals the whole PDF, including identifiers. Marker-level sharing requires separately encoded marker data at import.

For a simple first implementation the recipient may download the entire encrypted container and decrypt only permitted components. Selective network retrieval is an optimization requiring verification of the container format and gateway APIs; confidentiality does not require range requests. Independent encryption can expose component counts, lengths or layouts unless the format conceals/pads them.

This satisfies one upload for a fixed imported dataset. New measurements, corrected data or newly derived summaries are new bytes and require additional storage. A Swarm feed can point to newer versions but does not mutate an existing content-addressed blob. [Swarm feeds](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds/)

## Proposed objects and storage

| Object | Contents | Location | Lifetime and reason |
|---|---|---|---|
| Asset | Immutable encrypted container and owner-encrypted key directory | Swarm, once per imported dataset | Storage lifetime belongs to the user's archive, independent of a sharing window |
| Asset index | Owner-encrypted reference and summary needed to rediscover an upload | Optional separate Arkiv entity | Durable/renewable discovery, not recipient authorization |
| Grant | Minimal namespace/type, native owner/expiry, protected recipient key package | Arkiv, one per arrangement | Expires when new key release should stop |
| Share link | Grant key plus high-entropy secret | URL fragment on user's chosen delivery channel | Possession credential; not an intended-person identity |
| Owner keys | Root key and derived/wrapped component keys | Sender client; encrypted recovery directory in the original upload | Lets the sender reshare without reuploading |
| Recipient metadata | Display names, selection, dates, component locations | Encrypted inside each grant package | No public health categories or precise scopes unless consciously required |
| Delivery receipt | Optional signed observation of key release | Private encrypted record, only if needed | Separate retention policy; not proof someone read a medical document |

The owner needs a discoverable root reference on a new device. Re-deriving a secret does not rediscover a random content hash. An Arkiv asset index is one option; a private synchronized directory is another. If an asset-index entity expires, design recovery/renewal separately. The installed SDK exposes a `permanent()` maximum-block helper, but its funding and deployed-network practicality require confirmation before relying on it for lifelong records.

Within grants, prefer native `entity.owner` and `entity.expiresAt` to duplicated `sender` and `expires_block` attributes as the authoritative fields. SDK 0.8.1 exposes both, and the current adapter instead trusts custom attributes. Select the native fields explicitly. Retain a custom Unix creation timestamp only if the product actually needs a wall-clock range query; SDK creation metadata is a block number.

Move file types, counts and labels into an owner-encrypted dashboard payload unless server-side filters justify the permanent disclosure. Do not create a medical metadata index merely to improve bounty query depth. Useful compound filters can instead describe workflow type and expiry. The installed query implementation supports native owner and expiry predicates; some high-level and older JSON-RPC docs disagree on field names and queryability, so match the installed SDK and deployed engine.

A public asset ID/reference repeated on every grant makes all those shares correlatable. Put the Swarm reference and component selection inside the link-encrypted grant package when public reverse lookup is unnecessary. Sender address and transaction timing remain visible. Blinding is not anonymity.

## Five ways to remove the centralized KV

### 1. Threshold-protected grant packages — best candidate for asynchronous expiring links

At import, upload the asset and encrypted owner directory once. For grant G:

1. Choose a fresh grant secret S and a fresh grant package key P.
2. Encrypt the selected component keys and reference under P; this is a small package, not another copy of the health data.
3. Split P into a link-derived share and a held share. Encrypt the held share using TACo with an immutable condition bound to the exact Arkiv grant G and its allowed deadline.
4. Encrypt the TACo capsule and the package under a separate S-derived outer wrapping key. Store that envelope in G's Arkiv payload. The URL remains `/s/G#S`.
5. On opening, the browser reads G, unwraps the outer envelope, requests TACo decryption of the held share, reconstructs P, unwraps the permitted component keys, and fetches/decrypts the original Swarm data.

Arkiv retains ciphertext after expiry, but the link alone cannot remove the threshold encryption. The outer envelope also prevents a public crawler from discovering every capsule and collecting held shares while grants are live. Keeping only the link half secret while publishing unauthenticated live-decryptable capsules would allow that prefetch attack.

Grant identity, issuer, asset/selection digest and deadline must be authenticated and bound to the package/condition. Client-provided grant identifiers or endpoints must not let a caller substitute a different live entity for an expired one. The installed SDK supports predicting entity keys before creation, which is one possible way to avoid a circular create-then-bind flow; concurrent nonce handling still needs engineering.

Default entity mutability deserves explicit handling. The SDK's `readonly` flag prevents content/attribute patches but still permits extension, transfer and deletion. A fixed-expiry product must also bind a deadline cap in the release policy; an entity's current existence alone allows an owner to extend a live grant.

Early revocation can use Arkiv deletion, eliminating a separate Redis tombstone. Cached key material remains usable. Requests already authorized around the revocation boundary cannot be recalled.

This removes HealthSend's per-grant secret database. It still relies on the selected threshold operators and the correctness/freshness of their Arkiv observations. Many nodes trusting one HTTPS RPC response share an oracle dependency. Production ritual availability, RPC quotas, condition support and actual absence/error behavior must be tested. No four-digit PIN counter or authoritative access log is provided by this design automatically.

### 2. Independent expiring share holders — decentralized custody with deletion

Split the held share between independent organizations, for example two of three, and have each check Arkiv before release. Each operator keeps expiring secret state. No single operator can release a usable held share; a threshold of operators or retained copies still can. With two-of-three sharing, at least two shares must become irrecoverable before fewer than two remain recoverable.

This removes a single custodian, not state. Three Redis instances controlled by HealthSend are operational redundancy, not independent trust. It adds distributed issuance, partial failures, backup practices, rate-limit coordination and recovery. Conceptual alternative; not an off-the-shelf integration verified here.

### 3. Stateless key-release service — no KV, still a central authority

Store per-grant held shares encrypted to a service public key in authenticated grant packages. A service holding only a master private key checks Arkiv, then returns the held share. A sender-bound envelope authenticates the grant identity and policy; link-derived wrapping keeps public crawlers from prefetching packages.

This removes the per-share database and its write-once/tombstone machinery. The service can still bypass policy, and compromise of its long-lived private key exposes historical encrypted packages to attackers who also possess their links. Epoch private keys can reduce retrospective exposure, but create a key-lifecycle system and coarser expiry boundaries. It is a simplification if the problem is dependency count, not decentralization. An enclave variant changes this to hardware/attestation trust; it does not eliminate trust.

### 4. Sender-held key release — no outsourced key custodian

Only the sender's device holds the recoverable keys. Arkiv carries short-lived invitations or key requests. A recipient generates a browser public key; while the request is live, the sender approves and seals the selected keys to it. Requests and responses can be Arkiv entities, so no new Swarm data upload is needed.

The sender must come online to fulfill a request, and the flow needs authenticated request binding plus replay/race handling. A browser key does not inherently require a wallet popup, but submitting transactions requires funding or a relayer. This fits a consent inbox better than an immediately opening asynchronous bearer link. Once the encrypted response is published for that recipient, its expiry cannot stop that recipient decrypting it later.

### 5. Expiring invitation or future-update lease — remove the secret-release requirement

For invitation expiry, put a normal link-encrypted key package in the grant and let the application refuse expired invitations. This is the smallest Swarm-plus-Arkiv design, but archived payload plus link remains decryptable. Alternatively, release keys only after the sender accepts an unexpired request, as above.

For future-update leases, Arkiv records permission to receive new health updates until a deadline. The publisher checks the lease before encrypting each new update to the recipient. Use independent future keys that recipients cannot derive from old keys. Already delivered updates remain readable; future ones stop. This makes expiry a meaningful workflow rule without attempting to claw back delivered files. New observations require new uploads, but unchanged data is not uploaded for every recipient.

Swarm ACT is relevant to access to versions, not retroactive expiry: its documentation explicitly retains historical access for previously authorized grantees. A generated recipient key could avoid a visible account registration, so mandatory signup is not the decisive objection; historical accessibility is. [Swarm ACT concepts](https://docs.ethswarm.org/docs/concepts/access-control/)

## Challenge the extra entities

- **Delegation:** useful only if a real specialist-sharing workflow needs it. A child's shorter deadline does not enforce earlier parent revocation. Every release must require both parent and child live, with bound scope containment and expiry cap. A recipient who already holds data keys can forward plaintext outside the system regardless.
- **Standing consent:** a strong fit for future publication or accepting inbound records. Its disappearance does not revoke already released keys or stop outsiders publishing unsolicited bytes.
- **Unclaimed invitations:** a useful separate short-lived entity when acceptance and content release are separate events. Do not imply exactly-once claiming without authenticated state transitions; an Arkiv entity created by any caller is not evidence of authorized acceptance.
- **Recipient public keys:** appropriate when recipient binding matters. A cryptographically authenticated binding is necessary; first claimant is not automatically the intended doctor. Losing or changing devices becomes a product concern.
- **Holder heartbeats:** useful discovery/liveness hints, not proof a holder is honest, responsive now, or has deleted secrets. A lease avoids explicit stale-row cleanup but does not automatically push an expiry event.
- **Access-log anchors:** prove consistency with a committed log if the records are available; they do not prove completeness, successful delivery or human reading. Avoid permanent timing metadata unless it has a real user purpose.
- **Revocation receipts:** usually unnecessary when deleting the grant itself drives release refusal. Add a receipt only if a private audit/history requirement justifies it.
- **Attempt counters:** state can in principle live outside Redis, but a generic entity does not provide atomic conditional, private, low-latency authorization logic. A rate-limited short PIN should not dictate the entire product architecture. A high-entropy separate passphrase or recipient key is a different trade.

## What I would validate next

1. Confirm whether sharing granularity is whole bundle, file, marker, or date segment. This decides the first-upload format and cannot be repaired through UI filtering later.
2. Build a synthetic single-upload/two-grant proof: same Swarm ref, different link secrets and deadlines, no second content upload. Demonstrate exactly what a previously authorized recipient can retain.
3. For selective sharing, prove a recipient's key package cannot decrypt any unselected component or original PDF. Do not use real health data in this experiment.
4. Exercise the actual TACo condition against the deployed Arkiv RPC: live, expired, deleted, extended, timeout, malformed response, wrong entity and attempted historical-block substitution.
5. Prove an unauthenticated crawler cannot obtain usable held shares from public Arkiv payloads while grants are live. Verify altered policy/recipient/session parameters cannot redirect a package to a permissive condition.
6. Test new-device owner recovery: the original upload and owner key directory must be discoverable without depending on an expired share entity.

The current [Arkiv ETHRome brief](https://hub.arkiv.network/ethrome) requires app behavior to change because data expires naturally. It does not require secure erasure or a key custodian. Therefore the bounty itself is not a reason to choose the most complex access guarantee. The live page also differs from the vendored manual in scoring and bounty denomination; use the live brief for those details.
