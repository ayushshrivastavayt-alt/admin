// Build script: generates config/env.js from environment variables
const fs = require('fs');
const path = require('path');

const envContent = `// Auto-generated at build time — DO NOT EDIT
window.__ENV = {
    SUPABASE_URL: '${process.env.SUPABASE_URL || ''}',
    SUPABASE_KEY: '${process.env.SUPABASE_KEY || ''}',
    TELEGRAM_BOT_TOKEN: '${process.env.TELEGRAM_BOT_TOKEN || ''}'
};
`;

const outPath = path.join(__dirname, 'config', 'env.js');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, envContent, 'utf8');
console.log('✅ config/env.js generated from environment variables');
