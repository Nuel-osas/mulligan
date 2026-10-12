import { useEffect, useState } from "react";
import type { Address } from "viem";
import { mulliganAbi, usdcAbi } from "./abi";
import { HOUSE, MARKETS, chain, explorerTx, marketName, usd } from "./chain";
import { aggregate, FEE_BPS, MIN_HOLD, type Pos, type Protocol } from "./data";
import { Btn, Spark, Split, Stat, ago, short, signed, tone } from "./ui";

export type Ctx = {
  s: Protocol;
  account?: Address;
  busy: string;
  connect: () => void;
  send: (label: string, address: Address, abi: any, fn: string, args: any[]) => Promise<void>;
  approveIfNeeded: (amount: bigint) => Promise<void>;
};

/** Hyperliquid 1-minute candles (closes) for the last 6 hours: the same HyperCore market the contract prices from. */
function useCandles(coin: string) {
  const [closes, setCloses] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1m", startTime: Date.now() - 6 * 3600_000 } }),
      })
        .then((r) => r.json())
        .then((c: { c: string }[]) => live && setCloses(c.map((x) => Number(x.c))))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [coin]);
  return closes;
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const px = (v: bigint) => usd(v, v < 10_000_000n ? 4 : 2);

// ================================================================ landing

export function Landing({ s }: { s: Protocol | null }) {
  const a = s && aggregate(s);
  return (
    <div className="stack">
      <section className="hero">
        <div>
          <h1>Lose a trade. Keep a piece of the house.</h1>
          <p className="lede">
            <strong>Perpetuals on HyperEVM, priced straight from HyperCore.</strong> Lose after holding ten minutes
            and half your loss comes back as MULL, a share of the house that took it. Every winner is paid in full,
            at once.
          </p>
          <div className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <a href="#/trade"><Btn go>Open the app</Btn></a>
            <a href="#/docs"><Btn className="ghost">How it works</Btn></a>
          </div>
        </div>
        <div className="flow" aria-label="How a trade settles">
          <div className="tag" style={{ textAlign: "center" }}>Example trade · ETH 20× long</div>
          <div className="tier">
            <div className="node"><div className="tag">Price · HyperCore</div><b>ETH $2,512.05</b><small>Oracle + mark precompiles</small></div>
            <div className="node lit"><div className="tag">House · MULL</div><b>{a ? usd(s!.houseAssets) : "$5,102.25"}</b><small>Reserves every winner up front</small></div>
          </div>
          <div className="tier">
            <div className="node"><div className="tag">Trader</div><b>Long $1,000</b><small>$50 margin · held 12 min</small></div>
            <div className="node hot"><div className="tag">Closed</div><b>−$100.00</b><small>Price moved 5% against</small></div>
          </div>
          <div className="note"><span className="chip">Loss booked by the house first</span></div>
          <div className="tier">
            <div className="node lit"><div className="tag">Mulligan</div><b>+$50.00 of MULL</b><small>Minted at NAV · transferable</small></div>
            <div className="node"><div className="tag">LPs</div><b>+$50.00 + fees</b><small>Always keep at least half</small></div>
          </div>
          <div className="note"><span className="chip white">No queue · no owner · no upgrades</span></div>
        </div>
      </section>

      <div className="grid">
        <Stat l="House assets" n={s ? usd(s.houseAssets) : "–"} />
        <Stat l="Volume" n={a ? usd(a.volume, 0) : "–"} />
        <Stat l="Mulligans paid" n={a ? usd(a.rebates) : "–"} />
        <Stat l="Traders" n={a ? a.traders : "–"} />
        <Stat l="NAV per MULL" n={s ? usd(s.nav, 4) : "–"} />
      </div>

      <section className="steps">
        <div className="card">
          <h3>Priced by HyperCore</h3>
          <p>The contract reads HyperCore's oracle and mark precompiles directly. You get the worse of the two on entry and exit, so latency games don't pay.</p>
        </div>
        <div className="card">
          <h3>Winners never wait</h3>
          <p>Each position's maximum profit (9× margin) is reserved the moment it opens. LPs can't withdraw it. No payout queue, ever.</p>
        </div>
        <div className="card">
          <h3>Losers get a mulligan</h3>
          <p>Close at a loss after ten minutes and 50% of it is minted back to you as MULL, priced after the house books your loss.</p>
        </div>
        <div className="card">
          <h3>Nobody holds the keys</h3>
          <p>No owner, no upgrade path, no admin function. Every parameter is a constant you can read in the contract.</p>
        </div>
      </section>

      <WhyTable />

      <div className="card">
        <h2>FAQ</h2>
        <dl className="faq">
          <dt>Can I farm it with a hedge on another venue?</dt>
          <dd>
            Yes, and we say so. A perfect hedge nets at most half your loss minus fees. But every rebate is paid out of
            a loss the house already booked, so the house always keeps at least half plus all fees. That's a fuzz test
            in the repo, not a promise.
          </dd>
          <dt>What is MULL worth?</dt>
          <dd>Exactly house assets divided by supply (NAV). Burn it any time for USDC, out of assets not reserved for open winners.</dd>
          <dt>Why is profit capped at 9×?</dt>
          <dd>Because the cap is what lets the house reserve every winner's payout in advance. Uncapped profit is how payout queues happen.</dd>
          <dt>Who can change the rules?</dt>
          <dd>No one. There is no owner and no proxy. A new version would be a new contract you choose to move to.</dd>
        </dl>
      </div>
    </div>
  );
}

