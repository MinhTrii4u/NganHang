using System.Text.RegularExpressions;
using Oracle.ManagedDataAccess.Client;

namespace BankConsolidatedReport.Web.Middleware;

/// <summary>
/// Middleware bắt OracleException và trích mã lỗi nghiệp vụ ORA-20001..ORA-20008, ORA-30006.
/// Trả JSON chuẩn { errorCode, message } với HTTP 400 cho lỗi nghiệp vụ.
/// </summary>
public class OracleExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<OracleExceptionMiddleware> _logger;

    // Regex bắt ORA-2000x và ORA-30006
    private static readonly Regex OraBusinessErrorRegex = new(
        @"ORA-(2000[1-8]|30006):\s*(.+?)(?:\n|$)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public OracleExceptionMiddleware(RequestDelegate next, ILogger<OracleExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (OracleException ex)
        {
            _logger.LogWarning(ex, "OracleException caught by middleware");
            var match = OraBusinessErrorRegex.Match(ex.Message);
            if (match.Success)
            {
                var errorCode = $"ORA-{match.Groups[1].Value}";
                // Lấy dòng thông báo lỗi đầu tiên chứa ORA-2000x
                var fullMessage = match.Value.Trim();
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                context.Response.ContentType = "application/json; charset=utf-8";
                var json = System.Text.Json.JsonSerializer.Serialize(new
                {
                    errorCode,
                    message = fullMessage
                });
                await context.Response.WriteAsync(json);
            }
            else
            {
                // Lỗi Oracle không phải nghiệp vụ → trả 500
                _logger.LogError(ex, "Unhandled OracleException");
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json; charset=utf-8";
                var json = System.Text.Json.JsonSerializer.Serialize(new
                {
                    errorCode = $"ORA-{ex.Number}",
                    message = ex.Message
                });
                await context.Response.WriteAsync(json);
            }
        }
    }
}

