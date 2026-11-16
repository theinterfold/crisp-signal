import { isHex, type Address, type Hex } from 'viem'
import type { SolidityVerifierParameters } from '@zkpassport/sdk'
import { ZKPASSPORT_CHAIN } from '../config'
import { NationalityRule, type Policy } from './polls'

/** `PassportRegistry.PROOF_VALIDITY`: the registry rejects older proofs. */
const PROOF_VALIDITY_SECONDS = 7 * 24 * 60 * 60

/** `IZKPassportVerifier.ProofVerificationParams`, as `PassportRegistry.register` takes it. */
export type RegisterParams = {
  version: Hex
  proofVerificationData: { vkeyHash: Hex; proof: Hex; publicInputs: Hex[] }
  committedInputs: Hex
  serviceConfig: { validityPeriodInSeconds: bigint; domain: string; scope: string; devMode: boolean }
}

function hex(name: string, value: string): Hex {
  if (!isHex(value)) throw new Error(`ZKPassport returned a malformed ${name}.`)
  return value
}

function toRegisterParams(p: SolidityVerifierParameters): RegisterParams {
  return {
    version: hex('version', p.version),
    proofVerificationData: {
      vkeyHash: hex('vkey hash', p.proofVerificationData.vkeyHash),
      proof: hex('proof', p.proofVerificationData.proof),
      publicInputs: p.proofVerificationData.publicInputs.map((v) => hex('public input', v)),
    },
    committedInputs: hex('committed inputs', p.committedInputs),
    // The registry overwrites the service config with its own; these values only fill the struct.
    serviceConfig: { ...p.serviceConfig, validityPeriodInSeconds: BigInt(p.serviceConfig.validityPeriodInSeconds) },
  }
}

export type PassportRequestEvents = {
  onScanned: () => void
  onProving: () => void
  /** The proof as the registry's `register` takes it; `false` shows ZKPassport's error state. */
  onProof: (params: RegisterParams) => Promise<boolean | void>
  onRejected: () => void
  onError: (message: string) => void
}

export type PassportRequest = { url: string; qr: string; cancel: () => void }

/**
 * Opens a ZKPassport request for exactly what a poll's registry checks on-chain: the same domain,
 * scope and dev mode, the same age floor and country list, FaceMatch when required, and the voter's
 * address and chain bound into the proof.
 */
export async function requestPassportProof(
  { domain, scope, policy, account, purpose }: { domain: string; scope: string; policy: Policy; account: Address; purpose: string },
  events: PassportRequestEvents,
): Promise<PassportRequest> {
  // The SDK and its prover dependencies are large; only voters who verify download them.
  const [{ ZKPassport }, qrcode] = await Promise.all([import('@zkpassport/sdk'), import('qrcode')])
  const zkPassport = new ZKPassport(domain)
  let query = await zkPassport.request({
    name: 'CRISP Signal',
    purpose,
    scope,
    mode: 'compressed-evm',
    devMode: policy.devMode,
    validity: PROOF_VALIDITY_SECONDS,
  })

  if (policy.minAge > 0) query = query.gte('age', policy.minAge)
  // The registry compares the committed list entry by entry, so pass exactly its stored order.
  if (policy.nationalityRule === NationalityRule.Allow) query = query.in('nationality', policy.countries as never)
  if (policy.nationalityRule === NationalityRule.Deny) query = query.out('nationality', policy.countries as never)
  if (policy.faceMatch) query = query.facematch('strict')
  const request = query.bind('user_address', account).bind('chain', ZKPASSPORT_CHAIN).done()

  request.onRequestReceived(events.onScanned)
  request.onGeneratingProof(events.onProving)
  request.onReject(events.onRejected)
  request.onError((error: unknown) => events.onError(typeof error === 'string' ? error : String(error)))
  request.onSuccess(async ({ proofs }) => {
    const proof = proofs.find((p) => p.name?.startsWith('outer_evm'))
    if (!proof) {
      events.onError('ZKPassport returned no on-chain (outer_evm) proof.')
      return false
    }
    const params = zkPassport.getSolidityVerifierParameters({
      proof,
      scope,
      devMode: policy.devMode,
      validityPeriodInSeconds: PROOF_VALIDITY_SECONDS,
    })
    let args: RegisterParams
    try {
      args = toRegisterParams(params)
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
      return false
    }
    return events.onProof(args)
  })

  const qr = await qrcode.toDataURL(request.url, { margin: 1, width: 280, color: { dark: '#121718', light: '#ffffff' } })
  return { url: request.url, qr, cancel: () => zkPassport.cancelRequest(request.requestId) }
}
