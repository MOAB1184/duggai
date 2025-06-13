const axios = require('axios');
const LSPClient = require('./LSPClient');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const EnhancedIndexer = require('../backend/indexer/enhancedIndexer');
const WebSearchService = require('./WebSearchService');
const EmbeddingService = require('./EmbeddingService');
const os = require('os');
const { OpenAI } = require('openai');
const logger = require('./Logger');

// Load environment variables from root .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

class AIService {
  constructor() {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY is required in .env file');
    }

    this.openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/duggai/duggai-desktop-app", // Required for OpenRouter
        "X-Title": "DuggAI Desktop App" // Optional, shows in rankings
      }
    });
    
    this.indexer = new EnhancedIndexer();
    this.lspClient = new LSPClient();
    this.lastContext = null;
    this.lastPrompt = null;
    this.tempDir = path.join(os.tmpdir(), 'duggai-temp');
    this.tempProjectDir = null;
    this.autonomousMode = false;
    this.contextWindow = new Map(); // Store recent context for autonomous operations
    this.embeddingService = new EmbeddingService();
    this.webSearch = new WebSearchService();
    this.initialized = false;

    // Track the active project directory
    this.projectDir = null;

    // Store context to include after planning
    this.postPlanData = null;

    // Default instructions appended to the first coder prompt
    this.instructions = [
      'Use the [FILE] path/to/file.ext marker for every code block.',
      'Write files only inside the provided project directory.',
      'Avoid creating duplicate folder names or paths.'
    ].join(' ');
  }

  // Helper for retrying API calls
  async _retryRequest(fn, maxRetries = 5, initialDelay = 2000) {
    let attempt = 0;
    let delay = initialDelay;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        const status = error.response?.status;
        if ((status === 529 || status === 429) && attempt < maxRetries - 1) {
          // Overloaded or rate limited, wait and retry
          await new Promise(res => setTimeout(res, delay));
          delay *= 2; // Exponential backoff
          attempt++;
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Initialize LSP connection
   */
  async initializeLSP() {
    try {
      await this.lspClient.connect();
      console.log('LSP connection initialized');
    } catch (error) {
      console.error('Failed to initialize LSP connection:', error);
    }
  }

  /**
   * Get code context from LSP for AI suggestions
   */
  async getLSPContext(uri, position) {
    try {
      const [completions, definition, references, hover] = await Promise.all([
        this.lspClient.getCompletions(uri, position),
        this.lspClient.getDefinition(uri, position),
        this.lspClient.getReferences(uri, position),
        this.lspClient.getHover(uri, position)
      ]);

      return {
        completions,
        definition,
        references,
        hover
      };
    } catch (error) {
      console.error('Error getting LSP context:', error);
      return null;
    }
  }

  /**
   * Generate code with LSP-aware context
   */
  async generateCodeWithLSP(prompt, uri, position) {
    try {
      // Get LSP context
      const lspContext = await this.getLSPContext(uri, position);
      
      // Enhance prompt with LSP context
      let enhancedPrompt = prompt;
      if (lspContext) {
        enhancedPrompt += '\n\nLSP Context:\n';
        if (lspContext.definition) {
          enhancedPrompt += `Definition: ${JSON.stringify(lspContext.definition)}\n`;
        }
        if (lspContext.references) {
          enhancedPrompt += `References: ${JSON.stringify(lspContext.references)}\n`;
        }
        if (lspContext.hover) {
          enhancedPrompt += `Hover Info: ${JSON.stringify(lspContext.hover)}\n`;
        }
      }

      // Generate code using enhanced prompt with OpenRouter's Gemini
      const result = await this.openai.chat.completions.create({
        model: 'google/gemini-2.5-pro-preview',
        messages: [{ role: 'user', content: enhancedPrompt }],
        extra_body: {}
      });
      return result.choices[0].message.content;
    } catch (error) {
      console.error('Error generating code with LSP:', error);
      throw error;
    }
  }

  /**
   * Generate a project plan using OpenRouter's Gemini model
   * @param {string} prompt - The user's project description
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} - The project plan with parts
   */
  async generateProjectPlan(prompt, onProgress) {
    try {
      if (onProgress) {
        onProgress({ message: 'Planning project structure...' });
      }

      // Initialize LSP if not already connected
      if (!this.lspClient.connected) {
        await this.initializeLSP();
      }

      const plannerPrompt = `You are an expert AI coder generating a plan for a coding project. You will be given a prompt, and your task is to split it up into parts, that you deem reasonable enough to do in one prompt/message. You may make as many parts as necessary. You will divide each part by saying [Part X] and then at the end of the part saying [End of Part X]. At the end of the project, say [End of Project]. In the first part, include all possible libraries that COULD be used for this coding project. You will NOT make any code yourself.\n\nUser's prompt: ${prompt}`;

      // Log the planner prompt
      console.log('PLANNER PROMPT:', plannerPrompt);

      // Use OpenRouter's Gemini model
      const result = await this.openai.chat.completions.create({
        model: 'google/gemini-2.5-pro-preview',
        messages: [{ role: 'user', content: plannerPrompt }],
        extra_body: {}
      });
      const plan = result.choices[0].message.content;

      // Log the raw planner response
      console.log('PLANNER RAW RESPONSE:', plan);

      const parsedPlan = this.parseProjectPlan(plan);

      if (onProgress) {
        onProgress({ message: `Project plan created with ${parsedPlan.totalParts} parts` });
      }

      return parsedPlan;
    } catch (error) {
      console.error('Error generating project plan:', error);
      throw new Error(`Failed to generate project plan: ${error.message}`);
    }
  }

  /**
   * Generate code for a specific part of the project with LSP integration
   * @param {string} prompt - The user's project description
   * @param {string} part - The specific part to generate code for
   * @param {number} partNumber - The current part number
   * @param {number} totalParts - Total number of parts
   * @param {Function} onProgress - Callback for progress updates
   * @param {string} uri - The URI of the file
   * @param {number} position - The position in the file
   * @returns {Promise<Object>} - The generated code for the part
   */
  async generateCodeForPart(prompt, part, partNumber, totalParts, onProgress, uri, position, projectDir) {
    try {
      let currentRetry = 0;
      const maxRetries = 3;
      let lastCode = '';
      let lastError = null;
      
      while (currentRetry < maxRetries) {
        try {
          const coderPrompt = this.buildCoderPrompt(prompt, part, partNumber, totalParts, uri, position, projectDir);
          let code;
          
          if (currentRetry === 0) {
            const result = await this.openai.chat.completions.create({
              model: 'google/gemini-2.5-pro-preview',
              messages: [{ role: 'user', content: coderPrompt }],
              extra_body: {}
            });
            code = result.choices[0].message.content;
          } else {
            // Correction prompt
            const correctionPrompt = `You did not output any code blocks with the required [FILE] ... marker. You must output at least one code block for each file, and every code block must start with [FILE] path/to/file.ext. Do not output only explanations or markdown lists. Please re-output the code, following the instructions exactly.\n\nHere is your previous response:\n\n${lastCode}`;
            const result = await this.openai.chat.completions.create({
              model: 'google/gemini-2.5-pro-preview',
              messages: [{ role: 'user', content: correctionPrompt }],
              extra_body: {}
            });
            code = result.choices[0].message.content;
          }

          // Log the raw code response
          logger.info('CODER RAW RESPONSE:', { code });
          lastCode = code;

          try {
            const parsedCode = this.parseGeneratedCode(code);
            if (onProgress) {
              onProgress({ message: `Completed part ${partNumber} of ${totalParts}` });
            }
            return parsedCode;
          } catch (err) {
            lastError = err;
            // Retry if the error is about [FILE] marker or no code blocks/files
            if (
              err.message && (
                err.message.includes('[FILE] marker') ||
                err.message.toLowerCase().includes('no code block') ||
                err.message.toLowerCase().includes('no file')
              )
            ) {
              currentRetry++;
              continue;
            } else {
              throw err;
            }
          }
        } catch (error) {
          logger.error('Error in generateCodeForPart:', { error: error.message });
          throw error;
        }
      }
      // If we get here, all retries failed
      throw lastError || new Error('Max retries reached while gathering information');
    } catch (error) {
      logger.error('Error generating code for part:', { error: error.message });
      throw new Error(`Failed to generate code for part: ${error.message}`);
    }
  }

  extractInfoRequests(code) {
    const requests = [];
    const requestRegex = /\/\/\s*REQUEST_INFO:\s*(\w+)\s+(.+)/g;
    let match;
    
    while ((match = requestRegex.exec(code)) !== null) {
      requests.push({
        type: match[1],
        query: match[2].trim()
      });
    }
    
    return requests;
  }

  async getRequestedInfo(requests) {
    if (!this.indexer || !this.indexer.initialized) return null;

    const results = [];
    for (const request of requests) {
      let info = '';
      
      switch (request.type) {
        case 'FILE':
          const fileContent = await this.indexer.getFileContent(request.query);
          if (fileContent) {
            info = `File: ${request.query}\n${fileContent}\n`;
          }
          break;
          
        case 'FUNCTION':
          const functionRefs = await this.indexer.findSymbolReferences(request.query);
          if (functionRefs.length > 0) {
            info = `Function ${request.query} references:\n${functionRefs.map(ref => 
              `- ${ref.file}:${ref.line} (${ref.type})`
            ).join('\n')}\n`;
          }
          break;
          
        case 'COMPONENT':
          const componentRefs = await this.indexer.hybridSearch(request.query, 5);
          if (componentRefs.length > 0) {
            info = `Component ${request.query} usages:\n${componentRefs.map(ref => 
              `- ${this.indexer.getRelativePath(ref.filePath)}\n${ref.content}\n`
            ).join('\n---\n')}\n`;
          }
          break;
          
        case 'PATTERN':
          const patternResults = await this.indexer.hybridSearch(request.query, 3);
          if (patternResults.length > 0) {
            info = `Similar patterns for ${request.query}:\n${patternResults.map(ref => 
              `- ${this.indexer.getRelativePath(ref.filePath)}\n${ref.content}\n`
            ).join('\n---\n')}\n`;
          }
          break;
      }
      
      if (info) {
        results.push(info);
      }
    }
    
    return results.join('\n---\n');
  }

  /**
   * Parse the project plan into structured parts
   * @param {string} plan - The raw plan text from Claude
   * @returns {Object} - Structured project plan
   */
  parseProjectPlan(plan) {
    const parts = [];
    const partRegex = /\[Part (\d+)\]([\s\S]*?)\[End of Part \1\]/g;
    let match;

    while ((match = partRegex.exec(plan)) !== null) {
      parts.push({
        partNumber: parseInt(match[1]),
        content: match[2].trim()
      });
    }

    return {
      parts,
      totalParts: parts.length
    };
  }

  /**
   * Parse the generated code into a structured format
   * @param {string} code - The raw code text from Claude
   * @returns {Object} - Structured code output
   */
  parseGeneratedCode(code) {
    // Extract code blocks and their file paths
    const codeBlocks = [];
    // Match both standard markdown code blocks and the AI's output format
    const codeBlockRegex = /(?:```(\w+)?\n([\s\S]*?)```|\[FILE\]([^\n]+)\n```(\w+)?\n([\s\S]*?)```)/g;
    let match;
    while ((match = codeBlockRegex.exec(code)) !== null) {
      // Handle both formats
      const language = match[1] || match[4] || 'text';
      const content = (match[2] || match[5] || '').trim();
      const filePath = match[3] || '';
      
      const lines = content.split('\n');
      if (filePath || (lines[0] && lines[0].startsWith('[FILE]'))) {
        let finalFilePath = filePath || lines[0].replace('[FILE]', '').trim();
        // Accept dotfiles as-is
        if (finalFilePath && /^\.[a-zA-Z0-9_.-]+$/.test(finalFilePath)) {
          // do nothing, accept as-is
        } else if (finalFilePath) {
          // Remove any leading/trailing whitespace and slashes
          finalFilePath = finalFilePath.replace(/^\/+|\/+$/g, '');
        }
        const fileContent = filePath ? content : lines.slice(1).join('\n');
        codeBlocks.push({ filePath: finalFilePath, content: fileContent, language });
      }
    }

    if (codeBlocks.length === 0) {
      console.error('AI did not provide any [FILE] marker. Raw code:', code);
      throw new Error('AI did not provide any [FILE] marker. Please ensure at least one code block includes a [FILE] path/to/file.ext as the first line.');
    }

    return codeBlocks;
  }

  /**
   * Generate a complete project by first planning and then implementing each part
   * @param {string} prompt - The user's project description
   * @param {string} projectType - The type of project to generate
   * @param {Function} onProgress - Callback for progress updates
   * @returns {Promise<Object>} - The complete generated project
   */
  async generateProject(prompt, projectType = 'web', onProgress, projectDir) {
    try {
      // Validate inputs
      if (!prompt) {
        throw new Error('Project prompt is required');
      }
      if (!projectType) {
        throw new Error('Project type is required');
      }
      if (!projectDir) {
        throw new Error('Project directory is required');
      }

      // Create project directory structure
      if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
      }
      if (!fs.existsSync(path.join(projectDir, 'src'))) {
      fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
      }
      if (!fs.existsSync(path.join(projectDir, 'public'))) {
      fs.mkdirSync(path.join(projectDir, 'public'), { recursive: true });
      }
      
      // Initialize indexer with project directory
      await this.initialize(projectDir);
      
      if (onProgress) {
        onProgress({ stage: 'analyzing', message: 'Created project directory structure...' });
      }
      
      // First, generate the project plan
      const plan = await this.generateProjectPlan(prompt, onProgress);

      // Prepare additional context for the first coding prompt
      this.postPlanData = {
        instructions: this.instructions,
        fileStructure: this.getProjectStructure(projectDir),
        indexerContext: JSON.stringify(await this.analyzeCodebase(), null, 2)
      };
      
      // Create a Map to store all files
      const allFiles = new Map();
      
      // Generate code for each part and save files immediately
      for (const part of plan.parts) {
        if (onProgress) {
          onProgress({ 
            stage: 'coding', 
            message: `Generating part ${part.partNumber} of ${plan.totalParts}...` 
          });
        }
        
        const code = await this.generateCodeForPart(
          prompt, 
          part.content, 
          part.partNumber, 
          plan.totalParts,
          onProgress,
          null,
          null,
          projectDir
        );
        
        // Process and save files from this part immediately
        for (const codeBlock of code) {
          const sanitizedPath = this.sanitizeFilePath(codeBlock.filePath);
          if (!allFiles.has(sanitizedPath)) {
            allFiles.set(sanitizedPath, codeBlock.content);
            
            // Save file to project directory immediately
            const fullPath = path.join(projectDir, sanitizedPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, codeBlock.content);
            
            // Index the new file
            await this.indexer.indexFile(fullPath);
            
            if (onProgress) {
              onProgress({ 
                stage: 'combining', 
                message: `Generated and indexed file: ${sanitizedPath}` 
              });
            }
          }
        }
      }

      // Create project metadata
      const metadata = {
        name: path.basename(projectDir),
        type: projectType,
        description: prompt,
        createdAt: new Date().toISOString(),
        files: Array.from(allFiles.entries()).map(([path, content]) => ({
          path,
          content
        }))
      };

      // Save metadata
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify(metadata, null, 2)
      );

      if (onProgress) {
        onProgress({ stage: 'complete', message: 'Project generation complete!' });
      }

      return {
        success: true,
        projectData: metadata,
        projectPath: projectDir,
        plan: plan,
        context: this.lastContext,
        codebaseAnalysis: await this.analyzeCodebase(),
        lspContext: await this.lspClient.getContext()
      };
    } catch (error) {
      console.error('Error generating project:', error);
      // Clean up on error
      this.cleanupTempDirectory();
      throw new Error(`Failed to generate project: ${error.message}`);
    }
  }

  cleanupTempDirectory() {
    if (this.tempProjectDir && fs.existsSync(this.tempProjectDir)) {
      try {
        fs.rmSync(this.tempProjectDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Error cleaning up temp directory:', error);
      }
    }
  }

  // Move sanitizeFilePath to be a class method
  sanitizeFilePath(filePath) {
    // Normalize slashes and trim
    let normalized = filePath.toLowerCase().trim().replace(/\\/g, '/');

    // Remove any surrounding slashes and duplicate separators
    normalized = normalized.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');

    // Remove absolute path components if the project directory is included
    if (this.projectDir) {
      const rel = path.relative(this.projectDir, normalized);
      if (!rel.startsWith('..') && rel !== '') {
        normalized = rel;
      }
    }

    // If path contains src/ or public/ deeper in the tree, trim everything before it
    const srcIndex = normalized.indexOf('src/');
    const publicIndex = normalized.indexOf('public/');
    if (srcIndex > 0) {
      normalized = normalized.slice(srcIndex);
    } else if (publicIndex > 0) {
      normalized = normalized.slice(publicIndex);
    }

    // Fix common file extension issues
    normalized = normalized.replace(/\.(json|md|text|javascript|jsx|tsx|ts)$/i, (m, ext) => {
      const extMap = {
        json: '.json',
        md: '.md',
        text: '.txt',
        javascript: '.js',
        jsx: '.jsx',
        tsx: '.tsx',
        ts: '.ts'
      };
      return extMap[ext.toLowerCase()] || m;
    });

    // Prepend src/ if no top-level folder provided
    if (!normalized.startsWith('src/') && !normalized.startsWith('public/')) {
      normalized = `src/${normalized}`;
    }

    return normalized;
  }

  async initialize(projectDir) {
    try {
      // Persist the active project directory
      this.projectDir = projectDir;

      // Initialize the indexer with the project directory
      this.indexer = new EnhancedIndexer(projectDir);
      await this.indexer.initialize();

      // Reset any context from previous runs
      this.postPlanData = null;
      return true;
    } catch (error) {
      console.error('Error initializing AIService:', error);
      return false;
    }
  }

  // Enable autonomous mode
  enableAutonomousMode() {
    this.autonomousMode = true;
    console.log('Autonomous AI mode enabled');
  }

  // Disable autonomous mode
  disableAutonomousMode() {
    this.autonomousMode = false;
    console.log('Autonomous AI mode disabled');
  }

  // Autonomous file analysis
  async analyzeFile(filePath) {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    try {
      const content = await this.indexer.getFileContent(filePath);
      if (!content) return null;

      // Analyze file structure and content
      const analysis = {
        imports: this.extractImports(content),
        exports: this.extractExports(content),
        functions: this.extractFunctions(content),
        classes: this.extractClasses(content),
        dependencies: this.extractDependencies(content),
        complexity: this.calculateComplexity(content)
      };

      // Store in context window
      this.contextWindow.set(filePath, {
        content,
        analysis,
        timestamp: Date.now()
      });

      return analysis;
    } catch (error) {
      console.error('Error analyzing file:', error);
      return null;
    }
  }

  // Autonomous code search
  async searchCode(query, options = {}) {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    try {
      const results = await this.indexer.hybridSearch(query, options.limit || 5);
      
      // Enhance results with semantic analysis and embeddings
      const enhancedResults = await Promise.all(results.map(async result => {
        const analysis = await this.analyzeFile(result.filePath);
        const embedding = await this.indexer.getFileEmbedding(result.filePath);
        
        return {
          ...result,
          analysis,
          embedding,
          relevance: this.calculateRelevance(result, query)
        };
      }));

      return enhancedResults;
    } catch (error) {
      console.error('Error searching code:', error);
      return [];
    }
  }

  // Autonomous code understanding
  async understandCode(code, context = {}) {
    try {
      // Extract key information
      const understanding = {
        purpose: this.inferPurpose(code),
        patterns: this.identifyPatterns(code),
        dependencies: this.extractDependencies(code),
        complexity: this.calculateComplexity(code),
        suggestions: this.generateSuggestions(code, context)
      };

      return understanding;
    } catch (error) {
      console.error('Error understanding code:', error);
      return null;
    }
  }

  // Helper methods for autonomous analysis
  extractImports(content) {
    const imports = [];
    const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  extractRequires(content) {
    const requires = [];
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(content)) !== null) {
      requires.push(match[1]);
    }
    return requires;
  }

  extractExports(content) {
    const exports = [];
    const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    return exports;
  }

  extractFunctions(content) {
    const functions = [];
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      functions.push(match[1] || match[2]);
    }
    return functions;
  }

  extractClasses(content) {
    const classes = [];
    const classRegex = /class\s+(\w+)/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push(match[1]);
    }
    return classes;
  }

  extractDependencies(content) {
    return {
      imports: this.extractImports(content),
      requires: this.extractRequires(content),
      globalObjects: this.extractGlobalObjects(content)
    };
  }

  calculateComplexity(content) {
    // Simple complexity calculation
    const lines = content.split('\n');
    const complexity = {
      lines: lines.length,
      functions: this.extractFunctions(content).length,
      classes: this.extractClasses(content).length,
      imports: this.extractImports(content).length
    };
    return complexity;
  }

  inferPurpose(code) {
    // Analyze code to infer its purpose
    const purpose = {
      type: this.determineCodeType(code),
      mainFunctionality: this.extractMainFunctionality(code),
      patterns: this.identifyPatterns(code)
    };
    return purpose;
  }

  identifyPatterns(code) {
    const patterns = [];
    // Add pattern detection logic here
    return patterns;
  }

  generateSuggestions(code, context) {
    const suggestions = [];
    // Add suggestion generation logic here
    return suggestions;
  }

  calculateRelevance(result, query) {
    if (!result.embedding) return 0.5;
    
    try {
      // Generate embedding for query
      const queryEmbedding = this.embeddingService.generateEmbedding(query);
      
      // Calculate semantic similarity
      const semanticScore = this.embeddingService.cosineSimilarity(
        queryEmbedding,
        result.embedding
      );
      
      // Combine with structural score
      return 0.7 * semanticScore + 0.3 * result.structuralScore;
    } catch (error) {
      console.error('Error calculating relevance:', error);
      return 0.5;
    }
  }

  // Handle autonomous prompt processing
  async processPrompt(prompt, onProgress) {
    try {
      // Store the prompt for context
      this.lastPrompt = prompt;

      if (onProgress) {
        onProgress('Analyzing existing codebase...');
      }

      // First, do a deep analysis of the existing codebase
      const codebaseAnalysis = await this.analyzeCodebase();
      
      if (onProgress) {
        onProgress('Understanding project structure...');
      }

      // Analyze the prompt with full codebase context
      const promptAnalysis = await this.analyzePrompt(prompt, codebaseAnalysis);
      
      if (onProgress) {
        onProgress('Gathering project context...');
      }

      // Gather relevant context with full codebase awareness
      const context = await this.gatherContext(promptAnalysis, codebaseAnalysis);
      this.lastContext = context;

      if (onProgress) {
        onProgress('Planning project structure...');
      }

      // Generate the project plan with full context
      const plan = await this.generateProjectPlan(prompt, onProgress, context);

      // Generate code for each part with deep context
      const results = [];
      for (const part of plan.parts) {
        if (onProgress) {
          onProgress({ message: `Generating part ${part.partNumber} of ${plan.totalParts}...` });
        }

        // Get deep context for this specific part
        const partContext = await this.getPartContext(part, context, codebaseAnalysis);
        
        // Generate code with full context
        const code = await this.generateCodeForPart(
          prompt,
          part.content,
          part.partNumber,
          plan.totalParts,
          onProgress,
          null,
          null,
          null
        );

        results.push(code);
      }

      return {
        plan,
        results,
        context,
        codebaseAnalysis
      };
    } catch (error) {
      console.error('Error processing prompt:', error);
      throw error;
    }
  }

  // Deep codebase analysis
  async analyzeCodebase() {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    const analysis = {
      structure: await this.analyzeProjectStructure(),
      patterns: await this.analyzeCodePatterns(),
      dependencies: await this.analyzeDependencies(),
      components: await this.analyzeComponents(),
      styles: await this.analyzeStyles(),
      tests: await this.analyzeTests()
    };

    return analysis;
  }

  // Analyze project structure
  async analyzeProjectStructure() {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    const structure = {
      directories: [],
      files: [],
      entryPoints: [],
      configFiles: []
    };

    try {
      // Get all files in the project
      const files = await this.indexer.getAllFiles(this.indexer.baseDir);
      
      for (const file of files) {
        const path = file;
        const content = await this.indexer.getFileContent(path);
        
        // Skip if content is null or empty
        if (!content) {
          continue;
        }
        
        // Categorize files
        if (path.includes('package.json') || path.includes('tsconfig.json')) {
          structure.configFiles.push({ path, content });
        } else if (path.includes('index.js') || path.includes('App.js')) {
          structure.entryPoints.push({ path, content });
        } else {
          structure.files.push({ path, content });
        }

        // Track directories
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !structure.directories.includes(dir)) {
          structure.directories.push(dir);
        }
      }

      return structure;
    } catch (error) {
      console.error('Error analyzing project structure:', error);
      throw error;
    }
  }

  // Analyze code patterns
  async analyzeCodePatterns() {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    const patterns = {
      stateManagement: [],
      routing: [],
      styling: [],
      testing: [],
      apiCalls: []
    };

    try {
      // Get all files
      const files = await this.indexer.getAllFiles(this.indexer.baseDir);
      
      for (const file of files) {
        const content = await this.indexer.getFileContent(file);
        
        // Skip if content is null or empty
        if (!content) {
          continue;
        }
        
        // Look for state management patterns
        if (content.includes('useState') || content.includes('useReducer')) {
          patterns.stateManagement.push({
            file: file,
            type: content.includes('useState') ? 'useState' : 'useReducer'
          });
        }

        // Look for routing patterns
        if (content.includes('react-router') || content.includes('Route')) {
          patterns.routing.push({
            file: file,
            type: 'react-router'
          });
        }

        // Look for styling patterns
        if (content.includes('styled-components') || content.includes('.css')) {
          patterns.styling.push({
            file: file,
            type: content.includes('styled-components') ? 'styled-components' : 'css'
          });
        }

        // Look for testing patterns
        if (content.includes('jest') || content.includes('test')) {
          patterns.testing.push({
            file: file,
            type: 'jest'
          });
        }

        // Look for API call patterns
        if (content.includes('fetch') || content.includes('axios')) {
          patterns.apiCalls.push({
            file: file,
            type: content.includes('fetch') ? 'fetch' : 'axios'
          });
        }
      }

      return patterns;
    } catch (error) {
      console.error('Error analyzing code patterns:', error);
      throw error;
    }
  }

  // Analyze dependencies
  async analyzeDependencies() {
    const dependencies = {
      frontend: [],
      backend: [],
      dev: []
    };

    // Look for package.json
    const packageJson = await this.indexer.getFileContent('package.json');
    if (packageJson) {
      const pkg = JSON.parse(packageJson);
      
      // Categorize dependencies
      for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
        if (dep.includes('react') || dep.includes('vue') || dep.includes('angular')) {
          dependencies.frontend.push({ name: dep, version });
        } else if (dep.includes('express') || dep.includes('koa') || dep.includes('fastify')) {
          dependencies.backend.push({ name: dep, version });
        }
      }

      for (const [dep, version] of Object.entries(pkg.devDependencies || {})) {
        dependencies.dev.push({ name: dep, version });
      }
    }

    return dependencies;
  }

  // Analyze components
  async analyzeComponents() {
    const components = {
      functional: [],
      class: [],
      hooks: []
    };

    try {
      // Get all files
      const files = await this.indexer.getAllFiles(this.indexer.baseDir);
      
      for (const file of files) {
        const content = await this.indexer.getFileContent(file);
        
        // Skip if content is null or empty
        if (!content) {
          continue;
        }
        
        // Look for React components
        if (content.includes('React') || content.includes('react')) {
          if (content.includes('class') && content.includes('extends')) {
            components.class.push({
              file: file,
              name: this.extractClassName(content)
            });
          } else if (content.includes('function') || content.includes('const') && content.includes('=>')) {
            components.functional.push({
              file: file,
              name: this.extractFunctionName(content)
            });
          }

          // Look for hooks
          if (content.includes('use')) {
            components.hooks.push({
              file: file,
              hooks: this.extractHooks(content)
            });
          }
        }
      }

      return components;
    } catch (error) {
      console.error('Error analyzing components:', error);
      throw error;
    }
  }

  // Analyze styles
  async analyzeStyles() {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    const styles = {
      css: [],
      scss: [],
      styled: [],
      modules: []
    };

    try {
      // Get all files
      const files = await this.indexer.getAllFiles(this.indexer.baseDir);
      
      for (const file of files) {
        if (file.endsWith('.css')) {
          styles.css.push(file);
        } else if (file.endsWith('.scss')) {
          styles.scss.push(file);
        } else if (file.endsWith('.module.css')) {
          styles.modules.push(file);
        } else if (file.includes('styled')) {
          styles.styled.push(file);
        }
      }

      return styles;
    } catch (error) {
      console.error('Error analyzing styles:', error);
      throw error;
    }
  }

  // Analyze tests
  async analyzeTests() {
    if (!this.indexer || !this.indexer.initialized) {
      throw new Error('Indexer not initialized');
    }

    const tests = {
      unit: [],
      integration: [],
      e2e: []
    };

    try {
      // Get all files
      const files = await this.indexer.getAllFiles(this.indexer.baseDir);
      
      for (const file of files) {
        if (file.includes('test') || file.includes('spec')) {
          if (file.includes('e2e')) {
            tests.e2e.push(file);
          } else if (file.includes('integration')) {
            tests.integration.push(file);
          } else {
            tests.unit.push(file);
          }
        }
      }

      return tests;
    } catch (error) {
      console.error('Error analyzing tests:', error);
      throw error;
    }
  }

  // Helper methods for component analysis
  extractClassName(content) {
    const match = content.match(/class\s+(\w+)/);
    return match ? match[1] : null;
  }

  extractFunctionName(content) {
    const match = content.match(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/);
    return match ? (match[1] || match[2]) : null;
  }

  extractHooks(content) {
    const hooks = [];
    const hookRegex = /use\w+/g;
    let match;
    while ((match = hookRegex.exec(content)) !== null) {
      hooks.push(match[0]);
    }
    return hooks;
  }

  // Analyze the prompt to understand requirements
  async analyzePrompt(prompt) {
    const analysis = {
      type: this.determineProjectType(prompt),
      requirements: this.extractRequirements(prompt),
      dependencies: this.inferDependencies(prompt),
      complexity: this.estimateComplexity(prompt)
    };

    return analysis;
  }

  // Gather relevant context based on prompt analysis
  async gatherContext(promptAnalysis) {
    const context = {
      files: [],
      dependencies: [],
      patterns: []
    };

    // Search for relevant files using embeddings
    if (this.indexer && this.indexer.initialized) {
      const searchResults = await this.indexer.hybridSearch(
        promptAnalysis.requirements.join(' '),
        5
      );

      for (const result of searchResults) {
        const fileAnalysis = await this.analyzeFile(result.filePath);
        if (fileAnalysis) {
          // Get file embedding for better context
          const embedding = await this.indexer.getFileEmbedding(result.filePath);
          
          context.files.push({
            path: result.filePath,
            analysis: fileAnalysis,
            relevance: result.score,
            embedding
          });
        }
      }
    }

    return context;
  }

  // Get specific context for a project part
  async getPartContext(part, baseContext) {
    const partContext = {
      ...baseContext,
      specificFiles: []
    };

    // Search for files relevant to this specific part using embeddings
    if (this.indexer && this.indexer.initialized) {
      const searchResults = await this.indexer.hybridSearch(
        part.content,
        3
      );

      for (const result of searchResults) {
        const fileAnalysis = await this.analyzeFile(result.filePath);
        if (fileAnalysis) {
          // Get file embedding for better context
          const embedding = await this.indexer.getFileEmbedding(result.filePath);
          
          partContext.specificFiles.push({
            path: result.filePath,
            analysis: fileAnalysis,
            content: await this.indexer.getFileContent(result.filePath),
            relevance: result.score,
            embedding
          });
        }
      }
    }

    return partContext;
  }

  // Determine project type from prompt
  determineProjectType(prompt) {
    const types = {
      web: /web|react|frontend|ui|interface/i,
      api: /api|backend|server|endpoint/i,
      cli: /cli|command|terminal|console/i,
      library: /library|package|module/i
    };

    for (const [type, regex] of Object.entries(types)) {
      if (regex.test(prompt)) {
        return type;
      }
    }

    return 'general';
  }

  // Extract requirements from prompt
  extractRequirements(prompt) {
    const requirements = [];
    
    // Look for requirement patterns
    const patterns = [
      /should\s+([^\.]+)/gi,
      /must\s+([^\.]+)/gi,
      /needs?\s+to\s+([^\.]+)/gi,
      /requires?\s+([^\.]+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(prompt)) !== null) {
        requirements.push(match[1].trim());
      }
    }

    return requirements;
  }

  // Infer dependencies from prompt
  inferDependencies(prompt) {
    const dependencies = {
      frontend: [],
      backend: [],
      tools: []
    };

    // Common dependency patterns
    const patterns = {
      frontend: {
        react: /react|jsx|component/i,
        vue: /vue/i,
        angular: /angular/i,
        sass: /sass|scss/i,
        typescript: /typescript|ts/i
      },
      backend: {
        express: /express|node/i,
        django: /django|python/i,
        flask: /flask/i,
        spring: /spring|java/i
      },
      tools: {
        webpack: /webpack/i,
        babel: /babel/i,
        jest: /jest|test/i,
        eslint: /eslint/i
      }
    };

    // Check each category
    for (const [category, deps] of Object.entries(patterns)) {
      for (const [dep, regex] of Object.entries(deps)) {
        if (regex.test(prompt)) {
          dependencies[category].push(dep);
        }
      }
    }

    return dependencies;
  }

  // Estimate project complexity
  estimateComplexity(prompt) {
    let score = 0;
    
    // Count requirements
    score += this.extractRequirements(prompt).length * 2;
    
    // Count dependencies
    const deps = this.inferDependencies(prompt);
    score += Object.values(deps).flat().length;
    
    // Check for complex features
    const complexFeatures = [
      /authentication|auth/i,
      /database|db/i,
      /api|endpoint/i,
      /real-time|websocket/i,
      /testing|test/i
    ];
    
    for (const feature of complexFeatures) {
      if (feature.test(prompt)) {
        score += 3;
      }
    }

    return {
      score,
      level: score < 5 ? 'simple' : score < 10 ? 'medium' : 'complex'
    };
  }

  /**
   * Generate code with web search context
   * @param {string} prompt - The code generation prompt
   * @param {Object} options - Generation options
   * @returns {Promise<string>} Generated code
   */
  async generateCodeWithWebSearch(prompt, options = {}) {
    try {
      // Get web search results
      const searchResults = await this.webSearch.search(prompt, {
        maxResults: 3,
        ...options
      });

      // Build enhanced prompt with search results
      let enhancedPrompt = prompt + '\n\nRelevant information from web search:\n';
      searchResults.forEach(result => {
        enhancedPrompt += `URL: ${result.url}\n`;
        enhancedPrompt += `Snippet: ${result.snippet}\n`;
      });

      // Generate code using enhanced prompt with OpenRouter's Gemini
      const result = await this.openai.chat.completions.create({
        extra_headers: {
          "HTTP-Referer": "https://duggai.com",
          "X-Title": "DuggAI Desktop"
        },
        extra_body: {},
        model: "google/gemini-2.5-pro-preview",
        messages: [{ role: 'user', content: enhancedPrompt }]
      });
      return result.choices[0].message.content;
    } catch (error) {
      console.error('Error generating code with web search:', error);
      throw error;
    }
  }

  /**
   * Get real-time information about a coding topic
   * @param {string} topic - The coding topic to get information about
   * @returns {Promise<Object>} Information about the topic
   */
  async getCodingTopicInfo(topic) {
    try {
      // Get general topic info
      const topicInfo = await this.webSearch.getTopicInfo(topic);

      // Enhance with code-specific search
      const codeSearchResults = await this.webSearch.search(`${topic} code example best practices`, {
        maxResults: 2
      });

      return {
        ...topicInfo,
        codeExamples: codeSearchResults
      };
    } catch (error) {
      console.error('Error getting coding topic info:', error);
      throw error;
    }
  }

  /**
   * Read file content with flexible line access
   * @param {string} filePath - Path to the file
   * @param {Object} options - Reading options
   * @param {number} [options.startLine] - Starting line number (0-based)
   * @param {number} [options.endLine] - Ending line number (0-based)
   * @param {number} [options.contextLines] - Number of context lines before and after
   * @returns {Promise<Object>} File content with context
   */
  async readFileContent(filePath, options = {}) {
    try {
      const content = await this.indexer.getFileContent(filePath);
      if (!content) return null;

      const lines = content.split('\n');
      const totalLines = lines.length;

      // Default to reading entire file if no line numbers specified
      let startLine = options.startLine ?? 0;
      let endLine = options.endLine ?? totalLines - 1;
      const contextLines = options.contextLines ?? 0;

      // Add context lines if specified
      if (contextLines > 0) {
        startLine = Math.max(0, startLine - contextLines);
        endLine = Math.min(totalLines - 1, endLine + contextLines);
      }

      // Get the requested lines
      const selectedLines = lines.slice(startLine, endLine + 1);

      return {
        content: selectedLines.join('\n'),
        fullContent: content,
        startLine,
        endLine,
        totalLines,
        filePath
      };
    } catch (error) {
      console.error('Error reading file content:', error);
      return null;
    }
  }

  /**
   * Get symbol at specific line and character
   * @param {string} filePath - Path to the file
   * @param {number} line - Line number (0-based)
   * @param {number} character - Character position
   * @returns {Promise<string>} Symbol at position
   */
  async getSymbolAtPosition(filePath, line, character) {
    try {
      const content = await this.indexer.getFileContent(filePath);
      if (!content) return null;

      const lines = content.split('\n');
      if (line >= lines.length) return null;

      const lineContent = lines[line];

      // Get symbol at position
      const wordBoundary = /[\w$]/;
      let start = character;
      while (start > 0 && wordBoundary.test(lineContent[start - 1])) start--;
      let end = character;
      while (end < lineContent.length && wordBoundary.test(lineContent[end])) end++;

      return lineContent.slice(start, end);
    } catch (error) {
      console.error('Error getting symbol at position:', error);
      return null;
    }
  }

  /**
   * Generate code with file context
   * @param {string} prompt - The prompt for code generation
   * @param {string} filePath - Path to the file
   * @param {Object} options - Context options
   * @returns {Promise<string>} Generated code
   */
  async generateCodeWithContext(prompt, filePath, options = {}) {
    try {
      // Get file content with context
      const fileContext = await this.readFileContent(filePath, options);
      if (!fileContext) return null;

      // Get symbol if position is specified
      let symbol = null;
      if (options.line !== undefined && options.character !== undefined) {
        symbol = await this.getSymbolAtPosition(filePath, options.line, options.character);
      }

      // Get references and definitions if symbol exists
      const references = symbol ? await this.indexer.findSymbolReferences(symbol) : [];
      const definition = references.find(ref => ref.type === 'declaration');

      // Build context for OpenRouter's Gemini
      const context = {
        fileContent: fileContext,
        symbol,
        references,
        definition,
        position: options.line !== undefined ? { line: options.line, character: options.character } : null
      };

      // Generate code with context using OpenRouter's Gemini
      const result = await this.openai.chat.completions.create({
        extra_headers: {
          "HTTP-Referer": "https://duggai.com",
          "X-Title": "DuggAI Desktop"
        },
        extra_body: {},
        model: "google/gemini-2.5-pro-preview",
        messages: [{ 
          role: 'user', 
          content: `Given the following context, ${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}` 
        }]
      });
      return result.choices[0].message.content;
    } catch (error) {
      console.error('Error generating code with context:', error);
      throw error;
    }
  }

  /**
   * Get suggestions for a specific position
   * @param {string} filePath - Path to the file
   * @param {number} line - Line number (0-based)
   * @param {number} character - Character position
   * @returns {Promise<Array>} Array of suggestions
   */
  async getSuggestionsAtPosition(filePath, line, character) {
    try {
      const context = await this.readFileContent(filePath, {
        startLine: line,
        endLine: line,
        contextLines: 5
      });
      if (!context) return [];

      const symbol = await this.getSymbolAtPosition(filePath, line, character);

      // Get relevant code patterns using embeddings
      const patterns = await this.indexer.hybridSearch(symbol || context.content, 3);

      // Generate suggestions using OpenRouter's Gemini
      const prompt = `Given the following code context and position, suggest completions:

Current line: ${context.content}
Position: line ${line}, character ${character}
Context lines: ${context.content}

Similar patterns found:
${patterns.map(p => `File: ${p.filePath}\n${p.content}`).join('\n---\n')}

Suggest completions that would be helpful at this position.`;

      const response = await this.generateCodeWithContext(prompt, filePath, { line, character });
      
      // Parse suggestions from response
      const suggestions = response.split('\n')
        .filter(line => line.trim())
        .map(line => ({
          label: line.trim(),
          kind: 'snippet',
          detail: 'AI suggestion',
          documentation: {
            kind: 'markdown',
            value: 'AI-generated suggestion based on context'
          }
        }));

      return suggestions;
    } catch (error) {
      console.error('Error getting suggestions at position:', error);
      return [];
    }
  }

  extractGlobalObjects(content) {
    const globals = [];
    const globalRegex = /(?:window|global|self)\.(\w+)/g;
    let match;
    while ((match = globalRegex.exec(content)) !== null) {
      globals.push(match[1]);
    }
    return globals;
  }

  // Update getProjectStructure to accept a baseDir argument and use the project directory
  getProjectStructure(baseDir) {
    const structure = [];
    const processDirectory = (dir, prefix = '') => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          structure.push(`${prefix}${file}/`);
          processDirectory(fullPath, prefix + '  ');
        } else {
          structure.push(`${prefix}${file}`);
        }
      });
    };
    processDirectory(baseDir);
    return structure.join('\n');
  }

  /**
   * Build the prompt for code generation
   * @param {string} prompt - The user's project description
   * @param {string} part - The specific part to generate code for
   * @param {number} partNumber - The current part number
   * @param {number} totalParts - Total number of parts
   * @param {string} uri - The URI of the file
   * @param {number} position - The position in the file
   * @param {string} projectDir - The project directory
   * @returns {string} - The formatted prompt for code generation
   */
  buildCoderPrompt(prompt, part, partNumber, totalParts, uri, position, projectDir) {
    let base = `You are an expert AI coder. Your task is to generate code for part ${partNumber} of ${totalParts} of a project.`;

    base += `\n\nProject Description:\n${prompt}`;

    base += `\n\nPart to Implement:\n${part}`;

    if (partNumber === 1 && this.postPlanData) {
      base += `\n\nInstructions:\n${this.postPlanData.instructions}`;
      base += `\n\nEntire File Structure:\n${this.postPlanData.fileStructure}`;
      base += `\n\nIndexer Context:\n${this.postPlanData.indexerContext}`;
    }

    base += `\n\nRequirements:\n` +
      `1. Generate complete, working code for this part\n` +
      `2. Each code block must start with [FILE] path/to/file.ext\n` +
      `3. Include all necessary imports and dependencies\n` +
      `4. Add comments explaining complex logic\n` +
      `5. Follow best practices for the language/framework\n` +
      `6. Ensure code is well-organized and maintainable`;

    base += `\n\nProject Context:\n- Project Directory: ${projectDir}\n- Current File: ${uri}\n- Position: ${position}`;

    base += `\n\nPlease generate the code for this part, making sure to:\n` +
      `1. Start each code block with [FILE] followed by the file path\n` +
      `2. Include all necessary code for the file\n` +
      `3. Add appropriate comments\n` +
      `4. Follow the project's existing patterns and conventions`;

    base += `\n\nRemember to output at least one code block with the [FILE] marker.`;
    return base;
  }
}

module.exports = AIService;
