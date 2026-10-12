import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = import.meta.env;
const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 998);
const RPC = env.VITE_RPC ?? "https://rpc.hyperliquid-testnet.xyz/evm";

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 999 ? "HyperEVM" : CHAIN_ID === 998 ? "HyperEVM Testnet" : "Local HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const HOUSE = env.VITE_MULLIGAN as Address;
export const publicClient = createPublicClient({ chain, transport: http(RPC) });

/** Perp index on HyperCore, per network. */
export const MARKETS: { name: string; id: number }[] =
  CHAIN_ID === 998
    ? [
        { name: "BTC", id: 3 },
        { name: "ETH", id: 4 },
        { name: "SOL", id: 0 },
        { name: "HYPE", id: 135 },
      ]
    : [
        { name: "BTC", id: 0 },
        { name: "ETH", id: 1 },
        { name: "SOL", id: 5 },
        { name: "HYPE", id: 159 },
      ];
export const marketName = (id: number) => MARKETS.find((m) => m.id === id)?.name ?? `#${id}`;

export const explorerTx = (hash: string) =>
  CHAIN_ID === 999
    ? `https://hyperevmscan.io/tx/${hash}`
    : CHAIN_ID === 998
      ? `https://testnet.purrsec.com/tx/${hash}`
      : "";

/**
 * A browser wallet when present. On a local chain, VITE_DEMO_PK signs instead
 * (anvil test key only; never set it for a real network).
 */
export async function connectWallet(): Promise<WalletClient> {
  if (env.VITE_DEMO_PK && CHAIN_ID === 31337) {
    return createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(env.VITE_DEMO_PK) });
  }
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No wallet found. Install Rabby or MetaMask.");
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${CHAIN_ID.toString(16)}`,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [RPC],
        },
      ],
    });
  }
  return createWalletClient({ chain, transport: custom(eth), account });
}

export const usd = (v: bigint, dp = 2) => {
  const neg = v < 0n;
  const n = Number(neg ? -v : v) / 1e6;
  return `${neg ? "-" : ""}$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
