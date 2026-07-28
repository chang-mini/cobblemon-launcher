const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  packInfo:   () => ipcRenderer.invoke("pack-info"),
  login:      () => ipcRenderer.invoke("login"),
  logout:     () => ipcRenderer.invoke("logout"),
  setRam:     (gb) => ipcRenderer.invoke("set-ram", gb),
  play:       () => ipcRenderer.invoke("play"),
  openFolder: () => ipcRenderer.invoke("open-folder"),

  on: (channel, cb) => {
    const allowed = ["account", "status", "log", "mod-progress", "dl-progress", "closed"];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
