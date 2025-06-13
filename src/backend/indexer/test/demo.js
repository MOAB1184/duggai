const { EnhancedIndexer } = require('../index');
const path = require('path');
const fs = require('fs').promises;

async function runDemo() {
  console.log('🚀 Starting EnhancedIndexer Demo\n');

  try {
    // Initialize indexer
    const indexer = new EnhancedIndexer();
    const projectPath = path.resolve(__dirname, '../../../'); // Project root

    console.log('📂 Indexing project...');
    await indexer.indexProject(projectPath);
    console.log('✅ Project indexed!\n');

    // Demo 1: Symbol Search
    console.log('🔍 Demo 1: Symbol Search');
    const symbolResults = indexer.findSymbolReferences('EnhancedIndexer');
    console.log('Found references:', symbolResults);
    console.log();

    // Demo 2: Cross-File References
    console.log('🔗 Demo 2: Cross-File References');
    const referencingFiles = indexer.getReferencingFiles(path.join(projectPath, 'src/backend/indexer/enhancedIndexer.js'));
    console.log('Files referencing EnhancedIndexer:', referencingFiles);
    console.log();

    // Demo 3: Hybrid Search
    console.log('🔎 Demo 3: Hybrid Search');
    const searchResults = await indexer.hybridSearch('how to handle file indexing');
    console.log('Search results:', searchResults);
    console.log();

    // Demo 4: Real-time Updates
    console.log('⏱️ Demo 4: Real-time Updates');
    console.log('Starting file watcher...');
    indexer.startWatching();
    
    // Create test file in the correct location
    const testDir = path.join(__dirname, 'test-files');
    await fs.mkdir(testDir, { recursive: true });
    const testFile = path.join(testDir, 'test-file.js');
    
    // Write test content
    await fs.writeFile(testFile, `
      // Test file
      class TestClass {
        constructor() {
          this.value = 42;
        }
        
        async testMethod() {
          return this.value;
        }
      }
      
      export default TestClass;
    `);
    
    console.log('File created, waiting for indexer to process...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newSymbols = indexer.findSymbolReferences('TestClass');
    console.log('Found new symbol:', newSymbols);
    console.log();

    // Cleanup
    await fs.unlink(testFile);
    await fs.rmdir(testDir);
    indexer.stopWatching();
    console.log('✨ Demo complete!');
  } catch (error) {
    console.error('Demo failed:', error);
  }
}

runDemo().catch(console.error); 