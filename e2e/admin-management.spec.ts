import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";

test("user editor preserves multiple roles and saves the full selection with a snapshot", async ({
  page,
}) => {
  const row = page
    .getByText("@fixture-1", { exact: true })
    .locator("xpath=ancestor::tr");
  await row.getByTitle("แก้ไข", { exact: true }).click();
  const d = page.getByRole("dialog", { name: "แก้ไขผู้ใช้งาน" });
  await expect(
    d.getByLabel("เปิดใช้งาน (Active)", { exact: false }),
  ).toBeChecked();
  await expect(d.locator('input[name="password"]')).toHaveCount(0);
  await d.getByLabel("ชื่อที่แสดง", { exact: true }).fill("ชื่อแก้ไข");
  await d.getByRole("tab", { name: "บทบาท (2)", exact: true }).click();
  await expect(
    d.getByRole("checkbox", { name: "SALES (SALES)", exact: true }),
  ).toBeChecked();
  await expect(
    d.getByRole("checkbox", { name: "C_LEVEL (C_LEVEL)", exact: true }),
  ).toBeChecked();
  await d
    .getByRole("checkbox", { name: "SALES_CUSTOM (SALES_CUSTOM)", exact: true })
    .check();
  await page.screenshot({
    path: "test-results/admin-management/user-editor-roles.png",
  });
  await d.getByRole("tab", { name: "ข้อมูลติดต่อ", exact: true }).click();
  await d.getByLabel("เบอร์โทร", { exact: true }).fill("0000000000");
  await d.getByRole("tab", { name: "บัญชีผู้ใช้", exact: true }).click();
  await expect(d.getByLabel("ชื่อที่แสดง", { exact: true })).toHaveValue(
    "ชื่อแก้ไข",
  );
  const request = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith("/auth/users/2"),
  );
  await d.getByRole("button", { name: "บันทึกการแก้ไข", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    displayName: "ชื่อแก้ไข",
    isActive: true,
    phone: "0000000000",
    roleCodes: ["SALES", "C_LEVEL", "SALES_CUSTOM"],
    expectedRoleCodes: ["SALES", "C_LEVEL"],
  });
});

test("new user can select multiple roles and contact details before a single save on mobile", async ({
  page,
}) => {
  await page.getByTitle("เพิ่มผู้ใช้งาน", { exact: true }).click();
  const d = page.getByRole("dialog", { name: "เพิ่มผู้ใช้งานใหม่" });
  await d
    .getByLabel("Username (ใช้ Login)", { exact: true })
    .fill("fixture-create");
  await d.getByLabel("ชื่อที่แสดง", { exact: true }).fill("บัญชีทดสอบ");
  await d
    .getByLabel("รหัสผ่านชั่วคราว", { exact: false })
    .fill(randomBytes(24).toString("base64url"));
  await d.getByRole("tab", { name: "บทบาท (1)", exact: true }).click();
  await d
    .getByRole("checkbox", { name: "C_LEVEL (C_LEVEL)", exact: true })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-management/user-editor-mobile.png",
  });
  await d.getByRole("tab", { name: "ข้อมูลติดต่อ", exact: true }).click();
  await d.getByLabel("อีเมล", { exact: true }).fill("fixture@example.invalid");
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/auth/users"),
  );
  await d.getByRole("button", { name: "สร้างผู้ใช้ใหม่", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.roleCodes).toEqual(["SALES", "C_LEVEL"]);
  expect(body.email).toBe("fixture@example.invalid");
  expect(body).not.toHaveProperty("role");
});

