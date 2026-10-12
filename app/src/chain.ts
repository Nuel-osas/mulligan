import { createPublicClient, defineChain, http, type Address } from "viem";

const env = import.meta.env;
// HyperEVM mainnet by default; VITE_* overrides for testnet (998).
const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 999);
const RPC = env.VITE_RPC ?? (CHAIN_ID === 998 ? "https://rpc.hyperliquid-testnet.xyz/evm" : "https://rpc.hyperliquid.xyz/evm");

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 998 ? "HyperEVM Testnet" : "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

/** Unset until the contract is deployed; the app then runs read-only on live HyperCore prices. */
export const HOUSE = (env.VITE_MULLIGAN || undefined) as Address;
export const DEPLOYED = !!HOUSE;
export const publicClient = createPublicClient({ chain, transport: http(RPC) });

/** Perp index on HyperCore, per network. */
export const MARKETS: { name: string; id: number; sz: number }[] =
  CHAIN_ID === 998
    ? [
        { name: "BTC", id: 3, sz: 5 },
        { name: "ETH", id: 4, sz: 4 },
        { name: "SOL", id: 0, sz: 2 },
        { name: "HYPE", id: 135, sz: 2 },
      ]
    : [
        { name: "BTC", id: 0, sz: 5 },
        { name: "ETH", id: 1, sz: 4 },
        { name: "SOL", id: 5, sz: 2 },
        { name: "HYPE", id: 159, sz: 2 },
      ];

/** Read a HyperCore price precompile directly (0x…0807 oracle, 0x…0806 mark), as 6dp USD. */
export async function hyperCorePx(precompile: "0x0000000000000000000000000000000000000807" | "0x0000000000000000000000000000000000000806", m: { id: number; sz: number }) {
  const data = `0x${m.id.toString(16).padStart(64, "0")}` as `0x${string}`;
  const { data: out } = await publicClient.call({ to: precompile, data });
  return BigInt(out ?? "0x0") * 10n ** BigInt(m.sz);
}
export const marketName = (id: number) => MARKETS.find((m) => m.id === id)?.name ?? `#${id}`;

export const explorerTx = (hash: string) =>
  CHAIN_ID === 998 ? `https://testnet.purrsec.com/tx/${hash}` : `https://hyperevmscan.io/tx/${hash}`;
export const explorerAddr = (a: string) =>
  CHAIN_ID === 998 ? `https://testnet.purrsec.com/address/${a}` : `https://hyperevmscan.io/address/${a}`;

export const usd = (v: bigint, dp = 2) => {
  const neg = v < 0n;
  const n = Number(neg ? -v : v) / 1e6;
  return `${neg ? "-" : ""}$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
