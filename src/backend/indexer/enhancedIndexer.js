const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const MerkleIndexer = require('./merkleIndexer');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const crypto = require('crypto');
const EmbeddingService = require('../../services/EmbeddingService');

class EnhancedIndexer extends MerkleIndexer {
  constructor(baseDir) {
    super();
    this.baseDir = baseDir;
    this.index = new Map();
    this.symbolTable = new Map();
    this.referenceGraph = new Map();
    this.fileWatcher = null;
    this.parserOptions = {
      sourceType: 'module',
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'decorators-legacy',
        'asyncGenerators',
        'objectRestSpread',
        'dynamicImport'
      ]
    };
    
    // Initialize embedding service
    this.embeddingService = new EmbeddingService();
    this.embeddings = new Map();
    this.initialized = false;
    this.fileHashes = new Map();
  }

  // Initialize word vectors with programming terms
  initializeWordVectors() {
    const commonTerms = [
      // Programming concepts
      'function', 'class', 'method', 'variable', 'constant', 'import', 'export',
      'interface', 'type', 'enum', 'async', 'await', 'promise', 'callback',
      'error', 'exception', 'try', 'catch', 'finally', 'if', 'else', 'switch',
      'case', 'for', 'while', 'do', 'return', 'break', 'continue', 'throw',
      'new', 'this', 'super', 'static', 'public', 'private', 'protected',
      'get', 'set', 'constructor', 'extends', 'implements', 'module', 'require',
      'export', 'default', 'null', 'undefined', 'true', 'false', 'let', 'const',
      'var', 'string', 'number', 'boolean', 'array', 'object', 'map', 'set',
      'promise', 'async', 'await', 'then', 'catch', 'finally', 'resolve', 'reject',
      
      // Common patterns
      'singleton', 'factory', 'observer', 'decorator', 'adapter', 'proxy',
      'facade', 'composite', 'bridge', 'flyweight', 'strategy', 'template',
      'command', 'state', 'chain', 'iterator', 'mediator', 'memento', 'visitor',
      
      // Testing terms
      'test', 'spec', 'mock', 'stub', 'spy', 'fixture', 'assert', 'expect',
      'describe', 'it', 'before', 'after', 'setup', 'teardown', 'coverage',
      
      // Documentation
      'doc', 'comment', 'api', 'interface', 'contract', 'schema', 'type',
      'param', 'return', 'throws', 'deprecated', 'todo', 'fixme', 'note'
    ];

    // Generate normalized vectors for each term
    commonTerms.forEach(term => {
      const vector = Array(50).fill(0).map(() => (Math.random() - 0.5) * 2);
      const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      this.wordVectors.set(term, vector.map(val => val / magnitude));
    });
  }

  // Get vector for a word (or generate one if not found)
  getWordVector(word) {
    if (this.wordVectors.has(word)) {
      return this.wordVectors.get(word);
    }
    // Generate and cache a new normalized vector for unknown words
    const vector = Array(50).fill(0).map(() => (Math.random() - 0.5) * 2);
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    const normalized = vector.map(val => val / magnitude);
    this.wordVectors.set(word, normalized);
    return normalized;
  }

  async initialize() {
    try {
      // Initialize the index
      this.index = new Map();
      this.symbolTable = new Map();
      this.referenceGraph = new Map();
      this.embeddings = new Map();
      
      // Create index directory if it doesn't exist
      const indexPath = path.join(this.baseDir, '.duggai', 'index');
      await fs.mkdir(indexPath, { recursive: true });
      
      // Load existing index if it exists
      const indexFile = path.join(indexPath, 'index.json');
      if (await this.fileExists(indexFile)) {
        const indexData = JSON.parse(await this.readFile(indexFile));
        this.index = new Map(Object.entries(indexData));
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing indexer:', error);
      return false;
    }
  }

  async parseFile(filePath, content) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const symbols = [];
      if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
        let ast;
        try {
          ast = parse(content, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript']
          });
        } catch (err) {
          console.error(`Error parsing file ${filePath}:`, err.message);
          return [];
        }
        traverse(ast, {
          FunctionDeclaration(path) {
            symbols.push({
              name: path.node.id.name,
              type: 'function',
              line: path.node.loc.start.line,
              file: filePath
            });
          },
          VariableDeclarator(path) {
            if (path.node.id.type === 'Identifier') {
              symbols.push({
                name: path.node.id.name,
                type: 'variable',
                line: path.node.loc.start.line,
                file: filePath
              });
            }
          },
          ClassDeclaration(path) {
            symbols.push({
              name: path.node.id.name,
              type: 'class',
              line: path.node.loc.start.line,
              file: filePath
            });
          },
          ClassMethod(path) {
            symbols.push({
              name: path.node.key.name,
              type: 'method',
              line: path.node.loc.start.line,
              file: filePath
            });
          }
        });
      }
      return symbols;
    } catch (error) {
      console.error(`Error parsing file ${filePath}:`, error.message);
      return [];
    }
  }

  async indexFile(filePath) {
    if (!this.initialized) {
      throw new Error('Indexer not initialized. Call initialize() first.');
    }
    
    try {
      const content = await this.readFile(filePath);
      const hash = this.hashContent(content);
      
      // Check if file has changed
      if (this.fileHashes.get(filePath) === hash) {
        return;
      }
      
      this.fileHashes.set(filePath, hash);
      
      // Parse and index the file
      const symbols = await this.parseFile(filePath, content);
      this.referenceGraph.set(filePath, symbols);
      
      // Generate embeddings for the file
      await this.embeddingService.generateEmbedding(content);
      
      // Update the index with the new file
      this.index.set(this.getRelativePath(filePath), {
        content,
        hash: this.hashContent(content),
        lastModified: Date.now()
      });
      
      // Update the Merkle tree
      await this.updateMerkleTree();
      
      return true;
    } catch (error) {
      console.error('Error indexing file:', error);
      return false;
    }
  }

  getRelativePath(filePath) {
    return filePath.replace(this.baseDir, '').replace(/^[\/\\]/, '');
  }

  async readFile(filePath) {
    const fs = require('fs').promises;
    return await fs.readFile(filePath, 'utf8');
  }

  async indexDirectory(dirPath) {
    try {
      const files = await this.getAllFiles(dirPath);
      for (const file of files) {
        await this.indexFile(file);
      }
      return true;
    } catch (error) {
      console.error('Error indexing directory:', error);
      return false;
    }
  }

  async getAllFiles(dirPath) {
    const files = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        files.push(...await this.getAllFiles(fullPath));
      } else {
        // Skip binary files and hidden files
        if (!entry.name.startsWith('.') && !this.isBinaryFile(entry.name)) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  isBinaryFile(filename) {
    const binaryExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
      '.woff', '.woff2', '.ttf', '.eot', '.otf',
      '.mp3', '.mp4', '.webm', '.wav',
      '.zip', '.tar', '.gz', '.rar',
      '.exe', '.dll', '.so', '.dylib'
    ];
    return binaryExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  async updateMerkleTree() {
    try {
      const leaves = [];
      for (const [filePath, { hash }] of this.index) {
        leaves.push({ path: filePath, hash });
      }
      
      // Sort leaves by path for consistent hashing
      leaves.sort((a, b) => a.path.localeCompare(b.path));
      
      // Build Merkle tree
      this.merkleTree = this.buildMerkleTree(leaves);
      return true;
    } catch (error) {
      console.error('Error updating Merkle tree:', error);
      return false;
    }
  }

  buildMerkleTree(leaves) {
    if (leaves.length === 0) return null;
    if (leaves.length === 1) return leaves[0];

    const pairs = [];
    for (let i = 0; i < leaves.length; i += 2) {
      const pair = {
        left: leaves[i],
        right: leaves[i + 1] || leaves[i],
        hash: this.hashPair(leaves[i].hash, (leaves[i + 1] || leaves[i]).hash)
      };
      pairs.push(pair);
    }

    return this.buildMerkleTree(pairs);
  }

  hashPair(hash1, hash2) {
    return crypto
      .createHash('md5')
      .update(hash1 + hash2)
      .digest('hex');
  }

  async watchDirectory(dirPath) {
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }

    this.fileWatcher = chokidar.watch(dirPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true
    });

    this.fileWatcher
      .on('add', filePath => this.indexFile(filePath))
      .on('change', filePath => this.indexFile(filePath))
      .on('unlink', filePath => {
        this.referenceGraph.delete(filePath);
        // Clean up symbol table
        for (const [symbol, infos] of this.symbolTable) {
          this.symbolTable.set(
            symbol,
            infos.filter(info => info.file !== filePath)
          );
        }
      });
  }

  // Override hybridSearch to use Gemini embeddings
  async hybridSearch(query, topK = 5) {
    try {
    const results = [];
      // Get semantic search results using embeddings
      const fileContents = Array.from(this.referenceGraph.entries()).map(([filePath, symbols]) => {
        // symbols may be undefined/null, so default to []
        const safeSymbols = Array.isArray(symbols) ? symbols : [];
        return {
          text: safeSymbols.map(symbol => symbol.name).join(' '),
          filePath
        };
      });

      // If fileContents is empty, return []
      if (!Array.isArray(fileContents) || fileContents.length === 0) return [];

      let semanticResults = [];
      try {
        semanticResults = await this.embeddingService.findSimilar(query, fileContents.map(f => f.text), topK);
      } catch (err) {
        console.error('Error in embeddingService.findSimilar:', err);
        semanticResults = [];
      }

      // semanticResults may not have filePath, so map back
      const semanticResultsWithFiles = semanticResults.map((result, i) => ({
        ...result,
        filePath: fileContents[i] ? fileContents[i].filePath : undefined,
        score: result.similarity || 0
      }));

      // Combine with structural search
      for (const result of semanticResultsWithFiles) {
        const filePath = result.filePath;
        let content = '';
        let symbols = [];
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch (err) {
          console.error('Error reading file in hybridSearch:', err);
        }
        try {
          symbols = [];
        } catch (err) {
          console.error('Error extracting symbols in hybridSearch:', err);
          symbols = [];
        }
        // Calculate structural relevance
        const structuralScore = Array.isArray(symbols)
          ? (symbols.filter(symbol => symbol && symbol.name && query.toLowerCase().includes(symbol.name.toLowerCase())).length / Math.max(1, symbols.length))
          : 0;
        // Combined score (weighted average)
        const combinedScore = 0.7 * (result.score || 0) + 0.3 * structuralScore;
        results.push({
          filePath,
          score: combinedScore,
          semanticScore: result.score || 0,
          structuralScore,
          symbols: Array.isArray(symbols) ? symbols.map(symbol => symbol.name) : [],
          content: content || ''
        });
      }
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch (error) {
      console.error('Error in hybrid search:', error);
      return [];
    }
  }

  // Override handleFileDelete to clean up embeddings
  async handleFileDelete(filePath) {
    await super.handleFileDelete(filePath);
    this.embeddings.delete(filePath);
  }

  // Add method to get file embeddings
  async getFileEmbedding(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const symbols = [];
      const text = symbols.map(([symbol]) => symbol).join(' ');
      return await this.embeddingService.generateEmbedding(text);
    } catch (error) {
      console.error('Error getting file embedding:', error);
      return null;
    }
  }

  // Update symbol table and reference graph for a file
  async updateFileIndex(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const { symbols, references } = this.extractSymbolsWithRegex(content, filePath);

    // Update symbol table
    for (const [symbol, info] of symbols) {
      const key = `${filePath}:${symbol}`;
      this.symbolTable.set(key, {
        file: filePath,
        line: info.line,
        type: info.type,
        references: references.find(([refSymbol]) => refSymbol === symbol)?.[1] || []
      });
    }

    // Update reference graph
    const referencedFiles = new Set();
    for (const [symbol, refs] of references) {
      for (const [key, info] of this.symbolTable) {
        if (key.endsWith(`:${symbol}`) && info.file !== filePath) {
          referencedFiles.add(info.file);
        }
      }
    }
    this.referenceGraph.set(filePath, referencedFiles);
  }

  // Find references to symbols in a file
  async findReferences(filePath, symbols) {
    const content = await fs.readFile(filePath, 'utf-8');
    const references = new Map();

    for (const [symbol, info] of symbols) {
      const regex = new RegExp(`\\b${symbol}\\b`, 'g');
      let match;
      const refs = [];
      while ((match = regex.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        refs.push(line);
      }
      if (refs.length > 0) {
        references.set(symbol, refs);
      }
    }

    return references;
  }

  // Start watching for file changes
  startWatching() {
    if (this.fileWatcher) return;

    this.fileWatcher = chokidar.watch(this.projectRoot, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /node_modules/,
        /dist/,
        /build/,
        /\.git/
      ],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    this.fileWatcher
      .on('add', path => this.scheduleUpdate(path))
      .on('change', path => this.scheduleUpdate(path))
      .on('unlink', path => this.handleFileDelete(path))
      .on('error', error => console.error('Watcher error:', error));
  }

  // Stop watching for file changes
  stopWatching() {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  // Schedule an update for a file (debounced)
  scheduleUpdate(filePath) {
    this.pendingUpdates.add(filePath);
    
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(() => {
      this.processPendingUpdates();
    }, 1000); // 1 second debounce
  }

  // Process all pending updates
  async processPendingUpdates() {
    try {
      for (const filePath of this.pendingUpdates) {
        await this.indexFile(filePath);
      }
      this.pendingUpdates.clear();
      await this.updateIndex();
    } catch (error) {
      console.error('Error processing updates:', error);
    }
  }

  // Find all references to a symbol
  findSymbolReferences(symbol) {
    const references = [];
    for (const [key, info] of this.symbolTable) {
      if (key.endsWith(`:${symbol}`)) {
        references.push({
          file: info.file,
          line: info.line,
          references: info.references
        });
      }
    }
    return references;
  }

  // Get all files that reference a given file
  getReferencingFiles(filePath) {
    const referencing = new Set();
    for (const [file, refs] of this.referenceGraph) {
      if (refs.has(filePath)) {
        referencing.add(file);
      }
    }
    return Array.from(referencing);
  }

  async getFileContent(filePath) {
    if (!this.initialized) {
      throw new Error('Indexer not initialized. Call initialize() first.');
    }
    
    try {
      // First try to get from index
      const relativePath = this.getRelativePath(filePath);
      const indexedFile = this.index.get(relativePath);
      if (indexedFile) {
        return indexedFile.content;
      }
      
      // If not in index, try to read from disk
      const fullPath = path.join(this.baseDir, relativePath);
      if (await this.fileExists(fullPath)) {
        const content = await this.readFile(fullPath);
        // Update index
        await this.indexFile(fullPath);
        return content;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting file content:', error);
      return null;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Add hashContent function
  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Add cleanup function
  async cleanup() {
    this.referenceGraph.clear();
    this.fileHashes.clear();
    await this.embeddingService.clearCache();
  }
}

module.exports = EnhancedIndexer; 