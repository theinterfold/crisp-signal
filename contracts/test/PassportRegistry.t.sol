// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {IZKPassportVerifier} from "../src/interfaces/IZKPassport.sol";
import {MockZKPassportHelper, MockZKPassportVerifier} from "./mocks/MockZKPassport.sol";

contract PassportRegistryTest is Test {
    MockZKPassportVerifier internal verifier;
    MockZKPassportHelper internal helper;
    address internal voter = makeAddr("voter");

    function setUp() public {
        verifier = new MockZKPassportVerifier();
        helper = verifier.HELPER();
        helper.setBound(voter, block.chainid);
    }

    function _policy(PassportRegistry.NationalityRule rule, string[] memory countries)
        internal
        pure
        returns (PassportRegistry.Policy memory)
    {
        return PassportRegistry.Policy({
            minAge: 0, nationalityRule: rule, countries: countries, faceMatch: false, devMode: false
        });
    }

    function _open() internal returns (PassportRegistry) {
        return new PassportRegistry(
            verifier, "signal.example", _policy(PassportRegistry.NationalityRule.ANY, new string[](0))
        );
    }

    function _params() internal pure returns (IZKPassportVerifier.ProofVerificationParams memory p) {
        p.version = bytes32(uint256(1));
        p.proofVerificationData.publicInputs = new bytes32[](8);
        // What a hostile caller would like the verifier to check against.
        p.serviceConfig = IZKPassportVerifier.ServiceConfig(365 days, "evil.example", "other-scope", true);
    }

    function _codes(string memory a, string memory b) internal pure returns (string[] memory list) {
        list = new string[](2);
        list[0] = a;
        list[1] = b;
    }

    function test_register_grantsOneVoteToTheBoundAccount() public {
        PassportRegistry registry = _open();
        assertEq(registry.getPastVotes(voter, 0), 0);

        vm.prank(voter);
        registry.register(_params());

        assertEq(registry.getPastVotes(voter, 123), 1);
        assertEq(registry.accountOf(verifier.identifier()), voter);
        assertEq(registry.totalRegistrants(), 1);
        assertEq(registry.registrants(0, 10)[0], voter);
    }

    function test_register_verifiesUnderThePollsServiceConfig() public {
        PassportRegistry registry = _open();
        vm.prank(voter);
        registry.register(_params());

        (uint256 validity, string memory domain, string memory scope, bool devMode) =
            verifier.lastServiceConfig();
        assertEq(validity, registry.PROOF_VALIDITY());
        assertEq(domain, "signal.example");
        assertEq(scope, string.concat("crisp-signal-", vm.toLowercase(vm.toString(address(registry)))));
        assertFalse(devMode);
    }

    function test_register_devModeFollowsThePolicy() public {
        PassportRegistry.Policy memory policy = _policy(PassportRegistry.NationalityRule.ANY, new string[](0));
        policy.devMode = true;
        PassportRegistry registry = new PassportRegistry(verifier, "signal.example", policy);
        vm.prank(voter);
        registry.register(_params());
        (,,, bool devMode) = verifier.lastServiceConfig();
        assertTrue(devMode);
    }

    function test_register_rejectsAProofBoundToAnotherAccountOrChain() public {
        PassportRegistry registry = _open();
        address other = makeAddr("other");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.WrongBinding.selector, voter, block.chainid));
        registry.register(_params());

        helper.setBound(voter, 1);
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.WrongBinding.selector, voter, 1));
        registry.register(_params());
    }

    function test_register_oneDocumentRegistersOnce() public {
        PassportRegistry registry = _open();
        vm.prank(voter);
        registry.register(_params());

        address second = makeAddr("second");
        helper.setBound(second, block.chainid);
        vm.prank(second);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.DocumentAlreadyRegistered.selector, voter));
        registry.register(_params());

        // A second document cannot re-register an account either.
        verifier.setIdentifier(keccak256("document-2"));
        helper.setBound(voter, block.chainid);
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.AlreadyRegistered.selector, voter));
        registry.register(_params());
    }

    function test_register_rejectsInvalidProofsAndIdentifiers() public {
        PassportRegistry registry = _open();
        verifier.setValid(false);
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.InvalidProof.selector);
        registry.register(_params());

        verifier.setValid(true);
        verifier.setIdentifier(bytes32(0));
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.MissingIdentifier.selector);
        registry.register(_params());
    }

    function test_register_rejectsASaltedIdentifier() public {
        PassportRegistry registry = _open();
        helper.setNonSalted(false);
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.UnexpectedNullifierType.selector);
        registry.register(_params());
    }

    function test_register_enforcesMinimumAge() public {
        PassportRegistry.Policy memory policy = _policy(PassportRegistry.NationalityRule.ANY, new string[](0));
        policy.minAge = 18;
        PassportRegistry registry = new PassportRegistry(verifier, "signal.example", policy);

        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(PassportRegistry.AgeNotProven.selector, 18));
        registry.register(_params());

        helper.setMinAge(18);
        vm.prank(voter);
        registry.register(_params());
        assertTrue(registry.isRegistered(voter));
    }

    function test_register_enforcesTheExactAllowList() public {
        PassportRegistry registry = new PassportRegistry(
            verifier, "signal.example", _policy(PassportRegistry.NationalityRule.ALLOW, _codes("DEU", "FRA"))
        );

        // A proof against a different list does not prove membership of this one.
        helper.setInList(_codes("DEU", "ITA"));
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.NationalityNotProven.selector);
        registry.register(_params());

        helper.setInList(_codes("DEU", "FRA"));
        vm.prank(voter);
        registry.register(_params());
        assertTrue(registry.isRegistered(voter));
    }

    function test_register_enforcesTheDenyList() public {
        PassportRegistry registry = new PassportRegistry(
            verifier, "signal.example", _policy(PassportRegistry.NationalityRule.DENY, _codes("CHN", "RUS"))
        );
        // An allow-list proof is not an exclusion proof.
        helper.setInList(_codes("CHN", "RUS"));
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.NationalityNotProven.selector);
        registry.register(_params());

        helper.setOutList(_codes("CHN", "RUS"));
        vm.prank(voter);
        registry.register(_params());
    }

    function test_register_enforcesFaceMatch() public {
        PassportRegistry.Policy memory policy = _policy(PassportRegistry.NationalityRule.ANY, new string[](0));
        policy.faceMatch = true;
        PassportRegistry registry = new PassportRegistry(verifier, "signal.example", policy);
        vm.prank(voter);
        vm.expectRevert(PassportRegistry.FaceMatchMissing.selector);
        registry.register(_params());

        helper.setFaceMatched(true);
        vm.prank(voter);
        registry.register(_params());
    }

    function test_constructor_requiresCanonicalCountryLists() public {
        vm.expectRevert(PassportRegistry.InvalidPolicy.selector);
        new PassportRegistry(
            verifier, "d", _policy(PassportRegistry.NationalityRule.ALLOW, _codes("FRA", "DEU"))
        );

        vm.expectRevert(PassportRegistry.InvalidPolicy.selector);
        new PassportRegistry(
            verifier, "d", _policy(PassportRegistry.NationalityRule.ALLOW, _codes("DEU", "DEU"))
        );

        vm.expectRevert(PassportRegistry.InvalidPolicy.selector);
        new PassportRegistry(
            verifier, "d", _policy(PassportRegistry.NationalityRule.DENY, _codes("deu", "FRA"))
        );

        vm.expectRevert(PassportRegistry.InvalidPolicy.selector);
        new PassportRegistry(verifier, "d", _policy(PassportRegistry.NationalityRule.ALLOW, new string[](0)));

        vm.expectRevert(PassportRegistry.InvalidPolicy.selector);
        new PassportRegistry(
            verifier, "d", _policy(PassportRegistry.NationalityRule.ANY, _codes("DEU", "FRA"))
        );
    }
}
