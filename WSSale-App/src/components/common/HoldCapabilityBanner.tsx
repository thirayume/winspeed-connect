/**
 * แถบบอกว่า "Hold รถ" ในระบบนี้แปลว่าอะไรกันแน่
 *
 * ทำไมต้องมี
 *   ถ้าหน้าจอบอกลอย ๆ ว่า "รถถูก Hold" คนจะเข้าใจว่ารถหยุดแน่นอน
 *   แล้วไม่ไปห้ามรถที่ลาน ซึ่งอันตรายกว่าไม่มีฟีเจอร์นี้เลย
 *
 * 🔴 ปิดคำถามแล้ว 5 ก.ย. 2569 — ทีม TruckScale ยืนยันว่า**ไม่ได้อ่าน**
 *   `dbo.SOHD.OnHold` ซึ่งเป็นคันโยกเดียวที่เรามี
 *   ฉะนั้นไม่ว่าสวิตช์ TRUCK_HOLD_WRITE_WINSPEED จะเปิดหรือปิด
 *   **รถก็ไม่ถูกหยุดโดยอัตโนมัติ** เหลือได้แค่สองสถานะจริง ๆ คือ
 *     1. Hold เป็นการแจ้งเตือนในแอป (สวิตช์ปิด — ค่าเริ่มต้นและควรเป็นแบบนี้)
 *     2. เขียน OnHold ลง WINSpeed ด้วย แต่ก็ยังไม่มีใครอ่าน (สวิตช์เปิด)
 *   สถานะ "เครื่องชั่งหยุดตาม" ที่เคยมีในไฟล์นี้ถูกถอดออก เพราะเกิดขึ้นไม่ได้
 *
 * ข้อความมาจาก backend (`getHoldCapability()`) ไม่ได้ประกอบเองที่นี่
 * เพื่อให้ตรรกะกับถ้อยคำอยู่ที่เดียวกัน แก้ที่เดียวไม่เพี้ยน
 */
import { useEffect, useState } from 'react';
import { ShieldAlert, Info } from 'lucide-react';
import { fetchHoldCapability, type HoldCapability } from '../../services/api';

export function useHoldCapability() {
  const [cap, setCap] = useState<HoldCapability | null>(null);
  useEffect(() => {
    let alive = true;
    fetchHoldCapability()
      .then(c => { if (alive) setCap(c); })
      .catch(() => { /* ไม่ใช่ข้อมูลหลักของหน้า ล้มก็ไม่ต้องรบกวนผู้ใช้ */ });
    return () => { alive = false; };
  }, []);
  return cap;
}

/** ป้ายสั้นสำหรับติดข้างคำว่า Hold ในรายการ */
export function HoldScopeChip({ cap }: { cap: HoldCapability | null }) {
  if (!cap) return null;
  // ไม่มีกรณีสีเขียว — เครื่องชั่งไม่อ่านฟิลด์นี้ จึงไม่มีสถานะ "หยุดตาม"
  return cap.writesToWinspeed ? (
    <span
      title={cap.label}
      className="rounded border border-amber-300 bg-amber-50 px-1 py-px text-[10px] text-amber-800"
    >
      เขียน WINSpeed · เครื่องชั่งไม่อ่าน
    </span>
  ) : (
    <span
      title={cap.label}
      className="rounded border border-gray-300 bg-gray-50 px-1 py-px text-[10px] text-gray-500"
    >
      เฉพาะในแอป
    </span>
  );
}

export function HoldCapabilityBanner({ cap }: { cap: HoldCapability | null }) {
  if (!cap) return null;

  const style = cap.writesToWinspeed
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-gray-200 bg-gray-50 text-gray-700';
  const Icon = cap.writesToWinspeed ? ShieldAlert : Info;

  return (
    <div className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${style}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div>
        <b>Hold รถ:</b> {cap.label}
        <div className="mt-0.5 opacity-80">
          การหยุดรถจริงเป็นขั้นตอนของคนเสมอ — ระบบทำได้แค่แจ้งให้รู้เร็วที่สุด
          และเก็บหลักฐานว่าใครสั่ง Hold เมื่อไร ด้วยเหตุผลอะไร
        </div>
      </div>
    </div>
  );
}
