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

    // 1. Aggressively fix padding on main scrollable containers
    // Match flex-1 overflow-auto or overflow-y-auto followed by p-anything
    content = content.replace(/className="([^"]*flex-1 overflow-[a-z-]*auto)\s+p-([0-9]+)\s+(space-y-[0-9]+)?"/g, (match, prefix, pVal, spaceY) => {
        let replacement = `className="${prefix} p-0 sm:p-${pVal}`;
        if (spaceY) {
            replacement += ` space-y-2 sm:${spaceY}`;
        }
        replacement += '"';
        return replacement;
    });

    // Also fix cases where we added p-0 sm:p-6 but missed the space-y adjust
    content = content.replace(/className="flex-1 overflow-([a-z-]*auto) p-0 sm:p-([0-9]+) space-y-([0-9]+)"/g, 'className="flex-1 overflow-$1 p-0 sm:p-$2 space-y-2 sm:space-y-$3"');

    // 2. Remove min-w-[xxx] from tables which causes whitespace issues
    content = content.replace(/<table className="([^"]*)"/g, (match, classes) => {
        let newClasses = classes.replace(/min-w-\[\d+px\]/g, '').trim();
        // ensure min-w-full and whitespace-nowrap are present and not duplicated
        if (!newClasses.includes('min-w-full')) newClasses += ' min-w-full';
        if (!newClasses.includes('whitespace-nowrap')) newClasses += ' whitespace-nowrap';
        // replace double spaces
        newClasses = newClasses.replace(/\s+/g, ' ');
        return `<table className="${newClasses}"`;
    });

    // 3. Fix inner white cards that might not have rounded-none on mobile
    // Match bg-white rounded-something (xl, 2xl, lg, md)
    content = content.replace(/className="([^"]*bg-white)\s+rounded-([a-z0-9]+)\s+([^"]*border-gray-[0-9]+)[^"]*"/g, (match, bg, round, borderTail, offset, string) => {
        if (match.includes('rounded-none sm:rounded')) return match; // already fixed
        if (match.includes('sm:border-none')) return match;
        // e.g. bg-white rounded-2xl border border-gray-100 shadow-sm
        return match.replace(`rounded-${round}`, `rounded-none sm:rounded-${round}`)
                    .replace('border border-', 'border-y sm:border border-')
                    .replace('shadow-sm', 'shadow-sm sm:shadow-sm shadow-none'); 
    });

    if (content !== original) {
        modifiedFiles.push(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

walkDir(srcDir);
console.log(`Aggressively modified ${modifiedFiles.length} files:`);
modifiedFiles.forEach(f => console.log(f.replace(srcDir, '')));
