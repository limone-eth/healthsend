---
title: Prizes and Bounties
source: https://ethrome.org/hackermanual/prizes.html
synced: 2026-09-11
---
# Prizes and Bounties

*Two separate things are in play: the ETHRome prize and the sponsor bounties. They work under completely different rules.*

## One year at Urbe Hub

*One ranking, one winning team, picked by the ETHRome judges.*

**One annual membership each, up to 3 people**

A year of desks, rooms and community at Rome's first web3 coworking space: the same room where the hackathon happens. One single ranking for every team, whatever you decided to build. How the winner is picked is on the [Judging](judging.md) page.

## How bounties work

*Four bounties on top of the ETHRome prize. Open a sponsor to read what it wants built.*

1. **Sponsors choose and sponsors pay.** ETHRome has no say in who wins a bounty and does not handle delivery in any way. Each sponsor has its own brief, its own criteria and its own process, and runs any KYC on its own side.
2. **Apply to as many as genuinely fit.** There is no limit, and going after a bounty does not affect how the ETHRome judges score you.
3. **Tick the box in the submission form.** Sponsors only look at the projects that selected their bounty. If you do not tick it, you are not in the running, no matter what you built.
4. **Show them your project on Sunday.** During the judging window from 10:30, teams also walk each sponsor whose bounty they applied to through what they made. That conversation is between you and the sponsor.

### Arkiv · $2,500: A Web3 database you can actually query

*Three missions at $500 each, plus $1,000 for the best use overall.*

| Value | Detail |
|---|---|
| **$500** | Mission 01, Decommission |
| **$500** | Mission 02, Built to expire |
| **$500** | Mission 03, Live wire |
| **$1,000** | Best Use of Arkiv, overall |

**Arkiv builds Web3 databases.** It merges the guarantees of a blockchain with the convenience of a traditional database. Data lives in entities: records with typed attributes you can query and filter with real operators, not just a key you fetch by id. Every entity is owned by the wallet that signed it and carries an expiration date you choose; once it expires it stops showing up in queries, and you can renew it before that with a lifetime extension. Built for Ethereum, powered by GLM.

#### What Arkiv is not, worth reading before you pick it

**It is not file storage.** It does not replace IPFS, Arweave or S3, and large files do not go on Arkiv. Think of it as the index over your data rather than the place your data lives: leave the file where it is and put an Arkiv entity beside it, a hash, a URL or a CID, plus the typed attributes you actually want to search on. Your queries hit the index; the bytes stay where they belong. If you need to split something bigger across entities there is a parent-and-chunks pattern: find them on site and they walk you through it.

**It is not a confidentiality layer.** Entities are public and verifiable by design, so secrets and personal data stay out. Store a hash or a commitment instead, or encrypt your own data before it goes in.

#### Why it is worth your weekend

Arkiv is an early product and they say so: they are coming to Rome to find the issues in the docs, the faucet, the API keys, the SDK, the features and the explorer, and 40 people using all of it at once is the best test they can get. That is why every entry files a bug report, why its quality is a fifth of the score, and why a ten-minute conversation with them is a qualification requirement rather than a nice-to-have. If you like being the person who finds the edge, this is the bounty for you.

Their Friday session leaves you with a draft `/arkiv/schema.md` for your own project, which is requirement 1 of the bounty. Twenty minutes, and the first deliverable is done.

> 🎯 **Pick at least one mission.** Each mission pays $500 to the best qualifying entry that completed it, and every qualifying project competes automatically for the $1,000 Best Use of Arkiv. Doing all three puts you in three prize lines, but a team wins once: it does not pay three times.

#### Mission 01. Decommission · $500

**Done when** your app answers, from Arkiv, a question it answers today through a subgraph, Ponder or a Postgres pipeline, and its read path no longer calls the indexer.

**The decision that decides it:** what goes in attributes, which you can query, versus what goes in the payload, which you cannot. Get it wrong and every query turns into a scan. Aim for a compound filter, not single-attribute equality.

**They check:** they run your query and see the question answered, and you link the commit from before the migration. You never have to prove a hosted service is switched off. If you did not arrive with an indexer already running, pick another mission rather than inventing one to turn off. If you did, that is a pre-existing project under the [ETHRome rules](rules.md): say so in your submission, and only the new part gets judged.

#### Mission 02. Built to expire · $500

**Done when** something in your app changes because data expired on its own, not because a job deleted it. Expiration is the feature, not an add-on.

**Two patterns:** let an entity lapse and treat its absence as the signal, or extend it on activity, which gives you a lease, a sliding expiry that nothing has to maintain.

