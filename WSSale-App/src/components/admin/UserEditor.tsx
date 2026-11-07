import { useEffect, useState } from "react";
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
  const original = user.RoleCodes || [user.RoleCode || user.Role || "SALES"];
  const [roles, setRoles] = useState<RoleProfile[]>([]);
  const [codes, setCodes] = useState<string[]>(original);
  const [tab, setTab] = useState<"account" | "roles" | "contact">(initialTab);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [isFormDirty, setIsFormDirty] = useState(false);

  const canRoles =
    Boolean(session?.capabilities?.actions.includes("roles.manage")) &&
    !session?.isImpersonating &&
    session?.id !== user.Id;

  const rolesChanged =
    [...codes].sort().join("|") !== [...original].sort().join("|");
  const isDirty = isFormDirty || rolesChanged;

  function handleCloseRequest() {
    if (isDirty && !busy) {
      if (
        !window.confirm(
          "คุณมีข้อมูลที่ยังไม่ได้บันทึก ต้องการแก้ไขต่อหรือทิ้งการแก้ไข?",
        )
      ) {
        return;
      }
    }
    onClose();
  }

  // Handle Escape key with dirty guard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        handleCloseRequest();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDirty, busy]);

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
      onSaved();
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "บันทึกไม่สำเร็จ";
      if (
        msg.includes("409") ||
        msg.includes("Conflict") ||
        msg.toLowerCase().includes("stale")
      ) {
        setError(
          "⚠️ ข้อมูลบทบาทถูกเปลี่ยนแปลงโดยผู้ใช้อื่นก่อนหน้า (409 Conflict) โปรดตรวจทานบทบาทล่าสุดก่อนบันทึกทับ",
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 block w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white disabled:bg-slate-50 disabled:text-slate-500 text-sm";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-2 sm:p-4">
      <form
        onSubmit={save}
        onInput={() => setIsFormDirty(true)}
        onChange={() => setIsFormDirty(true)}
        onInvalidCapture={(e) => {
          const field = e.target as HTMLInputElement;
          const section = field.closest("section")?.getAttribute("aria-label");
          setTab(section === "ข้อมูลติดต่อ" ? "contact" : "account");
          requestAnimationFrame(() => field.focus());
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-editor-title"
        className="bg-white w-full max-w-4xl max-h-[94dvh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200"
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
            onClick={handleCloseRequest}
            className="p-2 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="ข้อมูลผู้ใช้"
          className="flex gap-1 p-2 border-b bg-white shrink-0"
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
              className={`flex items-center justify-center gap-2 rounded-lg px-2 sm:px-3 py-2 text-sm font-medium whitespace-nowrap flex-1 sm:flex-none transition-colors ${
                tab === key
                  ? "bg-blue-50 text-[#0C447C] font-semibold"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Icon size={16} className="hidden sm:block" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && (
            <p
              role="alert"
              className="p-3 rounded-xl bg-red-50 text-red-700 text-sm border border-red-200"
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
                  className={input}
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                ชื่อที่แสดง (Display Name)
                <input
                  name="displayName"
                  defaultValue={user.DisplayName || ""}
                  required
                  className={input}
                />
              </label>
            </div>

            {!user.Id && (
              <label className="block text-sm font-medium text-slate-700">
                รหัสผ่านเริ่มต้น
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  className={input}
                />
                <span className="text-xs text-slate-500 mt-1 block">
                  ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
                </span>
              </label>
            )}

            <label className="block text-sm font-medium text-slate-700">
              พนักงาน WINSpeed (dbo.EMEmp)
              <select
                name="empId"
                defaultValue={user.EmpId || ""}
                className={input}
              >
                <option value="">— ไม่ผูกพนักงาน —</option>
                {employees.map((e) => (
                  <option key={e.EmpID} value={e.EmpID}>
                    {e.EmpCode} · {e.EmpName}
                    {e.IsActive ? "" : " (ลาออก)"}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 cursor-pointer pt-2">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={user.Id ? user.IsActive : true}
                className="w-4 h-4 rounded border-slate-300 accent-[#0C447C]"
              />
              <span className="text-sm font-medium text-slate-800">
                เปิดใช้งานบัญชี (Active)
              </span>
            </label>

            {user.Id && user.LineUserId && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                <Link2 size={16} className="text-emerald-600 shrink-0" />
                <span>ผูกกับ LINE ID: {user.LineDisplayName || user.LineUserId}</span>
              </div>
            )}
          </section>

          <section
            hidden={tab !== "roles"}
            className="space-y-4"
            aria-label="บทบาทและสิทธิ์"
          >
            <RolePicker
              roles={roles}
              value={codes}
              disabled={!canRoles && Boolean(user.Id)}
              onChange={(newCodes) => {
                setCodes(newCodes);
                setIsFormDirty(true);
              }}
            />

            {!canRoles && Boolean(user.Id) && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                คุณไม่มีสิทธิ์แก้ไขบทบาทของผู้ใช้นี้ (ต้องการ: roles.manage หรือไม่สามารถแก้ไขตนเองได้)
              </p>
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

        <footer className="px-5 py-4 border-t bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <p className="text-xs text-slate-500">
            บันทึกข้อมูลและบทบาทพร้อมกัน · {codes.length} บทบาทที่เลือก
            {rolesChanged && (
              <span className="ml-2 font-medium text-amber-700">
                (มีการเปลี่ยนบทบาท)
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleCloseRequest}
              className="border border-slate-200 rounded-xl px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 text-sm font-semibold transition-colors"
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
              className="flex gap-2 items-center bg-[#0C447C] hover:bg-[#0a3866] text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 shadow-xs transition-all"
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
