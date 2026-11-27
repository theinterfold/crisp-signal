// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CrispSignalAztec} from "../src/CrispSignalAztec.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";

/// @notice Deploys the poll board against the Sepolia Interfold and the `CRISPAztecProgram` named by
///         `CRISP_AZTEC_PROGRAM`.
///      forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --skip-simulation --private-key $PRIVATE_KEY
contract Deploy is Script {
    /// @dev The running Sepolia deployment (`@interfold/contracts` 0.20.0).
    IInterfold internal constant INTERFOLD = IInterfold(0x5611c8aa517FE57D05229Ff94eA37E88b1b8FDDB);

    function run() external returns (CrispSignalAztec board) {
        address program = vm.envAddress("CRISP_AZTEC_PROGRAM");

        vm.startBroadcast();
        board = new CrispSignalAztec(INTERFOLD, program);
        vm.stopBroadcast();

        console.log("CrispSignalAztec:", address(board));
    }
}
