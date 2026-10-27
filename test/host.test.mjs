/**
 * Tests for both halves' shared contract: the renderer, and the Host wiring that
 * serves it. Self-contained — the fixture in `fixture.jsonl` is synthetic, so
 * `npm test` works on any machine.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'
import { contentDisposition, renderSession } from '../render.js'

let failures = 0

/**
 * @param {boolean} condition - assertion outcome.
 * @param {string} label - what was checked.
 * @param {string} [detail] - extra context on failure.
 */
function check(condition, label, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

const FIXTURE = fileURLToPath(new URL('./fixture.jsonl', import.meta.url))
const NOW = 1_761_000_100_000

/**
 * Split a stored log into its header and its committed events.
 * @returns {{ header: object, events: object[] }}
 */
function loadFixture() {
  const parsed = readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
  return {
    header: parsed.find((event) => event.type === 'session'),
    events: parsed.filter((event) => event.type !== 'session'),
  }
}

console.log('\n1. rendered document')
{
  const { header, events } = loadFixture()
  const out = renderSession({ header, events, now: NOW })
  const lines = out.markdown.split('\n')
  const body = lines.slice(4).join('\n')

  check(lines[0] === '# 帮我把这个会话导出成 Markdown。', 'title falls back to the first user line', lines[0])
  check(lines[1] === '', 'blank line under the title')
  check(
    /^> session-fixture · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(lines[2]),
    'metadata line is the id and the start time only',
    lines[2],
  )
  check(!out.markdown.startsWith('---'), 'no YAML frontmatter')

  const expected = [
    '**👤 用户**',
    '',
    '帮我把这个会话导出成 Markdown。',
    '',
    '**🤖 助手**',
    '',
    '先看看当前会话的日志结构。',
    '',
    '结构清楚了，直接渲染就行。',
    '',
    '**👤 用户**',
    '',
    '格式：Markdown',
    '',
    '还有什么要补充的？：越简单越好',
    '',
    '再导一次，这次要全量。',
    '',
    '**🤖 助手**',
    '',
    '已按全量重新导出。',
    '',
  ].join('\n')

  check(body === expected, 'document body matches the fixture exactly', `got:\n${body}`)
  check(!out.markdown.includes('INJECTED CONTEXT'), 'injected harness context is excluded')
  check(!out.markdown.includes('TOOL NOISE'), 'tool output is excluded')
  check(!out.markdown.includes('<details>'), 'no collapsed tool blocks')
  check(!out.markdown.includes('"answers"'), 'answer payload is decoded, not dumped')
  check(out.filename.startsWith('帮我把这个会话导出成 Markdown。-'), 'filename uses the title', out.filename)
  check(out.filename.endsWith('.md'), 'filename is markdown', out.filename)
}

console.log('\n2. edge cases')
{
  const empty = renderSession({
    header: { id: 'session-empty', createdAt: 1761000000000 },
    events: [],
    now: NOW,
  })
  check(empty.markdown.includes('该会话没有对话正文'), 'empty session explains itself')
  check(empty.filename.startsWith('会话记录-'), 'empty session still has a filename', empty.filename)

  const onlyInjected = renderSession({
    header: { id: 'session-x', createdAt: 1761000000000 },
    events: [
      {
        type: 'user/message',
        data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'SECRET' }] },
      },
    ],
    now: NOW,
  })
  check(!onlyInjected.markdown.includes('SECRET'), 'a session without a human turn stays empty')

  const titleEvent = renderSession({
    header: { id: 'session-y', createdAt: 1761000000000 },
    events: [
      { type: 'session/title', data: { title: '自定义标题' } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '正文' }] } },
    ],
    now: NOW,
  })
  check(titleEvent.title === '自定义标题', 'a durable title wins over the first line')

  const trailing = renderSession({
    header: { id: 'session-z', createdAt: 1761000000000 },
    events: [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '只有一句' }] } },
      { type: 'compaction/summary', data: {} },
    ],
    now: NOW,
  })
  check(trailing.markdown.includes('上下文已压缩'), 'compaction point is marked')
}

console.log('\n3. download filename')
{
  const disposition = contentDisposition('会话导出-20261027-1520.md', 'session-abc')
  check(disposition.startsWith('attachment;'), 'is an attachment')
  check(disposition.includes('filename="dsh-session-session-abc.md"'), 'ASCII fallback')
  check(disposition.includes("filename*=UTF-8''"), 'RFC 5987 form for non-ASCII names')
}

console.log('\n4. host wiring')
{
  const { header, events } = loadFixture()
  const routes = []
  const commands = []
  const ctx = {
    get: (name) =>
      name === 'sessionQuery'
        ? {
            readSession: async (id) => {
              if (id !== header.id) {
                const error = new Error(`session "${id}" was not found`)
                error.name = 'SessionPersistenceNotFoundError'
                throw error
              }
              return { session: header, events }
            },
          }
        : undefined,
    effect: (fn) => {
      fn()
      return () => {}
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return async () => {}
        },
      },
    },
    commands: {
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    },
  }
  apply(ctx)

  check(routes.length === 1, 'registers exactly one route')
  check(routes[0]?.path === '/api/session.markdown', 'route path', routes[0]?.path)
  check(
    routes[0]?.methods.includes('GET') && routes[0]?.methods.includes('HEAD'),
    'route answers GET and HEAD',
  )
  check(commands.length === 1 && commands[0]?.name === 'md', 'registers the /md command')

  const base = 'http://127.0.0.1:59124/api/session.markdown'
  const get = await routes[0].fetch(new Request(`${base}?sessionId=${header.id}`))
  check(get.status === 200, 'GET succeeds', String(get.status))
  check(get.headers.get('content-type') === 'text/markdown; charset=utf-8', 'content type')
  check((get.headers.get('content-disposition') ?? '').includes('filename*='), 'download filename')
  check((await get.text()).startsWith('# '), 'body is the document')

  const head = await routes[0].fetch(
    new Request(`${base}?sessionId=${header.id}`, { method: 'HEAD' }),
  )
  check(head.status === 200, 'HEAD succeeds')
  check((await head.text()) === '', 'HEAD has no body')

  const missing = await routes[0].fetch(new Request(base))
  check(missing.status === 400, 'missing sessionId is 400', String(missing.status))

  const absent = await routes[0].fetch(new Request(`${base}?sessionId=session-nope`))
  check(absent.status === 404, 'absent session is 404', String(absent.status))

  const accepted = await commands[0].handler({ rawInput: '' })
  check(accepted.kind === 'success', '/md returns success')
  const rejected = await commands[0].handler({ rawInput: 'full' })
  check(rejected.kind === 'error', '/md rejects arguments')
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
