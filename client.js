window.__ModuleLoader__.load({
  id: 'dsh-session-md-export',
  /**
   * Browser half: one compact Session-header button that downloads the Markdown
   * the Host half renders. It owns no export logic — only the gesture, the
   * in-flight state and the failure text.
   */
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Must mirror `EXPORT_ROUTE` in `render.js`; the halves cannot import each other. */
    const ROUTE = 'api/session.markdown'
    const NS = 'session-md-export'

    const zh = {
      'action.export': '导出为 Markdown',
      'action.working': '正在导出…',
      'action.done': '已开始下载',
      'error.failed': '导出失败',
    }
    const en = {
      'action.export': 'Export as Markdown',
      'action.working': 'Exporting…',
      'action.done': 'Download started',
      'error.failed': 'Export failed',
    }

    /**
     * Minimal per-Session phase store; `useSyncExternalStore` needs a stable
     * snapshot reference, which replacement-on-write provides.
     * @returns {{ get: Function, subscribe: Function, set: Function }}
     */
    function createStore() {
      let entries = {}
      const listeners = new Set()
      return {
        get(sessionId) {
          return entries[String(sessionId)]
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(sessionId, entry) {
          entries = { ...entries, [String(sessionId)]: entry }
          for (const listener of listeners) listener()
        },
      }
    }

    /**
     * Read the preferred filename out of a `content-disposition` header.
     * @param {string | null} disposition - the raw header value.
     * @returns {string | undefined} the decoded filename.
     */
    function filenameFrom(disposition) {
      if (typeof disposition !== 'string') return undefined
      const utf8 = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)
      if (utf8 !== null) {
        try {
          return decodeURIComponent(utf8[1])
        } catch {
          // Fall through to the ASCII name below.
        }
      }
      const plain = /filename="([^"]*)"/iu.exec(disposition)
      return plain?.[1]
    }

    /**
     * Hand a finished blob to the browser download manager.
     * @param {Blob} blob - the rendered document.
     * @param {string} filename - preferred local filename.
     */
    function saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      anchor.style.display = 'none'
      anchor.click()
      // The download manager keeps its own reference; release ours shortly after.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }

    /** @param {unknown} error - anything thrown while exporting. */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error)
    }

    const ICONS = {
      download: [
        ['path', { d: 'M8 2.6v6.4' }],
        ['path', { d: 'M5.4 6.7 8 9.3l2.6-2.6' }],
        ['path', { d: 'M3 11.4v1.2a.9.9 0 0 0 .9.9h8.2a.9.9 0 0 0 .9-.9v-1.2' }],
      ],
      working: [['circle', { cx: 8, cy: 8, r: 4.6, opacity: 0.45 }]],
      done: [['path', { d: 'M3.6 8.4 6.5 11.3 12.4 4.7' }]],
      error: [
        ['path', { d: 'M8 3.4v5.1' }],
        ['circle', { cx: 8, cy: 11.5, r: 0.85, fill: 'currentColor', stroke: 'none' }],
      ],
    }

    /**
     * @param {keyof ICONS} name - glyph to draw.
     * @returns {object} the icon element.
     */
    function icon(name) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        ICONS[name].map(([tag, attributes], index) => h(tag, { key: index, ...attributes })),
      )
    }

    /**
     * One right-aligned header control; never opens a panel or takes focus away.
     * @param {object} props - standard slot props plus this plugin's injections.
     * @returns {object | null} the control, or nothing without a Session.
     */
    function ExportButton(props) {
      const sessionId = props.sessionId
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const store = props.statusStore
      const request = props.requestExport
      const entry = React.useSyncExternalStore(
        store.subscribe,
        () => store.get(sessionId),
        () => undefined,
      )
      const [hover, setHover] = React.useState(false)

      const phase = entry?.phase ?? 'idle'

      // Reset the transient success/failure state so the next click starts clean.
      React.useEffect(() => {
        if (phase !== 'done' && phase !== 'error') return undefined
        const timer = window.setTimeout(() => store.set(sessionId, { phase: 'idle' }), phase === 'done' ? 2200 : 8000)
        return () => window.clearTimeout(timer)
      }, [phase, sessionId, store])

      if (sessionId === undefined || sessionId === null) return null

      const busy = phase === 'working'
      const failed = phase === 'error'
      const label = busy
        ? t('action.working')
        : phase === 'done'
          ? t('action.done')
          : t('action.export')

      return h(
        React.Fragment,
        null,
        failed
          ? h(
              'span',
              {
                role: 'status',
                title: entry?.message ?? t('error.failed'),
                style: {
                  color: 'var(--dsw-alias-state-error-primary)',
                  fontSize: '11px',
                  lineHeight: '16px',
                  maxWidth: '12em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginInlineEnd: '4px',
                },
              },
              entry?.message === undefined ? t('error.failed') : `${t('error.failed')}：${entry.message}`,
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            title: label,
            'aria-label': label,
            'aria-busy': busy,
            disabled: busy,
            onClick: () => request(sessionId),
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              flex: 'none',
              border: 'none',
              borderRadius: '6px',
              background: hover && !busy ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
              color: failed
                ? 'var(--dsw-alias-state-error-primary)'
                : 'var(--dsw-alias-label-secondary)',
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.6 : 1,
            },
          },
          icon(busy ? 'working' : failed ? 'error' : phase === 'done' ? 'done' : 'download'),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Mount the control and route both gestures (button and `/md`) to one
       * downloader, so the Session header and the command never diverge.
       * @param {object} ctx - browser context carrying slots and locale.
       */
      apply(ctx) {
        const store = createStore()
        /** @type {Map<string, AbortController>} */
        const active = new Map()

        /**
         * Fetch the rendered document and hand it to the browser.
         * @param {string} sessionId - Session to export.
         */
        async function requestExport(sessionId) {
          const key = String(sessionId)
          if (active.has(key)) return
          const controller = new AbortController()
          active.set(key, controller)
          store.set(key, { phase: 'working' })
          try {
            const query = new URLSearchParams({ sessionId: key })
            const response = await fetch(`${ROUTE}?${query.toString()}`, {
              signal: controller.signal,
            })
            if (!response.ok) {
              const detail = (await response.text().catch(() => '')).trim()
              throw new Error(detail === '' ? `HTTP ${response.status}` : detail)
            }
            const blob = await response.blob()
            saveBlob(blob, filenameFrom(response.headers.get('content-disposition')) ?? `${key}.md`)
            store.set(key, { phase: 'done' })
          } catch (error) {
            if (controller.signal.aborted) return
            store.set(key, { phase: 'error', message: messageOf(error) })
          } finally {
            active.delete(key)
          }
        }

        ctx.effect(
          () => ctx.locale.register(NS, { zh, en }),
          'session-md-export: browser dictionaries',
        )

        // A typed `/md` is the same operation as the button, not a second one.
        ctx.effect(
          () =>
            ctx.on('command/executed', (sessionId, commandName, result) => {
              if (commandName === 'md' && result?.kind === 'success') requestExport(sessionId)
            }),
          'session-md-export: command bridge',
        )

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'session-md-export',
              order: 20,
              locale: NS,
              inject: () => ({ requestExport, statusStore: store }),
            },
            ExportButton,
          ),
        )
      },
    }
  },
})
