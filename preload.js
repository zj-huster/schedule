const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scheduleApi', {
  readScheduleFile: () => ipcRenderer.invoke('schedule:read-file'),
  getScheduleFilePath: () => ipcRenderer.invoke('schedule:get-file-path'),
  selectScheduleFile: () => ipcRenderer.invoke('schedule:select-file'),
  openScheduleFolder: () => ipcRenderer.invoke('schedule:open-folder')
});
