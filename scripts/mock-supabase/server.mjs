#!/usr/bin/env node
/**
 * Minimal Supabase emulator for local UI development and Playwright runs in
 * sandboxes without Docker or network access to a real Supabase project.
 *
 * Implements just enough GoTrue (password login, /user, /logout) and
 * PostgREST (eq/in/is filters, order, limit, head counts, single-object
 * responses, insert/update/delete) for the app shell to boot against the
 * in-memory fixture dataset below. Realtime websockets are NOT implemented;
 * supabase-js retries quietly and the app degrades to fetch-only.
 *
 * Usage:
 *   node scripts/mock-supabase/server.mjs            # listens on :54321
 *   MOCK_SUPABASE_PORT=4000 node scripts/mock-supabase/server.mjs
 *
 * Point the app at it with:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<any JWT-shaped string>
 *   SUPABASE_SERVICE_ROLE_KEY=<any JWT-shaped string>
 */

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321)

// ── Fixture identities ──────────────────────────────────────
const NOW = Date.now()
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString()
const HOUR = 3_600_000
const uuid = () => crypto.randomUUID()

const U_ADMIN = '11111111-1111-4111-8111-111111111111'
const U_MEMBER = '22222222-2222-4222-8222-222222222222'
const G1 = '33333333-3333-4333-8333-333333333333'
const C_GENERAL = '44444444-4444-4444-8444-444444444444'
const C_WELCOME = '55555555-5555-4555-8555-555555555555'
const V_LOUNGE = '66666666-6666-4666-8666-666666666666'
const V_STUCK_STALE = '77777777-7777-4777-8777-777777777777'
const V_STUCK_LIVE = '88888888-8888-4888-8888-888888888888'
const R_STALE = '99999999-9999-4999-8999-999999999999'
const R_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const USERS = [
  { id: U_ADMIN, email: 'admin@pepchat.test', password: 'test-password-1', username: 'panicmonkeyxx', display_name: 'PanicMonkeyxx' },
  { id: U_MEMBER, email: 'member@pepchat.test', password: 'test-password-2', username: 'hermes', display_name: 'Hermes Test' },
]

function profileRow(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: null,
    bio: null,
    location: null,
    website: null,
    username_color: '#f4ebdd',
    banner_color: '#2b2520',
    badge: null,
    pronouns: null,
    member_since: iso(90 * 24 * HOUR),
    updated_at: iso(HOUR),
    created_at: iso(90 * 24 * HOUR),
  }
}

const groupRow = {
  id: G1,
  name: 'Welcome',
  description: 'Mock server for UI checks',
  icon_url: null,
  owner_id: U_ADMIN,
  invite_code: 'mockcode',
  created_at: iso(60 * 24 * HOUR),
}

function messageRow({ id, userId, content, minutesAgo, replyCount = 0 }) {
  const user = USERS.find((u) => u.id === userId)
  return {
    id,
    channel_id: C_GENERAL,
    user_id: userId,
    content,
    reply_to_id: null,
    attachments: [],
    edited_at: null,
    created_at: iso(minutesAgo * 60_000),
    thread_root_id: null,
    thread_title: null,
    thread_reply_count: replyCount,
    thread_last_reply_at: replyCount > 0 ? iso(minutesAgo * 30_000) : null,
    mirrored_from_thread_id: null,
    pinned_at: null,
    is_system: false,
    system_type: null,
    system_data: null,
    promoted_at: null,
    promoted_to_channel_id: null,
    profiles: {
      username: user.username,
      avatar_url: null,
      display_name: user.display_name,
      username_color: '#f4ebdd',
    },
    replied_to: null,
    promoted_channel: null,
    mirrored_from_thread: null,
    reactions: [],
  }
}

