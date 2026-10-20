const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld('shelter', {
  getState: call('state'),
  start: call('start'),
  stop: call('stop'),
  saveSettings: call('settings'),
  refreshDevices: call('refreshDevices'),
  copy: call('copy'),
  openChannelsFile: call('openChannelsFile'),
  reloadChannels: call('reloadChannels'),
  openPoster: call('openPoster'),
  fixNetwork: call('fixNetwork'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onLevel: (cb) => ipcRenderer.on('level', (_e, v) => cb(v)),
});
