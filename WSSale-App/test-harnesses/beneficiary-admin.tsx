import { createRoot } from 'react-dom/client';
import BeneficiaryAdminPage from '../src/components/admin/BeneficiaryAdminPage';
import { useAuthStore } from '../src/store/auth-store';
import '../src/index.css';

useAuthStore.setState({
  isAuthenticated: true,
  user: {
    id: 1,
    sub: 1,
    username: 'admin',
    displayName: 'ผู้ดูแลระบบ (Admin)',
    role: 'ADMIN',
    isActive: true,
  } as any
});

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<BeneficiaryAdminPage />);
}
