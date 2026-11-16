import { IPFS_GATEWAY } from '../config'
import { parseMetadata, type PollMetadata } from './metadata'

const cache = new Map<string, Promise<PollMetadata>>()

/** Content-addressed, so a CID's metadata never changes and is fetched once per session. */
export function fetchMetadata(cid: string): Promise<PollMetadata> {
  let pending = cache.get(cid)
  if (!pending) {
    pending = fetch(`${IPFS_GATEWAY}${encodeURIComponent(cid)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`IPFS gateway answered ${res.status} for ${cid}`)
        return res.json()
      })
      .then(parseMetadata)
    pending.catch(() => cache.delete(cid))
    cache.set(cid, pending)
  }
  return pending
}

/** Pins the metadata through the app's /api/pin function, which holds the Pinata key. */
export async function uploadMetadata(metadata: PollMetadata): Promise<string> {
  const res = await fetch('/api/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  const body: unknown = await res.json().catch(() => null)
  const isObject = typeof body === 'object' && body !== null
  const cid = isObject && 'cid' in body ? body.cid : undefined
  if (!res.ok || typeof cid !== 'string') {
    const error = isObject && 'error' in body ? body.error : undefined
    throw new Error(`Publishing to IPFS failed (${res.status})${typeof error === 'string' ? `: ${error}` : ''}`)
  }
  cache.set(cid, Promise.resolve(metadata))
  return cid
}
