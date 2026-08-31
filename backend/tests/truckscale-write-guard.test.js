/**
 * ตัวกันเขียนฐานเครื่องชั่งของจริง — assertWritableTarget
 *
 * มีเทสต์ชุดนี้เพราะตัวกันนี้ **เคยตายเงียบมาแล้ว**: `TS_PRODUCTION_HOSTS` ว่างเปล่า
 * ทั้งใน .env และ compose ทั้งสองไฟล์ ตัวกันจึงคืนค่าออกทันทีทุกครั้ง
 * และชุดทดสอบเคยเขียนแถวลงฐาน TruckScale จริงไปแล้ว 4 แถว โดยไม่มีใครรู้
 *
 * ตัวกันที่ไม่มีเทสต์คือตัวกันที่ไม่มีใครรู้ว่าตายไปตอนไหน
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const KEYS = ['NODE_ENV', 'TS_PRODUCTION_HOSTS', 'MYSQL_HOST', 'MYSQL_DATABASE'];
const MODULE = require.resolve('../services/truckscale-db');

/** โหลดโมดูลใหม่ทุกครั้ง เพราะบางค่าอ่านตอน import */
function guardWith(env) {
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  delete require.cache[MODULE];
  const { assertWritableTarget } = require(MODULE);
  try {
    assertWritableTarget();
    return null;                       // ผ่าน
  } catch (e) {
    return e;                          // ถูกกัน
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[MODULE];
  }
}

const blocked = env => {
  const e = guardWith(env);
  assert.ok(e, 'ควรถูกกัน แต่ผ่านไปได้');
  assert.equal(e.code, 'TS_WRITE_BLOCKED');
  return e;
};
const allowed = env => assert.equal(guardWith(env), null, 'ควรผ่าน แต่ถูกกัน');

test('ไม่ตั้ง TS_PRODUCTION_HOSTS = ไม่กันอะไรเลย (พฤติกรรมเดิม ตั้งใจให้เป็นแบบนี้)', () => {
  allowed({ NODE_ENV: 'test', MYSQL_HOST: 'reseau.proxy.rlwy.net', MYSQL_DATABASE: 'db_truckscale' });
});

test('production เขียนได้เสมอ แม้โฮสต์จะอยู่ในรายการ', () => {
  allowed({ NODE_ENV: 'production', TS_PRODUCTION_HOSTS: 'mysql', MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale' });
});

test('ระบุแค่โฮสต์ = กันทุกฐานบนโฮสต์นั้น', () => {
  blocked({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'reseau.proxy.rlwy.net',
            MYSQL_HOST: 'reseau.proxy.rlwy.net', MYSQL_DATABASE: 'db_truckscale_test' });
});

test('คนละโฮสต์ = ผ่าน', () => {
  allowed({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'reseau.proxy.rlwy.net',
            MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale' });
});

/**
 * สองเคสนี้คือเหตุผลที่ต้องรองรับรูปแบบ host/database
 * ชุดทดสอบบน VPS ใช้ MySQL ตัวเดียวกับ production ต่างแค่ชื่อฐาน
 * ถ้ากันทั้งโฮสต์ ชุดทดสอบจะเขียนอะไรไม่ได้เลย
 */
test('host/database — ตรงทั้งโฮสต์และฐาน = กัน', () => {
  const e = blocked({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'mysql/db_truckscale',
                      MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale' });
  assert.match(e.message, /mysql\/db_truckscale/);
});

test('host/database — โฮสต์เดียวกันแต่เป็นฐานทดสอบ = ผ่าน', () => {
  allowed({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'mysql/db_truckscale',
            MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale_test' });
});

test('ผสมสองรูปแบบในรายการเดียวกันได้ และเว้นวรรคไม่มีผล', () => {
  blocked({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: ' reseau.proxy.rlwy.net , mysql/db_truckscale ',
            MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale' });
});

test('เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก', () => {
  blocked({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'MySQL/DB_TruckScale',
            MYSQL_HOST: 'mysql', MYSQL_DATABASE: 'db_truckscale' });
});

test('ไม่ได้ตั้งชื่อฐาน แต่มีกฎแบบ host/database = ไม่ตรง จึงผ่าน', () => {
  allowed({ NODE_ENV: 'test', TS_PRODUCTION_HOSTS: 'mysql/db_truckscale', MYSQL_HOST: 'mysql' });
});