// ── Dataset (mutable: inserts/updates/deletes apply) ────────
const db = {
  profiles: USERS.map(profileRow),
  groups: [groupRow],
  group_members: USERS.map((user, index) => ({
    id: uuid(),
    group_id: G1,
    user_id: user.id,
    role: index === 0 ? 'admin' : 'user',
    joined_at: iso((60 - index) * 24 * HOUR),
    groups: groupRow,
    profiles: { username: user.username, avatar_url: null },
  })),
  channels: [
    { id: C_GENERAL, group_id: G1, name: 'general', description: 'General chat', noob_access: false, position: 0, kind: 'text', category_id: null, is_ephemeral: false, created_by: U_ADMIN, created_at: iso(60 * 24 * HOUR) },
    { id: C_WELCOME, group_id: G1, name: 'welcome', description: null, noob_access: true, position: 1, kind: 'text', category_id: null, is_ephemeral: false, created_by: U_ADMIN, created_at: iso(60 * 24 * HOUR) },
    { id: V_LOUNGE, group_id: G1, name: 'Lounge', description: null, noob_access: false, position: 2, kind: 'voice', category_id: null, is_ephemeral: false, created_by: U_ADMIN, created_at: iso(30 * 24 * HOUR) },
    // Reaper regression case: empty room held open only by a stale heartbeat.
    { id: V_STUCK_STALE, group_id: G1, name: "PanicMonkeyxx's Room", description: null, noob_access: false, position: 3, kind: 'voice', category_id: null, is_ephemeral: true, created_by: U_ADMIN, created_at: iso(5 * 24 * HOUR) },
    // Force-close demo case: a participant row that still heartbeats.
    { id: V_STUCK_LIVE, group_id: G1, name: "PanicMonkeyxx's Room", description: null, noob_access: false, position: 4, kind: 'voice', category_id: null, is_ephemeral: true, created_by: U_ADMIN, created_at: iso(4 * 24 * HOUR) },
  ],
  channel_categories: [],
  voice_rooms: [
    { id: R_STALE, group_id: G1, channel_id: V_STUCK_STALE, created_by: U_ADMIN, provider: 'livekit', provider_room_name: `sidebar:voice:${R_STALE}`, status: 'open', closed_at: null, created_at: iso(5 * 24 * HOUR), channels: { name: "PanicMonkeyxx's Room", noob_access: false } },
    { id: R_LIVE, group_id: G1, channel_id: V_STUCK_LIVE, created_by: U_ADMIN, provider: 'livekit', provider_room_name: `sidebar:voice:${R_LIVE}`, status: 'open', closed_at: null, created_at: iso(4 * 24 * HOUR), channels: { name: "PanicMonkeyxx's Room", noob_access: false } },
  ],
  voice_room_participants: [
    { id: uuid(), room_id: R_STALE, user_id: U_MEMBER, joined_at: iso(5 * 24 * HOUR), last_seen_at: iso(5 * 24 * HOUR), left_at: null },
    // $keepalive: heartbeat refreshed on every read so the row never goes
    // stale — simulates a client that is still connected.
    { id: uuid(), room_id: R_LIVE, user_id: U_MEMBER, joined_at: iso(HOUR), last_seen_at: iso(0), left_at: null, $keepalive: true },
  ],
  messages: [
    messageRow({ id: uuid(), userId: U_ADMIN, content: 'Hello', minutesAgo: 50 }),
    messageRow({ id: uuid(), userId: U_MEMBER, content: 'Hermes production UI text send after 795c9f7', minutesAgo: 40 }),
    messageRow({ id: uuid(), userId: U_MEMBER, content: 'Hermes production UI text send tail probe', minutesAgo: 30 }),
    messageRow({ id: uuid(), userId: U_ADMIN, content: 'This one has a thread', minutesAgo: 20, replyCount: 2 }),
    messageRow({ id: uuid(), userId: U_MEMBER, content: 'Plain message, no thread', minutesAgo: 10 }),
  ],
  // Mirrors post-cleanup seeding: @everyone plus genuinely custom roles only
  // (the tier-mirror Admin/Moderator/Member starter roles are gone).
  roles: [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', group_id: G1, name: 'group-buy', color: '#eb459e', hoist: true, mentionable: true, position: 1, permissions: '0', is_default: false, created_at: iso(24 * HOUR) },
    { id: uuid(), group_id: G1, name: '@everyone', color: null, hoist: false, mentionable: false, position: 0, permissions: '0', is_default: true, created_at: iso(60 * 24 * HOUR) },
  ],
  member_roles: [],
}

