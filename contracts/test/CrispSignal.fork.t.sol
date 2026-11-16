// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CrispSignal} from "../src/CrispSignal.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";
import {IZKPassportVerifier} from "../src/interfaces/IZKPassport.sol";

interface ICrispProgram {
    function censusModeOf(uint256 e3Id) external view returns (uint8);
    function votingPowerOf(uint256 e3Id, address slot) external view returns (uint256);
    function getRoundData(uint256 e3Id)
        external
        view
        returns (uint256, bytes32, uint256 numOptions, uint8 creditMode, uint256, uint40);
}

interface IInterfoldViews {
    function getE3(uint256 e3Id) external view returns (IInterfold.E3 memory);
}

/// @dev `BfvProtocol.INSECURE_CONFIG_ID` of `@interfold/contracts` 0.20.0-dev.3: the circuit
///      configuration Interfold binds to param set 0.
library CryptoConfig {
    bytes32 internal constant INSECURE = 0x92c8b373eb72cc3600a5a818cf8599db16e618ee3ece2dadd14f8608c1a43ac9;
}

interface IFaucet {
    function faucet() external;
}

/// @notice Runs against the live Sepolia deployment. Skipped unless SEPOLIA_RPC_URL is set.
contract CrispSignalForkTest is Test {
    IInterfold internal constant INTERFOLD = IInterfold(0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26);
    address internal constant CRISP_PROGRAM = 0x25Df8D3C04D67efb6198E215963d19a8d119ADFF;
    IZKPassportVerifier internal constant ZKPASSPORT =
        IZKPassportVerifier(0x1D000001000EFD9a6371f4d90bB8920D5431c0D8);
    IFaucet internal constant FAUCET = IFaucet(0x1B4340A65BB669267BF5DE37385B139987C3F09c);

    CrispSignal internal board;
    address internal creator = makeAddr("creator");

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);
        board = new CrispSignal(INTERFOLD, CRISP_PROGRAM, ZKPASSPORT, "signal.example");
        vm.prank(creator);
        FAUCET.faucet();
    }

    function _request(uint256 maxFee) internal view returns (CrispSignal.PollRequest memory r) {
        string[] memory countries = new string[](2);
        countries[0] = "DEU";
        countries[1] = "FRA";
        r.metadataCid = "bafkreidemo";
        r.numOptions = 3;
        r.inputWindow = [block.timestamp + 600, block.timestamp + 4200];
        r.committeeSize = IInterfold.CommitteeSize.Minimum;
        r.paramSet = 0;
        r.computeProviderParams = bytes('{"name":"OpenVM","parallel":false,"batch_size":4}');
        r.expectedCryptoConfigId = CryptoConfig.INSECURE;
        r.maxFee = maxFee;
        r.policy = PassportRegistry.Policy({
            minAge: 18,
            nationalityRule: PassportRegistry.NationalityRule.ALLOW,
            countries: countries,
            faceMatch: false,
            devMode: true
        });
    }

    function test_createPoll_requestsAnOnchainCensusCrispRound() public {
        IERC20 fee = INTERFOLD.feeToken();
        uint256 balanceBefore = fee.balanceOf(creator);

        vm.startPrank(creator);
        fee.approve(address(board), type(uint256).max);
        (uint256 pollId, uint256 e3Id) = board.createPoll(_request(type(uint256).max));
        vm.stopPrank();

        CrispSignal.Poll memory poll = board.getPoll(pollId);
        assertEq(poll.e3Id, e3Id);
        assertEq(poll.creator, creator);
        assertEq(poll.metadataCid, "bafkreidemo");

        // The creator paid the quoted fee; nothing is left with the board.
        assertGt(balanceBefore - fee.balanceOf(creator), 0);
        assertEq(fee.balanceOf(address(board)), 0);

        IInterfold.E3 memory e3 = IInterfoldViews(address(INTERFOLD)).getE3(e3Id);
        assertEq(e3.e3Program, CRISP_PROGRAM);
        assertEq(e3.requester, address(board));

        ICrispProgram program = ICrispProgram(CRISP_PROGRAM);
        assertEq(program.censusModeOf(e3Id), 2);
        (,, uint256 numOptions, uint8 creditMode,,) = program.getRoundData(e3Id);
        assertEq(numOptions, 3);
        assertEq(creditMode, 0);

        // The poll's registry is the census token, and every ballot carries exactly one credit.
        (address token, uint256 minVotingPower,,, uint256 credits,,) =
            abi.decode(e3.customParams, (address, uint256, uint256, uint8, uint256, uint256, uint256));
        assertEq(token, address(poll.registry));
        assertEq(minVotingPower, 1);
        assertEq(credits, 1);
        assertEq(program.votingPowerOf(e3Id, makeAddr("voter")), 1);

        (uint256[] memory ids,) = board.getPolls(board.pollCount(), 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], pollId);
    }

    function test_createPoll_refusesAFeeAboveTheCreatorsCap() public {
        IERC20 fee = INTERFOLD.feeToken();
        vm.startPrank(creator);
        fee.approve(address(board), type(uint256).max);
        CrispSignal.PollRequest memory r = _request(1);
        vm.expectPartialRevert(CrispSignal.FeeAboveMax.selector);
        board.createPoll(r);
        vm.stopPrank();
    }
}
