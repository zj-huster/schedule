const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scheduleApi', {
  readScheduleFile: () => ipcRenderer.invoke('schedule:read-file'),
  getScheduleFilePath: () => ipcRenderer.invoke('schedule:get-file-path'),
  selectScheduleFile: () => ipcRenderer.invoke('schedule:select-file'),
  openScheduleFolder: () => ipcRenderer.invoke('schedule:open-folder'),
  getManualCourses: () => ipcRenderer.invoke('schedule:get-manual-courses'),
  addManualCourse: (payload) => ipcRenderer.invoke('schedule:add-manual-course', payload),
  updateManualCourse: (payload) => ipcRenderer.invoke('schedule:update-manual-course', payload),
  deleteManualCourse: (payload) => ipcRenderer.invoke('schedule:delete-manual-course', payload)
});
