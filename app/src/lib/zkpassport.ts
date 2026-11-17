import type { CompressedProofResult, ZKPassportProofParams } from '@crisp-e3/aztec'
import type { ProofResult } from '@zkpassport/sdk'
import { isHex, type Address, type Hex } from 'viem'
import { ZKPASSPORT_CHAIN } from '../config'
import { NationalityMode, type PollRules } from './polls'

/** The ZKPassport circuits release the Aztec contract verifies, from its packed `zkpassport_version` (three 16-bit numbers from bit 240). */
export function unpackCircuitsVersion(packed: bigint): string {
  const part = (shift: bigint) => (packed >> shift) & 0xffffn
  return `${part(240n)}.${part(224n)}.${part(208n)}`
}

/** What the phone does, whichever path the poll registers on. */
export type PassportRequestEvents = {
  onScanned: () => void
  onProving: () => void
  onRejected: () => void
  onError: (message: string) => void
}

/** What the ZKPassport app returned, in the form registration consumes, with what is logged and reported when it does not fit. */
export type ProofSummary = {
  result: CompressedProofResult
  name: string | undefined
  version: string | undefined
}

/** `outer_count_5` → 5: the number of subproofs the outer circuit aggregates. */
const subproofsOf = (name: string | undefined) => {
  const match = name?.match(/(\d+)$/)
  return match ? Number(match[1]) : undefined
}

/** The subproofs an Aztec-path registration's outer proof aggregates: disclosure of the bound data, plus one per age / nationality rule. */
export const registrationSubproofs = (rules: Pick<PollRules, 'minAge' | 'nationalityMode'>): 4 | 5 | 6 =>
  (4 + (rules.minAge > 0 ? 1 : 0) + (rules.nationalityMode !== NationalityMode.None ? 1 : 0)) as 4 | 5 | 6

/**
 * Picks the outer proof of a `compressed` result and checks it fits the poll. A proof the contract cannot verify is only found out
 * after minutes of proving on Aztec, so everything knowable from the result is checked here and reported with the proof's own
 * `name` and `version`.
 */
export function selectOuterProof(proofs: ProofResult[], expected: { subproofs: 4 | 5 | 6; circuitsVersion: string }): ProofSummary {
  const seen = proofs.map((p) => `${p.name ?? '?'}@${p.version ?? '?'}`).join(', ') || 'none'
  console.info('ZKPassport returned proofs', proofs.map((p) => ({ name: p.name, version: p.version, index: p.index, total: p.total })))

  const outer = proofs.find((p) => p.name?.startsWith('outer'))
  if (!outer?.proof || !outer.vkeyHash) {
    throw new Error(`ZKPassport returned no compressed outer proof (proofs received: ${seen}). Update the ZKPassport app and try again.`)
  }
  const summary = { result: { proof: outer.proof, vkeyHash: outer.vkeyHash }, name: outer.name, version: outer.version }

  const subproofs = subproofsOf(outer.name)
  if (subproofs !== undefined && subproofs !== expected.subproofs) {
    throw new Error(
      `ZKPassport returned the proof ${outer.name} (circuits ${outer.version ?? 'unknown'}), which aggregates ${subproofs} subproofs; ` +
        `this poll verifies ${expected.subproofs}-subproof proofs of circuits ${expected.circuitsVersion}.`,
    )
  }
  if (outer.version && outer.version !== expected.circuitsVersion) {
    throw new Error(
      `ZKPassport returned the proof ${outer.name} of circuits ${outer.version}, but this poll verifies circuits ${expected.circuitsVersion}. ` +
        'The ZKPassport app and the poll are on different circuit releases.',
    )
  }
  return summary
}

function hex(name: string, value: string): Hex {
  if (!isHex(value)) throw new Error(`ZKPassport returned a malformed ${name}.`)
  return value
}

/** `ZKPassportRegistrar.register`'s `ProofVerificationParams` from the SDK's `getSolidityVerifierParameters`, checked to be hex. */
function toProofParams(p: {
  version: string
  proofVerificationData: { vkeyHash: string; proof: string; publicInputs: string[] }
  committedInputs: string
  serviceConfig: { validityPeriodInSeconds: number; domain: string; scope: string; devMode: boolean }
}): ZKPassportProofParams {
  return {
    version: hex('version', p.version),
    proofVerificationData: {
      vkeyHash: hex('vkey hash', p.proofVerificationData.vkeyHash),
      proof: hex('proof', p.proofVerificationData.proof),
      publicInputs: p.proofVerificationData.publicInputs.map((v) => hex('public input', v)),
    },
    committedInputs: hex('committed inputs', p.committedInputs),
    // The registrar overwrites the service config with its own; these values only fill the struct.
    serviceConfig: { ...p.serviceConfig, validityPeriodInSeconds: BigInt(p.serviceConfig.validityPeriodInSeconds) },
  }
}

