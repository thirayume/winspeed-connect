export const SCHEMA_VERSION = '4.0';

// ── Company Info (dbo.EMComp) ─────────────────────────────────
export interface CompanyInfo {
  compCode: string;
  compName: string;
  compNameEng: string;
  compOwner: string;
  compOwnerEng: string;
  taxId: string;
  taxId13: string;
  addr1: string;
  addr2: string;
  addr3?: string | null;
  addr1Eng?: string | null;
  addr2Eng?: string | null;
  addr3Eng?: string | null;
  tel?: string | null;
  fax?: string | null;
  email?: string | null;
  homepage?: string | null;
}

// ── Auth ──────────────────────────────────────────────────────
export type UserRole =
  | 'ADMIN'
  | 'C_LEVEL'
  | 'SALES'
  | 'COUNTER_SALES'
  | 'WAREHOUSE'
  | 'ACCOUNTING'
  | 'MANAGER'
  | 'APPROVER'
  | 'WEIGHBRIDGE'
  | 'REPORT_PILOT'
  | 'SEPARATION';

export type AppUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  roleCode?: string;
  roleCodes?: string[];
  roles?: string[];
  isPilot?: boolean;
  actorId?: number;
  actorUsername?: string;
  actorDisplayName?: string;
  actorRole?: UserRole;
  isImpersonating?: boolean;
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
  mustChangePassword?: boolean;
  // R12 item 3: menus/actions of the effective role from the backend role-capability map
  capabilities?: { menus: string[]; actions: string[] };
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
  RoleCodes?: string[];
  Roles?: string[];
  RoleCode?: string | null;
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
  // ── ตำแหน่งในผังองค์กร (wf.OrgPosition) — เติมโดย GET /auth/users ──
  PositionCode?: string | null;
  PositionName?: string | null;
  OrgUnit?: string | null;
  Tier?: number | null;
  /** บทบาทที่ตำแหน่งนี้ "ควร" ได้ — ใช้เทียบกับ Role จริงเพื่อหาความไม่ตรงกัน */
  PositionDefaultRole?: string | null;
  CanApprove?: boolean | null;
  // ผู้อนุมัติที่ใกล้ที่สุด คำนวณจาก wf.v_NearestApprover (ไต่ ReportsTo ขึ้นไป)
  ApproverPosition?: string | null;
  ApproverName?: string | null;
  ApproverRole?: string | null;
};

// ── Master Data (maps to dbo views — READ ONLY) ───────────────
export type EMCust = {
  CustCode?: string;
  CustID: string;
  CustName: string;
  Tel?: string;
  PrimaryPhone?: string | null;
  Mobile?: string;
  SecondaryPhone?: string | null;
  Email?: string | null;
  LineId?: string | null;
  Remark?: string;
  salespersonId?: string | null;
  salespersonName?: string | null;
  areaId?: string | null;
  areaName?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  CreditDays?: number | null;
  RawAgingDays?: number | null;
  IsDefaultAging?: number | boolean;
  CreditLimit?: number | null;
  AgingDays?: number | null;
  CreditHold?: boolean;
  Inactive?: string | null;
};

export type CustomerCreditOverdueInvoice = {
  docuNo: string;
  docuDate: string;
  unpaidAmnt: number;
  ageDays: number;
  overdueDays: number;
};

export type CustomerCreditStatus = {
  custId: string;
  custName?: string;
  creditLimit: number | null;
  rawAgingDays?: number | null;
  agingLimitDays: number;
  defaultAgingDays?: number;
  maxPolicyAgingDays?: number;
  agingAlertPopup?: boolean;
  isUsingDefaultAging?: boolean;
  isCashOnly?: boolean;
  isConfiguredAgingOverPolicyMax?: boolean;
  totalOutstanding: number;
  maxAgingDays: number;
  orderAmount: number;
  totalWithOrder?: number;
  projectedTotal: number;
  creditExcessAmount?: number;
  isOverCreditLimit: boolean;
  isCreditLimitExceeded?: boolean;
  isOverAging: boolean;
  isAgingExceeded?: boolean;
  isOverPolicyMaxAging?: boolean;
  overdueAmount?: number;
  overdueInvoices?: CustomerCreditOverdueInvoice[];
  unpaidCount?: number;
  strictCredit: boolean;
  strictAging: boolean;
  strictCreditMode?: boolean;
  strictAgingMode?: boolean;
  creditHold: boolean;
  blocked: boolean;
  blockReasons: string[];
  warnings: string[];
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
  regions?: CustomerFilterOption[];
};

