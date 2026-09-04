// generate-map.js
const fs = require('fs');
const path = require('path');

// 嚴格定義要忽略的資料夾與檔案 (避免污染 AI 視野)
const IGNORE_LIST = [
  'node_modules', '.git', '.cursor', '.tmp', 'dist', 'build', 
  '__pycache__', '.venv', 'package-lock.json', 'yarn.lock'
];

function generateTree(dir, prefix = '') {
  let output = '';
  const files = fs.readdirSync(dir);
  
  // 目錄排前面，檔案排後面排序
  files.sort((a, b) => {
    const aIsDir = fs.statSync(path.join(dir, a)).isDirectory();
    const bIsDir = fs.statSync(path.join(dir, b)).isDirectory();
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (IGNORE_LIST.includes(file)) continue;

    const fullPath = path.join(dir, file);
    const isLast = i === files.length - 1;
    const isDir = fs.statSync(fullPath).isDirectory();
    
    const marker = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    
    output += `${prefix}${marker}${file}\n`;
    
    if (isDir) {
      output += generateTree(fullPath, childPrefix);
    }
  }
  return output;
}

function createProjectMap() {
  const rootDir = __dirname;
  const mapPath = path.join(rootDir, 'PROJECT_MAP.md');
  
  let content = '# 專案實體架構地圖 (Project Map)\n\n';
  content += '> 這是系統自動生成的目錄結構，供 AI 快速掌握全域檔案分佈。\n\n';
  content += '```text\n';
  content += generateTree(rootDir);
  content += '```\n';

  fs.writeFileSync(mapPath, content, 'utf-8');
  console.log(`[Success] PROJECT_MAP.md 已成功生成於專案根目錄！`);
}

createProjectMap();