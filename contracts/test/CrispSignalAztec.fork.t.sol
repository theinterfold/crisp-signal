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

interface ICrispAztecRules {
    function getRules(uint256 e3Id)
        external
        view
        returns (
            address registrar,
            bool allowMockDocuments,
            uint8 nationalityMode,
            uint256 minAge,
            bytes32 countriesHash,
            uint256 inputEnd
        );
}

interface IInterfoldViews {
    function getE3(uint256 e3Id) external view returns (IInterfold.E3 memory);
}

interface IFaucet {
    function faucet() external;
}

/// @notice Runs against the live Sepolia deployment. Skipped unless SEPOLIA_RPC_URL, CRISP_AZTEC_PROGRAM (the
///         deployed `CRISPAztecProgram`) and ZKPASSPORT_REGISTRAR (its `ZKPassportRegistrar`) are set.
contract CrispSignalAztecForkTest is Test {
    IInterfold internal constant INTERFOLD = IInterfold(0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26);
    IFaucet internal constant FAUCET = IFaucet(0x1B4340A65BB669267BF5DE37385B139987C3F09c);
    /// @dev `BfvProtocol.INSECURE_CONFIG_ID` of `@interfold/contracts` 0.20.0-dev.3: param set 0.
    bytes32 internal constant INSECURE = 0x92c8b373eb72cc3600a5a818cf8599db16e618ee3ece2dadd14f8608c1a43ac9;

    address internal program;
    address internal registrar;
    CrispSignalAztec internal board;
    address internal creator = makeAddr("creator");

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        program = vm.envOr("CRISP_AZTEC_PROGRAM", address(0));
        registrar = vm.envOr("ZKPASSPORT_REGISTRAR", address(0));
        vm.skip(bytes(rpc).length == 0 || program == address(0) || registrar == address(0));
        vm.createSelectFork(rpc);
        board = new CrispSignalAztec(INTERFOLD, program, registrar);
        vm.prank(creator);
        FAUCET.faucet();
    }

    function _request(bool l1Registration) internal view returns (CrispSignalAztec.PollRequest memory r) {
        r.metadataCid = "bafkreidemo";
        r.numOptions = 3;
        // Key setup worst case plus the key deadline: start well after the request.
        r.inputWindow = [block.timestamp + 6 hours, block.timestamp + 6 hours + 1 days];
        r.computeProviderParams = bytes('{"name":"OpenVM","parallel":false,"batch_size":4}');
        r.expectedCryptoConfigId = INSECURE;
        r.minAge = 18;
        r.allowMockDocuments = true;
        r.l1Registration = l1Registration;
        r.maxFee = type(uint256).max;
    }

    function _create(CrispSignalAztec.PollRequest memory r) internal returns (uint256 pollId, uint256 e3Id) {
        IERC20 fee = INTERFOLD.feeToken();
        uint256 before = fee.balanceOf(creator);
        vm.startPrank(creator);
        fee.approve(address(board), type(uint256).max);
        (pollId, e3Id) = board.createPoll(r);
        vm.stopPrank();

        assertEq(board.getPoll(pollId).e3Id, e3Id);
        assertGt(before - fee.balanceOf(creator), 0);
        assertEq(fee.balanceOf(address(board)), 0);
        assertEq(IInterfoldViews(address(INTERFOLD)).getE3(e3Id).e3Program, program);
        assertEq(IInterfoldViews(address(INTERFOLD)).getE3(e3Id).requester, address(board));
    }

    function _params(uint256 e3Id)
        internal
        view
        returns (address reg, uint8 mode, string[] memory countries, uint256 commitment)
    {
        bytes memory custom = IInterfoldViews(address(INTERFOLD)).getE3(e3Id).customParams;
        (
            uint256 numOptions,
            uint256 credits,
            uint256 minAge,
            bool allowMock,
            address r,
            uint8 m,
            string[] memory c,
            uint256 n
        ) = abi.decode(custom, (uint256, uint256, uint256, bool, address, uint8, string[], uint256));
        assertEq(numOptions, 3);
        assertEq(credits, 1);
        assertEq(minAge, 18);
        assertTrue(allowMock);
        return (r, m, c, n);
    }

    /// @dev The program stored what the board passed: registrar, rule shape and the hash of the country list.
    function _assertRules(uint256 e3Id, address reg, uint8 mode, string[] memory countries) internal view {
        (address storedRegistrar, bool allowMock, uint8 storedMode, uint256 minAge, bytes32 countriesHash,) =
            ICrispAztecRules(program).getRules(e3Id);
        assertEq(storedRegistrar, reg);
        assertTrue(allowMock);
        assertEq(storedMode, mode);
        assertEq(minAge, 18);
        assertEq(countriesHash, keccak256(abi.encode(countries)));
    }

    function _assertOpened(uint256 e3Id) internal view {
        (, uint256 roundOptions, uint256 limit,,,,) = ICrispAztecRound(program).getRound(e3Id);
        assertEq(roundOptions, 3);
        assertGt(limit, 0);
        assertGt(bytes(ICrispAztecRound(program).scopeOf(e3Id)).length, 0);
    }

    function test_createPoll_opensAnAztecPathRoundOnTheProgram() public {
        (, uint256 e3Id) = _create(_request(false));
        (address reg, uint8 mode, string[] memory countries, uint256 commitment) = _params(e3Id);
        assertEq(reg, address(0));
        assertEq(mode, 0);
        assertEq(countries.length, 0);
        assertEq(commitment, 0);
        _assertRules(e3Id, address(0), 0, countries);
        _assertOpened(e3Id);
    }

    function test_createPoll_opensAnAztecPathRoundWithANationalityRule() public {
        CrispSignalAztec.PollRequest memory r = _request(false);
        r.nationalityMode = 1;
        r.countries = new string[](2);
        r.countries[0] = "DEU";
        r.countries[1] = "FRA";
        // The program cannot recompute ZKPassport's commitment of the list; the app does (and refuses a mismatch).
        r.nationalityCommitment = 1234;
        (, uint256 e3Id) = _create(r);
        (address reg, uint8 mode, string[] memory countries, uint256 commitment) = _params(e3Id);
        assertEq(reg, address(0));
        assertEq(mode, 1);
        assertEq(countries.length, 2);
        assertEq(commitment, 1234);
        _assertRules(e3Id, address(0), 1, countries);
        _assertOpened(e3Id);
    }

    function test_createPoll_opensAnL1PathRoundBoundToTheRegistrar() public {
        CrispSignalAztec.PollRequest memory r = _request(true);
        r.nationalityMode = 2;
        r.countries = new string[](1);
        r.countries[0] = "ZKR";
        (, uint256 e3Id) = _create(r);
        (address reg, uint8 mode, string[] memory countries, uint256 commitment) = _params(e3Id);
        assertEq(reg, registrar);
        assertEq(mode, 2);
        assertEq(countries.length, 1);
        assertEq(commitment, 0);
        _assertRules(e3Id, registrar, 2, countries);
        _assertOpened(e3Id);
    }
}
