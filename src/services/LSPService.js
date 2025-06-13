const WebSocket = require('ws');
const { EnhancedIndexer } = require('../backend/indexer');
const AIService = require('./AIService');
const path = require('path');
const fs = require('fs').promises;

class LSPService {
  constructor() {
    this.wss = null;
    this.connected = false;
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.indexer = null;
    this.autonomousMode = false;
    this.analysisCache = new Map();
    this.projectDir = null;
    
    // Initialize AIService only if API key is available
    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY not found in environment variables');
      }
      this.aiService = new AIService(geminiApiKey);
    } catch (error) {
      console.warn('⚠️  AI features disabled:', error.message);
      this.aiService = null;
    }
    
    this.clients = new Map(); // Map of client ID to WebSocket
    this.documentVersions = new Map(); // Map of URI to version
    this.documentContents = new Map(); // Map of URI to content
  }

  async initialize(projectDir) {
    try {
      // Validate project directory
      if (!projectDir) {
        throw new Error('Project directory is required');
      }

      // Clean up any existing resources
      await this.cleanup();

      this.projectDir = projectDir;
      
      // Initialize the indexer with the project directory
      this.indexer = new EnhancedIndexer(projectDir);
      await this.indexer.initialize();
      
      return true;
    } catch (error) {
      console.error('Error initializing LSPService:', error);
      return false;
    }
  }

  async start(projectDir) {
    try {
      // Initialize if not already initialized
      if (!this.indexer) {
        const initialized = await this.initialize(projectDir);
        if (!initialized) {
          throw new Error('Failed to initialize indexer');
        }
      }

      // Create WebSocket server
      this.wss = new WebSocket.Server({ port: 3000 });
      console.log(`LSP server started on port 3000`);

      this.wss.on('connection', (ws) => {
        const clientId = Math.random().toString(36).substring(7);
        this.clients.set(clientId, ws);
        console.log(`New client connected: ${clientId}`);

        ws.on('message', async (message) => {
          try {
            const request = JSON.parse(message);
            const response = await this.handleRequest(request, clientId);
            if (response) {
              ws.send(JSON.stringify(response));
            }
          } catch (error) {
            console.error('Error handling LSP request:', error);
            const errorResponse = {
              jsonrpc: '2.0',
              id: message ? JSON.parse(message).id : null,
              error: {
                code: -32603,
                message: error.message
              }
            };
            ws.send(JSON.stringify(errorResponse));
          }
        });

        ws.on('close', () => {
          this.clients.delete(clientId);
          console.log(`Client disconnected: ${clientId}`);
        });

        ws.on('error', (error) => {
          console.error(`Client ${clientId} error:`, error);
          this.clients.delete(clientId);
        });
      });

      this.wss.on('error', (error) => {
        console.error('LSP server error:', error);
        this.attemptReconnect();
      });

      this.connected = true;
      return true;
    } catch (error) {
      console.error('Error starting LSP server:', error);
      return false;
    }
  }

  async stop() {
    try {
      // Close all client connections
      for (const [clientId, ws] of this.clients) {
        try {
          ws.close();
        } catch (error) {
          console.warn(`Error closing client ${clientId}:`, error);
        }
      }
      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      // Clean up indexer
      if (this.indexer) {
        await this.indexer.cleanup();
        this.indexer = null;
      }

      // Clear caches
      this.documentVersions.clear();
      this.documentContents.clear();
      this.analysisCache.clear();
      this.messageQueue = [];

      this.connected = false;
      this.projectDir = null;
    } catch (error) {
      console.error('Error stopping LSP server:', error);
    }
  }

  async cleanup() {
    await this.stop();
  }

  async handleRequest(request, clientId) {
    const { id, method, params } = request;

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id, params);
      case 'textDocument/didOpen':
        return this.handleDidOpen(params);
      case 'textDocument/didChange':
        return this.handleDidChange(params);
      case 'textDocument/didClose':
        return this.handleDidClose(params);
      case 'textDocument/completion':
        return this.handleCompletion(id, params);
      case 'textDocument/definition':
        return this.handleDefinition(id, params);
      case 'textDocument/references':
        return this.handleReferences(id, params);
      case 'textDocument/hover':
        return this.handleHover(id, params);
      case 'textDocument/signatureHelp':
        return this.handleSignatureHelp(id, params);
      default:
        console.warn(`Unhandled LSP method: ${method}`);
        return null;
    }
  }

  handleInitialize(id, params) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: 2, // Incremental
            willSave: false,
            willSaveWaitUntil: false,
            save: false
          },
          completionProvider: {
            resolveProvider: true,
            triggerCharacters: ['.', ':', '@', '#']
          },
          definitionProvider: true,
          referencesProvider: true,
          hoverProvider: true,
          signatureHelpProvider: {
            triggerCharacters: ['(', ',']
          }
        }
      }
    };
  }

  async handleDidOpen(params) {
    const { textDocument } = params;
    const { uri, version, text } = textDocument;
    
    this.documentVersions.set(uri, version);
    this.documentContents.set(uri, text);
    
    // Index the file
    await this.indexer.indexFile(uri);
  }

  async handleDidChange(params) {
    const { textDocument, contentChanges } = params;
    const { uri, version } = textDocument;
    
    this.documentVersions.set(uri, version);
    
    // Update document content
    let content = this.documentContents.get(uri) || '';
    for (const change of contentChanges) {
      if (change.range) {
        // Handle incremental changes
        const start = this.positionToOffset(content, change.range.start);
        const end = this.positionToOffset(content, change.range.end);
        content = content.slice(0, start) + change.text + content.slice(end);
      } else {
        // Handle full document changes
        content = change.text;
      }
    }
    this.documentContents.set(uri, content);
    
    // Re-index the file
    await this.indexer.indexFile(uri);
  }

  handleDidClose(params) {
    const { textDocument } = params;
    const { uri } = textDocument;
    
    this.documentVersions.delete(uri);
    this.documentContents.delete(uri);
  }

  async handleCompletion(id, params) {
    const { textDocument, position } = params;
    const { uri } = textDocument;
    
    try {
      // Get AI suggestions using Gemini
      const aiSuggestions = await this.aiService.getSuggestionsAtPosition(
        uri,
        position.line,
        position.character
      );
    
      // Get LSP completions
      const lspCompletions = await this.getLSPCompletions(uri, position);
      
      // Combine and return suggestions
    return {
      jsonrpc: '2.0',
      id,
      result: {
        isIncomplete: false,
          items: [...lspCompletions, ...aiSuggestions]
        }
      };
    } catch (error) {
      console.error('Error handling completion:', error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error.message
      }
    };
    }
  }

  async handleDefinition(id, params) {
    const { textDocument, position } = params;
    const { uri } = textDocument;
    
    try {
      // Get symbol at position using Gemini
      const symbol = await this.aiService.getSymbolAtPosition(
        uri,
        position.line,
        position.character
      );
    if (!symbol) return null;
    
      // Get context and references
      const context = await this.aiService.readFileContent(uri, {
        startLine: position.line,
        endLine: position.line,
        contextLines: 5
      });
      const references = await this.indexer.findSymbolReferences(symbol);
    const definition = references.find(ref => ref.type === 'declaration');
    
    if (!definition) return null;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        uri: definition.file,
        range: {
          start: { line: definition.line - 1, character: 0 },
          end: { line: definition.line, character: 0 }
        }
      }
    };
    } catch (error) {
      console.error('Error handling definition:', error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error.message
        }
      };
    }
  }

  async handleReferences(id, params) {
    const { textDocument, position } = params;
    const { uri } = textDocument;
    
    // Get symbol at position
    const symbol = await this.getSymbolAtPosition(uri, position);
    if (!symbol) return null;
    
    // Find all references
    const references = this.indexer.findSymbolReferences(symbol);
    
    return {
      jsonrpc: '2.0',
      id,
      result: references.map(ref => ({
        uri: ref.file,
        range: {
          start: { line: ref.line - 1, character: 0 },
          end: { line: ref.line, character: 0 }
        }
      }))
    };
  }

  async handleHover(id, params) {
    const { textDocument, position } = params;
    const { uri } = textDocument;
    
    try {
      // Get symbol and context using Gemini
      const symbol = await this.aiService.getSymbolAtPosition(
        uri,
        position.line,
        position.character
      );
    if (!symbol) return null;
    
      const context = await this.aiService.readFileContent(uri, {
        startLine: position.line,
        endLine: position.line,
        contextLines: 5
      });
      const references = await this.indexer.findSymbolReferences(symbol);
    const definition = references.find(ref => ref.type === 'declaration');
    
    if (!definition) return null;

      // Generate hover documentation using Gemini
      const hoverContent = await this.aiService.generateCodeWithContext(
        `Generate documentation for the symbol "${symbol}" at line ${position.line}.`,
        uri,
        { line: position.line, character: position.character }
      );

    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: {
          kind: 'markdown',
            value: hoverContent || `**${definition.type}** ${symbol}\n\nDefined at line ${definition.line}`
        }
      }
    };
    } catch (error) {
      console.error('Error handling hover:', error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error.message
        }
      };
    }
  }

  async handleSignatureHelp(id, params) {
    const { textDocument, position } = params;
    const { uri } = textDocument;
    
    // Get function call at position
    const callInfo = await this.getFunctionCallAtPosition(uri, position);
    if (!callInfo) return null;
    
    // Get function definition
    const references = this.indexer.findSymbolReferences(callInfo.name);
    const definition = references.find(ref => ref.type === 'function');
    
    if (!definition) return null;

    return {
      jsonrpc: '2.0',
      id,
      result: {
        signatures: [{
          label: `${callInfo.name}(${callInfo.params.join(', ')})`,
          documentation: {
            kind: 'markdown',
            value: `**Function** ${callInfo.name}\n\nDefined at line ${definition.line}`
          },
          parameters: callInfo.params.map(param => ({
            label: param,
            documentation: {
              kind: 'markdown',
              value: `Parameter: ${param}`
            }
          }))
        }],
        activeSignature: 0,
        activeParameter: callInfo.activeParam
      }
    };
  }

  // Helper methods
  positionToOffset(content, position) {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += position.character;
    return offset;
  }

  getCompletionKind(type) {
    const kinds = {
      'function': 3,
      'method': 2,
      'class': 5,
      'variable': 6,
      'constant': 21,
      'property': 9,
      'enum': 13,
      'keyword': 14,
      'snippet': 15,
      'text': 1
    };
    return kinds[type] || 1;
  }

  async getSymbolAtPosition(uri, position) {
    const content = this.documentContents.get(uri);
    if (!content) return null;
    
    const offset = this.positionToOffset(content, position);
    const line = content.slice(0, offset).split('\n').length;
    const lineContent = content.split('\n')[line - 1];
    
    // Simple word boundary detection
    const wordBoundary = /[\w$]/;
    let start = position.character;
    while (start > 0 && wordBoundary.test(lineContent[start - 1])) start--;
    let end = position.character;
    while (end < lineContent.length && wordBoundary.test(lineContent[end])) end++;
    
    return lineContent.slice(start, end);
  }

  async getFunctionCallAtPosition(uri, position) {
    const content = this.documentContents.get(uri);
    if (!content) return null;
    
    const offset = this.positionToOffset(content, position);
    const line = content.slice(0, offset).split('\n').length;
    const lineContent = content.split('\n')[line - 1];
    
    // Simple function call detection
    const callMatch = lineContent.match(/(\w+)\s*\(([^)]*)\)/);
    if (!callMatch) return null;
    
    const name = callMatch[1];
    const params = callMatch[2].split(',').map(p => p.trim());
    const activeParam = params.findIndex(p => p.includes('|')) || 0;
    
    return { name, params, activeParam };
  }

  async getAISuggestions(uri, lineContent, position) {
    // Skip AI suggestions if AIService is not available
    if (!this.aiService) {
      return [];
    }

    try {
      // Get context from indexer
      const context = await this.indexer.hybridSearch(lineContent, 3);
      
      // Generate AI suggestions
      const prompt = `Given the following code context and current line, suggest completions:
      
Context:
${context.map(c => `File: ${c.filePath}\n${c.content}`).join('\n---\n')}

Current line: ${lineContent}
Cursor position: ${position.character}

Suggest completions that would be helpful at this position.`;

      const response = await this.aiService.generateCodeForPart(
        prompt,
        'suggestions',
        1,
        1,
        null
      );

      // Parse and format suggestions
      return response.codeBlocks.map(block => ({
        label: block.content.trim(),
        kind: 15, // snippet
        detail: 'AI suggestion',
        documentation: {
          kind: 'markdown',
          value: 'AI-generated suggestion based on context'
        }
      }));
    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      return [];
    }
  }

  // Enable autonomous mode
  enableAutonomousMode() {
    this.autonomousMode = true;
    if (this.aiService) {
      this.aiService.enableAutonomousMode();
    }
    console.log('Autonomous LSP mode enabled');
  }

  // Disable autonomous mode
  disableAutonomousMode() {
    this.autonomousMode = false;
    if (this.aiService) {
      this.aiService.disableAutonomousMode();
    }
    console.log('Autonomous LSP mode disabled');
  }

  // Autonomous code analysis
  async analyzeCode(uri, content) {
    if (!this.autonomousMode) return null;

    try {
      // Check cache first
      const cacheKey = `${uri}-${content.length}`;
      if (this.analysisCache.has(cacheKey)) {
        return this.analysisCache.get(cacheKey);
      }

      // Perform analysis
      const analysis = {
        symbols: await this.extractSymbols(content),
        references: await this.findReferences(content),
        dependencies: await this.analyzeDependencies(content),
        suggestions: await this.generateSuggestions(content)
      };

      // Cache results
      this.analysisCache.set(cacheKey, analysis);
      return analysis;
    } catch (error) {
      console.error('Error in autonomous code analysis:', error);
      return null;
    }
  }

  // Extract symbols from code
  async extractSymbols(content) {
    const symbols = new Map();
    
    // Extract functions
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1] || match[2];
      symbols.set(name, {
        type: 'function',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    // Extract classes
    const classRegex = /class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      symbols.set(match[1], {
        type: 'class',
        line: content.slice(0, match.index).split('\n').length
      });
    }

    return symbols;
  }

  // Find references in code
  async findReferences(content) {
    const references = new Map();
    const symbols = await this.extractSymbols(content);
    
    for (const [name, info] of symbols) {
      const refRegex = new RegExp(`\\b${name}\\b`, 'g');
      let match;
      const refs = [];
      
      while ((match = refRegex.exec(content)) !== null) {
        refs.push({
          line: content.slice(0, match.index).split('\n').length,
          character: match.index - content.lastIndexOf('\n', match.index) - 1
        });
      }
      
      references.set(name, refs);
    }

    return references;
  }

  // Analyze dependencies
  async analyzeDependencies(content) {
    const dependencies = {
      imports: [],
      requires: [],
      globalObjects: []
    };

    // Extract imports
    const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      dependencies.imports.push(match[1]);
    }

    // Extract requires
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.requires.push(match[1]);
    }

    return dependencies;
  }

  // Generate suggestions
  async generateSuggestions(content) {
    if (!this.aiService) return [];

    try {
      const suggestions = [];
      
      // Analyze code structure
      const symbols = await this.extractSymbols(content);
      const references = await this.findReferences(content);
      
      // Generate suggestions based on analysis
      for (const [name, info] of symbols) {
        const refs = references.get(name) || [];
        if (refs.length === 0) {
          suggestions.push({
            type: 'unused',
            message: `Unused ${info.type}: ${name}`,
            line: info.line
          });
        }
      }

      return suggestions;
    } catch (error) {
      console.error('Error generating suggestions:', error);
      return [];
    }
  }
}

module.exports = LSPService;