**They check:** the same query before and after the boundary, with no delete call in between. Keep lifetimes at seconds or a couple of minutes, because nobody can wait on Sunday morning. A recording made on Saturday counts.

#### Mission 03. Live wire · $500

**Done when** your app updates from a subscription rather than from a refresh loop of your own.

**Know this before you pick it:** the SDK's subscribe helper only opens a real socket if your client uses a websocket transport. With an HTTP transport it quietly polls once a second and the code looks identical. Passing a start block to replay history forces polling too, so the backfill you reach for after a dropped connection is the very thing that turns your subscription back into a loop. Working that out is the mission; put what you find in your `friction.md`.

**They check:** the line where you build the client, showing a websocket transport, and your live subscription with no start block. A two-wallet demo on its own cannot tell a socket from a poll, so they need both: the code and the demo (one of you writes, the other's screen updates without a refresh), plus a few lines on what happened when you dropped the connection.

> ⚠️ **Mission 03 needs a live websocket endpoint.** If one is not available during the event, Arkiv says so at the opening ceremony and the mission is off. The other two missions and the $1,000 are unaffected either way.

#### To qualify

- [ ] **Tick Arkiv on the ETHRome submission form** and name the missions you went for.
- [ ] **Public repo** with everything they score in it by the ETHRome deadline, Sunday 10:00.
- [ ] **A draft `/arkiv/schema.md`** in the repo. Their Friday session gets you there.
- [ ] **A `friction.md` bug report**: what broke, what confused you, what you worked around. It is a fifth of the score.
- [ ] **A ten-minute conversation with the Arkiv team by Saturday 20:00.** That is when you give them your repo URL. It cannot be done on Sunday morning.

> 🔗 **Full requirements, schema template and support hours** live on their ETHRome page, [hub.arkiv.network/ethrome](https://hub.arkiv.network/ethrome), kept current during the event. It goes live before the weekend (TBD). The list above is everything their brief states today; if their page adds a requirement, this block is updated and the Telegram group gets a ping.

#### How they score, one ranking for everything

Only entries that qualified get scored. This single ranking decides Best Use of Arkiv and, within each mission, who takes its $500.

1. **Query depth, 30.** Compound filters over typed attributes that do real work, not a lookup by id.
2. **Evidence and reproducibility, 20.** They can run what you claim.
3. **Arkiv fit and trade-offs, 20.** What went in attributes, what stayed in the payload, and why.
4. **Friction quality, 20.** The bug report. Precise, reproducible, honest.
5. **Craft, 10.** Clarity, reliability and completeness. Not visual polish.

#### How winners get paid

Prizes are paid directly by the Arkiv team (Golem Factory GmbH) as a grant for delivered open-source work. ETHRome handles no part of it.

1. **Winners are announced at the closing ceremony**, Sunday 13 September at 15:00.
2. **KYC opens the next business day**, run by the Arkiv team through a secure form sent to winners directly. They never ask for identity documents over Discord, email or a shared sheet.
3. **One payee per team.** One person completes KYC; the rest of the team signs a one-page authorisation naming that payee.
4. **Funds are sent within 10 business days** of a complete KYC pack. One prize per team. Taxes are the winner's own responsibility.

> 💰 **Paid in USDC on Ethereum.** Arkiv confirmed the rail on 3 September: $2,500 in total, in USDC, on Ethereum. The four figures above are what a winner receives.

#### Everything you need to start

**Start here**

- [Arkiv at ETHRome](https://hub.arkiv.network/ethrome), rules, schema template, support hours. Live before the weekend.
- [Arkiv Hub](https://hub.arkiv.network)
- [docs.arkiv.network](https://docs.arkiv.network)

**Code and SDK**

- TypeScript SDK: `npm install @arkiv-network/sdk`, v0.7.x
- Searching npm? `arkiv-sdk` and `golem-base-sdk` are the previous lineage, not the one to install.
- [Arkiv on GitHub](https://github.com/arkiv-network)

**Ask**

- [Arkiv Discord](https://discord.gg/arkiv)
- The Arkiv topic of the ETHRome group chat, for anything about the bounty itself
- [Brand assets](https://arkiv.network/brand), if you want their logo in your demo

> 💬 **Who to talk to.** Santiago Trujillo Zuluaga, **@SantiagoDevRel**, for data modelling, the SDK and the bounty sign-offs. Shantelle Awomoyi, **@shantelleawo**, for anything about prizes. Both are in the Arkiv topic of the ETHRome group chat and on site the whole weekend.
>
> They walk the floor rather than sit at the table, especially on Saturday. If they are not at their spot, ask an organiser to ping them. Mentor sessions and sign-offs run all Saturday until 20:00.
>
> Santiago's session is Friday at 19:00: **From Postgres to Arkiv: web2 to web3 database in 20 minutes**. A live migration of a Postgres database to Arkiv with an AI assistant connected to their ETHRome Arkiv MCP, table by table, on screen. Beginner friendly, and you leave with the schema.md the bounty asks for. Shantelle also opens the weekend with a short keynote inside the opening ceremony at 18:30.

### Swarm · $1,000: Build an app where users own their data

*Two winners at $500 each. Free storage all weekend.*

| Value | Detail |
|---|---|
| **$1,000** | total bounty from Swarm |
| **$500 each** | two winners, no fixed categories |

**Swarm is a decentralised storage and communication network** run by peer to peer Bee nodes. You upload data and get back a content hash, a permanent address derived from the bytes themselves, and anyone with that hash can retrieve the content from any Bee node or public gateway. Data can be encrypted so only the people you grant access to can read it. Storage is paid for directly with a postage batch rather than rented from a platform, so the data stays yours: no origin server, no platform account, no company sitting between your users and their files.

#### Why it is worth your weekend

Swarm is data infrastructure, so it plugs into whatever you were already planning to build rather than competing with it. Build the project you actually came to build, then put its data on Swarm. They would rather see one thing working well than five things half built.

- **Already using cloud storage?** Put that data on Swarm and your users hold it rather than rent it.
- **Building with AI?** Put the agent's memory on Swarm, readable from any device and any app the user permits, instead of living inside one provider.
- **Working on privacy?** Encrypt it, grant and revoke access by key, and keep it retrievable from any node for as long as its postage batch is paid.

Directions they find interesting: portable AI memory that moves between assistants, provenance for AI output through content addressing, agent coordination over Swarm feeds, a knowledge base you own and query with an LLM, publishing that stays up. Plenty of good ideas have nothing to do with AI and are just as welcome: encrypted file sharing, a social feed, a media gallery where the uploader owns the data.

> ⚡ **Free storage all weekend.** Swarm brings gift codes that cover storage for the whole hackathon, so no team needs to acquire xBZZ or xDAI to build. Pick one up at the Swarm desk on Friday evening and you spend Saturday building instead of onboarding.

#### The fast path in: Swarm ID

Normally, uploading to Swarm means running a funded Bee node and buying a postage stamp, which means acquiring xBZZ and xDAI on Gnosis Chain before you have built anything. [Swarm ID](https://swarm-id.snaha.net) takes that off your critical path. It is a cross browser identity layer for Swarm apps: your users sign in with a passkey or an Ethereum account, then upload and sync across devices under one account. Crucially for a hackathon, **there is no Bee node to run**. Swarm ID signs postage stamps in the browser and reads batch state straight from the chain, so your app reaches Swarm through a public gateway and there is nothing to install before you write code.

#### To qualify

- [ ] **Public repo.** An open source license is appreciated.
- [ ] **Short README** saying what it does, how to run it, and where in the code Swarm is used.
- [ ] **A demo**, live, video or in person, showing it working on Swarm.
- [ ] **One line on where you would take it next.**

#### How they judge, in order

1. **Someone would want to use it.** A clear use case and a demo that lands. Rough edges are fine, a reason to exist is not optional.
2. **It genuinely runs on Swarm.** Real uploads, real retrieval. Swarm should be doing real work in the app rather than sitting in the README.
3. **Swarm earns its place.** There should be a real reason the app needs decentralized storage, and the README should say what it is. Building on Swarm for the sake of it is not one.
4. **It uses Swarm ID.** Strongly recommended but optional. If Bee-js genuinely suits your app better, say why in the README and they judge on the first three.

As a sketch of two different ways to win: the app they would most want to keep using, and the most inventive use of Swarm itself. Whichever two are strongest win.

#### After the weekend

The Swarm Foundation is interested in projects worth continuing, not just demos. If something promising comes out of the weekend they will talk to the team afterwards about how to support it, and a grant conversation is one of the options on the table.

#### Everything you need to start

**Start here**

- [Swarm ID getting started](https://swarm.snaha.net/docs/getting-started)
- [Demo app](https://swarm-demo.snaha.net)
- [Identity UI](https://swarm-id.snaha.net)
- [Source on GitHub](https://github.com/snaha/swarm-id)
- Install: `npm install @snaha/swarm-id`

**Docs and SDK**

- [Developer cheatsheet](https://swarm-devrel.bzz.link), two pages, print ready. First upload with no install, running and funding a Bee node, Bee-js, swarm-cli, gateways, AI assisted setup.
- [docs.ethswarm.org](https://docs.ethswarm.org)
- [Bee-js SDK](https://github.com/ethersphere/bee-js)

**Learn from these**

- [Swarm MCP App](https://github.com/ethersphere/swarm-accelerator/issues/15), stamp and file management inside AI conversations.
- [Swarm Mail](https://github.com/ethersphere/swarm-accelerator/issues/14), feeds as encrypted mailboxes.
- [Swarm Meet](https://github.com/ethersphere/swarm-accelerator/issues/10), peer to peer video with metadata on Swarm.
- [Swarm Collab](https://github.com/ethersphere/swarm-accelerator/issues/8), collaborative editor with versions on Swarm.
- [Etherjot](https://github.com/Cafe137/etherjot), blog editor publishing to Swarm.
- [More in the accelerator issues](https://github.com/ethersphere/swarm-accelerator/issues)

> 💬 **Who to talk to.** Their mentors **@Riky0923**, **@yjkellyjoo** and **@rakymi** are in the Swarm topic of the ETHRome group chat. Tag any of them with a question.
>
> The Swarm Foundation desk is at Urbe Hub all weekend for mentoring, debugging and gift codes. Their Discord is at [discord.ethswarm.org](https://discord.ethswarm.org).

### Team1 · $1,000: Stablecoins and tokenized assets that do real work

*Two tracks, four prizes. Fuji testnet only.*

| Value | Detail |
|---|---|
| **$400** | Track A, 1st place |
| **$200** | Track A, 2nd place |
| **$300** | Track B, 1st place |
| **$100** | Track B, 2nd place |

**Team1 Italy helps builders turn ideas into demonstrable onchain products.** At ETHRome they are after one thing: a tight problem, a working Avalanche build, and proof that it runs. A public repo, a live demo, real onchain activity. Not a pitch.

You do not need any prior Avalanche experience. A focused project deployed on Fuji testnet is a valid submission, and both tracks are cut to fit a two day build window rather than a quarter of engineering.

> ⚡ **Testnet only, and that is the point.** Build on Avalanche Fuji C-Chain with test assets. No mainnet deployment, no custom L1, no audit and no real user funds are required for either track, so nothing stands between you and the first commit. Test AVAX comes from the Core testnet faucet, linked below.

#### Track A. Stablecoins That Do Real Work · $600

Build a stablecoin product that solves a real workflow: payments, payroll, treasury management, savings, yield or risk UX, cross-chain onboarding, automated settlement.

Your project has to demonstrate **one complete user flow, from action to onchain proof**. In their words, another generic swap interface will not qualify.

**1st place $400 · 2nd place $200**

#### Track B. Tokenized Assets: Rules to Settlement · $400

Build a prototype for issuing, transferring, settling or managing a tokenized financial asset, using test data and test assets. An invoice, a fund unit, a revenue share, a ticket, a collateral claim, or any other financial right with a clear lifecycle.

Your build has to show **an asset rule, an eligibility or transfer policy, and settlement or payment logic**. In their words, a landing page or a dashboard without an end-to-end onchain flow will not qualify.

**1st place $300 · 2nd place $100**

> 🎯 **Pick one track.** Team1 accepts one submission per project, and each project enters one track only. This is the one place on this page where the rule is not apply to everything that fits. The submission form asks you which track, so decide before Sunday morning.

#### To qualify, in both tracks

- [ ] **Public source repository** with a readable README and run or deploy instructions.
- [ ] **A working demo**, presented in person at ETHRome.
- [ ] **A Fuji deployment**, a transaction, or a live test environment.
- [ ] **A clear explanation** of the user problem, your architecture and the Avalanche component.
- [ ] **Original hackathon work**, eligible under the ETHRome rules.

> ⚠️ **Team1 asks for a second step.** Ticking Team1 on the ETHRome submission form is necessary and not sufficient: they run their own bounty page and submission form, and for this bounty you fill in both.
>
> They publish that link before the event. It lands here and in the Telegram group the moment it does, so check this block again on Friday. Until then, ticking the box on the ETHRome form is what puts you on their list.

#### How they judge

1. **Usefulness and clarity of the problem, 35%.** Who it is for and what it fixes. The largest single slice of the score, ahead of the code.
2. **End-to-end working demo, 30%.** The whole flow, running in front of them.
3. **Meaningful Avalanche integration, 20%.** The onchain component does real work in the product.
4. **Product quality and user experience, 15%.**

On close calls they lean towards projects that use native Avalanche interoperability, token-transfer, privacy or policy-enforcement primitives. They are explicit that these are optional enhancements and not baseline requirements, so bolting one on to chase points is not the move.

#### Everything you need to start

**Start here**

- [Avalanche docs](https://docs.avax.network/)
- [Core testnet faucet](https://core.app/tools/testnet-faucet/), for Fuji test AVAX

**Code and SDK**

- [Ava Labs on GitHub](https://github.com/ava-labs)
- [AvalancheJS](https://github.com/ava-labs/avalanchejs)

**Ask**

- [Avalanche developer Discord](https://discord.gg/avax)
- The Team1 topic of the ETHRome group chat, for anything about the bounty itself

> 💬 **Who to talk to.** Giacomo Barbieri, **@ijaack94**, is in the Team1 topic of the ETHRome group chat, on site all weekend with a second Team1 mentor.
>
> His session opens Friday evening at 19:30: **Build the Proof, Not the Pitch: Shipping a Verifiable Avalanche Project**, twenty minutes. It walks through the Avalanche build surface and the bounty requirements, which makes it the cheapest twenty minutes of your weekend if you are going for this one.

### ENS · $500: Build with ENSv2

*Up to five projects share the pool.*

| Value | Detail |
|---|---|
| **$500** | pool prize from ENS |
| **Up to 5** | projects share the pool |

**ENS is the Ethereum Name Service.** This bounty is not about the ENS you already know: it is about **ENSv2**, the next evolution of the protocol, live in beta on Sepolia. It introduces hierarchical registries, enhanced role based permissions, per account resolvers and programmable subname infrastructure.

#### What to build

A functional project that uses ENSv2 as a core part of its architecture. It can go after any of the three ETHRome directions, AI, Finance or Privacy, but the ENS side of it has to run on the **ENSv2 beta deployment on Sepolia**.

Directions they find interesting, as examples rather than restrictions:

- A custom subname registry for users, applications or communities.
- Names and profiles for AI agents inside an agent controlled namespace.
- Rentable, permissioned or unruggable subname systems.
- ENSv2 roles used to delegate management of names, records or subnames.
- Financial applications built around named accounts, payment profiles or contracts.
- Experiments with per account resolvers, record permissions or record aliasing.
- Privacy aware identity or payment systems using custom resolvers.
- ENSv2 migration, indexing, monitoring or developer tooling.

What they are asking for, in one line: show them what becomes possible when every ENS name can operate its own programmable registry.

#### To qualify

- [ ] **It talks to the official ENSv2 beta contracts on Sepolia.**
- [ ] **ENSv2 does real work in the product**, rather than sitting there for display.
- [ ] **The integration runs end to end on live testnet data.**
- [ ] **The demo stands on its own.** No hard coded names, addresses or results.
- [ ] **An accessible source code repository** comes with the submission.
- [ ] **The relevant Sepolia names, contract addresses or transaction links** are provided.
- [ ] **A working demo or a demo video**, plus an explanation of your ENSv2 architecture during judging.
- [ ] **Built or materially extended during ETHRome.**

> ⚡ **It has to be v2.** Resolving an existing ENS name, showing the ENS profile your wallet hands you or pointing an RPC endpoint somewhere else, without touching ENSv2 specific functionality, does not qualify. The v2 features are the bounty.

#### How they judge, in order of weight

1. **Depth of the ENSv2 integration.** How far into v2 you actually went.
2. **Technical execution and completeness.**
3. **Creativity and usefulness.**
4. **Relevance to AI, Finance or Privacy.**

#### Prize and payment

Up to five projects take a share of the $500 pool. **ENS picks the winners and the ENS team handles the payout directly**, like every sponsor on this page. **Tick ENS in the submission form** to be considered.

#### Everything you need to start

**Start here**

- [ENSv2 overview](https://docs.ens.domains/ensv2/overview/)
- [Guide for application developers](https://docs.ens.domains/ensv2/guides/app-developers/)
- [Guide for contract developers](https://docs.ens.domains/ensv2/guides/contract-developers/)

**Poke at it live**

- [ENSv2 Explorer](https://explorer.ens.dev/)
- [ENSv2 Subregistry Lab](https://ens-subregistry-demo.netlify.app/)
- [Subregistry Lab source code](https://github.com/yashgo0018/subregistry-lab)

> 💬 **Who to talk to.** Questions about this bounty go in the General topic of the ETHRome group chat and the organisers relay them to ENS. For the stack itself, the docs and the explorer above answer faster than anyone.

**$5,000** in sponsor bounties, on top of the ETHRome prize.
