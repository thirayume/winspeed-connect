const sharp=require("sharp"); const fs=require("fs"); const path=require("path");
const dir="M:\\My Drive\\World Fert\\wf\\out\\diagram_png\\";
(async()=>{
  const files=fs.readdirSync(dir).filter(f=>/\.(png)$/i.test(f)&&!f.endsWith(".trim.png"));
  for(const f of files){
    const inp=path.join(dir,f); const out=path.join(dir,f.replace(/\.png$/i,".trim.png"));
    try{ await sharp(inp).trim({background:"#ffffff",threshold:12}).extend({top:14,bottom:14,left:14,right:14,background:"#ffffff"}).toFile(out);
      console.log("trim",f); }catch(e){ console.log("skip",f,e.message); }
  }
  console.log("done");
})();
