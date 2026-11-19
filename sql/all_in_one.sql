-- ============================================================================
-- all_in_one.sql - ĐỀ TÀI 5: HỆ THỐNG BÁO CÁO TÀI CHÍNH HỢP NHẤT CHO NGÂN HÀNG
-- Chạy bằng user BANK (đã tạo ở 00_create_user.sql) trong DBeaver: Alt+X (Execute script).
-- Có thể chạy lại nhiều lần: BƯỚC 0 xoá sạch rồi tạo lại.
-- Mục lục: 0 dọn dẹp | 1-6 bảng, dữ liệu, view | 7-10 package và trigger | 11-12 tối ưu | 13 kiểm thử
-- ============================================================================

-- ============================================================================
-- BƯỚC 0: DỌN DẸP (để chạy lại từ đầu; trigger và chỉ mục bị xoá theo bảng)
-- ============================================================================
DROP VIEW IF EXISTS v_income;
DROP TABLE IF EXISTS test_log PURGE;
DROP TABLE IF EXISTS audit_log PURGE;
DROP TABLE IF EXISTS stg_income_wide PURGE;
DROP TABLE IF EXISTS fact_income PURGE;
DROP TABLE IF EXISTS period_close_log PURGE;
DROP TABLE IF EXISTS period_close PURGE;
DROP TABLE IF EXISTS dim_period PURGE;
DROP TABLE IF EXISTS dim_income_item PURGE;
DROP TABLE IF EXISTS dim_product PURGE;
DROP TABLE IF EXISTS dim_product_group PURGE;
DROP TABLE IF EXISTS dim_branch PURGE;
DROP TABLE IF EXISTS dim_region PURGE;

-- ============================================================================
-- BƯỚC 1: TẠO BẢNG (mô hình sao: bảng chiều + bảng sự kiện)
--   dim_*  : bảng chiều (khu vực, chi nhánh, nhóm/sản phẩm, khoản mục, kỳ).
--   fact_income : bảng sự kiện, mỗi dòng là một khoản thu/chi (đơn vị: triệu VND).
--   period_close : danh sách quý đã chốt; period_close_log : nhật ký chốt/mở lại; audit_log : nhật ký sửa/xoá.
--   stg_income_wide : bảng "rộng" (q1..q4 là cột) giả lập file Excel, dùng cho UNPIVOT.
--   test_log : nơi ghi kết quả kiểm thử ở BƯỚC 13.
-- ============================================================================
CREATE TABLE dim_region (region_id NUMBER PRIMARY KEY, region_name VARCHAR2(50) NOT NULL UNIQUE);
CREATE TABLE dim_branch (branch_id NUMBER PRIMARY KEY, branch_name VARCHAR2(80) NOT NULL UNIQUE,
  region_id NUMBER NOT NULL REFERENCES dim_region);
CREATE TABLE dim_product_group (group_id NUMBER PRIMARY KEY, group_name VARCHAR2(50) NOT NULL UNIQUE);
CREATE TABLE dim_product (product_id NUMBER PRIMARY KEY, product_name VARCHAR2(80) NOT NULL,
  group_id NUMBER NOT NULL REFERENCES dim_product_group);
-- sign_val = +1 (thu nhập) hoặc -1 (chi phí) để tính lợi nhuận ròng
CREATE TABLE dim_income_item (item_id NUMBER PRIMARY KEY, item_name VARCHAR2(80) NOT NULL,
  sign_val NUMBER(1) NOT NULL CHECK (sign_val IN (1,-1)));
CREATE TABLE dim_period (period_id NUMBER(6) PRIMARY KEY, fiscal_year NUMBER(4) NOT NULL,
  fiscal_quarter VARCHAR2(2) NOT NULL CHECK (fiscal_quarter IN ('Q1','Q2','Q3','Q4')), month_no NUMBER(2) NOT NULL);
CREATE TABLE fact_income (fact_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id NUMBER NOT NULL REFERENCES dim_branch, product_id NUMBER NOT NULL REFERENCES dim_product,
  item_id NUMBER NOT NULL REFERENCES dim_income_item, period_id NUMBER(6) NOT NULL REFERENCES dim_period,
  amount NUMBER(18,2) NOT NULL CHECK (amount >= 0));          -- đơn vị: triệu VND
CREATE TABLE period_close (fiscal_year NUMBER(4), fiscal_quarter VARCHAR2(2),
  status VARCHAR2(10) DEFAULT 'CLOSED' NOT NULL, closed_at TIMESTAMP DEFAULT SYSTIMESTAMP,
  PRIMARY KEY (fiscal_year, fiscal_quarter));