export type CustomerRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export type CustomerGroup = {
  CustGroupID: number;
  CustGroupCode?: string | null;
  CustGroupName: string;
  CustGroupNameEng?: string | null;
  Remark?: string | null;
  CustomerCount?: number;
};

export type CustomerRequest = {
  Id: number;
  CustName: string;
  ContactName?: string | null;
  Tel?: string | null;
  Mobile?: string | null;
  Email?: string | null;
  LineId?: string | null;
  TaxId?: string | null;
  Address?: string | null;
  SalespersonUserId?: number | null;
  SalespersonName?: string | null;
  RegionCode?: string | null;
  CustGroupId?: number | null;
  CustGroupName?: string | null;
  CreditLimit?: number | null;
  AgingDays?: number | null;
  CreditHold?: boolean | null;
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
  GoodGroupID?: number | null;
  GoodGroupName?: string;
  BagPerTon: number;        // 20 ถ้าไม่มีใน wf.GoodExtra
  WeightKgPerBag: number;   // 50
  ImageUrl?: string;
  StockQty?: number;
  RemaQty?: number;
  TotalQtyTon?: number;
  TotalQtyTonThisYear?: number;
  RemainingQty?: number;
  Inactive?: 'A' | 'I';
  // ของแถม: บรรทัดงบที่ตัวจับคู่ฝั่งเซิร์ฟเวอร์เลือกให้ (R11 U-8)
  Brand?: string;
  ItemName?: string;
  Region?: string | null;
  QuotaMatched?: boolean;
  UnitName?: string;
  SetPrice?: number;
  GoodPrice?: number;
  GoodPrice1?: number;
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
  // ยืนยันในแอปแล้ว แต่ยังรอผู้มีอำนาจกดอนุมัติในหน้าจอ Approve Confirm Order (WF)
  // ใบยังไม่มีเลข AI จึงยังไม่เกิดใบส่งของและคูปอง
  | 'PENDING_APPROVAL'
  | 'CONFIRMED'
  | 'PICKING'
  | 'LOADED'
  | 'SHIPPED'
  | 'IMPORTED'
  | 'CANCELLED';

export type SOPrefix = 'I' | 'K' | 'AI';

export type SalesOrderLine = {
  id?: number;
  /** client-side ordering used when composing a save payload */
  lineNo: number;
  /** server-assigned (wf.v_AllSalesOrderLines.LineNum); present on lines read back */
  lineNum?: number;
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
  refControlTicketNo?: string;
  rebateBooked?: boolean;
  loadSequence?: number;
  masterQty?: number;
  childQty?: number;
};

export type SalesOrder = {
  awaitingAi?: boolean;
  id?: string | number;
  wfRef?: string;
  soPrefix: SOPrefix;
  custId: string;
  custCode?: string | null;
  custName: string;
  creditDays?: number;
  tripId?: number;
  tripCode?: string;
  truckPlate?: string;
  controlTicketNo?: string;
  deliveryDate?: string;
  requestedAt?: string;
  isOwnTruck?: boolean;
  noTruckRequired?: boolean | number;
  isControlTicket?: boolean;
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
  requiresPriceApproval?: boolean;
  priceApprovalStatus?: string;
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
  /**
   * WINSpeed posting info consumed by SODetailsPanel. GET /so/:id does not
   * populate these yet, so the "WINSpeed Posted" badge stays hidden until it does.
   */
  winspeedInvoices?: WinspeedInvoiceRef[];
  isWinspeedPosted?: boolean;
  pickupDueDate?: string | null;
  pickupDueType?: 'EXPLICIT' | 'DEFAULT' | 'UNKNOWN' | null;
  confirmedAt?: string | null;
  pickupPolicySnapshotId?: number | null;
  pickupEvaluation?: {
    in?: { status: 'EARLY' | 'ON_TIME' | 'LATE' | 'UNKNOWN'; deltaDays: number | null; actualDate?: string | null; dueDate?: string | null; provenance?: string };
    out?: { status: 'EARLY' | 'ON_TIME' | 'LATE' | 'UNKNOWN'; deltaDays: number | null; actualDate?: string | null; dueDate?: string | null; provenance?: string };
  } | null;
};

export type WinspeedInvoiceRef = {
  docuNo?: string;
  soInvID?: number | string;
  docuDate?: string;
  postID?: number | string;
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
  UsedAmt?: number;
  AvailableAmt?: number;
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
  /** attached by GET /rebate/claims/:id via an EMCust lookup; absent on the list endpoint */
  CustName?: string;
  ClaimAmt: number;
  RemainingAmt: number;
  CustomerRatio?: number;
  CompanyRatio?: number;
  CustomerAmount?: number;
  RetainedAmount?: number;
  IsSelfClaim?: boolean;
  PolicyVersionId?: number | null;
  Status: 'PENDING' | 'APPROVED' | 'TIER2_PENDING' | 'TIER3_PENDING' | 'TIER4_PENDING' | 'REJECTED';
  CnDocuNo?: string;
  Note?: string;
  /** wf.RebateClaim.PeriodYear / PeriodMonth — nullable since migration 079 */
  PeriodYear?: number | null;
  PeriodMonth?: number | null;
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
  expiryDate?: string;
  daysLeft?: number;
  isExpired?: boolean;
  isExpiringSoon?: boolean;
  beneficiaries?: Array<{
    id: number;
    beneficiaryCustId: string;
    beneficiaryCustCode?: string;
    beneficiaryCustName: string;
  }>;
};

export type CouponWorklistRow = {
  couponId: number;
  couponNo: string;
  goodName: string;
  goodCode?: string;
  remaQty: number;
  goodQty: number;
  redeemedQty: number;
  docuDate: string;
  custId: string;
  custName: string;
  custCode?: string;
  ownerCustCode?: string;
  expiryDate: string;
  daysLeft: number;
  isExpired: boolean;
  isExpiringSoon: boolean;
  beneficiaries?: Array<{
    id: number;
    beneficiaryCustId: string;
    beneficiaryCustCode?: string;
    beneficiaryCustName: string;
  }>;
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
  GoodID?: string;
  GoodCode?: string;
  GoodName?: string;
  Brand: string;       // รถเกษตร / ปุ๋ยเทพ / ส่วนกลาง
  ItemName: string;    // "16-8-8" / "เสื้อยืดแขนยาว" / "แบนเนอร์ รถเกษตร"
  ItemType: 'BAG' | 'SHIRT' | 'BANNER' | 'OTHER';
  StockQty?: number;
  RemaQty?: number;
  BagPerTon?: number;
  WeightKgPerBag?: number;
  ImageUrl?: string | null;
  Unit?: string;
  Inactive?: 'A' | 'I';
};

export type GiveawayRegion = {
  Region: string;
  RegionCode?: string | null;
  RegionLabel?: string | null;
  SalesUserId?: number | null;
  DisplayName?: string | null;
  EmpCode: string | null;
  EmpId: string | null;
  EmpName: string | null;
  PositionCode?: string | null;
  PositionName?: string | null;
  OrgUnit?: string | null;
  TotalBudget: number;
  TotalWithdrawn: number;
  TotalRemaining: number;
  ItemCount: number;
  OverCount: number;
  OverQty: number;
  HasQuota?: boolean;
};

export type GiveawayBudgetLine = {
  Id: number;
  Region: string;
  RegionCode?: string | null;
  SalesUserId?: number | null;
  SalesUserName?: string | null;
  SalesPositionCode?: string | null;
  SalesPositionName?: string | null;
  PeriodYear: number;
  Brand: string;
  ItemName: string;
  GoodId?: string | null;
  GoodCode?: string | null;
  GoodName?: string | null;
  BudgetQty: number;
  WithdrawnQty: number;
  RemainingQty: number;
  EmpId: string | null;
  EmpCode: string | null;
};

export type GiveawayWithdrawal = {
  Id: number;
  SalesUserId?: number | null;
  Region: string;
  PeriodYear: number;
  IssueMonth: number | null;
  Brand: string;
  ItemName: string;
  GoodId?: string | null;
  GoodCode?: string | null;
  GoodName?: string | null;
  Qty: number;
  CustId: string | null;
  Note: string | null;
  Source: 'IMPORT' | 'APP';
  CreatedAt: string;
};

export type GiveawayOrgRoster = {
  regions: { RegionCode: string; RegionName: string; Description?: string | null; IsActive?: boolean }[];
  staff: {
    UserId: number;
    Username: string;
    DisplayName: string;
    Role: string;
    EmpId: string | null;
    EmpCode: string | null;
    EmpName: string | null;
    PositionCode: string | null;
    PositionName: string | null;
    OrgUnit: string | null;
    RegionCode: string | null;
    RegionName: string;
  }[];
};

// ── New Rebate Pool & FIFO Fertilizer Ticket Conversion ──────────
export type RebatePricingMode =
  | 'CASE_A_CASH_DISCOUNT'
  | 'CASE_B_TIER1_AUTO'
  | 'CASE_B_TIER2_APPROVAL'
  | 'CASE_C_AT_BASE'
  | 'CASE_C_MARKUP_REWARD';

export type RebatePoolApprovalStatus =
  | 'NOT_REQUIRED'
  | 'PENDING_MANAGER_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

export type RebatePoolLedgerStatus =
  | 'ACTIVE'
  | 'PARTIALLY_CONVERTED'
  | 'CONVERTED'
  | 'READY_FOR_CONVERSION'
  | 'CANCELLED';

export type RebateCalculationResult = {
  basePrice: number;
  sellingPrice: number;
  qtyTons: number;
  isCashDiscount: boolean;
  invoiceUnitPrice: number;
  rebatePerTon: number;
  totalRebateEarned: number;
  companyExtraProfitPerTon: number;
  totalCompanyExtraProfit: number;
  requiresManagerApproval: boolean;
  excessApprovalAmount: number;
  totalExcessApprovalAmount: number;
  approvalStatus: RebatePoolApprovalStatus;
  pricingMode: RebatePricingMode;
};

export type RebatePoolLedgerEntry = {
  id: number;
  soId: number | null;
  soLineId: number | null;
  docNo: string | null;
  custId: number;
  custCode: string | null;
  custName: string | null;
  goodId: number | null;
  goodCode: string | null;
  goodName: string | null;
  qtyTons: number;
  basePrice: number;
  sellingPrice: number;
  invoiceUnitPrice: number;
  isCashDiscount: boolean;
  pricingMode: RebatePricingMode;
  rebatePerTon: number;
  totalRebateEarned: number;
  companyExtraProfitPerTon: number;
  totalCompanyExtraProfit: number;
  remainingAmount: number;
  requiresManagerApproval: boolean;
  excessApprovalAmount: number;
  approvalStatus: RebatePoolApprovalStatus;
  approvedByUserId: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  earnedDate: string;
  cycleExpiryDate: string;
  status: RebatePoolLedgerStatus;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type RebateCustomerQueue = {
  custId: number;
  asOfDate: string;
  maturedBalance: number;
  activeUnmaturedBalance: number;
  totalFifoEligibleBalance: number;
  pendingApprovalBalance: number | null;
  withoutPlanCount: number;
  openingEligibleBalance: number;
  openingEligibleCount: number;
  detailLimit: number;
  eligibleLedgers: { id: string; docNo: string | null; earnedDate: string | null;
    cycleExpiryDate: string | null; remainingAmount: number }[];
};

export type Oct31StandingPriceItem = {
  id: number;
  standingYear: number;
  goodId: number;
  goodCode: string | null;
  goodName: string | null;
  basePrice: number;
  standingDate: string;
  sourceType: string;
  capturedByUserId: number | null;
  capturedAt: string;
  note: string | null;
};

export type RebateConversionAlertItem = {
  Id: number | string;
  AlertYear: number;
  CustId: number;
  CustCode: string | null;
  CustName: string | null;
  MaturedBalance: number;
  LedgerCount: number;
};

export type RebateConversionRecord = {
  id: number;
  conversionNo: string;
  custId: number;
  custCode: string | null;
  custName: string | null;
  goodId: number;
  goodCode: string | null;
  goodName: string | null;
  standingYear: number;
  standingPricePerTon: number;
  convertedTons: number;
  convertedValueBaht: number;
  executionMode: string;
  allocations: { ledgerId: number | null; sourceSOID?: number; sourceListNo?: number; qtyTon?: number;
    docNo: string | null; earnedDate: string | null; deductedAmount: number; remainingAfter: number | null }[];
  note: string | null;
  convertedByUserId: number | null;
  convertedByRole: string | null;
  convertedAt: string;
};

// ── Quotation (ใบเสนอราคา) ────────────────────────────────────
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';

export type QuotationLine = {
  Id?: number;
  LineNum?: number;
  GoodId: string;
  GoodCode: string;
  GoodName: string;
  GoodGroupID?: number | null;
  GoodGroupName?: string | null;
  IsMaePui?: boolean;
  QtyTon: number;
  PricePerTon: number;
  NetPricePerTon: number;
  LineAmount?: number;
  IsGiveaway?: boolean;
  // เติมจาก SO ต้นทางใน GET /quotation/:id (มีเมื่อสร้างจาก SO)
  MasterQty?: number;
  ChildQty?: number;
  LoadSequence?: number;
};

export type Quotation = {
  Id: number;
  IsNativeOnly?: boolean;
  HasMaePui?: boolean;
  MaePuiMaxValidDays?: number;
  QuoteNo: string;
  CustId: string;
  CustName: string;
  ValidUntil?: string;
  Status: QuoteStatus;
  SalesUserId?: number | null;
  SalesName?: string;
  ConvertedSoId?: number;
  ConvertedWfRef?: string | null;
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
  // เติมจาก SO ต้นทางใน GET /quotation/:id (มีเมื่อสร้างจาก SO)
  TruckPlate?: string;
  TranspId?: number;
  CreditDays?: number;
  IsOwnTruck?: boolean;
  NoTruckRequired?: boolean;
  PSling?: boolean;
  DeliveryDate?: string;
  TruckRemark?: string;
  BillRemark?: string;
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
  docuType?: number;
  totalQtyTon?: number;
  drawnQtyTon?: number;
  qtyTon: number;
  lineCnt: number;
  daysOpen: number;
  copyCnt?: number;
  lostCnt?: number;
  verifiedAt?: string | null;
  tripId?: number | null;
  soPrefix?: string;
  noTruckRequired?: boolean | number;
  ticketExpiryDate?: string | null;
  ticketDaysLeft?: number | null;
  couponNo?: string | null;
  beneficiaryCustName?: string | null;
  ownerCustCode?: string | null;
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
  CustDocName?: string | null;
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
  MaxWeightMain: number;
  MaxWeightTrailer?: number | null;
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
  DocuNo: string;
  AppvDocuNo?: string;
  DisplayDocuNo: string;
  BookingDocuNo?: string;
  DeliveryDocuNo?: string;
  DocuDate: string;
  CustID: string;
  CustName: string;
  TruckPlate?: string;
  AppvFlag?: string;
  AppvDate?: string;
  DocuStatus?: string;
  TotalQtyTon: number;
  DrawnQtyTon: number;
  CouponID?: number;
  CouponNo?: string;
  GoodID?: number;
  GoodCode?: string;
  GoodName?: string;
  GoodPrice?: number;
  GoodUnitName?: string;
  IssuedQtyTon?: number;
  NativeRemainingQtyTon?: number;
  ReservedQtyTon?: number;
  AvailableQtyTon?: number;
  BalanceState?: 'POSITIVE' | 'RESERVED_FULL' | 'ZERO' | 'NEGATIVE' | 'UNKNOWN';
  Lifecycle?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED_NOT_ISSUED' | 'ISSUED' | 'CANCELLED' | 'UNKNOWN';
  ExpiryState?: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'UNKNOWN';
  Eligibility?: 'ELIGIBLE' | 'WARNING' | 'BLOCKED' | 'UNKNOWN';
  Reasons?: string[];
  expiryDate?: string | null;
  expiryStatus?: string;
  daysRemaining?: number | null;
  strictMode?: boolean;
  strictOverride?: boolean;
  isBlocked?: boolean;
  isSpendable?: boolean;
  entityType?: 'COUPON' | 'BOOKING' | 'DRAFT' | string;
  exactId?: number;
  entityKey?: string;
  warning?: string | null;
  error?: string | null;
  customerCandidate?: any;
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

/** Row of wf.v_GiveawayBudgetStatus as returned by GET /giveaway/my-quota */
export type GiveawayQuota = {
  Brand: string;
  ItemName: string;
  RemainingQty: number;
};

export interface PendingGiveaway {
  SoId: number;
  LineNum: number;
  GoodName: string;
  QtyTon: number;
  QtyBag: number;
  WfRef: string;
  CustName: string;
  CreatedAt: string;
  CreatedByName: string;
}

// ── ยอดสะสมรีเบท (อ่านจาก WINSpeed โดยตรง — ไม่มีสำเนาในแอป) ──────────────────
// รูปร่างตรงกับ view wf.v_RebateAccrualRemaining ดู migration 076
export interface RebateAccrualSummary {
  CustId: string;
  CustName: string | null;
  CustCode: string | null;
  RegionCode: string | null;
  SalesEmpId: number | null;
  SalesEmpName: string | null;
  LotCount: number;
  RemainingTon: number;
  RemainingAmt: number;
  OpeningTon: number;
  OpeningAmt: number;
  /** ตันที่ยังไม่มีแบบขออนุมัติรายการส่งเสริมการขายครอบคลุม — คิดเป็นเงินไม่ได้ */
  TonWithoutPlan: number;
  OldestDate: string | null;
}

/** หนึ่งล็อต = หนึ่งบรรทัดของใบส่งของ (DocuType 104) = หน่วยที่ตัดสิทธิ์แบบ FIFO */
export interface RebateAccrualLot {
  SourceSOID: number;
  SourceListNo: number;
  SourceDocuNo: string;
  SourceDocuDate: string;
  TaxInvoiceNo: string | null;
  CouponNo: string | null;
  CustId: string;
  CustName: string | null;
  RegionCode: string | null;
  SalesEmpId: number | null;
  SalesEmpName: string | null;
  GoodID: number;
  GoodCode: string;
  GoodName: string | null;
  QtyTon: number;
  ListPricePerTon: number;
  /** null = ยังไม่มีแผนส่งเสริมการขายที่อนุมัติแล้วครอบคลุมล็อตนี้ */
  NetPricePerTon: number | null;
  RebatePerTon: number | null;
  PlanId: number | null;
  PlanNo: string | null;
  RemainingTon: number;
  RemainingAmt: number | null;
}

export interface RebateOpeningBalance {
  GoodCode: string;
  GoodName: string | null;
  RemainingTon: number;
  RemainingAmt: number | null;
}

// ── WF Rebate Trail (เส้นทางเอกสารรีเบทฝั่ง WINSpeed — อ่านอย่างเดียว) ─────────
// เดิมถูก import โดยไม่มีการประกาศ ทำให้ tsc ฟ้อง 6 ข้อ (vite build ไม่ typecheck จึงไม่พัง)
export interface WfRebateTrailSummary {
  EmpID: number;
  SalesName: string;
  OrderCount: number;
  CouponCount: number;
  CouponTon: number;
  RedeemedTon: number;
  RemainingTon: number;
  RedemptionCount: number;
  InvoiceCount: number;
  FirstDocuDate: string | null;
  LastDocuDate: string | null;
}

// หน้าจอนี้แสดงผลดิบจากหลายตารางของ WINSpeed จึงเปิด index signature ไว้
// (ไม่ได้ตั้งใจให้หลวม — คอลัมน์มาจาก SELECT ที่เปลี่ยนได้ตามเอกสารที่ผูกกัน)
export interface WfRebateTrailRow {
  SOID: number;
  SONo: string;
  DocuDate: string | null;
  CustID: string | number | null;
  CustName: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface WfRebateTrailDetail {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
