'use babel';

export function getBridgeScript() {
  return `<script>
(function() {
  'use strict';

  var _origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };

  ['log', 'warn', 'error', 'info'].forEach(function(level) {
    console[level] = function() {
      _origConsole[level].apply(console, arguments);
      try {
        window.parent.postMessage({
          type: 'console',
          level: level,
          args: Array.prototype.slice.call(arguments).map(function(a) {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch(e) { return String(a); }
          })
        }, '*');
      } catch(e) {}
    };
  });

  window.onerror = function(msg, url, line, col, error) {
    try {
      window.parent.postMessage({
        type: 'error',
        message: String(msg),
        url: url || '',
        line: line || 0,
        column: col || 0,
        stack: error && error.stack ? error.stack : ''
      }, '*');
    } catch(e) {}
  };

  window.addEventListener('unhandledrejection', function(event) {
    try {
      window.parent.postMessage({
        type: 'error',
        message: 'Unhandled Promise Rejection: ' + (event.reason ? String(event.reason) : ''),
        url: '',
        line: 0,
        column: 0,
        stack: ''
      }, '*');
    } catch(e) {}
  });

  document.addEventListener('keydown', function(event) {
    function selectedText() {
      var selection = window.getSelection && window.getSelection();
      return selection ? String(selection) : '';
    }

    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (
        event.code === 'KeyH' ||
        String(event.key).toLowerCase() === 'h' ||
        event.keyCode === 72 ||
        event.which === 72
      )
    ) {
      event.preventDefault();
      try {
        window.parent.postMessage({ type: 'toggle' }, '*');
      } catch(e) {}
    }

    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (
        event.code === 'KeyC' ||
        String(event.key).toLowerCase() === 'c' ||
        event.keyCode === 67 ||
        event.which === 67
      )
    ) {
      var text = selectedText();
      if (text) {
        event.preventDefault();
        try {
          window.parent.postMessage({ type: 'copy', selectedText: text }, '*');
        } catch(e) {}
      }
    }
  });

  document.addEventListener('copy', function(event) {
    var selection = window.getSelection && window.getSelection();
    var text = selection ? String(selection) : '';
    if (!text) return;

    try {
      window.parent.postMessage({ type: 'copy', selectedText: text }, '*');
    } catch(e) {}
  });

  document.addEventListener('contextmenu', function(event) {
    var anchor = event.target;
    while (anchor && anchor.tagName !== 'A') {
      anchor = anchor.parentElement;
    }

    var selection = window.getSelection && window.getSelection();
    var text = selection ? String(selection) : '';
    var href = anchor ? anchor.href : '';

    event.preventDefault();
    try {
      window.parent.postMessage({
        type: 'context-menu',
        clientX: event.clientX,
        clientY: event.clientY,
        selectedText: text,
        linkUrl: href
      }, '*');
    } catch(e) {}
  });

  document.addEventListener('click', function(event) {
    function scrollToFragment(fragment) {
      var id = fragment.slice(1);
      var target = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body;
      if (target) {
        event.preventDefault();
        target.scrollIntoView();
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', fragment || '#');
        }
        return true;
      }
      return false;
    }

    var anchor = event.target;
    while (anchor && anchor.tagName !== 'A') {
      anchor = anchor.parentElement;
    }
    if (!anchor || !anchor.href) return;

    var href = anchor.getAttribute('href');
    if (!href) return;

    if (href.charAt(0) === '#') {
      scrollToFragment(href);
      return;
    }

    event.preventDefault();
    try {
      window.parent.postMessage({
        type: 'navigate',
        url: href
      }, '*');
    } catch(e) {}
  });
})();
</script>`;
}