-- Nhật ký chốt/mở lại quý: ai làm, khi nào
CREATE TABLE period_close_log (log_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fiscal_year NUMBER(4) NOT NULL, fiscal_quarter VARCHAR2(2) NOT NULL, action VARCHAR2(10) NOT NULL,
  acted_by VARCHAR2(60) DEFAULT USER, acted_at TIMESTAMP DEFAULT SYSTIMESTAMP);
CREATE TABLE audit_log (log_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action VARCHAR2(10),
  fact_id NUMBER, old_amount NUMBER(18,2), new_amount NUMBER(18,2),
  changed_by VARCHAR2(60) DEFAULT USER, changed_at TIMESTAMP DEFAULT SYSTIMESTAMP);
-- Bảng "rộng" (mỗi quý một cột) như file Excel nhập vào -> dùng UNPIVOT để nạp
CREATE TABLE stg_income_wide (branch_id NUMBER, product_id NUMBER, item_id NUMBER, fiscal_year NUMBER(4),
  q1 NUMBER(18,2), q2 NUMBER(18,2), q3 NUMBER(18,2), q4 NUMBER(18,2));

CREATE TABLE test_log (test VARCHAR2(10), message VARCHAR2(400));

-- ============================================================================
-- BƯỚC 2: NẠP DỮ LIỆU DANH MỤC
--   3 khu vực, 9 chi nhánh, 4 nhóm sản phẩm (8 sản phẩm), 5 khoản mục thu/chi.
--   sign_val = +1 là thu nhập, -1 là chi phí => lợi nhuận ròng = SUM(amount * sign_val).
-- ============================================================================
INSERT ALL
  INTO dim_region VALUES (1,'Miền Bắc') INTO dim_region VALUES (2,'Miền Trung') INTO dim_region VALUES (3,'Miền Nam')
SELECT 1 FROM dual;
INSERT ALL
  INTO dim_branch VALUES (1,'Hà Nội',1) INTO dim_branch VALUES (2,'Hải Phòng',1) INTO dim_branch VALUES (3,'Bắc Ninh',1)
  INTO dim_branch VALUES (4,'Đà Nẵng',2) INTO dim_branch VALUES (5,'Huế',2) INTO dim_branch VALUES (6,'Nha Trang',2)
  INTO dim_branch VALUES (7,'TP.HCM',3) INTO dim_branch VALUES (8,'Cần Thơ',3) INTO dim_branch VALUES (9,'Đồng Nai',3)
SELECT 1 FROM dual;
INSERT ALL
  INTO dim_product_group VALUES (1,'Tín dụng') INTO dim_product_group VALUES (2,'Tiền gửi')
  INTO dim_product_group VALUES (3,'Thẻ') INTO dim_product_group VALUES (4,'Ngoại hối')
SELECT 1 FROM dual;
INSERT ALL
  INTO dim_product VALUES (1,'Vay tiêu dùng',1) INTO dim_product VALUES (2,'Vay doanh nghiệp',1)
  INTO dim_product VALUES (3,'Tiết kiệm có kỳ hạn',2) INTO dim_product VALUES (4,'Tiền gửi thanh toán',2)
  INTO dim_product VALUES (5,'Thẻ tín dụng',3) INTO dim_product VALUES (6,'Thẻ ghi nợ',3)
  INTO dim_product VALUES (7,'Mua bán ngoại tệ',4) INTO dim_product VALUES (8,'Chuyển tiền quốc tế',4)
SELECT 1 FROM dual;
INSERT ALL
  INTO dim_income_item VALUES (1,'Thu nhập lãi',1) INTO dim_income_item VALUES (2,'Thu phí dịch vụ',1)
  INTO dim_income_item VALUES (3,'Chi phí lãi',-1) INTO dim_income_item VALUES (4,'Chi phí hoạt động',-1)
  INTO dim_income_item VALUES (5,'Dự phòng rủi ro',-1)
SELECT 1 FROM dual;
-- ============================================================================
-- BƯỚC 3: SINH BẢNG KỲ (24 tháng: 2024-01 đến 2025-12)
--   period_id dạng YYYYMM; mỗi tháng gắn với năm và quý (Q1..Q4).
-- ============================================================================
INSERT INTO dim_period
SELECT TO_NUMBER(TO_CHAR(d,'YYYYMM')), EXTRACT(YEAR FROM d), 'Q'||CEIL(EXTRACT(MONTH FROM d)/3), EXTRACT(MONTH FROM d)
FROM (SELECT ADD_MONTHS(DATE '2024-01-01', LEVEL-1) d FROM dual CONNECT BY LEVEL <= 24);

