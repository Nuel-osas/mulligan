// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Testnet-only USDC with an open faucet.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Up to $10,000 per call.
    function faucet(uint256 amount) external {
        require(amount <= 10_000e6, "max 10k");
        _mint(msg.sender, amount);
    }
}
