// Marketing site: nuntio structure in Hyperliquid green, with a field of
// mint particles where losses fall into the house and half bounce back.
import { useEffect, useRef, type ReactNode } from "react";
import { usd } from "./chain";
import { aggregate, type Protocol } from "./data";
import { Mark } from "./ui";
import "./landing.css";

/**
 * Losses fall into the house; every other one bounces back up as a mint
 * "mulligan". The metaphor of the protocol, drawn with plain canvas.
 */
function Field() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener("resize", resize);
    type P = { x: number; y: number; vx: number; vy: number; r: number; back: boolean; life: number };
    const ps: P[] = [];
    const spawn = (): P => ({
      x: Math.random() * w,
      y: -10 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 0.25,
      vy: 0.6 + Math.random() * 1.1,
      r: 2 + Math.random() * 6,
      back: false,
      life: 0,
    });
    for (let i = 0; i < 140; i++) {
      const p = spawn();
      p.y = Math.random() * h;
      ps.push(p);
    }
    let flip = false;
    const floor = () => h - 70;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      // the house: a soft band at the bottom
      const g = ctx.createLinearGradient(0, floor() - 40, 0, h);
      g.addColorStop(0, "rgba(151,252,228,0)");
      g.addColorStop(1, "rgba(151,252,228,0.14)");
      ctx.fillStyle = g;
      ctx.fillRect(0, floor() - 40, w, h);
      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        if (!p.back && p.y > floor()) {
          flip = !flip;
          if (flip) {
            // the mulligan: half of what the house took comes back
            p.back = true;
            p.vy = -(1.2 + Math.random() * 1.2);
            p.r *= 0.7;
          } else {
            Object.assign(p, spawn());
          }
        }
        if (p.back && p.y < -20) Object.assign(p, spawn());
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        if (p.back) {
          ctx.shadowColor = "rgba(151,252,228,0.9)";
          ctx.shadowBlur = 14;
          ctx.fillStyle = "#c9fff2";
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#97fce4";
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (let i = 0; i < 200; i++) ps.forEach((p) => (p.y += p.vy));
      tick();
      cancelAnimationFrame(raf);
    } else tick();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="field" aria-hidden />;
}

