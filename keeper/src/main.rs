//! Mulligan keeper and CLI.
//!
//!   mulligan prices              HyperCore oracle/mark for every listed market
//!   mulligan status              house NAV, reserves, and every open position
//!   mulligan watch               liquidate any position at 90% margin loss
//!   mulligan faucet <usd>        testnet only: mint test USDC
//!   mulligan deposit <usd>       provide liquidity, receive MULL
//!   mulligan open <market> <long|short> <margin usd> <leverage>
//!   mulligan close <id>
//!
//! Env: RPC_URL (default HyperEVM mainnet), MULLIGAN (contract address),
//! PRIVATE_KEY (only for commands that send transactions).

use alloy::{
    network::EthereumWallet,
    primitives::{Address, I256, U256},
    providers::{DynProvider, Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
};
use eyre::{bail, eyre, Result};
use std::{env, time::Duration};

sol! {
    #[sol(rpc)]
    interface IMulligan {
        function usdc() external view returns (address);
        function nav() external view returns (uint256);
        function houseAssets() external view returns (uint256);
        function reserved() external view returns (uint256);
        function totalSupply() external view returns (uint256);
        function nextId() external view returns (uint256);
        function prices(uint32 market) external view returns (uint256 oracle, uint256 mark);
        function markets(uint32 id) external view returns (bool listed, uint8 szDecimals, uint16 maxLeverage);
        function positions(uint256 id) external view returns (
            address trader, uint32 market, bool isLong, bool open,
            uint64 entryPx, uint64 openedAt, uint128 margin, uint128 notional, uint128 maxProfit);
        function preview(uint256 id) external view returns (int256 pnl, uint256 exitPx, bool liquidatable, bool earnsRebate);
        function deposit(uint256 amount) external returns (uint256);
        function open(uint32 market, bool isLong, uint256 margin, uint256 leverage) external returns (uint256);
        function close(uint256 id) external;
        function liquidate(uint256 id) external;
    }

    #[sol(rpc)]
    interface IERC20 {
        function approve(address spender, uint256 amount) external returns (bool);
        function allowance(address owner, address spender) external view returns (uint256);
        function balanceOf(address who) external view returns (uint256);
        function faucet(uint256 amount) external;
    }
}

const DEFAULT_RPC: &str = "https://rpc.hyperliquid.xyz/evm";

/// Market names by HyperCore perp index, per network (chain id 998 testnet, 999 mainnet).
fn markets(chain: u64) -> Vec<(&'static str, u32)> {
    if chain == 998 {
        vec![("BTC", 3), ("ETH", 4), ("SOL", 0), ("HYPE", 135)]
    } else {
        vec![("BTC", 0), ("ETH", 1), ("SOL", 5), ("HYPE", 159)]
    }
}

fn usd(v: U256) -> String {
    let cents = v / U256::from(10_000u64);
    format!("${}.{:02}", cents / U256::from(100u64), cents % U256::from(100u64))
}

fn usd_signed(v: I256) -> String {
    if v.is_negative() {
        format!("-{}", usd(v.unsigned_abs()))
    } else {
        format!("+{}", usd(v.unsigned_abs()))
    }
}

fn to_units(dollars: &str) -> Result<U256> {
    let v: f64 = dollars.parse()?;
    Ok(U256::from((v * 1e6).round() as u128))
}

struct Ctx {
    provider: DynProvider,
    house: Address,
    chain: u64,
    me: Option<Address>,
}

async fn connect() -> Result<Ctx> {
    let rpc = env::var("RPC_URL").unwrap_or_else(|_| DEFAULT_RPC.into());
    let house: Address = env::var("MULLIGAN")
        .map_err(|_| eyre!("set MULLIGAN to the contract address"))?
        .parse()?;
    let (provider, me) = match env::var("PRIVATE_KEY") {
        Ok(pk) => {
            let signer: PrivateKeySigner = pk.parse()?;
            let me = signer.address();
            let p = ProviderBuilder::new()
                .wallet(EthereumWallet::from(signer))
                .connect(&rpc)
                .await?;
            (p.erased(), Some(me))
        }
        Err(_) => (ProviderBuilder::new().connect(&rpc).await?.erased(), None),
    };
    let chain = provider.get_chain_id().await?;
    Ok(Ctx { provider, house, chain, me })
}

impl Ctx {
    fn house(&self) -> IMulligan::IMulliganInstance<DynProvider> {
        IMulligan::new(self.house, self.provider.clone())
    }

    async fn usdc(&self) -> Result<IERC20::IERC20Instance<DynProvider>> {
        let addr = self.house().usdc().call().await?;
        Ok(IERC20::new(addr, self.provider.clone()))
    }

    fn signer(&self) -> Result<Address> {
        self.me.ok_or_else(|| eyre!("set PRIVATE_KEY for this command"))
    }

    async fn ensure_allowance(&self, amount: U256) -> Result<()> {
        let me = self.signer()?;
        let usdc = self.usdc().await?;
        if usdc.allowance(me, self.house).call().await? < amount {
            let r = usdc.approve(self.house, U256::MAX).send().await?.get_receipt().await?;
            println!("approved USDC: {}", r.transaction_hash);
        }
        Ok(())
    }

    fn market_id(&self, name: &str) -> Result<u32> {
        markets(self.chain)
            .into_iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, id)| id)
            .ok_or_else(|| eyre!("unknown market {name}"))
    }

    fn market_name(&self, id: u32) -> String {
        markets(self.chain)
            .into_iter()
            .find(|(_, i)| *i == id)
            .map(|(n, _)| n.to_string())
            .unwrap_or_else(|| format!("#{id}"))
    }
}

