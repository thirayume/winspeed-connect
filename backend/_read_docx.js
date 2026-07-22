const AdmZip = require('adm-zip');
const path = require('path');

function readDocx(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const contentXml = zip.readAsText('word/document.xml');
    
    // Simple regex to strip XML tags and extract text
    const text = contentXml.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    console.log(text);
  } catch (e) {
    console.error('Error reading docx:', e.message);
  }
}

readDocx(process.argv[2]);
