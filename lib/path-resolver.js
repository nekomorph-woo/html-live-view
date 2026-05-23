'use babel';

const path = require('path');
const { pathToFileURL } = require('url');

const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

export function resolveUrl(url, baseDir) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  if (url.startsWith('#')) return url;
  if (PROTOCOL_RE.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (path.isAbsolute(url)) return toFileUrl(url);
  return toFileUrl(path.resolve(baseDir, url));
}

export function resolvePaths(htmlContent, baseDir) {
  let result = htmlContent;
  result = result.replace(
    /(\s(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix, quote, url) => prefix + quote + resolveUrl(url, baseDir) + quote
  );
  result = result.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (match, quote, url) => 'url(' + quote + resolveUrl(url, baseDir) + quote + ')'
  );
  return result;
}
