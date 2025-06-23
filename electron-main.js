import { app, BrowserWindow, Menu, shell, dialog, ipcMain, protocol, net } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import chokidar from 'chokidar';
import axios from 'axios';
import { compareVersions } from 'compare-versions';
import { initDatabase, getDb, closeDb } from './app/database.js';
import { registerIpcHandlers } from './app/ipc-handlers.js';
import { runMigrations } from './app/migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;

let mainWindow;
let dataPath;
let configPath = path.join(app.getPath('userData'), 'config.json');

// --- Data Path Management ---
function loadDataPath() {
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.dataPath && fs.existsSync(config.dataPath)) {
                dataPath = config.dataPath;
                return;
            }
        }
    } catch (error) {
        console.error('Error reading config file, falling back to default:', error);
    }
    // Default path
    dataPath = path.join(app.getPath('userData'), 'app_data');
    fs.ensureDirSync(dataPath);
}

// --- Main Window Creation ---
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    if (isDev) {
        mainWindow.webContents.openDevTools();
        // Watch frontend files for changes
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
                {
                    label: 'Change Data Location...',
                    click: async () => {
                        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory', 'createDirectory'],
                            title: 'Select a New Folder for Your Data'
                        });
                        if (!canceled && filePaths.length > 0) {
                            const newPath = filePaths[0];
                            if (newPath === dataPath) {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'Data Location',
                                    message: 'The selected location is already the current data location.'
                                });
                                return;
                            }
                            try {
                                await closeDb(); // Close DB before moving files
                                await fs.copy(dataPath, newPath);
                                await fs.remove(dataPath);
                                fs.writeFileSync(configPath, JSON.stringify({ dataPath: newPath }));
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'Data Location Changed',
                                    message: 'Your data has been moved successfully. The application will now restart.'
                                }).then(() => {
                                    app.relaunch();
                                    app.quit();
                                });
                            } catch (err) {
                                console.error('Failed to move data:', err);
                                dialog.showErrorBox('Error Moving Data', 'Could not move data to the new location. Please check permissions and try again.');
                                // Re-initialize with old path if move fails
                                loadDataPath();
                                await initDatabase(dataPath);
                            }
                        }
                    }
                },
                { type: 'separator' },
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
                    click: () => checkForUpdates(true) // Pass true for manual check
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

// --- Update Checker ---
async function checkForUpdates(manual = false) {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/alvarofranz/dashy/refs/heads/main/version.json');
        const latestVersion = response.data;
        const currentVersion = app.getVersion();

        if (compareVersions(latestVersion.version, currentVersion) > 0) {
            mainWindow.webContents.send('update-available', latestVersion);
        } else if (manual) {
            dialog.showMessageBox({
                type: 'info',
                title: 'No Updates',
                message: `You are currently running the latest version of Dashy (${currentVersion}).`
            });
        }
    } catch (error) {
        console.error('Failed to check for updates:', error.message);
        if (manual) {
            dialog.showErrorBox('Update Check Failed', 'Could not connect to the server to check for updates. Please check your internet connection.');
        }
    }
}

// --- App Lifecycle ---
app.on('ready', async () => {
    // MODIFIED: Register a custom protocol to serve files from the data directory
    protocol.handle('dashy-data', (request) => {
        const filePath = request.url.slice('dashy-data://'.length);
        const absolutePath = path.join(dataPath, filePath);
        // Use net.fetch to serve the file, which handles file system access correctly.
        return net.fetch(`file://${absolutePath}`);
    });

    loadDataPath();
    try {
        await initDatabase(dataPath);
        await runMigrations(); // Run migrations after DB is initialized
        registerIpcHandlers(dataPath); // Pass data path to handlers
        createWindow();
        createMenu();

        // Check for updates on startup (after a small delay)
        setTimeout(() => checkForUpdates(false), 5000);
    } catch (err) {
        console.error('Failed to initialize application:', err);
        dialog.showErrorBox('Initialization Failed', 'Dashy could not start. Please check the logs.');
        app.quit();
    }
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

// --- Generic IPC Handlers ---
ipcMain.handle('dialog:open-files', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, options);
    return canceled ? [] : filePaths;
});

ipcMain.handle('shell:open-external', (event, url) => {
    shell.openExternal(url);
});