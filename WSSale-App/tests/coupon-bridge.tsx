import React from 'react';
import {createRoot} from 'react-dom/client';
import {CouponBridgeQueue,CouponBridgeEdit,NativeBridgeCreate} from '../src/components/recon/CouponBridgePanel';
import {useAuthStore} from '../src/store/auth-store';
import {NativeOperationalAction} from '../src/components/sales/NativeOperationalAction';
const features=new URLSearchParams(location.search).get('off')?[]:['native-coupon-bridge'];
useAuthStore.setState({token:'bridge-fixture-1',user:{id:1,username:'fixture',displayName:'Fixture',role:'ADMIN',isActive:true,
 capabilities:{actions:['coupon.settle','coupon.manual116'],features,menus:[]}},isAuthenticated:true});
createRoot(document.getElementById('root')!).render(<>
 <button onClick={()=>useAuthStore.setState({token:'bridge-fixture-2'})}>Change session</button>
 <CouponBridgeQueue/><CouponBridgeEdit custId={2} coupons={[{id:3,couponNo:'C-FIXTURE'}]} onDone={()=>{}}/>
 <NativeOperationalAction soid={1} stage={116} onCreated={()=>{}}/>
 <NativeBridgeCreate requestId="11111111-1111-4111-8111-111111111111" reason="Fixture manager approved native save" onDone={()=>{}}/>
</>);
