require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const IntegrationService = require('./src/services/IntegrationService');
const RuntimeEnvironment = require('./src/services/RuntimeEnvironment');
const logger = require(path.join(__dirname, 'src', 'services', 'Logger'));
const runtimeEnv = new RuntimeEnvironment();

// Make logger available globally
global.logger = logger;

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;
let integrationService;

function createWindow() {
  // Create the browser window with glassy UI properties
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icons/icon.png')
  });

  // Load the index.html of the app
  mainWindow.loadFile('src/index.html');

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    // Dereference the window object
    mainWindow = null;
  });
}

// Create window when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();
  integrationService = new IntegrationService();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for communication with renderer process

// Handle project folder selection
ipcMain.handle('select-project-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder'
    });
    
    if (result.canceled) {
      return { canceled: true };
    }
    
    return result;
  } catch (error) {
    console.error('Error selecting project folder:', error);
    throw new Error(`Failed to select project folder: ${error.message}`);
  }
});

// Handle project generation request
ipcMain.handle('generate-project', async (event, { prompt, projectType, projectDir }) => {
  try {
    if (!prompt || !projectType || !projectDir) {
      throw new Error('Missing required parameters for project generation');
    }

    // Initialize integration service with project directory
    const initialized = await integrationService.initialize(projectDir);
    if (!initialized) {
      throw new Error('Failed to initialize integration service');
    }

    // Process the prompt with full context
    const result = await integrationService.aiService.generateProject(prompt, projectType, (progress) => {
      event.sender.send('generation-progress', progress);
    }, projectDir);

    // Save the generated files (already done per part in AIService)
    return {
      success: true,
      projectData: {
        name: path.basename(projectDir),
        description: prompt,
        type: projectType,
        files: result.projectData.files
      },
      projectPath: projectDir,
      plan: result.plan,
      context: result.context,
      codebaseAnalysis: result.codebaseAnalysis,
      lspContext: result.lspContext
    };
  } catch (error) {
    logger.error('Error generating project:', { error: error.message });
    // Send error progress to frontend
    event.sender.send('generation-progress', { stage: 'error', message: `Error: ${error.message}` });
    throw new Error(`Failed to generate project: ${error.message}`);
  }
});

// Handle project run request
ipcMain.handle('run-project', async (event, projectPath) => {
  try {
    // Log the request
    logger.info(`Running project at: ${projectPath}`);
    
    // Read project metadata
    const metadataPath = path.join(projectPath, 'project.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Invalid project: project.json not found');
    }
    
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    
    // Run the project
    const runResult = await runtimeEnv.runProject(projectPath, metadata.type);
    
    return {
      success: true,
      runResult
    };
  } catch (error) {
    logger.error('Error running project:', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
});

// Handle project export request
ipcMain.handle('export-project', async (event, projectPath) => {
  try {
    // Open dialog to select export location
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: path.join(app.getPath('documents'), 'DuggAi Projects'),
      buttonLabel: 'Export',
      properties: ['createDirectory']
    });
    
    if (!filePath) {
      return { success: false, error: 'Export cancelled' };
    }
    
    // Export the project
    const exportPath = await projectManager.exportProject(projectPath, filePath);
    
    return {
      success: true,
      exportPath
    };
  } catch (error) {
    console.error('Error exporting project:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Handle window controls
ipcMain.handle('window-control', (event, command) => {
  if (!mainWindow) return;
  
  switch (command) {
    case 'minimize':
      mainWindow.minimize();
      break;
    case 'maximize':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case 'close':
      mainWindow.close();
      break;
  }
});

// Add new IPC handlers for autonomous operations
ipcMain.handle('analyze-file', async (event, filePath) => {
  try {
    const analysis = await aiService.analyzeFile(filePath);
    return { success: true, analysis };
  } catch (error) {
    console.error('Error analyzing file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-code', async (event, { query, options }) => {
  try {
    const results = await aiService.searchCode(query, options);
    return { success: true, results };
  } catch (error) {
    console.error('Error searching code:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('understand-code', async (event, { code, context }) => {
  try {
    const understanding = await aiService.understandCode(code, context);
    return { success: true, understanding };
  } catch (error) {
    logger.error('Error understanding code:', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-autonomous-mode', async (event, enabled) => {
  try {
    if (enabled) {
      aiService.enableAutonomousMode();
      lspService.enableAutonomousMode();
    } else {
      aiService.disableAutonomousMode();
      lspService.disableAutonomousMode();
    }
    return { success: true };
  } catch (error) {
    console.error('Error toggling autonomous mode:', error);
    return { success: false, error: error.message };
  }
});

// Clean up when app is quitting
app.on('before-quit', async () => {
  if (integrationService) {
    await integrationService.cleanup();
  }
});

// Logger IPC handlers
ipcMain.handle('logger-info', (event, message, meta) => {
  logger.info(message, meta);
});

ipcMain.handle('logger-warn', (event, message, meta) => {
  logger.warn(message, meta);
});

ipcMain.handle('logger-error', (event, message, meta) => {
  logger.error(message, meta);
});

ipcMain.handle('logger-debug', (event, message, meta) => {
  logger.debug(message, meta);
});
