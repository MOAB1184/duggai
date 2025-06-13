const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    // Window controls
    windowControl: async (command) => {
      try {
        return await ipcRenderer.invoke('window-control', command);
      } catch (error) {
        console.error('Window control error:', error);
        throw new Error(`Failed to control window: ${error.message}`);
      }
    },
    
    // Project management
    generateProject: async (data) => {
      try {
        if (!data.prompt || !data.projectType || !data.projectDir) {
          throw new Error('Missing required parameters for project generation');
        }
        return await ipcRenderer.invoke('generate-project', data);
      } catch (error) {
        console.error('Project generation error:', error);
        throw new Error(`Failed to generate project: ${error.message}`);
      }
    },
    
    runProject: async (projectPath) => {
      try {
        if (!projectPath) {
          throw new Error('Project path is required');
        }
        return await ipcRenderer.invoke('run-project', projectPath);
      } catch (error) {
        console.error('Project run error:', error);
        throw new Error(`Failed to run project: ${error.message}`);
      }
    },
    
    exportProject: async (projectPath) => {
      try {
        if (!projectPath) {
          throw new Error('Project path is required');
        }
        return await ipcRenderer.invoke('export-project', projectPath);
      } catch (error) {
        console.error('Project export error:', error);
        throw new Error(`Failed to export project: ${error.message}`);
      }
    },
    
    // File system
    selectProjectFolder: async () => {
      try {
        const result = await ipcRenderer.invoke('select-project-folder');
        if (!result || !result.filePaths || !result.filePaths[0]) {
          throw new Error('No folder selected');
        }
        return result;
      } catch (error) {
        console.error('Folder selection error:', error);
        throw new Error(`Failed to select folder: ${error.message}`);
      }
    },
    
    // Progress updates
    onGenerationProgress: (callback) => {
      try {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('generation-progress', subscription);
        return () => {
          ipcRenderer.removeListener('generation-progress', subscription);
        };
      } catch (error) {
        console.error('Progress subscription error:', error);
        throw new Error(`Failed to subscribe to progress: ${error.message}`);
      }
    },
    
    // AI operations
    analyzeFile: async (filePath) => {
      try {
        if (!filePath) {
          throw new Error('File path is required');
        }
        return await ipcRenderer.invoke('analyze-file', filePath);
      } catch (error) {
        console.error('File analysis error:', error);
        throw new Error(`Failed to analyze file: ${error.message}`);
      }
    },
    
    searchCode: async (query, options) => {
      try {
        if (!query) {
          throw new Error('Search query is required');
        }
        return await ipcRenderer.invoke('search-code', { query, options });
      } catch (error) {
        console.error('Code search error:', error);
        throw new Error(`Failed to search code: ${error.message}`);
      }
    },
    
    understandCode: async (code, context) => {
      try {
        if (!code) {
          throw new Error('Code is required');
        }
        return await ipcRenderer.invoke('understand-code', { code, context });
      } catch (error) {
        console.error('Code understanding error:', error);
        throw new Error(`Failed to understand code: ${error.message}`);
      }
    },
    
    toggleAutonomousMode: async (enabled) => {
      try {
        return await ipcRenderer.invoke('toggle-autonomous-mode', enabled);
      } catch (error) {
        console.error('Autonomous mode toggle error:', error);
        throw new Error(`Failed to toggle autonomous mode: ${error.message}`);
      }
    },
    
    // Logger
    logger: {
      info: (message, meta) => ipcRenderer.invoke('logger-info', message, meta),
      warn: (message, meta) => ipcRenderer.invoke('logger-warn', message, meta),
      error: (message, meta) => ipcRenderer.invoke('logger-error', message, meta),
      debug: (message, meta) => ipcRenderer.invoke('logger-debug', message, meta)
    }
  }
);