export function LandingPage({ s, wallet }: { s: Protocol | null; wallet: ReactNode }) {
  const a = s && aggregate(s);
  const px = (name: string) => {
    const p = s?.prices.find((x) => x.name === name);
    return p ? usd(p.mark, p.mark < 10_000_000n ? 4 : 2) : "–";
  };
  return (
    <div className="lp">
      <header className="top">
        <a className="brand" href="#/">
          <Mark />
          mulligan
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#/house">Vault</a>
          <a href="#/stats">Stats</a>
          <a href="#/docs">Docs</a>
          <a href="https://github.com/Nuel-osas/mulligan" target="_blank">Code</a>
          <a href="#/trade">Open the app</a>
          {wallet}
        </nav>
      </header>

      <section className="hero lp-hero">
        <div>
          <h1>Lose a trade. Keep a piece of the house.</h1>
          <p className="lede">
            <strong>Perpetuals on HyperEVM, priced straight from HyperCore.</strong> Lose after holding ten minutes
            and half your loss comes back as MULL, a share of the house that took it. Every winner is paid in full,
            at once.
          </p>
          <div className="row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <a href="#/trade"><button className="go"><span>Open the app</span></button></a>
            <a href="#how"><button className="ghost"><span>See how it works</span></button></a>
          </div>
        </div>
        <div className="flow" aria-label="How a trade settles">
          <div className="tag" style={{ textAlign: "center" }}>Example trade · ETH 20× long</div>
          <div className="tier">
            <div className="node"><div className="tag">Price · HyperCore</div><b>ETH {px("ETH")}</b><small>Oracle + mark precompiles</small></div>
            <div className="node lit"><div className="tag">House · MULL</div><b>{s ? usd(s.houseAssets) : "–"}</b><small>Reserves every winner up front</small></div>
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

      <div className="lp-ticker">
        {["BTC", "ETH", "SOL", "HYPE"].map((n) => (
          <div key={n}>
            <span className="t-name">{n}-USD</span>
            <span className="t-px">{px(n)}</span>
          </div>
        ))}
        <div>
          <span className="t-name">Priced by</span>
          <span className="t-px">HyperCore L1</span>
        </div>
      </div>

      <section className="lp-field">
        <Field />
        <div className="lp-field-copy">
          <p className="eyebrow">The mulligan</p>
          <h2>
            Lose $100.
            <br />
            Get $50 of the house back.
          </h2>
          <p>
            Loss-mining venues print a token for every dollar you lose. Mulligan pays you in the house itself: MULL,
            minted at NAV after your loss is booked. Real assets, not emissions.
          </p>
        </div>
      </section>

      <div className="lp-stats">
        <div><b>{s ? usd(s.houseAssets, 0) : "–"}</b><span>House assets</span></div>
        <div><b>{a ? usd(a.volume, 0) : "–"}</b><span>Volume</span></div>
        <div><b>{a ? usd(a.rebates) : "–"}</b><span>Mulligans paid</span></div>
        <div><b>{s ? usd(s.nav, 4) : "–"}</b><span>NAV per MULL</span></div>
        <div><b>{a ? a.traders : "–"}</b><span>Traders</span></div>
      </div>

      <section className="lp-section" id="how">
        <p className="eyebrow">How it works</p>
        <h2 className="lp-h2">Four rules, enforced by one contract with no owner.</h2>
        <div className="lp-steps">
          <div>
            <i>01</i>
            <h3>Priced by HyperCore</h3>
            <p>The contract reads HyperCore's oracle and mark precompiles directly. You get the worse of the two on entry and exit, so latency games don't pay.</p>
          </div>
          <div>
            <i>02</i>
            <h3>Winners never wait</h3>
            <p>Each position's maximum profit, 9× margin, is reserved the moment it opens. LPs can't withdraw it. No payout queue, ever.</p>
          </div>
          <div>
            <i>03</i>
            <h3>Losers get a mulligan</h3>
            <p>Close at a loss after ten minutes and 50% of it is minted back to you as MULL, a transferable share of the house.</p>
          </div>
          <div>
            <i>04</i>
            <h3>Nobody holds the keys</h3>
            <p>No owner, no proxy, no admin function. Every parameter is a constant you can read in the source.</p>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <p className="eyebrow">Loss-mining, fixed</p>
        <h2 className="lp-h2">The good idea, without the leak.</h2>
        <div className="lp-compare">
          <div className="lp-row head"><span /><span>Typical loss-mining perps</span><span>Mulligan</span></div>
          {[
            ["Losers get", "100 tokens per $1 lost, printed with nothing behind them", "50% of the loss as MULL, a claim on real house assets"],
            ["Hedge farmers", "Lose here, win the hedge elsewhere, mint for free", "Can farm, but the house keeps ≥ half of every loss plus fees"],
            ["Winners", "Paid from the pool, or wait in a queue", "Max profit reserved at open, paid in full instantly"],
            ["Control", "Upgradeable; the owner can do anything", "No owner, no upgrades, immutable parameters"],
          ].map(([k, x, y]) => (
            <div className="lp-row" key={k}>
              <span>{k}</span>
              <span className="old">{x}</span>
              <span className="new">{y}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-dark">
        <div>
          <p className="eyebrow">Built on HyperCore</p>
          <h2 className="lp-h2">No outside oracle. The L1 is the price.</h2>
          <p>
            HyperEVM contracts can read HyperCore state through precompiles. Mulligan calls the oracle and mark price
            precompiles for every open, close and liquidation, and a Rust keeper liquidates at 90% margin loss.
          </p>
          <ul>
            <li>13 Foundry tests, fuzzed for solvency and hedge farming</li>
            <li>Rust (alloy) keeper and CLI</li>
            <li>Every number on this site is read from chain events</li>
          </ul>
        </div>
        <pre className="code">{`function prices(uint32 market) public view
  returns (uint256 oracle, uint256 mark)
{
  oracle = _read(ORACLE_PX, market) * scale; // 0x…0807
  mark   = _read(MARK_PX,   market) * scale; // 0x…0806
}

// Settle a loss, then hand back half of it:
uint256 rebate = loss * REBATE_BPS / 10_000;
uint256 shares = rebate * totalSupply()
               / (houseAssets - rebate);
_mint(trader, shares);`}</pre>
      </section>

      <section className="lp-section lp-faq">
        <p className="eyebrow">Questions</p>
        <h2 className="lp-h2">Straight answers.</h2>
        <details>
          <summary>Can I farm it with a hedge on another venue?</summary>
          <p>Yes, and we say so. A perfect hedge nets at most half your loss minus fees. Every rebate is paid out of a loss the house already booked, so the house always keeps at least half plus all fees. That's a fuzz test in the repo, not a promise.</p>
        </details>
        <details>
          <summary>What is MULL worth?</summary>
          <p>House assets divided by supply. Burn it any time for USDC, out of assets not reserved for open winners.</p>
        </details>
        <details>
          <summary>Why is profit capped at 9×?</summary>
          <p>The cap is what lets the house reserve every winner's payout in advance. Uncapped profit is how payout queues happen.</p>
        </details>
        <details>
          <summary>Who can change the rules?</summary>
          <p>No one. There is no owner and no proxy. A new version would be a new contract you choose to move to.</p>
        </details>
      </section>

      <section className="lp-cta">
        <div>
          <h2>Take the trade. Keep the mulligan.</h2>
          <a className="mint-btn" href="#/trade">
            Open the app <span>→</span>
          </a>
        </div>
      </section>

      <footer className="lp-foot">
        <span>
          <Mark /> mulligan · Priced by HyperCore · Settled on HyperEVM
        </span>
        <span>
          <a href="#/docs">Docs</a> · <a href="https://github.com/Nuel-osas/mulligan" target="_blank">GitHub</a> · Unaudited
          hackathon code
        </span>
      </footer>
    </div>
  );
}
