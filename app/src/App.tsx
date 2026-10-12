import { useCallback, useEffect, useState } from "react";
import type { Address, WalletClient } from "viem";
import { mulliganAbi, usdcAbi } from "./abi";
import { HOUSE, MARKETS, chain, connectWallet, explorerTx, marketName, publicClient, usd } from "./chain";

const MIN_HOLD = 600;
const FEE_BPS = 10n;

type Route = "trade" | "house" | "why";
type Pos = {
  id: bigint;
  trader: Address;
  market: number;
  isLong: boolean;
  open: boolean;
  entryPx: bigint;
  openedAt: bigint;
  margin: bigint;
  notional: bigint;
  maxProfit: bigint;
  pnl?: bigint;
  exitPx?: bigint;
  liquidatable?: boolean;
};

const read = (functionName: any, args: any[] = []) =>
  publicClient.readContract({ address: HOUSE, abi: mulliganAbi, functionName, args } as any) as Promise<any>;

function useRoute(): Route {
  const get = () => (location.hash.replace(/^#\/?/, "") || "trade") as Route;
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Everything the UI shows, polled from HyperEVM every 3 seconds. */
function useChain(account?: Address) {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const [prices, houseAssets, reserved, supply, nav, nextId, usdcAddr, block] = await Promise.all([
        Promise.all(MARKETS.map((m) => read("prices", [m.id]))),
        read("houseAssets"),
        read("reserved"),
        read("totalSupply"),
        read("nav"),
        read("nextId"),
        read("usdc"),
        publicClient.getBlock(),
      ]);
      const ids = Array.from({ length: Number(nextId) }, (_, i) => BigInt(i));
      const positions: Pos[] = await Promise.all(
        ids.map(async (id) => {
          const p = await read("positions", [id]);
          const pos: Pos = {
            id,
            trader: p[0],
            market: p[1],
            isLong: p[2],
            open: p[3],
            entryPx: p[4],
            openedAt: p[5],
            margin: p[6],
            notional: p[7],
            maxProfit: p[8],
          };
          if (pos.open) {
            const v = await read("preview", [id]);
            Object.assign(pos, { pnl: v[0], exitPx: v[1], liquidatable: v[2] });
          }
          return pos;
        })
      );
      const logs = await publicClient.getContractEvents({
        address: HOUSE,
        abi: mulliganAbi,
        eventName: "Mulligan",
        fromBlock: block.number > 5000n ? block.number - 5000n : 0n,
      });
      let mine = { usdc: 0n, mull: 0n };
      if (account) {
        const [u, m] = await Promise.all([
          publicClient.readContract({ address: usdcAddr, abi: usdcAbi, functionName: "balanceOf", args: [account] }),
          read("balanceOf", [account]),
        ]);
        mine = { usdc: u as bigint, mull: m };
      }
      setS({
        prices: MARKETS.map((m, i) => ({ ...m, oracle: prices[i][0] as bigint, mark: prices[i][1] as bigint })),
        houseAssets,
        reserved,
        supply,
        nav,
        usdc: usdcAddr as Address,
        positions,
        mulligans: logs.map((l: any) => l.args).reverse(),
        mine,
        chainTime: Number(block.timestamp),
      });
      setErr("");
    } catch (e: any) {
      setErr(e.shortMessage ?? e.message);
    }
  }, [account]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  return { s, err, reload: load };
}

export function App() {
  const route = useRoute();
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const account = wallet?.account?.address;
  const { s, err, reload } = useChain(account);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState("");

  const send = async (label: string, address: Address, abi: any, functionName: string, args: any[]) => {
    if (!wallet) return setMsg({ ok: false, text: "Connect a wallet first." });
    setBusy(label);
    setMsg(null);
    try {
      const hash = await wallet.writeContract({ address, abi, functionName, args, chain, account: wallet.account! } as any);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("transaction reverted");
      setMsg({ ok: true, text: `${label}: confirmed`, hash });
      await reload();
    } catch (e: any) {
      setMsg({ ok: false, text: `${label}: ${e.shortMessage ?? e.message}` });
    }
    setBusy("");
  };

  const approveIfNeeded = async (amount: bigint) => {
    const allowance = (await publicClient.readContract({
      address: s.usdc,
      abi: usdcAbi,
      functionName: "allowance",
      args: [account!, HOUSE],
    })) as bigint;
    if (allowance < amount) await send("Approve USDC", s.usdc, usdcAbi, "approve", [HOUSE, 2n ** 255n]);
  };

  const ctx = { s, wallet, account, send, busy, approveIfNeeded };
  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <Mark />
          mulligan
        </a>
        <nav>
          {(
            [
              ["trade", "Trade"],
              ["house", "The house"],
              ["why", "Why it's fair"],
            ] as [Route, string][]
          ).map(([r, l]) => (
            <a key={r} href={`#/${r}`} className={route === r ? "on" : ""}>
              {l}
            </a>
          ))}
          {account ? (
            <a className="on" href="#/trade">{`${account.slice(0, 6)}…${account.slice(-4)}`}</a>
          ) : (
            <a
              className="cta"
              href="#/trade"
              onClick={(e) => {
                e.preventDefault();
                connectWallet().then(setWallet, (er) => setMsg({ ok: false, text: er.message }));
              }}
            >
              <span>Connect wallet</span>
            </a>
          )}
        </nav>
      </header>
      <main>
        {err && <p className="msg bad">{err}</p>}
        {msg && (
          <p className={`msg ${msg.ok ? "ok" : "bad"}`}>
            {msg.text}{" "}
            {msg.hash && explorerTx(msg.hash) && (
              <a href={explorerTx(msg.hash)} target="_blank">
                view tx
              </a>
            )}
          </p>
        )}
        {!s ? (
          <p className="muted">Reading HyperEVM…</p>
        ) : route === "house" ? (
          <House {...ctx} />
        ) : route === "why" ? (
          <Why />
        ) : (
          <Trade {...ctx} />
        )}
        <footer className="built">
          <span>
            Priced by <b>HyperCore</b> · settled on <b>HyperEVM</b>
          </span>
          <span>No owner · no upgrades · every winner paid at once</span>
        </footer>
      </main>
    </>
  );
}

