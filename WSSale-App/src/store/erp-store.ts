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
} from "../types";

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
  setUnlockRequests: (reqs: UnlockRequest[]) => void;
  receivePO: (poid: string, lines?: { GoodID: string; GoodQty1: number }[]) => void;
};

const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

export const useErpStore = create<State & Actions>((set, get) => ({
  customers: [
    { CustID: "C001", CustName: "Acme Corp", CustAddr1: "123 Industrial Way" },
    { CustID: "C002", CustName: "Globex Industries", CustAddr1: "456 Commerce St" },
    { CustID: "C003", CustName: "Initech Manufacturing", CustAddr1: "789 Software Blvd" },
    { CustID: "C004", CustName: "Stark Engineering", CustAddr1: "101 Stark Tower" },
    { CustID: "C005", CustName: "Cyberdyne Systems", CustAddr1: "201 Future Way" },
    { CustID: "C006", CustName: "Wayne Enterprises", CustAddr1: "1007 Mountain Dr" },
  ],
  vendors: [
    { VendorID: "V001", VendorName: "Nippon Steel Supply" },
    { VendorID: "V002", VendorName: "Pacific Components Ltd" },
    { VendorID: "V003", VendorName: "Global Logistics Co" },
  ],
  items: [
    { GoodID: "G001", GoodName1: "Steel Pipe 2 inch", GoodPrice1: 1500, Unit: "PCS" },
    { GoodID: "G002", GoodName1: "Steel Plate 10mm", GoodPrice1: 3200, Unit: "SHT" },
    { GoodID: "G003", GoodName1: "Galvanized Bolt M12", GoodPrice1: 25, Unit: "BOX" },
    { GoodID: "G004", GoodName1: "Copper Wire Roll", GoodPrice1: 8400, Unit: "ROL" },
    { GoodID: "G005", GoodName1: "Aluminum Bracket", GoodPrice1: 540, Unit: "PCS" },
    { GoodID: "G006", GoodName1: "Hydraulic Pump X1", GoodPrice1: 12500, Unit: "UNIT" },
    { GoodID: "G007", GoodName1: "Industrial Valve 4\"", GoodPrice1: 4200, Unit: "PCS" },
  ],
  soHeaders: [
    { SOID: "1049", DocuNo: "SO6108-00001", CustID: "C001", DocuDate: "2018-08-24", Status: "Confirmed", TotalAmt: 17500 },
    { SOID: "SO26-002", DocuNo: "SO6402-00002", CustID: "C002", DocuDate: today, Status: "Picking", TotalAmt: 16000 },
    { SOID: "SO26-003", DocuNo: "SO6402-00003", CustID: "C003", DocuDate: today, Status: "Draft", TotalAmt: 16800 },
    { SOID: "SO26-004", DocuNo: "SO6402-00004", CustID: "C001", DocuDate: yesterday, Status: "Shipped", TotalAmt: 27000 },
    { SOID: "SO26-005", DocuNo: "SO6402-00005", CustID: "C004", DocuDate: today, Status: "Confirmed", TotalAmt: 63100 },
    { SOID: "SO26-006", DocuNo: "SO6402-00006", CustID: "C005", DocuDate: today, Status: "Draft", TotalAmt: 12500 },
    { SOID: "SO26-007", DocuNo: "SO6402-00007", CustID: "C006", DocuDate: yesterday, Status: "Confirmed", TotalAmt: 42000 },
  ],
  soDetails: [
    { SOID: "1049", ListNo: 1, GoodID: "G001", GoodQty1: 10, GoodPrice1: 1500 },
    { SOID: "1049", ListNo: 2, GoodID: "G003", GoodQty1: 100, GoodPrice1: 25 },
    { SOID: "SO26-002", ListNo: 1, GoodID: "G002", GoodQty1: 5, GoodPrice1: 3200 },
    { SOID: "SO26-003", ListNo: 1, GoodID: "G004", GoodQty1: 2, GoodPrice1: 8400 },
    { SOID: "SO26-004", ListNo: 1, GoodID: "G005", GoodQty1: 50, GoodPrice1: 540 },
    { SOID: "SO26-005", ListNo: 1, GoodID: "G002", GoodQty1: 10, GoodPrice1: 3200 },
    { SOID: "SO26-005", ListNo: 2, GoodID: "G004", GoodQty1: 3, GoodPrice1: 8400 },
    { SOID: "SO26-005", ListNo: 3, GoodID: "G005", GoodQty1: 11, GoodPrice1: 536.3636 },
    { SOID: "SO26-006", ListNo: 1, GoodID: "G006", GoodQty1: 1, GoodPrice1: 12500 },
    { SOID: "SO26-007", ListNo: 1, GoodID: "G007", GoodQty1: 10, GoodPrice1: 4200 },
  ],
  poHeaders: [
    { POID: "PO26-001", DocuNo: "PO6402-00001", VendorID: "V001", DocuDate: today, Status: "Pending Receipt", TotalAmt: 280000 },
    { POID: "PO26-002", DocuNo: "PO6402-00002", VendorID: "V002", DocuDate: today, Status: "Pending Receipt", TotalAmt: 240000 },
    { POID: "PO26-003", DocuNo: "PO6402-00003", VendorID: "V003", DocuDate: yesterday, Status: "Received", TotalAmt: 15000 },
  ],
  poDetails: [
    { POID: "PO26-001", ListNo: 1, GoodID: "G001", GoodQty1: 200, GoodPrice1: 1400 },
    { POID: "PO26-002", ListNo: 1, GoodID: "G004", GoodQty1: 30, GoodPrice1: 8000 },
    { POID: "PO26-003", ListNo: 1, GoodID: "G003", GoodQty1: 600, GoodPrice1: 25 },
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
      reason: "Mockup request for demo",
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
  setUnlockRequests: (reqs) => set({ unlockRequests: reqs }),

  receivePO: (poid, lines) =>
    set((s) => {
      // In a real app we'd update details with the actual received lines
      return {
        poHeaders: s.poHeaders.map((h) =>
          h.POID === poid ? { ...h, Status: "Received" } : h,
        ),
      };
    }),
}));

export const nextSOID = (existing: string[]): string => {
  const nums = existing
    .map((s) => parseInt(s.split("-")[1] ?? "0", 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `SO26-${String(next).padStart(3, "0")}`;
};
