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
  ROLE_DELETE: "ลบ Role",
  USER_ROLES: "แก้บทบาทรายบุคคล",
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

export function RoleManagementPage({
  onViewRoleUsers,
  embedded = false,
}: {
  onViewRoleUsers?: (roleCode: string) => void;
  embedded?: boolean;
} = {}) {
  const [editing, setEditing] = useState(false);
  const [roleSearch, setRoleSearch] = useState(""),
    [permissionSearch, setPermissionSearch] = useState("");
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
    <div
      className={`h-full overflow-auto p-3 sm:p-5 space-y-4 ${
        embedded ? "" : "bg-[#F1EFE8]"
      }`}
    >
      {!embedded && (
        <>
          <h1 className="text-2xl font-bold text-[#0C447C] flex gap-2">
            <Shield /> Role Management
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            สร้าง Role จากบทบาทต้นแบบ ขอบเขตข้อมูลและกติกาอนุมัติใช้ตามต้นแบบ
            เลือกเปิด/ปิดสิทธิ์งานที่ระบบรองรับ
          </p>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="text-red-700 bg-red-50 p-3 rounded-xl border border-red-200 text-xs sm:text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="text-green-700 bg-green-50 p-3 rounded-xl border border-green-200 text-xs sm:text-sm"
        >
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            aria-label="สร้างบทบาทใหม่"
            title="สร้างบทบาทใหม่"
            className="action-add px-3 py-1.5 rounded-xl bg-[#0C447C] hover:bg-[#0a3866] text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all"
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
            <Plus size={16} />
            <span>สร้างบทบาทใหม่</span>
          </button>

          {!embedded && (
            <button
              onClick={async () => {
                try {
                  setHistory(await req<AuditEntry[]>("/admin-management/history"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
            >
              <History size={15} />
              <span>ประวัติการเปลี่ยนแปลง</span>
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400">
          บทบาททั้งหมด {data?.roles.length || 0} รายการ (ปรับปรุง Permission ได้ทุกตัวใน Catalog)
        </p>
      </div>

      <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        {/* Role List Sidebar */}
        <div className="bg-white rounded-2xl p-3.5 space-y-2.5 md:sticky md:top-0 border border-slate-200 shadow-xs">
          <input
            aria-label="ค้นหาบทบาท"
            placeholder="ค้นหาบทบาท…"
            value={roleSearch}
            onChange={(e) => setRoleSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 p-2 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-[#0C447C]"
          />
          <div className="max-h-56 md:max-h-[68vh] overflow-auto space-y-1.5">
            {data?.roles
              .filter((r) =>
                (r.Name + " " + r.Code)
                  .toLowerCase()
                  .includes(roleSearch.toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.Code}
                  className={`block text-left w-full p-2.5 rounded-xl border transition-all ${
                    form?.Code === p.Code
                      ? "border-blue-400 bg-blue-50/70 shadow-xs"
                      : "hover:bg-slate-50 border-slate-200"
                  }`}
                  onClick={() => {
                    setEditing(true);
                    setView("permissions");
                    setForm({ ...p });
                    setError("");
                  }}
                >
                  <b className="text-xs sm:text-sm text-slate-800">{p.Name}</b>
                  <small className="block text-slate-500 text-[11px] mt-0.5">
                    {p.Code} · ต้นแบบ {p.BaseRole} · สมาชิก {p.MemberCount || 0}{" "}
                    คน
                  </small>
                </button>
              ))}
          </div>
        </div>

        {/* Form / Detail Area */}
        {!form && (
          <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-200 shadow-xs">
            <Shield className="mx-auto mb-3 text-[#0C447C]" size={36} />
            <h2 className="font-bold text-base text-[#0C447C]">
              เลือกบทบาทจากรายการด้านซ้ายเพื่อจัดการ
            </h2>
            <p className="text-xs mt-1.5 text-slate-500">
              กำหนด Permission หรือดูและจัดสรรสมาชิกของบทบาทนั้น
            </p>
          </div>
        )}

        {form && data && (
          <div className="bg-white p-4 sm:p-5 rounded-2xl space-y-4 min-w-0 border border-slate-200 shadow-xs">
            <header className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-lg text-[#0C447C]">
                  {editing ? form.Name : "สร้างบทบาทใหม่"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editing
                    ? `${form.Code} · ต้นแบบ ${form.BaseRole} · สมาชิก ${form.MemberCount || 0} คน`
                    : "ตั้งชื่อ เลือกรหัสและต้นแบบ แล้วกำหนด Permission"}
                </p>
              </div>

              {editing && (
                <div className="flex items-center gap-2">
                  <button
                    title={
                      Boolean(form.MemberCount)
                        ? "ย้ายสมาชิกทั้งหมด รวมผู้ใช้ที่ปิดใช้งาน ก่อนลบ Role"
                        : "ลบ Role"
                    }
                    aria-label="ลบ Role"
                    className="action-delete p-2 rounded-xl text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    disabled={busy || Boolean(form.MemberCount)}
                    onClick={async () => {
                      if (!window.confirm(`ยืนยันการลบ Role ${form.Name} (${form.Code})?`)) return;
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
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </header>

            {editing && Boolean(form.MemberCount) && (
              <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-center justify-between">
                <span>⚠️ ย้ายสมาชิกทั้งหมด ({form.MemberCount} คน รวมผู้ใช้ที่ปิดใช้งาน) ก่อนลบ Role</span>
                <button
                  type="button"
                  onClick={() => setView("members")}
                  className="underline font-semibold ml-2 hover:text-amber-900"
                >
                  ดูสมาชิก →
                </button>
              </p>
            )}

            {editing && (
              <div
                role="tablist"
                aria-label="รายละเอียด Role"
                className="flex gap-2 border-b border-slate-100 pb-2 text-xs sm:text-sm font-semibold"
              >
                <button
                  role="tab"
                  aria-selected={view === "permissions"}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    view === "permissions"
                      ? "bg-blue-50 text-[#0C447C] font-bold"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setView("permissions")}
                >
                  Permission ({form.permissions.length})
                </button>
                <button
                  role="tab"
                  aria-selected={view === "members"}
                  className={`px-3 py-1.5 rounded-lg transition-colors ${
                    view === "members"
                      ? "bg-blue-50 text-[#0C447C] font-bold"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  onClick={() => setView("members")}
                >
                  สมาชิก ({form.MemberCount || 0})
                </button>
              </div>
            )}

            <div
              hidden={view !== "permissions"}
              className="grid sm:grid-cols-3 gap-3.5 text-xs sm:text-sm"
            >
              <label className="block font-medium text-slate-700">
                รหัส Role
                <input
                  aria-label="รหัส Role"
                  disabled={editing || busy}
                  className="border border-slate-200 rounded-xl p-2 block w-full mt-1 bg-white disabled:bg-slate-50 disabled:text-slate-500 uppercase font-mono text-xs"
                  value={form.Code}
                  onChange={(e) =>
                    setForm({ ...form, Code: e.target.value.toUpperCase() })
                  }
                />
              </label>
              <label className="block font-medium text-slate-700">
                ชื่อ Role
                <input
                  className="border border-slate-200 rounded-xl p-2 block w-full mt-1 bg-white"
                  value={form.Name}
                  maxLength={100}
                  onChange={(e) => setForm({ ...form, Name: e.target.value })}
                />
              </label>
              <label className="block font-medium text-slate-700">
                บทบาทต้นแบบ
                <select
                  aria-label="บทบาทต้นแบบ"
                  className="border border-slate-200 rounded-xl p-2 block w-full mt-1 bg-white disabled:bg-slate-50 disabled:text-slate-500"
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
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] leading-relaxed text-slate-400 sm:col-span-3">
                * เลือกได้ทุก Permission ใน Catalog ต้นแบบใช้กำหนดค่าเริ่มต้นและฐานกติกาขอบเขตข้อมูล
                ผู้ใช้หลาย Role ได้รับสิทธิ์รวมกัน (Union)
              </p>
            </div>

            {editing && view === "members" && (
              <RoleMembers
                key={form.Code}
                code={form.Code}
                onViewRoleUsers={onViewRoleUsers}
                onChanged={async () => {
                  const fresh = await req<Catalog>("/admin-management/roles");
                  setData(fresh);
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          MemberCount:
                            fresh.roles.find((r) => r.Code === prev.Code)
                              ?.MemberCount || 0,
                        }
                      : null,
                  );
                }}
              />
            )}

            <div hidden={view !== "permissions"} className="space-y-3.5 pt-2">
              <input
                aria-label="ค้นหา Permission"
                placeholder="ค้นหาสิทธิ์การทำงาน…"
                value={permissionSearch}
                onChange={(e) => setPermissionSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm outline-none focus:ring-1 focus:ring-[#0C447C]"
              />
              <fieldset className="grid sm:grid-cols-2 gap-2">
                <legend className="font-bold text-xs sm:text-sm text-slate-800 mb-2">
                  Permission การปฏิบัติงาน · เปิด {form.permissions.length}/
                  {Object.keys(data.actions).length}
                </legend>
                {Object.keys(data.actions)
                  .filter((key) =>
                    (key + " " + (names[key] || ""))
                      .toLowerCase()
                      .includes(permissionSearch.toLowerCase()),
                  )
                  .map((key) => {
                    const isChecked = form.permissions.includes(key);
                    return (
                      <label
                        key={key}
                        className={`flex gap-2.5 p-2.5 border rounded-xl text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-blue-50/50 border-blue-200"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={isChecked}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              permissions: e.target.checked
                                ? [...form.permissions, key]
                                : form.permissions.filter((p) => p !== key),
                            })
                          }
                          className="accent-[#0C447C] rounded mt-0.5"
                        />
                        <div>
                          <b className="text-slate-800">{names[key] || key}</b>
                          <small className="block text-slate-400 font-mono text-[10px]">
                            {key}
                          </small>
                        </div>
                      </label>
                    );
                  })}
              </fieldset>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold hover:bg-slate-50 text-slate-600 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  disabled={busy || !form.Code || !form.Name}
                  onClick={save}
                  className="px-4 py-2 bg-[#0C447C] hover:bg-[#0a3866] text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 shadow-xs disabled:opacity-40 transition-all"
                >
                  <Save size={16} />
                  <span>{busy ? "กำลังบันทึก…" : "บันทึก Role"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {history && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] p-5 overflow-auto space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b">
              <h2 className="text-lg font-bold text-[#0C447C] flex items-center gap-2">
                <History size={18} />
                ประวัติการแก้ไขบทบาทล่าสุด (100 รายการ)
              </h2>
              <button
                onClick={() => setHistory(null)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕ ปิด
              </button>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 text-[11px]">
                <tr>
                  <th className="p-2">เวลา</th>
                  <th className="p-2">ผู้กระทำ</th>
                  <th className="p-2">คำสั่ง</th>
                  <th className="p-2">เป้าหมาย</th>
                  <th className="p-2">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h.Id}>
                    <td className="p-2 text-slate-400 font-mono text-[10px]">
                      {new Date(h.CreatedAt).toLocaleString("th-TH")}
                    </td>
                    <td className="p-2 font-mono">User #{h.ActorId}</td>
                    <td className="p-2 font-semibold text-[#0C447C]">
                      {auditNames[h.Action] || h.Action}
                    </td>
                    <td className="p-2">{h.Target}</td>
                    <td className="p-2 text-slate-500 max-w-xs truncate">{h.Detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
