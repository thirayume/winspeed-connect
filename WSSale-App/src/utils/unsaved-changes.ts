const editors = new Set<symbol>();
export const unsavedMessage = 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้และทิ้งการแก้ไขหรือไม่?';
export function registerUnsavedEditor(id: symbol, dirty: boolean) {
  if (dirty) editors.add(id); else editors.delete(id);
}
export function confirmLeaveEditors() {
  return editors.size === 0 || window.confirm(unsavedMessage);
}
