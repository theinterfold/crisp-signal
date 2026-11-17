// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CrispSignalAztec} from "../src/CrispSignalAztec.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";
import {MockFeeToken, MockInterfold} from "./mocks/MockInterfold.sol";

contract CrispSignalAztecTest is Test {
    MockInterfold internal interfold;
    MockFeeToken internal token;
    CrispSignalAztec internal board;
    address internal creator = makeAddr("creator");

    function setUp() public {
        interfold = new MockInterfold();
        token = interfold.TOKEN();
        // The mock is both the coordinator and the program; any contract with `interfold()` returning it works.
        board = new CrispSignalAztec(IInterfold(address(interfold)), address(interfold));
        token.mint(creator, 1_000e6);
    }

    function _request(uint256 maxFee) internal view returns (CrispSignalAztec.PollRequest memory r) {
        r.metadataCid = "bafkreidemo";
        r.numOptions = 3;
        r.inputWindow = [block.timestamp + 3600, block.timestamp + 90_000];
        r.committeeSize = IInterfold.CommitteeSize.Micro;
        r.paramSet = 0;
        r.computeProviderParams = bytes('{"name":"OpenVM"}');
        r.expectedCryptoConfigId = keccak256("config");
        r.minAge = 18;
        r.allowMockDocuments = true;
        r.maxFee = maxFee;
    }

    function test_createPoll_requestsTheAztecProgramAndPaysTheFee() public {
        vm.startPrank(creator);
        token.approve(address(board), type(uint256).max);
        (uint256 pollId, uint256 e3Id) = board.createPoll(_request(type(uint256).max));
        vm.stopPrank();

        assertEq(pollId, 0);
        assertEq(e3Id, 1 << 96);
        CrispSignalAztec.Poll memory poll = board.getPoll(pollId);
        assertEq(poll.e3Id, e3Id);
        assertEq(poll.creator, creator);
        assertEq(poll.metadataCid, "bafkreidemo");
        assertEq(address(poll.feeToken), address(token));
        assertEq(poll.createdAt, block.timestamp);

        // The creator paid the quote; nothing stays with the board and no allowance is left behind.
        assertEq(token.balanceOf(creator), 900e6);
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(token.allowance(address(board), address(interfold)), 0);

        IInterfold.E3RequestParams memory sent = interfold.last();
        assertEq(interfold.lastRequester(), address(board));
        assertEq(sent.e3Program, address(interfold));
        assertEq(uint8(sent.committeeSize), uint8(IInterfold.CommitteeSize.Micro));
        assertEq(sent.maxFee, 100e6);
        assertEq(address(sent.expectedFeeToken), address(token));
        assertEq(sent.expectedCryptoConfigId, keccak256("config"));
        assertEq(sent.inputWindow[0], block.timestamp + 3600);
        assertEq(sent.inputWindow[1], block.timestamp + 90_000);

        // `CRISPRemoteProgram._roundConfig` decodes `(numOptions, credits, minAge, allowMockDocuments)`.
        (uint256 numOptions, uint256 credits, uint256 minAge, bool allowMock) =
            abi.decode(sent.customParams, (uint256, uint256, uint256, bool));
        assertEq(numOptions, 3);
        assertEq(credits, 1);
        assertEq(minAge, 18);
        assertTrue(allowMock);
    }

    function test_createPoll_refusesAFeeAboveTheCreatorsCap() public {
        vm.startPrank(creator);
        token.approve(address(board), type(uint256).max);
        CrispSignalAztec.PollRequest memory r = _request(99e6);
        vm.expectRevert(abi.encodeWithSelector(CrispSignalAztec.FeeAboveMax.selector, 100e6, 99e6));
        board.createPoll(r);
        vm.stopPrank();
        assertEq(board.pollCount(), 0);
    }

    function test_createPoll_requiresMetadataAndAnApproval() public {
        vm.startPrank(creator);
        CrispSignalAztec.PollRequest memory r = _request(type(uint256).max);
        vm.expectRevert(); // no allowance
        board.createPoll(r);

        r.metadataCid = "";
        vm.expectRevert(CrispSignalAztec.MissingMetadata.selector);
        board.createPoll(r);
        vm.stopPrank();
    }

    function test_constructor_refusesAProgramOfAnotherInterfold() public {
        // A contract that is no program (no `interfold()`).
        vm.expectRevert();
        new CrispSignalAztec(IInterfold(address(interfold)), address(token));
        vm.expectRevert(CrispSignalAztec.InvalidConfiguration.selector);
        new CrispSignalAztec(IInterfold(address(interfold)), makeAddr("eoa"));
        // A program bound to another Interfold.
        MockInterfold other = new MockInterfold();
        vm.expectRevert(CrispSignalAztec.InvalidConfiguration.selector);
        new CrispSignalAztec(IInterfold(address(interfold)), address(other));
        vm.expectRevert(CrispSignalAztec.InvalidConfiguration.selector);
        new CrispSignalAztec(IInterfold(makeAddr("eoa")), address(interfold));
    }

    function test_getPolls_pagesNewestFirst() public {
        vm.startPrank(creator);
        token.approve(address(board), type(uint256).max);
        for (uint256 i = 0; i < 3; i++) {
            board.createPoll(_request(type(uint256).max));
        }
        vm.stopPrank();

        (uint256[] memory ids, CrispSignalAztec.Poll[] memory page) = board.getPolls(board.pollCount(), 2);
        assertEq(ids.length, 2);
        assertEq(ids[0], 2);
        assertEq(ids[1], 1);
        assertEq(page[0].e3Id, (1 << 96) + 2);

        (ids, page) = board.getPolls(1, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], 0);

        (ids,) = board.getPolls(100, 10);
        assertEq(ids.length, 3);

        vm.expectRevert(abi.encodeWithSelector(CrispSignalAztec.UnknownPoll.selector, 3));
        board.getPoll(3);
    }

    function test_claimRefund_forwardsToTheCreatorOnly() public {
        vm.startPrank(creator);
        token.approve(address(board), type(uint256).max);
        (uint256 pollId,) = board.createPoll(_request(type(uint256).max));
        vm.stopPrank();
        interfold.setRefund(40e6);

        vm.prank(makeAddr("other"));
        vm.expectRevert(abi.encodeWithSelector(CrispSignalAztec.NotCreator.selector, makeAddr("other")));
        board.claimRefund(pollId);

        vm.prank(creator);
        uint256 amount = board.claimRefund(pollId);
        assertEq(amount, 40e6);
        assertEq(token.balanceOf(creator), 940e6);
        assertEq(token.balanceOf(address(board)), 0);
    }
}
