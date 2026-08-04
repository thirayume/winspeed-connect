import { useState } from 'react';
import { Lock, LogOut, ShieldAlert } from 'lucide-react';
import { req } from '../../services/api';
import { useAuthStore } from '../../store/auth-store';

/**
 * หน้าบังคับเปลี่ยนรหัสผ่าน — ขึ้นแทนทั้งแอปทันทีที่ล็อกอินด้วยบัญชีที่ยังใช้รหัสตั้งต้น
 *
 * ไม่ใช้แถบเตือนอย่างเดียวเพราะแถบเตือนไม่ได้ลดความเสี่ยงลงเลย เพียงย้ายว่าใครรับผิด
 * ตราบใดที่หลายคนใช้รหัสเดียวกัน ชื่อผู้อนุมัติในหลักฐาน 4 ชั้นก็ไม่ได้พิสูจน์ว่าใครทำจริง
 *
 * ยังออกจากระบบได้ เผื่อเข้าผิดบัญชี — แต่ไปหน้าอื่นของแอปไม่ได้จนกว่าจะเปลี่ยนรหัส
 * ฝั่งเซิร์ฟเวอร์บล็อกคำสั่งเขียนไว้อีกชั้นอยู่แล้ว หน้านี้จึงเป็นการบอกทางออก
 * ไม่ใช่ตัวป้องกันเพียงอย่างเดียว
 */
export default function ForcePasswordChange() {
  const { user, login, logout } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร'); return; }
    if (newPassword === oldPassword) { setError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม'); return; }
    if (newPassword !== confirmPassword) { setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'); return; }

    setLoading(true);
    try {
      const r = await req<{ ok: boolean; accessToken?: string; user?: any }>('/auth/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      // token เดิมยังบอกว่าต้องเปลี่ยนรหัส เซิร์ฟเวอร์จึงยังบล็อกการเขียนอยู่
      // ต้องรับใบใหม่มาใช้ทันที ไม่งั้นผู้ใช้จะติดค้างที่หน้านี้ทั้งที่ทำถูกแล้ว
      if (r?.accessToken && r?.user) login(r.accessToken, r.user);
      else logout();
    } catch (err: unknown) {
      setError((err as Error).message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#0C447C]/20 outline-none';

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#F1EFE8] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-4 flex items-start gap-3">
          <ShieldAlert size={22} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-amber-900">ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน</div>
            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
              บัญชีนี้ยังใช้รหัสผ่านตั้งต้นที่ซ้ำกับผู้ใช้อื่นในระบบ
              ตราบใดที่ยังไม่เปลี่ยน ชื่อผู้ทำรายการในหลักฐานการอนุมัติจะยังไม่ยืนยันว่าเป็นตัวคุณ
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          <div className="text-xs text-gray-500">
            เข้าระบบเป็น <span className="font-semibold text-gray-700">{user?.displayName || user?.username}</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">รหัสผ่านเดิม</label>
            <input type="password" autoComplete="current-password" className={field}
              value={oldPassword} onChange={e => setOldPassword(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
            <input type="password" autoComplete="new-password" className={field}
              value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">ยืนยันรหัสผ่านใหม่</label>
            <input type="password" autoComplete="new-password" className={field}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#0C447C] text-white font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 disabled:opacity-40">
            <Lock size={16} /> {loading ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่านและเข้าใช้งาน'}
          </button>

          <button type="button" onClick={logout}
            className="w-full flex items-center justify-center gap-2 text-gray-500 text-xs py-1.5 hover:text-gray-700">
            <LogOut size={14} /> ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  );
}
