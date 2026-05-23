'use babel';

const { resolveUrl, resolvePaths } = require('../lib/path-resolver');

describe('path-resolver', () => {
  const baseDir = '/Users/test/project';

  describe('resolveUrl', () => {
    it('resolves relative paths to file:// URLs', () => {
      const result = resolveUrl('style.css', baseDir);
      expect(result).toBe('file:///Users/test/project/style.css');
    });

    it('resolves nested relative paths', () => {
      const result = resolveUrl('css/style.css', baseDir);
      expect(result).toBe('file:///Users/test/project/css/style.css');
    });

    it('resolves parent directory paths', () => {
      const result = resolveUrl('../shared/lib.js', baseDir);
      expect(result).toBe('file:///Users/test/shared/lib.js');
    });

    it('leaves http:// URLs unchanged', () => {
      expect(resolveUrl('http://example.com/app.js', baseDir)).toBe('http://example.com/app.js');
    });

    it('leaves https:// URLs unchanged', () => {
      expect(resolveUrl('https://cdn.example.com/lib.js', baseDir)).toBe('https://cdn.example.com/lib.js');
    });

    it('leaves data: URLs unchanged', () => {
      const dataUrl = 'data:image/png;base64,abc123';
      expect(resolveUrl(dataUrl, baseDir)).toBe(dataUrl);
    });

    it('converts absolute paths to file:// URLs', () => {
      expect(resolveUrl('/etc/hosts', baseDir)).toBe('file:///etc/hosts');
    });

    it('prepends https: to protocol-relative URLs', () => {
      expect(resolveUrl('//cdn.example.com/lib.js', baseDir)).toBe('https://cdn.example.com/lib.js');
    });

    it('leaves same-document anchor fragments unchanged', () => {
      expect(resolveUrl('#bottom', baseDir)).toBe('#bottom');
    });

    it('returns falsy values as-is', () => {
      expect(resolveUrl(null, baseDir)).toBe(null);
      expect(resolveUrl(undefined, baseDir)).toBe(undefined);
      expect(resolveUrl('', baseDir)).toBe('');
    });
  });

  describe('resolvePaths', () => {
    it('resolves href attributes', () => {
      const html = '<link href="style.css" rel="stylesheet">';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('href="file:///Users/test/project/style.css"');
    });

    it('resolves src attributes', () => {
      const html = '<script src="app.js"></script>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('src="file:///Users/test/project/app.js"');
    });

    it('resolves img src attributes', () => {
      const html = '<img src="images/photo.png">';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('src="file:///Users/test/project/images/photo.png"');
    });

    it('resolves CSS url() in inline styles', () => {
      const html = '<style>body { background: url(bg.jpg); }</style>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('url(file:///Users/test/project/bg.jpg)');
    });

    it('does not modify already-absolute URLs', () => {
      const html = '<link href="https://cdn.example.com/lib.css">';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('href="https://cdn.example.com/lib.css"');
    });

    it('preserves same-document anchor links', () => {
      const html = '<a href="#bottom">Jump to bottom</a><a href="#top">Back to top</a>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('href="#bottom"');
      expect(result).toContain('href="#top"');
    });

    it('preserves CSS fragment references', () => {
      const html = '<svg><use href="#icon"></use></svg><style>.x{filter:url(#shadow);}</style>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('href="#icon"');
      expect(result).toContain('url(#shadow)');
    });

    it('does not rewrite data attributes containing href or src in their names', () => {
      const html = '<style data-html-live-view-href="style.css"></style><script data-html-live-view-src="app.js"></script>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('data-html-live-view-href="style.css"');
      expect(result).toContain('data-html-live-view-src="app.js"');
    });

    it('handles mixed href and src in one document', () => {
      const html = '<link href="style.css"><script src="app.js"></script>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('href="file:///Users/test/project/style.css"');
      expect(result).toContain('src="file:///Users/test/project/app.js"');
    });

    it('preserves HTML structure and content', () => {
      const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello</p></body></html>';
      const result = resolvePaths(html, baseDir);
      expect(result).toContain('<title>Test</title>');
      expect(result).toContain('<p>Hello</p>');
    });
  });
});
