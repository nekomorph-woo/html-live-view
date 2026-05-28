'use babel';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { fileURLToPath, pathToFileURL } = require('url');
const { CompositeDisposable, Emitter } = require('atom');
const { resolvePaths, resolveUrl } = require('./path-resolver');
const { getBridgeScript } = require('./bridge-script');
const { toggleDevTools } = require('./devtools');

const PROTOCOL = 'html-live-view';
const PROTOCOL_PREFIX = PROTOCOL + '://';
const TMP_DIR = path.join(os.tmpdir(), PROTOCOL);

function getAttribute(tag, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  return match ? (match[1] || match[2] || match[3] || '') : null;
}

function stripUrlSuffix(url) {
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  let end = url.length;
  if (hashIndex !== -1) end = Math.min(end, hashIndex);
  if (queryIndex !== -1) end = Math.min(end, queryIndex);
  return url.slice(0, end);
}

function isLocalAssetUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const value = url.trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value.toLowerCase().startsWith('file:');
  return true;
}

function localAssetPath(url, baseDir) {
  const value = stripUrlSuffix(url.trim());
  if (value.toLowerCase().startsWith('file:')) return fileURLToPath(value);
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function resolveCssUrls(css, baseDir) {
  return css.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (match, quote, url) => 'url(' + quote + resolveUrl(url, baseDir) + quote + ')'
  );
}

function inlineLocalAssets(html, baseDir) {
  let result = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = getAttribute(tag, 'rel') || '';
    const href = getAttribute(tag, 'href');
    if (!/\bstylesheet\b/i.test(rel) || !isLocalAssetUrl(href)) return tag;

    try {
      const assetPath = localAssetPath(href, baseDir);
      const css = resolveCssUrls(fs.readFileSync(assetPath, 'utf8'), path.dirname(assetPath));
      return '<style data-html-live-view-href="' + href.replace(/"/g, '&quot;') + '">\n' + css + '\n</style>';
    } catch (err) {
      console.warn('[html-live-view] Failed to inline stylesheet:', href, err.message);
      return tag;
    }
  });

  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    const src = getAttribute(tag, 'src');
    if (!isLocalAssetUrl(src)) return tag;

    try {
      const assetPath = localAssetPath(src, baseDir);
      const js = fs.readFileSync(assetPath, 'utf8');
      return '<script data-html-live-view-src="' + src.replace(/"/g, '&quot;') + '">\n' + js + '\n</script>';
    } catch (err) {
      console.warn('[html-live-view] Failed to inline script:', src, err.message);
      return tag;
    }
  });

  return result;
}

let _sourceModePaths = new Set();

function writeClipboard(text) {
  if (!text) return false;
  if (atom.clipboard && typeof atom.clipboard.write === 'function') {
    atom.clipboard.write(text);
    return true;
  }

  try {
    require('electron').clipboard.writeText(text);
    return true;
  } catch (err) {
    atom.notifications.addError('Failed to copy text', { detail: err.message });
    return false;
  }
}

