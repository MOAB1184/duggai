// auto-fix.js
// Fully automated error diagnosis and self-healing script for Duggai projects

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
require('dotenv').config();

const MAX_RETRIES = 10;
const RUN_TIMEOUT = 30000; // 30 seconds
const START_COMMAND = 'npm';
const START_ARGS = ['start'];

const projectRoot = process.argv[2] || path.join(__dirname, 'src');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Initialize Gemini
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function runProject() {
  return new Promise((resolve) => {
    const proc = spawn(START_COMMAND, START_ARGS, { shell: true });
    let output = '';
    let errorDetected = false;
    let timer;

    proc.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });
    proc.stderr.on('data', (data) => {
      output += data.toString();
      process.stderr.write(data);
      errorDetected = true;
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, errorDetected });
    });

    // Timeout after RUN_TIMEOUT ms
    timer = setTimeout(() => {
      proc.kill();
      resolve({ code: 0, output, errorDetected });
    }, RUN_TIMEOUT);
  });
}

async function getRelevantFiles() {
  // Scan all JS/JSX files in the project root
  let files = [];
  function walk(dir) {
    fs.readdirSync(dir).forEach((file) => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
        files.push(fullPath);
      }
    });
  }
  if (fs.existsSync(projectRoot)) walk(projectRoot);
  return files;
}

async function getFileContents(files) {
  const contents = {};
  for (const file of files) {
    contents[file] = fs.readFileSync(file, 'utf-8');
  }
  return contents;
}

async function callAIForFix(errorOutput, fileContents) {
  const prompt = `You are an expert AI debugger. The following error occurred when running the project:\n\n${errorOutput}\n\nHere is the current code for the relevant files:\n\n${Object.entries(fileContents).map(([file, content]) => `File: ${file}\n${content}`).join('\n\n')}\n\nYour task:\n- Diagnose the root cause of the error.\n- Provide a complete, working fix.\n- Only output a JSON array of objects: [{file: 'path', content: 'new file content'}]. Do not explain, just provide the fix.\n`;

  try {
    const model = gemini.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const aiText = result.response.text();
    
    // Try to parse JSON from AI response
    const jsonStart = aiText.indexOf('[');
    const jsonEnd = aiText.lastIndexOf(']') + 1;
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const jsonString = aiText.slice(jsonStart, jsonEnd);
      return JSON.parse(jsonString);
    }
    return [];
  } catch (err) {
    console.error('[AI DEBUGGER] Error calling Gemini:', err);
    return [];
  }
}

async function applyFixes(fixes) {
  if (fixes.length === 0) {
    console.log('[AI DEBUGGER] No fixes to apply.');
    return;
  }
  for (const fix of fixes) {
    try {
      fs.writeFileSync(fix.file, fix.content, 'utf-8');
      console.log(`[AI DEBUGGER] Applied fix to: ${fix.file}`);
    } catch (err) {
      console.error(`[AI DEBUGGER] Failed to apply fix to: ${fix.file}`, err);
    }
  }
}

async function main() {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    console.log(`\n[AutoFix] Attempt ${retries + 1} of ${MAX_RETRIES}`);
    const { code, output, errorDetected } = await runProject();
    if (!errorDetected && code === 0) {
      console.log('\n✅ Project started successfully! No errors detected.');
      return;
    }
    // Get relevant files
    const files = await getRelevantFiles();
    const fileContents = await getFileContents(files);
    // Call AI for fix
    const fixes = await callAIForFix(output, fileContents);
    // Apply fixes
    await applyFixes(fixes);
    retries++;
  }
  console.log('\n❌ Max retries reached. Please check errors manually.');
}

main(); 