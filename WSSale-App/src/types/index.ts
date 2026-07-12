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
  isActive: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  idCardNo?: string | null;
  taxId?: string | null;
  signatureFile?: string | null;
  lineUserId?: string | null;
  lineDisplayName?: string | null;
  lineLinkedAt?: string | null;
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
  LineUserId?: string | null;
  LineDisplayName?: string | null;
  LineLinkedAt?: string | null;
  IsActive: boolean;
  Address?: string | null;
  Phone?: string | null;
  Email?: string | null;
  IdCardNo?: string | null;
  TaxId?: string | null;
  SignatureFile?: string | null;
};

// ── Master Data (maps to dbo views — READ ONLY) ───────────────
export type EMCust = {
  CustID: string;
  CustName: string;
  Tel?: string;
  Mobile?: string;
  Remark?: string;
  salespersonId?: string | null;
  salespersonName?: string | null;
  areaId?: string | null;
  groupId?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
};

export type CustomerFilterOption = {
  value: string;
  label: string;
  count: number;
};

export type CustomerFilterOptions = {
  columns: Record<'salesperson' | 'area' | 'group' | 'employee', string | null>;
  salesperson: CustomerFilterOption[];
  area: CustomerFilterOption[];
  group: CustomerFilterOption[];
  employee: CustomerFilterOption[];
};

export type CustomerRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export type CustomerRequest = {
  Id: number;
  CustName: string;
  ContactName?: string | null;
  Tel?: string | null;
  Mobile?: string | null;
  TaxId?: string | null;
  Address?: string | null;
  Note?: string | null;
  Status: CustomerRequestStatus;
  WinspeedCustId?: string | null;
  RequestedBy?: number | null;
  RequestedByName?: string | null;
  ReviewedBy?: number | null;
  ReviewedByName?: string | null;
  ReviewedAt?: string | null;
  ReviewNote?: string | null;
  CreatedAt: string;
  UpdatedAt: string;
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
  IsExpired?: number;
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
  giveawayApprovalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  giveawayApprovedBy?: number | null;
  giveawayApprovedAt?: string | null;
  giveawayApprovalNote?: string | null;
  giveawayApprovedByName?: string | null;
  isControlTicketDrawn?: boolean;
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
  requestedAt?: string;
  isOwnTruck?: boolean;
  noTruckRequired?: boolean;
  pSling?: boolean;
  remark?: string;
  status: SOStatus;
  salesUserId?: number;
  salesName?: string;
  rebateDiscountAmt?: number;
  importFilePath?: string;
  importedDocuNo?: string;
  importedAt?: string;
  createdAt?: string;
  lines: SalesOrderLine[];
  auditLogs?: AuditLog[];
  needsApproval?: boolean;
  linkedQuoteId?: number | null;
  linkedQuoteNo?: string | null;
  linkedQuoteStatus?: QuoteStatus | null;
  linkedQuoteRemark?: string | null;
  linkedQuoteValidUntil?: string | null;
  quotationLockReason?: string | null;
  weighOutWeight?: number;
  weighOutAt?: string | null;
  isLoaded?: boolean;
  statusTimeline?: StatusTimelineItem[];
};

