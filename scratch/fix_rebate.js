const fs = require('fs');

let content = fs.readFileSync('backend/routes/rebate.js', 'utf8');

content = content.replace(
  `    res.status(statusCode).json({ message: e.message || 'เกิดข้อผิดพลาดในการไม่อนุมัติใบขอเคลียร์' });\r\n});`,
  `    res.status(statusCode).json({ message: e.message || 'เกิดข้อผิดพลาดในการไม่อนุมัติใบขอเคลียร์' });\r\n  }\r\n});`
);

fs.writeFileSync('backend/routes/rebate.js', content, 'utf8');
console.log('Fixed catch bracket.');
