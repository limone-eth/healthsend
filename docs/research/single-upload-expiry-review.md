# HealthSend: one upload, many grants, and expiry without a centralized KV

Research and architecture review, 2026-09-12. This is an options paper, not an approved implementation plan. Application code was inspected but not changed. No end-to-end TACo/Arkiv integration was executed. User constraint: upload the underlying data once, then create potentially many entities and sharing links.

## Recommendation

Separate an **asset** from a **grant**. Encrypt and upload the asset once. Create a separate Arkiv grant and protected key package for each sharing arrangement. For genuinely different subsets of the same upload, encrypt the independently shareable units separately before that first upload.

For asynchronous bearer links that stop receiving new decryption material after expiry, a threshold release service is the most promising way to remove HealthSend's centralized secret store. TACo has a documented arbitrary HTTPS JSON-RPC condition that could consult Arkiv directly. However, the current TACo SDK overview explicitly warns that it lacks a stable operator cohort and supporting mainnet infrastructure, with a relaunch planned for Q3 2026. Treat this as a protocol candidate, not a deployable managed-network dependency until operation is verified. [Current TACo SDK status](https://docs.taco.build/for-developers/taco-sdk). See [the threshold research](threshold-expiry-alternatives.md) for current capabilities and limitations.

## Confirmed expiry requirement

The user selected: **Block new unlocks after expiry, even with the original link.** This requirement accompanies the single-upload/many-grant constraint.

The user subsequently confirmed that **keeping decryption keys only in browser memory is acceptable**, after discussing that recipients can deliberately retain keys or plaintext. Do not persist content keys or released key shares in localStorage, sessionStorage, IndexedDB, service-worker caches or other application-managed persistent storage. Each fresh opening must obtain authorization again; the app must not provide a persistent offline unlock path. The delivered share link still contains its original fragment secret. This is an accepted boundary, not a claim that in-memory keys cannot be copied. Behavior of a document already open at the expiry boundary is a separate UI decision, not specified by this preference.

A recipient possessing the original link, the Swarm ciphertext and archived Arkiv payloads, but no previously released decryption material, must not be able to obtain sufficient new key material after the grant expires. Changing the client, querying transaction history or substituting another live grant must not bypass the restriction.

Keys or plaintext obtained before expiry remain usable. This includes keys obtained through another authorized grant over the same immutable data. The release boundary governs new authorizations, not delivery time of a response already authorized before expiry. Arkiv block expiry remains the authority; RPC uncertainty must refuse release with a retryable unavailable result.

Consequences:

- Invitation-only expiry, hiding the reference, link-only key wrapping and future-update leases alone do not meet the chosen requirement. They remain below as evaluated alternatives, not substitutes for the selected behavior.
- A key-release authority remains necessary: preferably independently operated threshold release if central custody is to be removed, or an explicitly trusted service/committee. Removing the KV alone does not remove that authority.
- Preserve one Swarm upload, separate grant-specific secrets and protected key packages, and independently encrypted components wherever selective sharing is required.
- Do not downgrade to client-side expiry if the release service is unavailable. A working release provider and acceptable trust assumptions are prerequisites for implementation. No specific replacement network is selected or verified live by this review.

Acceptance proof: create two grants for the same uploaded asset with different deadlines. Keep one recipient from obtaining any key material before the first deadline. Afterwards, demonstrate that its original link plus archived grant and ciphertext cannot unlock, while the second live grant still works without another asset upload. Separately demonstrate that previously acquired keys remain usable, and test wrong-grant substitution, public capsule prefetching, revocation and RPC failures.

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

### 1. Threshold-protected grant packages — preferred architecture, deployment availability unresolved

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

This removes HealthSend's per-grant secret database. It still relies on the selected threshold operators and the correctness/freshness of their Arkiv observations. Many nodes trusting one HTTPS RPC response share an oracle dependency. The current TACo operator/infrastructure warning takes precedence over older testnet and mainnet-onboarding instructions. Live network availability, RPC quotas, condition support and actual absence/error behavior must be tested; a promised Q3 relaunch is not confirmation that it has happened. No four-digit PIN counter or authoritative access log is provided by this design automatically.

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

## Practical recommendation today