export type StatusTimelineItem = {
  status: SOStatus;
  label: string;
  at?: string | null;
  source?: string | null;
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

export type RebatePlan = {
  PlanId: number;
  PlanNo: string;
  Title?: string | null;
  RefDoc?: string | null;
  GoodCodePattern?: string | null;
  Region: string;
  ReturnType: 'REBATE' | 'PRICEDIFF';
  NetPrice?: number | null;
  ValidFrom?: string | null;
  ValidTo?: string | null;
  AllocatedAmount: number;
  Priority: number;
  Status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  Note?: string | null;
  CreatedByName?: string | null;
  CreatedAt: string;
  LedgerCount?: number;
  AccruedAmt?: number;
};

export type RebateSummary = {
  SalesName: string;
  TotalAccrued: number;
  TotalClaimed: number;
  TotalAvailable: number;
  TotalAllocated: number;
};

/** dbo.WFCoupon — Winspeed loyalty coupon (แลกสินค้าฟรี คนละระบบกับรีเบทเงิน) */
export type CouponRow = {
  CouponID: number;
  CouponNo: string;
  SONo: string;
  DocuDate: string;
  CustID: string;
  CustName: string;
  EmpID: string;
  EmpName: string;
  GoodID: number;
  GoodName: string;
  GoodQty: number;
  RemaQty: number;
  RedeemedQty: number;
};

export type CouponCustomer = {
  CustID: string;
  CustName: string;
  EmpID: string;
  EmpName: string;
  CouponCount: number;
  OutstandingTon: number;
  OldestDate: string;
};

// ── Accounting: ออกของวันนี้ (dbo.SOHD) ──────────────────────
export type ShippedRow = {
  Id: number;
  WfRef: string;
  CustName: string;
  DocuDate: string;
  DocuStatus: string;
  TotalTon: number;
  LineCount: number;
  TruckPlate: string;
};

// ── CN Rebate (dbo — single source of truth) ─────────────────
export type CnRebateSummary = {
  EmpID: string;
  SalesName: string;
  CNCount: number;
  CustCount: number;
  TotalRebate: number;
  FirstCN: string;
  LastCN: string;
};

export type CnRebateRow = {
  SOInvID: number;
  CNDocuNo: string;
  CNDate: string;
  CustID: string;
  CustName: string;
  EmpID: string;
  SalesName: string;
  OrigInvNo: string;
  OrigInvDate: string;
  CNAmt: number;
  RemaAmnt: number;
  DocuStatus: string;
  Reason: string;
};

export type CnRebateDetail = {
  ListNo: number;
  GoodName: string;
  QtyTon: number;
  RebatePerTon: number;
  RebateAmt: number;
  OrigPrice: number | null;
};

export type VoucherSummary = {
  EmpID: string;
  EmpName: string;
  CustCount: number;
  CouponCount: number;
  OutstandingTon: number;
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
  IsNativeOnly?: boolean;
  QuoteNo: string;
  CustId: string;
  CustName: string;
  ValidUntil?: string;
  Status: QuoteStatus;
  SalesUserId?: number | null;
  SalesName?: string;
  ConvertedSoId?: number;
  WinspeedQuoteSOID?: number | null;
  WinspeedQuoteNo?: string | null;
  WinspeedQuoteSyncedAt?: string | null;
  WinspeedConfirmSOID?: number | null;
  WinspeedConfirmNo?: string | null;
  WinspeedConfirmSyncedAt?: string | null;
  WinspeedEstimateID?: number | null;
  WinspeedEstimateNo?: string | null;
  WinspeedEstimateSyncedAt?: string | null;
  Remark?: string;
  CreatedAt: string;
  lines?: QuotationLine[];
  LineCount?: number;
  TotalTon?: number;
  TotalAmount?: number;
  SourceSoCount?: number;
  sourceSos?: Array<{
    SoId: number;
    SourceWfRef?: string;
    Status?: SOStatus;
    CustId?: string;
    CustName?: string;
    TruckPlate?: string;
  }>;
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
  deliveryDate?: string;
  salesName?: string;
  qtyTon: number;
  lineCnt: number;
  daysOpen: number;
  copyCnt?: number;
  lostCnt?: number;
  verifiedAt?: string | null;
};

export type PaperBoard = {
  stages: SOStatus[];
  board: Record<string, PaperCard[]>;
};

// ── Paper Trail v2 — เอกสาร 4 สี + QR + scan ──────────────────
export type PaperCopyStatus = 'PRINTED' | 'IN_TRANSIT' | 'SIGNED' | 'FILED' | 'LOST';
export type PaperCopy = {
  Id: number;
  SoId: string;
  WfRef: string;
  DocType: string;
  CopyColor: string;
  CopyLabel: string;
  QrNonce: string;
  Status: PaperCopyStatus;
  HolderUserId: number | null;
  HolderName?: string | null;
  PrintedAt: string;
  UpdatedAt: string;
  DaysStuck?: number;
};
export type PaperDocLine = {
  LineNum: number;
  GoodCode: string;
  GoodName: string;
  QtyTon: number;
  QtyBag: number;
  PricePerTon: number;
  NetPricePerTon: number;
  IsGiveaway: boolean;
  LoadSequence: number | null;
};
export type PaperDocument = {
  Id: string;
  WfRef: string;
  CustId: string;
  CustName: string;
  TruckPlate?: string;
  ControlTicketNo?: string;
  Status: string;
  DeliveryDate?: string;
  CreatedAt: string;
  SalesName?: string;
  lines: PaperDocLine[];
};
export type PrintedCopy = { color: string; label: string; qrNonce: string };
export type PaperScanRow = {
  Id: number; Action: string; FromStatus: string; ToStatus: string;
  ScannerName?: string; Location?: string; Note?: string; ScannedAt: string;
};

// ── Trucks ────────────────────────────────────────────────────
export type TruckType = {
  Id: string;
  Name: string;
  SlotCount: number;
  TrailerSlotCount?: number | null;
  MaxTonPerSlot: number;
  IsActive?: boolean;
};

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
  TruckPlate?: string;
};

