/** 程序运行流程（main.js）
  1. 导入模块
  - Electron 提供应用生命周期、窗口、对话框、IPC、shell 等功能
  - fs/promises 用于异步文件读写
  - path 用于路径拼接与处理 

  2. 定义配置文件相关常量
  - CONFIG_FILE_NAME: 配置文件名 schedule-config.json
  - DEFAULT_CONFIG: 默认配置对象，包含课表文件路径

  3. 配置文件操作函数
  - getConfigFilePath(): 返回配置文件存放路径（用户数据目录）
  - loadConfig(): 异步读取配置文件，解析 JSON，缓存结果；失败时返回默认配置
  - saveConfig(): 保存新的配置到磁盘，并更新缓存
  - getSavedSchedulePath(): 返回已保存的课表文件路径
  - readScheduleContent(): 根据保存路径读取课表文件内容，返回成功或错误信息

  4. 窗口创建函数
  - createWindow(): 创建主窗口，设置大小、最小尺寸、预加载脚本、安全选项
  - 加载 index.html

  5. IPC 通信接口（渲染进程调用）
  - schedule:read-file → 调用 readScheduleContent()，读取课表文件内容
  - schedule:get-file-path → 获取已保存的课表文件路径
  - schedule:select-file → 弹出文件选择对话框，选择 .ics 文件并保存路径
  - schedule:open-folder → 打开课表文件所在目录

  6. 应用生命周期管理
  - app.whenReady(): 应用启动完成后创建窗口
  - app.on('activate'): macOS 上点击 Dock 图标时，如果没有窗口则重新创建
  - app.on('window-all-closed'): 非 macOS 平台关闭所有窗口时退出应用

  整体运行流程：
  程序启动 → Electron 初始化 → whenReady 创建主窗口 → 渲染进程加载 index.html
  用户通过界面操作 → 渲染进程调用 IPC 接口 → 主进程执行文件选择/读取/保存逻辑
  用户关闭窗口 → 根据平台决定是否退出应用 
**/

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const CONFIG_FILE_NAME = 'schedule-config.json';
const MANUAL_COURSES_FILE_NAME = 'manual-courses.json';
const DEFAULT_CONFIG = {
  scheduleFilePath: ''
};

/* 配置缓存 */
let cachedConfig = null;
let configLoadPromise = null;

/* 获取配置文件路径 */
function getConfigFilePath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function getManualCoursesFilePath() {
  return path.join(app.getPath('userData'), MANUAL_COURSES_FILE_NAME);
}

/* 加载配置 */
async function loadConfig() {
  /* 如果已经缓存了配置文件，优先加载这个配置文件 */
  if (cachedConfig) {
    return cachedConfig;
  }

  /* 如果还没有加载配置，创建一个 Promise 来加载配置 */
  if (!configLoadPromise) {
    configLoadPromise = (async () => {
      try {
        const rawContent = await fs.readFile(getConfigFilePath(), 'utf8');
        const parsed = JSON.parse(rawContent);
        return {
          ...DEFAULT_CONFIG,
          ...(parsed && typeof parsed === 'object' ? parsed : {})
        };
      } catch (error) {
        return { ...DEFAULT_CONFIG };
      }
    })();
  }

  /* 等待配置加载完成 */
  cachedConfig = await configLoadPromise;
  configLoadPromise = null;
  return cachedConfig;
}

/* 保存配置 */
async function saveConfig(nextConfig) {
  cachedConfig = {
    ...DEFAULT_CONFIG,
    ...(nextConfig && typeof nextConfig === 'object' ? nextConfig : {})
  };

  await fs.writeFile(getConfigFilePath(), `${JSON.stringify(cachedConfig, null, 2)}\n`, 'utf8');
  return cachedConfig;
}

async function loadManualCourses() {
  try {
    const raw = await fs.readFile(getManualCoursesFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => item && typeof item === 'object');
  } catch (error) {
    return [];
  }
}

