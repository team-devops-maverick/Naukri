'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
} = require('electron');

const path = require('path');
const { spawn } = require('child_process');
const { waitForPort } = require('./src/ipc');

let mainWindow = null;
let javaProcess = null;

// Parse --e2e-mock=<url> from argv (used by Playwright E2E tests).
// Example:
// electron . --e2e-mock=http://127.0.0.1:9000
const e2eMockArg = process.argv.find((a) =>
  a.startsWith('--e2e-mock=')
);

const e2eMockUrl = e2eMockArg
  ? e2eMockArg.slice('--e2e-mock='.length)
  : null;


/**
 * Spawn the backend Java process.
 *
 * Development:
 *   Uses the Java installed on the machine and:
 *   ../backend/target/naukri-be.jar
 *
 * Packaged:
 *   Uses the bundled JRE and:
 *   resources/backend/naukri-be.jar
 */
function spawnBackend() {
  let javaExe;
  let jar;

  if (app.isPackaged) {
    // ---------------------------------------------------------
    // PACKAGED APPLICATION
    // ---------------------------------------------------------
    const resourcesPath = process.resourcesPath;

    javaExe = path.join(
      resourcesPath,
      'jre',
      'bin',
      'java.exe'
    );

    jar = path.join(
      resourcesPath,
      'backend',
      'naukri-be.jar'
    );

    console.log('[electron] Mode: PACKAGED');
  } else {
    // ---------------------------------------------------------
    // DEVELOPMENT
    // ---------------------------------------------------------
    //
    // Project structure:
    //
    // Naukri
    // ├── backend
    // │   └── target
    // │       └── naukri-be.jar
    // │
    // ├── frontend
    // │   └── dist
    // │       └── index.html
    // │
    // └── electron
    //     └── main.js
    //

    const javaHome = process.env.JAVA_HOME;

    if (javaHome) {
      javaExe = path.join(javaHome, 'bin', 'java.exe');
    } else {
      javaExe = 'java';
    }

    jar = path.join(
      __dirname,
      '..',
      'backend',
      'target',
      'naukri-be.jar'
    );

    console.log('[electron] Mode: DEVELOPMENT');
  }

  console.log('[electron] Java executable:', javaExe);
  console.log('[electron] Backend JAR:', jar);

  const child = spawn(
    javaExe,
    [
      '-jar',
      jar,
      '--server.port=0',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    }
  );

  // Backend stdout
  child.stdout.on('data', (data) => {
    process.stdout.write(
      `[backend] ${data}`
    );
  });

  // Backend stderr
  child.stderr.on('data', (data) => {
    process.stderr.write(
      `[backend] ${data}`
    );
  });

  child.on('error', (err) => {
    console.error(
      '[electron] Failed to start backend:',
      err.message
    );
  });

  child.on('exit', (code, signal) => {
    console.log(
      `[electron] Backend exited. code=${code}, signal=${signal}`
    );
  });

  return child;
}


/**
 * Create the Electron browser window.
 */
async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,

    backgroundColor: '#050915',

    autoHideMenuBar: true,

    title: 'NaukriAutomator',

    webPreferences: {
      preload: path.join(
        __dirname,
        'preload.js'
      ),

      contextIsolation: true,

      sandbox: true,

      nodeIntegration: false,
    },
  });


  // ---------------------------------------------------------
  // DETERMINE FRONTEND LOCATION
  // ---------------------------------------------------------
  //
  // Development:
  //
  // Naukri
  // └── frontend
  //     └── dist
  //         └── index.html
  //
  //
  // Packaged:
  //
  // application
  // └── renderer
  //     └── index.html
  //

  let indexPath;

  if (app.isPackaged) {
    indexPath = path.join(
      __dirname,
      'renderer',
      'index.html'
    );

    console.log(
      '[electron] Renderer mode: PACKAGED'
    );
  } else {
    indexPath = path.join(
      __dirname,
      '..',
      'frontend',
      'dist',
      'index.html'
    );

    console.log(
      '[electron] Renderer mode: DEVELOPMENT'
    );
  }

  console.log(
    '[electron] Renderer:',
    indexPath
  );

  // Query parameters passed to frontend.
  const query = {
    port: String(port),
  };

  if (e2eMockUrl) {
    query.e2eMock = e2eMockUrl;
  }

  console.log(
    '[electron] Backend port:',
    port
  );

  // Load frontend
  mainWindow.loadFile(
    indexPath,
    { query }
  );


  // Handle renderer loading errors.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        '[electron] Renderer failed to load:',
        {
          errorCode,
          errorDescription,
          validatedURL,
        }
      );
    }
  );


  // Renderer loaded successfully.
  mainWindow.webContents.on(
    'did-finish-load',
    () => {
      console.log(
        '[electron] Renderer loaded successfully'
      );
    }
  );


  // Cleanup backend when window closes.
  mainWindow.on('closed', () => {
    mainWindow = null;

    if (javaProcess) {
      console.log(
        '[electron] Stopping backend...'
      );

      javaProcess.kill();

      javaProcess = null;
    }
  });
}


/**
 * IPC: pickFolder
 *
 * Opens a native folder-picker dialog.
 */
ipcMain.handle(
  'pickFolder',
  async (_event, defaultPath) => {
    if (!mainWindow) {
      return null;
    }

    const result =
      await dialog.showOpenDialog(
        mainWindow,
        {
          properties: [
            'openDirectory',
          ],

          defaultPath:
            defaultPath || undefined,
        }
      );

    if (
      result.canceled ||
      result.filePaths.length === 0
    ) {
      return null;
    }

    return result.filePaths[0];
  }
);


/**
 * IPC: openFolder
 *
 * Opens/reveals a folder in Windows File Explorer.
 */
ipcMain.handle(
  'openFolder',
  async (_event, folderPath) => {
    if (folderPath) {
      await shell.openPath(folderPath);
    }
  }
);


/**
 * Electron startup.
 */
app.whenReady().then(async () => {
  try {
    console.log(
      '[electron] Starting NaukriAutomator...'
    );

    // Start backend
    javaProcess = spawnBackend();

    // Wait up to 60 seconds for backend
    // to announce its dynamically assigned port.
    const port = await waitForPort(
      javaProcess,
      60_000
    );

    console.log(
      '[electron] Backend started on port:',
      port
    );

    // Start frontend
    await createWindow(port);

  } catch (err) {
    console.error(
      '[electron] Startup error:',
      err.message
    );

    // Still open the frontend so we can
    // diagnose renderer-side problems.
    await createWindow(0);
  }
});


/**
 * macOS application activation.
 */
app.on(
  'activate',
  () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow(0);
    }
  }
);


/**
 * Close application when all windows close.
 */
app.on(
  'window-all-closed',
  () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
);


/**
 * Final backend cleanup.
 */
app.on(
  'will-quit',
  () => {
    if (javaProcess) {
      console.log(
        '[electron] Killing backend process...'
      );

      javaProcess.kill();

      javaProcess = null;
    }
  }
);