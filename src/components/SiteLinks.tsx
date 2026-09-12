import { REPO_URL, SUPPORT_HANDLE, SUPPORT_URL } from '../lib/config'
import { newIssueUrl, type DiagnosticContext } from '../lib/report'

/**
 * Bug report, source and support links.
 *
 * All three are plain anchors. Nothing here contacts GitHub or Buy Me a Coffee
 * until the user clicks - no embedded widget, no iframe, no script from either
 * origin, which is both a privacy property and the reason the CSP can stay at
 * `script-src 'self'`.
 */
export default function SiteLinks({ context }: { context: DiagnosticContext }) {
  return (
    <div className="site-links">
      <a
        className="tab"
        href={newIssueUrl(context)}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens a prefilled GitHub issue in a new tab. Nothing is filed until you submit it, and your location data is not included."
      >
        Report a bug
      </a>
      <a className="tab" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        Source
      </a>
      <a
        className="tab support"
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={`Support this tool on Buy Me a Coffee (${SUPPORT_HANDLE})`}
      >
        <span aria-hidden="true">&#9749;</span> Buy me a coffee
      </a>
    </div>
  )
}