// Any table not seeded above resolves to an empty list.
function tableRows(table) {
  if (!db[table]) db[table] = []
  if (table === 'voice_room_participants') {
    for (const row of db[table]) {
      if (row.$keepalive && !row.left_at) row.last_seen_at = new Date().toISOString()
    }
  }
  return db[table]
}

// ── Auth helpers ─────────────────────────────────────────────
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function makeAccessToken(user) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(NOW / 1000) + 60 * 60 * 24 * 7,
    iat: Math.floor(NOW / 1000),
    session_id: uuid(),
  })
  return `${header}.${payload}.mock-signature-${user.id}`
}

function authUserPayload(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: iso(90 * 24 * HOUR),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: iso(90 * 24 * HOUR),
    updated_at: iso(HOUR),
  }
}

function userFromAuthHeader(req) {
  const auth = req.headers.authorization ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  return USERS.find((user) => token.includes(`mock-signature-${user.id}`)) ?? null
}

// ── PostgREST-ish filtering ──────────────────────────────────
function rowMatches(row, column, op, rawValue) {
  if (!(column in row)) return true // unmodeled column: don't filter it out
  const value = row[column]
  switch (op) {
    case 'eq':
      return String(value) === rawValue
    case 'neq':
      return String(value) !== rawValue
    case 'is':
      if (rawValue === 'null') return value === null || value === undefined
      if (rawValue === 'true') return value === true
      if (rawValue === 'false') return value === false
      return false
    case 'in': {
      const list = rawValue.replace(/^\(/, '').replace(/\)$/, '').split(',').map((entry) => entry.trim().replace(/^"|"$/g, ''))
      return list.includes(String(value))
    }
    case 'lt':
      return value !== null && String(value) < rawValue
    case 'lte':
      return value !== null && String(value) <= rawValue
    case 'gt':
      return value !== null && String(value) > rawValue
    case 'gte':
      return value !== null && String(value) >= rawValue
    case 'ilike': {
      const pattern = rawValue.replace(/%/g, '.*').replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(String(value ?? ''))
    }
    default:
      return true
  }
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey'])

function parseFilters(searchParams) {
  const filters = []
  for (const [key, value] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue
    if (key === 'or' || key === 'and') continue // too complex: skip, return unfiltered superset
    const match = value.match(/^(eq|neq|is|in|lt|lte|gt|gte|ilike|like)\.(.*)$/s)
    if (match) filters.push({ column: key, op: match[1], value: match[2] })
  }
  return filters
}

function applyQuery(rows, searchParams) {
  const filters = parseFilters(searchParams)
  let result = rows.filter((row) => filters.every((f) => rowMatches(row, f.column, f.op, f.value)))

  const order = searchParams.get('order')
  if (order) {
    const [column, direction] = order.split('.', 2)
    const asc = direction !== 'desc'
    result = [...result].sort((a, b) => {
      const av = a[column]
      const bv = b[column]
      if (av === bv) return 0
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return (av < bv ? -1 : 1) * (asc ? 1 : -1)
    })
  }

  const limit = searchParams.get('limit')
  if (limit) result = result.slice(0, Number(limit))
  return result
}

// ── RPC handlers ─────────────────────────────────────────────
const RPC_HANDLERS = {
  user_has_pending_account_invite_claim: () => false,
  has_permission: () => true,
  get_or_create_dm: () => uuid(),
  set_message_pinned_at: () => null,
}

// ── HTTP plumbing ────────────────────────────────────────────
function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    ...headers,
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : null) } catch { resolve(null) }
    })
  })
}

