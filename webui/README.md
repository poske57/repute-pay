# ReputePay web UI

Astro frontend for the [ReputePay](https://github.com/) JobsManager escrow
contract. It provides wallet connection, World ID–gated client registration,
and a jobs dashboard.

## Pages

| Route   | Description |
| :------ | :---------- |
| `/`     | **Registration** — shows exactly one panel based on the connected account's on-chain status (`clientStaked`). Unregistered accounts get **Register** (World ID proof, then `registerAndStake`); registered accounts get **Unregister** (`unregisterAndUnstake`). |
| `/jobs` | **Jobs dashboard** — lists the connected client's jobs (`clientJobs` + `jobs`) and lets them create new ones (`createJob`, with an ERC-20 `approve` when needed). |

## Architecture

- **Astro** renders the static shell; interactive parts are React islands
  (`client:only="react"`), configured via `@astrojs/react`.
- **Wallet state** is shared across islands with a `nanostores` store
  (`src/lib/walletStore.ts`). The connect button lives in the layout header.
- **Contract access** uses `viem` over the injected EIP-1193 provider
  (`src/lib/jobsManager.ts`); no RPC URL has to be configured client-side.
- **World ID** uses the React component from `@worldcoin/idkit`. The RP signing
  key and Developer Portal calls live in the separate `verifier` worker.

## Configuration

Copy `.env.example` to `.env` and fill in the values. All `PUBLIC_*` variables
are baked into the client bundle at build time.

| Variable                     | Description |
| :--------------------------- | :---------- |
| `PUBLIC_VERIFIER_URL`        | Base URL of the verifier worker (default `http://127.0.0.1:8787`). |
| `PUBLIC_JOBS_MANAGER_ADDRESS`| Deployed `JobsManager` address. |
| `PUBLIC_CHAIN_ID`            | Chain the app operates on (default `480`, World Chain). |
| `PUBLIC_WORLD_APP_ID`        | World ID `app_id` from the Developer Portal. |
| `PUBLIC_WORLD_RP_ID`         | World ID `rp_id`; must match the verifier's `WORLD_RP_ID`. |
| `PUBLIC_WORLD_ACTION`        | World ID action; must match the verifier's `WORLD_ACTION` (default `register`). |
| `PUBLIC_WORLD_ENVIRONMENT`   | `production` / `staging` / `sandbox` (default `production`). |
| `PUBLIC_STAKE_ASSET`         | ERC-20 used as the registration stake (whitelisted on-chain). |

## Registration calldata

`registerAndStake(asset, data)` consumes opaque `data`. For the off-chain
verification path (`trustedServiceVerifier`) the layout is:

| offset | length | field |
| :----- | :----- | :---- |
| 0      | 32     | World ID nullifier |
| 32     | 20     | bounded EOA (the connected wallet) |
| 52     | 65     | ECDSA signature over `keccak256(abi.encodePacked(nullifier, eoa, WORLD_APP_ACTION, WORLD_APP_RP_ID))` |

The verifier returns `nullifier` and `serviceSignature`; set its
`SERVICE_SIGNER_PRIVATE_KEY` to a key whose address equals the contract's
`trustedServiceVerifier`.

## Commands

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Builds the production site to `./dist/`          |
| `npm run preview`         | Previews the build locally                       |
| `npm run deploy`          | Builds and deploys to Cloudflare                 |
