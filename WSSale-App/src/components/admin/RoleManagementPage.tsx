import { useEffect, useState } from "react";
import { Plus, Save, Shield, History, Trash2 } from "lucide-react";
import { RoleMembers } from "./RoleMembers";
import { req } from "../../services/api";
export type RoleProfile = {
  Code: string;
  Name: string;
  BaseRole: string;
  permissions: string[];
  MemberCount?: number;
  Revision: number;
};
type Catalog = {
  roles: RoleProfile[];
  actions: Record<string, string[]>;
  menus: Record<string, string[]>;
  editable: string[];
};
type AuditEntry = {
  Id: number;
  ActorId: number;
  Action: string;
  Target: string;
  Detail: string;
  CreatedAt: string;
};
const auditNames: Record<string, string> = {
  ROLE_SAVE: "บันทึก Role",
  BATCH_role: "เปลี่ยน Role",
  BATCH_status: "เปลี่ยนสถานะ",
  "BATCH_reset-password": "รีเซ็ตรหัสผ่าน",
  "BATCH_clear-line": "ล้างการผูก LINE",
};
const names: Record<string, string> = {
  "so.create": "สร้างบิลขาย",
  "so.edit": "แก้ไขบิลขาย",
  "so.cancel": "ยกเลิกบิล",
  "so.verify": "ตรวจบิล",
  "so.confirm": "ยืนยันบิล",
  "so.approve-native": "อนุมัติ AI",
  "so.create-native-delivery": "ออกใบสั่งขาย 104",
  "credit.approve-native": "อนุมัติเกินวงเงิน",
  "coupon.manual116": "ตัดตั๋ว 116",
  "invoice.post-native": "Post Invoice 107",
  "native.print-104": "พิมพ์ 104",
  "native.print-116": "พิมพ์ 116",
  "native.print-107": "พิมพ์ 107",
  "trip.view": "ดูเที่ยวรถ",
  "quotation.create": "สร้างใบเสนอราคา",
  "quotation.manage": "จัดการใบเสนอราคา",
  "coupon.settle": "ตัดยอดตั๋ว",
  "giveaway.budget": "จัดการงบของแถม",
  "roles.manage": "จัดการ Role และสมาชิก",
  "settings.manage": "ตั้งค่าแอปและผลตรวจรับ",
  "users.manage": "จัดการผู้ใช้",
  "access-as": "ทำรายการแทน",
  "database.switch": "สลับฐานใน session",
  "database.set-system": "ตั้งฐานระบบ",
  "giveaway.borrow": "ขอเบิกของแถม",
  "edit-request.create": "ขอแก้ไขเอกสาร",
};
export function RoleManagementPage() {
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<"permissions" | "members">("permissions");
  const [data, setData] = useState<Catalog | null>(null),
    [form, setForm] = useState<RoleProfile | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<AuditEntry[] | null>(null);
  async function load() {
    try {
      setData(await req<Catalog>("/admin-management/roles"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      await req("/admin-management/roles/" + form.Code, {
        method: "PUT",
        body: JSON.stringify({
          code: form.Code,
          name: form.Name,
          baseRole: form.BaseRole,
          permissions: form.permissions,
          expectedRevision: form.Revision,
        }),
      });
      setNotice(
        "บันทึก Role แล้ว มีผลกับ API ในคำขอถัดไป ผู้ใช้โหลดหน้าใหม่เพื่อปรับเมนู",
      );
      setForm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="h-full overflow-auto p-4 sm:p-6 bg-[#F1EFE8] space-y-4">
      <h1 className="text-2xl font-bold text-[#0C447C] flex gap-2">
        <Shield /> Role Management
      </h1>
      <p>
        สร้าง Role จากบทบาทต้นแบบ ขอบเขตข้อมูลและกติกาอนุมัติใช้ตามต้นแบบ
        เลือกเปิด/ปิดสิทธิ์งานที่ระบบรองรับ
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-700">
          {notice}
        </p>
      )}
      <div className="flex gap-3">
        <button
          aria-label="เพิ่ม Role"
          title="เพิ่ม Role"
          className="action-add p-2 rounded-lg"
          onClick={() => {
            setEditing(false);
            setView("permissions");
            setForm({
              Code: "",
              Name: "",
              BaseRole: "SALES",
              permissions: Object.entries(data?.actions || {})
                .filter(([, rs]) => rs.includes("SALES"))
                .map(([k]) => k),
              Revision: 0,
            });
          }}
        >
          <Plus />
        </button>
        <button
          onClick={async () => {
            try {
              setHistory(await req<AuditEntry[]>("/admin-management/history"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          className="flex items-center gap-2"
        >
          <History /> ประวัติ
        </button>
      </div>
      <div className="grid md:grid-cols-[260px_1fr] gap-4">
        <div className="bg-white rounded-xl p-3 space-y-2">
          {data?.roles.map((p) => (
            <button
              key={p.Code}
              className="block text-left w-full p-3 rounded-lg hover:bg-blue-50 border"
              onClick={() => {
                setEditing(true);
                setView("permissions");
                setForm({ ...p });
                setError("");
              }}
            >
              <b>{p.Name}</b>
              <small className="block">
                {p.Code} · ต้นแบบ {p.BaseRole} · สมาชิก {p.MemberCount || 0} คน
              </small>
            </button>
          ))}
        </div>
        {form && data && (
          <div className="bg-white p-5 rounded-xl space-y-4">
            {editing && (
              <div className="flex justify-end">
                <button
                  title="ลบ Role"
                  aria-label="ลบ Role"
                  className="action-delete p-2 disabled:opacity-40"
                  disabled={busy || Boolean(form.MemberCount)}
                  onClick={async () => {
                    if (!window.confirm(`ลบ Role ${form.Name}?`)) return;
                    setBusy(true);
                    setError("");
                    try {
                      await req("/admin-management/roles/" + form.Code, {
                        method: "DELETE",
                        body: JSON.stringify({
                          expectedRevision: form.Revision,
                        }),
                      });
                      setForm(null);
                      setNotice("ลบ Role แล้ว");
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={20} />
                </button>
              </div>
            )}
            {editing && Boolean(form.MemberCount) && (
              <p className="text-sm text-amber-800">
                ย้ายสมาชิกทั้งหมด รวมผู้ใช้ที่ปิดใช้งาน ก่อนลบ Role
              </p>
            )}
            <label className="block">
              รหัส Role
              <input
                aria-label="รหัส Role"
                disabled={editing || busy}
                className="border p-2 block w-full"
                value={form.Code}
                onChange={(e) =>
                  setForm({ ...form, Code: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label className="block">
              ชื่อ Role
              <input
                className="border p-2 block w-full"
                value={form.Name}
                maxLength={100}
                onChange={(e) => setForm({ ...form, Name: e.target.value })}
              />
            </label>
            <label className="block">
              บทบาทต้นแบบ
              <select
                aria-label="บทบาทต้นแบบ"
                className="border p-2 block w-full"
                disabled={editing || busy}
                value={form.BaseRole}
                onChange={(e) =>
                  setForm({
                    ...form,
                    BaseRole: e.target.value,
                    permissions: Object.entries(data.actions)
                      .filter(([, rs]) => rs.includes(e.target.value))
                      .map(([k]) => k),
                  })
                }
              >
                {[
                  "SALES",
                  "COUNTER_SALES",
                  "WAREHOUSE",
                  "WEIGHBRIDGE",
                  "APPROVER",
                  "ACCOUNTING",
                  "MANAGER",
                  "C_LEVEL",
                  "ADMIN",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <p className="text-sm text-slate-600">
              เลือกได้ทุก Permission ต้นแบบใช้กำหนดค่าเริ่มต้นและขอบเขตข้อมูล
              ผู้ใช้หลาย Role ได้สิทธิ์รวมกัน สิทธิ์ที่ปิดใน Role
              นี้ยังใช้ได้หากอีก Role เปิดอยู่
              เงื่อนไขอนุมัติและฟีเจอร์ที่ปิดอยู่ยังคงตรวจแยกกัน
            </p>
            {editing && (
              <div
                role="tablist"
                aria-label="รายละเอียด Role"
                className="flex gap-2 border-b pb-2"
              >
                <button
                  role="tab"
                  aria-selected={view === "permissions"}
                  className="px-3 py-2 rounded bg-blue-50 text-blue-800"
                  onClick={() => setView("permissions")}
                >
                  Permission
                </button>
                <button
                  role="tab"
                  aria-selected={view === "members"}
                  className="px-3 py-2 rounded bg-blue-50 text-blue-800"
                  onClick={() => setView("members")}
                >
                  สมาชิก ({form.MemberCount || 0})
                </button>
              </div>
            )}
            {editing && view === "members" && (
              <RoleMembers
                key={form.Code}
                code={form.Code}
                onChanged={async () => {
                  const fresh = await req<Catalog>("/admin-management/roles");
                  setData(fresh);
                  setForm(
                    fresh.roles.find((r) => r.Code === form.Code) || null,
                  );
                }}
              />
            )}
            <div hidden={view !== "permissions"} className="space-y-4">
              <fieldset className="grid sm:grid-cols-2 gap-2">
                <legend className="font-bold mb-2">
                  Permission การปฏิบัติงาน
                </legend>
                {Object.keys(data.actions).map((key) => {
                  return (
                    <label key={key} className="flex gap-2 p-2 border rounded">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={form.permissions.includes(key)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            permissions: e.target.checked
                              ? [...form.permissions, key]
                              : form.permissions.filter((x) => x !== key),
                          })
                        }
                      />
                      <span>
                        {names[key] || key}
                        <small className="block text-slate-500">{key}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <details>
                <summary>เมนูตามบทบาทต้นแบบ</summary>
                <p className="text-sm">
                  {Object.entries(data.menus)
                    .filter(([, roles]) => roles.includes(form.BaseRole))
                    .map(([k]) => k)
                    .join(", ")}
                </p>
              </details>
              <button
                className="bg-blue-700 text-white rounded-lg p-2 flex gap-2 disabled:opacity-50"
                disabled={
                  busy ||
                  !form.Code ||
                  !form.Name ||
                  (!editing && data.roles.some((p) => p.Code === form.Code))
                }
                onClick={save}
              >
                <Save size={18} /> {busy ? "กำลังบันทึก" : "บันทึก Role"}
              </button>
            </div>
          </div>
        )}
      </div>
      {history && (
        <section className="bg-white p-4 rounded-xl overflow-x-auto">
          <div className="flex justify-between gap-4">
            <h2 className="font-bold">ประวัติ 100 รายการล่าสุด</h2>
            <button onClick={() => setHistory(null)}>ปิดประวัติ</button>
          </div>
          <table className="w-full text-sm text-left mt-3">
            <thead>
              <tr>
                <th className="p-2">เวลา</th>
                <th>ผู้ทำรายการ (ID)</th>
                <th>คำสั่ง</th>
                <th>ผู้ใช้ / Role ที่เปลี่ยน</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.Id} className="border-t">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(h.CreatedAt).toLocaleString("th-TH", {
                      timeZone: "Asia/Bangkok",
                    })}
                  </td>
                  <td>{h.ActorId}</td>
                  <td>{auditNames[h.Action] || h.Action}</td>
                  <td>{h.Target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length && <p className="p-3">ยังไม่มีประวัติ</p>}
        </section>
      )}
    </div>
  );
}