class HtmlLiveView {
  constructor(textEditorOrPath) {
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();

    this.element = document.createElement('div');
    this.element.classList.add('html-live-view');
    this.element.htmlLiveView = this;

    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', this._buildSandboxAttr());
    this.element.appendChild(this.iframe);

    if (typeof textEditorOrPath === 'string') {
      this.filePath = textEditorOrPath;
      this.textEditor = null;
      this.fileName = path.basename(this.filePath);
      this._loadFromDisk();
    } else {
      this.textEditor = textEditorOrPath;
      this.filePath = textEditorOrPath.getPath();
      this.fileName = path.basename(this.filePath);
      this._renderContent(textEditorOrPath.getText() || '');
    }

    this._messageHandler = (event) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === 'navigate') {
        try {
          const result = require('electron').shell.openExternal(data.url);
          if (result && typeof result.catch === 'function') {
            result.catch((err) => {
              atom.notifications.addError('Failed to open link', { detail: err.message });
            });
          }
        } catch (err) {
          atom.notifications.addError('Failed to open link', { detail: err.message });
        }
      } else if (data.type === 'console') {
        const method = data.level === 'error' ? 'error' : data.level === 'warn' ? 'warn' : 'log';
        console[method]('[html-live-view]', ...data.args);
      } else if (data.type === 'error') {
        console.error('[html-live-view]', data.message, data.url, 'line:', data.line, data.stack);
      } else if (data.type === 'toggle') {
        atom.commands.dispatch(atom.views.getView(atom.workspace), 'html-live-view:toggle');
      } else if (data.type === 'copy') {
        this._lastSelectedText = data.selectedText || '';
        this.copySelection();
      } else if (data.type === 'context-menu') {
        this._lastSelectedText = data.selectedText || '';
        this._lastLinkUrl = data.linkUrl || '';
        this._showContextMenu(data);
      }
    };
    window.addEventListener('message', this._messageHandler);

    this._debounceMs = atom.config.get('html-live-view.debounceDelay');
    this._debounceTimer = null;
    this._currentMtime = null;

    if (atom.config.get('html-live-view.autoReload')) {
      this._startWatching();
    }
    this.disposables.add(
      atom.config.observe('html-live-view.autoReload', (val) => {
        if (val) this._startWatching();
        else this._stopWatching();
      })
    );
    this.disposables.add(
      atom.config.observe('html-live-view.debounceDelay', (val) => {
        this._debounceMs = val;
      })
    );
  }

  _startWatching() {
    if (this._watching) return;
    this._watching = true;
    fs.watchFile(this.filePath, { interval: 500 }, (cur, prev) => {
      if (cur.mtime > prev.mtime) {
        this._currentMtime = cur.mtime;
        this._scheduleReload();
      }
    });
  }

  _stopWatching() {
    if (!this._watching) return;
    this._watching = false;
    fs.unwatchFile(this.filePath);
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  _scheduleReload() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._loadFromDisk();
    }, this._debounceMs);
  }

  refresh() {
    this._stopWatching();
    this._loadFromDisk();
    if (atom.config.get('html-live-view.autoReload')) {
      this._startWatching();
    }
  }

  _buildSandboxAttr() {
    const parts = ['allow-scripts'];
    if (atom.config.get('html-live-view.sandboxAllowForms')) parts.push('allow-forms');
    if (atom.config.get('html-live-view.sandboxAllowModals')) parts.push('allow-modals');
    if (atom.config.get('html-live-view.sandboxAllowPopups')) parts.push('allow-popups');
    return parts.join(' ');
  }

  _loadFromDisk() {
    fs.readFile(this.filePath, 'utf8', (err, data) => {
      if (!err && this.iframe) this._renderContent(data);
    });
  }

  _renderContent(html) {
    this._content = html;
    const baseDir = path.dirname(this.filePath);
    let processed = inlineLocalAssets(html, baseDir);
    processed = resolvePaths(processed, baseDir);
    const bridge = getBridgeScript();
    if (/<head[^>]*>/i.test(processed)) {
      processed = processed.replace(/(<head[^>]*>)/i, '$1' + bridge);
    } else {
      processed = bridge + processed;
    }

    try {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      this._tmpPath = path.join(TMP_DIR, encodeURIComponent(this.filePath));
      fs.writeFileSync(this._tmpPath, processed);
      if (this.iframe) {
        this.iframe.src = pathToFileURL(this._tmpPath).href;
      }
    } catch (err) {
      console.error('[html-live-view] Failed to write temp file:', err.message);
    }
  }

  getTitle() { return this.fileName + ' (Preview)'; }
  getLongTitle() { return this.fileName + ' (Preview)'; }
  getURI() { return PROTOCOL_PREFIX + this.filePath; }
  getPath() { return this.filePath; }
  getElement() { return this.element; }
  serialize() {
    return { filePath: this.filePath, deserializer: 'HtmlLiveView' };
  }

  static deserialize(state) {
    return new HtmlLiveView(state.filePath);
  }
  isModified() { return false; }
  shouldPromptToSave() { return false; }
  onDidChangeModified(cb) { return this.emitter.on('did-change-modified', cb); }
  onDidChangeTitle(cb) { return this.emitter.on('did-change-title', cb); }
  onDidDestroy(cb) { return this.emitter.on('did-destroy', cb); }
  copy() { return new HtmlLiveView(this.filePath); }

  static fromElement(element) {
    let node = element;
    while (node) {
      if (node.htmlLiveView instanceof HtmlLiveView) return node.htmlLiveView;
      node = node.parentElement;
    }
    return null;
  }

  copySelection() {
    return writeClipboard(this._lastSelectedText || '');
  }

  openContextLink() {
    if (!this._lastLinkUrl) return false;
    try {
      const result = require('electron').shell.openExternal(this._lastLinkUrl);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          atom.notifications.addError('Failed to open link', { detail: err.message });
        });
      }
      return true;
    } catch (err) {
      atom.notifications.addError('Failed to open link', { detail: err.message });
      return false;
    }
  }

  _showContextMenu(data) {
    if (!this.element || !this.iframe) return;
    const rect = this.iframe.getBoundingClientRect();
    const clientX = rect.left + Number(data.clientX || 0);
    const clientY = rect.top + Number(data.clientY || 0);
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
    });

    this.element.dispatchEvent(event);
  }

  destroy() {
    this._stopWatching();
    this.emitter.emit('did-destroy');
    this.emitter.dispose();
    this.disposables.dispose();
    window.removeEventListener('message', this._messageHandler);
    if (this._tmpPath) {
      fs.unlink(this._tmpPath, () => {});
      this._tmpPath = null;
    }
    if (this.iframe) { this.iframe.src = ''; }
    if (this.element) {
      this.element.htmlLiveView = null;
      this.element.remove();
    }
  }
}

