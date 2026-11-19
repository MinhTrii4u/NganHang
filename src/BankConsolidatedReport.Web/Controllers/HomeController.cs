using Microsoft.AspNetCore.Mvc;

namespace BankConsolidatedReport.Web.Controllers;

public class HomeController : Controller
{
    public IActionResult Index() => View();
}

