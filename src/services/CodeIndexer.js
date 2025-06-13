const fs = require('fs');
const path = require('path');
const { Parser } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

class CodeIndexer {
  constructor() {
    this.symbolTable = new Map();
    this.referenceGraph = new Map();
  }

  async indexFile(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const ext = path.extname(filePath).slice(1);
    const symbols = new Map();

    if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
      try {
        const ast = Parser.parse(content, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript']
        });

        traverse(ast, {
          FunctionDeclaration(path) {
            symbols.set(path.node.id.name, {
              line: path.node.loc.start.line,
              type: 'function',
              kind: 'declaration'
            });
          },
          ClassDeclaration(path) {
            symbols.set(path.node.id.name, {
              line: path.node.loc.start.line,
              type: 'class',
              kind: 'declaration'
            });
          },
          VariableDeclarator(path) {
            if (path.node.id.type === 'Identifier') {
              symbols.set(path.node.id.name, {
                line: path.node.loc.start.line,
                type: 'variable',
                kind: 'declaration'
              });
            }
          }
        });
      } catch (error) {
        console.warn(`Failed to parse ${filePath} with AST, falling back to regex`);
        this.extractSymbolsWithRegex(content, symbols);
      }
    } else {
      this.extractSymbolsWithRegex(content, symbols);
    }

    // Update symbol table
    for (const [symbol, info] of symbols) {
      const key = `${filePath}:${symbol}`;
      this.symbolTable.set(key, {
        file: filePath,
        line: info.line,
        type: info.type
      });
    }

    // Update reference graph
    const references = await this.findReferences(filePath, symbols);
    this.referenceGraph.set(filePath, references);

    return symbols;
  }

  extractSymbolsWithRegex(content, symbols) {
    const patterns = {
      py: /(?:def|class)\s+(\w+)/g,
      cpp: /(?:class|struct|enum|void|int|float|double|char|bool)\s+(\w+)/g,
      java: /(?:class|interface|enum|void|int|float|double|char|boolean)\s+(\w+)/g,
      cs: /(?:class|interface|enum|void|int|float|double|char|bool)\s+(\w+)/g,
      default: /(?:function|class|const|let|var)\s+(\w+)/g
    };

    const ext = path.extname(filePath).slice(1);
    const pattern = patterns[ext] || patterns.default;
    
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const symbol = match[1];
      const line = content.slice(0, match.index).split('\n').length;
      symbols.set(symbol, { line, type: 'unknown' });
    }
  }

  async findReferences(filePath, symbols) {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const references = new Set();

    for (const [symbol] of symbols) {
      const regex = new RegExp(`\\b${symbol}\\b`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        references.add({ symbol, line });
      }
    }

    return Array.from(references);
  }

  findSymbolReferences(symbol) {
    const references = [];
    for (const [key, info] of this.symbolTable) {
      if (key.endsWith(`:${symbol}`)) {
        references.push({
          file: info.file,
          line: info.line,
          type: info.type
        });
      }
    }
    return references;
  }

  getReferencingFiles(filePath) {
    const referencing = new Set();
    for (const [file, refs] of this.referenceGraph) {
      if (refs.some(ref => ref.file === filePath)) {
        referencing.add(file);
      }
    }
    return Array.from(referencing);
  }
}

module.exports = CodeIndexer; 