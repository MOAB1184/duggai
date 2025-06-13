// Renderer process script for DuggAi desktop application
// Handles UI interactions and communicates with the main process

// DOM Elements
const elements = {
  // Navigation
  navItems: document.querySelectorAll('.nav-item'),
  views: document.querySelectorAll('.view'),
  
  // Window controls
  minimizeBtn: document.getElementById('minimize-btn'),
  maximizeBtn: document.getElementById('maximize-btn'),
  closeBtn: document.getElementById('close-btn'),
  
  // Welcome view
  newProjectBtn: document.getElementById('new-project-btn'),
  openProjectBtn: document.getElementById('open-project-btn'),
  createFirstProjectBtn: document.getElementById('create-first-project-btn'),
  recentProjectsList: document.getElementById('recent-projects-list'),
  
  // Project creation view
  projectPrompt: document.getElementById('project-prompt'),
  projectType: document.getElementById('project-type'),
  generateProjectBtn: document.getElementById('generate-project-btn'),
  cancelCreationBtn: document.getElementById('cancel-creation-btn'),
  exampleItems: document.querySelectorAll('.example-item'),
  
  // Project generation view
  generationProgressBar: document.getElementById('generation-progress-bar'),
  generationStatus: document.getElementById('generation-status'),
  generationLogContent: document.getElementById('generation-log-content'),
  cancelGenerationBtn: document.getElementById('cancel-generation-btn'),
  
  // Project overview view
  projectTitle: document.getElementById('project-title'),
  projectDescription: document.getElementById('project-description'),
  projectFileTree: document.getElementById('project-file-tree'),
  fileTabs: document.getElementById('file-tabs'),
  fileContent: document.getElementById('file-content'),
  runProjectBtn: document.getElementById('run-project-btn'),
  exportProjectBtn: document.getElementById('export-project-btn'),
  editProjectBtn: document.getElementById('edit-project-btn'),
  backToHomeBtn: document.getElementById('back-to-home-btn'),
  
  // Project running view
  runningProjectTitle: document.getElementById('running-project-title'),
  previewFrame: document.getElementById('preview-frame'),
  refreshPreviewBtn: document.getElementById('refresh-preview-btn'),
  openExternalBtn: document.getElementById('open-external-btn'),
  consoleOutput: document.getElementById('console-output'),
  clearConsoleBtn: document.getElementById('clear-console-btn'),
  stopProjectBtn: document.getElementById('stop-project-btn'),
  backToOverviewBtn: document.getElementById('back-to-overview-btn'),
  
  // Projects view
  allProjectsList: document.getElementById('all-projects-list'),
  createProjectBtn: document.getElementById('create-project-btn'),
  
  // Templates view
  useTemplateButtons: document.querySelectorAll('.use-template-btn'),
  
  // Settings view
  apiKey: document.getElementById('api-key'),
  saveApiKeyBtn: document.getElementById('save-api-key-btn'),
  projectsLocation: document.getElementById('projects-location'),
  changeLocationBtn: document.getElementById('change-location-btn'),
  themeSelect: document.getElementById('theme-select'),
  
  // New elements
  folderSelectBtn: document.getElementById('select-folder-btn'),
  folderPathDisplay: document.getElementById('selected-folder-path')
};

// State management
const state = {
  currentView: 'welcome-view',
  currentProject: null,
  currentFile: null,
  projects: [],
  isGenerating: false,
  apiKey: 'AIzaSyC9h2T7dsxIE6DCPTclWOVYLisYss4b0QQ',
  theme: 'dark'
};

// Listen for log messages from main process
window.api.onGenerationProgress((entry) => {
  const { level, message, timestamp } = entry;
  addConsoleEntry(`[${level.toUpperCase()}] ${message}`, level);
});

// Initialize the application
function init() {
  // Set up event listeners
  setupEventListeners();
  
  // Load saved API key if available
  loadSettings();
  
  // Load projects
  loadProjects();
}

