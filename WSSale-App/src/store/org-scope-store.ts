import {create} from 'zustand';
export const useOrgScopeStore=create<{branch:string;setBranch:(branch:string)=>void}>(set=>({branch:'',setBranch:branch=>set({branch})}));
