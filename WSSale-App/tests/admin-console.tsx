import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { UsersAccessConsole } from '../src/components/admin/UsersAccessConsole';
import { useAuthStore } from '../src/store/auth-store';
const viewer = new URLSearchParams(location.search).get('viewer');
const role=viewer==='manager'?'MANAGER':viewer==='c-level'?'C_LEVEL':'ADMIN';
useAuthStore.setState({user:{id:999,username:'fixture',role,roles:[role],capabilities:{menus:['admin'],actions:role==='ADMIN'?['users.manage','roles.manage']:[]}} as any,isAuthenticated:true});
createRoot(document.getElementById('root')!).render(<div style={{height:'100vh'}}><UsersAccessConsole/></div>);
