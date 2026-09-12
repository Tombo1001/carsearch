import { useRef, useState } from 'react'
import type { ParsedTimeline } from '../lib/types'
import { parseTimelineFiles } from '../lib/timeline'

const FORMAT_LABELS: Record<string, string> = {
  records: 'Records.json (Takeout)',
  'semantic-location-history': 'Semantic Location History (Takeout)',
  'phone-timeline': 'Timeline export (Google Maps app)',
  unknown: 'Unrecognised',
}

interface Props {
  timeline: ParsedTimeline | null
  onLoaded: (t: ParsedTimeline | null) => void
}

export default function UploadPanel({ timeline, onLoaded }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Parser notes from a run that produced nothing usable. On a successful run the
   * notes live on the timeline itself; on a failed one there is no timeline to hang
   * them off, and they are the only thing that explains why - a rejected ZIP or an
   * oversized file says so here rather than vanishing behind "no positions found".
   */
  const [rejections, setRejections] = useState<string[]>([])

  async function handle(files: FileList | File[] | null) {
    if (!files || !files.length) return
    setBusy(true)
    setError(null)
    setRejections([])
    try {
      const parsed = await parseTimelineFiles([...files])
      if (!parsed.pointCount) {
        setError('No usable positions were found in those files.')
        setRejections(parsed.warnings)
        onLoaded(null)
      } else {
        onLoaded(parsed)
      }
    } catch (err) {
      setError((err as Error).message)
      onLoaded(null)
    } finally {
      setBusy(false)
      // Let the same file be chosen twice in a row; without this the input keeps
      // its value and the change event never fires again.
      if (input.current) input.current.value = ''
    }
  }

  const span =
    timeline?.from && timeline?.to
      ? `${new Date(timeline.from).toLocaleDateString('en-GB')} to ${new Date(timeline.to).toLocaleDateString('en-GB')}`
      : null

  return (
    <section className="card stack">
      <h3>1 &middot; Your driving history</h3>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void handle(e.dataTransfer.files)
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        {busy ? (
          <strong>Reading&hellip;</strong>
        ) : (
          <>
            <strong>Drop your Timeline JSON here</strong>
            <div className="small muted" style={{ marginTop: 4 }}>
              or click to choose. Several files at once is fine.
            </div>
          </>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => void handle(e.target.files)}
      />

      <p className="small muted" style={{ margin: 0 }}>
        Everything is parsed in your browser. Your location data is never uploaded anywhere &mdash; this
        page has no backend at all. Nothing is saved either: close the tab and it is gone.
      </p>

      <details className="small secondary">
        <summary style={{ cursor: 'pointer' }}>How do I get this file?</summary>
        <p style={{ margin: '8px 0 0' }}>
          Since late 2024 Timeline lives on your phone, and Google Takeout no longer offers it. On your
          phone: <strong>Google Maps &rarr; your profile picture &rarr; Your Timeline &rarr; &hellip; &rarr;
          Location &amp; privacy settings &rarr; Export Timeline data</strong>. That writes a JSON file to
          the device, which you then copy across.
        </p>
        <p style={{ margin: '8px 0 0' }}>
          Older Takeout archives work too. Look for <code>Records.json</code>, or the monthly files under{' '}
          <code>Semantic Location History</code> &mdash; select as many months as you want to analyse.
        </p>
      </details>

      {error && (
        <div className="note warn">
          {error}
          {rejections.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {rejections.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {timeline && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge plain">{FORMAT_LABELS[timeline.format] ?? timeline.format}</span>
            <span className="badge plain">{timeline.pointCount.toLocaleString()} positions</span>
            {timeline.hasModeInfo && <span className="badge plain">has activity types</span>}
          </div>
          {span && <div className="small secondary">{span}</div>}
          <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onLoaded(null)}>
            Clear
          </button>
        </div>
      )}

      {timeline?.warnings.length ? (
        <details className="small muted">
          <summary style={{ cursor: 'pointer' }}>{timeline.warnings.length} parser note(s)</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {timeline.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
