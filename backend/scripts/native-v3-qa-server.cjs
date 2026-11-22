'use strict';
// Local/LAN tunnel rehearsal only; never started by the deployment Compose kit.
const fs=require('fs'),path=require('path'),http=require('http');
const {assertQaProfile,assertQaAccess}=require('./native-v3-qa-profile.cjs');
const profile=assertQaProfile();
process.env.PORT='3000';
// Do not start listening or register workers before checking the actual login.
const db=require('../db');
const root='/review-ui',mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const front=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/uploads/')||url.pathname.startsWith('/socket.io/')){
  const upstream=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers:req.headers},response=>{
   res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"code":"QA_API_UNAVAILABLE"}');});
  req.pipe(upstream);return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let relative;
 try{relative=decodeURIComponent(url.pathname);}catch{res.writeHead(400);res.end();return;}
 const file=path.resolve(root,'.'+relative);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(400);res.end();return;}
 const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(root,'index.html');
 res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
 if(req.method==='HEAD')res.end();
 else if(target===path.join(root,'index.html'))res.end(fs.readFileSync(target,'utf8').replace('<body>',
  '<body><aside data-qa-scope="native-v3" style="position:fixed;bottom:8px;right:8px;z-index:9999;pointer-events:none;background:#fef3c7;color:#78350f;padding:5px 10px;border:1px solid #d97706;border-radius:6px;font:12px sans-serif">ฐานซ้อมแยก · dbwins_worldfert9_uat_v3</aside>'));
 else fs.createReadStream(target).pipe(res);
});
front.on('upgrade',(req,socket,head)=>{
 if(!req.url.startsWith('/socket.io/')){socket.destroy();return;}
 const upstream=http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers:req.headers});
 upstream.on('upgrade',(response,remote,remoteHead)=>{
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
  if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);socket.pipe(remote).pipe(socket);
  remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());
 });
 upstream.on('error',()=>socket.destroy());upstream.end();
});
async function start(){
 await db.pools().ready;
 await assertQaAccess(db.wfQuery);
 require('../server');
 front.listen(8080,'0.0.0.0',()=>console.log('NATIVE_QA_HTTP_READY_PRIVATE_TUNNEL_ONLY REBATE='+profile.rebate));
}
start().catch(async error=>{console.error(error.message);await db.closeAll();process.exitCode=1;});
