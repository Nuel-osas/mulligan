// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Mulligan: perps where a loss buys you a piece of the house.
/// @notice Traders trade USDC-margined perps against a shared house, priced
/// straight from HyperCore's oracle and mark precompiles. The house is the
/// MULL token itself: LPs mint it at NAV, it earns every fee and every trader
/// loss, and it pays every winner.
///
/// Three rules fix what loss-mining venues get wrong:
///  1. A realized loss returns REBATE_BPS of itself as MULL at NAV, only if the
///     position was held MIN_HOLD. The rebate is paid out of the loss the house
///     just booked, so even a perfectly hedged farmer leaves the house with at
///     least half of every loss plus all fees. Nothing is printed unbacked.
///  2. Each position's maximum profit is reserved when it opens, and LPs can
///     only withdraw unreserved assets. Winners are always paid at once.
///  3. No owner, no upgrades, no admin keys. Every parameter is immutable.
contract Mulligan is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Market {
        bool listed;
        uint8 szDecimals; // HyperCore size decimals: price = raw * 10^szDecimals (6dp)
        uint16 maxLeverage;
    }

    struct Position {
        address trader;
        uint32 market;
        bool isLong;
        bool open;
        uint64 entryPx; // 6dp USD
        uint64 openedAt;
        uint128 margin; // USDC 6dp
        uint128 notional; // USDC 6dp
        uint128 maxProfit; // reserved from the house
    }

    address public constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address public constant ORACLE_PX = 0x0000000000000000000000000000000000000807;

    uint256 public constant FEE_BPS = 10; // 0.10% of notional, open and close
    uint256 public constant REBATE_BPS = 5_000; // 50% of a realized loss back as MULL
    uint256 public constant MIN_HOLD = 10 minutes;
    uint256 public constant MAX_PROFIT_X = 9; // profit capped at 9x margin
    uint256 public constant LIQ_BPS = 9_000; // liquidatable at 90% margin loss
    uint256 public constant MIN_MARGIN = 1e6; // $1

    IERC20 public immutable usdc;

    /// USDC the house owns (excludes traders' open margin).
    uint256 public houseAssets;
    /// Sum of maxProfit over open positions: never withdrawable.
    uint256 public reserved;
    uint256 public nextId;

    mapping(uint32 => Market) public markets;
    mapping(uint256 => Position) public positions;

    event Deposit(address indexed lp, uint256 usdc, uint256 shares);
    event Withdraw(address indexed lp, uint256 usdc, uint256 shares);
    event Opened(uint256 indexed id, address indexed trader, uint32 market, bool isLong, uint256 margin, uint256 notional, uint256 entryPx);
    event Closed(uint256 indexed id, address indexed trader, uint256 exitPx, int256 pnl, uint256 paid, bool liquidated);
    event Mulligan(uint256 indexed id, address indexed trader, uint256 loss, uint256 rebateUsd, uint256 shares);

    error NotListed();
    error BadLeverage();
    error MarginTooSmall();
    error HouseTooSmall();
    error NotYours();
    error NotOpen();
    error NotLiquidatable();
    error Reserved();
    error OracleFailed();

    constructor(IERC20 _usdc, uint32[] memory ids, uint8[] memory szDecimals, uint16[] memory maxLev)
        ERC20("Mulligan House", "MULL")
    {
        usdc = _usdc;
        for (uint256 i; i < ids.length; i++) {
            markets[ids[i]] = Market(true, szDecimals[i], maxLev[i]);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------- house

    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        uint256 supply = totalSupply();
        shares = supply == 0 ? amount : (amount * supply) / houseAssets;
        houseAssets += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, shares);
        emit Deposit(msg.sender, amount, shares);
    }

    /// Burn MULL for USDC at NAV, out of assets not reserved for open winners.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        amount = (shares * houseAssets) / totalSupply();
        if (houseAssets - amount < reserved) revert Reserved();
        houseAssets -= amount;
        _burn(msg.sender, shares);
        usdc.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount, shares);
    }

    /// USDC per MULL, 6dp.
    function nav() public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 1e6 : (houseAssets * 1e6) / supply;
    }

    function freeLiquidity() public view returns (uint256) {
        return houseAssets - reserved;
    }

    // -------------------------------------------------------------- trading

    function open(uint32 market, bool isLong, uint256 margin, uint256 leverage)
        external
        nonReentrant
        returns (uint256 id)
    {
        Market memory m = markets[market];
        if (!m.listed) revert NotListed();
        if (leverage == 0 || leverage > m.maxLeverage) revert BadLeverage();
        if (margin < MIN_MARGIN) revert MarginTooSmall();

        uint256 notional = margin * leverage;
        uint256 fee = (notional * FEE_BPS) / 10_000;
        uint256 maxProfit = margin * MAX_PROFIT_X;
        if (freeLiquidity() < maxProfit) revert HouseTooSmall();

        // Worse of oracle and mark for the trader: no latency arbitrage.
        (uint256 oracle, uint256 mark) = prices(market);
        uint256 px = isLong ? _max(oracle, mark) : _min(oracle, mark);

        houseAssets += fee;
        reserved += maxProfit;
        id = nextId++;
        positions[id] = Position({
            trader: msg.sender,
            market: market,
            isLong: isLong,
            open: true,
            entryPx: uint64(px),
            openedAt: uint64(block.timestamp),
            margin: uint128(margin),
            notional: uint128(notional),
            maxProfit: uint128(maxProfit)
        });
        usdc.safeTransferFrom(msg.sender, address(this), margin + fee);
        emit Opened(id, msg.sender, market, isLong, margin, notional, px);
    }

    function close(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        if (p.trader != msg.sender) revert NotYours();
        if (!p.open) revert NotOpen();
        _settle(id, _exitPx(p), false);
    }

    /// Anyone can liquidate at 90% margin loss; the liquidator keeps what is left.
    function liquidate(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        if (!p.open) revert NotOpen();
        uint256 px = _exitPx(p);
        int256 pnl = pnlAt(id, px);
        if (pnl > -int256(uint256(p.margin) * LIQ_BPS / 10_000)) revert NotLiquidatable();
        _settle(id, px, true);
    }

    function _settle(uint256 id, uint256 px, bool liquidated) internal {
        Position storage p = positions[id];
        p.open = false;
        reserved -= p.maxProfit;

        int256 pnl = pnlAt(id, px);
        uint256 fee = (uint256(p.notional) * FEE_BPS) / 10_000;
        uint256 loss;
        uint256 pay;
        if (pnl >= 0) {
            uint256 gross = uint256(p.margin) + uint256(pnl);
            uint256 f = fee < gross ? fee : gross;
            pay = gross - f;
            houseAssets = houseAssets - uint256(pnl) + f;
        } else {
            loss = uint256(-pnl);
            uint256 left = p.margin - loss;
            uint256 f = fee < left ? fee : left;
            pay = left - f;
            houseAssets += loss + f;
        }

        address to = liquidated ? msg.sender : p.trader;
        if (pay > 0) usdc.safeTransfer(to, pay);
        emit Closed(id, p.trader, px, pnl, pay, liquidated);

        // The mulligan: part of the loss comes back as a share of the house that
        // took it, priced at NAV after the house booked the loss.
        if (loss > 0 && block.timestamp - p.openedAt >= MIN_HOLD) {
            uint256 rebate = (loss * REBATE_BPS) / 10_000;
            // Value-preserving mint: after minting, shares * NAV == rebate.
            uint256 shares = (rebate * totalSupply()) / (houseAssets - rebate);
            _mint(p.trader, shares);
            emit Mulligan(id, p.trader, loss, rebate, shares);
        }
    }

    // ---------------------------------------------------------------- views

    /// PnL in USDC (6dp) at `px`, profit capped at maxProfit, loss at margin.
    function pnlAt(uint256 id, uint256 px) public view returns (int256) {
        Position storage p = positions[id];
        uint256 entry = p.entryPx;
        bool up = px >= entry;
        uint256 move = up ? px - entry : entry - px;
        uint256 raw = (uint256(p.notional) * move) / entry;
        bool win = up == p.isLong;
        if (win) return int256(raw > p.maxProfit ? uint256(p.maxProfit) : raw);
        return -int256(raw > p.margin ? uint256(p.margin) : raw);
    }

    /// Current PnL if closed now, and whether it can be liquidated.
    function preview(uint256 id) external view returns (int256 pnl, uint256 exitPx, bool liquidatable, bool earnsRebate) {
        Position storage p = positions[id];
        exitPx = _exitPx(p);
        pnl = pnlAt(id, exitPx);
        liquidatable = pnl <= -int256(uint256(p.margin) * LIQ_BPS / 10_000);
        earnsRebate = block.timestamp - p.openedAt >= MIN_HOLD;
    }

    /// HyperCore oracle and mark prices for a perp, as 6dp USD.
    function prices(uint32 market) public view returns (uint256 oracle, uint256 mark) {
        Market memory m = markets[market];
        if (!m.listed) revert NotListed();
        uint256 scale = 10 ** m.szDecimals;
        oracle = _read(ORACLE_PX, market) * scale;
        mark = _read(MARK_PX, market) * scale;
    }

    function _read(address precompile, uint32 market) internal view returns (uint256) {
        (bool ok, bytes memory out) = precompile.staticcall(abi.encode(market));
        if (!ok || out.length < 32) revert OracleFailed();
        return abi.decode(out, (uint64));
    }

    function _exitPx(Position storage p) internal view returns (uint256) {
        (uint256 oracle, uint256 mark) = prices(p.market);
        return p.isLong ? _min(oracle, mark) : _max(oracle, mark);
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
