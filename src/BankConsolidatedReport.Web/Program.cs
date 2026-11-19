using BankConsolidatedReport.Web.Data;
using BankConsolidatedReport.Web.Middleware;
using BankConsolidatedReport.Web.Repositories;

var builder = WebApplication.CreateBuilder(args);

// Override connection string from environment variable if set
var envConn = Environment.GetEnvironmentVariable("DB_CONNECTION_STRING");
if (!string.IsNullOrEmpty(envConn))
{
    builder.Configuration["ConnectionStrings:OracleDb"] = envConn;
}

builder.Services.AddControllersWithViews();
builder.Services.AddSingleton<OracleConnectionFactory>();
builder.Services.AddScoped<BankReportRepository>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseMiddleware<OracleExceptionMiddleware>();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();

