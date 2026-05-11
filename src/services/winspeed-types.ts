// Types mirror WINSpeed SQL columns so a future SQL adapter is a drop-in.
export type EMCust = { CustID: string; CustName: string };
export type EMGood = { GoodID: string; GoodName1: string; GoodPrice1: number };
export type EMVendor = { VendorID: string; VendorName: string };

export type SOStatus = "Draft" | "Confirmed" | "Picking" | "Shipped";
export type POStatus = "Pending Receipt" | "Received";

export type SOHD = {
  SOID: string;
  CustID: string;
  DocuDate: string;
  Status: SOStatus;
};
export type SODT = {
  SOID: string;
  ListNo: number;
  GoodID: string;
  GoodQty1: number;
  GoodPrice1: number;
};

export type POHD = {
  POID: string;
  VendorID: string;
  DocuDate: string;
  Status: POStatus;
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
