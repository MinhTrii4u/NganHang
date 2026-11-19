using System.Diagnostics;
using BankConsolidatedReport.Web.Repositories;
using Microsoft.AspNetCore.Mvc;

namespace BankConsolidatedReport.Web.Controllers.Api;

[ApiController]
[Route("api")]
public class BankApiController : ControllerBase
{
    private readonly BankReportRepository _repo;

    public BankApiController(BankReportRepository repo)
    {
        _repo = repo;
    }

    // 1. GET /api/report?mode=ROLLUP&year=2025
    [HttpGet("report")]
    public async Task<IActionResult> GetReport([FromQuery] string mode = "ROLLUP", [FromQuery] int year = 2025)
    {
        var sw = Stopwatch.StartNew();
        var (columns, rows) = await _repo.GetReportAsync(mode, year);
        sw.Stop();
        return Ok(new
        {
            columns,
            rows,
            rowCount = rows.Count,
            executionMs = sw.ElapsedMilliseconds
        });
    }

    // 2. GET /api/net-income?branchId=1&year=2025&quarter=Q1
    [HttpGet("net-income")]
    public async Task<IActionResult> GetNetIncome([FromQuery] int branchId, [FromQuery] int year, [FromQuery] string quarter)
    {
        var result = await _repo.GetNetIncomeAsync(branchId, year, quarter);
        return Ok(new { branchId, year, quarter, netIncome = result });
    }

    // 3. GET /api/lookups
    [HttpGet("lookups")]
    public async Task<IActionResult> GetLookups()
    {
        var result = await _repo.GetLookupsAsync();
        return Ok(result);
    }

    // 4. GET /api/closed
    [HttpGet("closed")]
    public async Task<IActionResult> GetClosed()
    {
        var result = await _repo.GetClosedQuartersAsync();
        return Ok(result);
    }

    // 5. POST /api/close
    [HttpPost("close")]
    public async Task<IActionResult> CloseQuarter([FromBody] QuarterRequest request)
    {
        await _repo.CloseQuarterAsync(request.Year, request.Quarter);
        return Ok(new { message = $"Đã chốt quý {request.Year}-{request.Quarter}" });
    }

    // 6. POST /api/reopen
    [HttpPost("reopen")]
    public async Task<IActionResult> ReopenQuarter([FromBody] QuarterRequest request)
    {
        await _repo.ReopenQuarterAsync(request.Year, request.Quarter);
        return Ok(new { message = $"Đã mở lại quý {request.Year}-{request.Quarter}" });
    }

    // 7. POST /api/txn
    [HttpPost("txn")]
    public async Task<IActionResult> AddTransaction([FromBody] TransactionRequest request)
    {
        await _repo.AddTransactionAsync(request.BranchId, request.ProductId, request.ItemId, request.PeriodId, request.Amount);
        return Ok(new { message = "Đã thêm giao dịch thành công" });
    }

    // 8. POST /api/load-wide
    [HttpPost("load-wide")]
    public async Task<IActionResult> LoadWide([FromBody] LoadWideRequest request)
    {
        var rowsInserted = await _repo.LoadWideAsync(request.BranchId, request.ProductId, request.ItemId, request.Year,
            request.Q1, request.Q2, request.Q3, request.Q4);
        return Ok(new { message = $"Đã nạp {rowsInserted} dòng bằng UNPIVOT", rowsInserted });
    }

    // 9. GET /api/logs/audit
    [HttpGet("logs/audit")]
    public async Task<IActionResult> GetAuditLogs()
    {
        var result = await _repo.GetAuditLogsAsync();
        return Ok(result);
    }

    // 9. GET /api/logs/period-close
    [HttpGet("logs/period-close")]
    public async Task<IActionResult> GetPeriodCloseLogs()
    {
        var result = await _repo.GetPeriodCloseLogsAsync();
        return Ok(result);
    }

    // 10. GET /api/system/status
    [HttpGet("system/status")]
    public async Task<IActionResult> GetSystemStatus()
    {
        try
        {
            var result = await _repo.GetSystemStatusAsync();
            return Ok(result);
        }
        catch (Exception ex)
        {
            return Ok(new { status = "Offline", error = ex.Message });
        }
    }
}

// ==================== Request Models ====================
public class QuarterRequest
{
    public int Year { get; set; }
    public string Quarter { get; set; } = "Q1";
}

public class TransactionRequest
{
    public int BranchId { get; set; }
    public int ProductId { get; set; }
    public int ItemId { get; set; }
    public int PeriodId { get; set; }
    public decimal Amount { get; set; }
}

public class LoadWideRequest
{
    public int BranchId { get; set; }
    public int ProductId { get; set; }
    public int ItemId { get; set; }
    public int Year { get; set; }
    public decimal? Q1 { get; set; }
    public decimal? Q2 { get; set; }
    public decimal? Q3 { get; set; }
    public decimal? Q4 { get; set; }
}

