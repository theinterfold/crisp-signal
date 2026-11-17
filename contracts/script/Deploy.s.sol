// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CrispSignalAztec} from "../src/CrispSignalAztec.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";

/// @notice Deploys the poll board against the Sepolia Interfold, the `CRISPAztecProgram` named by
///         `CRISP_AZTEC_PROGRAM` and that program's `ZKPassportRegistrar` named by `ZKPASSPORT_REGISTRAR`
///         (the registrar of the polls that register voters on Ethereum).
///      forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --skip-simulation --private-key $PRIVATE_KEY
contract Deploy is Script {
    /// @dev The running Sepolia deployment (`@interfold/contracts` 0.20.0-dev.3).
    IInterfold internal constant INTERFOLD = IInterfold(0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26);

    function run() external returns (CrispSignalAztec board) {
        address program = vm.envAddress("CRISP_AZTEC_PROGRAM");
        address registrar = vm.envAddress("ZKPASSPORT_REGISTRAR");

        vm.startBroadcast();
        board = new CrispSignalAztec(INTERFOLD, program, registrar);
        vm.stopBroadcast();

        console.log("CrispSignalAztec:", address(board));
    }
}