export type PassportRequest = { url: string; qr: string; cancel: () => void }

type RequestBase = {
  domain: string
  /** The round's scope: the L1 program's `scopeOf(e3Id)`. */
  scope: string
  rules: Pick<PollRules, 'minAge' | 'allowMockDocuments' | 'nationalityMode' | 'countries'>
  validitySeconds: number
  purpose: string
}

/** Where the proof is verified, and what it is bound to. */
export type RegistrationTarget =
  | {
      /** The poll registers on Aztec: a `compressed` proof, bound to the voter's Aztec account, which sends `register`. */
      path: 'aztec'
      aztecAddress: string
      expected: { circuitsVersion: string }
      /** The `compressed` outer proof, checked to be of the shape the poll needs; `false` shows ZKPassport's error state. */
      onProof: (proof: ProofSummary) => boolean
    }
  | {
      /** The poll registers on Ethereum: a `compressed-evm` proof, bound to this poll's slot and to Sepolia, which anyone can submit. */
      path: 'l1'
      slot: Address
      /** The proof as `ZKPassportRegistrar.register` takes it; `false` shows ZKPassport's error state. */
      onProof: (params: ZKPassportProofParams) => boolean
    }

/**
 * Opens a ZKPassport request for exactly what the poll's verifier checks: its domain, the round's scope, the age floor, the
 * nationality rule, a document-bound identifier, mock documents only if the round allows them, and the address the proof is bound to
 * (the voter's Aztec account on the Aztec path; the poll's slot and the chain on the L1 path, where a relayer submits the proof, so
 * nobody can redirect it).
 */
export async function requestPassportProof(
  { domain, scope, rules, validitySeconds, purpose, target }: RequestBase & { target: RegistrationTarget },
  events: PassportRequestEvents,
): Promise<PassportRequest> {
  // The SDK and its prover dependencies are large; only voters who verify download them.
  const [{ ZKPassport, NullifierType }, qrcode] = await Promise.all([import('@zkpassport/sdk'), import('qrcode')])
  const zkPassport = new ZKPassport(domain)
  let query = await zkPassport.request({
    name: 'CRISP Signal',
    purpose,
    scope,
    mode: target.path === 'l1' ? 'compressed-evm' : 'compressed',
    devMode: rules.allowMockDocuments,
    validity: validitySeconds,
    uniqueIdentifierType: NullifierType.NON_SALTED,
  })

  if (rules.minAge > 0) query = query.gte('age', rules.minAge)
  // The verifier compares the committed list as given, so pass exactly the stored order.
  if (rules.nationalityMode === NationalityMode.In) query = query.in('nationality', rules.countries as never)
  if (rules.nationalityMode === NationalityMode.Out) query = query.out('nationality', rules.countries as never)

  let request
  if (target.path === 'aztec') {
    if (!isHex(target.aztecAddress)) throw new Error('The Aztec address is not hex.')
    request = query.bind('user_address', target.aztecAddress).done()
  } else {
    request = query.bind('user_address', target.slot).bind('chain', ZKPASSPORT_CHAIN).done()
  }

  request.onRequestReceived(events.onScanned)
  request.onGeneratingProof(events.onProving)
  request.onReject(events.onRejected)
  request.onError((error: unknown) => events.onError(typeof error === 'string' ? error : String(error)))
  request.onSuccess(({ proofs }) => {
    try {
      if (target.path === 'aztec') {
        return target.onProof(selectOuterProof(proofs, { subproofs: registrationSubproofs(rules), circuitsVersion: target.expected.circuitsVersion }))
      }
      const proof = proofs.find((p) => p.name?.startsWith('outer_evm'))
      if (!proof) throw new Error('ZKPassport returned no on-chain (outer_evm) proof. Update the ZKPassport app and try again.')
      const params = zkPassport.getSolidityVerifierParameters({ proof, scope, domain, devMode: rules.allowMockDocuments, validityPeriodInSeconds: validitySeconds })
      return target.onProof(toProofParams(params))
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
      return false
    }
  })

  const qr = await qrcode.toDataURL(request.url, { margin: 1, width: 280, color: { dark: '#121718', light: '#ffffff' } })
  return { url: request.url, qr, cancel: () => zkPassport.cancelRequest(request.requestId) }
}