async function saveManualCourses(items) {
  const payload = Array.isArray(items) ? items : [];
  await fs.writeFile(getManualCoursesFilePath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeDateInput(value) {
  const dateText = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return '';
  }
  return dateText;
}

const MANUAL_SECTION_OPTIONS = [
  { label: '1-2节', value: '1-2', startSection: 1, endSection: 2 },
  { label: '3-4节', value: '3-4', startSection: 3, endSection: 4 },
  { label: '5-6节', value: '5-6', startSection: 5, endSection: 6 },
  { label: '7-8节', value: '7-8', startSection: 7, endSection: 8 },
  { label: '9-10节', value: '9-10', startSection: 9, endSection: 10 }
];

function normalizeManualSection(payload) {
  const valueFromPayload = String(payload?.sectionValue || '').trim();
  const optionByValue = MANUAL_SECTION_OPTIONS.find((item) => item.value === valueFromPayload) || null;
  if (optionByValue) {
    return { ...optionByValue };
  }

  const startSection = Number(payload?.startSection || 0);
  const endSection = Number(payload?.endSection || 0);
  const optionByRange = MANUAL_SECTION_OPTIONS.find((item) => item.startSection === startSection && item.endSection === endSection) || null;
  if (optionByRange) {
    return { ...optionByRange };
  }

  return null;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsDateTime(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}`;
}

function parseTimePoint(timeText) {
  const [hourText, minuteText] = String(timeText).split(':');
  return {
    hour: Number(hourText),
    minute: Number(minuteText)
  };
}

function getPeriodTime(period) {
  const map = {
    1: { start: '08:00', end: '08:50' },
    2: { start: '09:00', end: '09:50' },
    3: { start: '10:10', end: '11:00' },
    4: { start: '11:10', end: '12:00' },
    5: { start: '14:00', end: '14:50' },
    6: { start: '15:00', end: '15:50' },
    7: { start: '16:10', end: '17:00' },
    8: { start: '17:10', end: '18:00' },
    9: { start: '19:00', end: '19:45' },
    10: { start: '19:50', end: '20:35' }
  };
  return map[period] || map[1];
}

function buildManualEntry(payload, scheduleFilePath) {
  const date = normalizeDateInput(payload?.date);
  const section = normalizeManualSection(payload);
  const summary = String(payload?.summary || '').trim();
  const location = String(payload?.location || '').trim();
  const note = String(payload?.note || '').trim();

  if (!date || !section || !summary) {
    return null;
  }

  return {
    id: `manual_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    scheduleFilePath,
    date,
    sectionLabel: section.label,
    sectionValue: section.value,
    startSection: section.startSection,
    endSection: section.endSection,
    summary: summary.slice(0, 64),
    location: location.slice(0, 64),
    note: note.slice(0, 200),
    createdAt: new Date().toISOString()
  };
}

function createManualVevent(entry) {
  const [year, month, day] = entry.date.split('-').map(Number);
  const startSection = Number(entry.startSection || 0);
  const endSection = Number(entry.endSection || 0);
  const startPoint = parseTimePoint(getPeriodTime(startSection).start);
  const endPoint = parseTimePoint(getPeriodTime(endSection).end);
  const start = new Date(year, month - 1, day, startPoint.hour, startPoint.minute, 0, 0);
  const end = new Date(year, month - 1, day, endPoint.hour, endPoint.minute, 0, 0);
  const now = new Date();
  const descriptionBase = entry.note ? entry.note : '';
  const idLine = `MANUAL_ENTRY_ID:${entry.id}`;
  const description = descriptionBase ? `${descriptionBase}\\n${idLine}` : idLine;

  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(`${entry.id}@schedule-desktop`)}`,
    `DTSTAMP:${toIcsDateTime(now)}`,
    `DTSTART:${toIcsDateTime(start)}`,
    `DTEND:${toIcsDateTime(end)}`,
    `SUMMARY:${escapeIcsText(entry.summary)}`,
    `LOCATION:${escapeIcsText(entry.location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT'
  ].join('\r\n');
}

