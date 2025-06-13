const CodeIndexer = require('./services/CodeIndexer');
const path = require('path');

async function runTest() {
  console.log('Initializing CodeIndexer...');
  const indexer = new CodeIndexer();

  // Test files with different languages
  const testFiles = [
    {
      path: 'test.js',
      content: `
        import { useState } from 'react';
        
        function Counter() {
          const [count, setCount] = useState(0);
          return (
            <div>
              <p>Count: {count}</p>
              <button onClick={() => setCount(count + 1)}>Increment</button>
            </div>
          );
        }
        
        export default Counter;
      `
    },
    {
      path: 'test.py',
      content: `
        from typing import List
        import numpy as np
        
        class DataProcessor:
            def __init__(self, data: List[float]):
                self.data = np.array(data)
            
            def process(self) -> float:
                return np.mean(self.data)
      `
    },
    {
      path: 'test.cpp',
      content: `
        #include <vector>
        #include <string>
        
        class StringProcessor {
        private:
            std::vector<std::string> strings;
            
        public:
            void addString(const std::string& str) {
                strings.push_back(str);
            }
            
            std::string concatenate() const {
                std::string result;
                for (const auto& str : strings) {
                    result += str;
                }
                return result;
            }
        };
      `
    }
  ];

  console.log('\nIndexing test files...');
  for (const file of testFiles) {
    console.log(`\nIndexing ${file.path}...`);
    await indexer.addFileToIndex(file.path, file.content);
  }

  // Test searches
  console.log('\nTesting searches...');
  
  // Test exact search
  console.log('\nExact search for "Counter":');
  const exactResults = indexer.search('Counter', { semantic: false });
  console.log(exactResults);

  // Test semantic search
  console.log('\nSemantic search for "data processing":');
  const semanticResults = indexer.search('data processing', { semantic: true });
  console.log(semanticResults);

  // Test symbol extraction
  console.log('\nExtracted symbols from Python file:');
  const pythonFile = indexer.files.get('test.py');
  console.log(pythonFile.symbols);

  // Test dependency extraction
  console.log('\nDependencies in JavaScript file:');
  const jsFile = indexer.files.get('test.js');
  console.log(jsFile.dependencies);

  // Test file removal
  console.log('\nRemoving test.js...');
  indexer.removeFile('test.js');
  console.log('Files in index:', Array.from(indexer.files.keys()));

  // Test persistence
  console.log('\nSaving index to disk...');
  indexer.saveIndex();
  
  // Create new indexer instance to test loading
  console.log('\nCreating new indexer instance to test loading...');
  const newIndexer = new CodeIndexer();
  console.log('Files loaded:', Array.from(newIndexer.files.keys()));
}

runTest().catch(console.error); 