-- ============================================================================
-- BƯỚC 4: SINH DỮ LIỆU GIAO DỊCH MẪU (~216.000 dòng)
--   9 chi nhánh x 8 sản phẩm x 5 khoản mục x 24 tháng x 25 lần, số tiền ngẫu nhiên theo khoảng riêng của từng khoản mục
--   (thu nhập lãi lớn nhất, dự phòng nhỏ nhất) để lợi nhuận ròng của mọi nhóm đều dương.
--   Cố ý tạo nhiều dòng để thấy khác biệt execution plan ở BƯỚC 11-12.
--   Trigger chưa tồn tại lúc này nên nạp nhanh; trigger tạo ở BƯỚC 9-10.
-- ============================================================================
INSERT INTO fact_income (branch_id, product_id, item_id, period_id, amount)
SELECT b.branch_id, p.product_id, i.item_id, d.period_id, ROUND(DBMS_RANDOM.VALUE(CASE i.item_id WHEN 1 THEN 200 WHEN 2 THEN 50 WHEN 3 THEN 80 WHEN 4 THEN 30 ELSE 10 END,
                          CASE i.item_id WHEN 1 THEN 800 WHEN 2 THEN 200 WHEN 3 THEN 350 WHEN 4 THEN 120 ELSE 60 END), 2)
FROM dim_branch b CROSS JOIN dim_product p CROSS JOIN dim_income_item i CROSS JOIN dim_period d
CROSS JOIN (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 25);
COMMIT;

-- View phẳng: mỗi dòng đã gắn đủ chiều, net_amount = thu nhập(+) / chi phí(-)
-- ============================================================================
-- BƯỚC 5: TẠO VIEW PHẲNG v_income
--   Gộp fact với mọi bảng chiều, net_amount = amount * sign_val.
--   Mọi báo cáo ở các bước sau chỉ cần SELECT từ view này nên câu lệnh ngắn gọn.
-- ============================================================================
CREATE OR REPLACE VIEW v_income AS
SELECT f.fact_id, r.region_name, b.branch_id, b.branch_name, g.group_name, p.product_name,
       d.period_id, d.fiscal_year, d.fiscal_quarter, f.amount * i.sign_val AS net_amount
FROM fact_income f
JOIN dim_branch b ON b.branch_id = f.branch_id
JOIN dim_region r ON r.region_id = b.region_id
JOIN dim_product p ON p.product_id = f.product_id
JOIN dim_product_group g ON g.group_id = p.group_id
JOIN dim_income_item i ON i.item_id = f.item_id
JOIN dim_period d ON d.period_id = f.period_id;
-- ============================================================================
-- BƯỚC 6: THU THẬP THỐNG KÊ
--   Để trình tối ưu Oracle có số liệu thật khi lập execution plan.
-- ============================================================================
BEGIN DBMS_STATS.GATHER_SCHEMA_STATS(USER); END;
/

-- ============================================================================
-- BƯỚC 7: PACKAGE - PHẦN KHAI BÁO (specification)
--   Danh sách hàm/thủ tục công khai: fn_net_income, fn_report, sp_add_txn, sp_close_quarter, sp_reopen_quarter, sp_load_wide.
--   fn_report trả về SYS_REFCURSOR với 5 chế độ: ROLLUP | CUBE | SETS | PIVOT | PIVOT_DYN.
-- ============================================================================
CREATE OR REPLACE PACKAGE pkg_bank_report AS
  FUNCTION  fn_net_income(p_branch_id NUMBER, p_year NUMBER, p_quarter VARCHAR2) RETURN NUMBER;
  FUNCTION  fn_report(p_mode VARCHAR2, p_year NUMBER) RETURN SYS_REFCURSOR;  -- ROLLUP|CUBE|SETS|PIVOT|PIVOT_DYN
  PROCEDURE sp_add_txn(p_branch NUMBER, p_product NUMBER, p_item NUMBER, p_period NUMBER, p_amount NUMBER);
  PROCEDURE sp_close_quarter(p_year NUMBER, p_quarter VARCHAR2);
  PROCEDURE sp_reopen_quarter(p_year NUMBER, p_quarter VARCHAR2);
  PROCEDURE sp_load_wide(p_year NUMBER);                                     -- nạp từ bảng rộng bằng UNPIVOT