async function appendManualEntryToIcs(scheduleFilePath, entry) {
  const original = await fs.readFile(scheduleFilePath, 'utf8');
  const vevent = createManualVevent(entry);
  const endMarker = 'END:VCALENDAR';
  const markerIndex = original.lastIndexOf(endMarker);
  const eol = original.includes('\r\n') ? '\r\n' : '\n';

  let nextContent = '';
  if (markerIndex === -1) {
    nextContent = `${original}${eol}${vevent}${eol}`;
  } else {
    const beforeEnd = original.slice(0, markerIndex).replace(/[\r\n]*$/, '');
    const afterEnd = original.slice(markerIndex);
    nextContent = `${beforeEnd}${eol}${vevent}${eol}${afterEnd}`;
  }

  await fs.writeFile(scheduleFilePath, nextContent, 'utf8');
}

function getManualEntriesForSchedule(items, scheduleFilePath) {
  const normalizedPath = path.normalize(String(scheduleFilePath || ''));
  return (Array.isArray(items) ? items : []).filter((item) => path.normalize(String(item?.scheduleFilePath || '')) === normalizedPath);
}

function stripManualVevents(content) {
  return String(content).replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n?/g, (block) => {
    return /MANUAL_ENTRY_ID:/.test(block) ? '' : block;
  });
}

function insertVeventsBeforeCalendarEnd(content, veventsText) {
  const endMarker = 'END:VCALENDAR';
  const markerIndex = content.lastIndexOf(endMarker);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  if (!veventsText) {
    return content;
  }

  if (markerIndex === -1) {
    return `${content.replace(/[\r\n]*$/, '')}${eol}${veventsText}${eol}`;
  }

  const beforeEnd = content.slice(0, markerIndex).replace(/[\r\n]*$/, '');
  const afterEnd = content.slice(markerIndex);
  return `${beforeEnd}${eol}${veventsText}${eol}${afterEnd}`;
}

async function rewriteManualEntriesInIcs(scheduleFilePath, entriesForSchedule) {
  const original = await fs.readFile(scheduleFilePath, 'utf8');
  const withoutManual = stripManualVevents(original);
  const eol = withoutManual.includes('\r\n') ? '\r\n' : '\n';
  const veventsText = entriesForSchedule.map((entry) => createManualVevent(entry)).join(eol);
  const nextContent = insertVeventsBeforeCalendarEnd(withoutManual, veventsText);
  await fs.writeFile(scheduleFilePath, nextContent, 'utf8');
}

/* 获取已保存的课表文件路径 */
async function getSavedSchedulePath() {
  const config = await loadConfig();
  return typeof config.scheduleFilePath === 'string' ? config.scheduleFilePath : '';
}

/* 读取课表文件内容 */
async function readScheduleContent() {
  /* 获取已保存的课表文件路径 */
  const scheduleFilePath = await getSavedSchedulePath();

  /* 如果没有选择课表文件，返回错误信息 */
  if (!scheduleFilePath) {
    return {
      ok: false,
      code: 'NO_FILE_SELECTED',
      message: '尚未选择课表文件，请从右上角三点菜单选择 .ics 文件。',
      details: ''
    };
  }

  /* 尝试读取课表文件内容 */
  try {
    const content = await fs.readFile(scheduleFilePath, 'utf8');
    return {
      ok: true,
      content,
      filePath: scheduleFilePath
    };
  } catch (error) {
    const isNotFound = error && error.code === 'ENOENT';
    return {
      ok: false,
      code: isNotFound ? 'FILE_NOT_FOUND' : 'READ_FAILED',
      message: isNotFound
        ? '上次保存的课表文件已不可用，请重新选择 .ics 文件。'
        : '读取课表文件失败，请检查文件权限或文件内容。',
      details: error ? error.message : 'Unknown error',
      filePath: scheduleFilePath
    };
  }
}

/* 创建主窗口 */
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  /* 加载 index.html */
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}


/* 
  IPC 通信接口
  - schedule:read-file → 调用 readScheduleContent()，读取课表文件内容
  - schedule:get-file-path → 获取已保存的课表文件路径
  - schedule:select-file → 弹出文件选择对话框，选择 .ics 文件并保存路径
  - schedule:open-folder → 打开课表文件所在目录
*/
ipcMain.handle('schedule:read-file', async () => {
  return readScheduleContent();
});

