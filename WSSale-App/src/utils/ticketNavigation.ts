export function ticketMenuAccess(menus: string[] | undefined, role: string | undefined) {
  return {
    control: menus ? menus.includes('control-ticket') : ['C_LEVEL','ADMIN','ACCOUNTING','WAREHOUSE','SALES'].includes(role||''),
    hierarchy: menus ? menus.includes('voucher') : ['C_LEVEL','ADMIN','MANAGER','ACCOUNTING','SALES','COUNTER_SALES'].includes(role||''),
  };
}
