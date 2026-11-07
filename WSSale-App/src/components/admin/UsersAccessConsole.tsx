import { useState, useEffect, useMemo, useCallback } from "react";
import { Users, ShieldCheck, History, Network, UserCheck, Search, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { AdminUsersPage } from "./AdminUsersPage";
import { RoleManagementPage } from "./RoleManagementPage";
import { OrgHierarchyView } from "./OrgHierarchyView";
import { ApproverGovernanceView } from "./ApproverGovernanceView";
import { req } from "../../services/api";

type ConsoleTab = "users" | "roles" | "org" | "approvers" | "history";
type HistoryDomain = "all" | "roles" | "batch" | "positions" | "regions";

type AuditEntry = {
  Id: number;
  ActorId: number;
  ActorName?: string;
  ActorUsername?: string;
  Action: string;
  Target: string;
  Detail: string;
  CreatedAt: string;
};

const auditActionLabels: Record<string, string> = {
  ROLE_SAVE: "บันทึก Role",
  ROLE_DELETE: "ลบ Role",
  USER_ROLES: "แก้บทบาทรายบุคคล",
  USER_POSITION: "มอบหมาย/เปลี่ยนตำแหน่งองค์กร",
  REGION_ASSIGN: "จัดตั้งผู้ดูแลภาค (Rebate)",
  REGION_REMOVE: "ถอดผู้ดูแลภาค (Rebate)",
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
  const primaryRole = String(sessionUser?.role || "");
  const userRoles = useMemo(() => {
    if (Array.isArray(sessionUser?.roles) && sessionUser.roles.length > 0) return sessionUser.roles;
    return [primaryRole].filter(Boolean);
  }, [sessionUser, primaryRole]);

  const isAdmin = userRoles.includes("ADMIN");
  const isCLevel = userRoles.includes("C_LEVEL");
  const isManager = userRoles.includes("MANAGER");
  const isAccounting = userRoles.includes("ACCOUNTING");

  // Capabilities
  const hasUsersManage =
    (Boolean(sessionUser?.capabilities?.actions.includes("users.manage")) || isAdmin) &&
    !sessionUser?.isImpersonating;
  const hasRolesManage =
    (Boolean(sessionUser?.capabilities?.actions.includes("roles.manage")) || isAdmin) &&
    !sessionUser?.isImpersonating;

  // Domain permission gates
  const canAccessUsers = hasUsersManage;
  const canAccessRoles = hasRolesManage;
  const canAccessOrg = isAdmin || isManager || isAccounting || hasUsersManage;
  const canAccessApprovers = isAdmin || isCLevel || isManager;
  const canAccessAudit = hasRolesManage || hasUsersManage || isAdmin;

  // Determine initial tab based on permissions and initialPortal
  const getInitialTab = (): ConsoleTab => {
    if ((initialPortal === "roles") && canAccessRoles) return "roles";
    if ((initialPortal === "org") && canAccessOrg) return "org";
    if ((initialPortal === "approvers" || initialPortal === "regions" || initialPortal === "native-approvers") && canAccessApprovers) {
      return "approvers";
    }
    if ((initialPortal === "history" || initialPortal === "audit") && canAccessAudit) return "history";

    if (canAccessUsers) return "users";
    if (canAccessRoles) return "roles";
    if (canAccessOrg) return "org";
    if (canAccessApprovers) return "approvers";
    if (canAccessAudit) return "history";
    return "users";
  };

  const [activeTab, setActiveTab] = useState<ConsoleTab>(getInitialTab);
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string | null>(null);

  // History state
  const [historyLogs, setHistoryLogs] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyDomain, setHistoryDomain] = useState<HistoryDomain>("all");

  // Sync tab when initialPortal changes
  useEffect(() => {
    if (initialPortal === "roles" && canAccessRoles) {
      setActiveTab("roles");
    } else if (initialPortal === "org" && canAccessOrg) {
      setActiveTab("org");
    } else if (
      (initialPortal === "approvers" || initialPortal === "regions" || initialPortal === "native-approvers") &&
      canAccessApprovers
    ) {
      setActiveTab("approvers");
    } else if (initialPortal === "admin" && canAccessUsers) {
      setActiveTab("users");
    }
  }, [initialPortal, canAccessRoles, canAccessOrg, canAccessApprovers, canAccessUsers]);

  // Load audit history
  const loadHistoryLogs = useCallback(async () => {
    if (!canAccessAudit) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const queryParam = historyDomain !== "all" ? `?domain=${historyDomain}` : "";
      const data = await req<AuditEntry[]>(`/admin-management/history${queryParam}`);
      setHistoryLogs(data || []);
    } catch (err: any) {
      setHistoryError(err.message || "โหลดประวัติไม่สำเร็จ");
    } finally {
      setHistoryLoading(false);
    }
  }, [canAccessAudit, historyDomain]);

  useEffect(() => {
    if (activeTab === "history") {
      loadHistoryLogs();
    }
  }, [activeTab, loadHistoryLogs]);

  // Handler for jumping from Role view to Users view with filter
  const handleViewRoleUsers = (roleCode: string) => {
    if (canAccessUsers) {
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
      (log.ActorName && log.ActorName.toLowerCase().includes(term)) ||
      (log.ActorUsername && log.ActorUsername.toLowerCase().includes(term)) ||
      actionLabel.toLowerCase().includes(term) ||
      String(log.ActorId).includes(term)
    );
  });

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "#F1EFE8" }}>
      {/* Unified Top Header Bar */}
      <header className="px-4 py-3 sm:px-6 sm:py-3.5 border-b border-gray-200 bg-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-0.5">
            <span>ตั้งค่าระบบ</span>
            <span>/</span>
            <span className="text-[#0C447C] font-semibold">ผู้ใช้งานและสิทธิ์ (Users & Access Console V3)</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black flex items-center gap-2 leading-tight" style={{ color: "#0C447C" }}>
            <Users className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
            ผู้ใช้งานและสิทธิ์ (Users & Access Console)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
            บริหารจัดการบัญชีผู้ใช้งาน สิทธิ์บทบาท (Multi-Role) ผังองค์กร สายอนุมัติ และประวัติการเปลี่ยนแปลง
          </p>
        </div>

        {/* View Switcher Tabs (5 Tabs) */}
        <div
          role="tablist"
          aria-label="มุมมองศูนย์ผู้ใช้งานและสิทธิ์"
          className="flex items-center bg-slate-100 p-1 rounded-xl text-xs sm:text-sm font-semibold self-start md:self-auto overflow-x-auto max-w-full"
        >
          {canAccessUsers && (
            <button
              role="tab"
              aria-selected={activeTab === "users"}
              onClick={() => setActiveTab("users")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                activeTab === "users"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Users size={15} />
              <span>ผู้ใช้งาน</span>
            </button>
          )}

          {canAccessRoles && (
            <button
              role="tab"
              aria-selected={activeTab === "roles"}
              onClick={() => setActiveTab("roles")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                activeTab === "roles"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ShieldCheck size={15} />
              <span>บทบาทและสิทธิ์</span>
            </button>
          )}

          {canAccessOrg && (
            <button
              role="tab"
              aria-selected={activeTab === "org"}
              onClick={() => setActiveTab("org")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                activeTab === "org"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Network size={15} />
              <span>ผังองค์กร</span>
            </button>
          )}

          {canAccessApprovers && (
            <button
              role="tab"
              aria-selected={activeTab === "approvers"}
              onClick={() => setActiveTab("approvers")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                activeTab === "approvers"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <UserCheck size={15} />
              <span>ผู้อนุมัติ</span>
            </button>
          )}

          {canAccessAudit && (
            <button
              role="tab"
              aria-selected={activeTab === "history"}
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                activeTab === "history"
                  ? "bg-white text-[#0C447C] shadow-xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <History size={15} />
              <span>ประวัติ</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area based on Tab */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Tab 1: Users View */}
        {activeTab === "users" && canAccessUsers && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <AdminUsersPage
              initialRoleFilter={selectedRoleFilter}
              onNavigateToRoles={canAccessRoles ? () => setActiveTab("roles") : undefined}
              embedded={true}
            />
          </div>
        )}

        {/* Tab 2: Roles View */}
        {activeTab === "roles" && canAccessRoles && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <RoleManagementPage
              onViewRoleUsers={canAccessUsers ? handleViewRoleUsers : undefined}
              embedded={true}
            />
          </div>
        )}

        {/* Tab 3: Org Hierarchy View */}
        {activeTab === "org" && canAccessOrg && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <OrgHierarchyView />
          </div>
        )}

        {/* Tab 4: Approvers Governance View */}
        {activeTab === "approvers" && canAccessApprovers && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <ApproverGovernanceView initialSubTab={initialPortal} />
          </div>
        )}

        {/* Tab 5: History View */}
        {activeTab === "history" && canAccessAudit && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 sm:p-6 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 flex flex-col h-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="text-base font-bold text-[#0C447C] flex items-center gap-2">
                    <History size={18} />
                    ประวัติการเปลี่ยนแปลงระบบ (ล่าสุด 100 รายการ)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    บันทึกร่องรอยการเปลี่ยนแปลงบทบาท การเปลี่ยนตำแหน่งองค์กร การตั้งผู้ดูแลภาค และคำสั่ง Batch
                  </p>
                </div>

                {/* Domain Category Filter */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                    {(
                      [
                        { id: "all", label: "ทั้งหมด" },
                        { id: "roles", label: "บทบาท" },
                        { id: "batch", label: "Batch" },
                        { id: "positions", label: "ตำแหน่งองค์กร" },
                        { id: "regions", label: "ผู้ดูแลภาค" },
                      ] as const
                    ).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setHistoryDomain(d.id)}
                        className={`px-2.5 py-1 rounded-md transition-all ${
                          historyDomain === d.id
                            ? "bg-white text-[#0C447C] shadow-xs font-bold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-48 sm:w-56">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="ค้นหาในประวัติ..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-[#0C447C] focus:bg-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={loadHistoryLogs}
                    disabled={historyLoading}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    title="รีเฟรชประวัติ"
                  >
                    <RefreshCw size={14} className={historyLoading ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {historyError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle size={15} />
                  <span>{historyError}</span>
                </div>
              )}

              {/* History Table */}
              <div className="flex-1 overflow-y-auto mt-3 border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold sticky top-0 z-10">
                    <tr>
                      <th className="px-3.5 py-2.5 text-left w-36">เวลา</th>
                      <th className="px-3.5 py-2.5 text-left w-36">การกระทำ</th>
                      <th className="px-3.5 py-2.5 text-left w-32">เป้าหมาย</th>
                      <th className="px-3.5 py-2.5 text-left">รายละเอียด</th>
                      <th className="px-3.5 py-2.5 text-left w-32">ผู้ดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {historyLoading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400 font-sans">
                          กำลังโหลดประวัติ...
                        </td>
                      </tr>
                    ) : filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-400 font-sans">
                          ไม่พบประวัติการเปลี่ยนแปลงตามเงื่อนไข
                        </td>
                      </tr>
                    ) : (
                      filteredHistory.map((log) => {
                        let detailObj: any = null;
                        try {
                          detailObj = JSON.parse(log.Detail);
                        } catch {
                          detailObj = log.Detail;
                        }

                        return (
                          <tr key={log.Id} className="hover:bg-slate-50/70">
                            <td className="px-3.5 py-2 text-slate-500 whitespace-nowrap font-sans text-[11px]">
                              {new Date(log.CreatedAt).toLocaleString("th-TH")}
                            </td>
                            <td className="px-3.5 py-2 font-sans">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                {auditActionLabels[log.Action] || log.Action}
                              </span>
                            </td>
                            <td className="px-3.5 py-2 font-bold text-[#0C447C]">{log.Target}</td>
                            <td className="px-3.5 py-2 text-slate-700 font-sans text-xs">
                              {typeof detailObj === "object" && detailObj !== null ? (
                                <div className="space-y-0.5 text-[11px]">
                                  {detailObj.before !== undefined && detailObj.after !== undefined && (
                                    <div>
                                      {detailObj.username && (
                                        <span className="font-semibold text-slate-800 mr-1.5">
                                          @{detailObj.username}:
                                        </span>
                                      )}
                                      <span>ตำแหน่ง: </span>
                                      <span className="text-slate-500 line-through mr-1">
                                        {detailObj.before || "ยังไม่ผูก"}
                                      </span>
                                      → <span className="font-bold text-emerald-700">{detailObj.after || "ถอดตำแหน่ง"}</span>
                                    </div>
                                  )}
                                  {detailObj.beforeIsPrimary !== undefined && (
                                    <div>
                                      {detailObj.username && (
                                        <span className="font-semibold text-slate-800 mr-1.5">
                                          @{detailObj.username}:
                                        </span>
                                      )}
                                      <span>ภาค: {detailObj.regionCode} </span>
                                      <span className="font-bold text-[#0C447C]">
                                        {detailObj.afterIsPrimary ? "ตั้งเป็นผู้ดูแลหลัก" : "ตั้งเป็นผู้ร่วมดูแล"}
                                      </span>
                                    </div>
                                  )}
                                  {detailObj.wasPrimary !== undefined && (
                                    <div>
                                      {detailObj.username && (
                                        <span className="font-semibold text-slate-800 mr-1.5">
                                          @{detailObj.username}:
                                        </span>
                                      )}
                                      <span className="text-rose-700 font-bold">
                                        ถอดออกจากภาค {detailObj.regionCode}
                                      </span>
                                    </div>
                                  )}
                                  {detailObj.roleCodes && (
                                    <div>Role Codes: {detailObj.roleCodes.join(", ")}</div>
                                  )}
                                  {detailObj.afterRole && (
                                    <div>
                                      บทบาท: {detailObj.beforeRole} →{" "}
                                      <span className="font-bold">{detailObj.afterRole}</span>
                                    </div>
                                  )}
                                  {detailObj.count && <div>จำนวน: {detailObj.count} คน</div>}
                                  {detailObj.revision !== undefined && (
                                    <div className="text-slate-400 text-[10px]">Revision: {detailObj.revision}</div>
                                  )}
                                </div>
                              ) : (
                                String(log.Detail)
                              )}
                            </td>
                            <td className="px-3.5 py-2 font-sans text-slate-700">
                              <div className="font-medium">{log.ActorName || `ผู้ใช้ #${log.ActorId}`}</div>
                              {log.ActorUsername && (
                                <div className="text-[10px] text-slate-400 font-mono">@{log.ActorUsername}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