ipcMain.handle('schedule:get-file-path', async () => {
  return getSavedSchedulePath();
});

ipcMain.handle('schedule:select-file', async () => {
  /* 获取当前聚焦的窗口或所有窗口的第一个窗口，当找不到任何窗口，返回null，并在下面退出本函数 */
  const parentWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;

  /* 如果没有找到任何窗口，无法打开文件选择对话框，返回错误信息 */
  if (!parentWindow) {
    return {
      ok: false,
      message: '无法打开文件选择对话框，未找到有效的应用窗口。',
      details: ''
    };
  }

  /* 打开文件选择对话框，限制只能选择 .ics 文件 */
  const result = await dialog.showOpenDialog(parentWindow, {
    title: '选择课表文件',
    properties: ['openFile'],
    filters: [{ name: 'ICS 文件', extensions: ['ics'] }]
  });

  /* 如果用户取消选择或没有选择任何文件，返回，并不做任何操作 */
  if (result.canceled || result.filePaths.length === 0) {
    return {
      ok: false,
      canceled: true
    };
  }

  /* 如果选择了文件，保存路径并返回成功信息 */
  const selectedPath = path.normalize(result.filePaths[0]);
  await saveConfig({ scheduleFilePath: selectedPath });

  return {
    ok: true,
    filePath: selectedPath
  };
}); /* schedule:select-file 处理函数 End */

ipcMain.handle('schedule:open-folder', async () => {
  /* 获取已保存的课表文件路径 */
  const scheduleFilePath = await getSavedSchedulePath();

  /* 如果没有选择课表文件，返回错误信息 */
  if (!scheduleFilePath) {
    return {
      ok: false,
      message: '尚未选择课表文件，请先通过右上角菜单选择 .ics 文件。',
      details: ''
    };
  }

  /* 打开课表文件所在目录 */
  const folderPath = path.dirname(scheduleFilePath);
  const openResult = await shell.openPath(folderPath);

  /* 如果打开失败，返回错误信息 */
  if (openResult) {
    return {
      ok: false,
      message: '无法打开课表目录，请确认路径有效。',
      details: openResult
    };
  }

  /* 如果打开成功，返回成功信息 */
  return { ok: true };
}); /* schedule:open-folder 处理函数 End */

ipcMain.handle('schedule:get-manual-courses', async () => {
  const scheduleFilePath = await getSavedSchedulePath();
  if (!scheduleFilePath) {
    return {
      ok: true,
      items: []
    };
  }

  const allItems = await loadManualCourses();
  const normalizedPath = path.normalize(scheduleFilePath);
  const items = allItems.filter((item) => path.normalize(String(item.scheduleFilePath || '')) === normalizedPath);

  return {
    ok: true,
    items
  };
});

ipcMain.handle('schedule:add-manual-course', async (_event, payload) => {
  const scheduleFilePath = await getSavedSchedulePath();
  if (!scheduleFilePath) {
    return {
      ok: false,
      message: '尚未选择课表文件，请先在右上角菜单选择 .ics 文件。',
      details: ''
    };
  }

  const newEntry = buildManualEntry(payload, path.normalize(scheduleFilePath));
  if (!newEntry) {
    return {
      ok: false,
      message: '手动添加失败，请检查日期、节次和课程名称是否完整。',
      details: ''
    };
  }

  const previousItems = await loadManualCourses();
  const nextItems = [...previousItems, newEntry];
  const entriesForSchedule = getManualEntriesForSchedule(nextItems, scheduleFilePath);

  try {
    await saveManualCourses(nextItems);
    await rewriteManualEntriesInIcs(scheduleFilePath, entriesForSchedule);

    return {
      ok: true,
      item: newEntry
    };
  } catch (error) {
    try {
      await saveManualCourses(previousItems);
    } catch (rollbackError) {
      // no-op: keep primary error message
    }

    return {
      ok: false,
      message: '保存手动课程失败，请检查课表文件写入权限。',
      details: error ? error.message : 'Unknown error'
    };
  }
});

