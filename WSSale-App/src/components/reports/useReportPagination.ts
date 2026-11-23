import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReportData,ResolvedReportTemplateDto} from '../../services/api';

/** Reserve space for actual headers, context, wrapped rows and footer before printing. */
export function useReportPagination(data:ReportData,template:ResolvedReportTemplateDto|null,pageHeight:number,defaultLimit:number){
 const areaRef=useRef<HTMLDivElement>(null);
 const [layout,setLayout]=useState<{data:ReportData;template:ResolvedReportTemplateDto|null;limits:Record<number,number>}>({data,template,limits:{}});
 const limits=useMemo(()=>layout.data===data&&layout.template===template?layout.limits:{},[layout,data,template]);
 const pages=useMemo(()=>{
  const result:ReportData['rows'][]=[];
  for(let offset=0;offset<data.rows.length;){const limit=limits[result.length]||defaultLimit;result.push(data.rows.slice(offset,offset+limit));offset+=limit;}
  return result.length?result:[[]];
 },[data,limits,defaultLimit]);
 const measure=useCallback(()=>{
  const elements=areaRef.current?.querySelectorAll<HTMLElement>('.report-page');if(!elements)return;
  const available=(pageHeight-16)*96/25.4-2,next={...limits};let changed=false;
  elements.forEach((element,index)=>{
   const count=pages[index]?.length||0,style=getComputedStyle(element),px=(value:string)=>parseFloat(value)||0;
   // Ignore the preview's minimum height and flex auto-margin. They are blank
   // space, especially on smaller paper, rather than content needing another page.
   const height=px(style.paddingTop)+px(style.paddingBottom)+px(style.borderTopWidth)+px(style.borderBottomWidth)
    +Array.from(element.children).reduce((sum,child)=>{const css=getComputedStyle(child);return sum+child.getBoundingClientRect().height+(child.classList.contains('mt-auto')?0:px(css.marginTop))+px(css.marginBottom);},0);
   if(count>1&&height>available+3){
    const table=element.querySelector<HTMLElement>('[data-report-rows]'),perRow=Math.max(20,(table?.getBoundingClientRect().height||count*30)/count);
    next[index]=Math.max(1,count-Math.max(1,Math.ceil((height-available)/perRow)));changed=true;
   }
  });
  if(changed)setLayout({data,template,limits:next});
 },[data,template,limits,pages,pageHeight]);
 useLayoutEffect(measure,[measure]);
 useEffect(()=>{
  let active=true;document.fonts?.ready.then(()=>{if(active)measure();});
  window.addEventListener('resize',measure);window.addEventListener('beforeprint',measure);
  const media=window.matchMedia('print');media.addEventListener('change',measure);
  return()=>{active=false;window.removeEventListener('resize',measure);window.removeEventListener('beforeprint',measure);media.removeEventListener('change',measure);};
 },[measure]);
 return {pages,areaRef};
}
