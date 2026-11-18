import { test, expect } from '@playwright/test';

// Review 18 Nov 2026: the accounting list and bill detail answer in the shapes of services/accounting-bills.js.
const row = {
  Id: 501, SOID: 501, WfRef: 'FIX-103-0001', CustCode: 'C001', CustName: 'ลูกค้าตัวอย่าง', DocuDate: '2026-11-17', DocuStatus: 'Y',
  TotalTon: 12, LineCount: 2, TruckPlate: 'TEST-1', TripId: 7, TripCode: 'TRIP-7', DriverName: 'คนขับตัวอย่าง', TripPlate: 'TEST-1',
  TripDate: '2026-11-17', TripStatus: 'CONFIRMED', MoveBill: 'MB-1', WeightIn: 10000, WeightOut: 22000, WeightNet: 12000,
  ScaleStatus: '3', ScaleDateOut: '2026-11-17 10:30', Delivery104No: 'FIX-104-0001', Delivery104Date: '2026-11-17', Delivery104Count: 1,
  Slip116No: 'FIX-116-0001', Slip116Date: '2026-11-17', Invoice107No: 'J-FIX-0001', Invoice107Date: '2026-11-17', PostGL: 'Y', InvoiceNetAmnt: 100000,
};
const detail = {
  header: { SOID: 501, BookingNo: 'FIX-103-0001', BookingDate: '2026-11-17', DocuStatus: 'Y', CustID: 1, CustCode: 'C001', CustName: 'ลูกค้าตัวอย่าง',
    TruckPlate: 'TEST-1', SalesEmpCode: 'S01', SalesEmpName: 'พนักงานตัวอย่าง', TripId: 7, TripCode: 'TRIP-7', TripPlate: 'TEST-1', DriverName: 'คนขับตัวอย่าง' },
  items: [{ ListNo: 1, GoodID: 1, GoodCode: 'G1', GoodName: 'ปุ๋ยตัวอย่าง', BagQty: 240, TonQty: 12, PricePerTon: 18000, Amount: 216000, NetAmnt: 216000, FreeFlag: 'N' }],
  giveaways: [],
  scale: { Id: 1, MoveBill: 'MB-1', ScaleNo: null, TruckPlate: 'TEST-1', WeightIn: 10000, WeightOut: 22000, WeightNet: 12000, Status: '3',
    DateIn: '2026-11-17', TimeIn: '09:00:00', DateOut: '2026-11-17', TimeOut: '10:30:00' },
  trace: { Doc104: 'FIX-104-0001 (2026-11-17)', Doc116: 'FIX-116-0001 (2026-11-17)', Doc107: 'J-FIX-0001 (2026-11-17 · เล่ม J · GL Y)' },
  audit: [],
};

test('the accounting list loads, opens a bill in full, and says why an over-long range is refused', async ({ page }) => {
  let rangeTooLong = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/so/shipped-today')) {
      if (rangeTooLong) return route.fulfill({ status: 400, json: { message: 'เลือกช่วงวันที่ได้ไม่เกิน 93 วัน' } });
      return route.fulfill({ json: [row] });
    }
    if (url.pathname.endsWith('/so/501/accounting-detail')) return route.fulfill({ json: detail });
    return route.fulfill({ json: [] });
  });
  await page.goto('/tests/accounting.html');
  await page.getByRole('button', { name: 'FIX-103-0001' }).first().click();
  await expect(page.getByText('FIX-104-0001 (2026-11-17)')).toHaveCount(0); // documents sit on their own tab
  await expect(page.getByText('ปุ๋ยตัวอย่าง')).toBeVisible();

  rangeTooLong = true;
  await page.keyboard.press('Escape');
  await page.reload();
  // StrictMode in dev runs the first load twice, so the notice can appear twice here.
  await expect(page.getByText('โหลดรายการไม่สำเร็จ: เลือกช่วงวันที่ได้ไม่เกิน 93 วัน').first()).toBeVisible();
});
