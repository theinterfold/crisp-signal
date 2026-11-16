// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CrispSignal} from "../src/CrispSignal.sol";
import {IInterfold} from "../src/interfaces/IInterfold.sol";
import {IZKPassportVerifier} from "../src/interfaces/IZKPassport.sol";

/// @notice Deploys the poll board against the running Sepolia Interfold + CRISP deployment.
/// @dev ZKPASSPORT_DOMAIN must be the host name the app is served from: ZKPassport shows it to the
///      voter and every identifier depends on it, so it cannot change after deployment.
///      forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    /// @dev The running Sepolia deployment (`@interfold/contracts` 0.20.0-dev.3, `@crisp-e3/sdk` 0.28.1).
    IInterfold internal constant INTERFOLD = IInterfold(0xb35EE9ed8BE5967daabBA8c2e817C52D0b57ac26);
    address internal constant CRISP_PROGRAM = 0x25Df8D3C04D67efb6198E215963d19a8d119ADFF;
    IZKPassportVerifier internal constant ZKPASSPORT =
        IZKPassportVerifier(0x1D000001000EFD9a6371f4d90bB8920D5431c0D8);

    function run() external returns (CrispSignal board) {
        string memory domain = vm.envString("ZKPASSPORT_DOMAIN");

        vm.startBroadcast();
        board = new CrispSignal(INTERFOLD, CRISP_PROGRAM, ZKPASSPORT, domain);
        vm.stopBroadcast();

        console.log("CrispSignal:", address(board));
    }
}
