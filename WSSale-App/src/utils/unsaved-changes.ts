import { appConfirm } from '../components/ui/AppAlert';

const editors = new Set<symbol>();
export const unsavedMessage = 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้และทิ้งการแก้ไขหรือไม่?';
export function registerUnsavedEditor(id: symbol, dirty: boolean) {
  if (dirty) editors.add(id); else editors.delete(id);
}
export function hasUnsavedEditors() {
  return editors.size > 0;
}
export async function confirmLeaveEditors(): Promise<boolean> {
  return editors.size === 0 || appConfirm(unsavedMessage);
}
