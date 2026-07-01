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

    // 1. Header Container (Handle variations like flex-wrap, shrink-0 etc)
    content = content.replace(
        /className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm flex[a-zA-Z0-9\s-]* justify-between[a-zA-Z0-9\s-]*"/g,
        'className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"'
    );
    // Also handle simple header without flex (e.g. DataGovernancePage)
    content = content.replace(
        /className="px-6 py-5 border-b border-gray-200 bg-white shadow-sm"/g,
        'className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-sm"'
    );
    
    // 2. Title
    content = content.replace(
        /className="text-2xl font-black flex items-center gap-2"/g,
        'className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight"'
    );
    // Title with color inline style
    content = content.replace(
        /className="text-2xl font-black flex items-center gap-2" style={{ color: '#0C447C' }}/g,
        'className="text-xl sm:text-2xl font-black flex flex-wrap items-center gap-2 leading-tight" style={{ color: \'#0C447C\' }}'
    );

    // 3. Subtitle
    content = content.replace(
        /className="text-sm text-gray-500 mt-0\.5"/g,
        'className="text-xs sm:text-sm text-gray-500 mt-1 truncate"'
    );
    content = content.replace(
        /className="text-sm text-gray-500 mt-1"/g,
        'className="text-xs sm:text-sm text-gray-500 mt-1 truncate"'
    );

    // 4. Content Wrapper Padding (p-6)
    content = content.replace(
        /className="flex-1 overflow-auto p-6"/g,
        'className="flex-1 overflow-auto p-3 sm:p-6"'
    );
    
    // 5. Shrink icons in headers
    // Find lines with h1 and replace Lucide icon sizes inside it
    const h1BlockRegex = /<h1[^>]*>([\s\S]*?)<\/h1>/g;
    content = content.replace(h1BlockRegex, (match) => {
        return match.replace(/size=\{26\}/g, 'className="w-5 h-5 sm:w-6 sm:h-6 shrink-0"');
    });

    if (content !== original) {
        modifiedFiles.push(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

walkDir(srcDir);
console.log(`Modified ${modifiedFiles.length} files:`);
modifiedFiles.forEach(f => console.log(f.replace(srcDir, '')));
