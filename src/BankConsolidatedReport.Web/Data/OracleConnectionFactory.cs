using Oracle.ManagedDataAccess.Client;

namespace BankConsolidatedReport.Web.Data;

/// <summary>
/// Factory tạo và quản lý kết nối tới Oracle 23ai với connection pooling + retry.
/// </summary>
public class OracleConnectionFactory
{
    private readonly string _connectionString;
    private readonly ILogger<OracleConnectionFactory> _logger;

    public OracleConnectionFactory(IConfiguration configuration, ILogger<OracleConnectionFactory> logger)
    {
        _connectionString = configuration.GetConnectionString("OracleDb")
            ?? throw new InvalidOperationException("Connection string 'OracleDb' not found in appsettings.json");
        _logger = logger;
    }

    /// <summary>
    /// Mở kết nối Oracle với retry (tối đa 3 lần, chờ 2s giữa mỗi lần) phù hợp khi DB mới khởi động.
    /// </summary>
    public async Task<OracleConnection> CreateConnectionAsync()
    {
        var connection = new OracleConnection(_connectionString);
        const int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                await connection.OpenAsync();
                return connection;
            }
            catch (OracleException ex) when (attempt < maxRetries)
            {
                _logger.LogWarning(ex, "Oracle connection attempt {Attempt}/{MaxRetries} failed. Retrying in 2s...", attempt, maxRetries);
                await Task.Delay(2000);
            }
        }
        // Nếu hết retry thì throw
        await connection.OpenAsync();
        return connection;
    }

    public string ConnectionString => _connectionString;
}