// Set up event listeners for UI interactions
function setupEventListeners() {
  // Window controls
  elements.minimizeBtn.addEventListener('click', () => {
    window.api.windowControl('minimize');
  });
  
  elements.maximizeBtn.addEventListener('click', () => {
    window.api.windowControl('maximize');
  });
  
  elements.closeBtn.addEventListener('click', () => {
    window.api.windowControl('close');
  });
  
  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.getAttribute('data-view');
      navigateTo(view);
    });
  });
  
  // Welcome view
  elements.newProjectBtn.addEventListener('click', () => {
    navigateTo('project-creation');
  });
  
  elements.createFirstProjectBtn.addEventListener('click', () => {
    navigateTo('project-creation');
  });
  
  // Project creation view
  elements.exampleItems.forEach(item => {
    item.addEventListener('click', () => {
      const prompt = item.getAttribute('data-prompt');
      elements.projectPrompt.value = prompt;
    });
  });
  
  elements.generateProjectBtn.addEventListener('click', () => {
    generateProject();
  });
  
  elements.cancelCreationBtn.addEventListener('click', () => {
    navigateTo('welcome');
  });
  
  // Project generation view
  elements.cancelGenerationBtn.addEventListener('click', () => {
    cancelGeneration();
  });
  
  // Project overview view
  elements.runProjectBtn.addEventListener('click', () => {
    runProject();
  });
  
  elements.exportProjectBtn.addEventListener('click', () => {
    exportProject();
  });
  
  elements.backToHomeBtn.addEventListener('click', () => {
    navigateTo('welcome');
  });
  
  // Project running view
  elements.refreshPreviewBtn.addEventListener('click', () => {
    refreshPreview();
  });
  
  elements.stopProjectBtn.addEventListener('click', () => {
    stopProject();
  });
  
  elements.backToOverviewBtn.addEventListener('click', () => {
    navigateTo('project-overview');
  });
  
  elements.clearConsoleBtn.addEventListener('click', () => {
    clearConsole();
  });
  
  // Projects view
  elements.createProjectBtn.addEventListener('click', () => {
    navigateTo('project-creation');
  });
  
  // Templates view
  elements.useTemplateButtons.forEach(button => {
    button.addEventListener('click', () => {
      const template = button.getAttribute('data-template');
      useTemplate(template);
    });
  });
  
  // Settings view
  elements.saveApiKeyBtn.addEventListener('click', () => {
    saveApiKey();
  });
  
  elements.themeSelect.addEventListener('change', () => {
    changeTheme();
  });
  
  // New elements
  elements.folderSelectBtn.addEventListener('click', async () => {
    try {
      const result = await window.api.selectProjectFolder();
      if (result && result.filePaths && result.filePaths[0]) {
        state.selectedProjectFolder = result.filePaths[0];
        elements.folderPathDisplay.textContent = state.selectedProjectFolder;
        elements.generateProjectBtn.disabled = false;
        showNotification('Project folder selected', 'success');
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      showNotification(error.message, 'error');
    }
  });
}

// Navigation
function navigateTo(view) {
  // Hide all views
  elements.views.forEach(v => {
    v.classList.remove('active');
  });
  
  // Remove active class from all nav items
  elements.navItems.forEach(item => {
    item.classList.remove('active');
  });
  
  // Show the selected view
  const viewElement = document.getElementById(`${view}-view`);
  if (viewElement) {
    viewElement.classList.add('active');
    state.currentView = `${view}-view`;
    
    // Add active class to the corresponding nav item
    const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navItem) {
      navItem.classList.add('active');
    }
    
    // Perform any necessary view-specific initialization
    initView(view);
  }
}

// Initialize view-specific content
function initView(view) {
  switch (view) {
    case 'welcome':
      updateRecentProjects();
      break;
    case 'projects':
      updateAllProjects();
      break;
    case 'settings':
      updateSettingsView();
      break;
    case 'project-creation':
      // Initialize generate project button state
      elements.generateProjectBtn.disabled = !state.selectedProjectFolder;
      break;
  }
}

// Load saved settings
function loadSettings() {
  // In a real app, this would load from electron-store
  // For now, we'll use the default values
  elements.apiKey.value = state.apiKey;
  elements.projectsLocation.value = 'User Data Directory/projects';
  elements.themeSelect.value = state.theme;
}

// Save API key
function saveApiKey() {
  const newApiKey = elements.apiKey.value.trim();
  if (newApiKey) {
    state.apiKey = newApiKey;
    // In a real app, this would save to electron-store
    showNotification('API key saved successfully', 'success');
  } else {
    showNotification('Please enter a valid API key', 'error');
  }
}

// Change theme
function changeTheme() {
  const newTheme = elements.themeSelect.value;
  state.theme = newTheme;
  // In a real app, this would apply the theme to the app
  // and save to electron-store
}

