import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { RebateConversionRequests } from '../src/components/rebate/RebateConversionRequests';
import { useAuthStore } from '../src/store/auth-store';
useAuthStore.setState({ user: { id:1, username:'fixture', displayName:'Fixture', role:'SALES', isActive:true }, isAuthenticated:true });
createRoot(document.getElementById('root')!).render(<RebateConversionRequests
  customers={[{value:'7',label:'ลูกค้าตัวอย่าง'}]} goods={[{value:'3',label:'ปุ๋ยตัวอย่าง'}]} />);
