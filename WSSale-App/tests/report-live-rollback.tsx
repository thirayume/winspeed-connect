// Real login and Budget Plan components. The private test runner supplies a
// loopback API backed by SQL in a rollback transaction or disposable QA database, without API mocks.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import LoginPage from '../src/pages/LoginPage';
import {BudgetPlanPage} from '../src/components/reports/BudgetPlanPage';
import {useAuthStore} from '../src/store/auth-store';
import {getMe} from '../src/services/api';
function Acceptance(){
 const authenticated=useAuthStore(s=>s.isAuthenticated),user=useAuthStore(s=>s.user);
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!authenticated){setReady(false);return;}getMe().then(u=>{const auth=useAuthStore.getState();auth.login(auth.token!,u);setReady(true);}).catch(e=>setError(e.message));},[authenticated]);
 if(!authenticated)return <LoginPage/>;
 if(error)return <p role="alert">{error}</p>;
 if(!ready)return <p>กำลังตรวจสิทธิ์จากฐานซ้อม</p>;
 return <><div className="p-2 bg-amber-100" data-testid="qa-identity">ฐานซ้อม · {user?.role}</div><BudgetPlanPage/></>;
}
createRoot(document.getElementById('root')!).render(<Acceptance/>);