// Save projects to localStorage
function saveProjects() {
  try {
    localStorage.setItem('duggai_projects', JSON.stringify(state.projects));
  } catch (err) {
    console.error('Failed to save projects:', err);
  }
}

// Load projects from localStorage
function loadProjects() {
  try {
    const saved = localStorage.getItem('duggai_projects');
    state.projects = saved ? JSON.parse(saved) : [];
  } catch (err) {
    state.projects = [];
    console.error('Failed to load projects:', err);
  }
  updateRecentProjects();
  updateAllProjects();
}

// Update recent projects list
function updateRecentProjects() {
  if (state.projects.length === 0) {
    elements.recentProjectsList.innerHTML = `
      <div class="empty-state">
        <p>No recent projects found</p>
        <button id="create-first-project-btn" class="btn-secondary">Create Your First Project</button>
      </div>
    `;
    document.getElementById('create-first-project-btn').addEventListener('click', () => {
      navigateTo('project-creation');
    });
  } else {
    elements.recentProjectsList.innerHTML = state.projects.map(project => `
      <div class="project-card glass-panel" data-project-id="${project.id}">
        <h3>${project.name}</h3>
        <p>${project.description}</p>
        <div class="project-card-actions">
          <button class="btn-secondary open-project-btn">Open</button>
        </div>
      </div>
    `).join('');
    
    // Add event listeners to the new elements
    document.querySelectorAll('.open-project-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const projectCard = e.target.closest('.project-card');
        const projectId = projectCard.getAttribute('data-project-id');
        openProject(projectId);
      });
    });
  }
}

// Update all projects list
function updateAllProjects() {
  if (state.projects.length === 0) {
    elements.allProjectsList.innerHTML = `
      <div class="empty-state">
        <p>No projects found</p>
        <button id="create-project-btn" class="btn-secondary">Create a Project</button>
      </div>
    `;
    document.getElementById('create-project-btn').addEventListener('click', () => {
      navigateTo('project-creation');
    });
  } else {
    elements.allProjectsList.innerHTML = state.projects.map(project => `
      <div class="project-card glass-panel" data-project-id="${project.id}">
        <h3>${project.name}</h3>
        <p>${project.description}</p>
        <div class="project-card-actions">
          <button class="btn-secondary open-project-btn">Open</button>
        </div>
      </div>
    `).join('');
    
    // Add event listeners to the new elements
    document.querySelectorAll('.open-project-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const projectCard = e.target.closest('.project-card');
        const projectId = projectCard.getAttribute('data-project-id');
        openProject(projectId);
      });
    });
  }
}

// Update settings view
function updateSettingsView() {
  elements.apiKey.value = state.apiKey;
  elements.projectsLocation.value = 'User Data Directory/projects';
  elements.themeSelect.value = state.theme;
}