ipcMain.handle('schedule:update-manual-course', async (_event, payload) => {
  const scheduleFilePath = await getSavedSchedulePath();
  if (!scheduleFilePath) {
    return {
      ok: false,
      message: '尚未选择课表文件，请先在右上角菜单选择 .ics 文件。',
      details: ''
    };
  }

  const targetId = String(payload?.id || '').trim();
  if (!targetId) {
    return {
      ok: false,
      message: '更新失败，缺少课程标识。',
      details: ''
    };
  }

  const previousItems = await loadManualCourses();
  const itemIndex = previousItems.findIndex((item) => String(item?.id || '') === targetId);
  if (itemIndex < 0) {
    return {
      ok: false,
      message: '未找到要编辑的课程记录。',
      details: ''
    };
  }

  const existing = previousItems[itemIndex];
  if (path.normalize(String(existing.scheduleFilePath || '')) !== path.normalize(scheduleFilePath)) {
    return {
      ok: false,
      message: '当前课表文件与课程记录不匹配，无法编辑。',
      details: ''
    };
  }

  const rebuilt = buildManualEntry(payload, path.normalize(scheduleFilePath));
  if (!rebuilt) {
    return {
      ok: false,
      message: '编辑失败，请检查日期、节次和课程名称是否完整。',
      details: ''
    };
  }

  const updated = {
    ...existing,
    ...rebuilt,
    id: existing.id,
    createdAt: existing.createdAt,
    scheduleFilePath: existing.scheduleFilePath
  };

  const nextItems = [...previousItems];
  nextItems[itemIndex] = updated;
  const entriesForSchedule = getManualEntriesForSchedule(nextItems, scheduleFilePath);

  try {
    await saveManualCourses(nextItems);
    await rewriteManualEntriesInIcs(scheduleFilePath, entriesForSchedule);

    return {
      ok: true,
      item: updated
    };
  } catch (error) {
    try {
      await saveManualCourses(previousItems);
    } catch (rollbackError) {
      // no-op: keep primary error message
    }

    return {
      ok: false,
      message: '保存编辑结果失败，请检查课表文件写入权限。',
      details: error ? error.message : 'Unknown error'
    };
  }
});

ipcMain.handle('schedule:delete-manual-course', async (_event, payload) => {
  const scheduleFilePath = await getSavedSchedulePath();
  if (!scheduleFilePath) {
    return {
      ok: false,
      message: '尚未选择课表文件，请先在右上角菜单选择 .ics 文件。',
      details: ''
    };
  }

  const targetId = String(payload?.id || '').trim();
  if (!targetId) {
    return {
      ok: false,
      message: '删除失败，缺少课程标识。',
      details: ''
    };
  }

  const previousItems = await loadManualCourses();
  const target = previousItems.find((item) => String(item?.id || '') === targetId);
  if (!target) {
    return {
      ok: false,
      message: '未找到要删除的课程记录。',
      details: ''
    };
  }

  if (path.normalize(String(target.scheduleFilePath || '')) !== path.normalize(scheduleFilePath)) {
    return {
      ok: false,
      message: '当前课表文件与课程记录不匹配，无法删除。',
      details: ''
    };
  }

  const nextItems = previousItems.filter((item) => String(item?.id || '') !== targetId);
  const entriesForSchedule = getManualEntriesForSchedule(nextItems, scheduleFilePath);

  try {
    await saveManualCourses(nextItems);
    await rewriteManualEntriesInIcs(scheduleFilePath, entriesForSchedule);

    return {
      ok: true,
      id: targetId
    };
  } catch (error) {
    try {
      await saveManualCourses(previousItems);
    } catch (rollbackError) {
      // no-op: keep primary error message
    }

    return {
      ok: false,
      message: '删除课程失败，请检查课表文件写入权限。',
      details: error ? error.message : 'Unknown error'
    };
  }
});

/* IPC End */

/* 应用生命周期管理 */
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/* 应用生命周期管理 End */