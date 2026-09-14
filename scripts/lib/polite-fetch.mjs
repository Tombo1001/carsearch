/**
 * The only way the data scripts touch the network.
 *
 * Every request:
 *   - identifies itself, with a link back to this repo;
 *   - is checked against the host's robots.txt first (RFC 9309), and refused
 *     locally if the host disallows it;
 *   - waits out the host's Crawl-delay between requests to the same host;
 *   - is never retried after a refusal. A 403, or a 202 bot challenge, is the
 *     site's answer. Retrying, rotating agents or routing around it would be
 *     working against a decision the site operator made.
 *
 * Only momentary failures - timeouts, 429 and 5xx - get one retry.
 */

export const PRODUCT = 'carsearch-data-check'
export const USER_AGENT = `Mozilla/5.0 (compatible; ${PRODUCT}/1.0; +https://github.com/Tombo1001/carsearch)`

/** Thrown when robots.txt forbids a URL. Callers treat it as "not ours to fetch", not as an outage. */
export class RobotsDisallowed extends Error {
  constructor(url) {
    super(`robots.txt disallows ${url}`)
    this.name = 'RobotsDisallowed'
    this.url = url
  }
}

const ROBOTS_TIMEOUT_MS = 20_000
/** A Crawl-delay above this is honoured as this; a weekly job cannot wait an hour per host. */
const MAX_DELAY_S = 30

// ------------------------------------------------------------- robots.txt --

/**
 * Parses robots.txt into the rule group that applies to us: the group naming our
 * product token if there is one, otherwise the `*` group. Groups that share a
 * user-agent line are merged, as RFC 9309 section 2.2.1 requires.
 */
export function parseRobots(text) {
  const groups = []
  let current = null
  let lastWasAgent = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()

    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [], delay: null }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', path: value })
    else if (key === 'crawl-delay' && Number.isFinite(Number(value))) current.delay = Number(value)
  }

  const token = PRODUCT.toLowerCase()
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)))
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes('*'))
  return {
    rules: chosen.flatMap((g) => g.rules),
    delay: chosen.map((g) => g.delay).find((d) => d !== null) ?? null,
  }
}

/** robots.txt path pattern -> RegExp. `*` matches anything, a trailing `$` anchors. */
function patternToRegExp(path) {
  const anchored = path.endsWith('$')
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

/** Longest matching rule wins; on a tie, allow wins. An empty Disallow allows everything. */
export function isAllowed(policy, url) {
  const { pathname, search } = new URL(url)
  const target = decodeURIComponentSafe(pathname) + search
  let best = null
  for (const rule of policy.rules) {
    if (!rule.path) continue
    if (!patternToRegExp(decodeURIComponentSafe(rule.path)).test(target)) continue
    const len = rule.path.length
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow }
  }
  return best ? best.allow : true
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const policies = new Map()

/**
 * The robots policy for an origin, fetched once per run.
 *
 * RFC 9309 section 2.3.1: a 4xx robots.txt means no restrictions; a 5xx or an
 * unreachable one means assume everything is disallowed, until it can be read.
 */
async function policyFor(origin) {
  if (!policies.has(origin)) {
    policies.set(
      origin,
      (async () => {
        try {
          const res = await fetch(`${origin}/robots.txt`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
            headers: { 'user-agent': USER_AGENT },
          })
          if (res.ok) return { ...parseRobots(await res.text()), source: 'robots.txt' }
          if (res.status >= 400 && res.status < 500) return { rules: [], delay: null, source: `robots.txt ${res.status}` }
          return { rules: [{ allow: false, path: '/' }], delay: null, source: `robots.txt ${res.status}` }
        } catch (err) {
          return { rules: [{ allow: false, path: '/' }], delay: null, source: `robots.txt unreachable (${err.name})` }
        }
      })(),
    )
  }
  return policies.get(origin)
}

export async function robotsAllows(url) {
  return isAllowed(await policyFor(new URL(url).origin), url)
}

// ------------------------------------------------------------------ fetch --

const lastRequestAt = new Map()

async function waitForHost(origin, delaySeconds) {
  const gap = Math.min(delaySeconds ?? 0, MAX_DELAY_S) * 1000
  const last = lastRequestAt.get(origin)
  if (gap && last) {
    const wait = last + gap - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
  lastRequestAt.set(origin, Date.now())
}

/**
 * fetch(), after robots.txt and Crawl-delay. Throws RobotsDisallowed instead of
 * requesting a URL the host has excluded. Returns the Response for any HTTP status;
 * callers decide what a 403 means to them.
 */
export async function politeFetch(url, { timeoutMs = 60_000, headers = {}, ...init } = {}) {
  const origin = new URL(url).origin
  const policy = await policyFor(origin)
  if (!isAllowed(policy, url)) throw new RobotsDisallowed(url)

  for (let attempt = 0; ; attempt++) {
    await waitForHost(origin, policy.delay)
    let res
    try {
      res = await fetch(url, {
        redirect: 'follow',
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': USER_AGENT, ...headers },
      })
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 5_000))
        continue
      }
      throw err
    }
    const momentary = res.status === 429 || res.status >= 500
    if (!momentary || attempt > 0) return res
    const retryAfter = Math.min(Number(res.headers.get('retry-after')) || 5, MAX_DELAY_S)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
  }
}
