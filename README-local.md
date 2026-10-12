# Local run (anvil + mocked HyperCore precompiles)

```bash
anvil --port 8546 &
RPC=http://127.0.0.1:8546
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil account 0
CODE=$(forge inspect test/Mulligan.t.sol:MockPrecompile deployedBytecode)
for a in 0x0000000000000000000000000000000000000806 0x0000000000000000000000000000000000000807; do
  cast rpc anvil_setCode $a $CODE --rpc-url $RPC
  # raw = usd * 10^(6 - szDecimals): BTC(0,sz5) ETH(1,sz4) SOL(5,sz2) HYPE(159,sz2)
  for m in 0:824700 1:250904 5:1074900 159:326800; do
    cast send $a "set(uint32,uint64)" ${m%%:*} ${m##*:} --private-key $PK --rpc-url $RPC
  done
done
forge script script/Deploy.s.sol --rpc-url $RPC --private-key $PK --broadcast
```

Move a price (for example, ETH down 5%) by calling `set(1, 238359)` on both addresses. `cast rpc evm_increaseTime 700` skips past the 10-minute mulligan hold.
