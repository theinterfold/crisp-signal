// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IZKPassportHelper, IZKPassportVerifier} from "../../src/interfaces/IZKPassport.sol";

/// @dev Answers like ZKPassport's helper from values a test sets. `committedInputs` is ignored.
contract MockZKPassportHelper is IZKPassportHelper {
    BoundData internal _bound;
    uint8 public provenMinAge;
    string[] internal _inList;
    string[] internal _outList;
    bool public faceMatched;
    bool public nonSalted = true;

    function setBound(address sender, uint256 chainId) external {
        _bound = BoundData(sender, chainId, "");
    }

    function setMinAge(uint8 age) external {
        provenMinAge = age;
    }

    function setInList(string[] calldata list) external {
        _inList = list;
    }

    function setOutList(string[] calldata list) external {
        _outList = list;
    }

    function setFaceMatched(bool value) external {
        faceMatched = value;
    }

    function setNonSalted(bool value) external {
        nonSalted = value;
    }

    function getBoundData(bytes calldata) external view returns (BoundData memory) {
        return _bound;
    }

    function isAgeAboveOrEqual(uint8 minAge, bytes calldata) external view returns (bool) {
        return provenMinAge != 0 && provenMinAge == minAge;
    }

    function isNationalityIn(string[] memory list, bytes calldata) external view returns (bool) {
        return _same(list, _inList);
    }

    function isNationalityOut(string[] memory list, bytes calldata) external view returns (bool) {
        return _same(list, _outList);
    }

    function isFaceMatchVerified(FaceMatchMode mode, OS, bytes calldata) external view returns (bool) {
        return faceMatched && mode == FaceMatchMode.STRICT;
    }

    function enforceNullifierType(NullifierType expected, bytes32[] calldata) external view {
        require(nonSalted && expected == NullifierType.NON_SALTED_NULLIFIER, "Invalid nullifier type");
    }

    function _same(string[] memory a, string[] memory b) internal pure returns (bool) {
        if (a.length != b.length || a.length == 0) return false;
        for (uint256 i = 0; i < a.length; i++) {
            if (keccak256(bytes(a[i])) != keccak256(bytes(b[i]))) return false;
        }
        return true;
    }
}

/// @dev Verifies whatever a test sets and records the service config it was called with.
contract MockZKPassportVerifier is IZKPassportVerifier {
    MockZKPassportHelper public immutable HELPER = new MockZKPassportHelper();
    bool public valid = true;
    bytes32 public identifier = keccak256("document-1");
    ServiceConfig public lastServiceConfig;

    function setValid(bool value) external {
        valid = value;
    }

    function setIdentifier(bytes32 value) external {
        identifier = value;
    }

    function verify(ProofVerificationParams calldata params)
        external
        returns (bool, bytes32, IZKPassportHelper)
    {
        lastServiceConfig = params.serviceConfig;
        return (valid, identifier, HELPER);
    }
}
