const { contextBridge, ipcRenderer } = require('electron');

const validChannels = [
    // Core App Channels
    'app:init-check', 'app:set-data-path', 'app:get-settings', 'app:change-data-path',
    'dialog:open-files', 'shell:open-external', 'shell:open-path', 'shell:show-item-in-folder',
    'app:quit-and-install',
    // Data Channels
    'get:recent', 'get:bootstrap', 'get:custom-object-types', 'get:objects', 'get:object',
    'get:kv-keys',
    'search:objects',
    'create:object',
    'update:object', 'update:kv',
    'add:kv',
    'delete:kv', 'delete:object',
    'link:objects', 'unlink:objects',
];

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => {
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        console.error(`Invalid IPC channel used: ${channel}`);
        return Promise.reject(new Error(`Invalid IPC channel used: ${channel}`));
    },
    on: (channel, callback) => {
        const validReceiveChannels = ['update-downloaded'];
        if (validReceiveChannels.includes(channel)) {
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
        console.error(`Invalid IPC receive channel used: ${channel}`);
    }
});