import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { req } from "../../services/api";
import type { AdminUser } from "../../types";
import { BatchUsersPanel } from "./BatchUsersPanel";
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
}: {
  code: string;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [people, setPeople] = useState<AdminUser[] | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [batch, setBatch] = useState<AdminUser[] | null>(null),
    [error, setError] = useState("");
  const load = () =>
    req<Member[]>("/admin-management/roles/" + code + "/members")
      .then(setMembers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [code]);
  const ids = [...new Set(members.map((m) => m.Id))];
  return (
    <section className="border rounded-xl p-3 space-y-3">
      <h2 className="font-bold flex gap-2">
        <Users size={20} />
        สมาชิก Role นี้ ({ids.length} คน)
      </h2>
      <p className="text-sm">
        แสดงทั้งผู้ใช้ที่ใช้งานและปิดใช้งาน พร้อม Role ทั้งหมดของแต่ละคน
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>ผู้ใช้</th>
              <th>สถานะ</th>
              <th>Role ทั้งหมด</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const m = members.find((x) => x.Id === id)!;
              return (
                <tr key={id} className="border-t">
                  <td className="p-2">
                    {m.DisplayName}
                    <small className="block">@{m.Username}</small>
                  </td>
                  <td>{m.IsActive ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                  <td>
                    {members
                      .filter((x) => x.Id === id)
                      .map((x) => x.RoleCode)
                      .join(" + ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!ids.length && <p className="p-2">ยังไม่มีสมาชิก</p>}
      </div>
      <button
        className="text-blue-700 border rounded p-2"
        onClick={async () => {
          try {
            setPeople(await req<AdminUser[]>("/auth/users"));
            setSelected([]);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        เลือกผู้ใช้เพื่อเพิ่ม / ย้าย / นำ Role ออก
      </button>
      {people && (
        <div className="space-y-2">
          <input
            className="border p-2 w-full"
            placeholder="ค้นหาสมาชิกหรือผู้ใช้ที่จะเพิ่ม"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-48 overflow-auto">
            {people
              .filter((u) =>
                (u.DisplayName + " " + u.Username)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((u) => (
                <label className="flex gap-2 p-2" key={u.Id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(u.Id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, u.Id]
                          : selected.filter((id) => id !== u.Id),
                      )
                    }
                  />
                  {u.DisplayName} (@{u.Username}) ·{" "}
                  {(u.RoleCodes || [u.RoleCode || u.Role]).join(" + ")} ·{" "}
                  {u.IsActive ? "ใช้งาน" : "ปิดใช้งาน"}
                </label>
              ))}
          </div>
          <button
            disabled={!selected.length}
            className="bg-blue-700 text-white p-2 rounded disabled:opacity-40"
            onClick={() =>
              setBatch(people.filter((u) => selected.includes(u.Id)))
            }
          >
            จัดการที่เลือก ({selected.length})
          </button>
        </div>
      )}
      {batch && (
        <BatchUsersPanel
          users={batch}
          onClose={() => setBatch(null)}
          onDone={() => {
            setPeople(null);
            setSelected([]);
            load();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
