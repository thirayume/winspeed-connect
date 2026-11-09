import { useId, useState } from "react";
import { Check, Search, Shield } from "lucide-react";
import type { RoleProfile } from "./RoleManagementPage";

/** One multi-role control shared by user editing and batch membership. */
export function RolePicker({
  roles,
  value,
  onChange,
  disabled = false,
}: {
  roles: RoleProfile[];
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  const shown = roles.filter((r) =>
    (r.Name + " " + r.Code + " " + r.BaseRole)
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <fieldset className="space-y-3 min-w-0" disabled={disabled}>
      <legend className="font-semibold text-[#0C447C] mb-2">
        บทบาทที่ได้รับ · เลือกได้หลายรายการ
      </legend>
      <div className="flex flex-wrap gap-2 min-h-8" aria-label="Role ที่เลือก">
        {value.map((code) => {
          const isSep = code === "SEPARATION";
          return (
            <span
              key={code}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs border ${
                isSep
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-blue-50 text-[#0C447C] border-blue-200"
              }`}
            >
              <Check size={13} />
              {roles.find((r) => r.Code === code)?.Name || code}
              {isSep && " (สิ้นสภาพ)"}
            </span>
          );
        })}
        {!value.length && (
          <span className="text-sm text-slate-500">ยังไม่ได้เลือกบทบาท</span>
        )}
      </div>
      <div className="relative">
        <Search size={16} className="absolute top-3 left-3 text-slate-400" />
        <input
          id={id}
          aria-label="ค้นหา Role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อหรือรหัสบทบาท"
          className="w-full border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-sm"
        />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto p-0.5">
        {shown.map((r) => (
          <label
            key={r.Code}
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${value.includes(r.Code) ? "border-blue-400 bg-blue-50/60" : "border-slate-200 bg-white hover:bg-slate-50"}`}
          >
            <input
              type="checkbox"
              aria-label={`${r.Name} (${r.Code})`}
              checked={value.includes(r.Code)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, r.Code]
                    : value.filter((c) => c !== r.Code),
                )
              }
              className="mt-1 accent-[#0C447C]"
            />
            <span className="min-w-0">
              <b className={`block text-sm break-words ${r.Code === "SEPARATION" ? "text-rose-700" : ""}`}>
                {r.Name}
                {r.Code === "SEPARATION" && " (สิ้นสภาพ)"}
              </b>
              <small className="block text-slate-500 break-all">
                {r.Code} · {r.Code === "SEPARATION" ? "ไม่มีบทบาทต้นแบบ" : `ต้นแบบ ${r.BaseRole}`}
              </small>
            </span>
          </label>
        ))}
        {!shown.length && (
          <p className="text-sm p-3 text-slate-500">ไม่พบบทบาทที่ค้นหา</p>
        )}
      </div>
      <p className="flex gap-2 text-xs leading-relaxed text-slate-600">
        <Shield size={16} className="shrink-0" />
        สิทธิ์รวมจากทุกบทบาท เช่น C_LEVEL + SALES ใช้ได้ทั้งงานบริหารและงานขาย
        โดยยังตรวจเงื่อนไขอนุมัติและการผูกพนักงาน
      </p>
    </fieldset>
  );
}
