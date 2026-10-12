// Protocol state + an in-browser indexer over Mulligan's events.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { mulliganAbi, usdcAbi } from "./abi";
import { DEPLOYED, HOUSE, MARKETS, hyperCorePx, publicClient } from "./chain";

export const MIN_HOLD = 600;
export const FEE_BPS = 10n;

export type Pos = {
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

export type Trade = {
  id: bigint;
  trader: Address;
  market: number;
  isLong: boolean;
  margin: bigint;
  notional: bigint;
  entryPx: bigint;
  openedAt: number;
  closedAt?: number;
  exitPx?: bigint;
  pnl?: bigint;
  paid?: bigint;
  liquidated?: boolean;
  rebate?: bigint;
  openTx: string;
  closeTx?: string;
};

export type Flow = { kind: "deposit" | "withdraw"; who: Address; usdc: bigint; shares: bigint; at: number; tx: string };

export type Protocol = {
  prices: { name: string; id: number; oracle: bigint; mark: bigint }[];
  houseAssets: bigint;
  reserved: bigint;
  supply: bigint;
  nav: bigint;
  usdc: Address;
  positions: Pos[];
  trades: Trade[];
  flows: Flow[];
  chainTime: number;
  mine: { usdc: bigint; mull: bigint };
  history: { t: number; nav: number; px: Record<string, number> }[];
};

const read = (functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address: HOUSE, abi: mulliganAbi, functionName, args } as any) as Promise<any>;

const blockTimes = new Map<bigint, number>();
async function timeOf(n: bigint) {
  if (!blockTimes.has(n)) blockTimes.set(n, Number((await publicClient.getBlock({ blockNumber: n })).timestamp));
  return blockTimes.get(n)!;
}

async function index(): Promise<{ trades: Trade[]; flows: Flow[] }> {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = BigInt(import.meta.env.VITE_FROM_BLOCK ?? (latest > 50_000n ? latest - 50_000n : 0n));
  const get = (eventName: string) =>
    publicClient.getContractEvents({ address: HOUSE, abi: mulliganAbi, eventName, fromBlock } as any) as Promise<any[]>;
  const [opened, closed, rebates, deposits, withdraws] = await Promise.all([
    get("Opened"),
    get("Closed"),
    get("Mulligan"),
    get("Deposit"),
    get("Withdraw"),
  ]);
  const trades = new Map<bigint, Trade>();
  for (const l of opened) {
    const a = l.args;
    trades.set(a.id, {
      id: a.id,
      trader: a.trader,
      market: Number(a.market),
      isLong: a.isLong,
      margin: a.margin,
      notional: a.notional,
      entryPx: a.entryPx,
      openedAt: await timeOf(l.blockNumber),
      openTx: l.transactionHash,
    });
  }
  for (const l of closed) {
    const t = trades.get(l.args.id);
    if (!t) continue;
    Object.assign(t, {
      closedAt: await timeOf(l.blockNumber),
      exitPx: l.args.exitPx,
      pnl: l.args.pnl,
      paid: l.args.paid,
      liquidated: l.args.liquidated,
      closeTx: l.transactionHash,
    });
  }
  for (const l of rebates) {
    const t = trades.get(l.args.id);
    if (t) t.rebate = l.args.rebateUsd;
  }
  const flows: Flow[] = [];
  for (const [kind, logs] of [
    ["deposit", deposits],
    ["withdraw", withdraws],
  ] as const) {
    for (const l of logs)
      flows.push({ kind, who: l.args.lp, usdc: l.args.usdc, shares: l.args.shares, at: await timeOf(l.blockNumber), tx: l.transactionHash });
  }
  flows.sort((a, b) => b.at - a.at);
  return { trades: [...trades.values()].sort((a, b) => Number(b.id - a.id)), flows };
}

