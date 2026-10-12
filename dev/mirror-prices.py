"""Local demo only: copy live Hyperliquid mainnet prices into the mocked
HyperCore precompiles on anvil every few seconds, so the local chain trades
at real prices. On HyperEVM the precompiles are real and this isn't needed."""
import json, subprocess, time, urllib.request

RPC = "http://127.0.0.1:8546"
PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # anvil account 0
MARKETS = {"BTC": (0, 5), "ETH": (1, 4), "SOL": (5, 2), "HYPE": (159, 2)}  # mainnet index, szDecimals
PRECOMPILES = ["0x0000000000000000000000000000000000000806", "0x0000000000000000000000000000000000000807"]

def mids():
    req = urllib.request.Request("https://api.hyperliquid.xyz/info", data=b'{"type":"allMids"}',
                                 headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=10))

while True:
    try:
        m = mids()
        for name, (idx, sz) in MARKETS.items():
            raw = round(float(m[name]) * 10 ** (6 - sz))
            for a in PRECOMPILES:
                subprocess.run(["cast", "send", a, "set(uint32,uint64)", str(idx), str(raw),
                                "--private-key", PK, "--rpc-url", RPC, "--async"],
                               capture_output=True, check=True)
        print(time.strftime("%H:%M:%S"), {k: m[k] for k in MARKETS}, flush=True)
    except Exception as e:
        print("mirror error:", e, flush=True)
    time.sleep(3)