END pkg_bank_report;
/
-- ============================================================================
-- BƯỚC 8: PACKAGE - PHẦN CÀI ĐẶT (body)
--   check_quarter / check_branch : thủ tục kiểm tra nội bộ, ném lỗi -20001 / -20002.
--   fn_net_income  : lợi nhuận ròng của 1 chi nhánh trong 1 quý.
--   fn_report      : ROLLUP (tổng theo cấp), CUBE (mọi tổ hợp), GROUPING SETS (tổ hợp chọn lọc), PIVOT (quý thành cột),
--                    PIVOT_DYN (PIVOT động: cột là nhóm sản phẩm, dựng bằng dynamic SQL).
--                    GROUPING()/GROUPING_ID() dùng để phân biệt dòng tổng với giá trị NULL thật.
--   sp_add_txn     : thêm giao dịch, kiểm tra chi nhánh/sản phẩm/khoản mục/số tiền/kỳ (-20002, -20005, -20006, -20007, -20001);
--                    kỳ đã chốt sẽ bị trigger ở BƯỚC 9 chặn (-20003).
--   sp_close_quarter: chốt quý (khoá SHARE chống tranh chấp); chốt trùng bắt DUP_VAL_ON_INDEX rồi ném -20004.
--   sp_reopen_quarter: mở lại quý đã chốt, có ghi nhật ký; quý chưa chốt thì ném -20008.
--   sp_load_wide   : UNPIVOT bảng rộng q1..q4 thành các dòng (quý, số tiền) rồi nạp vào fact.
-- ============================================================================
CREATE OR REPLACE PACKAGE BODY pkg_bank_report AS
  -- Mã lỗi: -20001 kỳ/chế độ sai, -20002 chi nhánh, -20003 kỳ đã chốt, -20004 chốt trùng,
  --         -20005 sản phẩm, -20006 khoản mục, -20007 số tiền, -20008 quý chưa chốt
  PROCEDURE check_quarter(p_year NUMBER, p_quarter VARCHAR2) IS
    v NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v FROM dim_period WHERE fiscal_year = p_year AND fiscal_quarter = p_quarter;
    IF v = 0 THEN RAISE_APPLICATION_ERROR(-20001, 'Kỳ không hợp lệ: ' || p_year || '-' || p_quarter); END IF;
  END;
--
  PROCEDURE check_branch(p_branch NUMBER) IS
    v NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v FROM dim_branch WHERE branch_id = p_branch;
    IF v = 0 THEN RAISE_APPLICATION_ERROR(-20002, 'Không tìm thấy chi nhánh ' || p_branch); END IF;
  END;
--
  FUNCTION fn_net_income(p_branch_id NUMBER, p_year NUMBER, p_quarter VARCHAR2) RETURN NUMBER IS
    v NUMBER;
  BEGIN
    check_quarter(p_year, p_quarter);
    check_branch(p_branch_id);
    SELECT NVL(SUM(net_amount), 0) INTO v FROM v_income
    WHERE branch_id = p_branch_id AND fiscal_year = p_year AND fiscal_quarter = p_quarter;
    RETURN v;
  END;
