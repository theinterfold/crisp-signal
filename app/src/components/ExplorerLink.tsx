import { explorerUrl, type ExplorerTarget } from '../lib/explorer'
import { shortHex } from '../lib/format'

/** A transaction or contract on its public explorer, in a new tab. The text is the label if given, else the shortened hash. */
export function ExplorerLink({ label, ...target }: ExplorerTarget & { label?: string }) {
  return (
    <a className="mono" href={explorerUrl(target)} target="_blank" rel="noreferrer" title={target.id}>
      {label ?? shortHex(target.id)}
    </a>
  )
}
