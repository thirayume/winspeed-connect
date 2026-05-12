export const SCHEMA_VERSION = '3.0';

// Types mirror WINSpeed SQL columns so a future SQL adapter is a drop-in.
export type EMCust = {
  CustID: string;
  CustName: string;
  CustAddr1?: string;
};

export type EMGood = {
  GoodID: string;
  GoodCode?: string;
  GoodName1: string;
  GoodName?: string; // Standardized name
  Category?: string;
  GoodPrice1: number;
  Unit?: string;
  MainGoodUnitID?: string;
  StockQty?: number;
  DailyCapacity?: number;
};

export type EMVendor = {
  VendorID: string;
  VendorName: string;
};

export type SOStatus = "Draft" | "Confirmed" | "Picking" | "Shipped";
export type POStatus = "Pending Receipt" | "Received" | "Partially Received";

export type SOHD = {
  SOID: string;
  DocuNo?: string;
  CustID: string;
  CustName?: string;
  DocuDate: string;
  RequestedDate?: string;
  Status: SOStatus;
  TotalAmt?: number;
  EmpID?: string;
  BrchID?: string;
};

export type SODT = {
  SOID: string;
  ListNo: number;
  GoodID: string;
  GoodName?: string;
  GoodQty1: number;
  GoodPrice1: number;
  InveID?: string;
  StockQty?: number;
  DailyCapacity?: number;
};

export type POHD = {
  POID: string;
  DocuNo?: string;
  VendorID: string;
  DocuDate: string;
  Status: POStatus;
  TotalAmt?: number;
};

export type PODT = {
  POID: string;
  ListNo: number;
  GoodID: string;
  GoodQty1: number;
  GoodPrice1: number;
};

export type UnlockRequest = {
  id: string;
  SOID: string;
  createdAt: string;
  resolved: boolean;
};

export type SOWithDetails = SOHD & { lines: SODT[] };
export type POWithDetails = POHD & { lines: PODT[] };
