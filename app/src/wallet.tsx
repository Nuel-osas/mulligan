// Wallet connection: EIP-6963 discovery of every injected wallet, network
// switching to HyperEVM, an account menu, and silent reconnect on reload.
import { useEffect, useRef, useState } from "react";
import { createWalletClient, custom, formatEther, type Address, type WalletClient } from "viem";
import { chain, publicClient, usd } from "./chain";
import { short } from "./ui";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: any; removeListener?: any };
export type WalletOption = { id: string; name: string; icon?: string; provider?: Eip1193 };

const LAST = "mulligan.wallet";
const hexChain = `0x${chain.id.toString(16)}`;

/** Every wallet the browser announces, plus a local demo signer on anvil. */
export function useWalletOptions() {
  const [opts, setOpts] = useState<WalletOption[]>([]);
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const publish = () => {
      const list = [...found.values()];
      const legacy = (window as any).ethereum as Eip1193 | undefined;
      if (!list.length && legacy) list.push({ id: "injected", name: "Browser wallet", provider: legacy });
      setOpts(list);
    };
    const on = (e: any) => {
      const { info, provider } = e.detail;
      found.set(info.rdns || info.uuid, { id: info.rdns || info.uuid, name: info.name, icon: info.icon, provider });
      publish();
    };
    addEventListener("eip6963:announceProvider", on);
    dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(publish, 300); // legacy wallets that don't announce
    return () => {
      removeEventListener("eip6963:announceProvider", on);
      clearTimeout(t);
    };
  }, []);
  return opts;
}

async function ensureChain(p: Eip1193) {
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
  } catch (e: any) {
    if (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e?.message ?? "")) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChain,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: [chain.id === 998 ? "https://testnet.purrsec.com" : "https://hyperevmscan.io"],
        },
      ],
    });
  }
}

/** Connection state, shared by the landing page and the app. */
export function useWallet() {
  const options = useWalletOptions();
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [active, setActive] = useState<WalletOption | null>(null);
  const [error, setError] = useState("");
  const tried = useRef(false);

  const connect = async (opt: WalletOption, silent = false) => {
    setError("");
    try {
      const p = opt.provider!;
      const accounts: Address[] = await p.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
      if (!accounts.length) return;
      await ensureChain(p);
      setWallet(createWalletClient({ chain, transport: custom(p), account: accounts[0] }));
      setActive(opt);
      try {
        localStorage.setItem(LAST, opt.id);
      } catch {}
    } catch (e: any) {
      if (!silent) setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  };

  const disconnect = () => {
    setWallet(null);
    setActive(null);
    try {
      localStorage.removeItem(LAST);
    } catch {}
  };

  // Silent reconnect to the last wallet used.
  useEffect(() => {
    if (tried.current || !options.length) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {}
    const opt = options.find((o) => o.id === last);
    if (opt) {
      tried.current = true;
      connect(opt, true);
    }
  }, [options]);

  // Follow account and network changes made inside the wallet.
  useEffect(() => {
    const p = active?.provider;
    if (!p?.on) return;
    const onAccounts = (a: Address[]) =>
      a.length ? setWallet(createWalletClient({ chain, transport: custom(p), account: a[0] })) : disconnect();
    const onChain = (id: string) => {
      if (id !== hexChain) setError(`Wrong network. Switch to ${chain.name}.`);
      else setError("");
    };
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  return { options, wallet, active, error, connect, disconnect, account: wallet?.account?.address as Address | undefined };
}

export type WalletState = ReturnType<typeof useWallet>;

/** Header button: opens the picker, or shows the account menu once connected. */
export function WalletButton({ w, mine, onConnect }: { w: WalletState; mine?: { usdc: bigint; mull: bigint; nav: bigint }; onConnect: () => void }) {
  const [menu, setMenu] = useState(false);
  const [hype, setHype] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!w.account || !menu) return;
    publicClient.getBalance({ address: w.account }).then(setHype, () => {});
  }, [w.account, menu]);
  if (!w.account)
    return (
      <a className="cta" href="#" onClick={(e) => { e.preventDefault(); onConnect(); }}>
        <span>Connect wallet</span>
      </a>
    );

  return (
    <div className="acct">
      <a href="#" className="on acct-btn" onClick={(e) => { e.preventDefault(); setMenu((m) => !m); }}>
        {w.active?.icon ? <img src={w.active.icon} alt="" /> : <i className="dot" />} {short(w.account)}
      </a>
      {menu && (
        <div className="acct-menu" onMouseLeave={() => setMenu(false)}>
          <div className="tag">{w.active?.name ?? "Wallet"} · {chain.name}</div>
          <div className="acct-addr mono">{w.account}</div>
          <button
            className="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(w.account!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            <span>{copied ? "Copied" : "Copy address"}</span>
          </button>
          <table>
            <tbody>
              <tr><td className="muted">HYPE (gas)</td><td>{hype === null ? "…" : Number(formatEther(hype)).toFixed(4)}</td></tr>
              {mine && <tr><td className="muted">USDC</td><td>{usd(mine.usdc)}</td></tr>}
              {mine && <tr><td className="muted">MULL</td><td>{usd(mine.mull).replace("$", "")} ≈ {usd((mine.mull * mine.nav) / 1_000_000n)}</td></tr>}
            </tbody>
          </table>
          <div className="row">
            <a href="#/portfolio"><button><span>Portfolio</span></button></a>
            <button className="danger" onClick={() => { setMenu(false); w.disconnect(); }}>
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WalletModal({ w, onClose }: { w: WalletState; onClose: () => void }) {
  const [pending, setPending] = useState("");
  useEffect(() => {
    if (w.account) onClose();
  }, [w.account]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Connect a wallet</h2>
          <button className="ghost" onClick={onClose} aria-label="Close"><span>✕</span></button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Mulligan runs on {chain.name}. Your wallet will be asked to switch network, or to add it.
        </p>
        <div className="wallets">
          {w.options.map((o) => (
            <button
              key={o.id}
              className="ghost wallet-opt"
              disabled={!!pending}
              onClick={async () => {
                setPending(o.id);
                await w.connect(o);
                setPending("");
              }}
            >
              <span>
                {o.icon ? <img src={o.icon} alt="" /> : <i className="dot" />}
                {o.name}
                <em>{pending === o.id ? "Check your wallet…" : "Detected"}</em>
              </span>
            </button>
          ))}
          {!w.options.length && (
            <div className="msg warn">
              No wallet found. Install <a href="https://rabby.io" target="_blank">Rabby</a> or{" "}
              <a href="https://metamask.io" target="_blank">MetaMask</a>, then reload.
            </div>
          )}
        </div>
        {w.error && <p className="msg bad">{w.error}</p>}
        <p className="tag" style={{ marginTop: 16 }}>Test collateral only · unaudited · no owner</p>
      </div>
    </div>
  );
}
