import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { RebateCustomersOverview } from '../src/components/rebate/RebateCustomersOverview';

createRoot(document.getElementById('root')!).render(<RebateCustomersOverview onSelect={id => {
  document.body.dataset.selectedCustomer = String(id);
}} />);
