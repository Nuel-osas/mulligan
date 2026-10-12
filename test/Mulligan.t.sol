// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Mulligan} from "../src/Mulligan.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// Stands in for a HyperCore read precompile: 32-byte perp index in, uint64 out.
contract MockPrecompile {
    mapping(uint32 => uint64) public px;

    function set(uint32 market, uint64 raw) external {
        px[market] = raw;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        return abi.encode(px[abi.decode(data, (uint32))]);
    }
}

contract MulliganTest is Test {
    Mulligan house;
    TestUSDC usdc;
    address lp = makeAddr("lp");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint32 constant BTC = 0; // szDecimals 5: raw = px / 10
    uint32 constant ETH = 1; // szDecimals 4: raw = px / 100

    function setUp() public {
        vm.etch(0x0000000000000000000000000000000000000806, address(new MockPrecompile()).code);
        vm.etch(0x0000000000000000000000000000000000000807, address(new MockPrecompile()).code);
        setBtc(80_000);
        setEth(2_500);

        usdc = new TestUSDC();
        uint32[] memory ids = new uint32[](2);
        uint8[] memory dec = new uint8[](2);
        uint16[] memory lev = new uint16[](2);
        (ids[0], dec[0], lev[0]) = (BTC, 5, 40);
        (ids[1], dec[1], lev[1]) = (ETH, 4, 25);
        house = new Mulligan(usdc, ids, dec, lev);

        for (uint256 i; i < 3; i++) {
            address a = [lp, alice, bob][i];
            vm.startPrank(a);
            usdc.faucet(10_000e6);
            usdc.approve(address(house), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(lp);
        house.deposit(10_000e6);
    }

    // HyperCore perp prices are raw * 10^szDecimals in 6dp, i.e. raw = usd * 10^(6 - sz).
    function setBtc(uint64 usd) internal {
        MockPrecompile(payable(0x0000000000000000000000000000000000000807)).set(BTC, usd * 10);
        MockPrecompile(payable(0x0000000000000000000000000000000000000806)).set(BTC, usd * 10);
    }

    function setEth(uint64 usd) internal {
        MockPrecompile(payable(0x0000000000000000000000000000000000000807)).set(ETH, usd * 100);
        MockPrecompile(payable(0x0000000000000000000000000000000000000806)).set(ETH, usd * 100);
    }

    function openAs(address who, uint32 m, bool isLong, uint256 margin, uint256 lev) internal returns (uint256 id) {
        vm.prank(who);
        id = house.open(m, isLong, margin, lev);
    }

    function testReadsHyperCorePrices() public view {
        (uint256 oracle, uint256 mark) = house.prices(BTC);
        assertEq(oracle, 80_000e6);
        assertEq(mark, 80_000e6);
    }

    function testLpDepositsAndWithdrawsAtNav() public {
        assertEq(house.balanceOf(lp), 10_000e6);
        assertEq(house.nav(), 1e6);
        vm.prank(lp);
        house.withdraw(1_000e6);
        assertEq(usdc.balanceOf(lp), 1_000e6);
    }

    function testWinnerIsPaidImmediately() public {
        uint256 id = openAs(alice, BTC, true, 100e6, 10); // $1,000 notional, $1 fee
        setBtc(88_000); // +10% -> +$100
        vm.prank(alice);
        house.close(id);
        // 10,000 - 101 (margin + open fee) + 100 margin + 100 pnl - 1 close fee
        assertEq(usdc.balanceOf(alice), 10_098e6);
        assertEq(house.reserved(), 0);
    }

    function testProfitIsCappedAtNineTimesMargin() public {
        uint256 id = openAs(alice, BTC, true, 100e6, 40); // $4,000 notional
        setBtc(200_000); // +150% -> raw +$6,000, capped at $900
        (int256 pnl,,,) = house.preview(id);
        assertEq(pnl, 900e6);
    }

    function testOpenReservesMaxProfitAndRefusesWhenHouseCannotPay() public {
        openAs(alice, BTC, true, 1_000e6, 2); // reserves $9,000 of $10,002
        assertEq(house.reserved(), 9_000e6);
        vm.prank(bob);
        vm.expectRevert(Mulligan.HouseTooSmall.selector);
        house.open(BTC, false, 200e6, 2); // needs $1,800 free, $1,002 left
    }

    function testLpCannotWithdrawWhatWinnersMightBeOwed() public {
        openAs(alice, BTC, true, 1_000e6, 2);
        vm.prank(lp);
        vm.expectRevert(Mulligan.Reserved.selector);
        house.withdraw(2_000e6);
    }

    function testLossBuysHalfItsValueInHouseShares() public {
        uint256 id = openAs(alice, ETH, true, 100e6, 10); // $1,000 notional
        vm.warp(block.timestamp + 10 minutes);
        setEth(2_250); // -10% -> -$100, the whole margin
        vm.prank(alice);
        house.close(id);
        uint256 shares = house.balanceOf(alice);
        assertGt(shares, 0);
        uint256 worth = (shares * house.nav()) / 1e6;
        assertApproxEqAbs(worth, 50e6, 2); // half the $100 loss, at NAV
    }

    function testQuickFlipEarnsNoMulligan() public {
        uint256 id = openAs(alice, ETH, true, 100e6, 10);
        vm.warp(block.timestamp + 9 minutes);
        setEth(2_400);
        vm.prank(alice);
        house.close(id);
        assertEq(house.balanceOf(alice), 0);
    }

    /// The farm papertrade allows: lose here, win the same on a hedge elsewhere.
    /// Farming can pay, but only out of a loss the house already booked: the
    /// LPs keep at least half of it plus all fees, so the house never bleeds.
    function testHedgeFarmingAlwaysLeavesTheHouseAhead(uint64 dropBps, uint8 lev) public {
        dropBps = uint64(bound(dropBps, 10, 900)); // 0.1% to 9% move
        lev = uint8(bound(lev, 1, 10));
        uint256 lpBefore = (house.balanceOf(lp) * house.nav()) / 1e6;
        uint256 start = usdc.balanceOf(alice);

        uint256 margin = 100e6;
        uint256 id = openAs(alice, ETH, true, margin, lev);
        vm.warp(block.timestamp + 10 minutes);
        setEth(uint64(2_500 * (10_000 - dropBps) / 10_000));
        (int256 pnl,,,) = house.preview(id);
        vm.prank(alice);
        house.close(id);

        uint256 loss = uint256(-pnl);
        uint256 fees = 2 * (margin * lev * 10) / 10_000;
        uint256 rebateWorth = (house.balanceOf(alice) * house.nav()) / 1e6;
        uint256 farmerEnd = usdc.balanceOf(alice) + loss /* perfect hedge */ + rebateWorth;
        uint256 lpAfter = (house.balanceOf(lp) * house.nav()) / 1e6;

        // Farmer nets at most half the loss, minus fees.
        assertLe(farmerEnd, start + loss / 2 - fees + 1);
        // LPs gain at least half the loss plus fees.
        assertGe(lpAfter + 2, lpBefore + loss / 2 + fees);
    }

    function testLiquidationAtNinetyPercentLoss() public {
        uint256 id = openAs(alice, BTC, true, 100e6, 20); // $2,000 notional
        setBtc(76_800); // -4% -> -$80: not yet
        vm.prank(bob);
        vm.expectRevert(Mulligan.NotLiquidatable.selector);
        house.liquidate(id);
        setBtc(76_300); // -4.625% -> -$92.5
        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        house.liquidate(id);
        assertGt(usdc.balanceOf(bob), before); // liquidator keeps the remainder
        (,,, bool isOpen,,,,,) = house.positions(id);
        assertFalse(isOpen);
    }

    function testEntryUsesTheWorseOfOracleAndMark() public {
        MockPrecompile(payable(0x0000000000000000000000000000000000000806)).set(BTC, 801_000); // mark $80,100
        uint256 longId = openAs(alice, BTC, true, 10e6, 1);
        uint256 shortId = openAs(bob, BTC, false, 10e6, 1);
        (,,,, uint64 longPx,,,,) = house.positions(longId);
        (,,,, uint64 shortPx,,,,) = house.positions(shortId);
        assertEq(longPx, 80_100e6);
        assertEq(shortPx, 80_000e6);
    }

    function testOnlyTraderCanClose() public {
        uint256 id = openAs(alice, BTC, true, 10e6, 1);
        vm.prank(bob);
        vm.expectRevert(Mulligan.NotYours.selector);
        house.close(id);
    }

    /// Whatever traders do, the contract holds enough USDC for the house plus
    /// every open margin.
    function testSolvency(uint64 move1, uint64 move2, bool side1, bool side2) public {
        uint256 a = openAs(alice, BTC, side1, 300e6, 5);
        uint256 b = openAs(bob, ETH, side2, 200e6, 10);
        setBtc(uint64(bound(move1, 40_000, 160_000)));
        setEth(uint64(bound(move2, 1_250, 5_000)));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        house.close(a);
        (,,, bool bOpen,,, uint128 bMargin,,) = house.positions(b);
        assertGe(usdc.balanceOf(address(house)), house.houseAssets() + (bOpen ? bMargin : 0));
        assertGe(house.houseAssets(), house.reserved());
    }
}
