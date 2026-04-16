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