module.exports = {
  HtmlLiveView,
  subscriptions: null,

  activate(state) {
    this.subscriptions = new CompositeDisposable();
    atom.deserializers.add(HtmlLiveView);

    this.subscriptions.add(
      atom.workspace.addOpener((uri) => {
        if (uri.startsWith(PROTOCOL_PREFIX)) {
          const filePath = uri.replace(PROTOCOL_PREFIX, '');
          return new HtmlLiveView(filePath);
        }
        const filePath = this._filePathFromUri(uri);
        if (filePath && this._isHtmlFile(filePath) && !_sourceModePaths.has(filePath)) {
          return new HtmlLiveView(filePath);
        }
      })
    );

    this.subscriptions.add(
      atom.workspace.observeTextEditors((editor) => this._maybeOpenAsPreview(editor))
    );

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'html-live-view:toggle': () => {
        this.toggle();
      },
    }));

    this.subscriptions.add(atom.commands.add('.html-live-view', {
      'html-live-view:refresh': () => {
        const active = atom.workspace.getActivePaneItem();
        if (active instanceof HtmlLiveView) active.refresh();
      },
      'html-live-view:devtools': () => {
        toggleDevTools();
      },
      'html-live-view:toggle': () => {
        this.toggle();
      },
      'html-live-view:copy': (event) => {
        const view = HtmlLiveView.fromElement(event.currentTarget || event.target) ||
          atom.workspace.getActivePaneItem();
        if (view instanceof HtmlLiveView) view.copySelection();
      },
      'html-live-view:open-link': (event) => {
        const view = HtmlLiveView.fromElement(event.currentTarget || event.target) ||
          atom.workspace.getActivePaneItem();
        if (view instanceof HtmlLiveView) view.openContextLink();
      },
    }));

    if (state && state.openUris) {
      state.openUris.forEach((uri) => {
        atom.workspace.open(uri, { activateItem: false });
      });
    }
  },

  deactivate() {
    this.subscriptions.dispose();
  },

  serialize() {
    const openUris = [];
    atom.workspace.getPaneItems().forEach((item) => {
      if (item instanceof HtmlLiveView) openUris.push(item.getURI());
    });
    return { openUris };
  },

  toggle() {
    const activeItem = atom.workspace.getActivePaneItem();
    const pane = atom.workspace.getActivePane();
    if (!pane) return;

    if (activeItem instanceof HtmlLiveView) {
      this._switchToSource(activeItem, pane);
    } else if (activeItem && activeItem.getPath) {
      const filePath = activeItem.getPath();
      if (this._isHtmlFile(filePath)) {
        this._switchToLiveView(activeItem, pane);
      }
    }
  },

  _isHtmlFile(filePath) {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.html' || ext === '.htm';
  },

  _switchToLiveView(textEditor, pane) {
    const liveView = new HtmlLiveView(textEditor);
    pane.activateItem(liveView);
    pane.destroyItem(textEditor);
  },

  _switchToSource(liveView, pane) {
    const filePath = liveView.getPath();
    _sourceModePaths.add(filePath);
    pane.destroyItem(liveView);
    atom.workspace.open(filePath).then((editor) => {
      if (editor && editor.onDidDestroy) {
        editor.onDidDestroy(() => _sourceModePaths.delete(filePath));
      }
    });
  },

  _filePathFromUri(uri) {
    try { return require('url').fileURLToPath(uri); } catch (e) { return null; }
  },

  _maybeOpenAsPreview(editor) {
    if (!editor || !editor.getPath) return;
    const filePath = editor.getPath();
    if (!this._isHtmlFile(filePath)) return;
    if (_sourceModePaths.has(filePath)) {
      if (editor.onDidDestroy) {
        editor.onDidDestroy(() => _sourceModePaths.delete(filePath));
      }
      return;
    }
    requestAnimationFrame(() => {
      if (!editor || (editor.isDestroyed && editor.isDestroyed())) return;
      const pane = atom.workspace.paneForItem(editor);
      if (!pane || !pane.getItems().includes(editor)) return;
      const liveView = new HtmlLiveView(editor);
      pane.activateItem(liveView);
      pane.destroyItem(editor);
    });
  },
};
