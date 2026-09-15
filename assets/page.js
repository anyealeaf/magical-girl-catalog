/**
 * dsh-magical-girl-catalog — 单页应用客户端（原生 JS，无构建步骤）
 *
 * 结构：一个 URL + hash 路由。首页 + 四个板块（世界观 / 魔法少女图鉴 / 大事件 / 关注安叶！）。
 *
 * 两条纪律（见 DSH-PLUGIN-NOTES.md「四、调试方法」）：
 *   1. 任何失败都要在页面上留下可读痕迹 —— 图片读不到要显示原因，接口失败要弹提示。
 *   2. 判断放到能写日志的服务端；客户端只负责搬运与呈现，不做过滤与丢弃。
 *
 * 权限：只读 / 可编辑。可编辑时出现增删改按钮；只读时按钮不渲染（而不是点了没反应）。
 */
;(function () {
  'use strict'

  // ---- 运行时配置（服务端注入的 application/json，不是内联脚本）-------------
  var CFG = readConfig()
  var API = (CFG && CFG.api) || '/dsh-magical-girl-catalog/api'

  /** 板块定义：顺序 = 首页磁贴顺序 = 顶栏顺序。 */
  var BOARDS = [
    { key: 'world', path: 'world', name: '世界观设定', icon: '🌍', desc: '世界的基本规则与设定条目' },
    { key: 'characters', path: 'characters', name: '魔法少女图鉴', icon: '✨', desc: '按角色卡查看每一位魔法少女' },
    { key: 'events', path: 'events', name: '大事件记录', icon: '📜', desc: '书中出现过的大事件' },
    { key: 'links', path: 'links', name: '关注安叶！', icon: '💜', desc: '找到作者与作品' },
  ]

  /** 编辑表单的字段定义。**加字段只改这里**，服务端与渲染都不需要动。 */
  var FIELDS = {
    characters: [
      { k: 'realName', label: '本名', type: 'text', ph: '例如：林晗' },
      { k: 'codename', label: '魔法少女代号', type: 'text', ph: '例如：晕彩' },
      { k: 'aliases', label: '其它称呼', type: 'text', ph: '用顿号或逗号分隔，如：紫罗兰、小彩' },
      { k: 'icon', label: '图标（表情包）', type: 'icon', ph: '一个 emoji，如 🌙' },
      { k: 'tagline', label: '一句话', type: 'text' },
      {
        k: 'images',
        label: '角色图（可多张）',
        type: 'textarea',
        rows: '5',
        note: '一行一个路径。第一张用在图鉴卡片上，详情页可以翻动查看全部。',
      },
      { k: 'height', label: '身高', type: 'text', ph: '如：142cm；未明示就写「未明示」' },
      { k: 'age', label: '年龄', type: 'text', ph: '如：28岁；未明示就写「未明示」' },
      { k: 'level', label: '魔力等级', type: 'text', ph: '种／芽／苞／花／果' },
      { k: 'weapon', label: '武装（只写名称）', type: 'text', ph: '如：裁光、折光、棱镜辉光' },
      { k: 'magic', label: '奇术（只写名称）', type: 'text', ph: '如：析光' },
      { k: 'domain', label: '领域（只写名称）', type: 'text', ph: '如：未明示 / 无' },
      { k: 'summary', label: '简介', type: 'textarea' },
      { k: 'detail', label: '角色描述', type: 'textarea', note: '描述区最上面那段自由正文，留空则不显示' },
      {
        k: 'desc.weapons',
        label: '武装 · 具体描述',
        type: 'lines',
        rows: '4',
        note: '一行一件武装。最后一行可以写总注（例如「三件彼此独立，不可合并」）',
      },
      { k: 'desc.weaponsNote', label: '武装 · 总注（可选）', type: 'textarea', rows: '2' },
      { k: 'desc.magic', label: '奇术 · 具体描述', type: 'textarea' },
      { k: 'desc.domain', label: '领域 · 具体描述', type: 'textarea' },
      { k: 'desc.note', label: '补充（其他能力／开华／边界）', type: 'textarea', rows: '4' },
    ],
    world: [
      { k: 'title', label: '条目标题', type: 'text' },
      { k: 'category', label: '分类', type: 'text', ph: '如：地理 / 力量体系' },
      { k: 'icon', label: '图标（表情包）', type: 'icon', ph: '一个 emoji' },
      { k: 'body', label: '内容', type: 'textarea' },
    ],
    events: [
      { k: 'title', label: '事件名称', type: 'text' },
      { k: 'date', label: '时间', type: 'text', ph: '如：第一卷 第三章' },
      { k: 'icon', label: '图标（表情包）', type: 'icon', ph: '一个 emoji' },
      { k: 'summary', label: '简述', type: 'textarea' },
      { k: 'detail', label: '详情', type: 'textarea' },
    ],
    links: [
      { k: 'title', label: '名称', type: 'text', ph: '如：安叶的 bilibili 主页' },
      { k: 'url', label: '链接', type: 'text', ph: 'https://…' },
      { k: 'icon', label: '图标（表情包）', type: 'icon', ph: '一个 emoji' },
      {
        k: 'image',
        label: '配图（可选）',
        type: 'text',
        note: '一张图片的文件名或路径，会显示在卡片上方。番茄小说分享图就用这个位置。',
      },
      { k: 'badge', label: '角标', type: 'text', ph: '如：必看 / 最新章节' },
      { k: 'desc', label: '说明', type: 'textarea' },
    ],
  }

  // ---- 状态 ---------------------------------------------------------------
  var state = {
    data: null,
    unlocked: !!(CFG && CFG.unlocked),
    route: parseRoute(),
    loading: true,
    bootError: null,
    warning: null,
  }

  var els = {}
  var toastTimer = null

  // =========================================================================
  // 基础设施
  // =========================================================================

  function readConfig() {
    var node = document.getElementById('mgc-config')
    if (!node) {
      // 占位符没被替换或元素缺失 —— 不能静默，页面会拿不到 api 前缀
      console.error('[mgc] 找不到 #mgc-config，将退回默认路径')
      return null
    }
    try {
      return JSON.parse(node.textContent || '{}')
    } catch (e) {
      console.error('[mgc] 配置不是合法 JSON：' + e.message)
      return null
    }
  }

  /**
   * 建 DOM。attrs.text 走 textContent（**不用 innerHTML** —— 内容可能来自
   * 用户输入，别引入 XSS）；on* 走 addEventListener。
   *
   * ⚠️ **刻意不支持 `style`**。页面的 CSP 是 `style-src 'self'`（无 unsafe-inline），
   * `setAttribute('style', ...)` 会被浏览器**静默丢弃** —— 不报错、不生效，
   * 只留下一句容易忽略的 CSP 警告。首页封面就是这么整整一版没显示出来的。
   * 这里直接拒绝并打日志，把「静默失效」变成「开发期就看得见的错」。
   * 要动态设样式用 CSSOM（`node.style.backgroundImage = ...`，CSP 不管它），
   * 静态样式写进 page.css 的类。
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag)
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k]
        if (v === null || v === undefined || v === false) continue
        if (k === 'text') node.textContent = String(v)
        else if (k === 'class') node.className = v
        else if (k === 'style')
          console.error(
            '[mgc] el() 不接受 style（页面 CSP 会把它丢掉）—— 改用 CSS 类，或 node.style.xxx = ...：' +
              String(tag) +
              ' ' +
              String(v),
          )
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v)
        else if (v === true) node.setAttribute(k, '')
        else node.setAttribute(k, String(v))
      }
    }
    ;(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return node
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
    return node
  }

  function announce(msg) {
    if (els.announce) els.announce.textContent = String(msg)
  }

  function toast(msg, kind) {
    if (!els.toast) return
    els.toast.textContent = String(msg)
    els.toast.className = 'toast' + (kind ? ' ' + kind : '')
    els.toast.hidden = false
    announce(msg)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(
      function () {
        els.toast.hidden = true
      },
      kind === 'err' ? 5200 : 2600,
    )
  }

  /** 只放行 http/https 的外链 —— 防止数据里混进 javascript: 之类。 */
  function safeHref(url) {
    var s = String(url == null ? '' : url).trim()
    if (!s) return ''
    if (/^https?:\/\//i.test(s)) return s
    if (/^\/\//.test(s)) return 'https:' + s
    return ''
  }

  /** background-image 里嵌 URL：转义会拆坏 CSS 的字符。 */
  function cssUrl(url) {
    return String(url).replace(/["'\\\n\r]/g, function (c) {
      return '\\' + c
    })
  }

  // ---- 网络 ---------------------------------------------------------------

  function request(url, init) {
    var opts = init || {}
    var ctl = typeof AbortController === 'function' ? new AbortController() : null
    if (ctl) {
      opts.signal = ctl.signal
      setTimeout(function () {
        try {
          ctl.abort()
        } catch (e) {}
      }, 15000)
    }
    opts.credentials = 'same-origin'
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (text) {
        var json = null
        try {
          json = JSON.parse(text)
        } catch (e) {
          throw new Error('HTTP ' + r.status + '，响应不是 JSON：' + text.slice(0, 200))
        }
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status + '：' + ((json && json.error) || '请求失败'))
          err.status = r.status
          throw err
        }
        return json
      })
    })
  }

  function loadData() {
    // 静态导出（GitHub Pages 那种纯静态托管）没有后端，数据由构建时内联在
    // #mgc-data 里。有它就直接用，不发请求 —— 这样同一份 page.js 既能跑原站，
    // 也能跑静态站，不必维护两个分支。
    var inline = readInlineData()
    if (inline) {
      state.data = inline
      state.unlocked = false
      state.warning = inline.__warning || null
      state.bootError = null
      return Promise.resolve()
    }

    return request(API + '/data.json')
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || '服务端返回了失败状态')
        state.data = res.data
        state.unlocked = !!res.unlocked
        state.warning = res.warning || null
        state.bootError = null
      })
      .catch(function (err) {
        // 把两种情况翻译成人能照着做的说法。不然启动失败只会显示
        // 「HTTP 401：unauthorized」，作者不知道该去干什么。
        var msg = (err && err.message) || String(err)
        if (err && err.status === 401) {
          throw new Error('未认证（401）：请先在这个浏览器里登录 DSH，再打开本页')
        }
        if (err && err.status === 403) {
          throw new Error(
            '被拒（403）：DSH 的信任栅栏认为这个请求不是本机同源页面发来的。' +
              '常见原因是「从外站页面点链接进来」—— 请在地址栏直接输入本页地址。',
          )
        }
        throw new Error(msg)
      })
  }

  /** 读取构建时内联的静态数据；静态站才有这个节点。 */
  function readInlineData() {
    var node = document.getElementById('mgc-data')
    if (!node) return null
    try {
      return JSON.parse(node.textContent || 'null')
    } catch (e) {
      console.error('[mgc] 内联数据不是合法 JSON：' + e.message)
      return null
    }
  }

  function saveEntry(kind, id, patch) {
    var url = API + '/entry/' + kind + (id ? '/' + encodeURIComponent(id) : '')
    return request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(applyResponse)
  }

  function deleteEntry(kind, id) {
    return request(API + '/entry/' + kind + '/' + encodeURIComponent(id), { method: 'DELETE' }).then(
      applyResponse,
    )
  }

  function toggleHidden(id) {
    return request(API + '/toggle.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    }).then(applyResponse)
  }

  function applyResponse(res) {
    if (res && res.data) state.data = res.data
    if (res && typeof res.unlocked === 'boolean') state.unlocked = res.unlocked
    render()
    return res
  }

  /** 写操作的统一错误处理：403 就是没解锁，要明确提示而不是笼统报错。 */
  function reportError(err, what) {
    var msg = (err && err.message) || String(err)
    if (err && err.status === 403) {
      state.unlocked = false
      render()
      toast('没有编辑权限：请先输入编辑秘钥', 'err')
      openAuthDialog()
      return
    }
    if (/HTTP 401/.test(msg)) {
      toast('未认证（401）：请先登录 DSH 再打开本页', 'err')
      return
    }
    toast((what || '操作') + '失败：' + msg, 'err')
    console.error('[mgc]', what, err)
  }

  // =========================================================================
  // 路由
  // =========================================================================

  function parseRoute() {
    var raw = String(location.hash || '').replace(/^#/, '')
    if (!raw || raw === '/') return { name: 'home' }
    var parts = raw.replace(/^\//, '').split('/').filter(Boolean)
    if (!parts.length) return { name: 'home' }
    var head = parts[0]
    if (head === 'character' && parts[1]) return { name: 'character', id: decodeURIComponent(parts[1]) }
    for (var i = 0; i < BOARDS.length; i++) {
      if (BOARDS[i].path === head) return { name: 'board', board: BOARDS[i] }
    }
    // 不认识的 hash：不静默留在空白页，回首页并说明
    console.warn('[mgc] 不认识的路径：' + raw)
    return { name: 'home', unknown: raw }
  }

  function go(hash) {
    if (location.hash === hash) {
      state.route = parseRoute()
      render()
      return
    }
    location.hash = hash
  }

  function boardHref(board) {
    return '#/' + board.path
  }

  function characterHref(id) {
    return '#/character/' + encodeURIComponent(id)
  }

  // =========================================================================
  // 渲染
  // =========================================================================

  function render() {
    document.title = (state.data && state.data.settings.title) || '魔法少女目录'
    renderBar()
    renderView()
    renderLock()
  }

  /** 静态站：没有后端，任何「编辑」入口点了都只会报错，所以直接不显示。 */
  var READONLY = !!(CFG && CFG.readonly)

  function renderLock() {
    if (READONLY) {
      // 给读者一个明确的「这是只读站」标记，而不是一个坏掉的编辑按钮
      if (els.lock) {
        els.lock.hidden = false
        els.lock.textContent = '只读'
      }
      if (els.auth) els.auth.hidden = true
      return
    }
    if (!els.lock) return
    els.lock.hidden = state.unlocked
    if (els.auth) {
      els.auth.textContent = state.unlocked ? '已解锁' : '编辑'
      els.auth.className = 'btn ' + (state.unlocked ? 'btn-ghost' : 'btn-primary')
    }
  }

  function renderBar() {
    els.title.textContent = (state.data && state.data.settings.title) || '魔法少女目录'
    clear(els.nav)
    BOARDS.forEach(function (b) {
      var current =
        (state.route.name === 'board' && state.route.board.key === b.key) ||
        (state.route.name === 'character' && b.key === 'characters')
      els.nav.appendChild(
        el(
          'a',
          {
            href: boardHref(b),
            'aria-current': current ? 'page' : null,
          },
          [iconNode(b.icon), el('span', { text: ' ' + b.name })],
        ),
      )
    })
  }

  function renderView() {
    var v = clear(els.view)

    if (state.bootError) {
      v.appendChild(
        el('div', { class: 'wrap' }, [
          el('div', { class: 'empty' }, [
            el('div', { class: 'big', text: '⚠️' }),
            el('div', { text: '读不到数据：' + state.bootError }),
            el('button', {
              class: 'btn btn-primary mt-14',
              text: '重试',
              onclick: function () {
                boot()
              },
            }),
          ]),
        ]),
      )
      return
    }

    if (state.loading || !state.data) {
      v.appendChild(el('div', { class: 'wrap' }, [el('div', { class: 'empty', text: '加载中…' })]))
      return
    }

    if (state.warning) {
      v.appendChild(
        el('div', { class: 'wrap wrap-flush' }, [
          el('p', { class: 'dialog-error', text: '⚠️ ' + state.warning }),
        ]),
      )
    }

    if (state.route.name === 'home') renderHome(v)
    else if (state.route.name === 'character') renderCharacterDetail(v)
    else if (state.route.name === 'board') renderBoard(v, state.route.board)
  }

  // ---- 首页 ---------------------------------------------------------------

  function renderHome(v) {
    var s = state.data.settings
    var hero = el('section', { class: 'hero' })

    if (s.coverImageUrl) {
      // ⚠️ 必须用 CSSOM 设背景，不能写成 { style: 'background-image:...' }。
      // 后者是 setAttribute('style')，会被页面的 CSP（style-src 'self'，无
      // unsafe-inline）**静默丢掉** —— 首页封面图因此一整个不显示，而且
      // Console 里只有一条容易被忽略的 CSP 警告。CSSOM 不受 CSP 管辖。
      var bg = el('div', { class: 'hero-bg' })
      bg.style.backgroundImage = 'url("' + cssUrl(s.coverImageUrl) + '")'
      hero.appendChild(bg)
    }
    hero.appendChild(el('div', { class: 'hero-scrim' }))

    var inner = el('div', { class: 'hero-inner' })
    inner.appendChild(el('h1', { class: 'hero-title', text: s.title || '魔法少女目录' }))
    if (s.subtitle) inner.appendChild(el('p', { class: 'hero-sub', text: s.subtitle }))

    // 背景图加载失败必须说出来 —— 否则作者只会看到一片渐变，以为是设计
    if (s.coverImageUrl) {
      var probe = new Image()
      probe.addEventListener('error', function () {
        if (inner.querySelector('.hero-img-error')) return
        inner.appendChild(
          el('div', {
            class: 'hero-img-error',
            text:
              '⚠️ 首页背景图读不到：' +
              (s.coverImage || '') +
              '（新窗口打开 ' +
              s.coverImageUrl +
              ' 看具体原因）',
          }),
        )
      })
      probe.src = s.coverImageUrl
    }

    var tiles = el('div', { class: 'tiles' })
    BOARDS.forEach(function (b) {
      var items = state.data[b.key] || []
      var visible = items.filter(function (e) {
        return !e.hidden
      })
      tiles.appendChild(
        el('a', { class: 'tile', href: boardHref(b) }, [
          // 图标位：作者之后填表情包（emoji 或图片都行）
          el('div', { class: 'tile-icon' }, [iconNode(b.icon)]),
          el('div', { class: 'tile-name', text: b.name }),
          el('div', { class: 'tile-desc', text: b.desc }),
          visible.length ? el('div', { class: 'tile-count', text: String(visible.length) }) : null,
        ]),
      )
    })
    inner.appendChild(tiles)

    if (s.footerNote) inner.appendChild(el('p', { class: 'hero-foot', text: s.footerNote }))

    hero.appendChild(inner)
    v.appendChild(hero)
  }

  // ---- 板块 ---------------------------------------------------------------

  function renderBoard(v, board) {
    var items = state.data[board.key] || []
    // 读者不该看到被作者藏起来的条目；作者要能看到才能改
    var visible = state.unlocked
      ? items
      : items.filter(function (e) {
          return !e.hidden
        })

    var wrap = el('div', { class: 'wrap' })
    var head = el('div', { class: 'board-head' }, [
      el('h1', {}, [el('span', { class: 'board-icon' }, [iconNode(board.icon)]), el('span', { text: board.name })]),
      visible.length ? el('span', { class: 'count', text: visible.length + ' 条' }) : null,
      el('span', { class: 'grow' }),
    ])
    if (state.unlocked && !READONLY) {
      head.appendChild(
        el('button', {
          class: 'btn btn-primary btn-sm',
          text: '＋ 新增',
          onclick: function () {
            openEditor(board.key, null)
          },
        }),
      )
    }
    wrap.appendChild(head)
    wrap.appendChild(el('p', { class: 'board-desc', text: board.desc }))

    if (!visible.length) {
      wrap.appendChild(renderEmpty(board, items.length))
      v.appendChild(wrap)
      return
    }

    if (board.key === 'characters') wrap.appendChild(renderCharacterGrid(visible))
    else if (board.key === 'links') wrap.appendChild(renderLinkGrid(visible))
    else wrap.appendChild(renderEntryList(board.key, visible))

    v.appendChild(wrap)
  }

  function renderEmpty(board, total) {
    var hint =
      total > 0
        ? '这个板块有 ' + total + ' 条内容，但当前都处于「隐藏」状态。'
        : state.unlocked
          ? '还没有内容。点右上角「＋ 新增」开始录入。'
          : '这个板块还没有内容。'
    return el('div', { class: 'empty' }, [
      el('div', { class: 'big' }, [iconNode(board.icon, '📦')]),
      el('div', { text: board.name + '：' + hint }),
      el('div', { class: 'hint', text: '内容由作者维护' }),
    ])
  }

  // ---- 图片 ---------------------------------------------------------------

  /** 找一个角色（关系网要按 id 反查头像与名字）。 */
  function characterById(id) {
    return (state.data.characters || []).find(function (c) {
      return c.id === id
    })
  }

  /** 角色显示名：本名 +（代号）。 */
  function displayName(ch) {
    if (!ch) return ''
    if (ch.realName && ch.codename) return ch.realName + '（' + ch.codename + '）'
    return ch.realName || ch.codename || '（未命名）'
  }

  // ---- 图标位（表情包）----------------------------------------------------

  /**
   * 图标位是**一个字段两种填法**：填 emoji 就画 emoji，填图片路径就画图片。
   *
   * 这里只认服务端算好的 `iconUrl`（静态导出时是构建期算的），客户端不自己
   * 判断「这串字符是不是图片」—— 判断放在一处，才不会出现「服务端当图片、
   * 客户端当文字」这种各说各话的情况。
   *
   * @param {object|string} src 带 icon / iconUrl 的条目，或直接给一个 emoji 字符串
   * @param {string} [fallback] 没填 icon 时用的字
   */
  function iconNode(src, fallback) {
    var entry = typeof src === 'string' ? { icon: src } : src || {}
    var text = entry.icon || fallback || ''
    var url = entry.iconUrl || ''

    if (!url) return el('span', { class: 'icon-text', text: text })

    var img = el('img', { class: 'icon-img', src: url, alt: text || '图标', loading: 'lazy' })
    img.addEventListener('error', function () {
      // 图读不到就退回一个看得见的记号，并把路径与原因挂在 title 上。
      // 退回原来的文字是错的：填的是路径，画一行 `人设图\魔王.png` 只会让人
      // 以为「这个位置不支持插图」—— 那正是这次要修的那个 bug。
      img.hidden = true
      console.warn('[mgc] 图标图片读不到：' + (entry.icon || ''))
      var mark = el('span', { class: 'icon-text icon-broken', text: '⚠', title: '图标读不到：' + (entry.icon || '') })
      // 用 appendChild 而不是 insertBefore(img.nextSibling)：图片已经 hidden 了，
      // 位置没有区别，而少一个 DOM API 依赖。
      if (img.parentNode) img.parentNode.appendChild(mark)
    })
    return img
  }

  function announceImgError(box, url, shown) {
    if (box.querySelector('.img-error')) return
    box.appendChild(
      el('div', {
        class: 'img-error',
        text: '⚠️ 图片读不到：' + shown + '（新窗口打开 ' + url + ' 看原因）',
      }),
    )
  }

  /**
   * 图鉴卡片上的卡图：**只有一个角色有多张图时也只显示第一张**。
   * 没有图 → 占位提示；加载失败 → 显示原因（绝不静默变空白）。
   */
  function cardFigure(ch, extraClass) {
    var box = el('div', { class: extraClass || 'char-figure' })
    var urls = ch.imageUrls || []
    var url = urls[0] || ch.imageUrl || ''

    if (!url) {
      box.appendChild(
        el('div', { class: 'placeholder' }, [
          el('div', { class: 'glyph' }, [iconNode(ch, '✨')]),
          el('div', { text: state.unlocked ? '还没有卡图 —— 点「编辑」填图片路径' : '暂无卡图' }),
        ]),
      )
      return box
    }

    // 占位层先留着：图没加载出来时它就是背景，图片盖在它上面
    box.appendChild(el('div', { class: 'placeholder' }, [el('div', { class: 'glyph' }, [iconNode(ch, '✨')])]))

    var img = el('img', { src: url, alt: displayName(ch), loading: 'lazy' })
    img.addEventListener('error', function () {
      img.hidden = true
      announceImgError(box, url, (ch.images && ch.images[0]) || '')
    })
    box.appendChild(img)
    return box
  }

  /**
   * 详情页图库：主图 + 缩略图条。一个角色可以有多张图，点缩略图切换。
   * 主图读不到时显示具体原因；某张缩略图读不到就把它标灰，不影响其它图。
   */
  function gallery(ch) {
    var box = el('div', { class: 'gallery' })
    var urls = ch.imageUrls || []
    var shown = ch.images || []

    var main = el('div', { class: 'gallery-main' })
    var mainImg = null
    var placeholder = el('div', { class: 'placeholder' }, [
      el('div', { class: 'glyph' }, [iconNode(ch, '✨')]),
      el('div', { text: urls.length ? '' : state.unlocked ? '还没有角色图 —— 点「编辑」填图片路径' : '暂无角色图' }),
    ])
    main.appendChild(placeholder)

    function show(i) {
      var err = main.querySelector('.img-error')
      if (err) err.remove()
      var url = urls[i]
      if (!url) return
      if (mainImg) mainImg.remove()
      mainImg = el('img', { src: url, alt: displayName(ch) })
      mainImg.addEventListener('error', function () {
        mainImg.hidden = true
        announceImgError(main, url, shown[i] || '')
      })
      main.appendChild(mainImg)
      ;(box._thumbs || []).forEach(function (t, ti) {
        t.setAttribute('aria-current', ti === i ? 'true' : 'false')
      })
    }

    box.appendChild(main)

    if (urls.length > 1) {
      var strip = el('div', { class: 'gallery-thumbs', role: 'tablist', 'aria-label': '角色图' })
      box._thumbs = []
      urls.forEach(function (url, i) {
        var t = el('button', {
          class: 'gallery-thumb',
          type: 'button',
          'aria-current': i === 0 ? 'true' : 'false',
          title: shown[i] || '',
        })
        var ti = el('img', { src: url, alt: '', loading: 'lazy' })
        ti.addEventListener('error', function () {
          ti.hidden = true
          t.style.opacity = '0.4'
          t.title = '这张图读不到：' + (shown[i] || '')
        })
        t.appendChild(ti)
        t.addEventListener('click', function () {
          show(i)
        })
        strip.appendChild(t)
        box._thumbs.push(t)
      })
      box.appendChild(strip)
    } else {
      box._thumbs = []
    }

    if (urls.length) show(0)
    return box
  }

  /** 关系图里的头像（无图时退回图标）。 */
  function relAvatar(ch) {
    var box = el('div', { class: 'rel-avatar' })
    var url = ch && (ch.imageUrl || (ch.imageUrls || [])[0])
    if (!url) {
      box.appendChild(el('div', { class: 'glyph' }, [iconNode(ch, ch ? '✨' : '❔')]))
      return box
    }
    var img = el('img', { src: url, alt: displayName(ch), loading: 'lazy' })
    img.addEventListener('error', function () {
      img.hidden = true
      box.appendChild(el('div', { class: 'glyph' }, [iconNode(ch, '✨')]))
    })
    box.appendChild(img)
    return box
  }

  // ---- 关系网（当前只为晕彩填了数据，其余角色留白） ----------------------

  function renderRelations(ch) {
    var list = ch.connections || []
    var box = el('div', { class: 'rel' })

    // 中心：当前角色
    box.appendChild(
      el('div', { class: 'rel-center' }, [
        relAvatar(ch),
        el('div', { class: 'rel-name', text: displayName(ch) }),
        el('div', { class: 'rel-sub', text: '当前角色' }),
      ]),
    )

    if (!list.length) {
      box.appendChild(el('div', { class: 'rel-connector' }))
      box.appendChild(
        el('div', { class: 'empty w-full' }, [
          el('div', { text: '这个角色的关系网还没有录入' }),
          el('div', {
            class: 'hint',
            text: state.unlocked ? '点上面的「编辑」填关系（其余角色之后补）' : '内容由作者维护',
          }),
        ]),
      )
      return box
    }

    box.appendChild(el('div', { class: 'rel-connector' }))

    var nodes = el('div', { class: 'rel-nodes' })
    list.forEach(function (conn) {
      var other = characterById(conn.id)
      if (!other) {
        // 关系指向一个已删除/不存在的角色：显示出来而不是静默丢弃
        nodes.appendChild(
          el('div', { class: 'rel-node' }, [
            relAvatar(null),
            el('div', { class: 'rel-name', text: '（找不到这个角色）' }),
            el('div', { class: 'rel-label', text: (conn.label || '') + (conn.id ? ' · ' + conn.id : '') }),
          ]),
        )
        return
      }
      nodes.appendChild(
        el('a', { class: 'rel-node', href: characterHref(other.id), title: '查看 ' + displayName(other) }, [
          relAvatar(other),
          el('div', { class: 'rel-name', text: other.codename || other.realName || '（未命名）' }),
          el('div', { class: 'rel-label', text: conn.label || '' }),
        ]),
      )
    })
    box.appendChild(nodes)
    return box
  }

  // ---- 基本信息总览 -------------------------------------------------------

  var UNKNOWN_VALUES = ['未明示', '未明', '未知', '待补', '—', '-']

  /** 一个字段该显示什么：空 → 未明示；未明示/无 → 用弱化样式区分。 */
  function infoValue(raw) {
    var s = String(raw === undefined || raw === null ? '' : raw).trim()
    if (!s) return { text: '未明示', weak: true }
    if (UNKNOWN_VALUES.indexOf(s) >= 0) return { text: s, weak: true }
    if (s === '无' || s === '不适用') return { text: s, weak: true }
    return { text: s, weak: false }
  }

  function infoRows(ch) {
    // 顺序固定：姓名、代号、身高、年龄、魔力等级、武装、奇术、领域
    var specs = [
      { k: 'realName', label: '姓名', alias: true },
      { k: 'codename', label: '魔法少女代号' },
      { k: 'height', label: '身高' },
      { k: 'age', label: '年龄' },
      { k: 'level', label: '魔力等级' },
      { k: 'weapon', label: '武装', note: '此处只列名称，具体描述见下方' },
      { k: 'magic', label: '奇术', note: '此处只列名称，具体描述见下方' },
      { k: 'domain', label: '领域', note: '此处只列名称，具体描述见下方' },
    ]
    var dl = el('dl', { class: 'info-grid' })
    specs.forEach(function (s) {
      var raw = s.alias ? ch.realName || ch.codename : ch[s.k]
      var v = infoValue(raw)
      var dd = el('dd', { class: v.weak ? 'is-unknown' : '' }, [el('span', { text: v.text })])
      if (s.note) dd.appendChild(el('div', { class: 'field-note', text: s.note }))
      dl.appendChild(el('div', { class: 'info-row' }, [el('dt', { text: s.label }), dd]))
    })
    return dl
  }

  /** 别名行：本名/代号之外的其它称呼（紫罗兰、小彩、陛下……）。 */
  function aliasRow(ch) {
    var raw = String(ch.aliases || '').trim()
    if (!raw) return null
    var parts = raw
      .split(/[、,，\/|]+/)
      .map(function (s) {
        return s.trim()
      })
      .filter(Boolean)
    if (!parts.length) return null
    var row = el('div', { class: 'alias-row' }, [el('span', { text: '其它称呼：' })])
    parts.forEach(function (p) {
      row.appendChild(el('span', { class: 'tag', text: p }))
    })
    return row
  }

  // ---- 描述区 -------------------------------------------------------------
  //
  // 数据来自 character.desc（结构化）：
  //   { weapons: [每件武装一条], weaponsNote, magic, domain, note }
  // 拆成结构化字段而不是一坨长文本，是为了让作者能逐条改。
  // 缺内容的项显示「待填充」占位，有内容就显示正文 —— 不静默留白。

  /** 有内容就渲染正文，没有就退回占位（并标注待填充）。 */
  function descBlock(title, body, placeholderText) {
    var has = typeof body === 'string' ? body.trim() !== '' : Array.isArray(body) && body.length > 0
    if (!has) return placeholderBlock(title, placeholderText)
    var kids = [el('h3', {}, [el('span', { text: title }), el('span', { class: 'ph-tag done', text: '已录入' })])]
    if (Array.isArray(body)) {
      var ul = el('ul', { class: 'desc-list' })
      body.forEach(function (line) {
        ul.appendChild(el('li', { text: line }))
      })
      kids.push(ul)
    } else {
      kids.push(el('p', { text: body }))
    }
    return el('div', { class: 'placeholder-block filled' }, kids)
  }

  function placeholderBlock(title, desc) {
    return el('div', { class: 'placeholder-block' }, [
      el('h3', {}, [el('span', { text: title }), el('span', { class: 'ph-tag', text: '待填充' })]),
      el('p', { text: desc }),
    ])
  }

  function renderDescriptions(ch) {
    var d = ch.desc || {}
    var box = el('div', { class: 'detail-body' })

    var sec = el('section', { class: 'detail-section' }, [el('h2', { text: '描述' })])

    // 角色描述（自由正文）：作者写了才显示。没写就不占位 ——
    // 下面三项已经把设定讲清楚了，再挂一个空占位只会显得内容没写完。
    if (ch.detail) {
      sec.appendChild(
        el('div', { class: 'placeholder-block filled' }, [
          el('h3', {}, [el('span', { text: '角色描述' }), el('span', { class: 'ph-tag done', text: '已录入' })]),
          el('p', { text: ch.detail }),
        ]),
      )
    }

    // 武装：逐件列出，末尾可带一条总注（三件独立、消耗性资源之类）
    var weaponsBody = (d.weapons || []).slice()
    if (d.weaponsNote) weaponsBody.push(d.weaponsNote)
    sec.appendChild(descBlock('武装', weaponsBody, '每一件武装的形态、能力与限制。'))

    sec.appendChild(descBlock('奇术', d.magic || '', '奇术的本质、表现方式与代价。'))
    sec.appendChild(descBlock('领域', d.domain || '', '领域的名称、效果与使用条件。'))

    // 补充：其他能力、开华状态、边界等，有才显示
    if (d.note) {
      sec.appendChild(
        el('div', { class: 'placeholder-block filled' }, [
          el('h3', {}, [el('span', { text: '补充' }), el('span', { class: 'ph-tag done', text: '已录入' })]),
          el('p', { text: d.note }),
        ]),
      )
    }

    box.appendChild(sec)
    return box
  }

  // ---- 板块 2：角色卡 -----------------------------------------------------

  function renderCharacterGrid(items) {
    var grid = el('div', { class: 'card-grid' })
    items.forEach(function (ch) {
      var card = el('article', { class: 'char-card' + (ch.hidden ? ' is-hidden' : '') })

      card.appendChild(
        el('a', { class: 'char-link', href: characterHref(ch.id) }, [
          cardFigure(ch),
          el('div', { class: 'char-meta' }, [
            // 卡片下方写名字：有本名就写本名，没本名就退回代号（不能显示成「未命名」）
            el('div', { class: 'char-real', text: ch.realName || ch.codename || '（未命名）' }),
            ch.realName
              ? ch.codename
                ? el('div', { class: 'char-codename', text: ch.codename })
                : el('div', { class: 'char-codename none', text: '尚未有代号' })
              : null,
          ]),
        ]),
      )

      // 图标位（表情包）
      if (ch.icon) card.appendChild(el('div', { class: 'char-icon' }, [iconNode(ch)]))
      if (ch.hidden) card.appendChild(el('div', { class: 'char-badge', text: '已隐藏' }))

      if (state.unlocked && !READONLY) {
        card.appendChild(
          el('div', { class: 'char-tools' }, [
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              text: '编辑',
              onclick: function (e) {
                e.preventDefault()
                openEditor('characters', ch.id)
              },
            }),
            el('button', {
              class: 'btn btn-sm',
              type: 'button',
              text: ch.hidden ? '显示' : '隐藏',
              onclick: function (e) {
                e.preventDefault()
                doToggle(ch.id)
              },
            }),
          ]),
        )
      }
      grid.appendChild(card)
    })
    return grid
  }

  // ---- 板块 1 / 3：条目列表 ------------------------------------------------

  function renderEntryList(kind, items) {
    var list = el('div', { class: 'entry-list' })
    items.forEach(function (en) {
      var row = el('article', { class: 'entry' + (en.hidden ? ' is-hidden' : '') })

      // 条目边上的图标位（表情包，emoji 或图片）
      row.appendChild(el('div', { class: 'entry-icon' + (en.icon ? '' : ' empty') }, [iconNode(en, '＋')]))

      var main = el('div', { class: 'entry-main' })
      main.appendChild(
        el('div', { class: 'entry-title' }, [
          el('span', { text: en.title || '（未命名）' }),
          en.category ? el('span', { class: 'entry-cat', text: en.category }) : null,
          en.date ? el('span', { class: 'entry-date', text: en.date }) : null,
          en.hidden ? el('span', { class: 'entry-cat', text: '已隐藏' }) : null,
        ]),
      )

      var body = en.body || en.summary || ''
      if (body) main.appendChild(el('div', { class: 'entry-body', text: body }))
      if (en.detail && en.detail !== body) main.appendChild(el('div', { class: 'entry-body', text: en.detail }))
      row.appendChild(main)

      if (state.unlocked && !READONLY) {
        row.appendChild(
          el('div', { class: 'entry-tools' }, [
            el('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: '编辑',
              onclick: function () {
                openEditor(kind, en.id)
              },
            }),
            el('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: en.hidden ? '显示' : '隐藏',
              onclick: function () {
                doToggle(en.id)
              },
            }),
          ]),
        )
      }
      list.appendChild(row)
    })
    return list
  }

  // ---- 板块 4：链接 -------------------------------------------------------

  function renderLinkGrid(items) {
    var grid = el('div', { class: 'link-grid' })
    items.forEach(function (ln) {
      var href = safeHref(ln.url)
      var kids = []

      // 配图（可选）：番茄小说分享卡这种整张海报，放在文字上方而不是挤进图标位。
      if (ln.imageUrl) {
        var fig = el('div', { class: 'link-figure' })
        var figImg = el('img', { src: ln.imageUrl, alt: ln.title || '配图', loading: 'lazy' })
        figImg.addEventListener('error', function () {
          figImg.hidden = true
          announceImgError(fig, ln.imageUrl, ln.image || '')
        })
        fig.appendChild(figImg)
        kids.push(fig)
      }

      kids.push(
        el('div', { class: 'link-body' }, [
          el('div', { class: 'entry-icon' + (ln.icon ? '' : ' empty') }, [iconNode(ln, '🔗')]),
          el('div', { class: 'link-main' }, [
            el('div', { class: 'link-title' }, [
              el('span', { text: ln.title || '（未命名链接）' }),
              ln.badge ? el('span', { class: 'link-badge', text: ln.badge }) : null,
            ]),
            // 「没有填链接」是给作者看的提醒，不是给读者的内容。
            // 有些卡片（分享图）本来就没有网址，读者不该看到这行占位。
            ln.url
              ? el('div', { class: 'link-url', text: ln.url })
              : state.unlocked && !READONLY
                ? el('div', { class: 'link-url', text: '没有填链接' })
                : null,
            ln.desc ? el('div', { class: 'link-desc', text: ln.desc }) : null,
          ]),
        ]),
      )

      var cardClass = 'link-card' + (ln.imageUrl ? ' has-figure' : '') + (ln.hidden ? ' is-hidden' : '')
      var card = href
        ? el('a', { class: cardClass, href: href, target: '_blank', rel: 'noopener noreferrer' }, kids)
        : el('div', { class: cardClass }, kids)

      var holder = el('div', {}, [card])
      // 没填链接或链接不合法：不做成可点的，但也要显示出来让人发现
      if (ln.url && !href) {
        holder.appendChild(el('div', { class: 'link-desc', text: '⚠️ 链接不是 http(s)，未启用点击' }))
      }

      if (state.unlocked && !READONLY) {
        holder.appendChild(
          el('div', { class: 'entry-tools mt-8' }, [
            el('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: '编辑',
              onclick: function () {
                openEditor('links', ln.id)
              },
            }),
            el('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              text: ln.hidden ? '显示' : '隐藏',
              onclick: function () {
                doToggle(ln.id)
              },
            }),
          ]),
        )
      }
      grid.appendChild(holder)
    })
    return grid
  }

  // ---- 角色详情 -----------------------------------------------------------
  //
  // 页面结构（自上而下）：
  //   ① 角色图库（左） + 基本信息总览（右）
  //   ② 关系网（头像可点，跳转到对应角色）
  //   ③ 描述区：武装 / 奇术 / 领域的具体描述（当前为占位）

  function renderCharacterDetail(v) {
    var ch = characterById(state.route.id)

    var wrap = el('div', { class: 'wrap' })
    if (!ch) {
      wrap.appendChild(
        el('div', { class: 'empty' }, [
          el('div', { class: 'big', text: '🔍' }),
          el('div', { text: '找不到这个角色（可能已被删除）' }),
          el('a', {
            class: 'btn btn-primary btn-inline',
            href: '#/characters',
            text: '回到图鉴',
          }),
        ]),
      )
      v.appendChild(wrap)
      return
    }

    var head = el('div', { class: 'board-head' }, [
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/characters', text: '← 图鉴' }),
      el('span', { class: 'grow' }),
    ])
    if (state.unlocked && !READONLY) {
      head.appendChild(
        el('button', {
          class: 'btn btn-ghost btn-sm',
          text: ch.hidden ? '显示' : '隐藏',
          onclick: function () {
            doToggle(ch.id)
          },
        }),
      )
      head.appendChild(
        el('button', {
          class: 'btn btn-primary btn-sm',
          text: '编辑',
          onclick: function () {
            openEditor('characters', ch.id)
          },
        }),
      )
    }
    wrap.appendChild(head)

    // ① 图库 + 基本信息总览
    var top = el('div', { class: 'detail-top' })
    top.appendChild(gallery(ch))

    var names = el('div', { class: 'detail-names' }, [
      el('h1', {}, [
        ch.icon ? el('span', { class: 'detail-icon' }, [iconNode(ch)]) : null,
        el('span', { text: ch.realName || ch.codename || '（未命名）' }),
      ]),
      ch.codename
        ? el('div', { class: 'detail-codename', text: '魔法少女代号：' + ch.codename })
        : el('div', { class: 'detail-codename none', text: '尚未有代号' }),
    ])
    var aliases = aliasRow(ch)
    if (aliases) names.appendChild(aliases)
    if (ch.tagline) names.appendChild(el('p', { class: 'detail-tagline', text: ch.tagline }))

    names.appendChild(infoRows(ch))

    // 「简介」栏暂不显示：详情页的信息块统一只保留八项 + 别名。
    // 数据里的 summary 字段仍然保留（导出、编辑表单都还在），只是不渲染 ——
    // 以后要放回来的话，在关系网之前插一段就行。
    // 注意：如果哪天放回来，务必确认里面没有「第 N 章」这类章节坐标、
    // 也没有「不得写成…」这类给自己看的创作提醒（verify-seed 有闸门）。

    // 预留字段：作者往数据里加的 extra 字段会自动列在这里，不需要改代码
    var extras = Object.keys(ch.extra || {})
    if (extras.length) {
      var dl = el('dl', { class: 'kv' })
      extras.forEach(function (k) {
        dl.appendChild(el('dt', { text: k }))
        dl.appendChild(el('dd', { text: String(ch.extra[k]) }))
      })
      names.appendChild(dl)
    }
    top.appendChild(names)
    wrap.appendChild(top)

    // ② 关系网
    wrap.appendChild(
      el('section', { class: 'detail-section mt-22' }, [
        el('h2', { text: '关系网' }),
        renderRelations(ch),
      ]),
    )

    // ③ 描述区
    wrap.appendChild(renderDescriptions(ch))

    v.appendChild(wrap)
  }

  // =========================================================================
  // 编辑
  // =========================================================================

  function boardLabel(kind) {
    var b = BOARDS.find(function (x) {
      return x.key === kind
    })
    return b ? b.name : kind
  }

  // 字段键可以是「desc.weapons」这种点号路径（对应嵌套对象）。
  // 表单里用一个扁平字符串当键，提交时再展开回嵌套结构。
  function getPath(obj, path) {
    var parts = String(path).split('.')
    var cur = obj
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined
      cur = cur[parts[i]]
    }
    return cur
  }

  function draftFrom(kind, entry) {
    var draft = {}
    FIELDS[kind].forEach(function (f) {
      // 嵌套字段从 entry.desc.xxx 取；普通字段直接取
      var v = entry ? (f.k.indexOf('.') >= 0 ? getPath(entry, f.k) : entry[f.k]) : ''
      // 多值字段在表单里是「一行一个」的文本，这里来回转换
      if (f.type === 'lines') draft[f.k] = Array.isArray(v) ? v.join('\n') : v || ''
      else draft[f.k] = v || ''
    })
    draft.hidden = !!(entry && entry.hidden)
    return draft
  }

  /** 提交前把「一行一个」的字段换回数组，并把点号键展开成嵌套对象。 */
  function draftToPatch(kind, draft) {
    var patch = {}
    Object.keys(draft).forEach(function (k) {
      if (k.indexOf('.') >= 0) return // 嵌套键稍后单独处理
      patch[k] = draft[k]
    })
    FIELDS[kind].forEach(function (f) {
      var value
      if (f.type === 'lines') {
        value = String(draft[f.k] || '')
          .split('\n')
          .map(function (s) {
            return s.trim()
          })
          .filter(Boolean)
      } else {
        value = draft[f.k]
      }
      if (f.k.indexOf('.') < 0) {
        patch[f.k] = value
        return
      }
      // desc.weapons -> patch.desc.weapons
      var parts = f.k.split('.')
      var cur = patch
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = value
    })
    return patch
  }

  var editorCtx = { kind: null, id: null, draft: null }

  // ---- 图标位的图片支持 ---------------------------------------------------

  /**
   * 支持的图片扩展名。**默认值只是兜底**：真正的一份在服务端
   * （`/api/images.json` 的 exts），打开选择器时会覆盖这里。前端不复刻规则，
   * 否则以后服务端加一种图片类型，这里就成了「明明支持却判成文字」的坑。
   */
  var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']

  /**
   * 用当前正在编辑的值（还没保存）拼一个预览 URL。
   * 只对「看起来是图片」的值给 URL；emoji 等文字返回 ''，由 iconNode 画文字。
   */
  function draftIconUrl(src) {
    var raw = String(src == null ? '' : src).trim()
    if (!raw) return ''
    var lower = raw.toLowerCase()
    var isImg = IMG_EXTS.some(function (e) {
      return lower.slice(-e.length) === e
    })
    // 静态站没有转发接口，拼出来的 URL 必然 404 —— 与其画个碎图标，不如画文字
    if (!isImg || READONLY || !API) return ''
    return API + '/image?src=' + encodeURIComponent(raw)
  }

  var iconPicker = { images: null, dirs: [], error: '', onPick: null, filter: '' }

  /** 图标位字段：文本框 + 实时预览 + 「从图片里选」。 */
  function iconField(f, draft) {
    var input = el('input', { type: 'text', placeholder: f.ph || '' })
    input.value = draft[f.k] || ''

    var preview = el('div', { class: 'icon-preview', title: '预览' })

    function refresh() {
      var value = draft[f.k] || ''
      clear(preview)
      preview.appendChild(iconNode({ icon: value, iconUrl: draftIconUrl(value) }, '＋'))
      preview.setAttribute(
        'data-kind',
        !value ? '空' : draftIconUrl(value) ? '图片' : '文字',
      )
    }

    input.addEventListener('input', function () {
      draft[f.k] = input.value
      refresh()
    })
    refresh()

    var row = el('div', { class: 'icon-row' }, [
      input,
      preview,
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        text: '从图片里选…',
        onclick: function () {
          openIconPicker(function (picked) {
            draft[f.k] = picked
            input.value = picked
            refresh()
          })
        },
      }),
    ])

    var label = el('label', { class: 'field' }, [el('span', { text: f.label }), row])
    label.appendChild(
      el('span', {
        class: 'note',
        text: f.note || '填 emoji 就显示 emoji；填图片名（如 晕彩.png）或绝对路径就显示图片。',
      }),
    )
    return label
  }

  function openIconPicker(onPick) {
    iconPicker.onPick = onPick
    iconPicker.filter = ''
    els.iconFilter.value = ''
    els.iconError.hidden = true
    els.iconError.textContent = ''
    els.iconDialog.showModal()
    renderIconList()

    // 清单只取一次；作者换了图片目录就刷新页面。
    if (iconPicker.images) return
    clear(els.iconList).appendChild(el('div', { class: 'muted', text: '读取图片列表…' }))
    request(API + '/images.json')
      .then(function (res) {
        iconPicker.images = res.images || []
        iconPicker.dirs = res.dirs || []
        if (res.exts && res.exts.length) IMG_EXTS = res.exts
        iconPicker.error = iconPicker.images.length ? '' : res.hint || '受控目录里没有找到图片。'
        renderIconList()
      })
      .catch(function (err) {
        iconPicker.error = (err && err.message) || String(err)
        renderIconList()
      })
  }

  function renderIconList() {
    if (!els.iconList) return
    var box = clear(els.iconList)

    if (iconPicker.error) {
      box.appendChild(el('div', { class: 'empty', text: '读不到图片清单：' + iconPicker.error }))
      return
    }
    if (!iconPicker.images) return

    var q = iconPicker.filter.trim().toLowerCase()
    var list = iconPicker.images.filter(function (im) {
      return !q || im.rel.toLowerCase().indexOf(q) >= 0
    })
    if (!list.length) {
      box.appendChild(
        el('div', { class: 'muted', text: q ? '没有匹配「' + iconPicker.filter + '」的图片' : '没有图片' }),
      )
      return
    }

    list.forEach(function (im) {
      var url = API + '/image?src=' + encodeURIComponent(im.rel)
      var btn = el('button', { class: 'icon-pick', type: 'button', title: im.rel }, [
        el('img', { src: url, alt: im.name, loading: 'lazy' }),
        el('span', { class: 'icon-pick-name', text: im.name }),
        el('span', { class: 'icon-pick-dir', text: im.dir }),
      ])
      btn.addEventListener('click', function () {
        if (iconPicker.onPick) iconPicker.onPick(im.rel)
        els.iconDialog.close()
      })
      box.appendChild(btn)
    })
  }

  function openEditor(kind, id) {
    if (!state.unlocked) {
      openAuthDialog()
      return
    }
    var entry = id
      ? (state.data[kind] || []).find(function (e) {
          return e.id === id
        })
      : null
    if (id && !entry) {
      toast('找不到要编辑的条目（可能已被删除）', 'err')
      return
    }
    editorCtx = { kind: kind, id: id, draft: draftFrom(kind, entry) }

    els.editTitle.textContent = (id ? '编辑' : '新增') + ' · ' + boardLabel(kind)
    els.editError.hidden = true
    els.editError.textContent = ''
    buildEditBody()
    els.editDialog.showModal()
  }

  function buildEditBody() {
    var body = clear(els.editBody)
    var draft = editorCtx.draft

    FIELDS[editorCtx.kind].forEach(function (f) {
      if (f.type === 'icon') {
        body.appendChild(iconField(f, draft))
        return
      }
      var isMulti = f.type === 'textarea' || f.type === 'lines'
      var input = isMulti
        ? el('textarea', { rows: f.rows || (f.k === 'detail' ? '7' : '3') })
        : el('input', { type: 'text', placeholder: f.ph || '' })
      input.value = draft[f.k] || ''
      input.addEventListener('input', function () {
        draft[f.k] = input.value
      })

      var label = el('label', { class: 'field' }, [el('span', { text: f.label }), input])
      if (f.note) label.appendChild(el('span', { class: 'note', text: f.note }))
      body.appendChild(label)
    })

    // 隐藏 / 删除只对已存在的条目出现
    if (editorCtx.id) {
      var cb = el('input', { type: 'checkbox' })
      cb.checked = !!draft.hidden
      cb.addEventListener('change', function () {
        draft.hidden = cb.checked
      })
      body.appendChild(
        el('label', { class: 'field field-inline' }, [
          cb,
          el('span', { text: '在网页上隐藏这个条目（内容仍在，作者可见）' }),
        ]),
      )

      body.appendChild(
        el('div', { class: 'mt-4' }, [
          el('button', {
            class: 'btn btn-danger btn-sm',
            type: 'button',
            text: '删除这个条目',
            onclick: function () {
              if (!window.confirm('确定删除？这一步不可撤销。')) return
              doDelete(editorCtx.kind, editorCtx.id)
            },
          }),
        ]),
      )
    }
  }

  function doSaveEditor() {
    var kind = editorCtx.kind
    var id = editorCtx.id
    var patch = draftToPatch(kind, editorCtx.draft)
    els.editSave.disabled = true
    els.editError.hidden = true
    saveEntry(kind, id, patch)
      .then(function () {
        els.editDialog.close()
        toast(id ? '已保存' : '已新增', 'ok')
      })
      .catch(function (err) {
        els.editError.textContent = (err && err.message) || String(err)
        els.editError.hidden = false
      })
      .then(function () {
        els.editSave.disabled = false
      })
  }

  function doDelete(kind, id) {
    deleteEntry(kind, id)
      .then(function () {
        els.editDialog.close()
        toast('已删除', 'ok')
        // 删掉的正是当前正在看的角色 → 回图鉴
        if (state.route.name === 'character' && state.route.id === id) go('#/characters')
      })
      .catch(function (err) {
        reportError(err, '删除')
      })
  }

  function doToggle(id) {
    toggleHidden(id)
      .then(function (res) {
        toast(res && res.hidden ? '已隐藏' : '已显示', 'ok')
      })
      .catch(function (err) {
        reportError(err, '切换显示状态')
      })
  }

  // ---- 秘钥 ---------------------------------------------------------------

  function openAuthDialog() {
    els.authError.hidden = true
    els.authError.textContent = ''
    els.authKey.value = ''
    els.authDialog.showModal()
  }

  function doUnlock() {
    var key = els.authKey.value
    if (!key) {
      els.authError.textContent = '请先填秘钥'
      els.authError.hidden = false
      return
    }
    els.authSubmit.disabled = true
    els.authError.hidden = true
    request(API + '/auth.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock', key: key }),
    })
      .then(function () {
        state.unlocked = true
        els.authDialog.close()
        toast('已解锁，可以编辑了', 'ok')
        return loadData()
      })
      .then(render)
      .catch(function (err) {
        els.authError.textContent = (err && err.message) || String(err)
        els.authError.hidden = false
      })
      .then(function () {
        els.authSubmit.disabled = false
      })
  }

  function doLock() {
    request(API + '/auth.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock' }),
    })
      .then(function () {
        state.unlocked = false
        toast('已退出编辑模式', 'ok')
        return loadData()
      })
      .then(render)
      .catch(function (err) {
        reportError(err, '退出编辑')
      })
  }

  // =========================================================================
  // 启动
  // =========================================================================

  function camel(s) {
    return s.replace(/-([a-z])/g, function (_, c) {
      return c.toUpperCase()
    })
  }

  function cacheEls() {
    els.view = document.getElementById('view')
    els.toast = document.getElementById('toast')
    els.announce = document.getElementById('mgc-announce')
    els.editDialog = document.getElementById('edit-dialog')
    els.authDialog = document.getElementById('auth-dialog')
    els.iconDialog = document.getElementById('icon-dialog')

    ;[
      'title', 'nav', 'lock', 'auth',
      'edit-title', 'edit-body', 'edit-error', 'edit-cancel', 'edit-save',
      'auth-key', 'auth-error', 'auth-cancel', 'auth-submit',
      'icon-filter', 'icon-list', 'icon-error', 'icon-cancel', 'icon-clear',
    ].forEach(function (name) {
      var node = document.querySelector('[data-bind="' + name + '"]')
      if (!node) console.warn('[mgc] 页面里找不到 data-bind="' + name + '"')
      els[camel(name)] = node
    })
  }

  function wire() {
    if (els.auth) {
      els.auth.addEventListener('click', function () {
        if (state.unlocked && !READONLY) {
          if (window.confirm('退出编辑模式？（内容不会被修改）')) doLock()
        } else {
          openAuthDialog()
        }
      })
    }
    if (els.authCancel) {
      els.authCancel.addEventListener('click', function () {
        els.authDialog.close()
      })
    }
    if (els.authSubmit) els.authSubmit.addEventListener('click', doUnlock)
    if (els.authKey) {
      els.authKey.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault()
          doUnlock()
        }
      })
    }
    if (els.editCancel) {
      els.editCancel.addEventListener('click', function () {
        els.editDialog.close()
      })
    }
    if (els.editSave) els.editSave.addEventListener('click', doSaveEditor)

    if (els.iconCancel) {
      els.iconCancel.addEventListener('click', function () {
        els.iconDialog.close()
      })
    }
    if (els.iconClear) {
      els.iconClear.addEventListener('click', function () {
        if (iconPicker.onPick) iconPicker.onPick('')
        els.iconDialog.close()
      })
    }
    if (els.iconFilter) {
      els.iconFilter.addEventListener('input', function () {
        iconPicker.filter = els.iconFilter.value || ''
        renderIconList()
      })
    }

    window.addEventListener('hashchange', function () {
      state.route = parseRoute()
      render()
      window.scrollTo(0, 0)
    })
  }

  function boot() {
    state.loading = true
    render()
    return loadData()
      .then(function () {
        state.loading = false
        render()
      })
      .catch(function (err) {
        state.loading = false
        state.bootError = (err && err.message) || String(err)
        render()
      })
  }

  function start() {
    cacheEls()
    wire()
    boot()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
