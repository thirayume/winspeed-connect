import {SalesPortal} from '../src/components/sales/SalesPortal';
import {useTripStore} from '../src/store/trip-store';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TripSummaryModal} from '../src/components/sales/TripSummaryModal';
import {TripSetupModal} from '../src/components/sales/TripSetupModal';
function Harness(){
 const [open,setOpen]=useState(false),[tick,setTick]=useState(0),[result,setResult]=useState('');
 return <><button onClick={()=>setOpen(true)}>Open editor</button><button onClick={()=>setTick(tick+1)}>Parent rerender</button><output>{result}</output><span data-testid="tick">{tick}</span>
 <TripSetupModal isOpen={open} onClose={()=>setOpen(false)} onConfirm={data=>{setResult(JSON.stringify(data));setOpen(false);}}
 initialData={{tripId:42,expectedRevision:7,truckPlate:'ตั๋วคุม',deliveryDate:'2026-10-07'}} /></>;
}
const trip = {tripId:42,tripCode:'TEST-42',dateDisplay:'2026-10-08',cust:'TEST',truck:'UAT-42',totalAmt:150000,totalTon:10,
 orders:[{id:123,tripId:42,wfRef:'I69-TEST',status:'DRAFT',custId:'1001',custName:'TEST',deliveryDate:'2026-10-08',remark:'BILL-ONLY',lines:[{goodId:'1',goodName:'TEST',qtyTon:10,pricePerTon:15000,loadSequence:1,masterQty:6,childQty:4}]}]};
if(location.search.includes('portal')) useTripStore.getState().setTrip({tripId:42,truckPlate:'OLD-42',deliveryDate:'2026-10-08'});
createRoot(document.getElementById('root')!).render(location.search.includes('portal') ? <SalesPortal/> : location.search.includes('summary') ? <TripSummaryModal isOpen onClose={()=>{}} trip={trip as any}/> : <Harness/>);
