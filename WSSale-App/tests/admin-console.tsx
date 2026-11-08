import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { UsersAccessConsole } from '../src/components/admin/UsersAccessConsole';
import { useAuthStore } from '../src/store/auth-store';
const viewer = new URLSearchParams(location.search).get('viewer') === 'manager';
useAuthStore.setState({user:{id:999,username:'fixture',role:viewer?'MANAGER':'ADMIN',roles:[viewer?'MANAGER':'ADMIN'],capabilities:{menus:['admin'],actions:viewer?[]:['users.manage','roles.manage']}} as any,isAuthenticated:true});
createRoot(document.getElementById('root')!).render(<div style={{height:'100vh'}}><UsersAccessConsole/></div>);
