/**
 * Pure Markdown renderer for one Session log.
 *
 * No IO and no service access: this module only folds the committed event log
 * returned by `sessionQuery.readSession` into the readable export described in
 * REQUIREMENTS.md — dialogue only (user messages and assistant prose), one
 * heading per role change, plus the user's answers to `ask_user_question`.
 *
 * Tool calls, tool results, reasoning, system/developer messages and injected
 * context are deliberately dropped.
 */

/** The only tool whose *output* is human dialogue rather than tool noise. */
const ASK_TOOL = 'ask_user_question'

/** Heading text per role. Kept short so it reads as a section label. */
const ROLE_LABEL = { user: '👤 用户', assistant: '🤖 助手' }

/** Text used when the log carries no dialogue at all. */
const NO_DIALOGUE =
  '_该会话没有对话正文（内容为工具调用与命令）；完整过程请用内置的 /export 下载日志。_'

/** Replacement text for content this export cannot carry. */
const IMAGE_PLACEHOLDER = '（图片附件，导出文件不内嵌）'
const COMPACTED = '上下文已压缩：此前的消息已折叠为摘要'
const FALLBACK_TITLE = '会话记录'

/**
 * Format one epoch-millisecond instant in the host's local zone.
 * @param {number} ms - milliseconds since the Unix epoch.
 * @returns {string} `YYYY-MM-DD HH:mm`.
 */
