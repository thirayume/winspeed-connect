import {createRoot} from 'react-dom/client';
import {useAuthStore} from '../src/store/auth-store';
import {GiveawayQuotaLoansPanel} from '../src/components/giveaway/GiveawayQuotaLoansPanel';
import '../src/index.css';
function login(id:number){useAuthStore.setState({user:{id,username:`fixture-${id}`,displayName:'Fixture',role:'SALES',isActive:true,
 capabilities:{menus:['giveaway'],actions:['giveaway.borrow']}},isAuthenticated:true});}
login(2);
createRoot(document.getElementById('root')!).render(<>
 <button onClick={()=>login(1)}>ฝ่ายขายผู้ให้ยืม</button><button onClick={()=>login(2)}>ฝ่ายขายผู้ยืม</button>
 <GiveawayQuotaLoansPanel />
</>);