function Mark() {
  // A flag on a green: a do-over.
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="2" width="2.5" height="20" fill="currentColor" />
      <path d="M6.5 3h13l-3.5 4 3.5 4h-13z" fill="#087dff" />
    </svg>
  );
}

function Btn({ children, go, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { go?: boolean }) {
  return (
    <button {...rest} className={`${rest.className ?? ""} ${go ? "go" : ""}`}>
      <span>{children}</span>
    </button>
  );
}

function Stat({ l, n }: { l: string; n: React.ReactNode }) {
  return (
    <div className="card stat">
      <div className="tag">{l}</div>
      <div className="n">{n}</div>
    </div>
  );
}

function Trade({ s, account, send, busy, approveIfNeeded }: any) {
  const now = useNow();
  const [market, setMarket] = useState(MARKETS[0].id);
  const [isLong, setIsLong] = useState(true);
  const [margin, setMargin] = useState("50");
  const [lev, setLev] = useState(10);
  const p = s.prices.find((x: any) => x.id === market);
  const m = BigInt(Math.round(Number(margin || 0) * 1e6));
  const notional = m * BigInt(lev);
  const fee = (notional * FEE_BPS) / 10_000n;
  const entry = isLong ? (p.oracle > p.mark ? p.oracle : p.mark) : p.oracle < p.mark ? p.oracle : p.mark;
  const liqMove = 0.9 / lev;
  const liqPx = Number(entry) / 1e6 * (isLong ? 1 - liqMove : 1 + liqMove);
  const free = (s.houseAssets as bigint) - (s.reserved as bigint);
  const mine = (s.positions as Pos[]).filter((x) => account && x.trader.toLowerCase() === account.toLowerCase());
  const openAll = (s.positions as Pos[]).filter((x) => x.open);
  const shift = s.chainTime - now; // chain clock vs wall clock (local demo chains drift)

  const submit = async () => {
    await approveIfNeeded(m + fee);
    await send(`Open ${isLong ? "long" : "short"} ${marketName(market)}`, HOUSE, mulliganAbi, "open", [
      market,
      isLong,
      m,
      BigInt(lev),
    ]);
  };

  return (
    <div className="stack">
      <section className="hero" style={{ marginBottom: 24 }}>
        <div>
          <h1>Lose a trade. Keep a piece of the house.</h1>
          <p className="lede">
            <strong>Perps priced straight from HyperCore.</strong> When you lose, half your loss comes back as MULL,
            a share of the house that took it. Winners are paid in full, at once, every time.
          </p>
          <div className="grid">
            <Stat l="House NAV / MULL" n={usd(s.nav, 4)} />
            <Stat l="Free to pay winners" n={usd(free)} />
          </div>
        </div>
        <div className="card">
          <h2>New position</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            {s.prices.map((x: any) => (
              <button key={x.id} className={x.id === market ? "" : "ghost"} onClick={() => setMarket(x.id)}>
                <span>
                  {x.name} {usd(x.mark, x.mark < 10_000_000n ? 4 : 2)}
                </span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className={isLong ? "" : "ghost"} onClick={() => setIsLong(true)}>
              <span>▲ Long</span>
            </button>
            <button className={!isLong ? "danger" : "ghost"} onClick={() => setIsLong(false)}>
              <span>▼ Short</span>
            </button>
          </div>
          <div className="row">
            <label>
              Margin (USDC)
              <input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              Leverage {lev}×
              <input type="range" min={1} max={p.name === "BTC" ? 40 : p.name === "ETH" ? 25 : 10} value={lev} onChange={(e) => setLev(Number(e.target.value))} />
            </label>
          </div>
          <table style={{ margin: "14px 0" }}>
            <tbody>
              <tr><td className="muted">Size</td><td>{usd(notional)}</td></tr>
              <tr><td className="muted">Entry (worse of oracle {usd(p.oracle)} / mark {usd(p.mark)})</td><td>{usd(entry)}</td></tr>
              <tr><td className="muted">Fee 0.10% each way</td><td>{usd(fee)}</td></tr>
              <tr><td className="muted">Liquidation price</td><td>${liqPx.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td></tr>
              <tr><td className="muted">Max profit (reserved now)</td><td>{usd(m * 9n)}</td></tr>
              <tr><td className="muted">If you lose, after 10 min</td><td>50% back as MULL</td></tr>
            </tbody>
          </table>
          <Btn go disabled={!account || !!busy || m === 0n} onClick={submit}>
            {!account ? "Connect wallet to trade" : busy || `Open ${isLong ? "long" : "short"}`}
          </Btn>
          {account && (
            <p className="muted" style={{ fontSize: 13 }}>
              Wallet: {usd(s.mine.usdc)} USDC · {usd(s.mine.mull)} MULL{" "}
              {s.mine.usdc < m + fee && (
                <a href="#" onClick={(e) => { e.preventDefault(); send("Faucet", s.usdc, usdcAbi, "faucet", [1_000_000_000n]); }}>
                  get 1,000 test USDC
                </a>
              )}
            </p>
          )}
        </div>
      </section>

      <div className="card scroll">
        <h2>Your positions</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Market</th><th>Size</th><th>Entry</th><th>Now</th><th>PnL</th><th>Mulligan</th><th></th></tr>
          </thead>
          <tbody>
            {mine.filter((x) => x.open).map((x) => {
              const held = now + shift - Number(x.openedAt);
              const left = MIN_HOLD - held;
              return (
                <tr key={String(x.id)}>
                  <td>{String(x.id)}</td>
                  <td>
                    <span className={`pill ${x.isLong ? "ok" : "bad"}`}>{x.isLong ? "Long" : "Short"}</span> {marketName(x.market)}{" "}
                    {String(x.notional / x.margin)}×
                  </td>
                  <td>{usd(x.notional)}</td>
                  <td>{usd(x.entryPx)}</td>
                  <td>{usd(x.exitPx!)}</td>
                  <td style={{ color: x.pnl! >= 0n ? "var(--ok)" : "var(--bad)" }}>{usd(x.pnl!)}</td>
                  <td>
                    {left > 0 ? (
                      <span className="pill warn">in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
                    ) : (
                      <span className="pill ok">eligible</span>
                    )}
                  </td>
                  <td>
                    <Btn className="ghost" disabled={!!busy} onClick={() => send(`Close #${x.id}`, HOUSE, mulliganAbi, "close", [x.id])}>
                      Close
                    </Btn>
                  </td>
                </tr>
              );
            })}
            {!mine.some((x) => x.open) && <tr><td colSpan={8} className="muted">No open positions.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="card scroll">
          <h2>Mulligans paid</h2>
          <table>
            <thead><tr><th>Trader</th><th>Loss</th><th>Back as MULL</th></tr></thead>
            <tbody>
              {s.mulligans.slice(0, 8).map((e: any, i: number) => (
                <tr key={i}>
                  <td className="mono">{e.trader.slice(0, 6)}…{e.trader.slice(-4)}</td>
                  <td>{usd(-(e.loss as bigint))}</td>
                  <td style={{ color: "var(--ok)" }}>+{usd(e.rebateUsd)}</td>
                </tr>
              ))}
              {!s.mulligans.length && <tr><td colSpan={3} className="muted">None yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card scroll">
          <h2>All open positions</h2>
          <table>
            <thead><tr><th>#</th><th>Market</th><th>Size</th><th>PnL</th></tr></thead>
            <tbody>
              {openAll.slice(0, 8).map((x) => (
                <tr key={String(x.id)}>
                  <td>{String(x.id)}</td>
                  <td>{x.isLong ? "Long" : "Short"} {marketName(x.market)}</td>
                  <td>{usd(x.notional)}</td>
                  <td>
                    {usd(x.pnl!)} {x.liquidatable && <span className="pill bad">liquidatable</span>}
                  </td>
                </tr>
              ))}
              {!openAll.length && <tr><td colSpan={4} className="muted">None.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function House({ s, account, send, busy, approveIfNeeded }: any) {
  const [dep, setDep] = useState("500");
  const [wd, setWd] = useState("100");
  const free = (s.houseAssets as bigint) - (s.reserved as bigint);
  return (
    <div className="stack">
      <h1>The house</h1>
      <p className="lede">
        <strong>MULL is the house.</strong> It earns every fee and every trader loss, pays every winner, and is what
        losers get back. Assets reserved for open winners can never be withdrawn, so there is no payout queue.
      </p>
      <div className="grid">
        <Stat l="House assets" n={usd(s.houseAssets)} />
        <Stat l="Reserved for winners" n={usd(s.reserved)} />
        <Stat l="Free" n={usd(free)} />
        <Stat l="MULL supply" n={usd(s.supply).replace("$", "")} />
        <Stat l="NAV per MULL" n={usd(s.nav, 4)} />
      </div>
      <div className="card">
        <h2>Your stake</h2>
        <p>
          {account ? (
            <>
              {usd(s.mine.mull).replace("$", "")} MULL ≈ <b>{usd(((s.mine.mull as bigint) * (s.nav as bigint)) / 1_000_000n)}</b> · wallet {usd(s.mine.usdc)} USDC
            </>
          ) : (
            "Connect a wallet to provide liquidity."
          )}
        </p>
        <div className="row">
          <label>
            Deposit USDC
            <input value={dep} onChange={(e) => setDep(e.target.value)} />
          </label>
          <Btn
            go
            disabled={!account || !!busy}
            onClick={async () => {
              const a = BigInt(Math.round(Number(dep) * 1e6));
              await approveIfNeeded(a);
              await send("Deposit", HOUSE, mulliganAbi, "deposit", [a]);
            }}
          >
            Deposit
          </Btn>
          <label>
            Withdraw MULL
            <input value={wd} onChange={(e) => setWd(e.target.value)} />
          </label>
          <Btn
            className="ghost"
            disabled={!account || !!busy}
            onClick={() => send("Withdraw", HOUSE, mulliganAbi, "withdraw", [BigInt(Math.round(Number(wd) * 1e6))])}
          >
            Withdraw
          </Btn>
        </div>
      </div>
      <p className="muted mono">Contract {HOUSE} · chain {chain.id}</p>
    </div>
  );
}

function Why() {
  const rows = [
    ["Losers get", "100 PAPER per $1 lost, printed with nothing behind it", "50% of the loss back as MULL, a share of real house assets at NAV"],
    ["Hedge farmers", "Mint for free: lose here, win the hedge elsewhere", "Can farm, but the house keeps ≥ half of every loss plus all fees. Proven in a fuzz test."],
    ["Winners", "Paid from the pool, or wait in a queue", "Max profit reserved at open. Paid in full, instantly."],
    ["Who can change it", "Upgradeable contracts; the owner can do anything", "No owner, no upgrade path, every parameter immutable"],
    ["Prices", "External feed", "HyperCore oracle and mark precompiles, worse-of on entry and exit"],
    ["Quick flips", "Earn emissions", "No mulligan unless the position was held 10 minutes"],
  ];
  return (
    <div className="stack">
      <h1>Why it's fair</h1>
      <p className="lede">
        Loss-mining venues pay losers in a token the protocol prints. Value flows to whoever owns the protocol, and
        hedge farmers mint for free. Mulligan pays losers in the house itself.
      </p>
      <div className="card scroll">
        <table>
          <thead><tr><th></th><th>Typical loss-mining perps</th><th>Mulligan</th></tr></thead>
          <tbody>
            {rows.map(([k, a, b]) => (
              <tr key={k}>
                <td className="tag">{k}</td>
                <td className="muted">{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <blockquote>
        Lose $100 after holding 10 minutes: the house books $100, then mints you $50 of MULL. LPs keep the other $50
        plus both fees. A perfectly hedged farmer nets at most $50 minus fees, paid from a loss the house already won.
        <cite>Mulligan.sol · REBATE_BPS = 5000 · MIN_HOLD = 10 minutes · MAX_PROFIT_X = 9</cite>
      </blockquote>
    </div>
  );
}