export function formatMinute(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/**
 * Compact stamp used inside a download filename.
 * @param {number} ms - milliseconds since the Unix epoch.
 * @returns {string} `YYYYMMDD-HHmm`.
 */
export function formatStamp(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return 'export'
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`
}

/**
 * Turn a human title into a filename stem that survives every common filesystem.
 * @param {string} title - raw Session title.
 * @returns {string} sanitized stem, never empty.
 */
export function safeTitle(title) {
  const cleaned = String(title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const clipped = cleaned.slice(0, 60).trim()
  return clipped === '' || clipped === '.' || clipped === '..' ? '' : clipped
}

/**
 * Render one Session's dialogue as Markdown.
 * @param {object} input - the log snapshot and the wall-clock time of the export.
 * @param {{ id?: string, createdAt?: number }} input.header - Session header.
 * @param {readonly object[]} input.events - committed events in seq order.
 * @param {number} [input.now] - export instant, defaulting to `Date.now()`.
 * @returns {{ title: string, filename: string, markdown: string }} the deliverable.
 */
export function renderSession({ header, events, now = Date.now() }) {
  /** @type {{ role: 'user' | 'assistant' | 'divider', text: string }[]} */
  const blocks = []
  /** @type {Map<string, { name?: string, args?: string }>} */
  const pending = new Map()
  let title = ''

  /**
   * Append one dialogue paragraph, merging into the previous block when the
   * role did not change (a burst of retried messages stays one section).
   * @param {'user' | 'assistant'} role - speaker of this paragraph.
   * @param {string} text - already-normalized paragraph.
   */
  const push = (role, text) => {
    const body = text.trim()
    if (body === '') return
    const last = blocks[blocks.length - 1]
    if (last !== undefined && last.role === role) last.text += `\n\n${body}`
    else blocks.push({ role, text: body })
  }

  for (const event of Array.isArray(events) ? events : []) {
    const type = event?.type
    const data = event?.data ?? {}

    if (type === 'session/title') {
      if (typeof data.title === 'string' && data.title.trim() !== '') title = data.title.trim()
      continue
    }

    if (type === 'user/message') {
      // Only a human turn is dialogue; runtime context, skill catalogs and time
      // snapshots are injected by the harness and must not read as user speech.
      if (data.source?.kind !== 'user') continue
      push('user', renderContent(data.content))
      continue
    }

    if (type === 'assistant/message') {
      const content = data.message?.content
      if (!Array.isArray(content)) continue
      const prose = []
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string') prose.push(block.text)
        else if (block?.type === 'tool-call' && typeof block.id === 'string') {
          pending.set(block.id, { name: block.name, args: block.arguments })
        }
      }
      push('assistant', prose.join('\n\n'))
      continue
    }

    if (type === 'tool/call' && typeof data.callId === 'string') {
      pending.set(data.callId, { name: data.name, args: data.arguments })
      continue
    }

    if (type === 'tool/result') {
      const message = data.message ?? {}
      const callId = message.toolCallId ?? message.source?.callId
      if (typeof callId !== 'string') continue
      const call = pending.get(callId)
      pending.delete(callId)
      if (call?.name !== ASK_TOOL) continue
      push('user', renderAnswers(call.args, message.content))
      continue
    }

    if (type === 'compaction/summary') {
      blocks.push({ role: 'divider', text: COMPACTED })
    }
  }

  const heading = title === '' ? fallbackTitle(blocks) : title
  const markdown = assemble({ heading, header, blocks, now })
  return {
    title: heading,
    filename: `${safeTitle(heading) === '' ? 'session' : safeTitle(heading)}-${formatStamp(now)}.md`,
    markdown,
  }
}

/**
 * Flatten a declared content array into display text.
 * @param {readonly object[] | undefined} content - message content blocks.
 * @returns {string} paragraphs joined by a blank line.
 */
function renderContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block?.type === 'image') parts.push(IMAGE_PLACEHOLDER)
    else if (block?.type === 'file') {
      const name = block.attachment?.name
      parts.push(typeof name === 'string' && name !== '' ? `（附件：${name}）` : '（附件）')
    }
  }
  return parts.join('\n\n')
}

/**
 * Render the user's answers to one `ask_user_question` call as their own speech.
 *
 * The answers are the only human input that is recorded inside a tool result
 * rather than as a `user/message` event, so dropping them would remove real
 * dialogue from the export.
 * @param {string | undefined} args - the recorded JSON arguments of the call.
 * @param {readonly object[] | undefined} content - the tool result content.
 * @returns {string} one line per answered question, or an empty string.
 */
function renderAnswers(args, content) {
  const answers = parseAnswers(content)
  if (answers.length === 0) return ''
  const questions = parseQuestions(args)
  const lines = []
  for (const answer of answers) {
    const value = answerValue(answer)
    if (value === '') continue
    const label = questions.get(answer.id)
    lines.push(label === undefined ? value : `${label}：${value}`)
  }
  // One paragraph per answer: a single newline collapses into a space in most
  // renderers, which would run two answers together.
  return lines.join('\n\n')
}

/**
 * Read the `{ answers: [{ id, selected, custom }] }` payload out of a tool result.
 * @param {readonly object[] | undefined} content - the tool result content.
 * @returns {object[]} parsed answers, empty when the payload is unreadable.
 */
function parseAnswers(content) {
  if (!Array.isArray(content)) return []
  for (const block of content) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const start = block.text.indexOf('{')
    const end = block.text.lastIndexOf('}')
    if (start < 0 || end <= start) continue
    try {
      const parsed = JSON.parse(block.text.slice(start, end + 1))
      if (Array.isArray(parsed?.answers)) return parsed.answers
    } catch {
      // A malformed payload is not worth failing the whole export over.
    }
  }
  return []
}

/**
 * Map a question id to the short label shown next to its answer.
 * @param {string | undefined} args - the recorded JSON arguments of the call.
 * @returns {Map<string, string>} stable label per question id.
 */
function parseQuestions(args) {
  const labels = new Map()
  if (typeof args !== 'string') return labels
  try {
    const parsed = JSON.parse(args)
    for (const question of Array.isArray(parsed?.questions) ? parsed.questions : []) {
      if (typeof question?.id !== 'string') continue
      const label = question.header ?? question.question
      if (typeof label === 'string' && label.trim() !== '') labels.set(question.id, label.trim())
    }
  } catch {
    // Losing the label degrades to an unlabeled answer, never to a failed export.
  }
  return labels
}

/**
 * Normalize one answer: selected options joined for display, else free text.
 * @param {object} answer - one entry of the recorded answers array.
 * @returns {string} display value, empty when nothing was answered.
 */
function answerValue(answer) {
  if (Array.isArray(answer?.selected) && answer.selected.length > 0) {
    return answer.selected.filter((value) => typeof value === 'string').join('、')
  }
  return typeof answer?.custom === 'string' ? answer.custom.trim() : ''
}

/**
 * Imported sessions commonly carry no title; the first user line is the best proxy.
 * @param {readonly { role: string, text: string }[]} blocks - rendered dialogue.
 * @returns {string} a one-line fallback title.
 */
function fallbackTitle(blocks) {
  const first = blocks.find((block) => block.role === 'user')
  if (first === undefined) return FALLBACK_TITLE
  const line = first.text.split('\n').find((value) => value.trim() !== '')
  const clipped = (line ?? '').trim().slice(0, 40)
  return clipped === '' ? FALLBACK_TITLE : clipped
}

/**
 * Assemble the final document: heading, one metadata line, then the dialogue.
 * @param {object} input - heading, header, blocks and the export instant.
 * @returns {string} the Markdown document.
 */
function assemble({ heading, header, blocks, now }) {
  const meta = []
  if (typeof header?.id === 'string' && header.id !== '') meta.push(header.id)
  const created = formatMinute(header?.createdAt)
  if (created !== '') meta.push(created)

  const out = [`# ${heading}`, '']
  if (meta.length > 0) out.push(`> ${meta.join(' · ')}`, '')

  const dialogue = blocks.filter((block) => block.role !== 'divider')
  if (dialogue.length === 0) {
    out.push(NO_DIALOGUE, '')
    return `${out.join('\n').trimEnd()}\n`
  }

  for (const block of blocks) {
    if (block.role === 'divider') {
      out.push(`> ⓘ ${block.text}`, '')
      continue
    }
    out.push(`**${ROLE_LABEL[block.role]}**`, '', block.text, '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

/**
 * One safe, document-relative route the browser can address.
 * Mirrors the Host registration in `index.js`.
 */
export const EXPORT_ROUTE = 'api/session.markdown'

/**
 * Build a `content-disposition` value that survives non-ASCII titles.
 * @param {string} filename - the preferred, possibly non-ASCII filename.
 * @param {string} sessionId - used for the ASCII fallback name.
 * @returns {string} the header value.
 */
export function contentDisposition(filename, sessionId) {
  const ascii = `dsh-session-${String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/gu, '_')}.md`
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
