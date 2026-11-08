import { useEffect, useState } from "react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { unsavedMessage } from "../../utils/unsaved-changes";
import {
  X,
  UserRound,
  Shield,
  Contact,
  Save,
  KeyRound,
  Link2,
} from "lucide-react";
import { createUser, updateUser, req } from "../../services/api";
import type { AdminUser, Employee } from "../../types";
import type { RoleProfile } from "./RoleManagementPage";
import { RolePicker } from "./RolePicker";
import { useAuthStore } from "../../store/auth-store";

export function UserEditor({
  user,
  employees,
  onClose,
  onSaved,
  initialTab = "account",
}: {
  user: Partial<AdminUser>;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
  initialTab?: "account" | "roles";
}) {
  const session = useAuthStore((s) => s.user);
  const [formDirty, setFormDirty] = useState(false);
  const original = user.RoleCodes || [user.RoleCode || user.Role || "SALES"];
  const [roles, setRoles] = useState<RoleProfile[]>([]),
    [codes, setCodes] = useState<string[]>(original);
  const [tab, setTab] = useState<"account" | "roles" | "contact">(initialTab),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const canRoles =
    Boolean(session?.capabilities?.actions.includes("roles.manage")) &&
    !session?.isImpersonating &&
    session?.id !== user.Id;
  const dirty = formDirty || [...codes].sort().join("|") !== [...original].sort().join("|");
  const releaseDraftGuard = useUnsavedChanges(dirty);
  const closeEditor = () => { if (!busy && (!dirty || window.confirm(unsavedMessage))) onClose(); };
  useEffect(() => {
    req<{ roles: RoleProfile[] }>("/admin-management/roles")
      .then((r) => {
        setRoles(r.roles);
        if (!user.Id)
          setCodes((selected) =>
            selected.filter((code) =>
              r.roles.some((role) => role.Code === code),
            ),
          );
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const shared = {
        displayName: String(data.get("displayName") || ""),
        empId: String(data.get("empId") || "") || null,
        isActive: data.get("isActive") === "on",
        address: String(data.get("address") || "") || null,
        phone: String(data.get("phone") || "") || null,
        email: String(data.get("email") || "") || null,
        idCardNo: String(data.get("idCardNo") || "") || null,
        taxId: String(data.get("taxId") || "") || null,
      };
      const changed =
        [...codes].sort().join("|") !== [...original].sort().join("|");
      if (user.Id)
        await updateUser(user.Id, {
          ...shared,
          ...(canRoles && changed
            ? { roleCodes: codes, expectedRoleCodes: original }
            : {}),
        });
      else
        await createUser({
          ...shared,
          empId: shared.empId || undefined,
          username: String(data.get("username") || ""),
          password: String(data.get("password") || ""),
          roleCodes: codes,
        });
      releaseDraftGuard();
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input =
    "mt-1 block w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white disabled:bg-slate-50 disabled:text-slate-500";
  const textField = (
    name: string,
    label: string,
    value?: string | null,
    type = "text",
  ) => (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value || ""}
        className={input}
      />
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-2 sm:p-4">
      <form
        onChangeCapture={() => setFormDirty(true)}
        onSubmit={save}
        onInvalidCapture={(e) => {
          const field = e.target as HTMLInputElement;
          const section = field.closest("section")?.getAttribute("aria-label");
          setTab(section === "ข้อมูลติดต่อ" ? "contact" : "account");
          requestAnimationFrame(() => field.focus());
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-editor-title"
        className="bg-white w-full max-w-4xl max-h-[94dvh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-5 py-4 border-b flex items-start justify-between gap-3 bg-[#F8FAFC]">
          <div>
            <h2
              id="user-editor-title"
              className="text-xl font-bold text-[#0C447C]"
            >
              {user.Id ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {user.Id
                ? `${user.DisplayName} · @${user.Username}`
                : "สร้างบัญชีและกำหนดหลายบทบาทในครั้งเดียว"}
            </p>
          </div>
          <button
            type="button"
            aria-label="ปิดข้อมูลผู้ใช้"
            disabled={busy}
            onClick={closeEditor}
            className="p-2 rounded-lg hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </header>
        <div
          role="tablist"
          aria-label="ข้อมูลผู้ใช้"
          className="flex gap-1 p-2 border-b bg-white"
        >
          {(
            [
              { key: "account", label: "บัญชีผู้ใช้", Icon: UserRound },
              { key: "roles", label: `บทบาท (${codes.length})`, Icon: Shield },
              { key: "contact", label: "ข้อมูลติดต่อ", Icon: Contact },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex items-center justify-center gap-2 rounded-lg px-2 sm:px-3 py-2 text-sm font-medium whitespace-nowrap flex-1 sm:flex-none ${tab === key ? "bg-blue-50 text-[#0C447C]" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <Icon size={16} className="hidden sm:block" />
              {label}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {error && (
            <p
              role="alert"
              className="p-3 rounded-xl bg-red-50 text-red-700 text-sm"
            >
              {error}
            </p>
          )}
          <section
            hidden={tab !== "account"}
            className="space-y-5"
            aria-label="บัญชีผู้ใช้"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm font-medium text-slate-700">
                Username (ใช้ Login)
                <input
                  name="username"
                  defaultValue={user.Username || ""}
                  required={!user.Id}
                  disabled={Boolean(user.Id)}
                  autoComplete="off"
                  className={input}
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                ชื่อที่แสดง
                <input
                  name="displayName"
                  defaultValue={user.DisplayName || ""}
                  required
                  maxLength={100}
                  className={input}
                />
              </label>
              {!user.Id && (
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                  รหัสผ่านชั่วคราว
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    className={input}
                  />
                  <small className="block text-slate-500 mt-1">
                    ผู้ใช้ต้องตั้งรหัสของตนเองเมื่อเข้าสู่ระบบครั้งแรก
                  </small>
                </label>
              )}
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                พนักงาน WINSpeed
                <select
                  name="empId"
                  defaultValue={user.EmpId || ""}
                  className={input}
                >
                  <option value="">— ยังไม่ผูกพนักงาน —</option>
                  {employees.map((e) => (
                    <option key={e.EmpID} value={e.EmpID}>
                      {e.EmpCode} · {e.EmpName}
                      {e.IsActive ? "" : " (ลาออก)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-3 p-4 border rounded-xl bg-slate-50 text-sm">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={
                  user.IsActive === undefined ? true : Boolean(user.IsActive)
                }
                disabled={session?.id === user.Id}
                className="accent-[#0C447C]"
              />
              {session?.id === user.Id && (
                <input type="hidden" name="isActive" value="on" />
              )}
              <span>
                <b>เปิดใช้งาน (Active)</b>
                <small className="block text-slate-500">
                  บัญชีที่ปิดใช้งานจะเข้าสู่ระบบไม่ได้
                </small>
              </span>
            </label>
            {user.Id && (
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="border rounded-xl p-4">
                  <p className="font-semibold flex gap-2 text-[#0C447C]">
                    <KeyRound size={16} />
                    รหัสผ่าน
                  </p>
                  <p className="text-slate-500 mt-2">
                    รีเซ็ตรหัสผ่านจากปุ่มรูปกุญแจในรายชื่อ หรือใช้คำสั่ง batch
                    หลังปิดหน้าต่างนี้
                  </p>
                </div>
                <div className="border rounded-xl p-4">
                  <p className="font-semibold flex gap-2 text-[#0C447C]">
                    <Link2 size={16} />
                    การเชื่อมต่อ LINE
                  </p>
                  <p className="mt-2">
                    {user.LineUserId
                      ? `เชื่อมต่อแล้ว${user.LineDisplayName ? " · " + user.LineDisplayName : ""}`
                      : "ยังไม่เชื่อมต่อ"}
                  </p>
                  <p className="text-slate-500 mt-1">
                    ล้างการเชื่อมต่อผ่านคำสั่ง batch
                    เพื่อยืนยันแยกจากการแก้ข้อมูลบัญชี
                  </p>
                </div>
              </div>
            )}
          </section>
          <section
            hidden={tab !== "roles"}
            className="space-y-4"
            aria-label="บทบาทผู้ใช้"
          >
            {!loaded ? (
              <p>กำลังโหลดบทบาท…</p>
            ) : (
              <RolePicker
                roles={roles}
                value={codes}
                onChange={setCodes}
                disabled={busy || !canRoles}
              />
            )}
            {!canRoles && (
              <p className="text-sm text-amber-800">
                การเปลี่ยนบทบาทต้องมีสิทธิ์จัดการ Role
                และให้ผู้ดูแลคนอื่นแก้บทบาทของคุณ
              </p>
            )}
            {loaded && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-900">
                เลือก {codes.length} บทบาท · รวม{" "}
                {
                  new Set(
                    roles
                      .filter((r) => codes.includes(r.Code))
                      .flatMap((r) => r.permissions),
                  ).size
                }{" "}
                Permission ตาม Role
                <br />
                <small>
                  สิทธิ์ทำงานจริงยังตรวจขอบเขตข้อมูล เงื่อนไขอนุมัติ
                  และฟีเจอร์ที่เปิดอยู่
                </small>
              </div>
            )}
          </section>
          <section
            hidden={tab !== "contact"}
            className="space-y-4"
            aria-label="ข้อมูลติดต่อ"
          >
            <label className="block text-sm font-medium text-slate-700">
              ที่อยู่
              <textarea
                name="address"
                defaultValue={user.Address || ""}
                rows={3}
                className={input}
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              {textField("phone", "เบอร์โทร", user.Phone, "tel")}
              {textField("email", "อีเมล", user.Email, "email")}
              {textField("idCardNo", "เลขบัตรประชาชน", user.IdCardNo)}
              {textField("taxId", "เลขผู้เสียภาษี", user.TaxId)}
            </div>
          </section>
        </div>
        <footer className="px-5 py-4 border-t bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            บันทึกข้อมูลและบทบาทพร้อมกัน · {codes.length} บทบาทที่เลือก
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={closeEditor}
              className="border rounded-xl px-4 py-2 bg-white"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={
                busy ||
                !loaded ||
                !codes.length ||
                codes.some((c) => !roles.some((r) => r.Code === c))
              }
              className="flex gap-2 items-center bg-[#0C447C] text-white px-4 py-2 rounded-xl disabled:opacity-40"
            >
              <Save size={17} />
              {busy
                ? "กำลังบันทึก…"
                : user.Id
                  ? "บันทึกการแก้ไข"
                  : "สร้างผู้ใช้ใหม่"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
