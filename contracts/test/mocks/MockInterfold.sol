// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInterfold} from "../../src/interfaces/IInterfold.sol";

contract MockFeeToken is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Stands in for the Interfold coordinator and for `CRISPAztecProgram`: pulls the quoted fee and records
///      the last request.
contract MockInterfold {
    MockFeeToken public immutable TOKEN;
    uint256 public fee = 100e6;
    uint256 public nextE3Id = 1 << 96;
    uint256 public refund;

    IInterfold.E3RequestParams internal _last;
    address public lastRequester;

    constructor() {
        TOKEN = new MockFeeToken();
    }

    /// @dev `CRISPAztecProgram.interfold()`: the mock plays both roles.
    function interfold() external view returns (address) {
        return address(this);
    }

    function setFee(uint256 value) external {
        fee = value;
    }

    function setRefund(uint256 value) external {
        refund = value;
    }

    function feeToken() external view returns (IERC20) {
        return TOKEN;
    }

    function e3RefundManager() external view returns (address) {
        return address(this);
    }

    function getE3Quote(IInterfold.E3RequestParams calldata) external view returns (uint256) {
        return fee;
    }

    function request(IInterfold.E3RequestParams calldata params)
        external
        returns (uint256 e3Id, IInterfold.E3 memory e3)
    {
        require(params.maxFee == fee, "maxFee must be the quote");
        require(TOKEN.transferFrom(msg.sender, address(this), fee), "transfer");
        _last = params;
        lastRequester = msg.sender;
        e3Id = nextE3Id++;
        e3.requester = msg.sender;
    }

    function last() external view returns (IInterfold.E3RequestParams memory) {
        return _last;
    }

    function claimRequesterRefund(uint256) external returns (uint256) {
        TOKEN.mint(msg.sender, refund);
        return refund;
    }
}

/// @dev Stands in for `ZKPassportRegistrar`: the board only reads the program it is bound to.
contract MockRegistrar {
    address public immutable program;

    constructor(address program_) {
        program = program_;
    }
}