--
  FUNCTION fn_report(p_mode VARCHAR2, p_year NUMBER) RETURN SYS_REFCURSOR IS
    c SYS_REFCURSOR;
  BEGIN
    IF p_mode = 'ROLLUP' THEN      -- khu vực -> chi nhánh -> quý, có dòng tổng từng cấp
      OPEN c FOR
        SELECT CASE WHEN GROUPING(region_name) = 1 THEN 'Tổng toàn hệ thống' ELSE region_name END AS khu_vuc,
               CASE WHEN GROUPING(branch_name) = 1 THEN 'Tổng' ELSE branch_name END AS chi_nhanh,
               CASE WHEN GROUPING(fiscal_quarter) = 1 THEN 'Tổng' ELSE fiscal_quarter END AS quy,
               SUM(net_amount) AS loi_nhuan_rong,
               GROUPING_ID(region_name, branch_name, fiscal_quarter) AS gid
        FROM v_income WHERE fiscal_year = p_year
        GROUP BY ROLLUP (region_name, branch_name, fiscal_quarter)
        ORDER BY GROUPING(region_name), region_name, GROUPING(branch_name), branch_name,
                 GROUPING(fiscal_quarter), fiscal_quarter;
    ELSIF p_mode = 'CUBE' THEN     -- mọi tổ hợp khu vực x nhóm sản phẩm x quý (2^3 = 8 nhóm)
      OPEN c FOR
        SELECT CASE WHEN GROUPING(region_name) = 1 THEN 'Tất cả' ELSE region_name END AS khu_vuc,
               CASE WHEN GROUPING(group_name) = 1 THEN 'Tất cả' ELSE group_name END AS nhom_san_pham,
               CASE WHEN GROUPING(fiscal_quarter) = 1 THEN 'Tất cả' ELSE fiscal_quarter END AS quy,
               SUM(net_amount) AS loi_nhuan_rong,
               GROUPING_ID(region_name, group_name, fiscal_quarter) AS gid
        FROM v_income WHERE fiscal_year = p_year
        GROUP BY CUBE (region_name, group_name, fiscal_quarter)
        ORDER BY gid, region_name, group_name, fiscal_quarter;
    ELSIF p_mode = 'SETS' THEN     -- chỉ các tổ hợp cần: (chi nhánh,quý), (nhóm SP,quý), tổng
      OPEN c FOR
        SELECT CASE WHEN GROUPING(branch_name) = 1 THEN '-' ELSE branch_name END AS chi_nhanh,
               CASE WHEN GROUPING(group_name) = 1 THEN '-' ELSE group_name END AS nhom_san_pham,
               CASE WHEN GROUPING(fiscal_quarter) = 1 THEN 'Tổng' ELSE fiscal_quarter END AS quy,
               SUM(net_amount) AS loi_nhuan_rong,
               GROUPING_ID(branch_name, group_name, fiscal_quarter) AS gid
        FROM v_income WHERE fiscal_year = p_year
        GROUP BY GROUPING SETS ((branch_name, fiscal_quarter), (group_name, fiscal_quarter), ())
        ORDER BY gid, branch_name, group_name, fiscal_quarter;
    ELSIF p_mode = 'PIVOT' THEN    -- quý thành cột
      OPEN c FOR
        SELECT * FROM (SELECT branch_name AS chi_nhanh, fiscal_quarter, net_amount
                       FROM v_income WHERE fiscal_year = p_year)
        PIVOT (SUM(net_amount) FOR fiscal_quarter IN ('Q1' AS q1, 'Q2' AS q2, 'Q3' AS q3, 'Q4' AS q4))
        ORDER BY chi_nhanh;
    ELSIF p_mode = 'PIVOT_DYN' THEN  -- PIVOT động: cột = nhóm sản phẩm, danh sách cột đọc từ bảng danh mục lúc chạy
      DECLARE
        v_cols VARCHAR2(4000);
        v_sql  VARCHAR2(8000);
      BEGIN
        SELECT LISTAGG('''' || REPLACE(group_name, '''', '''''') || ''' AS "' || REPLACE(group_name, '"', '') || '"', ', ')
               WITHIN GROUP (ORDER BY group_id)
        INTO v_cols FROM dim_product_group;
        v_sql := 'SELECT * FROM (SELECT branch_name AS chi_nhanh, group_name, net_amount FROM v_income WHERE fiscal_year = :y) '
              || 'PIVOT (SUM(net_amount) FOR group_name IN (' || v_cols || ')) ORDER BY chi_nhanh';
        OPEN c FOR v_sql USING p_year;
      END;
    ELSE
      RAISE_APPLICATION_ERROR(-20001, 'Chế độ báo cáo không hợp lệ: ' || p_mode);
    END IF;
    RETURN c;
  END;
--
  PROCEDURE sp_add_txn(p_branch NUMBER, p_product NUMBER, p_item NUMBER, p_period NUMBER, p_amount NUMBER) IS
    v NUMBER;
  BEGIN
    check_branch(p_branch);
    SELECT COUNT(*) INTO v FROM dim_product WHERE product_id = p_product;
    IF v = 0 THEN RAISE_APPLICATION_ERROR(-20005, 'Không tìm thấy sản phẩm ' || p_product); END IF;
    SELECT COUNT(*) INTO v FROM dim_income_item WHERE item_id = p_item;
    IF v = 0 THEN RAISE_APPLICATION_ERROR(-20006, 'Không tìm thấy khoản mục ' || p_item); END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE_APPLICATION_ERROR(-20007, 'Số tiền phải lớn hơn 0'); END IF;
    SELECT COUNT(*) INTO v FROM dim_period WHERE period_id = p_period;
    IF v = 0 THEN RAISE_APPLICATION_ERROR(-20001, 'Kỳ không hợp lệ: ' || p_period); END IF;
    INSERT INTO fact_income (branch_id, product_id, item_id, period_id, amount)
    VALUES (p_branch, p_product, p_item, p_period, p_amount);   -- trigger sẽ chặn nếu kỳ đã chốt
  END;
--
  PROCEDURE sp_close_quarter(p_year NUMBER, p_quarter VARCHAR2) IS
  BEGIN
    check_quarter(p_year, p_quarter);
    -- Khoá SHARE: chờ các giao dịch đang sửa fact_income commit xong, và chặn giao dịch mới cho tới khi
    -- phiên chốt commit. Nhờ vậy trigger của phiên khác luôn nhìn thấy bản ghi chốt (không bị tranh chấp).
    LOCK TABLE fact_income IN SHARE MODE WAIT 10;
    INSERT INTO period_close (fiscal_year, fiscal_quarter) VALUES (p_year, p_quarter);
    INSERT INTO period_close_log (fiscal_year, fiscal_quarter, action) VALUES (p_year, p_quarter, 'CLOSE');
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN RAISE_APPLICATION_ERROR(-20004, 'Quý ' || p_year || '-' || p_quarter || ' đã được chốt trước đó');
  END;
--
  PROCEDURE sp_reopen_quarter(p_year NUMBER, p_quarter VARCHAR2) IS
  BEGIN
    check_quarter(p_year, p_quarter);
    LOCK TABLE fact_income IN SHARE MODE WAIT 10;
    DELETE FROM period_close WHERE fiscal_year = p_year AND fiscal_quarter = p_quarter;
    IF SQL%ROWCOUNT = 0 THEN
      RAISE_APPLICATION_ERROR(-20008, 'Quý ' || p_year || '-' || p_quarter || ' chưa được chốt nên không cần mở lại');
    END IF;
    INSERT INTO period_close_log (fiscal_year, fiscal_quarter, action) VALUES (p_year, p_quarter, 'REOPEN');
  END;
--
  PROCEDURE sp_load_wide(p_year NUMBER) IS
  BEGIN
    -- UNPIVOT: q1..q4 (cột) -> (quý, số tiền) (dòng); ghi vào tháng cuối quý. NULL bị bỏ qua mặc định
    INSERT INTO fact_income (branch_id, product_id, item_id, period_id, amount)
    SELECT branch_id, product_id, item_id, fiscal_year * 100 + TO_NUMBER(SUBSTR(q, 2)) * 3, amt
    FROM stg_income_wide
    UNPIVOT (amt FOR q IN (q1 AS 'Q1', q2 AS 'Q2', q3 AS 'Q3', q4 AS 'Q4'))
    WHERE fiscal_year = p_year;
    DELETE FROM stg_income_wide WHERE fiscal_year = p_year;
  END;
END pkg_bank_report;
/
-- ============================================================================
-- BƯỚC 9: TRIGGER 1: CHẶN SỬA DỮ LIỆU KỲ ĐÃ CHỐT
--   Tra bảng period_close khi INSERT/UPDATE/DELETE fact_income; kỳ đã chốt thì ném lỗi -20003.
-- ============================================================================
-- Trigger 1: chặn mọi thay đổi dữ liệu của kỳ đã chốt (CHECK constraint không tra được bảng khác)
CREATE OR REPLACE TRIGGER trg_fact_period_guard
BEFORE INSERT OR UPDATE OR DELETE ON fact_income FOR EACH ROW
DECLARE v_cnt NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_cnt
  FROM period_close c JOIN dim_period p ON p.fiscal_year = c.fiscal_year AND p.fiscal_quarter = c.fiscal_quarter
  WHERE c.status = 'CLOSED' AND p.period_id IN (NVL(:NEW.period_id, -1), NVL(:OLD.period_id, -1));
  IF v_cnt > 0 THEN
    RAISE_APPLICATION_ERROR(-20003, 'Kỳ đã chốt, không được thêm/sửa/xoá dữ liệu');
  END IF;
END;
/
-- ============================================================================
-- BƯỚC 10: TRIGGER 2: GHI NHẬT KÝ (audit)
--   Mỗi lần UPDATE/DELETE fact_income ghi một dòng vào audit_log (giá trị cũ/mới, người sửa, thời điểm).
-- ============================================================================
-- Trigger 2: ghi nhật ký khi sửa/xoá dữ liệu tài chính
CREATE OR REPLACE TRIGGER trg_fact_audit
AFTER UPDATE OR DELETE ON fact_income FOR EACH ROW
DECLARE v_action VARCHAR2(10);
BEGIN
  -- UPDATING là vị từ của PL/SQL, không được dùng trực tiếp trong câu INSERT (gây ORA-00984), nên gán ra biến trước
  IF UPDATING THEN v_action := 'UPDATE'; ELSE v_action := 'DELETE'; END IF;
  INSERT INTO audit_log (action, fact_id, old_amount, new_amount)
  VALUES (v_action, :OLD.fact_id, :OLD.amount, :NEW.amount);
END;
/


-- ============================================================================
-- BƯỚC 11: TỐI ƯU 1: GROUPING SETS so với UNION ALL
--   Cùng kết quả. Dự kiến UNION ALL đọc bảng 3 lần, GROUPING SETS đọc ít lần hơn; ghi nhận theo plan thực tế.
--   Chụp 2 bảng plan (statement UA và GS) đưa vào báo cáo, so cột Cost và số lần TABLE ACCESS FULL.
-- ============================================================================
-- ===== A. Tối ưu 1: GROUPING SETS vs 3 GROUP BY + UNION ALL =====
EXPLAIN PLAN SET STATEMENT_ID = 'UA' FOR
SELECT branch_name, CAST(NULL AS VARCHAR2(50)) g, fiscal_quarter, SUM(net_amount) FROM v_income WHERE fiscal_year = 2025 GROUP BY branch_name, fiscal_quarter
UNION ALL
SELECT CAST(NULL AS VARCHAR2(80)), group_name, fiscal_quarter, SUM(net_amount) FROM v_income WHERE fiscal_year = 2025 GROUP BY group_name, fiscal_quarter
UNION ALL
SELECT CAST(NULL AS VARCHAR2(80)), CAST(NULL AS VARCHAR2(50)), CAST(NULL AS VARCHAR2(2)), SUM(net_amount) FROM v_income WHERE fiscal_year = 2025;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'UA'));

