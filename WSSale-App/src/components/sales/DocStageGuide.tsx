import { Modal } from '../ui/Modal';
import { DOC_TYPES, SALE_CHAIN, docLabel } from '../../utils/docTypes';
import { DOC_STAGE_META, DOC_STAGE_ORDER } from '../../constants/docStage';

/**
 * How to read a bill's document status: the documents of one sale in order, then every status the list can show.
 * The wording follows accounting's answers of 12 November 2026.
 */
export function DocStageGuide({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="อ่านสถานะเอกสารของบิล" size="large">
      <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-6 text-sm text-gray-700">
        <section>
          <h4 className="font-bold text-[#0C447C] mb-2">เอกสารของการขายหนึ่งรายการ เรียงตามลำดับที่เกิด</h4>
          <ol className="space-y-2">
            {SALE_CHAIN.map((key, index) => {
              const doc = DOC_TYPES[key];
              if (!doc) return null;
              return (
                <li key={key} className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0C447C] text-[11px] font-bold text-white">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900">{docLabel(key)}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{doc.meaning}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      เมนู WinSpeed: {doc.menu}{doc.form ? ` · แบบพิมพ์: ${doc.form}` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h4 className="font-bold text-[#0C447C] mb-2">ใบตั้งหนี้ (202) กับ ใบส่งของ (107) ต่างกันอย่างไร</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
              <p className="font-bold text-indigo-800">{docLabel('202')}</p>
              <p className="text-xs mt-1">
                เกิดพร้อมใบสั่งขาย (104) ใช้เลขเดียวกับใบสั่งขาย เป็นใบที่บอกว่าลูกค้าเป็นหนี้เท่าไร
                รายงานอายุลูกหนี้ รายงานใบส่งของค้างชำระ และการรับชำระ นับจากใบนี้
              </p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
              <p className="font-bold text-emerald-800">{docLabel('107')}</p>
              <p className="text-xs mt-1">
                เกิดเมื่อขนสินค้าจริง บัญชีออกด้วย Post Invoice ลงวันที่ตามวันที่ขน เป็นใบที่บันทึกยอดขายและตัดสต๊อก
                สาย I ได้เล่ม J สาย K ได้เล่ม N ไม่ใช้นับยอดลูกหนี้ซ้ำ
              </p>
            </div>
          </div>
        </section>

        <section>
          <h4 className="font-bold text-[#0C447C] mb-2">สถานะเอกสารที่แสดงในรายการบิล</h4>
          <ul className="space-y-2">
            {DOC_STAGE_ORDER.map(code => {
              const meta = DOC_STAGE_META[code];
              return (
                <li key={code} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                  <span className={`inline-flex w-fit shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-gray-600">{meta.hint}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400 mt-3">
            ป้ายสถานะงาน (เช่น รอจัดส่ง, โหลดสินค้า) บอกว่างานอยู่ที่ใคร ส่วนสถานะเอกสารบอกว่า WinSpeed มีเอกสารใดแล้ว
            ทั้งสองอย่างอ่านคู่กัน ถ้าตั๋วขาดหลังออกใบสั่งขาย ให้ออกใบสั่งจองและใบสั่งขายเพิ่มตามจำนวนที่รถมารับ
          </p>
        </section>
      </div>
    </Modal>
  );
}
