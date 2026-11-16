// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IZKPassportHelper, IZKPassportVerifier} from "./interfaces/IZKPassport.sol";

/// @notice The electorate of one CRISP Signal poll: one entry per passport or ID card that proved
///         the poll's eligibility policy with ZKPassport.
/// @dev Serves the `IVotesToken.getPastVotes` surface `CRISPProgram` reads in `CensusMode.ONCHAIN`:
///      a registered account has power 1, anyone else 0. With `CreditMode.CONSTANT` and credits of
///      1 that is exactly one vote per document.
///
///      The scope of every proof is this contract's address, so a document's identifier differs per
///      poll: registrations cannot be linked across polls, and one document registers once per poll.
///      The identifier belongs to a document, not a person: a person holding two documents (say a
///      passport and an ID card) can register twice.
///
///      `getPastVotes` ignores the timepoint, as `SelfRegistry` does, so a voter can register while
///      the poll is open. The round's snapshot is taken in the request transaction, before anyone
///      could register. Registration is permanent and the list is append-only, so mask submitters
///      can draw targets from stable indices.
contract PassportRegistry {
    enum NationalityRule {
        ANY,
        ALLOW,
        DENY
    }

    /// @notice What a document must prove to join the electorate.
    /// @param minAge Minimum age in years; 0 disables the check.
    /// @param nationalityRule Whether `countries` lists the only accepted or the refused nationalities.
    /// @param countries ISO 3166-1 alpha-3 codes, strictly ascending; empty when the rule is `ANY`.
    /// @param faceMatch Whether the proof must carry a strict FaceMatch (liveness) check.
    /// @param devMode Whether ZKPassport mock documents are accepted. Demo use only: anyone can mint
    ///        unlimited mock identities.
    struct Policy {
        uint8 minAge;
        NationalityRule nationalityRule;
        string[] countries;
        bool faceMatch;
        bool devMode;
    }

    /// @notice The maximum age of a proof when it is registered.
    uint256 public constant PROOF_VALIDITY = 7 days;
    /// @dev ZKPassport commits country lists into 600 bytes: 200 alpha-3 codes.
    uint256 internal constant MAX_COUNTRIES = 200;

    IZKPassportVerifier public immutable ROOT_VERIFIER;
    /// @notice The host name ZKPassport shows the voter, and part of every identifier.
    string public domain;
    /// @notice The ZKPassport service scope: `crisp-signal-<this address>`.
    string public scope;
    Policy internal _policy;

    address[] private _registrants;
    mapping(address account => bool) public isRegistered;
    /// @notice The account each document identifier registered.
    mapping(bytes32 identifier => address account) public accountOf;

    event Registered(address indexed account, uint256 index);

    error InvalidPolicy();
    error InvalidProof();
    error MissingIdentifier();
    error UnexpectedNullifierType();
    error WrongBinding(address senderAddress, uint256 chainId);
    error AgeNotProven(uint8 minAge);
    error NationalityNotProven();
    error FaceMatchMissing();
    error AlreadyRegistered(address account);
    error DocumentAlreadyRegistered(address account);

    constructor(IZKPassportVerifier rootVerifier, string memory domain_, Policy memory policy_) {
        if (address(rootVerifier).code.length == 0 || bytes(domain_).length == 0) revert InvalidPolicy();
        _checkCountries(policy_);
        ROOT_VERIFIER = rootVerifier;
        domain = domain_;
        scope = string.concat("crisp-signal-", Strings.toHexString(address(this)));
        _policy = policy_;
    }

    /// @notice The eligibility policy.
    function policy() external view returns (Policy memory) {
        return _policy;
    }

    /// @notice Joins the electorate with a ZKPassport `compressed-evm` proof.
    /// @dev The proof must bind the caller's address and this chain. The caller's domain, scope,
    ///      validity window and dev mode are replaced with this poll's, so a proof made for another
    ///      service or poll fails verification.
    /// @param params The output of the SDK's `getSolidityVerifierParameters`.
    function register(IZKPassportVerifier.ProofVerificationParams calldata params) external {
        if (isRegistered[msg.sender]) revert AlreadyRegistered(msg.sender);

        IZKPassportVerifier.ProofVerificationParams memory p = params;
        p.serviceConfig = IZKPassportVerifier.ServiceConfig(PROOF_VALIDITY, domain, scope, _policy.devMode);
        (bool verified, bytes32 identifier, IZKPassportHelper helper) = ROOT_VERIFIER.verify(p);
        if (!verified) revert InvalidProof();
        if (identifier == bytes32(0)) revert MissingIdentifier();

        // A salted and a non-salted identifier of one document differ, so accepting both would let
        // one document register twice. Only non-salted (or, in dev mode, its mock twin) passes.
        try helper.enforceNullifierType(
            IZKPassportHelper.NullifierType.NON_SALTED_NULLIFIER, params.proofVerificationData.publicInputs
        ) {}
        catch {
            revert UnexpectedNullifierType();
        }

        _checkCommittedInputs(helper, params.committedInputs);

        address previous = accountOf[identifier];
        if (previous != address(0)) revert DocumentAlreadyRegistered(previous);

        accountOf[identifier] = msg.sender;
        isRegistered[msg.sender] = true;
        _registrants.push(msg.sender);
        emit Registered(msg.sender, _registrants.length - 1);
    }

    /// @notice The voting power of an account: 1 when registered, 0 otherwise.
    /// @dev The timepoint is ignored; see the contract note.
    function getPastVotes(address account, uint256) external view returns (uint256) {
        return isRegistered[account] ? 1 : 0;
    }

    function totalRegistrants() external view returns (uint256) {
        return _registrants.length;
    }

    function registrantAt(uint256 index) external view returns (address) {
        return _registrants[index];
    }

    /// @notice A page of the registrant list, clamped to its end.
    function registrants(uint256 start, uint256 count) external view returns (address[] memory page) {
        uint256 total = _registrants.length;
        if (start >= total) return new address[](0);
        uint256 end = count > total - start ? total : start + count;
        page = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = _registrants[i];
        }
    }

    function _checkCommittedInputs(IZKPassportHelper helper, bytes calldata committedInputs) internal view {
        IZKPassportHelper.BoundData memory bound = helper.getBoundData(committedInputs);
        if (bound.senderAddress != msg.sender || bound.chainId != block.chainid) {
            revert WrongBinding(bound.senderAddress, bound.chainId);
        }

        Policy storage rules = _policy;
        if (rules.minAge != 0 && !helper.isAgeAboveOrEqual(rules.minAge, committedInputs)) {
            revert AgeNotProven(rules.minAge);
        }
        if (rules.nationalityRule == NationalityRule.ALLOW) {
            if (!helper.isNationalityIn(rules.countries, committedInputs)) revert NationalityNotProven();
        } else if (rules.nationalityRule == NationalityRule.DENY) {
            if (!helper.isNationalityOut(rules.countries, committedInputs)) revert NationalityNotProven();
        }
        if (
            rules.faceMatch
                && !helper.isFaceMatchVerified(
                    IZKPassportHelper.FaceMatchMode.STRICT, IZKPassportHelper.OS.ANY, committedInputs
                )
        ) revert FaceMatchMissing();
    }

    /// @dev ZKPassport compares country lists entry by entry and sorts exclusion lists, so the list
    ///      is kept in one canonical form: upper-case alpha-3 codes, strictly ascending.
    function _checkCountries(Policy memory policy_) internal pure {
        uint256 n = policy_.countries.length;
        if (policy_.nationalityRule == NationalityRule.ANY) {
            if (n != 0) revert InvalidPolicy();
            return;
        }
        if (n == 0 || n > MAX_COUNTRIES) revert InvalidPolicy();
        bytes3 previous;
        for (uint256 i = 0; i < n; i++) {
            bytes memory code = bytes(policy_.countries[i]);
            if (code.length != 3) revert InvalidPolicy();
            for (uint256 j = 0; j < 3; j++) {
                if (code[j] < "A" || code[j] > "Z") revert InvalidPolicy();
            }
            bytes3 current = bytes3(code);
            if (i != 0 && current <= previous) revert InvalidPolicy();
            previous = current;
        }
    }
}
