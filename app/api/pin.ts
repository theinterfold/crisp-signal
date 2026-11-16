// Vercel function: pins a poll's metadata on Pinata, so the Pinata key never reaches the browser.
// It pins only documents that parse as CRISP Signal polls within the form's limits.
import { parseMetadata } from '../src/lib/metadata'

const MAX_BODY_BYTES = 16 * 1024

const json = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function POST(request: Request): Promise<Response> {
  const jwt = process.env.PINATA_JWT
  if (!jwt) return json(503, { error: 'IPFS uploads are not configured on this deployment (PINATA_JWT).' })

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Poll metadata is too large.' })

  let metadata
  try {
    metadata = parseMetadata(JSON.parse(raw))
  } catch {
    return json(400, { error: 'The request is not a CRISP Signal poll document.' })
  }

  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: { name: `crisp-signal: ${metadata.title.slice(0, 80)}` },
      pinataOptions: { cidVersion: 1 },
    }),
  })
  if (!res.ok) return json(502, { error: `Pinata answered ${res.status}.` })
  const pinned: unknown = await res.json()
  const cid = typeof pinned === 'object' && pinned !== null && 'IpfsHash' in pinned ? pinned.IpfsHash : undefined
  if (typeof cid !== 'string') return json(502, { error: 'Pinata returned no CID.' })
  return json(200, { cid })
}
