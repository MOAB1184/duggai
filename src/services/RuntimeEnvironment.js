class RuntimeEnvironment {
  constructor() {
    this.electron = require('electron');
    this.isRenderer = process.type === 'renderer';
    
    if (this.isRenderer) {
      this.BrowserWindow = this.electron.remote.BrowserWindow;
    } else {
      this.BrowserWindow = this.electron.BrowserWindow;
    }
    
    this.app = this.isRenderer ? this.electron.remote.app : this.electron.app;
    this.dialog = this.isRenderer ? this.electron.remote.dialog : this.electron.dialog;
    this.shell = this.isRenderer ? this.electron.remote.shell : this.electron.shell;
    this.path = require('path');
    this.fs = require('fs');
    this.childProcess = require('child_process');
    this.runningProcesses = new Map();
  }

  /**
   * Run a project
   * @param {string} projectPath - The path to the project
   * @param {string} projectType - The type of project
   * @returns {Promise<Object>} - Information about the running project
   */
  async runProject(projectPath, projectType) {
    try {
      switch (projectType) {
        case 'web':
          return await this.runWebProject(projectPath);
        case 'node':
          return await this.runNodeProject(projectPath);
        case 'react':
          return await this.runReactProject(projectPath);
        case 'python':
          return await this.runPythonProject(projectPath);
        default:
          throw new Error(`Unsupported project type: ${projectType}`);
      }
    } catch (error) {
      console.error('Error running project:', error);
      throw new Error(`Failed to run project: ${error.message}`);
    }
  }

  /**
   * Run a web project
   * @param {string} projectPath - The path to the project
   * @returns {Promise<Object>} - Information about the running project
   */
  async runWebProject(projectPath) {
    // Check if index.html exists
    const indexPath = this.path.join(projectPath, 'index.html');
    if (!this.fs.existsSync(indexPath)) {
      throw new Error('Invalid web project: index.html not found');
    }
    
    // Create a new window to run the project
    const projectWindow = new this.BrowserWindow({
      width: 1024,
      height: 768,
      title: this.path.basename(projectPath),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Load the project
    await projectWindow.loadFile(indexPath);
    
    // Store the window reference
    const windowId = projectWindow.id;
    this.runningProcesses.set(windowId, {
      type: 'web',
      window: projectWindow,
      projectPath
    });
    
    // Handle window close
    projectWindow.on('closed', () => {
      this.runningProcesses.delete(windowId);
    });
    
    return {
      type: 'web',
      windowId
    };
  }

  /**
   * Run a Node.js project
   * @param {string} projectPath - The path to the project
   * @returns {Promise<Object>} - Information about the running project
   */
  async runNodeProject(projectPath) {
    // Check if index.js or main.js exists
    let entryPoint = this.path.join(projectPath, 'index.js');
    if (!this.fs.existsSync(entryPoint)) {
      entryPoint = this.path.join(projectPath, 'main.js');
      if (!this.fs.existsSync(entryPoint)) {
        throw new Error('Invalid Node.js project: No entry point found (index.js or main.js)');
      }
    }
    
    // Start the Node.js process
    const process = this.childProcess.spawn('node', [entryPoint], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Generate a unique ID for this process
    const processId = Date.now().toString();
    
    // Store the process reference
    this.runningProcesses.set(processId, {
      type: 'node',
      process,
      projectPath,
      output: []
    });
    
    // Handle process output
    process.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Node.js] ${output}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'stdout',
          content: output
        });
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Node.js] ${output}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'stderr',
          content: output
        });
      }
    });
    
    // Handle process exit
    process.on('exit', (code) => {
      console.log(`Node.js process exited with code ${code}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'exit',
          content: `Process exited with code ${code}`
        });
        processInfo.exited = true;
        processInfo.exitCode = code;
      }
    });
    
    return {
      type: 'node',
      processId
    };
  }

  /**
   * Run a React project
   * @param {string} projectPath - The path to the project
   * @returns {Promise<Object>} - Information about the running project
   */
  async runReactProject(projectPath) {
    // For simplicity, we'll treat React projects like web projects for now
    // In a real implementation, we might use a development server
    return this.runWebProject(projectPath);
  }

  /**
   * Run a Python project
   * @param {string} projectPath - The path to the project
   * @returns {Promise<Object>} - Information about the running project
   */
  async runPythonProject(projectPath) {
    // Check if main.py exists
    const entryPoint = this.path.join(projectPath, 'main.py');
    if (!this.fs.existsSync(entryPoint)) {
      throw new Error('Invalid Python project: main.py not found');
    }
    
    // Start the Python process
    const process = this.childProcess.spawn('python', [entryPoint], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Generate a unique ID for this process
    const processId = Date.now().toString();
    
    // Store the process reference
    this.runningProcesses.set(processId, {
      type: 'python',
      process,
      projectPath,
      output: []
    });
    
    // Handle process output
    process.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Python] ${output}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'stdout',
          content: output
        });
      }
    });
    
    process.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Python] ${output}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'stderr',
          content: output
        });
      }
    });
    
    // Handle process exit
    process.on('exit', (code) => {
      console.log(`Python process exited with code ${code}`);
      
      const processInfo = this.runningProcesses.get(processId);
      if (processInfo) {
        processInfo.output.push({
          type: 'exit',
          content: `Process exited with code ${code}`
        });
        processInfo.exited = true;
        processInfo.exitCode = code;
      }
    });
    
    return {
      type: 'python',
      processId
    };
  }

  /**
   * Stop a running project
   * @param {string} id - The ID of the running project (window ID or process ID)
   * @returns {Promise<boolean>} - Whether the stop was successful
   */
  async stopProject(id) {
    try {
      const processInfo = this.runningProcesses.get(id);
      if (!processInfo) {
        throw new Error('Project not found');
      }
      
      if (processInfo.type === 'web') {
        // Close the window
        if (processInfo.window && !processInfo.window.isDestroyed()) {
          processInfo.window.close();
        }
      } else {
        // Kill the process
        if (processInfo.process && !processInfo.exited) {
          processInfo.process.kill();
        }
      }
      
      // Remove from running processes
      this.runningProcesses.delete(id);
      
      return true;
    } catch (error) {
      console.error('Error stopping project:', error);
      throw new Error(`Failed to stop project: ${error.message}`);
    }
  }

  /**
   * Get the output of a running project
   * @param {string} id - The ID of the running project (process ID)
   * @returns {Promise<Array>} - The output of the project
   */
  async getProjectOutput(id) {
    try {
      const processInfo = this.runningProcesses.get(id);
      if (!processInfo) {
        throw new Error('Project not found');
      }
      
      if (processInfo.type === 'web') {
        return []; // Web projects don't have console output in this context
      } else {
        return processInfo.output || [];
      }
    } catch (error) {
      console.error('Error getting project output:', error);
      throw new Error(`Failed to get project output: ${error.message}`);
    }
  }

  /**
   * Check if a project is running
   * @param {string} id - The ID of the project (window ID or process ID)
   * @returns {Promise<boolean>} - Whether the project is running
   */
  async isProjectRunning(id) {
    try {
      const processInfo = this.runningProcesses.get(id);
      if (!processInfo) {
        return false;
      }
      
      if (processInfo.type === 'web') {
        return processInfo.window && !processInfo.window.isDestroyed();
      } else {
        return processInfo.process && !processInfo.exited;
      }
    } catch (error) {
      console.error('Error checking if project is running:', error);
      return false;
    }
  }
}

module.exports = RuntimeEnvironment;
