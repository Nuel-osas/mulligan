#!/usr/bin/env bash
# Deploy Mulligan + test USDC to HyperEVM mainnet and point the app at it.
#
#   ./deploy-mainnet.sh
#
# Foundry asks for the deployer's private key in a hidden prompt. It is never
# written to disk or shown. The deployer needs ~0.01 HYPE on HyperEVM.
set -euo pipefail
cd "$(dirname "$0")"

RPC=${RPC_URL:-https://rpc.hyperliquid.xyz/evm}
[ "$(cast chain-id --rpc-url "$RPC")" = "999" ] || { echo "RPC is not HyperEVM mainnet (999)"; exit 1; }

read -r -p "Deployer address (0x...): " SENDER
BAL=$(cast balance "$SENDER" --rpc-url "$RPC" --ether)
echo "HYPE balance: $BAL"
awk "BEGIN{exit !($BAL >= 0.005)}" || { echo "Need at least 0.005 HYPE on HyperEVM for gas."; exit 1; }

forge build -q
forge script script/Deploy.s.sol --rpc-url "$RPC" --sender "$SENDER" --interactives 1 --broadcast --slow

RUN=broadcast/Deploy.s.sol/999/run-latest.json
HOUSE=$(jq -r '[.transactions[] | select(.contractName=="Mulligan")][0].contractAddress' "$RUN")
USDC=$(jq -r '[.transactions[] | select(.contractName=="TestUSDC")][0].contractAddress' "$RUN")
BLOCK=$(( $(jq -r '[.receipts[]][0].blockNumber' "$RUN") ))
HOUSE=$(cast to-check-sum-address "$HOUSE")

cat > app/.env.local <<ENV
# HyperEVM mainnet, written by deploy-mainnet.sh
VITE_CHAIN_ID=999
VITE_RPC=$RPC
VITE_MULLIGAN=$HOUSE
VITE_FROM_BLOCK=$BLOCK
ENV

echo
echo "Mulligan   $HOUSE   https://hyperevmscan.io/address/$HOUSE"
echo "Test USDC  $USDC"
echo "From block $BLOCK"
echo
echo "Check it reads HyperCore through the contract:"
echo "  MULLIGAN=$HOUSE ./keeper/target/release/mulligan prices"
echo "Restart the app (cd app && pnpm dev) to pick up the new address."
