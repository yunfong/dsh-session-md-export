/**
 * Host half: the authenticated Markdown download route and the `/md` command.
 *
 * The route is the single implementation of the export; the button in the
 * Session header and the `/md` command both drive it, so the Client half only
 * decides *when* to download, never *what*.
 *
 * @module
 */

import { EXPORT_ROUTE, contentDisposition, renderSession } from './render.js'

/** Absolute path this plugin registers; the browser addresses it document-relative. */
const ROUTE_PATH = `/${EXPORT_ROUTE}`

/** Services this plugin cannot work without. */
export const inject = ['commands', 'connection']

/** Command that requests the same export the header button performs. */
const COMMAND_NAME = 'md'

/** Requested-export acknowledgement; the browser half turns it into a download. */
const COMMAND_ACCEPTED = { kind: 'success', text: 'Markdown 导出已开始。' }

/**
 * Register the download route and the `/md` command.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => exportResponse(ctx, request),
      }),
    'session-md-export: download route',
  )

  ctx.effect(
    () =>
      ctx.commands.register({
        name: COMMAND_NAME,
        description: 'Export this Session as a readable Markdown file',
        handler: (invocation) =>
          invocation.rawInput.trim() === ''
            ? COMMAND_ACCEPTED
            : { kind: 'error', text: '/md does not accept arguments.' },
      }),
    'session-md-export: command',
  )
}

/**
 * Answer one export request.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context, read lazily so
 * a backend mounted after this plugin is still used.
 * @param {Request} request - the authenticated request.
 * @returns {Promise<Response>} the Markdown document, or a plain-text failure.
 */
async function exportResponse(ctx, request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return failure(405, 'method not allowed')
  }

  const url = new URL(request.url)
  const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
  if (sessionId === '') return failure(400, 'missing sessionId query parameter')

  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) {
    return failure(503, 'session export is unavailable: missing session-query service')
  }

  let snapshot
  try {
    snapshot = await sessionQuery.readSession(sessionId)
  } catch (error) {
    return failure(isMissingSession(error) ? 404 : 500, messageOf(error))
  }

  let rendered
  try {
    rendered = renderSession({ header: snapshot?.session, events: snapshot?.events })
  } catch (error) {
    return failure(500, `failed to render session: ${messageOf(error)}`)
  }

  const headers = {
    'cache-control': 'no-store',
    'content-disposition': contentDisposition(rendered.filename, sessionId),
    'content-type': 'text/markdown; charset=utf-8',
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(rendered.markdown, { status: 200, headers })
}

/**
 * A small plain-text failure response the Client half surfaces verbatim.
 * @param {number} status - HTTP status.
 * @param {string} message - what went wrong.
 * @returns {Response} the failure response.
 */
function failure(status, message) {
  return new Response(message, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Distinguish a genuinely absent Session from a read failure.
 * @param {unknown} error - the rejection from `readSession`.
 * @returns {boolean} true when the Session does not exist.
 */
function isMissingSession(error) {
  const name = error?.name ?? error?.constructor?.name ?? ''
  if (name === 'SessionPersistenceNotFoundError') return true
  const message = messageOf(error)
  return /not found|no such session|does not exist|ENOENT/iu.test(message)
}

/**
 * @param {unknown} error - anything thrown by a service call.
 * @returns {string} a message safe to hand to the page.
 */
function messageOf(error) {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}
