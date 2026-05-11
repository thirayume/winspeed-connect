// Mock API layer. Each function returns a Promise that resolves after ~1s.
// Replace with real SQL Server Express calls later — signatures stay the same.
import { nextSOID, useErpStore } from "@/store/erp-store";
import type {
  EMCust,
  EMGood,
  POWithDetails,
  SODT,
  SOHD,
  SOStatus,
  SOWithDetails,
  UnlockRequest,
} from "./winspeed-types";

const delay = <T>(value: T, ms = 1000): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const listCustomers = (): Promise<EMCust[]> =>
  delay(useErpStore.getState().customers, 300);

export const listItems = (): Promise<EMGood[]> =>
  delay(useErpStore.getState().items, 300);

export const listSOs = (): Promise<SOWithDetails[]> => {
  const { soHeaders, soDetails } = useErpStore.getState();
  const data: SOWithDetails[] = soHeaders.map((h) => ({
    ...h,
    lines: soDetails.filter((d) => d.SOID === h.SOID),
  }));
  return delay(data, 600);
};

export const createSO = async (payload: {
  CustID: string;
  lines: Omit<SODT, "SOID" | "ListNo">[];
}): Promise<SOHD> => {
  const state = useErpStore.getState();
  const SOID = nextSOID(state.soHeaders.map((h) => h.SOID));
  const header: SOHD = {
    SOID,
    CustID: payload.CustID,
    DocuDate: new Date().toISOString().slice(0, 10),
    Status: "Draft",
  };
  state.addSO(
    header,
    payload.lines.map((l, i) => ({ ...l, SOID, ListNo: i + 1 })),
  );
  return delay(header);
};

export const updateSOStatus = async (
  SOID: string,
  status: SOStatus,
): Promise<{ SOID: string; status: SOStatus }> => {
  useErpStore.getState().setSOStatus(SOID, status);
  return delay({ SOID, status });
};

export const requestUnlock = async (SOID: string): Promise<UnlockRequest> => {
  const req = useErpStore.getState().addUnlockRequest(SOID);
  return delay(req);
};

export const approveUnlock = async (id: string): Promise<{ ok: true }> => {
  useErpStore.getState().resolveUnlockRequest(id);
  return delay({ ok: true });
};

export const listPOs = (): Promise<POWithDetails[]> => {
  const { poHeaders, poDetails } = useErpStore.getState();
  const data: POWithDetails[] = poHeaders.map((h) => ({
    ...h,
    lines: poDetails.filter((d) => d.POID === h.POID),
  }));
  return delay(data, 600);
};

export const receivePO = async (
  POID: string,
  lines: { GoodID: string; GoodQty1: number }[],
): Promise<{ POID: string }> => {
  useErpStore.getState().receivePO(POID, lines);
  return delay({ POID });
};

export const syncToWINSpeed = async (
  entity: "SO" | "PO",
  id: string,
): Promise<{ entity: string; id: string; syncedAt: string }> => {
  // eslint-disable-next-line no-console
  console.info(`[WINSpeed] sync ${entity} ${id}`);
  return delay({ entity, id, syncedAt: new Date().toISOString() });
};
