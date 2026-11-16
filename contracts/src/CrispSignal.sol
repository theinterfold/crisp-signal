// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IE3RefundManager, IInterfold} from "./interfaces/IInterfold.sol";
import {IZKPassportVerifier} from "./interfaces/IZKPassport.sol";
import {PassportRegistry} from "./PassportRegistry.sol";

/// @notice Creates CRISP signalling polls whose electorate is proven with ZKPassport.
/// @dev Each poll is one Interfold E3 running the CRISP program in `CensusMode.ONCHAIN`, with a fresh
///      `PassportRegistry` as its census token, `CreditMode.CONSTANT` and one credit: one vote per
///      registered document. This contract is the E3 requester, so it pays the fee (pulled from the
///      poll creator) and forwards any refund of a failed E3 back to the creator.
///
///      Poll text and options live off-chain under `metadataCid` (IPFS); the number of options is
///      fixed on-chain by the E3, which CRISP enforces on every ballot.
contract CrispSignal {
    using SafeERC20 for IERC20;

    /// @dev `CRISPProgram` round parameters: `(token, minVotingPower, numOptions, creditMode,
    ///      credits, censusMode, votingPowerDivisor)`.
    uint256 internal constant MIN_VOTING_POWER = 1;
    uint8 internal constant CREDIT_MODE_CONSTANT = 0;
    uint256 internal constant CREDITS = 1;
    uint256 internal constant CENSUS_MODE_ONCHAIN = 2;
    uint256 internal constant VOTING_POWER_DIVISOR = 0;

    struct Poll {
        uint256 e3Id;
        PassportRegistry registry;
        address creator;
        IERC20 feeToken;
        uint64 createdAt;
        string metadataCid;
    }

    /// @param metadataCid IPFS CID of the poll's title, description and option labels.
    /// @param numOptions Number of options, 2 to 10 (CRISP's limit).
    /// @param inputWindow Unix seconds `[start, end]` during which ballots are accepted.
    /// @param maxFee The most the creator pays, in fee-token units.
    struct PollRequest {
        string metadataCid;
        uint256 numOptions;
        uint256[2] inputWindow;
        IInterfold.CommitteeSize committeeSize;
        uint8 paramSet;
        bytes computeProviderParams;
        bytes32 expectedCryptoConfigId;
        uint256 maxFee;
        PassportRegistry.Policy policy;
    }

    IInterfold public immutable INTERFOLD;
    address public immutable CRISP_PROGRAM;
    IZKPassportVerifier public immutable ZKPASSPORT_VERIFIER;
    /// @notice The ZKPassport domain of every poll: the host name voters see in the ZKPassport app.
    string public domain;

    Poll[] internal _polls;

    event PollCreated(
        uint256 indexed pollId,
        uint256 indexed e3Id,
        address indexed creator,
        address registry,
        string metadataCid
    );
    event RefundForwarded(uint256 indexed pollId, address indexed creator, uint256 amount);

    error InvalidConfiguration();
    error MissingMetadata();
    error FeeAboveMax(uint256 fee, uint256 maxFee);
    error UnknownPoll(uint256 pollId);
    error NotCreator(address caller);

    constructor(
        IInterfold interfold,
        address crispProgram,
        IZKPassportVerifier zkPassportVerifier,
        string memory domain_
    ) {
        if (
            address(interfold).code.length == 0 || crispProgram.code.length == 0
                || address(zkPassportVerifier).code.length == 0 || bytes(domain_).length == 0
        ) revert InvalidConfiguration();
        INTERFOLD = interfold;
        CRISP_PROGRAM = crispProgram;
        ZKPASSPORT_VERIFIER = zkPassportVerifier;
        domain = domain_;
    }

    /// @notice Deploys the poll's registry and requests its E3. The caller must have approved this
    ///         contract for the fee (`getE3Quote`) in Interfold's fee token.
    function createPoll(PollRequest calldata r) external returns (uint256 pollId, uint256 e3Id) {
        if (bytes(r.metadataCid).length == 0) revert MissingMetadata();

        PassportRegistry registry = new PassportRegistry(ZKPASSPORT_VERIFIER, domain, r.policy);
        IERC20 feeToken = INTERFOLD.feeToken();
        IInterfold.E3RequestParams memory request = IInterfold.E3RequestParams({
            committeeSize: r.committeeSize,
            inputWindow: r.inputWindow,
            e3Program: CRISP_PROGRAM,
            paramSet: r.paramSet,
            computeProviderParams: r.computeProviderParams,
            customParams: abi.encode(
                address(registry),
                MIN_VOTING_POWER,
                r.numOptions,
                CREDIT_MODE_CONSTANT,
                CREDITS,
                CENSUS_MODE_ONCHAIN,
                VOTING_POWER_DIVISOR
            ),
            expectedFeeToken: feeToken,
            expectedCryptoConfigId: r.expectedCryptoConfigId,
            maxFee: r.maxFee
        });

        uint256 fee = INTERFOLD.getE3Quote(request);
        if (fee > r.maxFee) revert FeeAboveMax(fee, r.maxFee);
        request.maxFee = fee;

        feeToken.safeTransferFrom(msg.sender, address(this), fee);
        feeToken.forceApprove(address(INTERFOLD), fee);
        (e3Id,) = INTERFOLD.request(request);
        feeToken.forceApprove(address(INTERFOLD), 0);

        pollId = _polls.length;
        _polls.push(Poll(e3Id, registry, msg.sender, feeToken, uint64(block.timestamp), r.metadataCid));
        emit PollCreated(pollId, e3Id, msg.sender, address(registry), r.metadataCid);
    }

    /// @notice Claims the requester refund of a failed poll and forwards it to the poll's creator.
    function claimRefund(uint256 pollId) external returns (uint256 amount) {
        Poll storage poll = _poll(pollId);
        if (msg.sender != poll.creator) revert NotCreator(msg.sender);
        uint256 before = poll.feeToken.balanceOf(address(this));
        IE3RefundManager(INTERFOLD.e3RefundManager()).claimRequesterRefund(poll.e3Id);
        amount = poll.feeToken.balanceOf(address(this)) - before;
        poll.feeToken.safeTransfer(poll.creator, amount);
        emit RefundForwarded(pollId, poll.creator, amount);
    }

    function pollCount() external view returns (uint256) {
        return _polls.length;
    }

    function getPoll(uint256 pollId) external view returns (Poll memory) {
        return _poll(pollId);
    }

    /// @notice A page of polls, newest first, clamped to the start of the list.
    /// @param before The page ends just below this poll id (pass `pollCount()` for the newest page).
    function getPolls(uint256 before, uint256 count)
        external
        view
        returns (uint256[] memory ids, Poll[] memory page)
    {
        uint256 end = before > _polls.length ? _polls.length : before;
        uint256 n = count > end ? end : count;
        ids = new uint256[](n);
        page = new Poll[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = end - 1 - i;
            page[i] = _polls[end - 1 - i];
        }
    }

    function _poll(uint256 pollId) internal view returns (Poll storage) {
        if (pollId >= _polls.length) revert UnknownPoll(pollId);
        return _polls[pollId];
    }
}
