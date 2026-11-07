import { useState, useEffect } from "react";
import { Users, ShieldCheck, History } from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { AdminUsersPage } from "./AdminUsersPage";
import { RoleManagementPage } from "./RoleManagementPage";
import { req } from "../../services/api";

type ConsoleTab = "users" | "roles" | "history";

type AuditEntry = {
  Id: number;
  ActorId: number;
  Action: string;
  Target: string;
  Detail: string;
  CreatedAt: string;
};

const auditActionLabels: Record<string, string> = {
  ROLE_SAVE: "บันทึก Role",
  ROLE_DELETE: "ลบ Role",
  USER_ROLES: "แก้บทบาทรายบุคคล",
  BATCH_role: "เปลี่ยน Role (Batch)",
  BATCH_status: "เปลี่ยนสถานะ (Batch)",
  "BATCH_reset-password": "รีเซ็ตรหัสผ่าน (Batch)",
  "BATCH_clear-line": "ล้างการผูก LINE (Batch)",
};

export function UsersAccessConsole({
  initialPortal = "admin",
}: {
  initialPortal?: string;
}) {
  const sessionUser = useAuthStore((s) => s.user);

  // Check capabilities
  const hasUsersManage =
    Boolean(sessionUser?.capabilities?.actions.includes("users.manage")) &&
    !sessionUser?.isImpersonating;
  const hasRolesManage =
    Boolean(sessionUser?.capabilities?.actions.includes("roles.manage")) &&
    !sessionUser?.isImpersonating;

  // Determine initial tab based on permissions and initialPortal
  const getInitialTab = (): ConsoleTab => {
    if (initialPortal === "roles" && hasRolesManage) return "roles";
    if (hasUsersManage) return "users";
    if (hasRolesManage) return "roles";
    return "users";
  };

  const [activeTab, setActiveTab] = useState<ConsoleTab>(getInitialTab);
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string | null>(
    null,
  );

  // History state
  const [historyLogs, setHistoryLogs] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  // Sync tab when initialPortal changes
  useEffect(() => {
    if (initialPortal === "roles" && hasRolesManage) {
      setActiveTab("roles");
    } else if (initialPortal === "admin" && hasUsersManage) {
      setActiveTab("users");
    }
  }, [initialPortal, hasRolesManage, hasUsersManage]);

  // Load audit history when switching to history tab
  useEffect(() => {
    if (activeTab === "history" && hasRolesManage) {
      setHistoryLoading(true);
      setHistoryError("");
      req<AuditEntry[]>("/admin-management/history")
        .then((data) => setHistoryLogs(data))
        .catch((err) => setHistoryError(err.message || "โหลดประวัติไม่สำเร็จ"))
        .finally(() => setHistoryLoading(false));
    }
  }, [activeTab, hasRolesManage]);

  // Handler for jumping from Role view to Users view with filter
  const handleViewRoleUsers = (roleCode: string) => {
    if (hasUsersManage) {
      setSelectedRoleFilter(roleCode);
      setActiveTab("users");
    }
  };

  const filteredHistory = historyLogs.filter((log) => {
    if (!historySearch) return true;
    const term = historySearch.toLowerCase();
    const actionLabel = auditActionLabels[log.Action] || log.Action;
    return (
      (log.Target && log.Target.toLowerCase().includes(term)) ||
      (log.Detail && log.Detail.toLowerCase().includes(term)) ||
      actionLabel.toLowerCase().includes(term) ||
      String(log.ActorId).includes(term)
    );
  });

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: "#F1EFE8" }}
    >
      {/* Unified Top Header Bar */}
      <header className="px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-0.5">
            <span>ตั้งค่าระบบ</span>
            <span>/</span>
            <span className="text-[#0C447C] font-semibold">
              ผู้ใช้งานและสิทธิ์ (Users & Access)
            </span>
          </div>
          <h1
            className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight"
            style={{ color: "#0C447C" }}
          >
            <Users className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
            ผู้ใช้งานและสิทธิ์ (Users & Access Console)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
            บริหารจัดการบัญชีผู้ใช้งาน สิทธิ์หลายบทบาท (Multi-Role)
            และประวัติการเปลี่ยนแปลง
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div
          role="tablist"
          aria-label="มุมมองศูนย์ผู้ใช้งานและสิทธิ์"
          className="flex items-center bg-slate-100 p-1 rounded-xl text-xs sm:text-sm font-semibold self-start md:self-auto"
        >
          {hasUsersManage && (
            <button
              role="tab"
              aria-selected={activeTab === "users"}
              onClick={() => setActiveTab("users")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === "users"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Users size={16} />
              <span>ผู้ใช้งาน</span>
            </button>
          )}

          {hasRolesManage && (
            <button
              role="tab"
              aria-selected={activeTab === "roles"}
              onClick={() => setActiveTab("roles")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === "roles"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ShieldCheck size={16} />
              <span>บทบาท (Roles)</span>
            </button>
          )}

          {hasRolesManage && (
            <button
              role="tab"
              aria-selected={activeTab === "history"}
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
                activeTab === "history"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <History size={16} />
              <span>ประวัติ (100 ล่าสุด)</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area based on Tab */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Tab 1: Users View */}
        {activeTab === "users" && hasUsersManage && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <AdminUsersPage
              initialRoleFilter={selectedRoleFilter}
              onNavigateToRoles={
                hasRolesManage ? () => setActiveTab("roles") : undefined
              }
              embedded={true}
            />
          </div>
        )}

        {/* Tab 2: Roles View */}
        {activeTab === "roles" && hasRolesManage && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <RoleManagementPage
              onViewRoleUsers={hasUsersManage ? handleViewRoleUsers : undefined}
              embedded={true}
            />
          </div>
        )}

        {/* Tab 3: History View */}
        {activeTab === "history" && hasRolesManage && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 flex flex-col h-full overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="text-base font-bold text-[#0C447C] flex items-center gap-2">
                    <History size={18} />
                    ประวัติการเปลี่ยนแปลงสิทธิ์ (Audit Change History)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    บันทึกการสร้าง แก้ไข ลบ Role การเปลี่ยนบทบาทรายคน
                    และคำสั่งแบบกลุ่ม 100 รายการล่าสุด
                  </p>
                </div>
                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="ค้นหาคำสั่ง, เป้าหมาย, หรือรายละเอียด..."
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-[#0C447C]"
                  />
                </div>
              </div>

              {historyError && (
                <p
                  role="alert"
                  className="p-3 my-2 text-xs text-red-700 bg-red-50 rounded-lg border border-red-200"
                >
                  {historyError}
                </p>
              )}

              {historyLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-xs py-12">
                  กำลังโหลดประวัติ...
                </div>
              ) : (
                <div className="flex-1 overflow-auto mt-2">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-500 font-semibold sticky top-0 z-10 border-b border-slate-200 text-[11px]">
                      <tr>
                        <th className="p-2.5">วันเวลา</th>
                        <th className="p-2.5">คำสั่ง (Action)</th>
                        <th className="p-2.5">เป้าหมาย (Target)</th>
                        <th className="p-2.5">ผู้กระทำ (Actor ID)</th>
                        <th className="p-2.5">รายละเอียด (Detail)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredHistory.map((item) => (
                        <tr
                          key={item.Id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="p-2.5 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                            {new Date(item.CreatedAt).toLocaleString("th-TH")}
                          </td>
                          <td className="p-2.5 whitespace-nowrap font-semibold text-[#0C447C]">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 text-[10px]">
                              {auditActionLabels[item.Action] || item.Action}
                            </span>
                          </td>
                          <td className="p-2.5 font-medium text-slate-800">
                            {item.Target}
                          </td>
                          <td className="p-2.5 text-slate-600 font-mono">
                            User #{item.ActorId}
                          </td>
                          <td className="p-2.5 text-slate-500 max-w-md truncate">
                            {item.Detail}
                          </td>
                        </tr>
                      ))}
                      {filteredHistory.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-slate-400 italic"
                          >
                            ไม่พบบันทึกประวัติที่ตรงกับคำค้นหา
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 shrink-0">
                <span>แสดง {filteredHistory.length} รายการ</span>
                <span>ข้อมูลจาก GET /api/admin-management/history</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