Implementing the single-upload/many-grant separation does not depend on choosing a release provider immediately. Keep the release mechanism replaceable. The confirmed requirement needs enforced asynchronous unlock expiry. Keep the existing holder provisionally, or evaluate a stateless encrypted-capsule service while explicitly retaining central trust; neither is the final decentralized solution. If independence from HealthSend is non-negotiable, verify an operating third-party service with acceptable trust assumptions or recruit independent holders before committing to it. Current Lit Chipotle uses a TEE-derived-key model, not the older BLS threshold design; it is another distinct trust trade, not evidence that a ready threshold replacement has been found. [Lit model comparison](https://developer.litprotocol.com/lit-actions/migration/encryption)

## What I would validate next

1. Confirm whether sharing granularity is whole bundle, file, marker, or date segment. This decides the first-upload format and cannot be repaired through UI filtering later.
2. Build a synthetic single-upload/two-grant proof: same Swarm ref, different link secrets and deadlines, no second content upload. Demonstrate exactly what a previously authorized recipient can retain.
3. For selective sharing, prove a recipient's key package cannot decrypt any unselected component or original PDF. Do not use real health data in this experiment.
4. Exercise the actual TACo condition against the deployed Arkiv RPC: live, expired, deleted, extended, timeout, malformed response, wrong entity and attempted historical-block substitution.
5. Prove an unauthenticated crawler cannot obtain usable held shares from public Arkiv payloads while grants are live. Verify altered policy/recipient/session parameters cannot redirect a package to a permissive condition.
6. Test new-device owner recovery: the original upload and owner key directory must be discoverable without depending on an expired share entity.

The current [Arkiv ETHRome brief](https://hub.arkiv.network/ethrome) requires app behavior to change because data expires naturally. It does not require secure erasure or a key custodian. Therefore the bounty itself is not a reason to choose the most complex access guarantee. The live page also differs from the vendored manual in scoring and bounty denomination; use the live brief for those details.

## Remote MCP connected to Claude

Discussed as a possible integration, not approved for implementation. The same single-upload asset and expiring-grant model can serve Claude through a remote MCP, but this changes the location of decryption and the trust boundary.

Claude's remote connectors call the MCP server from Anthropic's cloud infrastructure, not from the user's browser or local device. They cannot directly access keys in an existing HealthSend browser tab. Local MCP servers are a separate connection mechanism. [Claude remote connector documentation](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

### Proposed remote read flow

1. The user explicitly authorizes the connector for a particular grant and scope through an authorization flow. Connector credentials identify that authorization; they are not content-decryption keys. Exact credential issuance and key provisioning remain to be designed. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
2. Expose narrow tools such as `read_shared_records`. On every data-bearing tool or resource request, validate connector authorization, current Arkiv grant liveness, and permitted selection. A still-valid OAuth token or an existing MCP session must not bypass grant expiry.
3. The remote service obtains the required decryption material through the selected release mechanism, fetches the existing Swarm ciphertext, decrypts in temporary server memory, and returns only authorized records. No second upload of the underlying asset is needed.
4. Do not return decryption keys or secret-bearing share links in model-visible tool results. Do not ask the user to paste those secrets into the Claude conversation. Any required secret provisioning belongs in the explicit authorization flow, outside model-visible arguments and results.
5. Do not intentionally persist data keys, released key shares or decrypted records in service logs, durable caches or databases. Request-scoped memory is a design constraint, not proof of forensic erasure. Any cache or session optimization must still check the grant on every new release of data.
6. After expiry or revocation, refuse new reads even while the connector remains connected. An unreachable or uncertain Arkiv RPC must produce a retryable unavailable result without releasing data. Check again before returning results from long-running work when needed to enforce the intended response boundary; data already transmitted cannot be recalled.

### Accepted browser behavior does not automatically authorize server decryption

The earlier browser-memory preference applies to the web recipient flow. Remote MCP decryption would move keys and selected plaintext into the remote service's memory. It therefore requires an explicit product/trust decision; this research does not treat that change as already approved. A conventional remote connector cannot both decrypt autonomously and depend exclusively on secrets available only in a closed browser tab. An enclave or separately controlled decryption service changes the trust assumptions rather than removing them.

If keys must stay on the user's device, a local MCP or a deliberately designed browser-assisted bridge is an alternative. The bridge depends on that device being available. Records sent to Claude still leave the device, regardless of where decryption occurs.

### What expiry means for Claude

The promise is: **Claude can fetch these authorized records until the grant expires.** The system can deny new tool reads; it cannot remove records, quotations, summaries or conclusions already returned to Claude from its conversation or downstream copies. The exact retention of that content depends on the Claude product and its settings; this plan makes no erasure or retention-period claim.

This limitation exists even if neither the MCP nor Claude ever receives a reusable content key: returning plaintext is already delivery of information. Avoid bulk export tools unless explicitly intended, since a live connector could otherwise retrieve the entire authorized scope before expiry.

Acceptance checks for this integration: a live grant returns only selected records; the same connector token and MCP session cannot read after expiry; cached data cannot bypass expiry; RPC errors release nothing; tool inputs/results expose no content keys; and the demonstration distinguishes blocked new retrieval from information already present in the conversation.
