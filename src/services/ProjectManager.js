const fs = require('fs');
const path = require('path');
const EnhancedIndexer = require('../backend/indexer/enhancedIndexer');

class ProjectManager {
  constructor() {
    this.fs = fs;
    this.path = path;
    // Use a hardcoded projects directory for testing without electron
    this.projectsDir = this.path.join(process.cwd(), 'projects');
    this.indexer = new EnhancedIndexer();
    
    // Create projects directory if it doesn't exist
    if (!this.fs.existsSync(this.projectsDir)) {
      this.fs.mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  /**
   * Save a project to disk
   * @param {Object} projectData - The project data to save
   * @param {string} customBaseDir - Optional custom base directory for the project
   * @returns {Promise<string>} - The path to the saved project
   */
  async saveProject(projectData, customBaseDir) {
    try {
      const baseDir = customBaseDir || this.projectsDir;
      const projectDir = this.path.join(baseDir, projectData.name);
      
      // Log the intended project directory
      console.log('Saving project to:', projectDir);
      
      // Create project directory if it doesn't exist
      if (!this.fs.existsSync(projectDir)) {
        this.fs.mkdirSync(projectDir, { recursive: true });
      }
      
      // Write project metadata
      this.fs.writeFileSync(
        this.path.join(projectDir, 'project.json'),
        JSON.stringify({
          name: projectData.name,
          type: projectData.type,
          description: projectData.description,
          createdAt: new Date().toISOString()
        }, null, 2)
      );
      
      // Write project files
      for (const file of projectData.files) {
        const filePath = this.path.join(projectDir, file.path);
        const fileDir = this.path.dirname(filePath);
        
        // Create directory if it doesn't exist
        if (!this.fs.existsSync(fileDir)) {
          this.fs.mkdirSync(fileDir, { recursive: true });
        }
        
        try {
        this.fs.writeFileSync(filePath, file.content);
          console.log('Wrote file:', filePath);
        } catch (fileError) {
          console.error('Error writing file:', filePath, fileError);
        }
      }
      
      // Index the project after saving
      this.indexer.indexProject(projectDir);
      
      return projectDir;
    } catch (error) {
      console.error('Error saving project:', error);
      throw error;
    }
  }

  /**
   * Load a project from disk
   * @param {string} projectPath - The path to the project
   * @returns {Promise<Object>} - The loaded project data
   */
  async loadProject(projectPath) {
    try {
      // Read project metadata
      const metadataPath = this.path.join(projectPath, 'project.json');
      if (!this.fs.existsSync(metadataPath)) {
        throw new Error('Invalid project: project.json not found');
      }
      
      const metadata = JSON.parse(this.fs.readFileSync(metadataPath, 'utf8'));
      
      // Read project files
      const files = [];
      await this.readProjectFiles(projectPath, '', files);
      
      return {
        ...metadata,
        path: projectPath,
        files
      };
    } catch (error) {
      console.error('Error loading project:', error);
      throw new Error(`Failed to load project: ${error.message}`);
    }
  }

  /**
   * Recursively read project files
   * @param {string} basePath - The base path of the project
   * @param {string} relativePath - The relative path within the project
   * @param {Array} files - The array to store file data
   */
  async readProjectFiles(basePath, relativePath, files) {
    const currentPath = this.path.join(basePath, relativePath);
    const entries = this.fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryRelativePath = this.path.join(relativePath, entry.name);
      const entryPath = this.path.join(basePath, entryRelativePath);
      
      if (entry.isDirectory()) {
        // Skip node_modules and other special directories
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        
        // Recursively read subdirectory
        await this.readProjectFiles(basePath, entryRelativePath, files);
      } else if (entry.isFile()) {
        // Skip project.json and other metadata files
        if (entry.name === 'project.json') {
          continue;
        }
        
        // Read file content
        let content;
        try {
          // For binary files, we'll skip them for now
          // In a real app, we might handle them differently
          const ext = this.path.extname(entry.name).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg'].includes(ext)) {
            // Skip binary files
            continue;
          }
          
          content = this.fs.readFileSync(entryPath, 'utf8');
        } catch (error) {
          console.warn(`Skipping file ${entryRelativePath}: ${error.message}`);
          continue;
        }
        
        // Add file to the list
        files.push({
          path: entryRelativePath.replace(/\\/g, '/'), // Normalize path separators
          content
        });
      }
    }
  }