const MISSING_SINGLE = { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const { pathname } = url

  if (req.method === 'OPTIONS') return send(res, 204)

  // ── GoTrue ──
  if (pathname === '/auth/v1/token') {
    const body = await readBody(req)
    const user = USERS.find((candidate) => candidate.email === body?.email && candidate.password === body?.password)
      ?? (url.searchParams.get('grant_type') === 'refresh_token' ? userFromAuthHeader(req) ?? USERS[0] : null)
    if (!user) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
    return send(res, 200, {
      access_token: makeAccessToken(user),
      token_type: 'bearer',
      expires_in: 604800,
      expires_at: Math.floor(NOW / 1000) + 604800,
      refresh_token: `mock-refresh-${user.id}`,
      user: authUserPayload(user),
    })
  }
  if (pathname === '/auth/v1/user') {
    const user = userFromAuthHeader(req)
    if (!user) return send(res, 401, { code: 401, msg: 'invalid token' })
    return send(res, 200, authUserPayload(user))
  }
  if (pathname === '/auth/v1/logout') return send(res, 204)

  // ── PostgREST RPC ──
  const rpcMatch = pathname.match(/^\/rest\/v1\/rpc\/([a-zA-Z0-9_]+)$/)
  if (rpcMatch) {
    const handler = RPC_HANDLERS[rpcMatch[1]]
    const body = await readBody(req)
    return send(res, 200, handler ? handler(body) : null)
  }

  // ── PostgREST tables ──
  const tableMatch = pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)$/)
  if (tableMatch) {
    const table = tableMatch[1]
    const rows = tableRows(table)
    const wantsSingle = /vnd\.pgrst\.object/.test(req.headers.accept ?? '')
    const prefer = req.headers.prefer ?? ''

    if (req.method === 'GET' || req.method === 'HEAD') {
      const result = applyQuery(rows, url.searchParams)
      const headers = {}
      if (/count=(exact|planned|estimated)/.test(prefer) || req.method === 'HEAD') {
        headers['content-range'] = result.length === 0 ? '*/0' : `0-${result.length - 1}/${result.length}`
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json', ...headers })
        return res.end()
      }
      if (wantsSingle) {
        if (result.length !== 1) return send(res, 406, MISSING_SINGLE, headers)
        return send(res, 200, result[0], headers)
      }
      return send(res, 200, result, headers)
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const inserted = (Array.isArray(body) ? body : [body]).map((row) => ({ id: uuid(), created_at: iso(), ...row }))
      // Messages come back with the PostgREST embeds the app selects.
      if (table === 'messages') {
        for (const row of inserted) {
          const author = USERS.find((user) => user.id === row.user_id)
          row.profiles = row.profiles ?? {
            username: author?.username ?? 'unknown',
            avatar_url: null,
            display_name: author?.display_name ?? null,
            username_color: '#f4ebdd',
          }
          row.attachments = row.attachments ?? []
          row.reactions = row.reactions ?? []
          row.replied_to = row.replied_to ?? null
          row.promoted_channel = row.promoted_channel ?? null
          row.mirrored_from_thread = row.mirrored_from_thread ?? null
          row.thread_root_id = row.thread_root_id ?? null
          row.thread_reply_count = row.thread_reply_count ?? 0
          row.edited_at = row.edited_at ?? null
          row.pinned_at = row.pinned_at ?? null
        }
      }
      rows.push(...inserted)
      if (/return=representation/.test(prefer)) {
        return send(res, 201, wantsSingle ? inserted[0] : inserted)
      }
      return send(res, 201, undefined, { 'content-length': '0' })
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      const matched = applyQuery(rows, url.searchParams)
      for (const row of matched) Object.assign(row, body)
      if (/return=representation/.test(prefer)) {
        return send(res, 200, wantsSingle ? (matched[0] ?? null) : matched)
      }
      return send(res, 204)
    }

    if (req.method === 'DELETE') {
      const matched = new Set(applyQuery(rows, url.searchParams))
      db[table] = rows.filter((row) => !matched.has(row))
      if (/return=representation/.test(prefer)) return send(res, 200, [...matched])
      return send(res, 204)
    }
  }

  // Storage and everything else: not implemented.
  return send(res, 404, { message: `mock-supabase: unhandled ${req.method} ${pathname}` })
})

server.listen(PORT, () => {
  console.log(`mock-supabase listening on http://127.0.0.1:${PORT}`)
  console.log(`admin login: ${USERS[0].email} / ${USERS[0].password}`)
  console.log(`member login: ${USERS[1].email} / ${USERS[1].password}`)
})
