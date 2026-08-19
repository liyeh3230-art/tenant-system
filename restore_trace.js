const fs = require('fs');
const path = require('path');

const transcriptPath = 'C:\\Users\\Liyeh_Work\\.gemini\\antigravity-ide\\brain\\a8043d74-781b-4aa4-9e9b-17043e7a726c\\.system_generated\\logs\\transcript.jsonl';
const fileData = fs.readFileSync(transcriptPath, 'utf8');
const lines = fileData.split('\n');

const stepContents = {};
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const parsed = JSON.parse(line);
    if (parsed.type === 'VIEW_FILE' && parsed.content && parsed.content.includes('File Path: `file:///c:/Users/Liyeh_Work/tenant-system/src/App.jsx`')) {
      stepContents[parsed.step_index] = parsed.content;
    }
  } catch (e) {
    // ignore json parse errors
  }
}

const steps = [240, 283, 285];
let reconstructedLines = [];

for (const s of steps) {
  const content = stepContents[s];
  if (!content) {
    console.error(`Step ${s} not found!`);
    continue;
  }
  const contentLines = content.split('\n');
  let count = 0;
  for (const line of contentLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const numPart = line.substring(0, colonIndex);
      if (/^\d+$/.test(numPart)) {
        const lineNum = parseInt(numPart, 10);
        let code = line.substring(colonIndex + 1);
        if (code.startsWith(' ')) {
          code = code.substring(1);
        }
        if (code.endsWith('\r')) {
          code = code.slice(0, -1);
        }
        reconstructedLines[lineNum] = code;
        count++;
      }
    }
  }
  console.log(`Step ${s}: parsed ${count} lines from content`);
}

const nonEmpty = reconstructedLines.filter(x => x !== undefined && x !== '');
console.log('Reconstructed array size:', reconstructedLines.length);
console.log('Non-empty reconstructed lines:', nonEmpty.length);

for (let i = 1; i <= 20; i++) {
  console.log(`Line ${i}:`, reconstructedLines[i]);
}
