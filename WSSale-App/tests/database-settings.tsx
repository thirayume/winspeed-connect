import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {SystemDatabaseSetting} from '../src/components/admin/SystemDatabaseSetting';
import {DatabaseSwitcher} from '../src/components/common/DatabaseSwitcher';
createRoot(document.getElementById('root')!).render(<main className="p-4 space-y-5"><header data-testid="database-header"><DatabaseSwitcher/></header><SystemDatabaseSetting/></main>);
