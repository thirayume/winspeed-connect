import { useEffect, useState } from "react";
import { RolePicker } from "./RolePicker";
import { req } from "../../services/api";
import type { AdminUser } from "../../types";
import type { RoleProfile } from "./RoleManagementPage";
export type BatchUser = Pick<AdminUser, "Id" | "Username" | "DisplayName"> &
  Partial<Pick<AdminUser, "Role" | "RoleCode" | "RoleCodes">>;
type Credential = { id: number; username: string; password: string };
export function BatchUsersPanel({
  users,
  onDone,
  onClose,
  initialRoleCodes = [],
  initialRoleMode = "add",
}: {
  users: BatchUser[];
  onDone: () => void;
  onClose: () => void;
  initialRoleCodes?: string[];
  initialRoleMode?: "add" | "remove" | "replace";
}) {
  const [action, setAction] = useState("role"),
    [roles, setRoles] = useState<RoleProfile[]>([]),
    [roleCodes, setRoleCodes] = useState<string[]>(initialRoleCodes),
    [roleMode, setRoleMode] = useState(initialRoleMode),
    [active, setActive] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<{
      count: number;
      credentials: Credential[];
      warnings?: string[];
    } | null>(null);
  useEffect(() => {
    req<{ roles: RoleProfile[] }>("/admin-management/roles")
      .then((r) => setRoles(r.roles))
      .catch((e) => setError(e.message));
  }, []);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await req<{
        count: number;
        credentials: Credential[];
        warnings?: string[];
      }>("/admin-management/users/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: users.map((u) => u.Id),
          action,
          roleCodes,
          roleMode,
          isActive: active,
        }),
      });
      setResult(r);
      onDone();
    } catch (e) {
      const msg = (e as Error).message || "เกิดข้อผิดพลาดในการประมวลผล";
      if (
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError")
      ) {
        setError(
          "การเชื่อมต่อขัดข้อง ไม่สามารถยืนยันผลได้ กรุณาตรวจสถานะผู้ใช้และประวัติก่อนทำซ้ำ (ไม่แนะนำให้ทำซ้ำทันที)",
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="จัดการผู้ใช้ที่เลือก"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs p-4 flex justify-center items-center"
    >
      <section className="bg-white rounded-2xl p-6 sm:p-7 w-full max-w-5xl sm:max-w-6xl max-h-[92vh] overflow-auto space-y-5 shadow-2xl border border-slate-200">
        <h2 className="text-xl font-bold text-[#0C447C]">จัดการผู้ใช้แบบกลุ่ม ({users.length} คน)</h2>
        {error && (
          <p role="alert" className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-medium">
            {error}
          </p>
        )}
        {result ? (
          <div className="space-y-4">
            <p role="status" className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-sm font-semibold">
              ✓ ดำเนินการสำเร็จ {result.count} คน
            </p>
            {result.warnings?.map((w) => (
              <p key={w} className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs">
                ⚠️ {w}
              </p>
            ))}
            {result.credentials.length > 0 && (
              <div className="space-y-2 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <p className="text-xs text-slate-600 font-medium">
                  * รหัสชั่วคราวแยกรายคน แสดงครั้งนี้เท่านั้น โปรดส่งให้เจ้าของบัญชีเป็นการส่วนตัว ผู้ใช้ต้องเปลี่ยนรหัสก่อนเริ่มใช้งาน
                </p>
                <div className="overflow-auto max-h-60 border border-slate-200 rounded-lg bg-white">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="p-2.5 font-semibold">Username</th>
                        <th className="p-2.5 font-semibold">รหัสผ่านชั่วคราว</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.credentials.map((c) => (
                        <tr key={c.id}>
                          <td className="p-2.5 font-medium text-slate-800">{c.username}</td>
                          <td className="p-2.5">
                            <code className="select-all px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-xs border border-slate-200">
                              {c.password}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <button
                className="px-5 py-2 bg-[#0C447C] hover:bg-[#0a3866] text-white text-sm font-semibold rounded-xl shadow-xs transition-colors"
                disabled={busy}
                onClick={onClose}
              >
                ปิดผลลัพธ์
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70">
              <div className="text-xs font-semibold text-slate-500 mb-2">รายชื่อผู้ใช้ที่เลือก ({users.length} คน):</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto pr-1">
                {users.map((u) => {
                  const userRoles = (Array.isArray(u.RoleCodes) && u.RoleCodes.length > 0) ? u.RoleCodes : [u.RoleCode || u.Role].filter(Boolean);
                  return (
                    <div key={u.Id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs shadow-2xs">
                      <div className="truncate min-w-0 pr-1">
                        <b className="text-slate-800 block truncate">{u.DisplayName}</b>
                        <span className="text-[11px] text-slate-400 font-mono">@{u.Username}</span>
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-[#0C447C] border border-blue-200">
                        {userRoles.join(", ") || "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              คำสั่งที่ต้องการดำเนินการ
              <select
                aria-label="คำสั่ง"
                className="mt-1 border border-slate-200 rounded-xl p-2.5 w-full bg-white text-sm"
                disabled={busy}
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="role">กำหนด Role (Multi-Role)</option>
                <option value="status">เปลี่ยนสถานะระบบ (Active / Inactive)</option>
                <option value="reset-password">
                  รีเซ็ตรหัสผ่าน (สุ่มแยกรายคน)
                </option>
                <option value="clear-line">
                  ล้าง LINE User ID และข้อมูลการผูก
                </option>
              </select>
            </label>

            {action === "role" && (
              <fieldset className="space-y-3 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                <legend className="font-bold text-sm text-[#0C447C] px-1">กำหนดหลาย Role</legend>
                <label className="block text-xs font-medium text-slate-600">
                  รูปแบบการปรับปรุงบทบาท
                  <select
                    aria-label="รูปแบบเปลี่ยน Role"
                    value={roleMode}
                    disabled={busy}
                    className="mt-1 border border-slate-200 rounded-xl p-2 w-full bg-white text-sm"
                    onChange={(e) => {
                      setRoleMode(e.target.value as "add" | "remove" | "replace");
                      setConfirmed(false);
                    }}
                  >
                    <option value="add">เพิ่ม Role โดยคง Role เดิม (Add)</option>
                    <option value="remove">นำ Role ที่เลือกออก (Remove)</option>
                    <option value="replace">
                      แทนที่ Role ทั้งหมดด้วยชุดที่เลือก (Replace)
                    </option>
                  </select>
                </label>
                <RolePicker
                  roles={roles}
                  value={roleCodes}
                  disabled={busy}
                  onChange={(codes) => {
                    setRoleCodes(codes);
                    setConfirmed(false);
                  }}
                />
                <p className="text-xs text-slate-500">
                  * ผู้ใช้จะได้รับสิทธิ์รวมจากทุก Role ที่เลือก · ไม่สามารถนำ Role สุดท้ายของผู้ใช้ออกได้
                </p>
              </fieldset>
            )}

            {action === "status" && (
              <label className="block text-sm font-medium text-slate-700">
                สถานะใหม่
                <select
                  disabled={busy}
                  aria-label="สถานะใหม่"
                  className="mt-1 border border-slate-200 rounded-xl p-2.5 w-full bg-white text-sm"
                  value={String(active)}
                  onChange={(e) => {
                    setActive(e.target.value === "true");
                    setConfirmed(false);
                  }}
                >
                  <option value="true">Active · เปิดใช้งานบัญชี</option>
                  <option value="false">Inactive · ระงับการใช้งานบัญชี</option>
                </select>
              </label>
            )}

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
              <p className="font-medium">⚠️ ข้อควรทราบก่อนดำเนินการ:</p>
              <p>• ทุกบัญชีที่ถูกเปลี่ยนแปลงบทบาทหรือสถานะ จะถูกเพิกถอน Session เดิมและต้องเข้าสู่ระบบใหม่</p>
              <p>• คำสั่งทำงานเป็น Transaction เดียว หากรายการใดไม่ผ่าน ระบบจะยกเลิกการเปลี่ยนแปลงทั้งหมด (Fail-Closed)</p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-[#0C447C]"
              />
              <span className="text-sm font-medium text-slate-800">
                ตรวจรายชื่อผู้ใช้ {users.length} คนและยืนยันคำสั่งนี้แล้ว
              </span>
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold hover:bg-slate-50 text-slate-600 transition-colors"
                disabled={busy}
                onClick={onClose}
              >
                ยกเลิก
              </button>
              <button
                disabled={
                  busy || !confirmed || (action === "role" && !roleCodes.length)
                }
                className="px-5 py-2 bg-[#0C447C] hover:bg-[#0a3866] text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-40 transition-all"
                onClick={apply}
              >
                {busy ? "กำลังดำเนินการ…" : "ยืนยันดำเนินการ"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
