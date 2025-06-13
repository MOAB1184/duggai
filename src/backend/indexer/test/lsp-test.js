const { EnhancedIndexer } = require('../index');
const LSPService = require('../../../services/LSPService');
const LSPClient = require('../../../services/LSPClient');
const path = require('path');
const fs = require('fs').promises;
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function runLSPTest() {
  console.log('🚀 Starting LSP Integration Test\n');

  try {
    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️  GEMINI_API_KEY not found. Some AI features will be disabled.\n');
    }

    // Initialize LSP server
    const lspServer = new LSPService(3000);
    await lspServer.start();
    console.log('✅ LSP server started\n');

    // Initialize LSP client
    const lspClient = new LSPClient(3000);
    await lspClient.connect();
    console.log('✅ LSP client connected\n');

    // Create test file
    const testDir = path.join(__dirname, 'test-files');
    await fs.mkdir(testDir, { recursive: true });
    const testFile = path.join(testDir, 'test-file.js');
    
    // Write test content
    const testContent = `
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
    `;
    
    await fs.writeFile(testFile, testContent);
    console.log('✅ Test file created\n');

    // Test LSP features
    console.log('🔍 Testing LSP Features\n');

    // 1. Test document synchronization
    console.log('1. Testing document synchronization...');
    await lspClient.didOpen(testFile, 1, testContent);
    console.log('✅ Document opened\n');

    // 2. Test completions
    console.log('2. Testing completions...');
    const completions = await lspClient.getCompletions(testFile, { line: 3, character: 10 });
    console.log('Completions:', completions);
    console.log('✅ Completions retrieved\n');

    // 3. Test definition
    console.log('3. Testing definition...');
    const definition = await lspClient.getDefinition(testFile, { line: 3, character: 10 });
    console.log('Definition:', definition);
    console.log('✅ Definition retrieved\n');

    // 4. Test references
    console.log('4. Testing references...');
    const references = await lspClient.getReferences(testFile, { line: 3, character: 10 });
    console.log('References:', references);
    console.log('✅ References retrieved\n');

    // 5. Test hover
    console.log('5. Testing hover...');
    const hover = await lspClient.getHover(testFile, { line: 3, character: 10 });
    console.log('Hover:', hover);
    console.log('✅ Hover info retrieved\n');

    // 6. Test signature help
    console.log('6. Testing signature help...');
    const signatureHelp = await lspClient.getSignatureHelp(testFile, { line: 3, character: 10 });
    console.log('Signature help:', signatureHelp);
    console.log('✅ Signature help retrieved\n');

    // 7. Test document changes
    console.log('7. Testing document changes...');
    const newContent = testContent + '\nconst instance = new TestClass();\n';
    await lspClient.didChange(testFile, 2, [{ text: newContent }]);
    console.log('✅ Document changed\n');

    // 8. Test document close
    console.log('8. Testing document close...');
    await lspClient.didClose(testFile);
    console.log('✅ Document closed\n');

    // Cleanup
    await fs.unlink(testFile);
    await fs.rmdir(testDir);
    lspClient.disconnect();
    console.log('✨ LSP test complete!');
  } catch (error) {
    console.error('LSP test failed:', error);
    process.exit(1);
  }
}

runLSPTest().catch(console.error); 