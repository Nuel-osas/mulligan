# Mulligan

**Perps where a loss buys you a piece of the house.**

Mulligan is a perpetuals venue on HyperEVM. Prices come directly from HyperCore's oracle and mark precompiles. Traders trade against a shared house, and the house is the MULL token itself.

- **Losers get a mulligan.** Hold a position for at least 10 minutes and close at a loss, and 50% of that loss comes back to you as MULL at NAV. That makes you a part-owner of the house that took your money.
- **Winners are always paid.** Each position's maximum profit (9× margin) is reserved when it opens, and LPs can only withdraw unreserved assets. There is no payout queue, ever.
- **Nobody can change it.** There is no owner, no upgrade path and no admin key. Every parameter is a constant.

Built for Colosseum's Crypto World's Fair, Hyperliquid track.

## Why

Loss-mining perps (papertrade on HyperEVM, launched October 2026) pay losers in a token the protocol prints. That design has four problems:

| | Typical loss-mining perps | Mulligan |
|---|---|---|
| Losers get | 100 PAPER per $1 lost, minted with nothing behind it | 50% of the loss as MULL, a claim on real house assets at NAV |
| Hedge farmers | Lose here and win a hedge elsewhere, so they mint for free | They can still farm, but the house keeps at least half of every loss plus all fees (fuzz-tested) |
| Winners | Paid from the pool, or wait in a queue | Max profit is reserved at open, so every winner is paid in full immediately |
| Control | Upgradeable contracts; the owner "can do anything" | No owner, no upgrades, all parameters immutable |
| Prices | External feed | HyperCore precompiles `0x807` (oracle) and `0x806` (mark); the trader gets the worse of the two on entry and exit |

**What we don't claim:** a perfectly hedged farmer *can* profit, netting up to 50% of the loss minus fees. What Mulligan guarantees is that the rebate is paid out of a loss the house has already booked. Value is never printed. `testHedgeFarmingAlwaysLeavesTheHouseAhead` fuzzes this claim.

## How it works

```
LP ──USDC──▶ deposit ──▶ MULL at NAV
Trader ──margin + 0.1% fee──▶ open(market, side, margin, leverage)
                 │  entry = worse of HyperCore oracle / mark
                 │  reserve 9 × margin from free house assets (or revert HouseTooSmall)
close / liquidate (anyone, at 90% margin loss; the liquidator keeps the remainder)
   win  ─▶ margin + pnl − fee, paid immediately from the house
   loss ─▶ house books loss + fee; if held ≥ 10 min, mint MULL worth 50% of the loss
```

| Parameter | Value |
|---|---|
| Fee | 0.10% of notional, on open and on close |
| Mulligan | 50% of a realized loss, held at least 10 minutes |
| Max profit | 9× margin, reserved at open |
| Liquidation | 90% of margin lost |
| Markets | BTC, ETH, SOL, HYPE (HyperCore perp indices, per network) |

## Repo

| Path | What |
|---|---|
| `src/Mulligan.sol` | The venue (house, trading, rebates). About 250 lines, no owner. |
| `src/TestUSDC.sol` | Testnet USDC with a faucet |
| `test/Mulligan.t.sol` | 13 Foundry tests, including fuzz tests for solvency and hedge farming. HyperCore precompiles are mocked at their real addresses with `vm.etch`. |
| `script/Deploy.s.sol` | Deploys with the correct perp indices for testnet (`MARKETS=testnet`) or mainnet |
| `keeper/` | **Rust** (alloy) liquidation keeper and CLI: `prices`, `status`, `watch`, `faucet`, `deposit`, `open`, `close` |
| `app/` | Vite + React + viem trading app |

## Run it

```bash
forge test                                   # 13 tests
cd keeper && cargo build --release && cd ..  # Rust keeper + CLI

./deploy-mainnet.sh                          # HyperEVM mainnet; key typed into a hidden prompt
                                             # writes the address into app/.env.local

export MULLIGAN=<address>                    # RPC defaults to https://rpc.hyperliquid.xyz/evm
./keeper/target/release/mulligan prices      # live HyperCore prices through the contract
./keeper/target/release/mulligan status      # house + every open position
PRIVATE_KEY=... ./keeper/target/release/mulligan watch   # liquidation keeper

cd app && pnpm install && pnpm dev           # http://localhost:5174
```

Before the contract is deployed, the app runs read-only on HyperEVM mainnet and reads HyperCore prices directly from the precompiles. Testnet: `VITE_CHAIN_ID=998`, `MARKETS=testnet` for the deploy script. For local development with mocked precompiles, see `README-local.md`.

## Limits

- Max profit is capped at 9× margin. That cap is what makes "always paid" true, so very large moves are clipped.
- No funding rate yet. The house carries the directional skew, bounded by the reserve rule.
- HyperCore precompile reads reflect the latest L1 state at the EVM block. Opens and closes use the worse of oracle and mark to blunt latency games.
- Unaudited hackathon code.

## License

MIT
