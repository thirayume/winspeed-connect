const fs = require('fs');
const path = require('path');

const srcDir = 'c:\\MyWork\\winspeed-frontend\\WSSale-App\\src\\components';
let modifiedFiles = [];

function walkDir(dir) {
    fs.readdirSync(dir).forEach(f => {
        const dirPath = path.join(dir, f);
        const isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            walkDir(dirPath);
        } else if (f.endsWith('.tsx')) {
            processFile(dirPath);
        }
    });
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. Header Container
    content = content.replace(
        /className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between[a-zA-Z0-9\s-]*"/g,
        'className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"'
    );
    
    // 2. Title
    content = content.replace(
        /className="text-2xl font-black flex items-center gap-2"/g,
        'className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight"'
    );

    // 3. Subtitle
    content = content.replace(
        /className="text-sm text-gray-500 mt-0\.5"/g,
        'className="text-xs sm:text-sm text-gray-500 mt-1 truncate"'
    );

    // 4. Content Wrapper Padding (p-6)
    content = content.replace(
        /className="flex-1 overflow-auto p-6"/g,
        'className="flex-1 overflow-auto p-3 sm:p-6"'
    );
    
    // 5. Controls wrapper (optional shrink-0)
    // Only if it looks like <div className="flex items-center gap-2"> right after the header block... too risky with global regex.

    if (content !== original) {
        modifiedFiles.push(filePath);
        // fs.writeFileSync(filePath, content, 'utf8'); // Just dry run for now
    }
}

walkDir(srcDir);
console.log(`Found ${modifiedFiles.length} files to modify:`);
modifiedFiles.forEach(f => console.log(f.replace(srcDir, '')));
