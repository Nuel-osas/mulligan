import { useEffect, useState } from "react";
import type { Address, WalletClient } from "viem";
import { usdcAbi } from "./abi";
import { HOUSE, chain, connectWallet, explorerTx, publicClient } from "./chain";
import { useProtocol } from "./data";
import { LandingPage } from "./landing";
import { Docs, House, Portfolio, Stats, Trade, type Ctx } from "./pages";
import { Mark, short } from "./ui";

type Route = "home" | "trade" | "portfolio" | "house" | "stats" | "docs";
const APP: [Route, string][] = [
  ["trade", "Trade"],
  ["portfolio", "Portfolio"],
  ["house", "Vault"],
  ["stats", "Stats"],
  ["docs", "Docs"],
];

function useRoute(): Route {
  const get = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "home") as Route;
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => {
      setR(get());
      scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

export function App() {
  const route = useRoute();
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const account = wallet?.account?.address as Address | undefined;
  const { s, err, reload } = useProtocol(account);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState("");

  const connect = () => connectWallet().then(setWallet, (e) => setMsg({ ok: false, text: e.message }));

  const send: Ctx["send"] = async (label, address, abi, functionName, args) => {
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
      address: s!.usdc,
      abi: usdcAbi,
      functionName: "allowance",
      args: [account!, HOUSE],
    })) as bigint;
    if (allowance < amount) await send("Approve USDC", s!.usdc, usdcAbi, "approve", [HOUSE, 2n ** 255n]);
  };

  const isApp = route !== "home";
  const ctx = s ? ({ s, account, busy, connect, send, approveIfNeeded } as Ctx) : null;
  if (!isApp) return <LandingPage s={s} />;

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <Mark />
          mulligan
        </a>
        <nav>
          {isApp ? (
            APP.map(([r, l]) => (
              <a key={r} href={`#/${r}`} className={route === r ? "on" : ""}>
                {l}
              </a>
            ))
          ) : (
            <>
              <a href="#/docs">How it works</a>
              <a href="#/house">Vault</a>
              <a href="#/stats">Stats</a>
              <a href="https://github.com/Nuel-osas/mulligan" target="_blank">Code</a>
            </>
          )}
          {isApp && account ? (
            <a className="on" href="#/portfolio">{short(account)}</a>
          ) : isApp ? (
            <a className="cta" href="#" onClick={(e) => { e.preventDefault(); connect(); }}>
              <span>Connect wallet</span>
            </a>
          ) : (
            <a className="cta" href="#/trade">
              <span>Open the app</span>
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
              <a href={explorerTx(msg.hash)} target="_blank">view tx</a>
            )}
          </p>
        )}
        {route === "docs" ? (
          <Docs s={s} />
        ) : !ctx ? (
          <p className="muted">Reading HyperEVM…</p>
        ) : route === "portfolio" ? (
          <Portfolio {...ctx} />
        ) : route === "house" ? (
          <House {...ctx} />
        ) : route === "stats" ? (
          <Stats s={ctx.s} />
        ) : (
          <Trade {...ctx} />
        )}
        <footer className="built">
          <span>
            Priced by <b>HyperCore</b> · settled on <b>HyperEVM</b>
          </span>
          <span>{chain.name} · No owner · No upgrades</span>
        </footer>
      </main>
    </>
  );
}
