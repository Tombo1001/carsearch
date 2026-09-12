/**
 * Builds a prefilled GitHub issue for the "report a bug" button.
 *
 * The privacy rule for this file: a bug report describes the *app*, never the
 * user's movements. Nothing derived from an individual position - no coordinates,
 * no place names, no dates - goes into the body. What does go in is the shape of
 * the input (which export format, how many points, how many days it spans), which
 * is what actually reproduces a parsing bug and says nothing about where anyone
 * went. The user sees the whole body on GitHub and has to press Submit themselves.
 */

import { NEW_ISSUE_URL } from './config'
import type { ParsedTimeline, VehicleSpec, ZoneData } from './types'

/** GitHub truncates very long prefill URLs; keep the body well inside that. */
const MAX_BODY_CHARS = 6000

export interface DiagnosticContext {
  timeline: ParsedTimeline | null
  zoneData: ZoneData | null
  vehicle: VehicleSpec
}

/** The non-identifying facts about this session, as `key: value` lines. */
export function diagnostics({ timeline, zoneData, vehicle }: DiagnosticContext): string[] {
  const lines = [
    `App version: ${__APP_VERSION__}`,
    `Build: ${__BUILD_INFO__}`,
    `Page: ${window.location.origin}${window.location.pathname}`,
    `Browser: ${navigator.userAgent}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
    `Zone data: ${zoneData ? `${zoneData.zones.length} zones, built ${zoneData.generatedAt}` : 'failed to load'}`,
    `Vehicle: ${vehicle.fuel}, registered ${vehicle.registered}, euro override ${vehicle.euroOverride ?? 'none'}`,
  ]

  if (!timeline) {
    lines.push('Timeline: none loaded')
    return lines
  }

  const spanDays =
    timeline.from !== null && timeline.to !== null
      ? Math.max(1, Math.round((timeline.to - timeline.from) / 86_400_000))
      : 0

  lines.push(
    `Timeline format: ${timeline.format}`,
    `Timeline size: ${timeline.pointCount} positions in ${timeline.segments.length} segments`,
    `Timeline span: ${spanDays} days (dates deliberately omitted)`,
    `Activity types present: ${timeline.hasModeInfo ? 'yes' : 'no'}`,
    `Parser notes: ${timeline.warnings.length}`,
  )
  return lines
}

export function issueBody(ctx: DiagnosticContext): string {
  const body = `## What happened

<!-- Replace this line with what went wrong. -->

## What you expected instead

<!-- Replace this line. -->

## Steps to reproduce

1.
2.

---

<details>
<summary>Diagnostics (filled in automatically - edit or delete anything you would rather not share)</summary>

\`\`\`
${diagnostics(ctx).join('\n')}
\`\`\`

</details>

<sub>Your location data is not in this report and never left your browser. Please do not
attach your Timeline export to a public issue.</sub>
`
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n...(truncated)` : body
}

/**
 * The GitHub "new issue" URL with title and body prefilled.
 *
 * Opening this navigates the user to github.com with the text in the query string;
 * it does not file anything. They review and submit, or close the tab.
 */
export function newIssueUrl(ctx: DiagnosticContext): string {
  const params = new URLSearchParams({
    title: '',
    body: issueBody(ctx),
    labels: 'bug',
  })
  return `${NEW_ISSUE_URL}?${params.toString()}`
}
