import { createPublicClient, http } from 'viem'
import { CHAIN, RPC_URL } from '../config'

/** Reads outside React, on the same endpoint the wallet provider uses; concurrent reads share one multicall. */
export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL), batch: { multicall: true } })
