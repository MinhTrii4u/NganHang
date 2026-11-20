using System.Data;
using System.Text;
using BankConsolidatedReport.Web.Data;
using Oracle.ManagedDataAccess.Client;
using Oracle.ManagedDataAccess.Types;

namespace BankConsolidatedReport.Web.Repositories;

/// <summary>
/// Repository gọi trực tiếp pkg_bank_report và các bảng Oracle 23ai bằng ADO.NET (ODP.NET).
/// Mọi logic nghiệp vụ nằm trong Oracle Package/Trigger, C# chỉ điều phối.
/// </summary>
public class BankReportRepository
{
    private readonly OracleConnectionFactory _factory;

    public BankReportRepository(OracleConnectionFactory factory)
    {
        _factory = factory;
    }

    // ==================== fn_report (SYS_REFCURSOR) ====================
    /// <summary>
    /// Gọi pkg_bank_report.fn_report(p_mode, p_year) → SYS_REFCURSOR.
    /// Đọc động tên cột và từng dòng để hỗ trợ cả 5 chế độ, kể cả PIVOT_DYN.
    /// </summary>
    public async Task<(List<string> Columns, List<object?[]> Rows)> GetReportAsync(string mode, int year)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "pkg_bank_report.fn_report";
        cmd.CommandType = CommandType.StoredProcedure;

