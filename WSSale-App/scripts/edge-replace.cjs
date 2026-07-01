const fs = require('fs');
const path = require('path');

const srcDir = 'c:\\MyWork\\winspeed-frontend\\WSSale-App\\src\\components';
let modifiedFiles = [];

function walkDir(dir) {
    fs.readdirSync(dir).forEach(f => {
        const dirPath = path.join(dir, f);
        if (fs.statSync(dirPath).isDirectory()) {
            walkDir(dirPath);
        } else if (f.endsWith('.tsx')) {
            processFile(dirPath);
        }
    });
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // 1. Fix padding on mobile (p-3 sm:p-6 -> p-0 sm:p-6 or p-6 -> p-0 sm:p-6)
    content = content.replace(/className="flex-1 overflow-([xya]-)?auto p-3 sm:p-6"/g, 'className="flex-1 overflow-$1auto p-0 sm:p-6"');
    content = content.replace(/className="flex-1 overflow-([xya]-)?auto p-4 sm:p-6"/g, 'className="flex-1 overflow-$1auto p-0 sm:p-6"');
    content = content.replace(/className="flex-1 overflow-([xya]-)?auto p-6"/g, 'className="flex-1 overflow-$1auto p-0 sm:p-6"');
    
    // Some are space-y-5, on mobile we want cards touching if background is F1EFE8, but wait, 
    // if background is F1EFE8 and p-0, cards need rounded-none. 
    // Actually, just removing the outer padding on mobile:
    content = content.replace(/className="flex-1 overflow-([xya]-)?auto p-3 sm:p-6 space-y-([0-9]+)"/g, 'className="flex-1 overflow-$1auto p-0 sm:p-6 space-y-0 sm:space-y-$2"');

    // 2. Fix inner cards rounded corners and border on mobile
    content = content.replace(/className="bg-white rounded-2xl border border-gray-100/g, 'className="bg-white rounded-none sm:rounded-2xl border-y sm:border border-gray-100');
    content = content.replace(/className="bg-white rounded-xl border border-gray-100/g, 'className="bg-white rounded-none sm:rounded-xl border-y sm:border border-gray-100');
    content = content.replace(/className="bg-white rounded-2xl shadow-sm overflow-hidden"/g, 'className="bg-white rounded-none sm:rounded-2xl shadow-sm overflow-hidden border-y sm:border-none border-gray-100"');

    // 3. Fix tables to prevent right whitespace (min-w-full and whitespace-nowrap)
    content = content.replace(/<table className="([^"]*)"/g, (match, classes) => {
        let newClasses = classes;
        if (!newClasses.includes('min-w-full')) newClasses += ' min-w-full';
        if (!newClasses.includes('whitespace-nowrap')) newClasses += ' whitespace-nowrap';
        return `<table className="${newClasses}"`;
    });

    // 4. Also add whitespace-nowrap to th tags just in case
    content = content.replace(/<th className="([^"]*)"/g, (match, classes) => {
        let newClasses = classes;
        if (!newClasses.includes('whitespace-nowrap')) newClasses += ' whitespace-nowrap';
        return `<th className="${newClasses}"`;
    });

    if (content !== original) {
        modifiedFiles.push(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

walkDir(srcDir);
console.log(`Modified ${modifiedFiles.length} files to be edge-to-edge and fix table whitespace:`);
modifiedFiles.forEach(f => console.log(f.replace(srcDir, '')));
