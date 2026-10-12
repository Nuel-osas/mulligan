import { useEffect, useState } from "react";
import { usdcAbi } from "./abi";
import { HOUSE, chain, explorerTx, publicClient } from "./chain";
import { useProtocol } from "./data";
import { LandingPage } from "./landing";
import { Docs, House, Portfolio, Stats, Trade, type Ctx } from "./pages";
import { Mark } from "./ui";
import { WalletButton, WalletModal, useWallet } from "./wallet";

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
  const w = useWallet();
  const { wallet, account } = w;
  const [picker, setPicker] = useState(() => location.hash.includes("connect"));
  const { s, err, reload } = useProtocol(account);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [busy, setBusy] = useState("");

  const connect = () => setPicker(true);
  const modal = picker && <WalletModal w={w} onClose={() => setPicker(false)} />;
  const mine = s && account ? { ...s.mine, nav: s.nav } : undefined;

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
  if (!isApp)
    return (
      <>
        <LandingPage s={s} wallet={<WalletButton w={w} mine={mine} onConnect={connect} />} />
        {modal}
      </>
    );

  return (
    <>
      <header className="top">
        <a className="brand" href="#/">
          <Mark />
          mulligan
        </a>
        <nav>
          {APP.map(([r, l]) => (
            <a key={r} href={`#/${r}`} className={route === r ? "on" : ""}>
              {l}
            </a>
          ))}
          <WalletButton w={w} mine={mine} onConnect={connect} />
        </nav>
      </header>
      {modal}
      <main>
        {err && <p className="msg bad">{err}</p>}
        {w.error && !picker && <p className="msg bad">{w.error}</p>}
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
