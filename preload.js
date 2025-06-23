// MODIFIED: Switched from 'import' to 'require' to conform to preload script context
const { contextBridge, ipcRenderer } = require('electron');

const validChannels = [
    'get:recent', 'get:bootstrap', 'get:custom-object-types', 'get:objects', 'get:object',
    'search:objects',
    'create:object',
    'update:object', 'update:kv',
    'add:kv',
    'delete:kv', 'delete:object',
    'link:objects', 'unlink:objects',
    'dialog:open-files',
    'shell:open-external',
    'check-for-updates'
];

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, ...args) => {
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        console.error(`Invalid IPC channel used: ${channel}`);
    },
    on: (channel, callback) => {
        const validReceiveChannels = ['update-available'];
        if (validReceiveChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender`
            const subscription = (event, ...args) => callback(...args);
            ipcRenderer.on(channel, subscription);
            // Return a function to remove the listener
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
        console.error(`Invalid IPC receive channel used: ${channel}`);
    }
});