  /**
   * List all projects
   * @returns {Promise<Array>} - The list of projects
   */
  async listProjects() {
    try {
      const projects = [];
      
      // Read projects directory
      const entries = this.fs.readdirSync(this.projectsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectPath = this.path.join(this.projectsDir, entry.name);
          const metadataPath = this.path.join(projectPath, 'project.json');
          
          if (this.fs.existsSync(metadataPath)) {
            try {
              const metadata = JSON.parse(this.fs.readFileSync(metadataPath, 'utf8'));
              projects.push({
                ...metadata,
                id: entry.name,
                path: projectPath
              });
            } catch (error) {
              console.warn(`Skipping project ${entry.name}: ${error.message}`);
            }
          }
        }
      }
      
      // Sort by creation date (newest first)
      projects.sort((a, b) => {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      
      return projects;
    } catch (error) {
      console.error('Error listing projects:', error);
      throw new Error(`Failed to list projects: ${error.message}`);
    }
  }

  /**
   * Delete a project
   * @param {string} projectPath - The path to the project
   * @returns {Promise<boolean>} - Whether the deletion was successful
   */
  async deleteProject(projectPath) {
    try {
      // Check if the project exists
      if (!this.fs.existsSync(projectPath)) {
        throw new Error('Project not found');
      }
      
      // Delete the project directory recursively
      this.deleteFolderRecursive(projectPath);
      
      return true;
    } catch (error) {
      console.error('Error deleting project:', error);
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }

  /**
   * Recursively delete a folder
   * @param {string} path - The path to delete
   */
  deleteFolderRecursive(path) {
    if (this.fs.existsSync(path)) {
      this.fs.readdirSync(path).forEach((file) => {
        const curPath = this.path.join(path, file);
        if (this.fs.lstatSync(curPath).isDirectory()) {
          // Recursive call
          this.deleteFolderRecursive(curPath);
        } else {
          // Delete file
          this.fs.unlinkSync(curPath);
        }
      });
      this.fs.rmdirSync(path);
    }
  }

  /**
   * Export a project to a specified location
   * @param {string} projectPath - The path to the project
   * @param {string} exportPath - The path to export to
   * @returns {Promise<string>} - The path to the exported project
   */
  async exportProject(projectPath, exportPath) {
    try {
      // Check if the project exists
      if (!this.fs.existsSync(projectPath)) {
        throw new Error('Project not found');
      }
      
      // Create export directory if it doesn't exist
      if (!this.fs.existsSync(exportPath)) {
        this.fs.mkdirSync(exportPath, { recursive: true });
      }
      
      // Copy project files
      this.copyFolderRecursive(projectPath, exportPath);
      
      return exportPath;
    } catch (error) {
      console.error('Error exporting project:', error);
      throw new Error(`Failed to export project: ${error.message}`);
    }
  }

  /**
   * Recursively copy a folder
   * @param {string} source - The source path
   * @param {string} target - The target path
   */
  copyFolderRecursive(source, target) {
    // Create target directory if it doesn't exist
    if (!this.fs.existsSync(target)) {
      this.fs.mkdirSync(target, { recursive: true });
    }
    
    // Copy each file/directory from source to target
    const files = this.fs.readdirSync(source);
    
    for (const file of files) {
      const sourcePath = this.path.join(source, file);
      const targetPath = this.path.join(target, file);
      
      const stat = this.fs.statSync(sourcePath);
      
      if (stat.isDirectory()) {
        // Skip node_modules and other special directories
        if (file === 'node_modules' || file === '.git') {
          continue;
        }
        
        this.copyFolderRecursive(sourcePath, targetPath);
      } else {
        // Skip project.json and other metadata files
        if (file === 'project.json') {
          continue;
        }
        
        this.fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }
}

module.exports = ProjectManager;
