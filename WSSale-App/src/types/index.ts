export const SCHEMA_VERSION = '4.0';

// ── Auth ──────────────────────────────────────────────────────
export type UserRole =
  | 'ADMIN'
  | 'SALES'
  | 'COUNTER_SALES'
  | 'WAREHOUSE'
  | 'ACCOUNTING'
  | 'MANAGER'
  | 'APPROVER';

export type AppUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  empId?: string | null;
};

/** WINSpeed employee (dbo.EMEmp) — for mapping AppUser.empId */
export type Employee = {
  EmpID: string;
  EmpCode: string;
  EmpName: string;
  EmpNameEng?: string;
  IsActive: number;
};

/** Row in admin user-management list (joins EMEmp for display) */
export type AdminUser = {
  Id: number;
  Username: string;
  DisplayName: string;
  Role: UserRole;
  EmpId: string | null;
  EmpCode: string | null;
  EmpName: string | null;
  IsActive: boolean;
};

// ── Master Data (maps to dbo views — READ ONLY) ───────────────
export type EMCust = {
  CustID: string;
  CustName: string;
  Tel?: string;
  Mobile?: string;
  Remark?: string;
};

/** ปุ๋ย FG (StockFlag='Y', MainGoodUnitID=1002 ตัน) */
export type EMGood = {
  GoodID: string;
  GoodCode: string;
  GoodName: string;
  GoodGroupName?: string;
  BagPerTon: number;        // 20 ถ้าไม่มีใน wf.GoodExtra
  WeightKgPerBag: number;   // 50
  ImageUrl?: string;
  GoodGroupName?: string;
  StockQty?: number;
  RemaQty?: number;
  TotalQtyTon?: number;
  TotalQtyTonThisYear?: number;
};

export type CurrentPrice = {
  SetPriceID?: number;
  ListNo?: number;
  CustID: string;
  GoodID: string;
  GoodPriceNet: number;
  BeginDate: string;
  EndDate: string;
  startgoodqty: number;
  endgoodqty: number;
};

// ── wf.SalesOrder State Machine ───────────────────────────────
export type SOStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PICKING'
  | 'LOADED'
  | 'SHIPPED'
  | 'IMPORTED'
  | 'CANCELLED';

export type SOPrefix = 'I' | 'K' | 'AI';

export type SalesOrderLine = {
  id?: number;
  lineNo: number;
  goodId: string;
  goodCode: string;
  goodName: string;
  qtyTon: number;
  qtyBag: number;
  pricePerTon: number;
  netPricePerTon: number;
  lineAmount?: number;        // computed: qtyTon * pricePerTon
  rebatePerTon?: number;      // computed: pricePerTon - netPricePerTon
  rebateAmount?: number;      // computed: rebatePerTon * qtyTon
  isGiveaway: boolean;
  rebateBooked?: boolean;
  loadSequence?: number;
};

export type SalesOrder = {
  id?: string | number;
  wfRef?: string;
  soPrefix: SOPrefix;
  custId: string;
  custName: string;
  truckPlate?: string;
  controlTicketNo?: string;
  deliveryDate?: string;
  remark?: string;
  status: SOStatus;
  salesUserId?: number;
  salesName?: string;
  importFilePath?: string;
  importedDocuNo?: string;
  importedAt?: string;
  createdAt?: string;
  lines: SalesOrderLine[];
  auditLogs?: AuditLog[];
  needsApproval?: boolean;
  weighOutWeight?: number;
  isLoaded?: boolean;
};

export type AuditLog = {
  id: number;
  action: string;
  fromStatus?: SOStatus;
  toStatus?: SOStatus;
  note?: string;
  displayName: string;
  createdAt: string;
};

// ── Rebate ────────────────────────────────────────────────────
export type RebatePool = {
  Id: number;
  SalesUserId: number;
  SalesName?: string;
  PeriodYear: number;
  PeriodMonth: number;
  AccruedAmt: number;
  ClaimedAmt: number;
  AllocatedAmt: number;
};

