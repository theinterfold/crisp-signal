# CRISP Signal

A demo signalling app for institutions on the running Sepolia and Aztec testnets. Organisers create
polls on Ethereum; voters prove eligibility with [ZKPassport](https://zkpassport.id) (one passport or
national ID card, one vote) and cast secret ballots on Aztec through
[CRISP](https://github.com/theinterfold/CRISP) on the Interfold. Only the final tally is ever
decrypted. Results are signals: nothing is executed on-chain.

```
contracts/   Foundry: CrispSignalAztec, the poll board on Sepolia
app/         Vite + React front end; vendor/ holds the CRISP SDK tarballs
```

## How it fits together

```mermaid
sequenceDiagram
  participant O as Organiser (Sepolia wallet)
  participant B as CrispSignalAztec
  participant I as Interfold
  participant P as CRISPAztecProgram (L1)
  participant R as ZKPassportRegistrar (L1)
  participant K as Keeper
  participant A as CRISP contract (Aztec)
  participant V as Voter (browser, no wallet)
  participant S as CRISP server
  O->>B: createPoll(metadata CID, options, window, age, nationality, registration path, mock IDs)
  B->>I: request E3 (program P, customParams)
  I->>P: validate → round message to Aztec
  K->>A: open the round, relay the committee key
  alt registration on Ethereum (default)
    V->>S: ZKPassport compressed-evm proof bound to the voter's slot, as register() calldata
    S->>R: register (the server pays the gas)
    R->>P: registerMember(slot) → Inbox message
    K->>A: add_member_from_l1(slot)
  else registration on Aztec (needs a bb-6 ZKPassport app)
    V->>A: register(ZKPassport compressed proof bound to the voter's Aztec account) + slot
  end
  V->>S: ciphertext, staged and attested
  V->>A: cast(ballot proof, attestation)
  A-->>P: after the epoch is proven: input root (via the Aztec outbox)
  I-->>P: tally decrypted by the committee
```

- **Poll board** (`CrispSignalAztec`, Sepolia) requests the poll's E3 from the Interfold with the
  Aztec CRISP program, passing `abi.encode(numOptions, 1, minAge, allowMockDocuments, registrar,
  nationalityMode, countries, nationalityCommitment)`. It is the E3 requester, so it pulls the Interfold
  fee from the creator and forwards any refund of a failed round (`claimRefund`). The metadata CID and a
  poll list live in the board. The board is built for one `ZKPassportRegistrar` (`REGISTRAR`, which must
  belong to the same program): a poll either registers its voters through it (`l1Registration`) or on
  Aztec (registrar zero), never both, since two paths would be two uniqueness domains. A creator cannot
  name a registrar of their own.
- **Eligibility rules** are fixed per poll: a minimum age (up to 99) and a nationality rule, none, only
  these countries, or all but these (1 to 200 ICAO alpha-3 codes, picked in the create page; mock
  documents carry `ZKR`). The program announces them in its `RoundRules` event and the poll page shows
  them from the E3's custom parameters. On the Aztec path the contract verifies proofs against
  ZKPassport's Poseidon2 commitment to the country list, which Ethereum cannot recompute: the create
  page computes it with `nationalityCommitment` of `@crisp-e3/aztec`, and the poll page recomputes it
  from the announced list and refuses to register voters on a mismatch. The registrar checks the list
  itself on the Ethereum path.
- **Registration on Ethereum** (the default: it works with the ZKPassport app's `compressed-evm`
  proofs today). The browser makes the poll's slot (an EVM key kept in `localStorage`) and asks the
  ZKPassport app for a `compressed-evm` proof for the registrar's domain (`poll.theinterfold.com`),
  the round's scope (`scopeOf(e3Id)`), the age and nationality rules, and the slot and Sepolia bound
  into the proof. It sends `ZKPassportRegistrar.register` calldata to the CRISP server's
  `POST /registration/l1`, which simulates it and submits it with its own key, so the voter has no
  wallet and pays no gas; the bound slot means nobody can redirect the proof. The registrar sends the
  slot to Aztec through the Inbox and the keeper adds it (`add_member_from_l1`); the page follows the
  Ethereum transaction, then waits for the slot's `MemberRegistered` log on Aztec, a few minutes. A
  reload resumes the wait.
- **Registration on Aztec** needs a ZKPassport app whose proofs are made with Aztec 6's prover (bb 6),
  which the shipped app (circuits 0.21.0, bb 5) is not. The browser makes an Aztec account (kept in
  `localStorage`), asks the ZKPassport app for a `compressed` proof for the same domain and scope,
  the age and nationality rules, and the Aztec account bound into the proof, then proves and sends
  `register` / `register_with_age` / `register_with_nationality` / `register_with_age_and_nationality`
  in the browser. Fees are paid by Aztec's SponsoredFPC, so voters need no wallet and no gas.
  Each document registers once per poll.
  The registered slot is an EVM key made for this poll and kept in `localStorage`, so the voter's
  account and the slot are not linked on chain.
- **Metadata** (title, organisation, description, option labels) is pinned to IPFS by the app's
  `/api/pin` function (`app/api/pin.ts`), which holds the Pinata key server-side and pins only
  well-formed poll documents; the board stores the CID.
- **Voting** uses `@crisp-e3/sdk`: the committee key comes from the CRISP server and is checked
  against the key commitment on Aztec, the ballot is proved in the browser (noir-recursive fold
  proof), staged with the CRISP server, which attests availability, and cast on Aztec. Voters can
  recast; the latest ballot counts. The app keeps each ciphertext it cast, because the server only
  indexes a ballot once Aztec has proven its epoch and a revote has to build on the latest one.
- **Masks**: anyone can add an unsigned all-zero ballot to a uniformly random registered slot, or to
  their own. The circuit adds it to the slot's current ciphertext, so no choice changes, but on Aztec
  it is indistinguishable from a vote or a re-vote, which makes vote receipts unreliable.
- **Results** are 1-2 hours slower than on Ethereum alone: after voting closes, the round's input root
  reaches Ethereum only once Aztec has proven the epoch (the program waits at least its
  `remoteFinalityWindow`, 3 hours on the current deployment, inside the Interfold's compute window);
  then the tally is computed and decrypted. The app reads the tally from the program's `decodeTally`
  and a poll's status from Ethereum plus Aztec's public logs.

## Contracts

```sh
cd contracts
forge build
forge test                                                  # unit tests
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com \
CRISP_AZTEC_PROGRAM=0x... ZKPASSPORT_REGISTRAR=0x... forge test   # + Sepolia fork test
```

The fork test creates polls of both registration paths (with and without a nationality rule) through
the board on a Sepolia fork and checks the E3 each requests and the round the program opens.

Deploy (needs a funded Sepolia key, the Aztec CRISP program from crisp-aztec's Sepolia deployment and
that program's `ZKPassportRegistrar`):

```sh
CRISP_AZTEC_PROGRAM=0x... ZKPASSPORT_REGISTRAR=0x... \
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --skip-simulation --private-key $PRIVATE_KEY
```

`--skip-simulation` is required: Sepolia now prices contract creation far above what forge's local
simulation charges, so a simulated gas limit runs out. With the flag, forge uses the node's
`eth_estimateGas`. The constructor checks the program is bound to the same Interfold as the board and the registrar to that program.

After changing the contracts, regenerate the app's ABI from `contracts/out` into
`app/src/lib/contracts.generated.ts`.

## App

```sh
cd app
npm install             # the CRISP SDKs are tarballs in vendor/
cp .env.example .env    # set VITE_BOARD_ADDRESS and PINATA_JWT
npm run dev             # http://localhost:5180
npm run build
```

`vendor/crisp-e3-sdk-0.28.1.tgz` is `@crisp-e3/sdk` from crisp-aztec with the `noir-recursive` fold
target; `vendor/crisp-e3-aztec-0.28.1.tgz` is `@crisp-e3/aztec` with the CRISP Aztec contract's
artifact. Rebuild them with `pnpm pack` in `packages/crisp-sdk` and `extensions/aztec/sdk` of
crisp-aztec (the Aztec SDK carries `nationalityCommitment`, the registrar calldata builder and the
relay client the app uses). `package.json` overrides `@crisp-e3/sdk` so the Aztec SDK uses the vendored one.

| Variable | Purpose |
|---|---|
| `VITE_BOARD_ADDRESS` | Deployed `CrispSignalAztec` (required) |
| `VITE_SEPOLIA_RPC_URL` | Ethereum reads |
| `VITE_CRISP_SERVER_URL` | Hosted CRISP server in Aztec mode (`https://private-crisp.theinterfold.com/aztec`): committee key, ciphertext staging, and `POST /registration/l1` for registrations on Ethereum |
| `VITE_AZTEC_NODE_URL` | Aztec testnet node (default `https://aztec-testnet.drpc.org`) |
| `VITE_ZKPASSPORT_DOMAIN` | ZKPassport domain of the Aztec contract, for polls that register on Aztec (default `poll.theinterfold.com`). Polls that register on Ethereum use their registrar's `domain()` |
| `VITE_IPFS_GATEWAY` | Reads poll metadata |
| `PINATA_JWT` | Server only: `/api/pin` uses it to pin poll metadata. Never bundled |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional: adds WalletConnect to the wallet modal (poll creators only) |

The Aztec contract's address is read from the board (`CRISP_PROGRAM().l2Program()`), and the CRISP
server's config is checked against it; for a poll that registers on Ethereum the server's
`zkpassport_registrar` must also be the poll's registrar. Only the create page (and a failed poll's
refund, for its creator) uses a wallet: registering, voting, masking and reading results need none, so
the wallet button only shows on the create page.

`npm run dev` serves `/api/pin` through a Vite middleware, the same handler Vercel runs in
production. Hosting must send `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (the browser prover needs `SharedArrayBuffer`); the dev
and preview servers already do, and `app/vercel.json` sets them on Vercel along with the SPA
rewrite. Everything the page fetches must allow it (CORS), including the Aztec node and the CRISP
server.

Creating a poll costs the Interfold fee in Sepolia MockUSDC (about 22 USDC for a one-day poll with
the Minimum committee); the create page links the testnet faucet. A poll's voting window must open
after the committee's key setup (about 40 minutes) and last at least an hour.

Voting is real in-browser proving (Aztec private kernel proofs, then the ballot's fold proof): expect a
minute or more per transaction, and keep the tab open. So is registering on Aztec; registering on
Ethereum proves only on the phone, then waits a few minutes for the keeper.

## Limits

- Eligibility is per document: a person with two qualifying documents can register twice.
- A poll registers on one path only. The Aztec path does not work until ZKPassport ships an app proving with bb 6.
- On the Ethereum path the CRISP server is the relayer: it cannot redirect or forge a registration, but can delay one by not submitting it.
- Verification trusts ZKPassport's circuits and its certificate registry (on Ethereum or on Aztec, per path), which ZKPassport
  administers. The contract verifies one circuits release (see `circuitsVersion` in the deployment).
- Polls that accept mock IDs (dev mode) are open to anyone.
- The Aztec account and the slot keys live in the browser's `localStorage`: clearing it forfeits a
  registration. The poll page offers a backup download.
- Masks are opt-in: they protect only as far as voters actually submit them.
- The Sepolia CRISP deployment uses a mock compute verifier and mock data availability.

## Current Sepolia deployment

| App | `CrispSignalAztec` | Aztec CRISP contract |
|---|---|---|
| https://poll.theinterfold.com | [`0xBEDF93604Bad4c545FFBf79971fD29f73F2bc641`](https://sepolia.etherscan.io/address/0xBEDF93604Bad4c545FFBf79971fD29f73F2bc641) | `0x1b727fd4de17bbf7d439aea713ceb0591fcb97291fe9b120a20ee17b4043b59d` (Aztec testnet) |

The board's CRISP program is [`0xF2F8047C478FAE4a0b9cf8B500211315fDfdd7F1`](https://sepolia.etherscan.io/address/0xF2F8047C478FAE4a0b9cf8B500211315fDfdd7F1) and its
`ZKPassportRegistrar` (domain `poll.theinterfold.com`, proofs valid seven days) is
[`0x10744Ca11f6c90D106e9Aa73a0D421Fa88B4cF17`](https://sepolia.etherscan.io/address/0x10744Ca11f6c90D106e9Aa73a0D421Fa88B4cF17).
