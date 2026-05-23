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
