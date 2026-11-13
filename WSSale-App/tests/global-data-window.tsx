import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {GlobalDataWindowSetting} from '../src/components/admin/GlobalDataWindowSetting';
createRoot(document.getElementById('root')!).render(<GlobalDataWindowSetting/>);