export function WhyTable() {
  const rows = [
    ["Losers get", "100 PAPER per $1 lost, printed with nothing behind it", "50% of the loss back as MULL, a share of real house assets at NAV"],
    ["Hedge farmers", "Mint for free: lose here, win the hedge elsewhere", "Can farm, but the house keeps ≥ half of every loss plus all fees"],
    ["Winners", "Paid from the pool, or wait in a queue", "Max profit reserved at open. Paid in full, instantly"],
    ["Who can change it", "Upgradeable; the owner can do anything", "No owner, no upgrade path, immutable parameters"],
    ["Prices", "External feed", "HyperCore oracle + mark precompiles, worse-of"],
    ["Quick flips", "Earn emissions", "No mulligan unless held 10 minutes"],
  ];
  return (
    <div className="card scroll">
      <h2>Loss-mining, fixed</h2>
      <table>
        <thead><tr><th></th><th>Typical loss-mining perps</th><th>Mulligan</th></tr></thead>
        <tbody>
          {rows.map(([k, x, y]) => (
            <tr key={k}><td className="tag">{k}</td><td className="muted">{x}</td><td>{y}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ================================================================== trade

export function Trade({ s, account, send, busy, approveIfNeeded, connect }: Ctx) {
  const now = useNow();
  const [market, setMarket] = useState(MARKETS[0].id);
  const [isLong, setIsLong] = useState(true);
  const [margin, setMargin] = useState("50");
  const [lev, setLev] = useState(10);
  const p = s.prices.find((x) => x.id === market)!;
  const maxLev = p.name === "BTC" ? 40 : p.name === "ETH" ? 25 : p.name === "SOL" ? 20 : 10;
  const m = BigInt(Math.round(Number(margin || 0) * 1e6));
  const notional = m * BigInt(Math.min(lev, maxLev));
  const fee = (notional * FEE_BPS) / 10_000n;
  const entry = isLong ? (p.oracle > p.mark ? p.oracle : p.mark) : p.oracle < p.mark ? p.oracle : p.mark;
  const liqMove = 0.9 / Math.min(lev, maxLev);
  const liqPx = (Number(entry) / 1e6) * (isLong ? 1 - liqMove : 1 + liqMove);
  const free = s.houseAssets - s.reserved;
  const mine = s.positions.filter((x) => account && x.trader.toLowerCase() === account.toLowerCase());
  const shift = s.chainTime - now;
  const candles = useCandles(p.name);
  const series = [...candles, Number(p.mark) / 1e6];
  const first = candles[0];
  const change = first ? ((Number(p.mark) / 1e6 - first) / first) * 100 : 0;

  return (
    <div className="stack">
      <div className="tabs">
        {s.prices.map((x) => (
          <button key={x.id} className={x.id === market ? "" : "ghost"} onClick={() => setMarket(x.id)}>
            <span>
              {x.name}-USD <b className="mono">{px(x.mark)}</b>
            </span>
          </button>
        ))}
      </div>
      <section className="trade-grid">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div className="tag">{p.name}-USD perpetual · HyperCore index {p.id}</div>
              <div className="big">{px(p.mark)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="tag">Oracle</div>
              <div>{px(p.oracle)}</div>
              <div className="tag" style={{ marginTop: 6 }}>6h</div>
              <div style={{ color: change >= 0 ? "var(--ok)" : "var(--bad)" }}>{change.toFixed(3)}%</div>
            </div>
          </div>
          <Spark data={series} height={240} />
          <div className="grid" style={{ marginTop: 16 }}>
            <Stat l="Free to pay winners" n={usd(free, 0)} />
            <Stat l="Reserved" n={usd(s.reserved, 0)} />
            <Stat l="NAV / MULL" n={usd(s.nav, 4)} />
          </div>
        </div>

        <div className="card">
          <h2>New position</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className={isLong ? "" : "ghost"} style={{ flex: 1 }} onClick={() => setIsLong(true)}>
              <span style={{ width: "100%" }}>▲ Long</span>
            </button>
            <button className={!isLong ? "danger" : "ghost"} style={{ flex: 1 }} onClick={() => setIsLong(false)}>
              <span style={{ width: "100%" }}>▼ Short</span>
            </button>
          </div>
          <label>
            Margin (USDC)
            <input value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="decimal" />
          </label>
          <label style={{ marginTop: 12 }}>
            Leverage {Math.min(lev, maxLev)}× (max {maxLev}×)
            <input type="range" min={1} max={maxLev} value={Math.min(lev, maxLev)} onChange={(e) => setLev(Number(e.target.value))} />
          </label>
          <table style={{ margin: "14px 0" }}>
            <tbody>
              <tr><td className="muted">Size</td><td>{usd(notional)}</td></tr>
              <tr><td className="muted">Entry (worse of oracle/mark)</td><td>{px(entry)}</td></tr>
              <tr><td className="muted">Fee 0.10% each way</td><td>{usd(fee)}</td></tr>
              <tr><td className="muted">Liquidation price</td><td>${liqPx.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td></tr>
              <tr><td className="muted">Max profit, reserved now</td><td>{usd(m * 9n)}</td></tr>
              <tr><td className="muted">Mulligan if you lose (after 10 min)</td><td style={{ color: "var(--ok)" }}>50% back as MULL</td></tr>
            </tbody>
          </table>
          {account ? (
            <Btn
              go
              disabled={!!busy || m === 0n}
              onClick={async () => {
                await approveIfNeeded(m + fee);
                await send(`Open ${isLong ? "long" : "short"} ${p.name}`, HOUSE, mulliganAbi, "open", [market, isLong, m, BigInt(Math.min(lev, maxLev))]);
              }}
            >
              {busy || `Open ${isLong ? "long" : "short"}`}
            </Btn>
          ) : (
            <Btn go onClick={connect}>Connect wallet</Btn>
          )}
          {account && (
            <p className="muted" style={{ fontSize: 13 }}>
              {usd(s.mine.usdc)} USDC available ·{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); send("Faucet", s.usdc, usdcAbi, "faucet", [1_000_000_000n]); }}>
                get 1,000 test USDC
              </a>
            </p>
          )}
        </div>
      </section>

      <PositionsTable positions={mine} now={now} shift={shift} send={send} busy={busy} title="Your open positions" />
    </div>
  );
}

function PositionsTable({ positions, now, shift, send, busy, title }: { positions: Pos[]; now: number; shift: number; send?: Ctx["send"]; busy?: string; title: string }) {
  return (
    <div className="card scroll">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Market</th><th>Size</th><th>Entry</th><th>Mark</th><th>PnL</th><th>Mulligan</th>{send && <th></th>}</tr>
        </thead>
        <tbody>
          {positions.map((x) => {
            const left = MIN_HOLD - (now + shift - Number(x.openedAt));
            return (
              <tr key={String(x.id)}>
                <td>{String(x.id)}</td>
                <td>
                  <span className={`pill ${x.isLong ? "ok" : "bad"}`}>{x.isLong ? "Long" : "Short"}</span> {marketName(x.market)} {String(x.notional / x.margin)}×
                </td>
                <td>{usd(x.notional)}</td>
                <td>{px(x.entryPx)}</td>
                <td>{px(x.exitPx!)}</td>
                <td style={tone(x.pnl!)}>
                  {signed(x.pnl!)} {x.liquidatable && <span className="pill bad">liq</span>}
                </td>
                <td>
                  {left > 0 ? <span className="pill warn">in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span> : <span className="pill ok">eligible</span>}
                </td>
                {send && (
                  <td>
                    <Btn className="ghost" disabled={!!busy} onClick={() => send(`Close #${x.id}`, HOUSE, mulliganAbi, "close", [x.id])}>
                      Close
                    </Btn>
                  </td>
                )}
              </tr>
            );
          })}
          {!positions.length && <tr><td colSpan={8} className="muted">No open positions.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================== portfolio

export function Portfolio({ s, account, send, busy, connect }: Ctx) {
  const now = useNow();
  if (!account)
    return (
      <div className="stack">
        <h1>Portfolio</h1>
        <p className="lede">Connect a wallet to see your positions, history and mulligans.</p>
        <Btn go onClick={connect}>Connect wallet</Btn>
      </div>
    );
  const me = account.toLowerCase();
  const open = s.positions.filter((p) => p.trader.toLowerCase() === me);
  const hist = s.trades.filter((t) => t.trader.toLowerCase() === me && t.closedAt !== undefined);
  const unrealized = open.reduce((a, p) => a + (p.pnl ?? 0n), 0n);
  const realized = hist.reduce((a, t) => a + t.pnl!, 0n);
  const rebates = hist.reduce((a, t) => a + (t.rebate ?? 0n), 0n);
  const mullValue = (s.mine.mull * s.nav) / 1_000_000n;
  const margin = open.reduce((a, p) => a + p.margin, 0n);
  const equity = s.mine.usdc + mullValue + margin + unrealized;
  const wins = hist.filter((t) => t.pnl! > 0n).length;

  return (
    <div className="stack">
      <h1>Portfolio</h1>
      <p className="lede mono" style={{ fontSize: 13 }}>{account}</p>
      <div className="grid">
        <Stat l="Total equity" n={usd(equity)} sub="USDC + margin + open PnL + MULL" />
        <Stat l="Unrealized PnL" n={<span style={tone(unrealized)}>{signed(unrealized)}</span>} />
        <Stat l="Realized PnL" n={<span style={tone(realized)}>{signed(realized)}</span>} sub={`${wins} / ${hist.length} wins`} />
        <Stat l="Mulligans earned" n={<span style={{ color: "var(--ok)" }}>{usd(rebates)}</span>} sub="paid as MULL" />
        <Stat l="MULL held" n={usd(mullValue)} sub={`${usd(s.mine.mull).replace("$", "")} MULL`} />
      </div>
      <PositionsTable positions={open} now={now} shift={s.chainTime - now} send={send} busy={busy} title="Open positions" />
      <div className="card scroll">
        <h2>Trade history</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Market</th><th>Size</th><th>Entry → exit</th><th>PnL</th><th>Mulligan</th><th>Closed</th><th></th></tr>
          </thead>
          <tbody>
            {hist.map((t) => (
              <tr key={String(t.id)}>
                <td>{String(t.id)}</td>
                <td>
                  <span className={`pill ${t.isLong ? "ok" : "bad"}`}>{t.isLong ? "Long" : "Short"}</span> {marketName(t.market)}
                </td>
                <td>{usd(t.notional)}</td>
                <td>{px(t.entryPx)} → {px(t.exitPx!)}</td>
                <td style={tone(t.pnl!)}>
                  {signed(t.pnl!)} {t.liquidated && <span className="pill bad">liquidated</span>}
                </td>
                <td style={{ color: "var(--ok)" }}>{t.rebate ? `+${usd(t.rebate)}` : <span className="muted">–</span>}</td>
                <td className="muted">{ago(t.closedAt!, now)}</td>
                <td>{explorerTx(t.closeTx!) && <a href={explorerTx(t.closeTx!)} target="_blank">tx</a>}</td>
              </tr>
            ))}
            {!hist.length && <tr><td colSpan={8} className="muted">No closed trades yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================================================================== house

export function House({ s, account, send, busy, approveIfNeeded, connect }: Ctx) {
  const [dep, setDep] = useState("500");
  const [wd, setWd] = useState("100");
  const a = aggregate(s);
  const free = s.houseAssets - s.reserved;
  const mineValue = (s.mine.mull * s.nav) / 1_000_000n;
  const share = s.supply > 0n ? (Number(s.mine.mull) / Number(s.supply)) * 100 : 0;
  return (
    <div className="stack">
      <h1>The house</h1>
      <p className="lede">
        <strong>MULL is the house.</strong> It earns every fee and every trading loss, pays every winner, and is what
        losers get back. Assets reserved for open winners can never be withdrawn.
      </p>
      <div className="grid">
        <Stat l="House assets" n={usd(s.houseAssets)} />
        <Stat l="NAV per MULL" n={usd(s.nav, 4)} />
        <Stat l="MULL supply" n={usd(s.supply).replace("$", "")} />
        <Stat l="Fees earned" n={usd(a.fees)} />
      </div>
      <section className="trade-grid">
        <div className="card">
          <h2>NAV this session</h2>
          <Spark data={s.history.map((h) => h.nav)} height={200} />
          <h2 style={{ marginTop: 20 }}>Liquidity</h2>
          <Split a={s.reserved} b={free} la="Reserved for open winners" lb="Free" />
        </div>
        <div className="card">
          <h2>Your stake</h2>
          {account ? (
            <>
              <div className="big">{usd(mineValue)}</div>
              <p className="muted">
                {usd(s.mine.mull).replace("$", "")} MULL · {share.toFixed(2)}% of the house · wallet {usd(s.mine.usdc)} USDC
              </p>
              <label>
                Deposit USDC
                <input value={dep} onChange={(e) => setDep(e.target.value)} />
              </label>
              <div style={{ margin: "8px 0 16px" }}>
                <Btn
                  go
                  disabled={!!busy}
                  onClick={async () => {
                    const amt = BigInt(Math.round(Number(dep) * 1e6));
                    await approveIfNeeded(amt);
                    await send("Deposit", HOUSE, mulliganAbi, "deposit", [amt]);
                  }}
                >
                  Deposit
                </Btn>
              </div>
              <label>
                Withdraw MULL
                <input value={wd} onChange={(e) => setWd(e.target.value)} />
              </label>
              <div style={{ marginTop: 8 }}>
                <Btn className="ghost" disabled={!!busy} onClick={() => send("Withdraw", HOUSE, mulliganAbi, "withdraw", [BigInt(Math.round(Number(wd) * 1e6))])}>
                  Withdraw
                </Btn>
              </div>
            </>
          ) : (
            <Btn go onClick={connect}>Connect wallet</Btn>
          )}
        </div>
      </section>
      <div className="card">
        <h2>House PnL breakdown</h2>
        <table>
          <tbody>
            <tr><td>Trading fees earned</td><td style={tone(a.fees)}>+{usd(a.fees)}</td></tr>
            <tr><td>Trader losses booked</td><td style={tone(a.lossesBooked)}>+{usd(a.lossesBooked)}</td></tr>
            <tr><td>Winners paid</td><td style={tone(-a.winnersPaid)}>{usd(-a.winnersPaid)}</td></tr>
            <tr><td>Mulligans minted to losers (dilution)</td><td style={tone(-a.rebates)}>{usd(-a.rebates)}</td></tr>
            <tr>
              <td><b>Net to LPs</b></td>
              <td style={tone(a.fees + a.lossesBooked - a.winnersPaid - a.rebates)}>
                <b>{signed(a.fees + a.lossesBooked - a.winnersPaid - a.rebates)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card scroll">
        <h2>Liquidity flows</h2>
        <table>
          <thead><tr><th>Type</th><th>LP</th><th>USDC</th><th>MULL</th><th>When</th></tr></thead>
          <tbody>
            {s.flows.slice(0, 12).map((f, i) => (
              <tr key={i}>
                <td><span className={`pill ${f.kind === "deposit" ? "ok" : "warn"}`}>{f.kind}</span></td>
                <td className="mono">{short(f.who)}</td>
                <td>{usd(f.usdc)}</td>
                <td>{usd(f.shares).replace("$", "")}</td>
                <td className="muted">{ago(f.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================================================================== stats

export function Stats({ s }: { s: Protocol }) {
  const a = aggregate(s);
  const now = useNow();
  const recent = s.trades.filter((t) => t.closedAt !== undefined).slice(0, 10);
  return (
    <div className="stack">
      <h1>Protocol stats</h1>
      <p className="lede">Indexed live from Mulligan's on-chain events. Nothing here is self-reported.</p>
      <div className="grid">
        <Stat l="Volume" n={usd(a.volume, 0)} />
        <Stat l="Fees" n={usd(a.fees)} />
        <Stat l="Traders" n={a.traders} />
        <Stat l="Trades closed" n={a.closedCount} />
        <Stat l="Liquidations" n={a.liquidations} />
        <Stat l="Mulligans paid" n={<span style={{ color: "var(--ok)" }}>{usd(a.rebates)}</span>} />
      </div>
      <div className="card">
        <h2>Open interest by market</h2>
        <div className="oi">
          {a.oi.map((m) => (
            <div key={m.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{m.name}-USD</b>
                <span className="muted">{px(m.mark)}</span>
              </div>
              <Split a={m.long} b={m.short} la="Long" lb="Short" />
            </div>
          ))}
        </div>
      </div>
      <section className="trade-grid">
        <div className="card scroll">
          <h2>Leaderboard</h2>
          <table>
            <thead><tr><th>#</th><th>Trader</th><th>PnL</th><th>Win rate</th><th>Mulligans</th></tr></thead>
            <tbody>
              {a.leaderboard.slice(0, 10).map((r, i) => (
                <tr key={r.trader}>
                  <td>{i + 1}</td>
                  <td className="mono">{short(r.trader)}</td>
                  <td style={tone(r.pnl)}>{signed(r.pnl)}</td>
                  <td>{Math.round((r.wins / r.trades) * 100)}% · {r.trades}</td>
                  <td style={{ color: "var(--ok)" }}>{r.rebates ? `+${usd(r.rebates)}` : "–"}</td>
                </tr>
              ))}
              {!a.leaderboard.length && <tr><td colSpan={5} className="muted">No closed trades yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card scroll">
          <h2>Recent settlements</h2>
          <table>
            <thead><tr><th>Trader</th><th>Trade</th><th>PnL</th><th>When</th></tr></thead>
            <tbody>
              {recent.map((t) => (
                <tr key={String(t.id)}>
                  <td className="mono">{short(t.trader)}</td>
                  <td>{t.isLong ? "Long" : "Short"} {marketName(t.market)} {String(t.notional / t.margin)}×</td>
                  <td style={tone(t.pnl!)}>
                    {signed(t.pnl!)} {t.rebate ? <span className="pill ok">+{usd(t.rebate)} MULL</span> : null}
                  </td>
                  <td className="muted">{ago(t.closedAt!, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// =================================================================== docs

export function Docs({ s }: { s: Protocol | null }) {
  return (
    <div className="stack docs">
      <h1>Docs</h1>
      <p className="lede">Everything Mulligan does is in one contract with no owner. This page restates it in plain words.</p>
      <div className="card">
        <h2>Lifecycle of a trade</h2>
        <ol>
          <li><b>Open.</b> Pick a HyperCore perp, side, margin and leverage. You pay margin plus a 0.10% fee. The entry price is the worse of HyperCore's oracle and mark for your side.</li>
          <li><b>Reserve.</b> The house sets aside 9× your margin, the most you can win. If the house can't, the open reverts. That's why winners never queue.</li>
          <li><b>Close or liquidation.</b> Close any time. At 90% margin loss anyone can liquidate and keep what's left. Our Rust keeper does this automatically.</li>
          <li><b>Settle.</b> A win pays margin + PnL − fee immediately. A loss is booked by the house.</li>
          <li><b>Mulligan.</b> If you held at least 10 minutes, MULL worth 50% of your loss is minted to you, priced after the loss is booked.</li>
        </ol>
      </div>
      <div className="card scroll">
        <h2>Parameters (constants)</h2>
        <table>
          <tbody>
            <tr><td className="mono">FEE_BPS</td><td>10</td><td className="muted">0.10% of notional, open and close</td></tr>
            <tr><td className="mono">REBATE_BPS</td><td>5000</td><td className="muted">50% of a realized loss back as MULL</td></tr>
            <tr><td className="mono">MIN_HOLD</td><td>600 s</td><td className="muted">Minimum hold for a mulligan</td></tr>
            <tr><td className="mono">MAX_PROFIT_X</td><td>9</td><td className="muted">Profit cap, reserved at open</td></tr>
            <tr><td className="mono">LIQ_BPS</td><td>9000</td><td className="muted">Liquidatable at 90% margin loss</td></tr>
            <tr><td className="mono">ORACLE_PX / MARK_PX</td><td className="mono">0x…0807 / 0x…0806</td><td className="muted">HyperCore read precompiles</td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>The MULL token</h2>
        <p>MULL is an ERC-20 claim on house assets. NAV = house assets ÷ supply. LPs mint at NAV by depositing USDC and burn at NAV to withdraw, limited to assets not reserved for open winners. Losers receive MULL as their mulligan. MULL is freely transferable.</p>
      </div>
      <div className="card">
        <h2>Security model</h2>
        <ul>
          <li>No owner, no proxy, no admin functions. Verify by reading <span className="mono">src/Mulligan.sol</span>.</li>
          <li>Solvency: contract USDC ≥ house assets + open margins, and house assets ≥ reserved. Fuzz-tested.</li>
          <li>Hedge farming is possible but bounded: a farmer nets at most 50% of their loss minus fees; LPs keep the rest. Fuzz-tested.</li>
          <li>Unaudited hackathon code. Test collateral only.</li>
        </ul>
      </div>
      <div className="card scroll">
        <h2>Deployment</h2>
        <table>
          <tbody>
            <tr><td>Network</td><td>{chain.name} (chain {chain.id})</td></tr>
            <tr><td>Mulligan</td><td className="mono">{HOUSE}</td></tr>
            <tr><td>Collateral</td><td className="mono">{s?.usdc ?? "–"}</td></tr>
            <tr><td>Source</td><td><a href="https://github.com/Nuel-osas/mulligan" target="_blank">github.com/Nuel-osas/mulligan</a></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
