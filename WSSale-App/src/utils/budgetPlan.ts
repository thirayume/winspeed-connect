export type BudgetParticipant={name:string;role:string;dept:string};
export type BudgetCustomer={custCode:string;custName:string;note:string};
export type BudgetProject={key:string;title:string;category:string;refDoc:string;region:string;budgetAmount:string;validFrom:string;validTo:string;objective:string;goodCodePattern:string;returnType:string;netPrice:string;note:string;internalParticipants:BudgetParticipant[];externalParticipants:BudgetCustomer[]};
export type BudgetLine={projectKey:string;region:string;category:string;itemName:string;quantity:string;unitPrice:string;amount:string;note:string};
export type BudgetForm={periodYear:number;channel:string;title:string;note:string;assignedReviewerId:string;assignedApproverId:string;allocations:{region:string;amount:string}[];document:{version:1;projects:BudgetProject[]};lines:BudgetLine[]};
export const budgetCategories=['งบจัดเลี้ยงรับรองลูกค้าประจำเขตการขาย','งบท่องเที่ยว/ดูงานต่างประเทศสำหรับพนักงาน','งบท่องเที่ยว/สัมมนาลูกค้า VIP ประจำปี','งบกิจกรรมส่งเสริมการขาย/สัมมนาตัวแทนจำหน่าย','งบสนับสนุนการขายและส่วนลดส่งเสริมการขาย','งบศึกษาดูงานและอบรมพัฒนาทีมงาน','อื่นๆ'];
export const beYear=(n:number)=>n<2400?n+543:n;
export const newProject=(year:number,key='P1'):BudgetProject=>({key,title:'',category:budgetCategories[0],refDoc:'',region:'ALL',budgetAmount:'',validFrom:`${beYear(year)-543}-01-01`,validTo:`${beYear(year)-543}-12-31`,objective:'',goodCodePattern:'',returnType:'NONE',netPrice:'',note:'',internalParticipants:[],externalParticipants:[]});
export const budgetForm=(year:number):BudgetForm=>({periodYear:beYear(year),channel:'ทั่วไป',title:'แผนงบส่งเสริมการขายรายปี',note:'',assignedReviewerId:'',assignedApproverId:'',allocations:[],document:{version:1,projects:[newProject(year)]},lines:[]});
export function readBudgetForm(p:any):BudgetForm{
 const source=p.document||(p.DocumentJson?JSON.parse(p.DocumentJson):{version:1,projects:[]});
 const allocations=(p.allocations||[]).map((a:any)=>({region:a.Region,amount:String(a.Amount)}));
 const old=!source.projects?.length;
 const projects=old?[{...newProject(Number(p.PeriodYear),'ANNUAL'),title:p.Title||'แผนเดิม',budgetAmount:''}]:source.projects.map((v:any)=>({...v,budgetAmount:String(v.budgetAmount),netPrice:v.netPrice==null?'':String(v.netPrice)}));
 return {periodYear:beYear(Number(p.PeriodYear)),channel:p.Channel,title:p.Title||'',note:p.Note||'',assignedReviewerId:String(p.AssignedReviewerId||''),assignedApproverId:String(p.AssignedApproverId||''),allocations,document:{version:1,projects},lines:(p.lines||[]).map((l:any)=>({projectKey:l.ProjectKey||(old?'ANNUAL':''),region:l.Region,category:l.Category,itemName:l.ItemName,quantity:l.Quantity==null?'':String(l.Quantity),unitPrice:l.UnitPrice==null?'':String(l.UnitPrice),amount:String(l.Amount),note:l.Note||''}))};
}
export type BudgetReportProject=Omit<BudgetProject,'budgetAmount'|'netPrice'> & {budgetAmount:number|null;netPrice:number|null};
