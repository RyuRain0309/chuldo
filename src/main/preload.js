const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: () => ipcRenderer.invoke('scraper:start'),
  stop: () => ipcRenderer.invoke('scraper:stop'),
  sendCommand: (command) => ipcRenderer.invoke('scraper:command', command),
  onData: (callback) => {
    ipcRenderer.on('scraper:data', (_event, data) => callback(data));
  },
});
