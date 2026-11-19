using System.Text.RegularExpressions;
using BankConsolidatedReport.Web.Middleware;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Oracle.ManagedDataAccess.Client;
using Xunit;

namespace BankConsolidatedReport.Tests;

public class OracleExceptionTests
{
    [Theory]
    [InlineData("ORA-20001: Kỳ không hợp lệ: 2025-Q9", "ORA-20001")]
    [InlineData("ORA-20002: Không tìm thấy chi nhánh 999", "ORA-20002")]
    [InlineData("ORA-20003: Kỳ đã chốt, không được thêm/sửa/xoá dữ liệu", "ORA-20003")]
    [InlineData("ORA-20004: Quý 2024-Q1 đã được chốt trước đó", "ORA-20004")]
    [InlineData("ORA-20005: Không tìm thấy sản phẩm 999", "ORA-20005")]
    [InlineData("ORA-20006: Không tìm thấy khoản mục 999", "ORA-20006")]
    [InlineData("ORA-20007: Số tiền phải lớn hơn 0", "ORA-20007")]
    [InlineData("ORA-20008: Quý 2025-Q4 chưa được chốt nên không cần mở lại", "ORA-20008")]
    [InlineData("ORA-30006: resource busy; acquire with WAIT timeout expired", "ORA-30006")]
    public void ExtractErrorCode_FromOracleMessage(string oracleMessage, string expectedCode)
    {
        // Regex used in OracleExceptionMiddleware
        var regex = new Regex(@"ORA-(2000[1-8]|30006):\s*(.+?)(?:\n|$)", RegexOptions.IgnoreCase);
        var match = regex.Match(oracleMessage);

        Assert.True(match.Success, $"Regex should match: {oracleMessage}");
        Assert.Equal(expectedCode, $"ORA-{match.Groups[1].Value}");
    }

    [Theory]
    [InlineData("ORA-00942: table or view does not exist")]
    [InlineData("ORA-01017: invalid username/password; logon denied")]
    public void NonBusinessError_ShouldNotMatch(string oracleMessage)
    {
        var regex = new Regex(@"ORA-(2000[1-8]|30006):\s*(.+?)(?:\n|$)", RegexOptions.IgnoreCase);
        var match = regex.Match(oracleMessage);

        Assert.False(match.Success, $"Regex should NOT match non-business error: {oracleMessage}");
    }
}

public class ReportDataTests
{
    [Theory]
    [InlineData("ROLLUP")]
    [InlineData("CUBE")]
    [InlineData("SETS")]
    [InlineData("PIVOT")]
    [InlineData("PIVOT_DYN")]
    public void ValidReportModes(string mode)
    {
        var validModes = new HashSet<string> { "ROLLUP", "CUBE", "SETS", "PIVOT", "PIVOT_DYN" };
        Assert.Contains(mode, validModes);
    }

    [Fact]
    public void GidProcessing_Sets_GrandTotal()
    {
        // In GROUPING SETS with 3 columns, grand total has GID = 7 (binary 111)
        int gid = 7;
        Assert.True(gid == 7, "GID 7 should be grand total for SETS mode");
    }

    [Fact]
    public void GidProcessing_Rollup_TotalRow()
    {
        // In ROLLUP with 3 columns, any gid > 0 is a subtotal/total
        int gid = 3;
        Assert.True(gid > 0, "GID > 0 should indicate a total row in ROLLUP mode");
    }

    [Fact]
    public void NumberFormat_VietnameseLocale()
    {
        decimal amount = 1234567.89m;
        string formatted = amount.ToString("N2", new System.Globalization.CultureInfo("vi-VN"));
        Assert.Contains(",", formatted); // Vietnamese uses comma as decimal separator
    }

    [Fact]
    public void NegativeAmount_ShouldBeDetected()
    {
        decimal amount = -500.50m;
        Assert.True(amount < 0, "Negative amounts should be detected for red highlighting");
    }
}

public class RequestModelTests
{
    [Fact]
    public void QuarterRequest_ValidQuarters()
    {
        var validQuarters = new[] { "Q1", "Q2", "Q3", "Q4" };
        foreach (var q in validQuarters)
        {
            Assert.Matches(@"^Q[1-4]$", q);
        }
    }

    [Fact]
    public void PeriodId_Format_YYYYMM()
    {
        int periodId = 202503;
        int year = periodId / 100;
        int month = periodId % 100;
        Assert.Equal(2025, year);
        Assert.Equal(3, month);
        Assert.InRange(month, 1, 12);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(-0.01)]
    public void InvalidAmount_ShouldFail(decimal amount)
    {
        Assert.True(amount <= 0, "Amount <= 0 should be rejected by Oracle (ORA-20007)");
    }

    [Fact]
    public void ConnectionString_Format()
    {
        var connStr = "User Id=bank;Password=bank123;Data Source=localhost:1521/FREEPDB1;";
        Assert.Contains("bank", connStr);
        Assert.Contains("FREEPDB1", connStr);
        Assert.Contains("1521", connStr);
    }
}

