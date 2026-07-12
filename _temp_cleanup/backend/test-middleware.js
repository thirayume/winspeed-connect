const http = require('http');
http.get('http://localhost:3000/api/so/undefined', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'BODY:', data));
});