export type RebateLedger = {
  Id: number;
  PoolId: number;
  SoId: string | number;
  CustId: string;
  GoodCode: string;
  QtyTon: number;
  PricePerTon: number;
  NetPricePerTon: number;
  RebatePerTon: number;
  RebateAmount: number;
  RemainingAmt: number;
  Status: 'PENDING' | 'CLAIMED' | 'REVERSED';
  CreatedAt: string;
};

export type RebateClaim = {
  Id: number;
  PoolId: number;
  SalesName?: string;
  CustId?: string;
  ClaimAmt: number;
  RemainingAmt: number;
  Status: 'PENDING' | 'APPROVED';
  CnDocuNo?: string;
  Note?: string;
  CreatedAt: string;
};

export type RebateSummary = {
  SalesName: string;
  TotalAccrued: number;
  TotalClaimed: number;
  TotalAvailable: number;
  TotalAllocated: number;
};

// ── Giveaway (qty model จาก xls: ภาค × ตรา × รายการ) ──────────
export type GiveawayItem = {
  Id: number;
  Brand: string;       // รถเกษตร / ปุ๋ยเทพ
  ItemName: string;    // "16-8-8" / "เสื้อยืดแขนยาว" / "แบนเนอร์ รถเกษตร"
  ItemType: 'BAG' | 'SHIRT' | 'BANNER' | 'OTHER';
};

export type GiveawayRegion = {
  Region: string;
  EmpCode: string | null;
  EmpId: string | null;
  EmpName: string | null;
  TotalBudget: number;
  TotalWithdrawn: number;
  TotalRemaining: number;
  ItemCount: number;
  OverCount: number;
  OverQty: number;
};

export type GiveawayBudgetLine = {
  Id: number;
  Region: string;
  PeriodYear: number;
  Brand: string;
  ItemName: string;
  BudgetQty: number;
  WithdrawnQty: number;
  RemainingQty: number;
  EmpId: string | null;
  EmpCode: string | null;
};

export type GiveawayWithdrawal = {
  Id: number;
  Region: string;
  PeriodYear: number;
  IssueMonth: number | null;
  Brand: string;
  ItemName: string;
  Qty: number;
  CustId: string | null;
  Note: string | null;
  Source: 'IMPORT' | 'APP';
  CreatedAt: string;
};

// ── Quotation (ใบเสนอราคา) ────────────────────────────────────
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';

export type QuotationLine = {
  Id?: number;
  LineNum?: number;
  GoodId: string;
  GoodCode: string;
  GoodName: string;
  QtyTon: number;
  PricePerTon: number;
  NetPricePerTon: number;
  LineAmount?: number;
};

export type Quotation = {
  Id: number;
  QuoteNo: string;
  CustId: string;
  CustName: string;
  ValidUntil?: string;
  Status: QuoteStatus;
  SalesName?: string;
  ConvertedSoId?: number;
  Remark?: string;
  CreatedAt: string;
  lines?: QuotationLine[];
};

// ── Paper Trail (Kanban) ──────────────────────────────────────
export type PaperCard = {
  id: string | number;
  wfRef: string;
  custName: string;
  status: SOStatus;
  truckPlate?: string;
  controlTicketNo?: string;
  importedDocuNo?: string;
  createdAt: string;
  salesName?: string;
  qtyTon: number;
  lineCnt: number;
  daysOpen: number;
};

export type PaperBoard = {
  stages: SOStatus[];
  board: Record<string, PaperCard[]>;
};

// ── Trucks ────────────────────────────────────────────────────
export type TruckStats = {
  truckPlate: string;
  custName: string;
  count: number;
  lastVisit: string;
};

export type TruckHistoryItem = {
  date: string;
  so: string;
  soId: string | number;
  qtyTon: number;
};

// ── Dashboard ─────────────────────────────────────────────────
export type AgingRow = {
  CustName: string;
  GoodCode: string;
  GoodName?: string;
  QtyTon: number;
  DaysOpen: number;
  Status: SOStatus;
  WfRef: string;
  SoId: string | number;
  CreatedAt?: string;
};

// ── Unlock (Picking-phase edit approval) ──────────────────────
export type UnlockRequest = {
  id: string;
  SOID: string;
  wfRef?: string;
  reason?: string;
  createdAt: string;
  resolved: boolean;
};

// ── Helpers ───────────────────────────────────────────────────
export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};
