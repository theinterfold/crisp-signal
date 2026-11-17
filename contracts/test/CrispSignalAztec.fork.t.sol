// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CrispSignalAztec} from "../src/CrispSignalAztec.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";

interface ICrispAztecRound {
    function scopeOf(uint256 e3Id) external view returns (string memory);
    function getRound(uint256 e3Id)
        external
        view
        returns (bytes32 paramsHash, uint256 numOptions, uint256 inputLimit, bool, bool, uint256, uint256);
}

interface IInterfoldViews {
    function getE3(uint256 e3Id) external view returns (IInterfold.E3 memory);
}

interface IFaucet {
    function faucet() external;
}

/// @notice Runs against the live Sepolia deployment. Skipped unless SEPOLIA_RPC_URL and
///         CRISP_AZTEC_PROGRAM (the deployed `CRISPAztecProgram`) are set.
contract CrispSignalAztecForkTest is Test {
    IInterfold internal constant INTERFOLD = IInterfold(0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26);
    IFaucet internal constant FAUCET = IFaucet(0x1B4340A65BB669267BF5DE37385B139987C3F09c);
    /// @dev `BfvProtocol.INSECURE_CONFIG_ID` of `@interfold/contracts` 0.20.0-dev.3: param set 0.
    bytes32 internal constant INSECURE = 0x92c8b373eb72cc3600a5a818cf8599db16e618ee3ece2dadd14f8608c1a43ac9;

    address internal program;
    CrispSignalAztec internal board;
    address internal creator = makeAddr("creator");

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        program = vm.envOr("CRISP_AZTEC_PROGRAM", address(0));
        vm.skip(bytes(rpc).length == 0 || program == address(0));
        vm.createSelectFork(rpc);
        board = new CrispSignalAztec(INTERFOLD, program);
        vm.prank(creator);
        FAUCET.faucet();
    }

    function test_createPoll_opensAnAztecRoundOnTheProgram() public {
        IERC20 fee = INTERFOLD.feeToken();
        CrispSignalAztec.PollRequest memory r;
        r.metadataCid = "bafkreidemo";
        r.numOptions = 3;
        // Key setup worst case plus the key deadline: start well after the request.
        r.inputWindow = [block.timestamp + 6 hours, block.timestamp + 6 hours + 1 days];
        r.computeProviderParams = bytes('{"name":"OpenVM","parallel":false,"batch_size":4}');
        r.expectedCryptoConfigId = INSECURE;
        r.minAge = 18;
        r.allowMockDocuments = true;
        r.maxFee = type(uint256).max;

        uint256 before = fee.balanceOf(creator);
        vm.startPrank(creator);
        fee.approve(address(board), type(uint256).max);
        (uint256 pollId, uint256 e3Id) = board.createPoll(r);
        vm.stopPrank();

        assertEq(board.getPoll(pollId).e3Id, e3Id);
        assertGt(before - fee.balanceOf(creator), 0);
        assertEq(fee.balanceOf(address(board)), 0);

        IInterfold.E3 memory e3 = IInterfoldViews(address(INTERFOLD)).getE3(e3Id);
        assertEq(e3.e3Program, program);
        assertEq(e3.requester, address(board));
        (uint256 numOptions, uint256 credits, uint256 minAge, bool allowMock) =
            abi.decode(e3.customParams, (uint256, uint256, uint256, bool));
        assertEq(numOptions, 3);
        assertEq(credits, 1);
        assertEq(minAge, 18);
        assertTrue(allowMock);

        (, uint256 roundOptions, uint256 limit,,,,) = ICrispAztecRound(program).getRound(e3Id);
        assertEq(roundOptions, 3);
        assertGt(limit, 0);
        assertGt(bytes(ICrispAztecRound(program).scopeOf(e3Id)).length, 0);
    }
}
