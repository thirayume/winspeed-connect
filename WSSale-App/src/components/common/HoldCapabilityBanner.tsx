/**
 * แถบบอกว่า "Hold รถ" ในระบบนี้แปลว่าอะไรกันแน่
 *
 * ทำไมต้องมี
 *   คำว่า Hold มีสามความหมายที่ต่างกันมาก และคนใช้งานต้องรู้ว่าตอนนี้อยู่แบบไหน
 *     1. ธงฝั่งแอปเท่านั้น       — คนคุมลานเห็น แต่ระบบไม่ได้หยุดอะไร
 *     2. ส่งถึง WINSpeed แล้ว    — ตั้ง dbo.SOHD.OnHold='Y' แต่ยังไม่รู้ว่าเครื่องชั่งสนใจไหม
 *     3. ยืนยันแล้วว่าหยุดจริง   — ทดสอบกับรถจริงแล้ว
 *
 *   ถ้าหน้าจอบอกลอย ๆ ว่า "รถถูก Hold" ในแบบที่ 1 หรือ 2 คนจะเข้าใจว่ารถหยุดแน่
 *   แล้วไม่ไปห้ามรถที่ลาน ซึ่งอันตรายกว่าไม่มีฟีเจอร์นี้เลย
 *
 * ข้อความมาจาก backend (`getHoldCapability()`) ไม่ได้ประกอบเองที่นี่
 * เพื่อให้ตรรกะกับถ้อยคำอยู่ที่เดียวกัน แก้ที่เดียวไม่เพี้ยน
 */
import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, Info } from 'lucide-react';
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
  if (!cap.writesToWinspeed) {
    return (
      <span
        title={cap.label}
        className="rounded border border-gray-300 bg-gray-50 px-1 py-px text-[10px] text-gray-500"
      >
        เฉพาะในแอป
      </span>
    );
  }
  if (!cap.verifiedOnRealTruck) {
    return (
      <span
        title={cap.label}
        className="rounded border border-amber-300 bg-amber-50 px-1 py-px text-[10px] text-amber-800"
      >
        ส่งถึง WINSpeed · ยังไม่ยืนยัน
      </span>
    );
  }
  return (
    <span
      title={cap.label}
      className="rounded border border-emerald-300 bg-emerald-50 px-1 py-px text-[10px] text-emerald-800"
    >
      เครื่องชั่งหยุดตาม
    </span>
  );
}

export function HoldCapabilityBanner({ cap }: { cap: HoldCapability | null }) {
  if (!cap) return null;

  const verified = cap.writesToWinspeed && cap.verifiedOnRealTruck;
  const style = verified
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : cap.writesToWinspeed
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-gray-200 bg-gray-50 text-gray-700';
  const Icon = verified ? ShieldCheck : cap.writesToWinspeed ? ShieldAlert : Info;

  return (
    <div className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${style}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div>
        <b>Hold รถ:</b> {cap.label}
        {!verified && (
          <div className="mt-0.5 opacity-80">
            {cap.writesToWinspeed
              ? 'ยังต้องมีคนที่ลานห้ามรถอยู่ จนกว่าจะทดสอบกับรถจริงแล้วบันทึกผล'
              : 'การหยุดรถจริงยังเป็นขั้นตอนของคน ระบบทำได้แค่แจ้งให้รู้เร็วที่สุด'}
          </div>
        )}
      </div>
    </div>
  );
}
