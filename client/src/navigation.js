import { useEffect, useState } from 'react';
export const paths = {
  dashboard:'/dashboard',suppliers:'/suppliers',components:'/components',inventory:'/components/inventory',
  purchases:'/purchases',productsBom:'/products',manufacturing:'/manufacturing/orders',sales:'/sales',
  damaged:'/damaged',maintenance:'/maintenance/request',shortage:'/shortages',reports:'/reports',
  settings:'/settings',printers:'/printers/sell',productSales:'/sales/products',
};
export function navigate(path) {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState({},'',path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function useLocation() {
  const read = () => window.location.pathname + window.location.search;
  const [location,setLocation] = useState(read);
  useEffect(() => {
    const update=()=>setLocation(read());
    window.addEventListener('popstate',update);
    return ()=>window.removeEventListener('popstate',update);
  },[]);
  return location;
}
export function tabForLocation(location) {
  const path=location.split('?')[0];
  if (path.startsWith('/manufacturing/')) return 'manufacturing';
  if (path.startsWith('/maintenance/')) return 'maintenance';
  if (path.startsWith('/printers/')) return 'printers';
  if (path.startsWith('/settings/')) return 'settings';
  return Object.keys(paths).find(key=>paths[key]===path) || 'dashboard';
}
export function useStage(mapping, fallback) {
  const location=useLocation();
  const stage=Object.keys(mapping).find(key=>mapping[key]===location.split('?')[0]) || fallback;
  return [stage,(value)=>navigate(mapping[value])];
}
