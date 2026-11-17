// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IE3RefundManager, IInterfold} from "./interfaces/IInterfold.sol";

/// @notice The part of `CRISPAztecProgram` the board reads.
interface ICrispAztecProgram {
    function interfold() external view returns (address);
}

/// @notice The part of `ZKPassportRegistrar` the board reads.
interface IZKPassportRegistrar {
    function program() external view returns (address);
}

/// @notice Creates CRISP signalling polls whose ballots are cast on Aztec.
/// @dev Each poll is one Interfold E3 running `CRISPAztecProgram`: eligibility (ZKPassport), the census and
///      the ballots live on Aztec, the committee, the compute and the tally stay on Ethereum. This contract
///      is the E3 requester, so it pays the fee (pulled from the poll creator) and forwards any refund of a
///      failed E3 back to the creator. It is the only L1 transaction a poll needs.
///
///      Poll text and options live off-chain under `metadataCid` (IPFS); the number of options and the
///      eligibility rules (`minAge`, `allowMockDocuments`, the nationality rule and the registration path)
///      are fixed by the E3's custom parameters, which the program checks and the Aztec contract enforces on
///      every registration and ballot.
///
///      Registration is one of two paths, chosen per poll (never both: they would be two uniqueness domains):
///      - Aztec (`l1Registration == false`): the voter's ZKPassport proof is verified on Aztec, which needs a
///        proof the Aztec verifier accepts (circuits proved with bb 6).
///      - L1 (`l1Registration == true`): the proof is verified on Ethereum by this deployment's
///        `ZKPassportRegistrar`, which sends the voter's slot to Aztec through the Inbox. The registrar is fixed
///        by the board, so a creator cannot name a registrar of their own.
contract CrispSignalAztec {
    using SafeERC20 for IERC20;

    /// @dev One credit per registered document: one vote each.
    uint256 internal constant CREDITS = 1;

    struct Poll {
        uint256 e3Id;
        address creator;
        IERC20 feeToken;
        uint64 createdAt;
        string metadataCid;
    }

    /// @param metadataCid IPFS CID of the poll's title, description and option labels.
    /// @param numOptions Number of options, 2 to 10 (CRISP's limit).
    /// @param inputWindow Unix seconds `[start, end]` during which ballots are accepted.
    /// @param minAge Minimum age voters prove with ZKPassport; 0 for none, at most 99.
    /// @param allowMockDocuments Accept ZKPassport mock documents (testing only).
    /// @param l1Registration Register voters on Ethereum with `REGISTRAR` instead of on Aztec.
    /// @param nationalityMode 0 any nationality, 1 only `countries`, 2 all but `countries`.
    /// @param countries ICAO alpha-3 codes (`DEU`), 1 to 200 when `nationalityMode` is not 0, none otherwise.
    /// @param nationalityCommitment Aztec path with a nationality rule: ZKPassport's commitment to `countries`
    ///        (the Aztec verifier checks the proof against it, and Ethereum cannot recompute it); 0 otherwise.
    /// @param maxFee The most the creator pays, in fee-token units.
    struct PollRequest {
        string metadataCid;
        uint256 numOptions;
        uint256[2] inputWindow;
        IInterfold.CommitteeSize committeeSize;
        uint8 paramSet;
        bytes computeProviderParams;
        bytes32 expectedCryptoConfigId;
        uint256 minAge;
        bool allowMockDocuments;
        bool l1Registration;
        uint8 nationalityMode;
        string[] countries;
        uint256 nationalityCommitment;
        uint256 maxFee;
    }

    IInterfold public immutable INTERFOLD;
    address public immutable CRISP_PROGRAM;
    /// @notice The `ZKPassportRegistrar` of the polls that register voters on Ethereum.
    address public immutable REGISTRAR;

    Poll[] internal _polls;

    event PollCreated(
        uint256 indexed pollId, uint256 indexed e3Id, address indexed creator, string metadataCid
    );
    event RefundForwarded(uint256 indexed pollId, address indexed creator, uint256 amount);

    error InvalidConfiguration();
    error MissingMetadata();
    error FeeAboveMax(uint256 fee, uint256 maxFee);
    error UnknownPoll(uint256 pollId);
    error NotCreator(address caller);

    constructor(IInterfold interfold, address crispProgram, address registrar) {
        if (
            address(interfold).code.length == 0 || crispProgram.code.length == 0 || registrar.code.length == 0
                || ICrispAztecProgram(crispProgram).interfold() != address(interfold)
                || IZKPassportRegistrar(registrar).program() != crispProgram
        ) revert InvalidConfiguration();
        INTERFOLD = interfold;
        CRISP_PROGRAM = crispProgram;
        REGISTRAR = registrar;
    }

    /// @notice Requests the poll's E3. The caller must have approved this contract for the fee
    ///         (`getE3Quote`) in Interfold's fee token. The program validates `numOptions`, `minAge`, the
    ///         nationality rule and the timing of `inputWindow`, and opens the round on Aztec within this
    ///         transaction.
    function createPoll(PollRequest calldata r) external returns (uint256 pollId, uint256 e3Id) {
        if (bytes(r.metadataCid).length == 0) revert MissingMetadata();

        IERC20 feeToken = INTERFOLD.feeToken();
        IInterfold.E3RequestParams memory request = IInterfold.E3RequestParams({
            committeeSize: r.committeeSize,
            inputWindow: r.inputWindow,
            e3Program: CRISP_PROGRAM,
            paramSet: r.paramSet,
            computeProviderParams: r.computeProviderParams,
            customParams: abi.encode(
                r.numOptions,
                CREDITS,
                r.minAge,
                r.allowMockDocuments,
                r.l1Registration ? REGISTRAR : address(0),
                r.nationalityMode,
                r.countries,
                r.nationalityCommitment
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
        _polls.push(Poll(e3Id, msg.sender, feeToken, uint64(block.timestamp), r.metadataCid));
        emit PollCreated(pollId, e3Id, msg.sender, r.metadataCid);
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
