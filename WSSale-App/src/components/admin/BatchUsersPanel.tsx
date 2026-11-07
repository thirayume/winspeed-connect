import { useEffect, useState } from "react";
import { req } from "../../services/api";
import type { AdminUser } from "../../types";
import type { RoleProfile } from "./RoleManagementPage";
type Credential = { id: number; username: string; password: string };
export function BatchUsersPanel({
  users,
  onDone,
  onClose,
}: {
  users: AdminUser[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [action, setAction] = useState("role"),
    [roles, setRoles] = useState<RoleProfile[]>([]),
    [roleCodes, setRoleCodes] = useState<string[]>([]),
    [roleMode, setRoleMode] = useState("add"),
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
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="จัดการผู้ใช้ที่เลือก"
      className="fixed inset-0 z-50 bg-black/40 p-4 flex justify-center items-center"
    >
      <section className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-auto space-y-4">
        <h2 className="text-xl font-bold">จัดการผู้ใช้ {users.length} คน</h2>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {result ? (
          <>
            <p role="status">สำเร็จ {result.count} คน</p>
            {result.warnings?.map((w) => (
              <p key={w} className="text-amber-700">
                {w}
              </p>
            ))}
            {result.credentials.length > 0 && (
              <>
                <p>
                  รหัสชั่วคราวแยกรายคน แสดงครั้งนี้เท่านั้น
                  ส่งให้เจ้าของบัญชีเป็นการส่วนตัว
                  ผู้ใช้ต้องเปลี่ยนรหัสก่อนใช้งาน
                </p>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>รหัสชั่วคราว</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.credentials.map((c) => (
                      <tr key={c.id}>
                        <td>{c.username}</td>
                        <td>
                          <code className="select-all">{c.password}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : (
          <>
            <ul className="max-h-40 overflow-auto border p-2">
              {users.map((u) => (
                <li key={u.Id}>
                  {u.DisplayName} (@{u.Username}) ·{" "}
                  {(u.RoleCodes || [u.RoleCode || u.Role]).join(" + ")}
                </li>
              ))}
            </ul>
            <label className="block">
              คำสั่ง
              <select
                aria-label="คำสั่ง"
                className="border rounded p-2 w-full"
                disabled={busy}
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="role">กำหนด Role</option>
                <option value="status">เปลี่ยนสถานะระบบ</option>
                <option value="reset-password">
                  รีเซ็ตรหัสผ่าน (สุ่มแยกรายคน)
                </option>
                <option value="clear-line">
                  ล้าง LINE User ID และข้อมูลการผูก
                </option>
              </select>
            </label>
            {action === "role" && (
              <fieldset className="space-y-2">
                <legend className="font-bold">กำหนดหลาย Role</legend>
                <select
                  aria-label="รูปแบบเปลี่ยน Role"
                  value={roleMode}
                  disabled={busy}
                  className="border p-2 w-full"
                  onChange={(e) => {
                    setRoleMode(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="add">เพิ่ม Role โดยคง Role เดิม</option>
                  <option value="remove">นำ Role ที่เลือกออก</option>
                  <option value="replace">
                    แทนที่ Role ทั้งหมดด้วยชุดที่เลือก
                  </option>
                </select>
                <div className="grid sm:grid-cols-2 gap-2 max-h-56 overflow-auto">
                  {roles.map((r) => (
                    <label
                      key={r.Code}
                      className="border rounded p-2 flex gap-2"
                    >
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={roleCodes.includes(r.Code)}
                        onChange={(e) => {
                          setRoleCodes(
                            e.target.checked
                              ? [...roleCodes, r.Code]
                              : roleCodes.filter((k) => k !== r.Code),
                          );
                          setConfirmed(false);
                        }}
                      />
                      {r.Name} ({r.Code})
                    </label>
                  ))}
                </div>
                <p className="text-sm">
                  สิทธิ์รวมจากทุก Role · ไม่สามารถนำ Role สุดท้ายของผู้ใช้ออกได้
                </p>
              </fieldset>
            )}
            {action === "status" && (
              <select
                disabled={busy}
                aria-label="สถานะใหม่"
                className="border p-2 w-full"
                value={String(active)}
                onChange={(e) => {
                  setActive(e.target.value === "true");
                  setConfirmed(false);
                }}
              >
                <option value="true">Active · ใช้งาน</option>
                <option value="false">Inactive · ระงับ</option>
              </select>
            )}
            <p className="text-sm">
              ทุกบัญชีที่เลือกต้องเข้าสู่ระบบใหม่หลังเปลี่ยนแปลง
              หากรายการใดไม่ผ่านจะไม่บันทึกทั้งชุด
            </p>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              ตรวจรายชื่อและยืนยันคำสั่งนี้แล้ว
            </label>
            <button
              disabled={
                busy || !confirmed || (action === "role" && !roleCodes.length)
              }
              className="bg-blue-700 text-white p-2 rounded disabled:opacity-50"
              onClick={apply}
            >
              {busy ? "กำลังดำเนินการ" : "ยืนยันดำเนินการ"}
            </button>
          </>
        )}
        <button
          className="border rounded p-2 ml-3"
          disabled={busy}
          onClick={onClose}
        >
          {result ? "ปิดผลลัพธ์" : "ยกเลิก"}
        </button>
      </section>
    </div>
  );
}
