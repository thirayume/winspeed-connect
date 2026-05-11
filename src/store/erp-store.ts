import { create } from "zustand";
import type {
  EMCust,
  EMGood,
  EMVendor,
  POHD,
  PODT,
  SODT,
  SOHD,
  SOStatus,
  UnlockRequest,
} from "@/services/winspeed-types";

type State = {
  customers: EMCust[];
  vendors: EMVendor[];
  items: EMGood[];
  soHeaders: SOHD[];
  soDetails: SODT[];
  poHeaders: POHD[];
  poDetails: PODT[];
  unlockRequests: UnlockRequest[];
};

type Actions = {
  addSO: (header: SOHD, lines: Omit<SODT, "SOID">[]) => void;
  setSOStatus: (soid: string, status: SOStatus) => void;
  addUnlockRequest: (soid: string) => UnlockRequest;
  resolveUnlockRequest: (id: string) => void;
  receivePO: (poid: string, lines: { GoodID: string; GoodQty1: number }[]) => void;
};

const today = "2026-05-11";

export const useErpStore = create<State & Actions>((set, get) => ({
  customers: [
    { CustID: "C001", CustName: "Acme Corp" },
    { CustID: "C002", CustName: "Globex Industries" },
    { CustID: "C003", CustName: "Initech Manufacturing" },
    { CustID: "C004", CustName: "Stark Engineering" },
  ],
  vendors: [
    { VendorID: "V001", VendorName: "Nippon Steel Supply" },
    { VendorID: "V002", VendorName: "Pacific Components Ltd" },
  ],
  items: [
    { GoodID: "G001", GoodName1: "Steel Pipe 2 inch", GoodPrice1: 1500 },
    { GoodID: "G002", GoodName1: "Steel Plate 10mm", GoodPrice1: 3200 },
    { GoodID: "G003", GoodName1: "Galvanized Bolt M12", GoodPrice1: 25 },
    { GoodID: "G004", GoodName1: "Copper Wire Roll", GoodPrice1: 8400 },
    { GoodID: "G005", GoodName1: "Aluminum Bracket", GoodPrice1: 540 },
  ],
  soHeaders: [
    { SOID: "SO26-001", CustID: "C001", DocuDate: today, Status: "Confirmed" },
    { SOID: "SO26-002", CustID: "C002", DocuDate: today, Status: "Picking" },
    { SOID: "SO26-003", CustID: "C003", DocuDate: today, Status: "Draft" },
    { SOID: "SO26-004", CustID: "C001", DocuDate: "2026-05-09", Status: "Shipped" },
    { SOID: "SO26-005", CustID: "C004", DocuDate: today, Status: "Confirmed" },
  ],
  soDetails: [
    { SOID: "SO26-001", ListNo: 1, GoodID: "G001", GoodQty1: 10, GoodPrice1: 1500 },
    { SOID: "SO26-001", ListNo: 2, GoodID: "G003", GoodQty1: 100, GoodPrice1: 25 },
    { SOID: "SO26-002", ListNo: 1, GoodID: "G002", GoodQty1: 5, GoodPrice1: 3200 },
    { SOID: "SO26-003", ListNo: 1, GoodID: "G004", GoodQty1: 2, GoodPrice1: 8400 },
    { SOID: "SO26-004", ListNo: 1, GoodID: "G005", GoodQty1: 50, GoodPrice1: 540 },
    { SOID: "SO26-005", ListNo: 1, GoodID: "G001", GoodQty1: 25, GoodPrice1: 1500 },
    { SOID: "SO26-005", ListNo: 2, GoodID: "G002", GoodQty1: 8, GoodPrice1: 3200 },
  ],
  poHeaders: [
    { POID: "PO26-001", VendorID: "V001", DocuDate: today, Status: "Pending Receipt" },
    { POID: "PO26-002", VendorID: "V002", DocuDate: today, Status: "Pending Receipt" },
    { POID: "PO26-003", VendorID: "V001", DocuDate: "2026-05-08", Status: "Received" },
  ],
  poDetails: [
    { POID: "PO26-001", ListNo: 1, GoodID: "G001", GoodQty1: 200, GoodPrice1: 1400 },
    { POID: "PO26-001", ListNo: 2, GoodID: "G002", GoodQty1: 50, GoodPrice1: 3000 },
    { POID: "PO26-002", ListNo: 1, GoodID: "G004", GoodQty1: 30, GoodPrice1: 8000 },
    { POID: "PO26-003", ListNo: 1, GoodID: "G005", GoodQty1: 100, GoodPrice1: 510 },
  ],
  unlockRequests: [],

  addSO: (header, lines) =>
    set((s) => ({
      soHeaders: [header, ...s.soHeaders],
      soDetails: [
        ...s.soDetails,
        ...lines.map((l, i) => ({ ...l, SOID: header.SOID, ListNo: i + 1 })),
      ],
    })),

  setSOStatus: (soid, status) =>
    set((s) => ({
      soHeaders: s.soHeaders.map((h) => (h.SOID === soid ? { ...h, Status: status } : h)),
    })),

  addUnlockRequest: (soid) => {
    const req: UnlockRequest = {
      id: `UR-${Date.now()}`,
      SOID: soid,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    set((s) => ({ unlockRequests: [req, ...s.unlockRequests] }));
    return req;
  },

  resolveUnlockRequest: (id) => {
    const req = get().unlockRequests.find((r) => r.id === id);
    if (!req) return;
    set((s) => ({
      unlockRequests: s.unlockRequests.map((r) =>
        r.id === id ? { ...r, resolved: true } : r,
      ),
      soHeaders: s.soHeaders.map((h) =>
        h.SOID === req.SOID ? { ...h, Status: "Draft" as SOStatus } : h,
      ),
    }));
  },

  receivePO: (poid) =>
    set((s) => ({
      poHeaders: s.poHeaders.map((h) =>
        h.POID === poid ? { ...h, Status: "Received" } : h,
      ),
    })),
}));

export const nextSOID = (existing: string[]): string => {
  const nums = existing
    .map((s) => parseInt(s.split("-")[1] ?? "0", 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `SO26-${String(next).padStart(3, "0")}`;
};
