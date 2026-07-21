const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mobileConsole", {
  bootstrap: () => ipcRenderer.invoke("console:bootstrap"),
  chooseProject: () => ipcRenderer.invoke("console:choose-project"),
  inspectProject: (projectPath) => ipcRenderer.invoke("console:inspect-project", projectPath),
  refreshTargets: () => ipcRenderer.invoke("console:refresh-targets"),
  start: (config) => ipcRenderer.invoke("console:start", config),
  stop: () => ipcRenderer.invoke("console:stop"),
  restart: () => ipcRenderer.invoke("console:restart"),
  openExternal: (url) => ipcRenderer.invoke("console:open-external", url),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("console:event", handler);
    return () => ipcRenderer.removeListener("console:event", handler);
  },
});
