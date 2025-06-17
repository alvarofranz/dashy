Structure:

dashy/
├── app/
│   ├── database.js
│   └── routes.js
├── data/
│   ├── files/
│   └── images/
├── public/
│   ├── css/
│   │   └── style.css
└── js/
    ├── api.js          // New: Handles all API calls
    ├── main.js         // Updated
    └── ui/             // New Folder
        ├── events.js       // New: Handles all UI event listeners
        ├── forms.js        // New: Handles form rendering/logic
        ├── main_view.js    // New: Renders the main object/list views
        └── modal.js        // New: Manages the new linking modal
├── .gitignore
├── package.json
└── server.js