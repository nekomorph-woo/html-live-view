'use babel';

export function getIframeWebContents() {
  try {
    const electron = require('electron');
    const remote = electron.remote;
    if (!remote) return null;

    const currentWC = remote.getCurrentWebContents();
    const allWC = electron.webContents.getAllWebContents();
    for (const wc of allWC) {
      if (wc !== currentWC) return wc;
    }
    return null;
  } catch (err) {
    return null;
  }
}

export function openDevTools() {
  const wc = getIframeWebContents();
  if (wc) {
    wc.openDevTools({ mode: 'detach' });
    return true;
  }
  try {
    const remote = require('electron').remote;
    if (remote && remote.getCurrentWebContents) {
      remote.getCurrentWebContents().openDevTools({ mode: 'detach' });
      return true;
    }
  } catch (e) {}
  return false;
}

export function closeDevTools() {
  const wc = getIframeWebContents();
  if (wc) {
    wc.closeDevTools();
    return true;
  }
  return false;
}

export function toggleDevTools() {
  const wc = getIframeWebContents();
  if (wc && wc.isDevToolsOpened()) {
    wc.closeDevTools();
  } else {
    return openDevTools();
  }
  return true;
}