async fn prices(c: &Ctx) -> Result<()> {
    for (name, id) in markets(c.chain) {
        let r = c.house().prices(id).call().await?;
        println!("{name:<5} oracle {:>14}  mark {:>14}", usd(r.oracle), usd(r.mark));
    }
    Ok(())
}

async fn open_ids(c: &Ctx) -> Result<Vec<U256>> {
    let n = c.house().nextId().call().await?;
    let mut ids = Vec::new();
    let mut i = U256::ZERO;
    while i < n {
        if c.house().positions(i).call().await?.open {
            ids.push(i);
        }
        i += U256::from(1);
    }
    Ok(ids)
}

async fn status(c: &Ctx) -> Result<()> {
    let h = c.house();
    let (assets, reserved) = (h.houseAssets().call().await?, h.reserved().call().await?);
    println!("house   {}  (chain {})", c.house, c.chain);
    println!("assets  {}   reserved for winners {}   free {}", usd(assets), usd(reserved), usd(assets - reserved));
    println!("MULL    supply {}   NAV {}", usd(h.totalSupply().call().await?), usd(h.nav().call().await?));
    for id in open_ids(c).await? {
        let p = h.positions(id).call().await?;
        let v = h.preview(id).call().await?;
        println!(
            "#{id:<4} {} {:<5} {}x  margin {}  entry {}  now {}  pnl {}{}{}",
            if p.isLong { "LONG " } else { "SHORT" },
            c.market_name(p.market),
            U256::from(p.notional) / U256::from(p.margin),
            usd(U256::from(p.margin)),
            usd(U256::from(p.entryPx)),
            usd(v.exitPx),
            usd_signed(v.pnl),
            if v.liquidatable { "  LIQUIDATABLE" } else { "" },
            if v.earnsRebate { "  (mulligan-eligible)" } else { "" },
        );
    }
    Ok(())
}

/// Poll every open position; liquidate any at 90% margin loss. The liquidator
/// keeps what is left of the margin, so this pays for its own gas.
async fn watch(c: &Ctx) -> Result<()> {
    c.signer()?;
    println!("watching {} on chain {}", c.house, c.chain);
    loop {
        match open_ids(c).await {
            Ok(ids) => {
                for id in ids {
                    let v = match c.house().preview(id).call().await {
                        Ok(v) => v,
                        Err(e) => {
                            eprintln!("preview #{id}: {e}");
                            continue;
                        }
                    };
                    if v.liquidatable {
                        match c.house().liquidate(id).send().await {
                            Ok(tx) => match tx.get_receipt().await {
                                Ok(r) => println!("liquidated #{id} at {} pnl {}: {}", usd(v.exitPx), usd_signed(v.pnl), r.transaction_hash),
                                Err(e) => eprintln!("liquidate #{id} receipt: {e}"),
                            },
                            Err(e) => eprintln!("liquidate #{id}: {e}"),
                        }
                    }
                }
            }
            Err(e) => eprintln!("scan: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or_else(|| eyre!("missing argument {i}"));
    let c = connect().await?;
    match arg(0).unwrap_or("status") {
        "prices" => prices(&c).await?,
        "status" => status(&c).await?,
        "watch" => watch(&c).await?,
        "faucet" => {
            let r = c.usdc().await?.faucet(to_units(arg(1)?)?).send().await?.get_receipt().await?;
            println!("minted test USDC: {}", r.transaction_hash);
        }
        "deposit" => {
            let amount = to_units(arg(1)?)?;
            c.ensure_allowance(amount).await?;
            let r = c.house().deposit(amount).send().await?.get_receipt().await?;
            println!("deposited {}: {}", usd(amount), r.transaction_hash);
        }
        "open" => {
            let market = c.market_id(arg(1)?)?;
            let is_long = match arg(2)? {
                "long" => true,
                "short" => false,
                s => bail!("side must be long or short, got {s}"),
            };
            let margin = to_units(arg(3)?)?;
            let lev = U256::from(arg(4)?.parse::<u64>()?);
            c.ensure_allowance(margin * U256::from(2)).await?;
            let r = c.house().open(market, is_long, margin, lev).send().await?.get_receipt().await?;
            println!("opened: {}", r.transaction_hash);
        }
        "close" => {
            let id = U256::from(arg(1)?.parse::<u64>()?);
            let r = c.house().close(id).send().await?.get_receipt().await?;
            println!("closed #{id}: {}", r.transaction_hash);
        }
        other => bail!("unknown command {other}"),
    }
    Ok(())
}
