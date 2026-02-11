# Crowdfunding DApp + Reward Token (Blockchain 1 Final Project)

Decentralized crowdfunding application for **Ethereum test networks**.
Users can create campaigns, contribute test ETH, and receive an internal ERC-20 reward token minted automatically during participation.

> **Educational project only.** Uses test ETH/testnets only. No real monetary value.

---

## Features (matches course requirements)

- Create crowdfunding campaigns with:
  - title (stored off-chain, see notes)
  - funding goal (in wei/ETH)
  - duration (seconds) → deadline timestamp
- Contribute test ETH to active campaigns
- Track individual contributions per campaign
- Finalize campaigns **only after deadline**
- If successful: campaign creator can withdraw raised ETH
- If failed: contributors can claim refunds
- Mint internal ERC-20 reward tokens on each contribution:
  - `RATE = 1000`
  - `reward = msg.value * RATE`
- Display connected wallet balances:
  - Test ETH balance
  - Reward token balance

---

## Repository Structure

- `contracts/`
  - `Crowdfunding.sol` — campaigns, contributions, finalize, withdraw/refund
  - `RewardToken.sol` — ERC-20 token with `AccessControl` minting
- `scripts/deploy.js` — deploys both contracts and grants `MINTER_ROLE`
- `test/Crowdfunding.test.js` — unit tests for core behavior and custom errors
- `frontend/` — React (Vite) UI using `ethers` v6 + MetaMask

---

## Architecture Overview

### Smart Contracts
**RewardToken**
- OpenZeppelin `ERC20` + `AccessControl`
- Only addresses with `MINTER_ROLE` can mint
- Deployer gets `DEFAULT_ADMIN_ROLE`

**Crowdfunding**
- Stores campaigns on-chain with `titleHash` (not the full title string)
- Accepts ETH contributions until deadline
- Mints reward tokens via `RewardToken.mint()` on contribution
- Finalization sets flags:
  - bit0 = finalized
  - bit1 = successful

### Frontend <-> Blockchain
- Frontend uses MetaMask (`window.ethereum`) and `ethers.BrowserProvider`
- On connect, creates contract instances:
  - `Crowdfunding` at `CROWDFUNDING_ADDRESS`
  - `RewardToken` at `TOKEN_ADDRESS`
- Reads campaigns via `campaignCount()` and `campaigns(i)`
- Reads native ETH balance via `provider.getBalance(address)`
- Reads token balance via `token.balanceOf(account)`
- Sends transactions:
  - `createCampaign(title, goalWei, durationSeconds)`
  - `contribute(id, { value })`
  - `finalize(id)`
  - `withdraw(id)` (only creator + successful campaign)

---

## Design / Implementation Notes (important)

### Title storage (on-chain vs off-chain)
The contract stores only:
- `titleHash = keccak256(abi.encode(title))`

The frontend keeps a local mapping:
- `localStorage["campaignTitles"][titleHash] = title`

Reason: storing full strings on-chain increases deployment + storage costs.
Event `CampaignCreated` still includes the `title` string, but persistent campaign data uses `titleHash`.

> Limitation: campaign titles are only visible on the same browser/profile unless you add a backend or indexer.

---

## Smart Contract API Summary

### Crowdfunding.sol
- `createCampaign(string title, uint128 goalWei, uint64 durationSeconds) returns (uint256 id)`
- `contribute(uint256 id) payable`
- `finalize(uint256 id)`
- `withdraw(uint256 id)` — only creator, only successful + finalized
- `refund(uint256 id)` — only contributors, only failed + finalized
- `campaignCount() view returns (uint256)`
- Public storage:
  - `campaigns(uint256)` returns campaign struct fields
  - `contributions(id, addr)` returns contributed wei

### RewardToken.sol
- `mint(address to, uint256 amount)` — only `MINTER_ROLE`
- Standard ERC-20 reads:
  - `balanceOf(address)`

---

## Setup

### Requirements
- Node.js (LTS recommended)
- MetaMask browser extension
- Testnet ETH (Sepolia) if deploying to Sepolia

---

## Install

From repo root:

```bash
npm install
```

Frontend:

```bash
cd frontend
npm install
```

---

## Environment Variables (Sepolia deploy)

Create `.env` at repo root based on `.env.example`:

```
SEPOLIA_RPC_URL=YOUR_RPC_URL
PRIVATE_KEY=YOUR_WALLET_PRIVATE_KEY
```

**Never commit `.env`.**

---

## Compile + Test

```bash
npx hardhat compile
npx hardhat test
```

---

## Deploy

### Local Hardhat

Start a local chain in one terminal:

```bash
npx hardhat node
```

Deploy in another terminal:

```bash
npx hardhat run scripts/deploy.js --network localhost
```

### Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The script prints:

* RewardToken address
* Crowdfunding address
* Confirms `MINTER_ROLE` granted to Crowdfunding

---

## Run Frontend

1. Put deployed addresses into `frontend/src/App.jsx`:

```js
const CROWDFUNDING_ADDRESS = "REPLACE_ON_DEPLOY"
const TOKEN_ADDRESS = "REPLACE_ON_DEPLOY"
```

2. Start the UI:

```bash
cd frontend
npm run dev
```

Open the shown local URL.

---

## MetaMask Usage

* Install MetaMask
* Select the correct network:
  * Localhost 8545 (for hardhat node) **or**
  * Sepolia (for testnet deploy)
* Click **Connect MetaMask**
* Create campaign / contribute / finalize
* Reward token balance is shown in the header
* The UI displays:
  * Connected wallet address
  * Test ETH balance
  * Reward token balance

---

## Getting Test ETH (Sepolia)

Use any Sepolia faucet and request funds to your MetaMask address.
You only need test ETH (no real ETH).

---

## Github Repo

- [https://github.com/Fipaan/bt-cf-final.git](https://github.com/Fipaan/bt-cf-final.git)
