const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: () => ipcRenderer.invoke('scraper:start'),
  stop: () => ipcRenderer.invoke('scraper:stop'),
  sendCommand: (command) => ipcRenderer.invoke('scraper:command', command),
  onData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('scraper:data', listener);
    return () => ipcRenderer.removeListener('scraper:data', listener);
  },
  loadRoster: () => ipcRenderer.invoke('roster:load'),
  saveRoster: (rows) => ipcRenderer.invoke('roster:save', rows),
});
