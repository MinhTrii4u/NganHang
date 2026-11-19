using System.Data;
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
                    // Oracle NUMBER → decimal → double for JSON
                    row[i] = val is decimal d ? (object)(double)d : val;
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

    // ==================== Lookups (danh mục) ====================
    public async Task<object> GetLookupsAsync()
    {
        await using var conn = await _factory.CreateConnectionAsync();

        var branches = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT b.branch_id, b.branch_name, r.region_name FROM dim_branch b JOIN dim_region r ON r.region_id = b.region_id ORDER BY b.branch_id";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                branches.Add(new { id = reader.GetInt32(0), name = reader.GetString(1), region = reader.GetString(2) });
        }

        var products = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT p.product_id, p.product_name, g.group_name FROM dim_product p JOIN dim_product_group g ON g.group_id = p.group_id ORDER BY p.product_id";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                products.Add(new { id = reader.GetInt32(0), name = reader.GetString(1), group = reader.GetString(2) });
        }

        var items = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT item_id, item_name, sign_val FROM dim_income_item ORDER BY item_id";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                items.Add(new { id = reader.GetInt32(0), name = reader.GetString(1), sign = reader.GetInt32(2) });
        }

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