        // ReturnValue phải là parameter ĐẦU TIÊN cho ODP.NET
        var retParam = new OracleParameter("RETURN_VALUE", OracleDbType.RefCursor, ParameterDirection.ReturnValue);
        cmd.Parameters.Add(retParam);
        cmd.Parameters.Add(new OracleParameter("p_mode", OracleDbType.Varchar2, mode, ParameterDirection.Input));
        cmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year, ParameterDirection.Input));

        await cmd.ExecuteNonQueryAsync();

        var columns = new List<string>();
        var rows = new List<object?[]>();

        using var cursor = (OracleRefCursor)retParam.Value;
        using var reader = cursor.GetDataReader();

        for (int i = 0; i < reader.FieldCount; i++)
            columns.Add(reader.GetName(i));

        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (int i = 0; i < reader.FieldCount; i++)
            {
                if (reader.IsDBNull(i))
                    row[i] = null;
                else
                {
                    var val = reader.GetValue(i);
                    if (val is decimal d)
                        row[i] = (double)d;
                    else if (val is OracleDecimal od && !od.IsNull)
                        row[i] = (double)od.Value;
                    else if (val is int || val is long || val is double || val is float || val is string)
                        row[i] = val;
                    else
                    {
                        var s = val.ToString() ?? "";
                        if (double.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var num))
                            row[i] = num;
                        else
                            row[i] = s;
                    }
                }
            }
            rows.Add(row);
        }

        return (columns, rows);
    }

    // ==================== fn_net_income (NUMBER) ====================
    public async Task<decimal> GetNetIncomeAsync(int branchId, int year, string quarter)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "pkg_bank_report.fn_net_income";
        cmd.CommandType = CommandType.StoredProcedure;

        var retParam = new OracleParameter("RETURN_VALUE", OracleDbType.Decimal, ParameterDirection.ReturnValue);
        cmd.Parameters.Add(retParam);
        cmd.Parameters.Add(new OracleParameter("p_branch_id", OracleDbType.Int32, branchId, ParameterDirection.Input));
        cmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year, ParameterDirection.Input));
        cmd.Parameters.Add(new OracleParameter("p_quarter", OracleDbType.Varchar2, quarter, ParameterDirection.Input));

        await cmd.ExecuteNonQueryAsync();

        var result = (OracleDecimal)retParam.Value;
        return result.Value;
    }

    // ==================== sp_add_txn ====================
    public async Task AddTransactionAsync(int branchId, int productId, int itemId, int periodId, decimal amount)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "pkg_bank_report.sp_add_txn";
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.Parameters.Add(new OracleParameter("p_branch", OracleDbType.Int32, branchId, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_product", OracleDbType.Int32, productId, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_item", OracleDbType.Int32, itemId, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_period", OracleDbType.Int32, periodId, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_amount", OracleDbType.Decimal, amount, ParameterDirection.Input));
            await cmd.ExecuteNonQueryAsync();
            txn.Commit();
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== sp_close_quarter ====================
    public async Task CloseQuarterAsync(int year, string quarter)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "pkg_bank_report.sp_close_quarter";
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_quarter", OracleDbType.Varchar2, quarter, ParameterDirection.Input));
            await cmd.ExecuteNonQueryAsync();
            txn.Commit();
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== sp_reopen_quarter ====================
    public async Task ReopenQuarterAsync(int year, string quarter)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "pkg_bank_report.sp_reopen_quarter";
            cmd.CommandType = CommandType.StoredProcedure;
            cmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_quarter", OracleDbType.Varchar2, quarter, ParameterDirection.Input));
            await cmd.ExecuteNonQueryAsync();
            txn.Commit();
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== sp_load_wide (UNPIVOT) ====================
    public async Task<int> LoadWideAsync(int branchId, int productId, int itemId, int year,
        decimal? q1, decimal? q2, decimal? q3, decimal? q4)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            // 1) Insert vào stg_income_wide
            await using (var insertCmd = conn.CreateCommand())
            {
                insertCmd.Transaction = txn;
                insertCmd.CommandText = @"INSERT INTO stg_income_wide (branch_id, product_id, item_id, fiscal_year, q1, q2, q3, q4) 
                                          VALUES (:b, :p, :i, :y, :q1, :q2, :q3, :q4)";
                insertCmd.Parameters.Add(new OracleParameter("b", OracleDbType.Int32, branchId, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("p", OracleDbType.Int32, productId, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("i", OracleDbType.Int32, itemId, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("y", OracleDbType.Int32, year, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("q1", OracleDbType.Decimal, q1.HasValue ? (object)q1.Value : DBNull.Value, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("q2", OracleDbType.Decimal, q2.HasValue ? (object)q2.Value : DBNull.Value, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("q3", OracleDbType.Decimal, q3.HasValue ? (object)q3.Value : DBNull.Value, ParameterDirection.Input));
                insertCmd.Parameters.Add(new OracleParameter("q4", OracleDbType.Decimal, q4.HasValue ? (object)q4.Value : DBNull.Value, ParameterDirection.Input));
                await insertCmd.ExecuteNonQueryAsync();
            }

            // 2) Gọi sp_load_wide
            await using (var spCmd = conn.CreateCommand())
            {
                spCmd.Transaction = txn;
                spCmd.CommandText = "pkg_bank_report.sp_load_wide";
                spCmd.CommandType = CommandType.StoredProcedure;
                spCmd.Parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year, ParameterDirection.Input));
                await spCmd.ExecuteNonQueryAsync();
            }

            // 3) Đếm số dòng đã nạp (non-null quarters)
            int rowsInserted = (q1.HasValue ? 1 : 0) + (q2.HasValue ? 1 : 0) + (q3.HasValue ? 1 : 0) + (q4.HasValue ? 1 : 0);

            txn.Commit();
            return rowsInserted;
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== DASHBOARD: KPIs Tài Chính (YoY) ====================
    public async Task<object> GetDashboardKpisAsync(int year)
    {
        await using var conn = await _factory.CreateConnectionAsync();

        async Task<(decimal Revenue, decimal Expense, decimal NetIncome)> QueryFinancials(int y)
        {
            decimal rev = 0;
            decimal exp = 0;
            decimal net = 0;

            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT 
                        NVL(SUM(CASE WHEN i.sign_val = 1 THEN f.amount ELSE 0 END), 0) AS revenue,
                        NVL(SUM(CASE WHEN i.sign_val = -1 THEN f.amount ELSE 0 END), 0) AS expense,
                        NVL(SUM(f.amount * i.sign_val), 0) AS net_income
                    FROM fact_income f
                    JOIN dim_income_item i ON i.item_id = f.item_id
                    JOIN dim_period p ON p.period_id = f.period_id
                    WHERE p.fiscal_year = :year";
                cmd.Parameters.Add(new OracleParameter("year", OracleDbType.Int32, y, ParameterDirection.Input));
                using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    rev = reader.IsDBNull(0) ? 0 : reader.GetDecimal(0);
                    exp = reader.IsDBNull(1) ? 0 : reader.GetDecimal(1);
                    net = reader.IsDBNull(2) ? 0 : reader.GetDecimal(2);
                }
            }
            return (rev, exp, net);
        }

        var current = await QueryFinancials(year);
        var previous = await QueryFinancials(year - 1);

        int lockedCount = 0;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM period_close WHERE status = 'LOCKED'";
            try
            {
                lockedCount = Convert.ToInt32(await cmd.ExecuteScalarAsync());
            }
            catch
            {
                cmd.CommandText = "SELECT COUNT(*) FROM period_close";
                lockedCount = Convert.ToInt32(await cmd.ExecuteScalarAsync());
            }
        }

        return new
        {
            year,
            revenue = current.Revenue,
            expense = current.Expense,
            netIncome = current.NetIncome,
            prevYear = year - 1,
            prevRevenue = previous.Revenue,
            prevExpense = previous.Expense,
            prevNetIncome = previous.NetIncome,
            lockedCount,
            totalQuarters = 8 // 2024 (Q1-Q4) + 2025 (Q1-Q4)
        };
    }

    // ==================== DASHBOARD: Chart 1 - Diễn biến 4 Quý (Combo) ====================
    public async Task<List<object>> GetQuarterlyTrendAsync(int year)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT 
                p.fiscal_quarter,
                NVL(SUM(CASE WHEN i.sign_val = 1 THEN f.amount ELSE 0 END), 0) AS revenue,
                NVL(SUM(CASE WHEN i.sign_val = -1 THEN f.amount ELSE 0 END), 0) AS expense,
                NVL(SUM(f.amount * i.sign_val), 0) AS net_income
            FROM fact_income f
            JOIN dim_income_item i ON i.item_id = f.item_id
            JOIN dim_period p ON p.period_id = f.period_id
            WHERE p.fiscal_year = :year
            GROUP BY p.fiscal_quarter
            ORDER BY p.fiscal_quarter";
        cmd.Parameters.Add(new OracleParameter("year", OracleDbType.Int32, year, ParameterDirection.Input));

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                quarter = reader.GetString(0),
                revenue = reader.GetDecimal(1),
                expense = reader.GetDecimal(2),
                netIncome = reader.GetDecimal(3)
            });
        }
        return list;
    }

    // ==================== DASHBOARD: Chart 2 - Tỷ trọng Nhóm Sản Phẩm (Donut) ====================
    public async Task<List<object>> GetProductGroupProfitAsync(int year)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT 
                g.group_name,
                NVL(SUM(f.amount * i.sign_val), 0) AS net_income
            FROM fact_income f
            JOIN dim_income_item i ON i.item_id = f.item_id
            JOIN dim_product p ON p.product_id = f.product_id
            JOIN dim_product_group g ON g.group_id = p.group_id
            JOIN dim_period dp ON dp.period_id = f.period_id
            WHERE dp.fiscal_year = :year
            GROUP BY g.group_name
            ORDER BY net_income DESC";
        cmd.Parameters.Add(new OracleParameter("year", OracleDbType.Int32, year, ParameterDirection.Input));

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                group = reader.GetString(0),
                netIncome = reader.GetDecimal(1)
            });
        }
        return list;
    }

    // ==================== DASHBOARD: Chart 3 - Xếp hạng 9 Chi Nhánh (Horizontal Bar) ====================
    public async Task<List<object>> GetBranchRankingAsync(int year)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT 
                b.branch_name,
                NVL(SUM(f.amount * i.sign_val), 0) AS net_income
            FROM fact_income f
            JOIN dim_income_item i ON i.item_id = f.item_id
            JOIN dim_branch b ON b.branch_id = f.branch_id
            JOIN dim_period dp ON dp.period_id = f.period_id
            WHERE dp.fiscal_year = :year
            GROUP BY b.branch_name
            ORDER BY net_income DESC";
        cmd.Parameters.Add(new OracleParameter("year", OracleDbType.Int32, year, ParameterDirection.Input));

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                branch = reader.GetString(0),
                netIncome = reader.GetDecimal(1)
            });
        }
        return list;
    }

    // ==================== TRANSACTIONS: Phân Trang + Bộ Lọc ====================
    public async Task<(List<object> Rows, int TotalRows)> GetTransactionsPagedAsync(
        int page, int pageSize, int? branchId, int? year, string? quarter, string? search)
    {
        await using var conn = await _factory.CreateConnectionAsync();

        var whereClauses = new List<string>();
        var parameters = new List<OracleParameter>();

        if (branchId.HasValue && branchId.Value > 0)
        {
            whereClauses.Add("f.branch_id = :p_branch");
            parameters.Add(new OracleParameter("p_branch", OracleDbType.Int32, branchId.Value, ParameterDirection.Input));
        }

        if (year.HasValue && year.Value > 0)
        {
            whereClauses.Add("dp.fiscal_year = :p_year");
            parameters.Add(new OracleParameter("p_year", OracleDbType.Int32, year.Value, ParameterDirection.Input));
        }

        if (!string.IsNullOrWhiteSpace(quarter))
        {
            whereClauses.Add("dp.fiscal_quarter = :p_quarter");
            parameters.Add(new OracleParameter("p_quarter", OracleDbType.Varchar2, quarter.Trim().ToUpper(), ParameterDirection.Input));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            whereClauses.Add("(LOWER(b.branch_name) LIKE :p_search OR LOWER(p.product_name) LIKE :p_search OR LOWER(i.item_name) LIKE :p_search)");
            parameters.Add(new OracleParameter("p_search", OracleDbType.Varchar2, $"%{search.Trim().ToLower()}%", ParameterDirection.Input));
        }

        string whereSql = whereClauses.Count > 0 ? "WHERE " + string.Join(" AND ", whereClauses) : "";

        // 1. Đếm tổng số dòng
        int totalRows = 0;
        await using (var countCmd = conn.CreateCommand())
        {
            countCmd.CommandText = $@"
                SELECT COUNT(*)
                FROM fact_income f
                JOIN dim_branch b ON b.branch_id = f.branch_id
                JOIN dim_product p ON p.product_id = f.product_id
                JOIN dim_income_item i ON i.item_id = f.item_id
                JOIN dim_period dp ON dp.period_id = f.period_id
                {whereSql}";

            foreach (var p in parameters)
                countCmd.Parameters.Add(new OracleParameter(p.ParameterName, p.OracleDbType, p.Value, ParameterDirection.Input));

            totalRows = Convert.ToInt32(await countCmd.ExecuteScalarAsync());
        }

        // 2. Lấy dữ liệu phân trang
        var rows = new List<object>();
        int offset = (page - 1) * pageSize;

        await using (var queryCmd = conn.CreateCommand())
        {
            queryCmd.CommandText = $@"
                SELECT 
                    f.fact_id,
                    b.branch_name,
                    r.region_name,
                    p.product_name,
                    g.group_name,
                    i.item_name,
                    i.sign_val,
                    dp.fiscal_year,
                    dp.fiscal_quarter,
                    f.amount,
                    (f.amount * i.sign_val) AS net_amount,
                    f.period_id
                FROM fact_income f
                JOIN dim_branch b ON b.branch_id = f.branch_id
                JOIN dim_region r ON r.region_id = b.region_id
                JOIN dim_product p ON p.product_id = f.product_id
                JOIN dim_product_group g ON g.group_id = p.group_id
                JOIN dim_income_item i ON i.item_id = f.item_id
                JOIN dim_period dp ON dp.period_id = f.period_id
                {whereSql}
                ORDER BY f.fact_id DESC
                OFFSET :p_offset ROWS FETCH NEXT :p_limit ROWS ONLY";

            foreach (var p in parameters)
                queryCmd.Parameters.Add(new OracleParameter(p.ParameterName, p.OracleDbType, p.Value, ParameterDirection.Input));

            queryCmd.Parameters.Add(new OracleParameter("p_offset", OracleDbType.Int32, offset, ParameterDirection.Input));
            queryCmd.Parameters.Add(new OracleParameter("p_limit", OracleDbType.Int32, pageSize, ParameterDirection.Input));

            using var reader = await queryCmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rows.Add(new
                {
                    factId = reader.GetInt32(0),
                    branchName = reader.GetString(1),
                    regionName = reader.GetString(2),
                    productName = reader.GetString(3),
                    groupName = reader.GetString(4),
                    itemName = reader.GetString(5),
                    signVal = reader.GetInt32(6),
                    year = reader.GetInt32(7),
                    quarter = reader.GetString(8),
                    amount = reader.GetDecimal(9),
                    netAmount = reader.GetDecimal(10),
                    periodId = reader.GetInt32(11)
                });
            }
        }

        return (rows, totalRows);
    }

    // ==================== TRANSACTIONS: Update Số Tiền (Kích hoạt Triggers) ====================
    public async Task UpdateTransactionAmountAsync(int factId, decimal newAmount)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "UPDATE fact_income SET amount = :p_amount WHERE fact_id = :p_id";
            cmd.Parameters.Add(new OracleParameter("p_amount", OracleDbType.Decimal, newAmount, ParameterDirection.Input));
            cmd.Parameters.Add(new OracleParameter("p_id", OracleDbType.Int32, factId, ParameterDirection.Input));

            int affected = await cmd.ExecuteNonQueryAsync();
            if (affected == 0)
                throw new InvalidOperationException($"Không tìm thấy giao dịch #{factId}");

            txn.Commit();
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== TRANSACTIONS: Xóa Giao Dịch (Kích hoạt Triggers) ====================
    public async Task DeleteTransactionAsync(int factId)
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var txn = conn.BeginTransaction();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = txn;
            cmd.CommandText = "DELETE FROM fact_income WHERE fact_id = :p_id";
            cmd.Parameters.Add(new OracleParameter("p_id", OracleDbType.Int32, factId, ParameterDirection.Input));

            int affected = await cmd.ExecuteNonQueryAsync();
            if (affected == 0)
                throw new InvalidOperationException($"Không tìm thấy giao dịch #{factId}");

            txn.Commit();
        }
        catch
        {
            txn.Rollback();
            throw;
        }
    }

    // ==================== DANH MỤC ĐẦY ĐỦ ====================
    public async Task<List<object>> GetDimBranchesAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT b.branch_id, b.branch_name, r.region_name 
            FROM dim_branch b 
            JOIN dim_region r ON r.region_id = b.region_id 
            ORDER BY b.branch_id";

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                id = reader.GetInt32(0),
                name = reader.GetString(1),
                region = reader.GetString(2)
            });
        }
        return list;
    }

    public async Task<List<object>> GetDimProductsAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT p.product_id, p.product_name, g.group_name 
            FROM dim_product p 
            JOIN dim_product_group g ON g.group_id = p.group_id 
            ORDER BY p.product_id";

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                id = reader.GetInt32(0),
                name = reader.GetString(1),
                group = reader.GetString(2)
            });
        }
        return list;
    }

    public async Task<List<object>> GetDimItemsAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT item_id, item_name, sign_val FROM dim_income_item ORDER BY item_id";

        var list = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            list.Add(new
            {
                id = reader.GetInt32(0),
                name = reader.GetString(1),
                sign = reader.GetInt32(2)
            });
        }
        return list;
    }

    // ==================== Lookups (danh mục) ====================
    public async Task<object> GetLookupsAsync()
    {
        var branches = await GetDimBranchesAsync();
        var products = await GetDimProductsAsync();
        var items = await GetDimItemsAsync();

        await using var conn = await _factory.CreateConnectionAsync();
        var periods = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT DISTINCT fiscal_year FROM dim_period ORDER BY fiscal_year DESC";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                periods.Add(new { year = reader.GetInt32(0) });
        }

        return new { branches, products, items, periods };
    }

    // ==================== Closed Quarters ====================
    public async Task<List<object>> GetClosedQuartersAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT fiscal_year, fiscal_quarter, TO_CHAR(closed_at, 'YYYY-MM-DD HH24:MI:SS') FROM period_close ORDER BY fiscal_year, fiscal_quarter";
        var result = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new { year = reader.GetInt32(0), quarter = reader.GetString(1), closedAt = reader.GetString(2) });
        return result;
    }

    // ==================== Audit Log ====================
    public async Task<List<object>> GetAuditLogsAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT log_id, action, fact_id, old_amount, new_amount, changed_by, TO_CHAR(changed_at, 'YYYY-MM-DD HH24:MI:SS') FROM audit_log ORDER BY log_id DESC FETCH FIRST 200 ROWS ONLY";
        var result = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new
            {
                logId = reader.GetInt32(0),
                action = reader.GetString(1),
                factId = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                oldAmount = reader.IsDBNull(3) ? (decimal?)null : reader.GetDecimal(3),
                newAmount = reader.IsDBNull(4) ? (decimal?)null : reader.GetDecimal(4),
                changedBy = reader.GetString(5),
                changedAt = reader.GetString(6)
            });
        return result;
    }

    // ==================== Period Close Log ====================
    public async Task<List<object>> GetPeriodCloseLogsAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT log_id, fiscal_year, fiscal_quarter, action, acted_by, TO_CHAR(acted_at, 'YYYY-MM-DD HH24:MI:SS') FROM period_close_log ORDER BY log_id DESC FETCH FIRST 200 ROWS ONLY";
        var result = new List<object>();
        using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new
            {
                logId = reader.GetInt32(0),
                year = reader.GetInt32(1),
                quarter = reader.GetString(2),
                action = reader.GetString(3),
                actedBy = reader.GetString(4),
                actedAt = reader.GetString(5)
            });
        return result;
    }

    // ==================== System Status ====================
    public async Task<object> GetSystemStatusAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();

        string oracleVersion = "";
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT banner FROM v$version WHERE ROWNUM = 1";
            try { oracleVersion = (string)(await cmd.ExecuteScalarAsync() ?? ""); }
            catch { oracleVersion = "N/A (insufficient privileges)"; }
        }

        int factCount = 0;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM fact_income";
            factCount = Convert.ToInt32(await cmd.ExecuteScalarAsync());
        }

        var testLogs = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT test, message FROM test_log ORDER BY test";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                testLogs.Add(new { test = reader.GetString(0), message = reader.GetString(1) });
        }

        return new
        {
            status = "Online",
            oracleVersion,
            factIncomeRows = factCount,
            testResults = testLogs,
            connectionString = "localhost:1521/FREEPDB1 (bank)"
        };
    }
}
