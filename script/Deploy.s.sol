// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Mulligan} from "../src/Mulligan.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --private-key $PK --broadcast
/// USDC=<addr> uses an existing token; otherwise deploys TestUSDC (testnet).
/// MARKETS picks the perp universe: "mainnet" (default) or "testnet" indices.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        address usdcAddr = vm.envOr("USDC", address(0));
        if (usdcAddr == address(0)) usdcAddr = address(new TestUSDC());

        bool testnet = keccak256(bytes(vm.envOr("MARKETS", string("mainnet")))) == keccak256("testnet");
        uint32[] memory ids = new uint32[](4);
        uint8[] memory dec = new uint8[](4);
        uint16[] memory lev = new uint16[](4);
        // HyperCore perp index, szDecimals, max leverage (from each network's /info meta)
        if (testnet) {
            (ids[0], dec[0], lev[0]) = (3, 5, 40); // BTC
            (ids[1], dec[1], lev[1]) = (4, 4, 25); // ETH
            (ids[2], dec[2], lev[2]) = (0, 2, 10); // SOL
            (ids[3], dec[3], lev[3]) = (135, 2, 10); // HYPE
        } else {
            (ids[0], dec[0], lev[0]) = (0, 5, 40); // BTC
            (ids[1], dec[1], lev[1]) = (1, 4, 25); // ETH
            (ids[2], dec[2], lev[2]) = (5, 2, 20); // SOL
            (ids[3], dec[3], lev[3]) = (159, 2, 10); // HYPE
        }
        Mulligan house = new Mulligan(IERC20(usdcAddr), ids, dec, lev);
        vm.stopBroadcast();
        console.log("USDC", usdcAddr);
        console.log("Mulligan", address(house));
    }
}