test("role member commands preselect the current role and the intended add or remove mode", async ({
  page,
}) => {
  await page.getByRole("button", { name: "roles", exact: true }).click();
  await page
    .getByRole("button", { name: /SALES.*ต้นแบบ/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "สมาชิก (6)" }).click();
  await page.getByLabel("ค้นหาสมาชิก", { exact: true }).fill("fixture-1");
  await page.getByLabel("เลือกสมาชิก fixture-1", { exact: true }).check();
  await page
    .getByRole("button", { name: "จัดการที่เลือก (1)", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await expect(d.getByLabel("รูปแบบเปลี่ยน Role")).toHaveValue("remove");
  await expect(
    d.getByRole("checkbox", { name: "SALES (SALES)", exact: true }),
  ).toBeChecked();
  await d.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มสมาชิก", exact: true }).click();
  await page.getByLabel("ค้นหาสมาชิก", { exact: true }).fill("fixture-2");
  await page.getByLabel("เลือกสมาชิก fixture-2", { exact: true }).check();
  await page
    .getByRole("button", { name: "จัดการที่เลือก (1)", exact: true })
    .click();
  d = page.getByRole("dialog");
  await expect(d.getByLabel("รูปแบบเปลี่ยน Role")).toHaveValue("add");
  await expect(
    d.getByRole("checkbox", { name: "SALES (SALES)", exact: true }),
  ).toBeChecked();
});

const users = Array.from({ length: 7 }, (_, i) => ({
  Id: i + 1,
  Username: i === 0 ? "fixture-admin" : `fixture-${i}`,
  DisplayName: i === 0 ? "ผู้ดูแลทดสอบ" : `พนักงานทดสอบ ${i}`,
  Role: i === 0 ? "ADMIN" : "SALES",
  IsActive: i !== 6,
  RoleCodes: i === 0 ? ["ADMIN"] : i === 1 ? ["SALES", "C_LEVEL"] : ["SALES"],
  EmpId: null,
  EmpCode: null,
}));
const roles = ["SALES", "ADMIN", "C_LEVEL", "SALES_CUSTOM"].map((Code) => ({
  Code,
  Name: Code,
  BaseRole: Code === "SALES_CUSTOM" ? "SALES" : Code,
  permissions:
    Code === "ADMIN"
      ? ["so.create", "quotation.create", "users.manage"]
      : ["so.create", "quotation.create"],
  MemberCount: Code === "SALES" ? 6 : 1,
  Revision: 0,
}));

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith("/auth/users")) data = users;
    else if (path.endsWith("/admin-management/roles"))
      data = {
        roles,
        actions: {
          "so.create": ["SALES", "ADMIN"],
          "quotation.create": ["SALES", "ADMIN"],
          "users.manage": ["ADMIN"],
        },
        menus: { sales: ["SALES", "ADMIN"] },
        editable: ["so.create", "quotation.create", "users.manage"],
      };
    else if (path.endsWith("/members"))
      data = users
        .filter((u) => u.Role === "SALES")
        .map((u) => ({ ...u, RoleCode: "SALES" }));
    else if (path.includes("/admin-management/roles/")) data = { ok: true };
    else if (path.endsWith("/users/batch"))
      data = {
        ok: true,
        count: route.request().postDataJSON().ids.length,
        credentials: [],
      };
    else if (path.endsWith("/readiness-signoff"))
      data = {
        database: "FIXTURE_UAT",
        topics: [
          {
            code: "SALES",
            title: "ผูกพนักงานและเข้าใช้ครั้งแรก",
            team: "ฝ่ายขาย + IT",
            hint: "บันทึกผลทดสอบ",
            current: null,
          },
        ],
      };
    else if (path.endsWith("/system-settings"))
      data = { raw: {}, settings: {}, currentRevision: 1 };
    else if (path.endsWith("/auth/databases")) data = { canSetSystem: false };
    await route.fulfill({ json: data });
  });
  await page.goto("/test-harnesses/admin-management.html");
});

test("active default, inactive opt-in and five-user batch preserves exact selection", async ({
  page,
}) => {
  await expect(page.getByText("@fixture-5", { exact: true })).toBeVisible();
  await expect(page.getByText("@fixture-6", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("เลือก fixture-admin", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "ผลตรวจรับงาน", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("แสดง Active + Inactive").check();
  await expect(page.getByText("@fixture-6", { exact: true })).toBeVisible();
  await page.getByLabel("แสดง Active + Inactive").uncheck();
  for (let i = 1; i <= 5; i++)
    await page.getByLabel(`เลือก fixture-${i}`, { exact: true }).check();
  await page
    .getByRole("button", { name: "จัดการที่เลือก (5)", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("คำสั่ง", { exact: true }).selectOption("clear-line");
  await expect(
    dialog.getByRole("button", { name: "ยืนยันดำเนินการ" }),
  ).toBeDisabled();
  await dialog.getByLabel("ตรวจรายชื่อและยืนยันคำสั่งนี้แล้ว").check();
  const request = page.waitForRequest((r) => r.url().endsWith("/users/batch"));
  await dialog.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    ids: [2, 3, 4, 5, 6],
    action: "clear-line",
  });
  await expect(dialog.getByRole("status")).toHaveText("สำเร็จ 5 คน");
  await dialog.getByRole("button", { name: "ปิดผลลัพธ์" }).click();
  await page.screenshot({
    path: "test-results/admin-management/users-desktop.png",
  });
});

test("create ADMIN-based role with fully editable permissions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "roles", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่ม Role", exact: true }).click();
  await page.getByLabel("รหัส Role", { exact: true }).fill("SALES");
  await expect(
    page.getByRole("button", { name: "บันทึก Role", exact: true }),
  ).toBeDisabled();
  // A conflicting name must not lock the input, so the operator can correct it.
  await page.getByLabel("รหัส Role", { exact: true }).fill("SALES_TRAINING");
  await page.getByLabel("ชื่อ Role", { exact: true }).fill("ฝ่ายขายฝึกอบรม");
  await page.getByLabel("บทบาทต้นแบบ", { exact: true }).selectOption("ADMIN");
  await page.getByRole("checkbox", { name: /สร้างใบเสนอราคา/ }).uncheck();
  await expect(
    page.getByRole("checkbox", { name: /จัดการผู้ใช้/ }),
  ).toBeEnabled();
  await page.getByRole("checkbox", { name: /จัดการผู้ใช้/ }).uncheck();
  const request = page.waitForRequest((r) => r.method() === "PUT");
  await page.getByRole("button", { name: "บันทึก Role", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    code: "SALES_TRAINING",
    baseRole: "ADMIN",
    permissions: ["so.create"],
  });
  await expect(page.getByRole("status")).toContainText("บันทึก Role แล้ว");
  await page.getByRole("button", { name: "เพิ่ม Role", exact: true }).click();
  await page.screenshot({
    path: "test-results/admin-management/roles-desktop.png",
  });
});