/** Polled every 3s. Keeps a short in-session history for charts. */
export function useProtocol(account?: Address) {
  const [s, setS] = useState<Protocol | null>(null);
  const [err, setErr] = useState("");
  const hist = useRef<Protocol["history"]>([]);
  const load = useCallback(async () => {
    try {
      if (!DEPLOYED) {
        // Not deployed yet: live HyperCore prices straight from the precompiles, nothing else.
        const px = await Promise.all(
          MARKETS.map(async (m) => {
            const [oracle, mark] = await Promise.all([
              hyperCorePx("0x0000000000000000000000000000000000000807", m),
              hyperCorePx("0x0000000000000000000000000000000000000806", m),
            ]);
            return { name: m.name, id: m.id, oracle, mark };
          })
        );
        const block = await publicClient.getBlock();
        hist.current = [...hist.current.slice(-299), { t: Date.now(), nav: 1, px: Object.fromEntries(px.map((p) => [p.name, Number(p.mark) / 1e6])) }];
        setS({
          prices: px,
          houseAssets: 0n,
          reserved: 0n,
          supply: 0n,
          nav: 1_000_000n,
          usdc: "0x0000000000000000000000000000000000000000",
          positions: [],
          trades: [],
          flows: [],
          chainTime: Number(block.timestamp),
          mine: { usdc: 0n, mull: 0n },
          history: hist.current,
        });
        setErr("");
        return;
      }
      const [prices, houseAssets, reserved, supply, nav, nextId, usdc, block, idx] = await Promise.all([
        Promise.all(MARKETS.map((m) => read("prices", [m.id]))),
        read("houseAssets"),
        read("reserved"),
        read("totalSupply"),
        read("nav"),
        read("nextId"),
        read("usdc"),
        publicClient.getBlock(),
        index(),
      ]);
      const positions: Pos[] = [];
      for (const t of idx.trades.filter((t) => t.closedAt === undefined)) {
        const p = await read("positions", [t.id]);
        if (!p[3]) continue;
        const v = await read("preview", [t.id]);
        positions.push({
          id: t.id,
          trader: p[0],
          market: p[1],
          isLong: p[2],
          open: true,
          entryPx: p[4],
          openedAt: p[5],
          margin: p[6],
          notional: p[7],
          maxProfit: p[8],
          pnl: v[0],
          exitPx: v[1],
          liquidatable: v[2],
        });
      }
      void nextId;
      let mine = { usdc: 0n, mull: 0n };
      if (account) {
        const [u, m] = await Promise.all([
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [account] }),
          read("balanceOf", [account]),
        ]);
        mine = { usdc: u as bigint, mull: m };
      }
      const px = MARKETS.map((m, i) => ({ ...m, oracle: prices[i][0] as bigint, mark: prices[i][1] as bigint }));
      hist.current = [
        ...hist.current.slice(-299),
        {
          t: Date.now(),
          nav: Number(nav) / 1e6,
          px: Object.fromEntries(px.map((p) => [p.name, Number(p.mark) / 1e6])),
        },
      ];
      setS({
        prices: px,
        houseAssets,
        reserved,
        supply,
        nav,
        usdc,
        positions,
        trades: idx.trades,
        flows: idx.flows,
        chainTime: Number(block.timestamp),
        mine,
        history: hist.current,
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

/** Aggregates every page needs. */
export function aggregate(s: Protocol) {
  const closed = s.trades.filter((t) => t.closedAt !== undefined);
  const fee = (n: bigint) => (n * FEE_BPS) / 10_000n;
  const volume = s.trades.reduce((a, t) => a + t.notional, 0n) + closed.reduce((a, t) => a + t.notional, 0n);
  const fees = s.trades.reduce((a, t) => a + fee(t.notional), 0n) + closed.reduce((a, t) => a + fee(t.notional), 0n);
  const lossesBooked = closed.reduce((a, t) => a + (t.pnl! < 0n ? -t.pnl! : 0n), 0n);
  const winnersPaid = closed.reduce((a, t) => a + (t.pnl! > 0n ? t.pnl! : 0n), 0n);
  const rebates = closed.reduce((a, t) => a + (t.rebate ?? 0n), 0n);
  const traders = new Set(s.trades.map((t) => t.trader.toLowerCase())).size;
  const liquidations = closed.filter((t) => t.liquidated).length;
  const oi = s.prices.map((m) => {
    const ps = s.positions.filter((p) => p.market === m.id);
    return {
      ...m,
      long: ps.filter((p) => p.isLong).reduce((a, p) => a + p.notional, 0n),
      short: ps.filter((p) => !p.isLong).reduce((a, p) => a + p.notional, 0n),
    };
  });
  const board = new Map<string, { trader: Address; pnl: bigint; trades: number; wins: number; rebates: bigint; volume: bigint }>();
  for (const t of closed) {
    const k = t.trader.toLowerCase();
    const r = board.get(k) ?? { trader: t.trader, pnl: 0n, trades: 0, wins: 0, rebates: 0n, volume: 0n };
    r.pnl += t.pnl!;
    r.trades += 1;
    r.wins += t.pnl! > 0n ? 1 : 0;
    r.rebates += t.rebate ?? 0n;
    r.volume += t.notional * 2n;
    board.set(k, r);
  }
  return {
    volume,
    fees,
    lossesBooked,
    winnersPaid,
    rebates,
    traders,
    liquidations,
    oi,
    closedCount: closed.length,
    leaderboard: [...board.values()].sort((a, b) => (b.pnl > a.pnl ? 1 : -1)),
  };
}