// ── TruckScale (MySQL — FR-024/025/026) ───────────────────────
export type TruckScaleWeigh = {
  Sequence: string;
  Movebill: string;
  Plate: string;
  CustName: string;
  WeightIn: number;
  WeightOut: number;
  WeightNet: number;
  DateIn: string;
  TimeIn?: string;
  DateOut: string;
  TimeOut?: string;
  WeighType: string;
  ScaleNo: number;
  OneNum: number;
  Sid: number;
};
export type TruckScaleProduct = { GoodName: string; Brand?: string; WantWeightTon: number; Bag?: number; Destination?: string; RecvType?: string };
export type TruckScaleDetail = TruckScaleWeigh & { products: TruckScaleProduct[] };

// ── Control Ticket (ชุดตั๋วคุม — FR-021) ───────────────────────
export type ControlTicket = {
  SOID: string | number;
  DocuNo: string;          // AppvDocuNo (AI...)
  DocuDate: string;
  CustID: string;
  CustName: string;
  TruckPlate?: string;
  AppvFlag?: string;
  OriginalDocuNo?: string;
  TotalQtyTon: number;
  DrawnQtyTon: number;
};
export type ControlTicketDraw = {
  SOID: string | number;
  DocuNo: string;
  DocuDate: string;
  CustName: string;
  TruckPlate?: string;
  DrawnQtyTon: number;
  LineCnt: number;
};

// ── Weigh Ticket (FR — gross/tare/net) ────────────────────────
export type WeighTicket = {
  Id: number;
  SoId: string;
  WfRef?: string | null;
  TruckPlate?: string | null;
  GrossKg?: number | null;
  TareKg?: number | null;
  NetKg?: number | null;
  ScaleNo?: number | null;
  WeighInAt?: string | null;
  WeighOutAt?: string | null;
  Status: 'WEIGH_IN' | 'WEIGH_OUT' | 'DONE';
  Movebill?: string | null;
  CreatedAt: string;
};

// ── Unlock Request (FR-006/007) ───────────────────────────────
export type UnlockReq = {
  Id: number;
  SoId: string;
  WfRef?: string | null;
  Reason: string;
  Status: 'PENDING' | 'APPROVED' | 'REJECTED';
  ReqType: 'UNLOCK' | 'EDIT' | 'CANCEL';
  RequesterId: number;
  RequesterName?: string | null;
  ApproverId?: number;
  ApproverName?: string | null;
  ResponseNote?: string | null;
  RequestedAt: string;
  RespondedAt?: string | null;
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
