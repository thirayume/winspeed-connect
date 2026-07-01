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

    // 1. Remove whitespace-nowrap from <table> tags
    content = content.replace(/<table className="([^"]*)"/g, (match, classes) => {
        let newClasses = classes.replace(/\bwhitespace-nowrap\b/g, '').trim();
        newClasses = newClasses.replace(/\s+/g, ' '); // cleanup double spaces
        // Ensure w-full and min-w-full are present
        if (!newClasses.includes('min-w-full')) newClasses += ' min-w-full';
        if (!newClasses.includes('w-full')) newClasses += ' w-full';
        return `<table className="${newClasses}"`;
    });

    // 2. Ensure whitespace-nowrap is on <th> tags
    content = content.replace(/<th([^>]*)className="([^"]*)"/g, (match, before, classes) => {
        let newClasses = classes;
        if (!newClasses.includes('whitespace-nowrap')) newClasses += ' whitespace-nowrap';
        return `<th${before}className="${newClasses}"`;
    });
    // For <th> without className
    content = content.replace(/<th(?![^>]*className=)([^>]*)>/g, '<th$1 className="whitespace-nowrap">');

    // 3. Ensure whitespace-nowrap is on <td> tags
    content = content.replace(/<td([^>]*)className="([^"]*)"/g, (match, before, classes) => {
        let newClasses = classes;
        // don't add to td that specifically want to wrap (truncate or max-w)
        if (!newClasses.includes('whitespace-nowrap') && !newClasses.includes('truncate') && !newClasses.includes('whitespace-normal')) {
            newClasses += ' whitespace-nowrap';
        }
        return `<td${before}className="${newClasses}"`;
    });
    // For <td> without className
    content = content.replace(/<td(?![^>]*className=)([^>]*)>/g, '<td$1 className="whitespace-nowrap">');

    if (content !== original) {
        modifiedFiles.push(filePath);
        fs.writeFileSync(filePath, content, 'utf8');
    }
}

walkDir(srcDir);
console.log(`Modified ${modifiedFiles.length} files to move whitespace-nowrap to th/td:`);
modifiedFiles.forEach(f => console.log(f.replace(srcDir, '')));
