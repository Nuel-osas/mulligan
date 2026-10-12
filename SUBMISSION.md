SUBMISSION KIT: Mulligan (Colosseum Crypto World's Fair)

Deadline: 11:59pm PT Mon 12 Oct 2026 = 07:59 Lagos Tue 13 Oct. Target: submit by 06:00 Lagos.
Track: Hyperliquid (integrates HyperCore precompiles + HyperEVM).
Categories to tick: Markets & Exchanges, DeFi, Token Launch/Tokenomics.


FORM ANSWERS (paste as-is, no markdown)

Name
Mulligan

One-liner
Perps where a loss buys you a piece of the house.

Description
Mulligan is a perpetuals venue on HyperEVM priced directly from HyperCore's oracle and mark precompiles. Traders trade against a shared house, and the house is the MULL token. When you close a losing position you held for 10 minutes, half your loss comes back as MULL at NAV, so you own part of the house that took your money. Loss-mining venues like papertrade print an unbacked token per dollar lost, let hedge farmers mint it for free, make winners wait in a payout queue, and run on upgradeable contracts. Mulligan fixes all four. Rebates are paid out of a loss the house already booked. Every position's max profit is reserved at open, so winners are paid instantly. There is no owner and no upgrade path. 13 Foundry tests, including fuzz tests showing the house stays solvent and always keeps at least half of every loss. A Rust keeper liquidates automatically.

How it uses Hyperliquid
Every price comes from HyperCore read precompiles 0x807 (oracle) and 0x806 (mark), called from the contract on HyperEVM, with no external oracle. The trader gets the worse of oracle and mark on entry and exit, to blunt latency arbitrage. Markets are HyperCore perps (BTC, ETH, SOL, HYPE) by their native indices.

Business model
The house earns 0.10% of notional on every open and close, plus the half of every trading loss that is not rebated. MULL holders own that cash flow. A protocol fee switch can be added at deployment of a v2. v1 has no owner by design.

Links
Repo: <github url>
Live app: <url>
Contract (HyperEVM): <address> on <chain>
Demo video: <url>
Pitch video: <url>


PITCH VIDEO SCRIPT (under 3:00)

0:00  [Face to camera]
I'm [name], building from Lagos. Last week a perps venue on HyperEVM started paying traders for losing.
For every dollar you lose, you get a hundred tokens. People loved it.
0:20  Then they gamed it. Go long there, short the same on Hyperliquid, and mint tokens for free.
The tokens have nothing behind them. Winners wait in a queue to get paid. And the owner can upgrade the contracts and "do anything".
0:45  [Screen: Why it's fair table]
Mulligan keeps the good idea, a second chance for losers, and fixes the rest.
Lose after holding ten minutes, and half your loss comes back as MULL. MULL isn't printed. It is the house: the pool that took your loss.
1:10  Farmers? They can still farm, but every rebate comes out of a loss the house already booked. The house always keeps at least half, plus fees. That's a fuzz test, not a promise.
1:30  Winners? Every position reserves its maximum profit the moment it opens. LPs can't withdraw it. So every winner is paid in full, instantly. No queue.
1:50  Prices come straight from HyperCore precompiles, no outside oracle. No owner, no upgrade key.
2:10  [Screen: trade page, Mulligans paid feed]
Here's a twenty-times ETH long getting liquidated by our Rust keeper, and the trader getting fifty dollars of the house back on a hundred dollar loss.
2:30  Who is it for? Traders who want a venue that can't rug them or stiff their winners. LPs who want fee and loss income they can actually withdraw.
2:45  Mulligan. Lose a trade, keep a piece of the house.


DEMO VIDEO SCRIPT (2:00 to 3:00)

1. Terminal: forge test (13 passing; point at testHedgeFarmingAlwaysLeavesTheHouseAhead and testSolvency fuzz runs).
2. Terminal: mulligan prices (live HyperCore prices read through the contract).
3. App, The house: deposit 500 USDC, MULL minted at NAV.
4. App, Trade: open ETH long 50 USDC at 20x. Show entry = worse of oracle/mark, reserved max profit, liquidation price, mulligan countdown.
5. Open a BTC short; show both in "Your positions".
6. Price moves (local: set price; testnet: wait). Rust keeper terminal liquidates the long.
7. "Mulligans paid" shows -$100 -> +$50 MULL. The house page shows NAV up.
8. Close the winning short: paid instantly, reserved drops.
9. Why it's fair page: comparison table. End on the contract: no owner functions.


CHECKLIST
[ ] Contract deployed on HyperEVM (testnet 998 or mainnet 999), address in README
[ ] App deployed (Vercel / Netlify) pointing at the contract
[ ] Repo public on GitHub, MIT license
[ ] Pitch video under 3:00, demo video 2-3:00, uploaded natively
[ ] Hyperliquid track ticked on colosseum.com project form
[ ] Submitted before 06:00 Lagos
