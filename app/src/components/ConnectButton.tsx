import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import { CHAIN } from '../config'
import { shortAddress } from '../lib/format'

/** One button: it opens the wallet modal to connect, and the account modal once connected. */
export function ConnectButton() {
  const { chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()

  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, address }) => {
        if (!isConnected || !address) {
          return (
            <button className="btn sm" onClick={show}>
              Connect wallet
            </button>
          )
        }
        if (chainId !== CHAIN.id) {
          return (
            <button className="btn sm" onClick={() => switchChain({ chainId: CHAIN.id })} disabled={switching}>
              Switch to {CHAIN.name}
            </button>
          )
        }
        return (
          <button className="btn secondary sm wallet" onClick={show} title="Account">
            <span className="wallet-dot" />
            <span className="mono">{shortAddress(address)}</span>
          </button>
        )
      }}
    </ConnectKitButton.Custom>
  )
}
