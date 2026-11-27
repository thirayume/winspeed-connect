const messages: Record<string, string> = {
 NATIVE_116_DOCUMENT_NUMBER_ALREADY_USED_GET_NEW_NUMBER: 'เลขใบขนนี้ใช้แล้ว กรุณาขอเลขใหม่และตรวจใบเดิมก่อนบันทึก',
 NATIVE_116_HEADER_INCOMPLETE_REOPEN_DOCUMENT: 'ข้อมูลหัวใบขนไม่ครบ กรุณาเปิดใบขนใหม่และตรวจวันที่กับสถานะ',
 NATIVE_116_LINES_REQUIRED_SELECT_COUPONS: 'กรุณาเลือกตั๋วที่ต้องการขนก่อนบันทึก',
 NATIVE_116_POSITIVE_TRANSPORT_QUANTITY_REQUIRED: 'จำนวนขนของทุกบรรทัดต้องมากกว่าศูนย์',
 NATIVE_116_CHECK_ALL_REQUIRED_CHECK_EVERY_LINE: 'กรุณาติ๊ก Check ทุกบรรทัดและ Check All ใน WinSpeed ก่อนบันทึก',
 NATIVE_116_INVOICE_STATE_REVIEW_REQUIRED: 'สถานะออกบิลของใบขนต้องตรวจสอบ กรุณาให้ฝ่ายบัญชีตรวจเอกสารอ้างอิง',
 NATIVE_116_REMAINING_QUANTITY_MISMATCH_REOPEN_DOCUMENT: 'ยอดคงเหลือของใบขนเปลี่ยน กรุณาเปิดเอกสารใหม่และตรวจยอด',
 NATIVE_116_TOTAL_QUANTITY_MISMATCH_RECHECK_TRANSPORT: 'ยอดรวมใบขนไม่ตรงกับจำนวนขนรายบรรทัด กรุณาตรวจและยืนยันช่องจำนวนอีกครั้ง',
 NATIVE_116_COUNTER_FORMAT_REVIEW_REQUIRED: 'รูปแบบเลขใบขนเปลี่ยน กรุณาให้ผู้ดูแลตรวจการตั้งเลขเอกสาร',
 NATIVE_116_NUMBER_SEQUENCE_EXHAUSTED: 'เลขใบขนชุดนี้เต็มแล้ว กรุณาให้ผู้ดูแลตั้งชุดเลขใหม่',
 NATIVE_116_BUSY: 'มีผู้ใช้อื่นกำลังทำรายการตัดตั๋ว กรุณารอแล้วตรวจยอดล่าสุดอีกครั้ง',
};

export const native116ErrorMessage = (code: string): string | undefined => messages[code];