// Add a simple joinPaths function for safe path joining in the renderer
function joinPaths(...parts) {
  return parts
    .map((part, i) => {
      if (i === 0) return part.replace(/[/\\]+$/, '');
      return part.replace(/^[/\\]+|[/\\]+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

// Add a simple basename function for browser
function basename(filePath) {
  return filePath.split(/[\\/]/).pop();
}

// Generate project
async function generateProject() {
  const prompt = elements.projectPrompt.value.trim();
  const projectType = elements.projectType.value;
  let projectName = elements.projectName && elements.projectName.value ? elements.projectName.value.trim() : '';
  let baseFolder = state.selectedProjectFolder;
  let projectDir = '';

  if (!prompt) {
    showNotification('Please enter a project description', 'error');
    return;
  }
  if (!baseFolder) {
    showNotification('Please select a project folder', 'error');
    return;
  }

  // If no name, auto-generate a folder name
  if (!projectName) {
    projectName = `project-${Date.now()}`;
  }
  projectDir = joinPaths(baseFolder, projectName);

  state.isGenerating = true;
  navigateTo('project-generation');

  try {
    // Set up progress listener
    const cleanup = window.api.onGenerationProgress((data) => {
      const { stage, message } = data;
      
      // Update progress bar based on stage
      let progress = 0;
      switch (stage) {
        case 'analyzing':
          progress = 20;
          break;
        case 'planning':
          progress = 40;
          break;
        case 'coding':
          progress = 60;
          break;
        case 'combining':
          progress = 80;
          break;
        case 'complete':
          progress = 100;
          break;
      }
      
      // Update UI
      updateGenerationProgress(progress, message);
      addLogEntry(message);
    });
    
    // Call the main process to generate the project
    const result = await window.api.generateProject({
      prompt,
      projectType,
      projectDir
    });
    
    // Clean up progress listener
    cleanup();
      
    if (result.success) {
      // Set the current project
      state.currentProject = {
        id: Date.now().toString(),
        name: result.projectData.name,
        description: result.projectData.description,
        type: result.projectData.type,
        path: result.projectPath,
        files: result.projectData.files,
        context: result.context,
        codebaseAnalysis: result.codebaseAnalysis,
        lspContext: result.lspContext
      };
      
      // Add to projects list
      state.projects.unshift(state.currentProject);
      saveProjects(); // Persist projects
      
      // Show success message
      showNotification('Project generated successfully!', 'success');
      // Automatically run the project after generation completes
      runProject();
    } else {
      throw new Error(result.error || 'Failed to generate project');
    }
  } catch (error) {
    window.api.logger.error('Error generating project:', { error: error.message });
    updateGenerationProgress(100, 'Error generating project');
    addLogEntry(`Error: ${error.message}`);
    showNotification(`Error generating project: ${error.message}`, 'error');
  } finally {
    state.isGenerating = false;
  }
}

// Update generation progress
function updateGenerationProgress(percent, messageOrObj) {
  elements.generationProgressBar.value = percent;
  let msg = '';
  if (messageOrObj && typeof messageOrObj === 'object' && messageOrObj.message) {
    msg = messageOrObj.message;
  } else if (typeof messageOrObj === 'string') {
    msg = messageOrObj;
  } else if (messageOrObj && typeof messageOrObj === 'object') {
    msg = JSON.stringify(messageOrObj);
  } else {
    msg = String(messageOrObj);
  }
  addLogEntry(msg);
}

// Add log entry
function addLogEntry(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements.generationLogContent.textContent += `[${timestamp}] ${message}\n`;
  elements.generationLogContent.scrollTop = elements.generationLogContent.scrollHeight;
}

// Cancel generation
function cancelGeneration() {
  if (state.isGenerating) {
    state.isGenerating = false;
    addLogEntry('Generation cancelled by user');
    showNotification('Project generation cancelled', 'info');
  }
  
  navigateTo('project-creation');
}

// Update project overview with enhanced context
function updateProjectOverview() {
  if (!state.currentProject) return;
  
  // Update basic info
  elements.projectTitle.textContent = state.currentProject.name;
  elements.projectDescription.textContent = state.currentProject.description;
  
  // Update file tree with enhanced context
  updateFileTree();
  
  // Update code analysis panel
  updateCodeAnalysis();
}

// Update file tree with enhanced context
function updateFileTree() {
  const fileTree = elements.projectFileTree;
  fileTree.innerHTML = '';

  // Group files by type using codebase analysis
  const { structure, patterns, components } = state.currentProject.codebaseAnalysis;
  
  // Create sections
  const sections = {
    entryPoints: { title: 'Entry Points', files: structure.entryPoints },
    components: { title: 'Components', files: components.functional.concat(components.class) },
    styles: { title: 'Styles', files: structure.files.filter(f => f.path.match(/\.(css|scss)$/)) },
    tests: { title: 'Tests', files: structure.files.filter(f => f.path.includes('test')) },
    config: { title: 'Config', files: structure.configFiles },
    other: { title: 'Other Files', files: [] }
  };

  // Add files to sections
  for (const file of state.currentProject.files) {
    let added = false;
    for (const section of Object.values(sections)) {
      if (section.files.some(f => f.path === file.path)) {
        section.files.push(file);
        added = true;
        break;
      }
    }
    if (!added) {
      sections.other.files.push(file);
    }
  }

  // Create tree structure
  for (const [key, section] of Object.entries(sections)) {
    if (section.files.length === 0) continue;

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'file-tree-section';
    
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'file-tree-section-header';
    sectionHeader.textContent = section.title;
    sectionDiv.appendChild(sectionHeader);

    const fileList = document.createElement('div');
    fileList.className = 'file-tree-list';
    
    for (const file of section.files) {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-tree-item';
      fileItem.textContent = basename(file.path);
      fileItem.onclick = () => openFile(file.path);
      fileList.appendChild(fileItem);
    }

    sectionDiv.appendChild(fileList);
    fileTree.appendChild(sectionDiv);
  }
}

// Update code analysis panel
function updateCodeAnalysis() {
  const { patterns, dependencies, components } = state.currentProject.codebaseAnalysis;
  
  // Create analysis panel if it doesn't exist
  let analysisPanel = document.getElementById('code-analysis-panel');
  if (!analysisPanel) {
    analysisPanel = document.createElement('div');
    analysisPanel.id = 'code-analysis-panel';
    analysisPanel.className = 'glass-panel';
    document.querySelector('.project-overview-container').appendChild(analysisPanel);
  }

  // Update analysis content
  analysisPanel.innerHTML = `
    <h3>Code Analysis</h3>
    
    <div class="analysis-section">
      <h4>State Management</h4>
      <ul>
        ${patterns.stateManagement.map(p => `<li>${p.type} in ${basename(p.file)}</li>`).join('')}
      </ul>
        </div>

    <div class="analysis-section">
      <h4>Components</h4>
      <ul>
        ${components.functional.map(c => `<li>Functional: ${c.name}</li>`).join('')}
        ${components.class.map(c => `<li>Class: ${c.name}</li>`).join('')}
      </ul>
        </div>

    <div class="analysis-section">
      <h4>Dependencies</h4>
      <ul>
        ${dependencies.frontend.map(d => `<li>Frontend: ${d.name}@${d.version}</li>`).join('')}
        ${dependencies.backend.map(d => `<li>Backend: ${d.name}@${d.version}</li>`).join('')}
      </ul>
    </div>
    `;
}

// Open file
function openFile(filePath) {
  const file = state.currentProject.files.find(f => f.path === filePath);
  if (!file) return;
  
  // Set current file
  state.currentFile = file;
  
  // Update file tabs
  updateFileTabs();
  
  // Update file content
  updateFileContent();
}

// Update file tabs
function updateFileTabs() {
  if (!state.currentFile) return;
  
  // Check if tab already exists
  const existingTab = document.querySelector(`.file-tab[data-path="${state.currentFile.path}"]`);
  
  if (existingTab) {
    // Activate existing tab
    document.querySelectorAll('.file-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    existingTab.classList.add('active');
  } else {
    // Create new tab
    const fileName = state.currentFile.path.split('/').pop();
    const tabHtml = `
      <div class="file-tab active" data-path="${state.currentFile.path}">
        <span class="file-tab-name">${fileName}</span>
        <span class="file-tab-close">✕</span>
      </div>
    `;
    
    // Remove active class from all tabs
    document.querySelectorAll('.file-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Add new tab
    elements.fileTabs.insertAdjacentHTML('beforeend', tabHtml);
    
    // Add event listeners to the new tab
    const newTab = document.querySelector(`.file-tab[data-path="${state.currentFile.path}"]`);
    
    newTab.addEventListener('click', () => {
      openFile(state.currentFile.path);
    });
    
    newTab.querySelector('.file-tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(state.currentFile.path);
    });
  }
}

// Close tab
function closeTab(filePath) {
  const tab = document.querySelector(`.file-tab[data-path="${filePath}"]`);
  if (!tab) return;
  
  // Remove tab
  tab.remove();
  
  // If it was the active tab, activate the first remaining tab or clear content
  if (state.currentFile && state.currentFile.path === filePath) {
    const remainingTabs = document.querySelectorAll('.file-tab');
    if (remainingTabs.length > 0) {
      const firstTab = remainingTabs[0];
      const firstTabPath = firstTab.getAttribute('data-path');
      openFile(firstTabPath);
    } else {
      state.currentFile = null;
      elements.fileContent.innerHTML = '<div class="empty-state"><p>Select a file to view its content</p></div>';
    }
  }
}

// Update file content
function updateFileContent() {
  if (!state.currentFile) return;
  
  const fileExtension = state.currentFile.path.split('.').pop();
  let contentHtml = '';
  
  // Handle different file types
  if (fileExtension === 'png' || fileExtension === 'jpg' || fileExtension === 'jpeg' || fileExtension === 'gif') {
    // Image file
    contentHtml = `<div class="image-preview"><img src="data:image/${fileExtension};base64,${state.currentFile.content}" alt="Image Preview"></div>`;
  } else {
    // Text file
    contentHtml = `<pre class="code-content">${escapeHtml(state.currentFile.content)}</pre>`;
  }
  
  elements.fileContent.innerHTML = contentHtml;
}

// Run project
async function runProject() {
  if (!state.currentProject) return;
  try {
    // Call the main process to run the project
    const result = await window.api.runProject(state.currentProject.path);
    if (result.success) {
      // Navigate to project overview first, then to running view
      navigateTo('project-overview');
      updateProjectOverview();
      // Then navigate to project running view
      navigateTo('project-running');
      updateRunningView();
      showNotification('Project running', 'success');
    } else {
      throw new Error(result.error || 'Failed to run project');
    }
  } catch (error) {
    console.error('Error running project:', error);
    showNotification(`Error running project: ${error.message}`, 'error');
  }
}

// Update running view
function updateRunningView() {
  if (!state.currentProject) return;
  
  // Update project title
  elements.runningProjectTitle.textContent = state.currentProject.name;
  
  // Clear console
  elements.consoleOutput.textContent = '';
  
  // Load project in iframe
  refreshPreview();
  
  // Add initial console entry
  addConsoleEntry('Project started');
}

// Refresh preview
function refreshPreview() {
  if (!state.currentProject) return;
  
  // For web projects, we can load the index.html file
  if (state.currentProject.type === 'web') {
    const indexFile = state.currentProject.files.find(f => f.path === 'index.html');
    if (indexFile) {
      // Create a blob URL for the HTML content
      const blob = new Blob([indexFile.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      // Load the URL in the iframe
      elements.previewFrame.src = url;
      
      // Add console entry
      addConsoleEntry('Preview refreshed');
    } else {
      elements.previewFrame.srcdoc = '<h1>Error: index.html not found</h1>';
      addConsoleEntry('Error: index.html not found', 'error');
    }
  } else {
    elements.previewFrame.srcdoc = `<h1>${state.currentProject.name}</h1><p>Preview not available for this project type</p>`;
    addConsoleEntry('Preview not available for this project type', 'warning');
  }
}

// Add console entry
function addConsoleEntry(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  let className = 'console-entry';
  
  if (type === 'error') className += ' console-error';
  else if (type === 'warning') className += ' console-warning';
  else if (type === 'success') className += ' console-success';
  
  elements.consoleOutput.innerHTML += `<div class="${className}">[${timestamp}] ${message}</div>`;
  elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
}

// Clear console
function clearConsole() {
  elements.consoleOutput.textContent = '';
  addConsoleEntry('Console cleared');
}

// Stop project
function stopProject() {
  addConsoleEntry('Project stopped');
  showNotification('Project stopped', 'info');
  navigateTo('project-overview');
}

// Export project
async function exportProject() {
  if (!state.currentProject) return;
  
  try {
    // Call the main process to export the project
    const result = await window.api.exportProject(state.currentProject.path);
    
    if (result.success) {
      showNotification(`Project exported to: ${result.exportPath}`, 'success');
    } else {
      throw new Error(result.error || 'Failed to export project');
    }
  } catch (error) {
    console.error('Error exporting project:', error);
    showNotification(`Error exporting project: ${error.message}`, 'error');
  }
}

// Open project
function openProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  
  state.currentProject = project;
  navigateTo('project-overview');
  updateProjectOverview();
}

// Use template
function useTemplate(template) {
  elements.projectType.value = template;
  navigateTo('project-creation');
  
  // Set a template-specific prompt
  switch (template) {
    case 'web':
      elements.projectPrompt.value = 'Create a responsive website with a home page, about page, and contact form.';
      break;
    case 'node':
      elements.projectPrompt.value = 'Create a Node.js REST API with endpoints for creating, reading, updating, and deleting users.';
      break;
    case 'react':
      elements.projectPrompt.value = 'Create a React application with a dashboard that displays user information and statistics.';
      break;
    case 'python':
      elements.projectPrompt.value = 'Create a Python application that analyzes and visualizes data from a CSV file.';
      break;
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.className = 'notification-close';
  closeButton.textContent = '✕';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(notification);
  });
  
  notification.appendChild(closeButton);
  
  // Add to body
  document.body.appendChild(notification);
  
  // Remove after 5 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 5000);
}

// Helper functions
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize the application
init();
