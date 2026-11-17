import type { CompressedProofResult } from '@crisp-e3/aztec'
import type { ProofResult } from '@zkpassport/sdk'
import { isHex } from 'viem'

/** The ZKPassport circuits release the Aztec contract verifies, from its packed `zkpassport_version` (three 16-bit numbers from bit 240). */
export function unpackCircuitsVersion(packed: bigint): string {
  const part = (shift: bigint) => (packed >> shift) & 0xffffn
  return `${part(240n)}.${part(224n)}.${part(208n)}`
}

export type PassportRequestEvents = {
  onScanned: () => void
  onProving: () => void
  /** The `compressed` outer proof, checked to be of the shape the poll needs; `false` shows ZKPassport's error state. */
  onProof: (proof: ProofSummary) => boolean
  onRejected: () => void
  onError: (message: string) => void
}

/** What the ZKPassport app returned, in the form registration consumes, with what is logged and reported when it does not fit. */
export type ProofSummary = {
  result: CompressedProofResult
  name: string | undefined
  version: string | undefined
}

export type PassportRequest = { url: string; qr: string; cancel: () => void }

/** `outer_count_5` → 5: the number of subproofs the outer circuit aggregates. */
const subproofsOf = (name: string | undefined) => {
  const match = name?.match(/(\d+)$/)
  return match ? Number(match[1]) : undefined
}

/**
 * Picks the outer proof of a `compressed` result and checks it fits the poll. A proof the contract cannot verify is only found out
 * after minutes of proving on Aztec, so everything knowable from the result is checked here and reported with the proof's own
 * `name` and `version`.
 */
export function selectOuterProof(proofs: ProofResult[], expected: { subproofs: 4 | 5; circuitsVersion: string }): ProofSummary {
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

/**
 * Opens a ZKPassport `compressed` request for exactly what the Aztec contract checks: its domain, the round's scope (the L1
 * program's `scopeOf(e3Id)`), the age floor, a document-bound identifier, mock documents only if the round allows them, and the
 * voter's Aztec account bound into the proof (the account that sends `register`).
 */
export async function requestPassportProof(
  {
    domain,
    scope,
    minAge,
    devMode,
    validitySeconds,
    aztecAddress,
    purpose,
    expected,
  }: {
    domain: string
    scope: string
    minAge: number
    devMode: boolean
    validitySeconds: number
    aztecAddress: string
    purpose: string
    expected: { circuitsVersion: string }
  },
  events: PassportRequestEvents,
): Promise<PassportRequest> {
  // The SDK and its prover dependencies are large; only voters who verify download them.
  const [{ ZKPassport, NullifierType }, qrcode] = await Promise.all([import('@zkpassport/sdk'), import('qrcode')])
  const zkPassport = new ZKPassport(domain)
  let query = await zkPassport.request({
    name: 'CRISP Signal',
    purpose,
    scope,
    mode: 'compressed',
    devMode,
    validity: validitySeconds,
    uniqueIdentifierType: NullifierType.NON_SALTED,
  })

  if (minAge > 0) query = query.gte('age', minAge)
  if (!isHex(aztecAddress)) throw new Error('The Aztec address is not hex.')
  const request = query.bind('user_address', aztecAddress).done()

  request.onRequestReceived(events.onScanned)
  request.onGeneratingProof(events.onProving)
  request.onReject(events.onRejected)
  request.onError((error: unknown) => events.onError(typeof error === 'string' ? error : String(error)))
  request.onSuccess(({ proofs }) => {
    try {
      return events.onProof(selectOuterProof(proofs, { subproofs: minAge > 0 ? 5 : 4, circuitsVersion: expected.circuitsVersion }))
    } catch (error) {
      events.onError(error instanceof Error ? error.message : String(error))
      return false
    }
  })

  const qr = await qrcode.toDataURL(request.url, { margin: 1, width: 280, color: { dark: '#121718', light: '#ffffff' } })
  return { url: request.url, qr, cancel: () => zkPassport.cancelRequest(request.requestId) }
}
