const AIService = require('./AIService');
const LSPService = require('./LSPService');
const LSPClient = require('./LSPClient');
const { EnhancedIndexer } = require('../backend/indexer');
const path = require('path');
const fs = require('fs').promises;

class IntegrationService {
  constructor() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }
    this.aiService = new AIService(geminiApiKey);
    this.lspService = new LSPService();
    this.lspClient = new LSPClient();
    this.indexer = null;
    this.projectDir = null;
    this.initialized = false;
  }

  async initialize(projectDir) {
    try {
      // Validate project directory
      if (!projectDir) {
        throw new Error('Project directory is required');
      }

      // Ensure project directory exists
      await fs.mkdir(projectDir, { recursive: true });

      // Clean up any existing resources
      await this.cleanup();

      this.projectDir = projectDir;
      
      // Initialize indexer with project directory
      this.indexer = new EnhancedIndexer(projectDir);
      await this.indexer.initialize();
      
      // Initialize LSP service
      await this.lspService.initialize(projectDir);
      await this.lspService.start(projectDir);
      
      // Initialize LSP client
      await this.lspClient.connect();
      
      // Initialize AI service with project directory
      await this.aiService.initialize(projectDir);
      
      // Enable autonomous mode
      this.aiService.enableAutonomousMode();
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing integration service:', error);
      await this.cleanup();
      return false;
    }
  }

  async processPrompt(prompt, onProgress) {
    try {
      if (!this.initialized) {
        throw new Error('Integration service not initialized');
      }

      if (!prompt) {
        throw new Error('Prompt is required');
      }

      // Process the prompt with AI service
      const result = await this.aiService.processPrompt(prompt, onProgress);

      // Get LSP context
      const lspContext = await this.lspClient.getContext();

      // Get codebase analysis
      const codebaseAnalysis = await this.indexer.analyzeCodebase();

      return {
        ...result,
        lspContext,
        codebaseAnalysis
      };
    } catch (error) {
      console.error('Error processing prompt:', error);
      throw error;
    }
  }

  async cleanup() {
    try {
      // Clean up LSP service
      if (this.lspService) {
        await this.lspService.stop();
      }

      // Clean up LSP client
      if (this.lspClient) {
        await this.lspClient.disconnect();
      }

      // Clean up AI service
      if (this.aiService) {
        this.aiService.cleanupTempDirectory();
      }

      // Clean up indexer
      if (this.indexer) {
        await this.indexer.cleanup();
      }

      // Reset state
      this.projectDir = null;
      this.initialized = false;
    } catch (error) {
      console.error('Error cleaning up integration service:', error);
    }
  }
}

module.exports = IntegrationService; 