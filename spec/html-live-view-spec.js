'use babel';

const { HtmlLiveView } = require('../lib/html-live-view');
const pathModule = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

describe('HtmlLiveView', () => {
  let workspaceElement, activationPromise, tempDir, tempFilePath;
  const htmlContent = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';

  beforeEach(() => {
    workspaceElement = atom.views.getView(atom.workspace);
    activationPromise = atom.packages.activatePackage('html-live-view');
    tempDir = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'hlv-'));
    tempFilePath = pathModule.join(tempDir, 'test.html');
    fs.writeFileSync(tempFilePath, htmlContent);
  });

  afterEach(() => {
    fs.unlinkSync(tempFilePath);
    fs.rmdirSync(tempDir);
  });

  describe('HtmlLiveView class', () => {
    it('implements the pane item interface', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        expect(view.getTitle()).toBe('test.html (Preview)');
        expect(view.getLongTitle()).toBe('test.html (Preview)');
        expect(view.getURI()).toBe('html-live-view://' + tempFilePath);
        expect(view.getPath()).toBe(tempFilePath);
        expect(view.getElement()).toExist();
        expect(view.isModified()).toBe(false);
        expect(view.shouldPromptToSave()).toBe(false);
        view.destroy();
      });
    });

    it('creates an iframe with correct sandbox attribute', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        jasmine.attachToDOM(view.getElement());
        const iframe = view.element.querySelector('iframe');
        expect(iframe).toExist();
        const sandbox = iframe.getAttribute('sandbox');
        expect(sandbox).toContain('allow-scripts');
        expect(sandbox).not.toContain('allow-same-origin');
        view.destroy();
      });
    });

    it('renders HTML content from TextEditor synchronously', () => {
      waitsForPromise(() => {
        return activationPromise.then(() => atom.workspace.open(tempFilePath));
      });
      runs(() => {
        const textEditor = atom.workspace.getActiveTextEditor();
        const view = new HtmlLiveView(textEditor);
        jasmine.attachToDOM(view.getElement());
        expect(view.iframe.src).toBe(pathToFileURL(view._tmpPath).href);
        expect(fs.readFileSync(view._tmpPath, 'utf8')).toContain('<h1>Hello</h1>');
        view.destroy();
      });
    });

    it('renders HTML content from disk asynchronously', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        jasmine.attachToDOM(view.getElement());
        waitsFor(() => view.iframe.src !== '');
        runs(() => {
          expect(view.iframe.src).toBe(pathToFileURL(view._tmpPath).href);
          expect(fs.readFileSync(view._tmpPath, 'utf8')).toContain('<h1>Hello</h1>');
          view.destroy();
        });
      });
    });

    it('inlines local stylesheets and scripts into the rendered document', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const cssPath = pathModule.join(tempDir, 'external.css');
        const jsPath = pathModule.join(tempDir, 'external.js');
        fs.writeFileSync(cssPath, '.box { background: url(bg.png); }');
        fs.writeFileSync(jsPath, 'function incrementCounter() { window.counterLoaded = true; }');
        fs.writeFileSync(tempFilePath, [
          '<!DOCTYPE html><html><head>',
          '<link rel="stylesheet" href="external.css">',
          '</head><body>',
          '<button onclick="incrementCounter()">+1</button>',
          '<script src="external.js"></script>',
          '</body></html>',
        ].join(''));

        const view = new HtmlLiveView(tempFilePath);
        jasmine.attachToDOM(view.getElement());
        waitsFor(() => view._tmpPath);
        runs(() => {
          const rendered = fs.readFileSync(view._tmpPath, 'utf8');
          expect(rendered).toContain('<style data-html-live-view-href="external.css">');
          expect(rendered).toContain('url(file://');
          expect(rendered).toContain('<script data-html-live-view-src="external.js">');
          expect(rendered).toContain('function incrementCounter()');
          expect(rendered).not.toContain('href="file://');
          expect(rendered).not.toContain('src="file://');
          view.destroy();
          fs.unlinkSync(cssPath);
          fs.unlinkSync(jsPath);
        });
      });
    });

    it('injects theme variables without corrupting the html tag', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        waitsFor(() => view._tmpPath);
        runs(() => {
          view.updateTheme(true);
          const rendered = fs.readFileSync(view._tmpPath, 'utf8');
          expect(rendered).toContain('<html data-theme="dark">');
          expect(rendered).not.toContain('<html data-theme="dark"<html');
          view.destroy();
        });
      });
    });

    it('serializes to a restorable state', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        const state = view.serialize();
        expect(state.filePath).toBe(tempFilePath);
        expect(state.deserializer).toBe('HtmlLiveView');
        view.destroy();
      });
    });

    it('emits did-destroy on destroy', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        let destroyed = false;
        view.onDidDestroy(() => { destroyed = true; });
        view.destroy();
        expect(destroyed).toBe(true);
      });
    });

    it('copy returns a new instance for the same file', () => {
      waitsForPromise(() => activationPromise);
      runs(() => {
        const view = new HtmlLiveView(tempFilePath);
        const copy = view.copy();
        expect(copy.getPath()).toBe(tempFilePath);
        expect(copy).not.toBe(view);
        copy.destroy();
        view.destroy();
      });
    });
  });

  describe('toggle command', () => {
    it('switches from TextEditor to HtmlLiveView and back', () => {
      waitsForPromise(() => {
        return activationPromise.then(() => atom.workspace.open(tempFilePath));
      });
      runs(() => {
        expect(atom.workspace.getActiveTextEditor()).toExist();

        atom.commands.dispatch(workspaceElement, 'html-live-view:toggle');
        waitsFor(() => atom.workspace.getActivePaneItem() instanceof HtmlLiveView);

        runs(() => {
          const liveView = atom.workspace.getActivePaneItem();
          expect(liveView.getTitle()).toBe('test.html (Preview)');

          atom.commands.dispatch(workspaceElement, 'html-live-view:toggle');
          waitsFor(() => {
            const item = atom.workspace.getActivePaneItem();
            return item && item.getPath && item.getPath() === tempFilePath;
          });

          runs(() => {
            expect(atom.workspace.getActiveTextEditor()).toExist();
          });
        });
      });
    });
  });
});