test("App Settings keeps readiness input on tab changes and fits mobile", async ({
  page,
}) => {
  await page.getByRole("button", { name: "settings", exact: true }).click();
  await page.getByRole("tab", { name: "ผลตรวจรับงาน", exact: true }).click();
  const reviewer = page.getByLabel("ผู้รับรอง", { exact: true });
  await reviewer.fill("ผู้ทดสอบ");
  await page
    .getByRole("tab", { name: "ตั้งค่านโยบายระบบ", exact: true })
    .click();
  await page.getByRole("tab", { name: "ผลตรวจรับงาน", exact: true }).click();
  await expect(reviewer).toHaveValue("ผู้ทดสอบ");
  await page.screenshot({
    path: "test-results/admin-management/settings-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/admin-management/settings-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "users", exact: true }).click();
  await expect(page.getByLabel("แสดง Active + Inactive")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-management/users-mobile.png",
  });
});

test("five selected users can receive a union of roles without replacing existing roles", async ({
  page,
}) => {
  for (let i = 1; i <= 5; i++)
    await page.getByLabel(`เลือก fixture-${i}`, { exact: true }).check();
  await page
    .getByRole("button", { name: "จัดการที่เลือก (5)", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("รูปแบบเปลี่ยน Role")).toHaveValue("add");
  await d.getByRole("checkbox", { name: "ADMIN (ADMIN)", exact: true }).check();
  await d.getByRole("checkbox", { name: "SALES (SALES)", exact: true }).check();
  await d.getByLabel("ตรวจรายชื่อและยืนยันคำสั่งนี้แล้ว").check();
  const request = page.waitForRequest((r) => r.url().endsWith("/users/batch"));
  await d.getByRole("button", { name: "ยืนยันดำเนินการ" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    ids: [2, 3, 4, 5, 6],
    roleCodes: ["ADMIN", "SALES"],
    roleMode: "add",
  });
});
test("role members include inactive users and prevent delete while assigned", async ({
  page,
}) => {
  await page.getByRole("button", { name: "roles", exact: true }).click();
  await page
    .getByRole("button", { name: /SALES.*ต้นแบบ/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "สมาชิก (6)" }).click();
  await expect(
    page.getByRole("heading", { name: "สมาชิก Role นี้ (6 คน)" }),
  ).toBeVisible();
  await expect(page.getByText("@fixture-6", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ลบ Role", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-management/role-members-mobile.png",
  });
});

test("new user can choose a role when the former SALES default was deleted", async ({
  page,
}) => {
  await page.route("**/api/admin-management/roles", (route) =>
    route.fulfill({ json: { roles: roles.filter((r) => r.Code !== "SALES") } }),
  );
  await page.getByTitle("เพิ่มผู้ใช้งาน", { exact: true }).click();
  const d = page.getByRole("dialog", { name: "เพิ่มผู้ใช้งานใหม่" });
  await d.getByRole("tab", { name: "บทบาท (0)", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "สร้างผู้ใช้ใหม่", exact: true }),
  ).toBeDisabled();
  await d
    .getByRole("checkbox", { name: "C_LEVEL (C_LEVEL)", exact: true })
    .check();
  await expect(
    d.getByRole("tab", { name: "บทบาท (1)", exact: true }),
  ).toBeVisible();
  await expect(
    d.getByRole("button", { name: "สร้างผู้ใช้ใหม่", exact: true }),
  ).toBeEnabled();
});