EXPLAIN PLAN SET STATEMENT_ID = 'GS' FOR
SELECT branch_name, group_name, fiscal_quarter, SUM(net_amount) FROM v_income WHERE fiscal_year = 2025
GROUP BY GROUPING SETS ((branch_name, fiscal_quarter), (group_name, fiscal_quarter), ());
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'GS'));

-- ============================================================================
-- BƯỚC 12: TỐI ƯU 2: CHỈ MỤC PHỦ
--   Truy vấn: tổng theo khoản mục của 1 chi nhánh trong 1 quý (chỉ ~1,4% số dòng).
--   Chụp plan trước (B4: TABLE ACCESS FULL) và sau khi tạo chỉ mục (AF: INDEX RANGE SCAN).
-- ============================================================================
-- ===== B. Tối ưu 2: chỉ mục phủ cho truy vấn theo chi nhánh + kỳ =====
EXPLAIN PLAN SET STATEMENT_ID = 'B4' FOR
SELECT item_id, SUM(amount) FROM fact_income WHERE branch_id = 3 AND period_id BETWEEN 202501 AND 202503 GROUP BY item_id;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'B4'));       -- trước: TABLE ACCESS FULL fact_income

CREATE INDEX ix_fact_branch_period ON fact_income (branch_id, period_id, item_id, product_id, amount);
BEGIN DBMS_STATS.GATHER_TABLE_STATS(USER, 'FACT_INCOME'); END;
/

