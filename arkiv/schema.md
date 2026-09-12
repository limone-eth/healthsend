# Arkiv schema — HealthSend

## What lives where, and why

HealthSend stores encrypted documents on Swarm and puts one Arkiv entity beside
each share. Arkiv is the index; it never holds a document.

The split follows Arkiv's own guidance — *it is not file storage, and it is not a
confidentiality layer*:

| Data | Where | Why |
|---|---|---|
| Document bytes (ciphertext) | Swarm | Arbitrary size, content-addressed, not queryable and not meant to be. One blob per send, however many documents it holds. |
| Swarm reference + wrapped content key | Arkiv **payload** | Needed on read, never filtered on. |
| Ownership, kind, file type, timestamps | Arkiv **attributes** | The dashboard filters on exactly these. |
| Plaintext, content keys, link secrets | **Nowhere on Arkiv** | Entities are public and permanent-until-expiry. |

## Entity: `grant`

One per share. Created when a sender makes a link; never updated, never deleted.

### Attributes (queryable, public)

| Name | Type | Example | Notes |
|---|---|---|---|
| `app` | `str` | `healthsend` | Namespace, so we never collide on a shared testnet. |
| `kind` | `str` | `grant` | Room for other entity kinds later without a migration. |
| `sender` | `addr` | `0x3579…682C` | The sender's Arkiv key, derived from their Swarm ID. |
| `filetype` | `str` | `pdf` \| `csv` \| `text` \| `mixed` | Coarse and non-identifying, so it stays readable. `mixed` is a real answer, not a fallback. |
| `file_count` | `u64` | `4` | How many documents the send carries. Cheap metadata rather than no metadata — it gives the dashboard a range facet, and it is deliberately coarse. |
| `recipient` | `str` | `9f2c…` (HMAC) | **Blinded.** Equality lookups still work; the value is opaque. |
| `label` | `str` | `4be1…` (HMAC) | **Blinded.** The filename is itself disclosing. |
| `created_at` | `u64` | `1757664000` | Plaintext so ranges and ordering work. |
| `expires_block` | `u64` | `348951` | The block the grant dies at. Mirrors `expires`, so the countdown and the enforcement read the same clock. |

### Payload (opaque, `application/json`)

```json
{
  "v": 1,
  "ref": "<swarm content hash of iv||ciphertext>",
  "wrap": { "iv": "<b64url>", "ct": "<b64url>" }
}
```

`wrap` is the content key encrypted under a key derived from the link secret,
which exists only in the URL fragment. Publishing it here is deliberate and safe:
without the fragment it is indistinguishable from random.

### Lifetime

`expires: ExpirationTime.atBlock(head + window / blockTime)` — an **absolute
block**, not a duration. Nothing renews it and nothing deletes it.

The distinction matters. A duration (`fromSeconds`) is resolved by the engine
against the block the transaction *lands in*, so the real expiry drifts later by
however long inclusion took — the SDK documents the returned value as a lower
bound. That drift is enough for a grant to outlive the window its sender was
shown, which makes the promise and the guarantee two different things. `atBlock`
is exact, and storing the same height in `expires_block` means every countdown we
display is computed from the boundary the engine will actually enforce.

## The attribute-privacy rule

Arkiv attributes are publicly queryable, so nothing semantic goes in one in the
clear. Sensitive values are HMAC'd under a key derived from the user's Swarm ID:

```
recipient = HMAC-SHA256(deriveAppSecret("healthsend/blind/v1"), "Dr. Rossi")[0:16]
```

Equality survives, which is all we need — we only ever query our own data. Range
queries on those dimensions are lost, which costs nothing here. Timestamps stay
plaintext precisely because we *do* want ranges on them.

## Queries

**The sender's dashboard.** A compound filter over six typed attributes, scoped
by owner — not a lookup by id:

```ts
publicClient
  .select({ key: true, attributes: true, payload: true })
  .where(and(
    eq("app", str("healthsend")),
    eq("kind", str("grant")),
    eq("sender", addr(me)),
    eq("filetype", str("pdf")),        // optional facet
    gte("file_count", u64(2)),         // optional facet — bundles only
    gte("created_at", u64(since)),     // optional range
  ))
  .ownedBy(me)
  .limit(50)
  .fetch()
```

Note what is *absent*: there is no `active = true` predicate, because no such
flag exists and nothing would maintain it. Expired grants are gone from the
result because they are gone from the index.

**The recipient's read.** `getEntity(entityKey)` — and a `null` here is the
normal steady state after the window closes, not an error.

## What `expires` actually gives us

Expiry is the product, and it is worth being exact about which part of it Arkiv
provides.

`expires` ends **availability through the index**. When the grant lapses:

- it stops appearing in the sender's dashboard query, with no delete call and
  nothing to maintain;
- the recipient's page can no longer assemble a key, so an ordinary reader
  opening the link later finds nothing.

That is a real property, and it is the one Mission 02 asks for: something in the
app changes because data expired on its own.

**What it is not is erasure.** Entities are created by transactions, and the
payload travels in the calldata. Pruning removes the entity from the live query
surface; the transaction stays. So the wrapped key remains public and permanent,
and anyone who archived it — trivial, it is public while the grant lives — can
pair it with the link fragment afterwards and decrypt.

We believed otherwise for most of a day. `scripts/payload-survives.mjs`
demonstrates the correction against one of our own expired grants, and the README
has the full account under *What expiry does and does not do*.

This is exactly the warning in Arkiv's own docs — *"it is not a confidentiality
layer"* — and our error was subtler than ignoring it: we encrypted the document
before it went in, then put the wrapped key in beside it and assumed pruning was
destruction.

**The fix, if we take this further:** keep the wrapped key out of Arkiv. Hold it
behind something that can stop answering — a threshold share, or an ACT-gated
blob on Swarm with a revoked grantee list — and let the entity carry only a
commitment plus the typed attributes. That is the role the Arkiv docs describe,
and it is what the index is genuinely good at.

## Trade-offs we accepted

- **Blinded attributes cost range queries** on recipient and label. Fine: those
  are equality dimensions in every screen we have.
- **`filetype` stays in the clear.** It is a three-value category that leaks
  almost nothing, and it earns a real second axis in the dashboard filter.
- **The wrapped key is public.** Necessary — the recipient has no account and
  must read it anonymously. Safe, because the other half never leaves the URL.
- **Lifetimes are approximate.** Arkiv counts in 2-second blocks, so a window is
  rounded up to a whole number of them and drifts if the chain runs fast or slow.
  For a twelve-week engagement this is noise; we surface the resolved value
  rather than pretending the number is exact.
