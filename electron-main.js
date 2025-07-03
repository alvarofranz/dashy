import { app, BrowserWindow, Menu, shell, dialog, ipcMain, protocol, net } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import chokidar from 'chokidar';
import electronUpdater from 'electron-updater';
import { initDatabase, getDb, closeDb } from './app/database.js';
import { registerIpcHandlers } from './app/ipc-handlers.js';
import { runMigrations } from './app/migrations.js';

const { autoUpdater } = electronUpdater;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;

app.commandLine.appendSwitch('disable-features', 'Autofill,AutofillCreditCard');

let mainWindow;
let dataPath;
let configPath = path.join(app.getPath('userData'), 'config.json');
let isDataPathInitialized = false;

// --- Data Path Management ---
function loadDataPath() {
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.dataPath && fs.existsSync(config.dataPath)) {
                dataPath = config.dataPath;
                console.log(`[Data Path] Loaded data path: ${dataPath}`);
                return true;
            }
        }
    } catch (error) {
        console.error('[Data Path] Error reading config file:', error);
    }
    // MODIFIED: Re-added the console log as requested.
    console.log('[Data Path] Data path not configured.');
    return false;
}

// --- Main Window Creation ---
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false, // Don't show the window until it's ready
    });

    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    // Show window when it's ready to avoid flash of unstyled content
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Once the window is ready, check for updates
        // This is non-blocking and will happen in the background
        autoUpdater.checkForUpdates();
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
        chokidar.watch(path.join(__dirname, 'public'), { ignoreInitial: true }).on('all', () => {
            mainWindow.webContents.reload();
        });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- Application Menu ---
function createMenu() {
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Check for Updates...',
                    click: () => {
                        autoUpdater.once('update-not-available', (info) => {
                            dialog.showMessageBox({
                                type: 'info',
                                title: 'No Updates',
                                message: `You are running the latest version of Dashy (${app.getVersion()}).`
                            });
                        });
                        autoUpdater.once('update-available', (info) => {
                            dialog.showMessageBox({
                                type: 'info',
                                title: 'Update Found',
                                message: `Version ${info.version} is available and will be downloaded in the background.`
                            });
                        });
                        autoUpdater.once('error', (err) => {
                            dialog.showErrorBox('Update Check Failed', `Could not connect to the update server. Please check your internet connection and try again.\n\n${err.message}`);
                        });
                        autoUpdater.checkForUpdates();
                    }
                },
                {
                    label: 'Learn More',
                    click: () => shell.openExternal('https://github.com/alvarofranz/dashy')
                }
            ]
        }
    ];

    if (process.platform === 'darwin') {
        menuTemplate.unshift({
            label: app.getName(),
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services', submenu: [] },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        });
    }

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

// --- Core IPC Handlers ---
function registerCoreIpcHandlers() {
    ipcMain.handle('app:init-check', async () => {
        if (isDataPathInitialized) return { configured: true };

        const isConfigured = loadDataPath();
        if (isConfigured) {
            try {
                await initDatabase(dataPath);
                await runMigrations();
                registerIpcHandlers(dataPath);
                isDataPathInitialized = true;

                return { configured: true };
            } catch (err) {
                console.error('Failed to initialize application after config check:', err);
                dialog.showErrorBox('Initialization Failed', 'Dashy could not start. Please check the logs.');
                app.quit();
                return { configured: false, error: 'Initialization failed.' };
            }
        }
        return { configured: false };
    });

    ipcMain.handle('app:set-data-path', async (event, newPath) => {
        if (!newPath) return { success: false, error: 'No path provided.' };
        try {
            fs.ensureDirSync(newPath);
            fs.writeFileSync(configPath, JSON.stringify({ dataPath: newPath }));
            app.relaunch();
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('Failed to set data path:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('app:get-settings', () => ({
        dataPath: dataPath,
        appVersion: app.getVersion(),
    }));

    ipcMain.handle('app:change-data-path', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select a New Folder for Your Data'
        });

        if (canceled || filePaths.length === 0) {
            return { success: false, reason: 'canceled' };
        }

        const newPath = filePaths[0];
        if (newPath === dataPath) {
            return { success: false, reason: 'same_path' };
        }

        try {
            await closeDb();

            console.log(`[Data Migration] Starting migration from ${dataPath} to ${newPath}`);
            await fs.ensureDir(newPath);

            const itemsToMove = ['dashy.sqlite3', 'images', 'files'];
            for (const item of itemsToMove) {
                const oldItemPath = path.join(dataPath, item);
                const newItemPath = path.join(newPath, item);
                if (fs.existsSync(oldItemPath)) {
                    console.log(`[Data Migration] Moving ${item}...`);
                    await fs.move(oldItemPath, newItemPath, { overwrite: true });
                }
            }
            console.log('[Data Migration] Migration successful.');

            fs.writeFileSync(configPath, JSON.stringify({ dataPath: newPath }));

            app.relaunch();
            app.quit();
            return { success: true };
        } catch (err) {
            console.error('Failed to move data:', err);
            dialog.showErrorBox('Error Moving Data', 'Could not move data to the new location. Please check permissions and try again. The app will restart with the old data location.');

            app.relaunch();
            app.quit();
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('dialog:open-files', async (event, options) => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, options);
        return canceled ? [] : filePaths;
    });

    ipcMain.handle('shell:open-external', (event, url) => {
        shell.openExternal(url);
    });

    ipcMain.handle('shell:open-path', () => {
        if (dataPath) {
            shell.openPath(dataPath);
        }
    });

    ipcMain.handle('shell:show-item-in-folder', (event, relativePath) => {
        if (dataPath && relativePath) {
            const absolutePath = path.join(dataPath, relativePath.substring(1)); // Remove leading '/'
            shell.showItemInFolder(absolutePath);
        }
    });

    ipcMain.handle('app:quit-and-install', () => {
        autoUpdater.quitAndInstall();
    });
}

// --- App Lifecycle ---
app.on('ready', async () => {
    protocol.handle('dashy-data', (request) => {
        const filePath = request.url.slice('dashy-data://'.length);
        const absolutePath = path.join(dataPath, filePath);
        return net.fetch(`file://${absolutePath}`);
    });

    registerCoreIpcHandlers();
    createWindow();
    createMenu();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', async () => {
    await closeDb();
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// --- AutoUpdater Event Listeners ---
autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info);
});

autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Update not available.', info);
});

autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error in auto-updater. ' + err);
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + Math.round(progressObj.bytesPerSecond / 1024) + " KB/s";
    log_message = log_message + ' - Downloaded ' + Math.round(progressObj.percent) + '%';
    log_message = log_message + ' (' + Math.round(progressObj.transferred / (1024*1024)) + "/" + Math.round(progressObj.total/ (1024*1024)) + ' MB)';
    console.log(`[AutoUpdater] ${log_message}`);
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info);
    if(mainWindow) {
        mainWindow.webContents.send('update-downloaded', info);
    }
});