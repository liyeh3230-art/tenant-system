// One-time Full Backup Script for Tenant System
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(rootDir, 'backups');
const targetFolder = path.join(backupDir, `backup_${dateStr}`);
const targetZip = path.join(backupDir, `tenant_system_backup_${dateStr}.zip`);

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}
if (!fs.existsSync(targetFolder)) {
  fs.mkdirSync(targetFolder, { recursive: true });
}

const itemsToCopy = [
  'src',
  'public',
  'supabase',
  'tests',
  'dist',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'eslint.config.js',
  'README.md',
  '.gitignore',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('📦 開始備份網站原始碼與設定檔...');

for (const item of itemsToCopy) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(targetFolder, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✓ 已複製: ${item}`);
  }
}

// 建立備份說明文件
const backupInfo = `# 智慧租屋管理系統 - 完整系統備份存檔 (Full System Backup)

- 備份時間 (Timestamp): ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
- 備份版本: Production Ready v1.0.0 (Security Refactored)
- 系統架構: React + Supabase Auth + PostgreSQL RLS + Edge Functions + LINE Bot

## 備份內容清單 (Backup Contents)
1. \`src/\`: 前端 React 原始碼、UI 組件、Security Service 安全認證層
2. \`supabase/\`: PostgreSQL 生產資料庫完整 DDL Schema (\`schema.sql\`)、LINE Webhook Edge Function
3. \`tests/\`: 8 大安全性與越權滲透自動化測試套件 (\`security_attack_suite.js\`)
4. \`dist/\`: 正式編譯產出包 (Production Bundle)
5. \`public/\`: 公共靜態資源
6. 設定檔: \`package.json\`, \`package-lock.json\`, \`vite.config.js\`, \`index.html\`, \`eslint.config.js\`, \`.gitignore\`

## 系統還原步驟 (Restoration Instructions)
1. 解壓縮備份檔或複製備份資料夾內容至新工作目錄。
2. 執行 \`npm install\` 安裝相依套件。
3. 執行 \`npm run build\` 驗證編譯。
4. 執行 \`node tests/security_attack_suite.js\` 驗證安全防禦。
5. 執行 \`npm run dev\` 啟動開發伺服器。
`;

fs.writeFileSync(path.join(targetFolder, 'BACKUP_INFO.md'), backupInfo, 'utf-8');
console.log('  ✓ 已建立備份說明文檔: BACKUP_INFO.md');

// 壓縮成 Zip 封裝檔 (使用 PowerShell Compress-Archive)
try {
  console.log('🗜️ 正在壓縮為 ZIP 壓縮封裝檔...');
  execSync(`powershell -Command "Compress-Archive -Path '${targetFolder}\\*' -DestinationPath '${targetZip}' -Force"`, { stdio: 'inherit' });
  console.log(`  ✓ ZIP 封裝完成: ${targetZip}`);
} catch (e) {
  console.warn('  ⚠️ Zip 壓縮跳過，資料夾備份已完整就緒。');
}

console.log('\n======================================================');
console.log('🎉 網站完整備份成功完成！');
console.log(`📁 備份目錄: ${targetFolder}`);
console.log(`📦 備份壓縮檔: ${targetZip}`);
console.log('======================================================\n');
