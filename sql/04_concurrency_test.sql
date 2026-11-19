-- 04: KIỂM THỬ TRANH CHẤP ĐỒNG THỜI (làm thủ công bằng 2 cửa sổ/kết nối riêng). Chạy SAU all_in_one.sql.
-- Mục tiêu: khi phiên A đang chốt quý (chưa commit), phiên B thêm giao dịch vào quý đó phải bị CHỜ,
--           rồi bị chặn bằng ORA-20003 sau khi A commit (không lọt dữ liệu vào quý đã chốt).
--
-- CHUẨN BỊ: mỗi phiên dùng một kết nối riêng tới user BANK và TẮT auto-commit.
--   DBeaver     : nút "Auto" trên thanh công cụ chuyển sang "Manual commit"; mở 2 SQL editor riêng.
--   SQL Developer: mở 2 worksheet riêng (Ctrl+Shift+N, chọn "Unshared"); auto-commit mặc định đã tắt.
--
-- BƯỚC 1 - PHIÊN A: chốt quý, KHÔNG commit
BEGIN pkg_bank_report.sp_close_quarter(2024, 'Q1'); END;
/
-- BƯỚC 2 - PHIÊN B: thêm giao dịch vào quý vừa chốt. Lệnh sẽ TREO (đang chờ khoá) - đây là kết quả đúng.
BEGIN pkg_bank_report.sp_add_txn(1, 1, 1, 202402, 100); END;
/
-- BƯỚC 3 - PHIÊN A: COMMIT. Phiên B lập tức chạy tiếp và báo: ORA-20003 Kỳ đã chốt...
COMMIT;
-- BƯỚC 4 - DỌN DẸP (phiên A): mở lại quý để dữ liệu trở về trạng thái ban đầu
BEGIN pkg_bank_report.sp_reopen_quarter(2024, 'Q1'); END;
/
COMMIT;
-- KẾT QUẢ MONG ĐỢI: phiên B bị treo ở bước 2, sau bước 3 nhận ORA-20003; không có dòng nào được thêm vào kỳ 202402.
-- Nếu phiên A chốt mà phiên B chờ quá 10 giây ở bước CHỐT (khi B đang giữ giao dịch dở), A nhận ORA-30006.
