// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The subset of the Interfold coordinator (`@interfold/contracts` 0.20.0-dev.3) this app calls.
/// @dev Struct layouts must match the deployed coordinator exactly.
interface IInterfold {
    enum CommitteeSize {
        Minimum,
        Micro,
        Small
    }

    struct E3RequestParams {
        CommitteeSize committeeSize;
        uint256[2] inputWindow;
        address e3Program;
        uint8 paramSet;
        bytes computeProviderParams;
        bytes customParams;
        IERC20 expectedFeeToken;
        bytes32 expectedCryptoConfigId;
        uint256 maxFee;
    }

    struct E3 {
        uint256 seed;
        CommitteeSize committeeSize;
        uint256 requestBlock;
        uint256[2] inputWindow;
        bytes32 encryptionSchemeId;
        address e3Program;
        uint8 paramSet;
        bytes customParams;
        address decryptionVerifier;
        address pkVerifier;
        bytes32 committeePublicKey;
        bytes32 ciphertextOutput;
        bytes plaintextOutput;
        address requester;
        bytes32 ciphertextCommitment;
    }

    function request(E3RequestParams calldata requestParams) external returns (uint256 e3Id, E3 memory e3);

    function getE3Quote(E3RequestParams calldata requestParams) external view returns (uint256 fee);

    function feeToken() external view returns (IERC20);

    function e3RefundManager() external view returns (address);
}

/// @notice The requester side of the Interfold refund manager.
interface IE3RefundManager {
    function claimRequesterRefund(uint256 e3Id) external returns (uint256 amount);
}