EXPLAIN PLAN SET STATEMENT_ID = 'AF' FOR
SELECT item_id, SUM(amount) FROM fact_income WHERE branch_id = 3 AND period_id BETWEEN 202501 AND 202503 GROUP BY item_id;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'AF'));       -- sau: INDEX RANGE SCAN

-- ============================================================================
-- BƯỚC 13: KIỂM THỬ - kết quả ghi vào bảng test_log, xem ở câu SELECT cuối file
--   T1 tổng ROLLUP = tổng chi tiết | T2 kỳ sai | T3 chi nhánh không có | T4a-c chốt, chốt trùng, mở lại
--   T5 UNPIVOT | T6 audit trigger | T7a-b kiểm tra đầu vào | T8 mở lại quý chưa chốt | T9a-b chế độ báo cáo
-- ============================================================================

-- T1: dòng tổng cấp cao nhất của ROLLUP phải bằng tổng chi tiết (mong đợi PASS)
INSERT INTO test_log
SELECT 'T1', CASE WHEN g.total = d.total THEN 'PASS' ELSE 'FAIL' END
FROM (SELECT SUM(net_amount) total FROM v_income WHERE fiscal_year = 2025
      GROUP BY ROLLUP (region_name, branch_name, fiscal_quarter)
      HAVING GROUPING_ID(region_name, branch_name, fiscal_quarter) = 7) g,
     (SELECT SUM(net_amount) total FROM v_income WHERE fiscal_year = 2025) d;

-- T2: quý không hợp lệ (mong đợi ORA-20001)
DECLARE v_msg VARCHAR2(400);
BEGIN
  pkg_bank_report.sp_close_quarter(2025, 'Q9');
  INSERT INTO test_log VALUES ('T2', 'FAIL - không báo lỗi');
EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T2', v_msg);
END;
/
-- T3: chi nhánh không tồn tại (mong đợi ORA-20002)
DECLARE v_msg VARCHAR2(400); v_val NUMBER;
BEGIN
  v_val := pkg_bank_report.fn_net_income(999, 2025, 'Q1');
  INSERT INTO test_log VALUES ('T3', 'FAIL - không báo lỗi');
EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T3', v_msg);
END;
/
-- T4: chốt Q1/2024; thêm giao dịch vào kỳ đó (ORA-20003); chốt lần 2 (ORA-20004); mở lại (còn 0 dòng chốt)
DECLARE v_msg VARCHAR2(400);
BEGIN
  pkg_bank_report.sp_close_quarter(2024, 'Q1');
  BEGIN
    pkg_bank_report.sp_add_txn(1, 1, 1, 202402, 100);
    INSERT INTO test_log VALUES ('T4a', 'FAIL - không báo lỗi');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T4a', v_msg);
  END;
  BEGIN
    pkg_bank_report.sp_close_quarter(2024, 'Q1');
    INSERT INTO test_log VALUES ('T4b', 'FAIL - không báo lỗi');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T4b', v_msg);
  END;
  pkg_bank_report.sp_reopen_quarter(2024, 'Q1');
  INSERT INTO test_log
  SELECT 'T4c', 'Số dòng period_close sau khi mở lại = ' || COUNT(*) || ' (mong đợi 0)'
  FROM period_close WHERE fiscal_year = 2024 AND fiscal_quarter = 'Q1';
END;
/
COMMIT;

-- T5: UNPIVOT. q4 để NULL nên chỉ sinh 3 dòng (mong đợi 3)
INSERT INTO stg_income_wide VALUES (1, 1, 1, 2025, 99999999.99, 99999999.99, 99999999.99, NULL);
BEGIN pkg_bank_report.sp_load_wide(2025); END;
/
INSERT INTO test_log
SELECT 'T5', 'Số dòng nạp = ' || COUNT(*) || ' (mong đợi 3)' FROM fact_income WHERE amount = 99999999.99;

-- T6: audit trigger. Sửa 1 dòng + xoá 2 dòng => 3 dòng log (mong đợi 3)
UPDATE fact_income SET amount = 1 WHERE amount = 99999999.99 AND period_id = 202503;
DELETE FROM fact_income WHERE amount = 99999999.99;
INSERT INTO test_log
SELECT 'T6', 'Số dòng audit = ' || COUNT(*) || ' (mong đợi 3)' FROM audit_log WHERE old_amount = 99999999.99;
-- Dọn dòng đã sửa (amount = 1; dữ liệu thật luôn từ 10 trở lên) để fact_income trở lại đúng 216000 dòng
DELETE FROM fact_income WHERE amount = 1;
COMMIT;

-- T7a: sản phẩm không tồn tại (mong đợi ORA-20005); T7b: số tiền không hợp lệ (mong đợi ORA-20007)
DECLARE v_msg VARCHAR2(400);
BEGIN
  BEGIN
    pkg_bank_report.sp_add_txn(1, 999, 1, 202502, 100);
    INSERT INTO test_log VALUES ('T7a', 'FAIL - không báo lỗi');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T7a', v_msg);
  END;
  BEGIN
    pkg_bank_report.sp_add_txn(1, 1, 1, 202502, -5);
    INSERT INTO test_log VALUES ('T7b', 'FAIL - không báo lỗi');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T7b', v_msg);
  END;
END;
/
-- T8: mở lại quý chưa từng chốt (mong đợi ORA-20008)
DECLARE v_msg VARCHAR2(400);
BEGIN
  pkg_bank_report.sp_reopen_quarter(2025, 'Q4');
  INSERT INTO test_log VALUES ('T8', 'FAIL - không báo lỗi');
EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T8', v_msg);
END;
/
-- T9a: chế độ báo cáo sai (mong đợi ORA-20001); T9b: PIVOT động mở được con trỏ (mong đợi PASS)
DECLARE v_msg VARCHAR2(400); c SYS_REFCURSOR;
BEGIN
  BEGIN
    c := pkg_bank_report.fn_report('XYZ', 2025);
    INSERT INTO test_log VALUES ('T9a', 'FAIL - không báo lỗi');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T9a', v_msg);
  END;
  BEGIN
    c := pkg_bank_report.fn_report('PIVOT_DYN', 2025);
    CLOSE c;
    INSERT INTO test_log VALUES ('T9b', 'PASS');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; INSERT INTO test_log VALUES ('T9b', 'FAIL - ' || v_msg);
  END;
END;
/
COMMIT;

-- Xem toàn bộ kết quả kiểm thử
SELECT * FROM test_log ORDER BY test;
