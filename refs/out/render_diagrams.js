// Split multi-page .drawio → per-page viewer HTML (drawio viewer renders exact XML)
const fs=require("fs");
const src=fs.readFileSync("M:\\My Drive\\World Fert\\WorldFert_Diagrams_v4.drawio","utf8");
const outDir="M:\\My Drive\\World Fert\\wf\\out\\diagram_html\\";
fs.mkdirSync(outDir,{recursive:true});
// extract each <diagram ...>...</diagram>
const diags=[...src.matchAll(/<diagram[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/diagram>/g)];
diags.forEach((m,i)=>{
  const name=m[1];
  // build a single-page mxfile for this diagram
  const single=`<mxfile host="app.diagrams.net">${m[0]}</mxfile>`;
  const json=JSON.stringify({highlight:"#1F3864",nav:false,resize:true,toolbar:null,edit:null,xml:single});
  // canonical drawio embed escaping for a double-quoted HTML attribute
  const attr=json.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}</style></head><body>
<div class="mxgraph" style="max-width:100%;border:0;" data-mxgraph="${attr}"></div>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script></body></html>`;
  const fn=String(i+1).padStart(2,"0");
  fs.writeFileSync(outDir+`d${fn}.html`,html,"utf8");
  console.log(`d${fn}.html  ←  ${name}`);
});
console.log("total "+diags.length);
