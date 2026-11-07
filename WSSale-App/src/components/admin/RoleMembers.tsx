import { useEffect, useState } from "react";
import { Users, Plus, ArrowLeft, Search, ExternalLink } from "lucide-react";
import { req } from "../../services/api";
import type { AdminUser } from "../../types";
import { BatchUsersPanel, type BatchUser } from "./BatchUsersPanel";
import { useAuthStore } from "../../store/auth-store";

type Member = {
  Id: number;
  Username: string;
  DisplayName: string;
  IsActive: boolean;
  RoleCode: string;
};

export function RoleMembers({
  code,
  onChanged,
  onViewRoleUsers,
}: {
  code: string;
  onChanged: () => void;
  onViewRoleUsers?: (roleCode: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<AdminUser[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [batch, setBatch] = useState<BatchUser[] | null>(null);
  const [error, setError] = useState("");
  const [inactive, setInactive] = useState(true);
  const [loading, setLoading] = useState(false);

  const session = useAuthStore((s) => s.user);
  const canManage =
    Boolean(session?.capabilities?.actions.includes("users.manage")) &&
    !session?.isImpersonating;

  async function load() {
    setLoading(true);
    try {
      setMembers(
        await req<Member[]>("/admin-management/roles/" + code + "/members"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [code]);

  const ids = [...new Set(members.map((m) => m.Id))];
  const rows: Array<BatchUser & { IsActive: boolean }> =
    people ||
    ids.map((id) => {
      const m = members.find((x) => x.Id === id)!;
      return {
        ...m,
        RoleCodes: members.filter((x) => x.Id === id).map((x) => x.RoleCode),
      };
    });

  const shown = rows.filter(
    (u) =>
      (inactive || u.IsActive) &&
      (u.DisplayName + " " + u.Username)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  const resetSelection = () => setSelected([]);

  return (
    <section className="space-y-4 min-w-0">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="font-bold flex items-center gap-2 text-[#0C447C]">
            <Users size={20} />
            {people
              ? "เลือกผู้ใช้เพื่อเพิ่มบทบาท"
              : `สมาชิก Role นี้ (${ids.length} คน)`}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {people
              ? `บทบาท ${code} จะถูกเลือกให้แล้ว โดยคงบทบาทเดิมของผู้ใช้`
              : "เห็นบทบาททั้งหมดของแต่ละคน รวมผู้ใช้ที่ปิดใช้งาน"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!people && canManage && onViewRoleUsers && (
            <button
              type="button"
              className="border border-blue-200 bg-blue-50 text-[#0C447C] hover:bg-blue-100 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              onClick={() => onViewRoleUsers(code)}
            >
              <span>ดูผู้ใช้ Role นี้ในตารางผู้ใช้</span>
              <ExternalLink size={13} />
            </button>
          )}

          {canManage &&
            (people ? (
              <button
                className="border rounded-lg p-2 text-sm flex gap-2 hover:bg-slate-50 transition-colors"
                onClick={() => {
                  setPeople(null);
                  setSearch("");
                  resetSelection();
                }}
              >
                <ArrowLeft size={16} />
                กลับรายชื่อสมาชิก
              </button>
            ) : (
              <button
                className="action-add rounded-lg px-3 py-1.5 bg-[#0C447C] text-white hover:bg-[#0a3866] flex items-center gap-1.5 text-xs font-semibold shadow-xs transition-colors"
                onClick={async () => {
                  try {
                    setPeople(await req<AdminUser[]>("/auth/users"));
                    setSearch("");
                    resetSelection();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Plus size={15} />
                เพิ่มสมาชิก
              </button>
            ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-red-700 text-sm bg-red-50 p-2.5 rounded-lg border border-red-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
        <div className="relative flex-1 min-w-40">
          <Search size={16} className="absolute top-3 left-3 text-slate-400" />
          <input
            aria-label="ค้นหาสมาชิก"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetSelection();
            }}
            placeholder="ค้นหาชื่อหรือ Username"
            className="w-full border border-slate-200 rounded-lg py-1.5 pl-9 pr-3 text-xs sm:text-sm bg-white outline-none focus:ring-1 focus:ring-[#0C447C]"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => {
              setInactive(e.target.checked);
              resetSelection();
            }}
            className="rounded accent-[#0C447C]"
          />
          แสดงผู้ใช้ที่ปิดใช้งานด้วย
        </label>
        {canManage && (
          <button
            disabled={!selected.length}
            className="bg-[#0C447C] text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40 shadow-xs transition-all"
            onClick={() =>
              setBatch(rows.filter((u) => selected.includes(u.Id)))
            }
          >
            จัดการที่เลือก ({selected.length})
          </button>
        )}
      </div>

      <div className="overflow-auto max-h-[52vh] rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
            <tr>
              {canManage && (
                <th className="p-3 w-10 text-center">
                  <span className="sr-only">เลือกผู้ใช้</span>
                </th>
              )}
              <th className="p-3">ผู้ใช้</th>
              <th className="p-3">สถานะ</th>
              <th className="p-3">บทบาททั้งหมด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((u) => (
              <tr key={u.Id} className="hover:bg-slate-50/60 transition-colors">
                {canManage && (
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      aria-label={"เลือกสมาชิก " + u.Username}
                      disabled={session?.id === u.Id}
                      checked={selected.includes(u.Id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, u.Id]
                            : selected.filter((id) => id !== u.Id),
                        )
                      }
                      className="rounded accent-[#0C447C]"
                    />
                  </td>
                )}
                <td className="p-3">
                  <b className="text-slate-800">{u.DisplayName}</b>
                  <small className="block text-slate-400 font-mono">@{u.Username}</small>
                </td>
                <td className="p-3 whitespace-nowrap">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${u.IsActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}
                  >
                    {u.IsActive ? "ใช้งาน" : "ปิดใช้งาน"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {(u.RoleCodes || [u.RoleCode || u.Role || ""]).map((r) => (
                      <span
                        key={r}
                        className="bg-blue-50 text-[#0C447C] border border-blue-200 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="p-6 text-center text-slate-400 italic text-xs sm:text-sm">
            {loading ? "กำลังโหลดสมาชิก…" : "ไม่พบผู้ใช้ในรายการนี้"}
          </p>
        )}
      </div>
      <p className="text-xs text-slate-500">
        แสดง {shown.length} คน · การนำบทบาทออกไม่ลบบัญชีผู้ใช้
        และผู้ใช้ต้องมีอย่างน้อยหนึ่งบทบาท
      </p>
      {batch && (
        <BatchUsersPanel
          users={batch}
          initialRoleCodes={[code]}
          initialRoleMode={people ? "add" : "remove"}
          onClose={() => setBatch(null)}
          onDone={() => {
            setPeople(null);
            resetSelection();
            load();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
