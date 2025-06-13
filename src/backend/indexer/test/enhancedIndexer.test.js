const fs = require('fs').promises;
const path = require('path');
const { EnhancedIndexer } = require('../index');

describe('EnhancedIndexer', () => {
  let indexer;
  let testDir;

  beforeEach(async () => {
    // Create test directory
    testDir = path.join(__dirname, 'test-project');
    await fs.mkdir(testDir, { recursive: true });
    
    // Create test files
    await fs.writeFile(
      path.join(testDir, 'test1.js'),
      'function testFunction() {}\nconst testVar = 42;'
    );
    await fs.writeFile(
      path.join(testDir, 'test2.js'),
      'import { testFunction } from "./test1.js";\nconst anotherVar = testFunction();'
    );

    indexer = new EnhancedIndexer();
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
    indexer.stopWatching();
  });

  test('should initialize word vectors', () => {
    expect(indexer.wordVectors.size).toBeGreaterThan(0);
    expect(indexer.wordVectors.get('function')).toBeDefined();
    expect(indexer.wordVectors.get('function').length).toBe(50);
  });

  test('should generate vectors for unknown words', () => {
    const vector = indexer.getWordVector('unknownword');
    expect(vector).toBeDefined();
    expect(vector.length).toBe(50);
    expect(indexer.wordVectors.get('unknownword')).toBeDefined();
  });

  test('should index files and extract symbols using AST', async () => {
    await indexer.indexProject(testDir);
    
    const references = indexer.findSymbolReferences('testFunction');
    expect(references).toHaveLength(1);
    expect(references[0].file).toContain('test1.js');
    expect(references[0].type).toBe('function');
  });

  test('should find cross-file references', async () => {
    await indexer.indexProject(testDir);
    
    const referencingFiles = indexer.getReferencingFiles(path.join(testDir, 'test1.js'));
    expect(referencingFiles).toContain(path.join(testDir, 'test2.js'));
  });

  test('should handle file changes', async () => {
    await indexer.indexProject(testDir);
    indexer.startWatching();

    // Modify a file
    await fs.writeFile(
      path.join(testDir, 'test1.js'),
      'function testFunction() {}\nconst newVar = 100;'
    );

    // Wait for the change to be processed
    await new Promise(resolve => setTimeout(resolve, 1500));

    const references = indexer.findSymbolReferences('newVar');
    expect(references).toHaveLength(1);
  });

  test('should handle file deletion', async () => {
    await indexer.indexProject(testDir);
    indexer.startWatching();

    // Delete a file
    await fs.unlink(path.join(testDir, 'test1.js'));

    // Wait for the change to be processed
    await new Promise(resolve => setTimeout(resolve, 1500));

    const references = indexer.findSymbolReferences('testFunction');
    expect(references).toHaveLength(0);
  });

  test('should perform hybrid search', async () => {
    await indexer.indexProject(testDir);
    
    const results = await indexer.hybridSearch('test function implementation');
    expect(results).toHaveLength(2); // Both files should be returned
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('semanticScore');
    expect(results[0]).toHaveProperty('structuralScore');
  });

  test('should maintain Merkle tree integrity', async () => {
    await indexer.indexProject(testDir);
    const initialRoot = indexer.getMerkleRoot();

    // Modify a file
    await fs.writeFile(
      path.join(testDir, 'test1.js'),
      'function testFunction() {}\nconst newVar = 100;'
    );

    // Wait for the change to be processed
    await new Promise(resolve => setTimeout(resolve, 1500));

    const newRoot = indexer.getMerkleRoot();
    expect(newRoot).not.toBe(initialRoot);
  });

  test('should cache embeddings', async () => {
    await indexer.indexProject(testDir);
    
    // First search
    const results1 = await indexer.hybridSearch('test function');
    
    // Second search (should use cache)
    const results2 = await indexer.hybridSearch('test function');
    
    expect(results1).toEqual(results2);
  });
}); 