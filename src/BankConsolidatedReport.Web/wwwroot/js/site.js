/**
 * ============================================================================
 * VIETCORE FINANCE - ENTERPRISE CONSOLIDATED BANKING PORTAL SCRIPT
 * Connects 100% to Oracle Database 23ai (FREEPDB1 - bank)
 * ============================================================================
 */

// Helper selector shortcuts
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Global application state
let currentReportData = null;
let activeChartInstance = null;
let currentMode = 'ROLLUP';
let currentYear = 2025;

// Dashboard chart instances
let chartQuarterlyInstance = null;
let chartProductGroupInstance = null;
let chartBranchRankingInstance = null;

// Transaction pagination state
let txnPage = 1;
const TXN_PAGE_SIZE = 20;

// Column name mapping dictionary
const COLUMN_LABELS = {
    'KHU_VUC': 'Khu Vực',
    'CHI_NHANH': 'Chi Nhánh',
    'QUY': 'Quý',
    'NHOM_SAN_PHAM': 'Nhóm Sản Phẩm',
    'LOI_NHUAN_RONG': 'Lợi Nhuận Ròng (triệu ₫)',
    'Q1': 'Quý 1 (triệu ₫)',
    'Q2': 'Quý 2 (triệu ₫)',
    'Q3': 'Quý 3 (triệu ₫)',
    'Q4': 'Quý 4 (triệu ₫)'
};

// SQL Explanation Dictionary for the 5 OLAP Modes
const SQL_DEFINITIONS = {
    'ROLLUP': `-- 1. BÁO CÁO HỢP NHẤT PHÂN CẤP (ROLLUP)
-- Nhóm đa cấp: Toàn ngân hàng -> Khu vực -> Chi nhánh -> Quý
SELECT 
    khu_vuc, chi_nhanh, quy,
    SUM(net_amount) AS loi_nhuan_rong,
    GROUPING_ID(khu_vuc, chi_nhanh, quy) AS gid
FROM v_income
WHERE fiscal_year = :p_year
GROUP BY ROLLUP(khu_vuc, chi_nhanh, quy)
ORDER BY GID, khu_vuc, chi_nhanh, quy;`,

    'CUBE': `-- 2. BÁO CÁO PHÂN TÍCH ĐA CHIỀU (CUBE)
-- Tạo ra 2^3 = 8 tổ hợp nhóm của (Khu vực, Nhóm sản phẩm, Quý)
SELECT 
    khu_vuc, nhom_san_pham, quy,
    SUM(net_amount) AS loi_nhuan_rong,
    GROUPING_ID(khu_vuc, nhom_san_pham, quy) AS gid
FROM v_income
WHERE fiscal_year = :p_year
GROUP BY CUBE(khu_vuc, nhom_san_pham, quy)
ORDER BY GID, khu_vuc, nhom_san_pham, quy;`,

    'SETS': `-- 3. BÁO CÁO TỔNG HỢP CHỌN LỌC (GROUPING SETS)
-- Chỉ tính đúng 4 mức tổng hợp nghiệp vụ ngân hàng cần thiết
SELECT 
    khu_vuc, chi_nhanh, nhom_san_pham,
    SUM(net_amount) AS loi_nhuan_rong,
    GROUPING_ID(khu_vuc, chi_nhanh, nhom_san_pham) AS gid
FROM v_income
WHERE fiscal_year = :p_year
GROUP BY GROUPING SETS (
    (khu_vuc, chi_nhanh, nhom_san_pham), -- Chi tiết nhất
    (khu_vuc, chi_nhanh),               -- Cấp Chi nhánh
    (khu_vuc),                          -- Cấp Khu vực
    ()                                  -- Tổng Toàn hệ thống
)
ORDER BY GID, khu_vuc, chi_nhanh, nhom_san_pham;`,

    'PIVOT': `-- 4. BÁO CÁO SO SÁNH 4 QUÝ (PIVOT)
-- Chuyển dòng Quý thành 4 cột Q1, Q2, Q3, Q4 bằng mệnh đề PIVOT
SELECT * FROM (
    SELECT chi_nhanh, quy, net_amount
    FROM v_income
    WHERE fiscal_year = :p_year
)
PIVOT (
    SUM(net_amount)
    FOR quy IN ('Q1' AS Q1, 'Q2' AS Q2, 'Q3' AS Q3, 'Q4' AS Q4)
)
ORDER BY chi_nhanh;`,

    'PIVOT_DYN': `-- 5. BÁO CÁO CƠ CẤU SẢN PHẨM (PIVOT ĐỘNG)
-- Oracle PL/SQL đọc danh mục dim_product_group để ghép chuỗi SQL động:
-- LISTAGG(QUOTENAME(group_name)) -> EXECUTE IMMEDIATE ... OPEN p_cursor FOR ...
SELECT * FROM (
    SELECT chi_nhanh, group_name, net_amount
    FROM v_income
    WHERE fiscal_year = :p_year
)
PIVOT (
    SUM(net_amount)
    FOR group_name IN ('Tín dụng', 'Tiền gửi', 'Thẻ', 'Ngoại hối', ...)
)
ORDER BY chi_nhanh;`
};

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================
function formatNumber(val, decimals = 2) {
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val !== 'number') {
        const num = parseFloat(val);
        if (isNaN(num)) return val;
        val = num;
    }
    return val.toLocaleString('vi-VN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}

function animateCount(el, targetValue, duration = 600, unit = '') {
    if (!el) return;
    if (typeof targetValue !== 'number' || isNaN(targetValue)) {
        el.textContent = targetValue || '—';
        return;
    }

    const start = 0;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = start + (targetValue - start) * ease;

        el.textContent = formatNumber(Math.round(current * 100) / 100) + (unit ? ' ' + unit : '');

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            el.textContent = formatNumber(targetValue) + (unit ? ' ' + unit : '');
        }
    }

    requestAnimationFrame(step);
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, type = 'success', duration = 6000) {
    const container = $('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-emerald"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-rose"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `
        ${iconSvg}
        <span class="toast-msg">${message}</span>
        <button class="toast-close-btn" aria-label="Close">&times;</button>
    `;

    toast.querySelector('.toast-close-btn').onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.25s ease forwards';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// ============================================================================
// API CLIENT HELPER
// ============================================================================
async function api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) {
        const errorMsg = data.message || data.errorCode || 'Lỗi xử lý yêu cầu từ cơ sở dữ liệu';
        throw new Error(errorMsg);
    }
    return data;
}

function post(url, body) {
    return api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function setBtnLoading(btn, isLoading, loadingText = 'Đang xử lý...') {
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
        btn.dataset.prevHtml = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span> <span>${loadingText}</span>`;
    } else if (btn.dataset.prevHtml) {
        btn.innerHTML = btn.dataset.prevHtml;
    }
}

// ============================================================================
// THEME & NAVIGATION
// ============================================================================
function initTheme() {
    const savedTheme = localStorage.getItem('app-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

$('themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('app-theme', next);

    // Re-render charts to adjust text color
    const year = parseInt($('dashYear')?.value || '2025', 10);
    loadDashboard(year);
    if (currentReportData) {
        renderChart(currentReportData, currentMode);
    }
});

// Sidebar toggle
$('sidebarToggle')?.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', $('sidebar')?.classList.contains('collapsed'));
});

if (localStorage.getItem('sidebar-collapsed') === 'true') {
    $('sidebar')?.classList.add('collapsed');
}

$('mobileToggle')?.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('mobile-open');
});

// Main 5-Tab Navigation
function switchTab(tabId) {
    $$('.sidebar-menu .menu-item').forEach(m => {
        if (m.dataset.tab === tabId) m.classList.add('active');
        else m.classList.remove('active');
    });

    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    const targetPanel = $(tabId);
    if (targetPanel) targetPanel.classList.add('active');

    $('sidebar')?.classList.remove('mobile-open');

    // Trigger tab-specific loading
    if (tabId === 'tab-dashboard') {
        const year = parseInt($('dashYear')?.value || '2025', 10);
        loadDashboard(year);
    } else if (tabId === 'tab-report') {
        if (!currentReportData) loadReport();
    } else if (tabId === 'tab-txn') {
        loadTransactions(txnPage);
    } else if (tabId === 'tab-lock') {
        loadClosedQuarters();
        renderQuarterGrid();
        loadPeriodCloseLog();
    } else if (tabId === 'tab-audit') {
        loadDimTables();
        loadAuditLog();
        loadTestLog();
        loadSystemStatus();
    }
}

$$('.sidebar-menu .menu-item').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        const tabId = item.dataset.tab;
        switchTab(tabId);
    });
});

// Clickable KPI card (goto tab-lock)
$$('.kpi-card-clickable').forEach(card => {
    card.addEventListener('click', () => {
        const target = card.dataset.gotoTab;
        if (target) switchTab(target);
    });
});

// Sub-Tab Navigation inside Tab 3 and Tab 5
function initSubTabs() {
    $$('.sub-tab-bar .sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const parent = btn.closest('.tab-panel');
            if (!parent) return;

            parent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            parent.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPanel = $(btn.dataset.subtab);
            if (targetPanel) {
                targetPanel.classList.add('active');
                if (btn.dataset.subtab === 'subtab-txn-list') {
                    loadTransactions(txnPage);
                } else if (btn.dataset.subtab === 'subtab-dim') {
                    loadDimTables();
                } else if (btn.dataset.subtab === 'subtab-audit-log') {
                    loadAuditLog();
                } else if (btn.dataset.subtab === 'subtab-system') {
                    loadTestLog();
                    loadSystemStatus();
                }
            }
        });
    });
}

// ============================================================================
// PHÂN HỆ 1: TỔNG QUAN ĐIỀU HÀNH (DASHBOARD)
// ============================================================================
async function loadDashboard(year) {
    try {
        let kpis, quarterly, products, branches;
        try {
            const data = await api(`/api/dashboard?year=${year}`);
            kpis = data.kpis;
            quarterly = data.quarterly;
            products = data.productProfit;
            branches = data.branchRanking;
        } catch {
            const [k, q, p, b] = await Promise.all([
                api(`/api/dashboard/kpis?year=${year}`),
                api(`/api/dashboard/quarterly?year=${year}`),
                api(`/api/dashboard/product-profit?year=${year}`),
                api(`/api/dashboard/branch-ranking?year=${year}`)
            ]);
            kpis = k;
            quarterly = q;
            products = p;
            branches = b;
        }

        // 1. Render 4 KPIs
        animateCount($('kpiRevenue'), kpis.revenue);
        animateCount($('kpiExpense'), kpis.expense);
        animateCount($('kpiNetIncome'), kpis.netIncome);

        if ($('kpiRevenueMeta')) $('kpiRevenueMeta').textContent = `Tổng Thu (Năm ${year})`;
        if ($('kpiExpenseMeta')) $('kpiExpenseMeta').textContent = `Tổng Chi (Năm ${year})`;

        // Profit margin (%)
        const margin = kpis.revenue > 0 ? ((kpis.netIncome / kpis.revenue) * 100).toFixed(1) : '0';
        if ($('kpiNetIncomeMeta')) $('kpiNetIncomeMeta').textContent = `Biên lợi nhuận: ${margin}% · Năm ${year}`;

        // YoY badges (2025 vs 2024)
        renderYoYBadge($('kpiRevenueChange'), kpis.revenue, kpis.prevRevenue);
        renderYoYBadge($('kpiExpenseChange'), kpis.expense, kpis.prevExpense);
        renderYoYBadge($('kpiNetIncomeChange'), kpis.netIncome, kpis.prevNetIncome);

        // Locked count
        if ($('kpiLocked')) $('kpiLocked').textContent = `${kpis.lockedCount} / ${kpis.totalQuarters}`;
        if ($('kpiLockedMeta')) $('kpiLockedMeta').textContent = kpis.lockedCount > 0 ? `${kpis.lockedCount} quý đang được bảo vệ` : 'Chưa có quý nào bị khóa';

        // 2. Render 3 Dashboard Charts
        renderQuarterlyChart(quarterly, year);
        renderProductGroupChart(products, year);
        renderBranchRankingChart(branches, year);

    } catch (err) {
        console.error('Lỗi khi nạp Dashboard:', err);
        showToast(err.message, 'error');
    }
}

function renderYoYBadge(el, current, previous) {
    if (!el) return;
    if (!previous || previous === 0) {
        el.textContent = 'So với năm trước: —';
        el.className = 'kpi-change';
        return;
    }

    const diff = current - previous;
    const pct = ((diff / Math.abs(previous)) * 100).toFixed(1);

    if (diff >= 0) {
        el.className = 'kpi-change up';
        el.innerHTML = `▲ +${pct}% so với năm trước`;
    } else {
        el.className = 'kpi-change down';
        el.innerHTML = `▼ ${pct}% so với năm trước`;
    }
}

function renderQuarterlyChart(data, year) {
    const canvas = $('chartQuarterly');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartQuarterlyInstance) {
        chartQuarterlyInstance.destroy();
        chartQuarterlyInstance = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#CBD5E1' : '#475569';
    const gridColor = isDark ? '#334155' : '#E2E8F0';

    const labels = data.map(d => d.quarter);
    const revenues = data.map(d => d.revenue);
    const expenses = data.map(d => d.expense);
    const netIncomes = data.map(d => d.netIncome);

    const ctx = canvas.getContext('2d');
    chartQuarterlyInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Thu nhập',
                    data: revenues,
                    backgroundColor: '#059669',
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: 'Chi phí',
                    data: expenses,
                    backgroundColor: '#DC2626',
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: 'Lợi nhuận ròng',
                    data: netIncomes,
                    type: 'line',
                    borderColor: '#1D4ED8',
                    backgroundColor: 'rgba(29, 78, 216, 0.1)',
                    borderWidth: 3,
                    fill: false,
                    tension: 0.3,
                    pointBackgroundColor: '#1D4ED8',
                    pointRadius: 5,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 12, weight: 600 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)} triệu ₫`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: 600 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: val => formatNumber(val, 0) }
                }
            }
        }
    });
}

function renderProductGroupChart(data, year) {
    const canvas = $('chartProductGroup');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartProductGroupInstance) {
        chartProductGroupInstance.destroy();
        chartProductGroupInstance = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#CBD5E1' : '#475569';

    const labels = data.map(d => d.group);
    const values = data.map(d => Math.max(0, d.netIncome));
    const colors = ['#1D4ED8', '#059669', '#7C3AED', '#D97706', '#0284C7', '#E11D48'];

    const ctx = canvas.getContext('2d');
    chartProductGroupInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: isDark ? '#1E293B' : '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11, weight: 600 }, padding: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${formatNumber(ctx.parsed)} triệu ₫`
                    }
                }
            }
        }
    });
}

function renderBranchRankingChart(data, year) {
    const canvas = $('chartBranchRanking');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartBranchRankingInstance) {
        chartBranchRankingInstance.destroy();
        chartBranchRankingInstance = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#CBD5E1' : '#475569';
    const gridColor = isDark ? '#334155' : '#E2E8F0';

    // Sắp xếp tăng dần để cột ngang xếp hạng chi nhánh cao nhất lên trên
    const sorted = [...data].sort((a, b) => a.netIncome - b.netIncome);
    const labels = sorted.map(d => d.branch);
    const values = sorted.map(d => d.netIncome);

    const ctx = canvas.getContext('2d');
    chartBranchRankingInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: `Lợi nhuận ròng (Năm ${year})`,
                data: values,
                backgroundColor: values.map(v => v >= 0 ? '#1D4ED8' : '#DC2626'),
                borderRadius: 4,
                maxBarThickness: 24
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${formatNumber(ctx.parsed.x)} triệu ₫`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: val => formatNumber(val, 0)
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: 600 } }
                }
            }
        }
    });
}

$('btnRefreshDash')?.addEventListener('click', () => {
    const year = parseInt($('dashYear')?.value || '2025', 10);
    loadDashboard(year);
});

$('dashYear')?.addEventListener('change', () => {
    const year = parseInt($('dashYear')?.value || '2025', 10);
    loadDashboard(year);
});

// ============================================================================
// PHÂN HỆ 2: BÁO CÁO HỢP NHẤT (OLAP)
// ============================================================================
async function loadReport() {
    const skeleton = $('reportSkeleton');
    const table = $('reportTable');
    const btn = $('btnRefreshReport');

    setBtnLoading(btn, true, 'Đang nạp...');
    if (skeleton) skeleton.style.display = 'flex';
    if (table) table.style.display = 'none';

    try {
        currentMode = document.querySelector('.segmented-control .segment-btn.active')?.dataset.mode || 'ROLLUP';
        currentYear = parseInt($('reportYear')?.value || '2025', 10);

        const data = await api(`/api/report?mode=${currentMode}&year=${currentYear}`);
        currentReportData = data;

        // Render Table & Chart
        renderTable(data, currentMode);
        renderChart(data, currentMode);

        // Update SQL Display if opened
        updateSqlDisplay(currentMode, currentYear);

        // Update badge
        const countBadge = $('tableRowCountBadge');
        if (countBadge) countBadge.textContent = `${data.rowCount} dòng`;

    } catch (err) {
        console.error('Lỗi khi tải báo cáo OLAP:', err);
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
        if (skeleton) skeleton.style.display = 'none';
        if (table) table.style.display = 'table';
    }
}

function renderTable(data, mode) {
    const { columns, rows } = data;
    const gidIdx = columns.indexOf('GID');
    const visibleColIndices = columns.map((col, idx) => idx).filter(idx => columns[idx] !== 'GID');

    const checkIsNumeric = (idx) => {
        const raw = columns[idx].toUpperCase();
        return raw.includes('LOI_NHUAN') || raw.includes('NET') || 
               ['Q1', 'Q2', 'Q3', 'Q4'].includes(raw) ||
               rows.some(r => typeof r[idx] === 'number');
    };

    // Table Header
    const thead = $('reportThead');
    if (thead) {
        thead.innerHTML = '<tr>' + visibleColIndices.map(idx => {
            const rawName = columns[idx];
            const label = COLUMN_LABELS[rawName] || rawName.replace(/_/g, ' ');
            const isNumericCol = checkIsNumeric(idx);
            return `<th class="${isNumericCol ? 'text-right' : 'text-left'}">${label}</th>`;
        }).join('') + '</tr>';
    }

    // Table Body
    const tbody = $('reportTbody');
    if (!tbody) return;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${visibleColIndices.length}" class="text-center text-muted" style="padding: 24px;">Không có dữ liệu phù hợp</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const gid = gidIdx >= 0 ? (row[gidIdx] ?? -1) : -1;

        let rowClass = '';
        if (gid === 7) {
            rowClass = 'row-grandtotal';
        } else if (gid > 0) {
            rowClass = 'row-subtotal';
        }

        const cellsHtml = visibleColIndices.map(idx => {
            const val = row[idx];
            const isNum = typeof val === 'number';
            const isNumericCol = checkIsNumeric(idx);

            let cellClass = isNumericCol ? 'text-right tabular-nums' : 'text-left';
            if (isNum && val < 0) cellClass += ' negative-amount';

            return `<td class="${cellClass}">${isNum ? formatNumber(val) : (val ?? '—')}</td>`;
        }).join('');

        return `<tr class="${rowClass}">${cellsHtml}</tr>`;
    }).join('');
}

function renderChart(data, mode) {
    const canvas = $('reportChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (activeChartInstance) {
        activeChartInstance.destroy();
        activeChartInstance = null;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#CBD5E1' : '#475569';
    const gridColor = isDark ? '#334155' : '#E2E8F0';

    const ctx = canvas.getContext('2d');
    const { columns, rows } = data;
    const gidIdx = columns.indexOf('GID');

    let chartType = 'bar';
    let chartLabels = [];
    let datasets = [];

    if (mode === 'ROLLUP') {
        const branchTotalRows = rows.filter(r => gidIdx >= 0 && r[gidIdx] === 1);
        chartLabels = branchTotalRows.map(r => r[1]);
        const values = branchTotalRows.map(r => r[3]);

        datasets = [{
            label: 'Lợi Nhuận Ròng Chi Nhánh (triệu ₫)',
            data: values,
            backgroundColor: values.map(v => v >= 0 ? '#1D4ED8' : '#DC2626'),
            borderRadius: 6,
            maxBarThickness: 42
        }];

        $('chartTitle').textContent = `Lợi Nhuận Ròng 9 Chi Nhánh (ROLLUP · Năm ${currentYear})`;
        $('chartSubtitle').textContent = `Dữ liệu tổng hợp cấp Chi nhánh từ mệnh đề ROLLUP`;

    } else if (mode === 'PIVOT') {
        chartLabels = rows.map(r => r[0]);
        const quarterColors = ['#1D4ED8', '#059669', '#7C3AED', '#D97706'];

        datasets = ['q1', 'q2', 'q3', 'q4'].map((qKey, qIdx) => {
            const colIndex = columns.findIndex(c => c.toLowerCase() === qKey);
            return {
                label: `Quý ${qIdx + 1}`,
                data: rows.map(r => colIndex >= 0 ? r[colIndex] : 0),
                backgroundColor: quarterColors[qIdx],
                borderRadius: 4,
                maxBarThickness: 18
            };
        });

        $('chartTitle').textContent = `So Sánh 4 Quý Của 9 Chi Nhánh (PIVOT)`;
        $('chartSubtitle').textContent = `Các quý được xoay trục thành cột`;

    } else if (mode === 'PIVOT_DYN') {
        chartLabels = rows.map(r => r[0]);
        const dynamicCols = columns.slice(1).filter(c => c !== 'GID');
        const palette = ['#1D4ED8', '#059669', '#7C3AED', '#D97706', '#0284C7', '#E11D48'];

        datasets = dynamicCols.map((colName, cIdx) => {
            const colIndex = columns.indexOf(colName);
            return {
                label: colName,
                data: rows.map(r => r[colIndex] || 0),
                backgroundColor: palette[cIdx % palette.length],
                borderRadius: 4,
                maxBarThickness: 18
            };
        });

        $('chartTitle').textContent = `Lợi Nhuận Theo Nhóm Sản Phẩm (PIVOT Động)`;
        $('chartSubtitle').textContent = `Danh sách cột được sinh tự động từ bảng danh mục dim_product_group`;

    } else if (mode === 'CUBE' || mode === 'SETS') {
        const detailRows = rows.filter(r => gidIdx >= 0 && r[gidIdx] === 0).slice(0, 12);
        chartLabels = detailRows.map(r => `${r[0]} - ${r[1]} (${r[2]})`);
        const values = detailRows.map(r => r[3]);

        datasets = [{
            label: 'Lợi Nhuận Ròng (triệu ₫)',
            data: values,
            backgroundColor: '#1D4ED8',
            borderRadius: 6,
            maxBarThickness: 36
        }];

        $('chartTitle').textContent = `Phân Tích Đa Chiều (${mode})`;
        $('chartSubtitle').textContent = `Hiển thị các tổ hợp chiều phân tích`;
    }

    activeChartInstance = new Chart(ctx, {
        type: chartType,
        data: { labels: chartLabels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: textColor, boxWidth: 12, padding: 14, font: { family: 'Plus Jakarta Sans', size: 12, weight: 600 } }
                },
                tooltip: {
                    callbacks: {
                        label: context => ` ${context.dataset.label}: ${formatNumber(context.parsed.y ?? context.parsed.x ?? 0)} triệu ₫`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11, weight: 500 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: val => formatNumber(val, 0) }
                }
            }
        }
    });
}

// Mode button switching
$$('.segmented-control .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.segmented-control .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadReport();
    });
});

$('btnRefreshReport')?.addEventListener('click', loadReport);
$('reportYear')?.addEventListener('change', loadReport);

// SQL toggle
function updateSqlDisplay(mode, year) {
    const pre = $('sqlDisplay');
    if (!pre) return;
    const template = SQL_DEFINITIONS[mode] || '-- Không có mô tả SQL';
    pre.textContent = template.replace(/:p_year/g, year);
}

$('btnToggleSql')?.addEventListener('click', () => {
    const panel = $('sqlInfoPanel');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        updateSqlDisplay(currentMode, currentYear);
    } else {
        panel.style.display = 'none';
    }
});

// Print Report
$('btnPrintReport')?.addEventListener('click', () => {
    const ts = $('printTimestamp');
    if (ts) ts.textContent = `Ngày xuất báo cáo: ${new Date().toLocaleString('vi-VN')} · Năm tài chính: ${currentYear} · Chế độ: ${currentMode}`;
    window.print();
});

// Client search in table
$('tableSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    const rows = $$('#reportTbody tr');
    rows.forEach(r => {
        const text = r.textContent.toLowerCase();
        r.style.display = text.includes(q) ? '' : 'none';
    });
});

// Export CSV / Excel
$('btnExportCsv')?.addEventListener('click', () => exportTableToCsv('BaoCao_TaiChinh.csv'));
$('btnExportExcel')?.addEventListener('click', () => exportTableToCsv('BaoCao_TaiChinh.xls'));

function exportTableToCsv(filename) {
    if (!currentReportData) return;
    const { columns, rows } = currentReportData;
    const visibleCols = columns.filter(c => c !== 'GID');
    const visibleIndices = columns.map((c, i) => i).filter(i => columns[i] !== 'GID');

    let csv = '\uFEFF'; // BOM
    csv += visibleCols.map(c => `"${COLUMN_LABELS[c] || c}"`).join(',') + '\r\n';

    rows.forEach(r => {
        const line = visibleIndices.map(i => {
            const v = r[i];
            if (v === null || v === undefined) return '""';
            return `"${v}"`;
        }).join(',');
        csv += line + '\r\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ============================================================================
// PHÂN HỆ 3: SỔ GIAO DỊCH & UNPIVOT
// ============================================================================
async function loadTransactions(page = 1) {
    txnPage = page;
    const branchId = $('txnFilterBranch')?.value || '';
    const year = $('txnFilterYear')?.value || '';
    const quarter = $('txnFilterQuarter')?.value || '';
    const search = $('txnSearchInput')?.value || '';

    const tbody = $('txnTbody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding:24px;"><span class="spinner"></span> Đang nạp dữ liệu fact_income...</td></tr>`;
    }

    try {
        const url = `/api/transactions?page=${page}&pageSize=${TXN_PAGE_SIZE}&branchId=${branchId}&year=${year}&quarter=${quarter}&search=${encodeURIComponent(search)}`;
        const data = await api(url);

        renderTransactionsTable(data);
        renderPagination(data);
    } catch (err) {
        console.error('Lỗi nạp transactions:', err);
        showToast(err.message, 'error');
    }
}

function renderTransactionsTable(data) {
    const tbody = $('txnTbody');
    if (!tbody) return;

    if (!data.rows || data.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding:24px;">Không tìm thấy giao dịch nào</td></tr>`;
        return;
    }

    tbody.innerHTML = data.rows.map(r => `
        <tr>
            <td class="text-left font-bold">#${r.factId}</td>
            <td class="text-left">${r.branchName}</td>
            <td class="text-left">${r.regionName}</td>
            <td class="text-left">${r.productName}</td>
            <td class="text-left">${r.groupName}</td>
            <td class="text-left"><span class="${r.signVal === 1 ? 'text-emerald' : 'text-rose'}">${r.itemName}</span></td>
            <td class="text-left">${r.year}</td>
            <td class="text-left">${r.quarter}</td>
            <td class="text-right tabular-nums">${formatNumber(r.amount)}</td>
            <td class="text-right tabular-nums ${r.netAmount < 0 ? 'negative-amount' : ''}">${formatNumber(r.netAmount)}</td>
            <td class="text-center">
                <div class="action-btn-group">
                    <button type="button" class="action-btn edit" onclick="openEditModal(${r.factId}, ${r.amount})" title="Sửa số tiền (kích hoạt trg_fact_audit)">
                        ✏️
                    </button>
                    <button type="button" class="action-btn delete" onclick="deleteTransaction(${r.factId})" title="Xóa giao dịch (kích hoạt trg_fact_period_guard / trg_fact_audit)">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPagination(data) {
    const container = $('txnPagination');
    if (!container) return;

    const { page, totalPages, totalRows } = data;
    if (totalPages <= 1) {
        container.innerHTML = `<span class="pagination-info">Tổng cộng: ${formatNumber(totalRows, 0)} giao dịch</span>`;
        return;
    }

    let html = '';
    html += `<button type="button" class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="loadTransactions(1)">«</button>`;
    html += `<button type="button" class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="loadTransactions(${page - 1})">‹</button>`;

    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);

    for (let p = startPage; p <= endPage; p++) {
        html += `<button type="button" class="page-btn ${p === page ? 'active' : ''}" onclick="loadTransactions(${p})">${p}</button>`;
    }

    html += `<button type="button" class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="loadTransactions(${page + 1})">›</button>`;
    html += `<button type="button" class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="loadTransactions(${totalPages})">»</button>`;
    html += `<span class="pagination-info">Trang ${page}/${totalPages} (${formatNumber(totalRows, 0)} giao dịch)</span>`;

    container.innerHTML = html;
}

$('btnSearchTxn')?.addEventListener('click', () => loadTransactions(1));
$('txnFilterBranch')?.addEventListener('change', () => loadTransactions(1));
$('txnFilterYear')?.addEventListener('change', () => loadTransactions(1));
$('txnFilterQuarter')?.addEventListener('change', () => loadTransactions(1));

// Add Transaction Modal
$('btnOpenAddTxn')?.addEventListener('click', () => {
    $('addTxnModal')?.classList.add('show');
});

$('addTxnClose')?.addEventListener('click', () => {
    $('addTxnModal')?.classList.remove('show');
});

$('addTxnCancel')?.addEventListener('click', () => {
    $('addTxnModal')?.classList.remove('show');
});

// Test mode biên lỗi checkbox
$('toggleTestMode')?.addEventListener('change', e => {
    if (e.target.checked) {
        $('addTxnAmount').value = '-5'; // Test ORA-20007
        $('addTxnPeriod').value = '202401'; // Test kỳ khóa ORA-20003
        showToast('Đã điền số tiền âm -5 và kỳ 202401 để sẵn sàng demo Trigger & Exception của Oracle', 'error', 5000);
    } else {
        $('addTxnAmount').value = '100';
        $('addTxnPeriod').value = '202503';
    }
});

$('addTxnSubmit')?.addEventListener('click', async () => {
    const btn = $('addTxnSubmit');
    setBtnLoading(btn, true, 'Đang gửi...');

    try {
        const branchId = parseInt($('addTxnBranch')?.value || '1', 10);
        const productId = parseInt($('addTxnProduct')?.value || '1', 10);
        const itemId = parseInt($('addTxnItem')?.value || '1', 10);
        const periodId = parseInt($('addTxnPeriod')?.value || '202503', 10);
        const amount = parseFloat($('addTxnAmount')?.value || '100');

        const res = await post('/api/txn', { branchId, productId, itemId, periodId, amount });
        showToast(res.message || 'Thêm giao dịch thành công!', 'success');

        $('addTxnModal')?.classList.remove('show');
        loadTransactions(1);

    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

// Edit Transaction Amount (Trigger trg_fact_audit)
window.openEditModal = function (factId, currentAmount) {
    if ($('editFactId')) $('editFactId').value = factId;
    if ($('editNewAmount')) $('editNewAmount').value = currentAmount;
    $('editAmountModal')?.classList.add('show');
};

$('editAmountCancel')?.addEventListener('click', () => {
    $('editAmountModal')?.classList.remove('show');
});

$('editAmountSave')?.addEventListener('click', async () => {
    const factId = parseInt($('editFactId')?.value, 10);
    const amount = parseFloat($('editNewAmount')?.value);
    const btn = $('editAmountSave');

    setBtnLoading(btn, true, 'Đang lưu...');
    try {
        const res = await api(`/api/transactions/${factId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });

        showToast(res.message || 'Cập nhật thành công! Kiểm tra tab Kiểm toán để xem vết audit_log.', 'success');
        $('editAmountModal')?.classList.remove('show');
        loadTransactions(txnPage);

    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

// Delete Transaction (Trigger trg_fact_period_guard or trg_fact_audit)
window.deleteTransaction = async function (factId) {
    const confirmed = await showConfirmModal(`Bạn có chắc chắn muốn xóa giao dịch #${factId}? Nếu quý đã bị chốt, Trigger trg_fact_period_guard sẽ chặn và báo lỗi ORA-20003.`);
    if (!confirmed) return;

    try {
        const res = await api(`/api/transactions/${factId}`, { method: 'DELETE' });
        showToast(res.message || 'Đã xóa giao dịch thành công!', 'success');
        loadTransactions(txnPage);
    } catch (err) {
        showToast(err.message, 'error', 8000);
    }
};

// Wide Load UNPIVOT
$('btnLoadWide')?.addEventListener('click', async () => {
    const btn = $('btnLoadWide');
    setBtnLoading(btn, true, 'Đang nạp...');

    try {
        const branchId = parseInt($('wideBranch')?.value || '1', 10);
        const productId = parseInt($('wideProduct')?.value || '1', 10);
        const itemId = parseInt($('wideItem')?.value || '1', 10);
        const year = parseInt($('wideYear')?.value || '2025', 10);

        const parseQ = id => {
            const val = $(id)?.value.trim();
            return val ? parseFloat(val) : null;
        };

        const q1 = parseQ('wideQ1');
        const q2 = parseQ('wideQ2');
        const q3 = parseQ('wideQ3');
        const q4 = parseQ('wideQ4');

        const res = await post('/api/load-wide', { branchId, productId, itemId, year, q1, q2, q3, q4 });
        showToast(res.message || 'Đã nạp thành công dữ liệu bảng rộng bằng UNPIVOT!', 'success');

        ['wideQ1', 'wideQ2', 'wideQ3', 'wideQ4'].forEach(id => {
            const el = $(id);
            if (el) el.value = '';
        });

        loadTransactions(1);
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

// ============================================================================
// PHÂN HỆ 4: QUẢN LÝ KỲ KẾ TOÁN & KHÓA SỔ
// ============================================================================
async function loadClosedQuarters() {
    try {
        const data = await api('/api/closed');
        const container = $('closedQuartersList');
        if (!container) return;

        if (data.length === 0) {
            container.innerHTML = `<div class="empty-state text-emerald">Chưa có quý nào bị khóa. Tất cả các kỳ đang mở.</div>`;
            return;
        }

        container.innerHTML = data.map(q => `
            <div class="locked-item">
                <div class="locked-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <span>${q.year}-${q.quarter}</span>
                </div>
                <span class="locked-time">Chốt lúc: ${q.closedAt}</span>
            </div>
        `).join('');

        renderQuarterGridWithData(data);
    } catch (err) {
        console.error('Lỗi khi tải danh sách quý chốt:', err);
    }
}

async function renderQuarterGrid() {
    try {
        const data = await api('/api/closed');
        renderQuarterGridWithData(data);
    } catch (err) {
        console.error('Lỗi khi nạp grid 8 quý:', err);
    }
}

function renderQuarterGridWithData(closedData) {
    const grid = $('quarterGrid');
    if (!grid) return;

    const lockedSet = new Set(closedData.map(c => `${c.year}-${c.quarter}`));

    grid.querySelectorAll('.quarter-cell').forEach(cell => {
        const y = cell.dataset.year;
        const q = cell.dataset.quarter;
        const key = `${y}-${q}`;
        const isLocked = lockedSet.has(key);

        const statusEl = cell.querySelector('.q-status');
        if (isLocked) {
            cell.className = 'quarter-cell q-locked';
            if (statusEl) {
                statusEl.className = 'q-status';
                statusEl.textContent = 'Đã khóa';
            }
        } else {
            cell.className = 'quarter-cell q-open';
            if (statusEl) {
                statusEl.className = 'q-status';
                statusEl.textContent = 'Đang mở';
            }
        }
    });
}

$('btnRefreshClosed')?.addEventListener('click', loadClosedQuarters);
$('btnRefreshQuarterGrid')?.addEventListener('click', renderQuarterGrid);

// Confirm Modal Handler
let confirmResolve = null;
function showConfirmModal(message) {
    return new Promise(resolve => {
        confirmResolve = resolve;
        $('confirmMessage').textContent = message;
        $('confirmModal')?.classList.add('show');
    });
}

$('confirmCancel')?.addEventListener('click', () => {
    $('confirmModal')?.classList.remove('show');
    if (confirmResolve) confirmResolve(false);
});

$('confirmOk')?.addEventListener('click', () => {
    $('confirmModal')?.classList.remove('show');
    if (confirmResolve) confirmResolve(true);
});

$('btnCloseQuarter')?.addEventListener('click', async () => {
    const year = parseInt($('lockYear')?.value || '2025', 10);
    const quarter = $('lockQuarter')?.value || 'Q1';

    const confirmed = await showConfirmModal(`Bạn có chắc chắn muốn chốt quý ${year}-${quarter}? Hệ thống sẽ thực hiện LOCK TABLE fact_income IN SHARE MODE và Trigger trg_fact_period_guard sẽ chặn mọi thao tác thêm/sửa/xóa.`);
    if (!confirmed) return;

    const btn = $('btnCloseQuarter');
    setBtnLoading(btn, true, 'Đang chốt...');

    try {
        const res = await post('/api/close', { year, quarter });
        showToast(res.message || `Đã chốt quý ${year}-${quarter}!`, 'success');
        loadClosedQuarters();
        loadPeriodCloseLog();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

$('btnReopenQuarter')?.addEventListener('click', async () => {
    const year = parseInt($('lockYear')?.value || '2025', 10);
    const quarter = $('lockQuarter')?.value || 'Q1';

    const confirmed = await showConfirmModal(`Bạn có muốn mở lại quý ${year}-${quarter}? Sau khi mở lại, người dùng có thể tiếp tục thêm, sửa hoặc xóa giao dịch trên kỳ này.`);
    if (!confirmed) return;

    const btn = $('btnReopenQuarter');
    setBtnLoading(btn, true, 'Đang mở lại...');

    try {
        const res = await post('/api/reopen', { year, quarter });
        showToast(res.message || `Đã mở lại quý ${year}-${quarter}!`, 'success');
        loadClosedQuarters();
        loadPeriodCloseLog();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

async function loadPeriodCloseLog() {
    try {
        const logs = await api('/api/logs/period-close');
        const tbody = $('periodCloseLogBody');
        if (!tbody) return;

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Chưa có lịch sử chốt kỳ</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr>
                <td><strong>#${l.logId}</strong></td>
                <td>${l.year}</td>
                <td><span class="badge-neutral">${l.quarter}</span></td>
                <td><span class="${l.action === 'CLOSE' ? 'badge-ora' : 'badge-pass'}">${l.action === 'CLOSE' ? 'CHỐT KỲ' : 'MỞ LẠI'}</span></td>
                <td>${l.actedBy}</td>
                <td class="text-muted">${l.actedAt}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Lỗi tải period_close_log:', err);
    }
}

// ============================================================================
// PHÂN HỆ 5: DANH MỤC & KIỂM TOÁN HỆ THỐNG
// ============================================================================
async function loadDimTables() {
    loadDimBranches();
    loadDimProducts();
    loadDimItems();
}

async function loadDimBranches() {
    const tbody = document.querySelector('#dimBranchTable tbody');
    if (!tbody) return;
    try {
        const list = await api('/api/dim/branches');
        if (!list || list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Không có dữ liệu chi nhánh</td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(b => `
            <tr>
                <td><strong>${b.id}</strong></td>
                <td>${b.name}</td>
                <td>${b.region}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Lỗi tải dim_branch:', err);
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-rose">Lỗi nạp danh mục: ${err.message}</td></tr>`;
    }
}

async function loadDimProducts() {
    const tbody = document.querySelector('#dimProductTable tbody');
    if (!tbody) return;
    try {
        const list = await api('/api/dim/products');
        if (!list || list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Không có dữ liệu sản phẩm</td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(p => `
            <tr>
                <td><strong>${p.id}</strong></td>
                <td>${p.name}</td>
                <td>${p.group}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Lỗi tải dim_product:', err);
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-rose">Lỗi nạp danh mục: ${err.message}</td></tr>`;
    }
}

async function loadDimItems() {
    const tbody = document.querySelector('#dimItemTable tbody');
    if (!tbody) return;
    try {
        const list = await api('/api/dim/items');
        if (!list || list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Không có dữ liệu khoản mục</td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(i => `
            <tr>
                <td><strong>${i.id}</strong></td>
                <td>${i.name}</td>
                <td><span class="${i.sign === 1 ? 'badge-pass' : 'badge-ora'}">${i.sign === 1 ? '+1 (Thu)' : '−1 (Chi)'}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Lỗi tải dim_income_item:', err);
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-rose">Lỗi nạp danh mục: ${err.message}</td></tr>`;
    }
}

$('btnRefreshDimBranch')?.addEventListener('click', loadDimBranches);
$('btnRefreshDimProduct')?.addEventListener('click', loadDimProducts);
$('btnRefreshDimItem')?.addEventListener('click', loadDimItems);

async function loadAuditLog() {
    const tbody = $('auditLogBody');
    if (!tbody) return;
    try {
        const logs = await api('/api/logs/audit');
        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Chưa có giao dịch sửa/xóa nào trong audit_log</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(d => `
            <tr>
                <td><strong>#${d.logId}</strong></td>
                <td><span class="${d.action === 'DELETE' ? 'badge-ora' : 'badge-pass'}">${d.action}</span></td>
                <td>${d.factId ?? '—'}</td>
                <td class="text-right tabular-nums">${d.oldAmount != null ? formatNumber(d.oldAmount) : '—'}</td>
                <td class="text-right tabular-nums">${d.newAmount != null ? formatNumber(d.newAmount) : '—'}</td>
                <td>${d.changedBy}</td>
                <td class="text-muted">${d.changedAt}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Lỗi khi tải audit_log:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-rose">Lỗi nạp nhật ký: ${err.message}</td></tr>`;
    }
}

async function loadTestLog() {
    const tbody = $('testLogBody');
    if (!tbody) return;
    try {
        const status = await api('/api/system/status');
        if (!status.testResults || status.testResults.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Chưa có kết quả test_log</td></tr>`;
            return;
        }

        tbody.innerHTML = status.testResults.map(t => {
            const isPass = t.message.startsWith('PASS') || t.message.includes('mong đợi 0') || t.message.includes('mong đợi 3');
            const badgeClass = isPass ? 'badge-pass' : (t.message.includes('ORA-') ? 'badge-ora' : 'badge-pass');
            const badgeText = isPass ? 'PASS' : (t.message.includes('ORA-') ? 'ORA' : 'INFO');

            return `
                <tr>
                    <td><strong>${t.test}</strong></td>
                    <td>
                        <span class="${badgeClass}">${badgeText}</span>
                        <span style="margin-left: 8px;">${t.message}</span>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Lỗi khi tải test_log:', err);
        tbody.innerHTML = `<tr><td colspan="2" class="text-center text-rose">Lỗi nạp test_log: ${err.message}</td></tr>`;
    }
}

async function loadSystemStatus() {
    try {
        const data = await api('/api/system/status');
        const container = $('systemStatusDetails');
        if (!container) return;

        container.innerHTML = `
            <div class="status-item">
                <span class="status-name">Trạng thái kết nối</span>
                <span class="status-val text-emerald">${data.status || 'Online'}</span>
            </div>
            <div class="status-item">
                <span class="status-name">Phiên bản CSDL</span>
                <span class="status-val">${data.oracleVersion || 'Oracle 23ai Free'}</span>
            </div>
            <div class="status-item">
                <span class="status-name">Số dòng fact_income</span>
                <span class="status-val tabular-nums">${formatNumber(data.factIncomeRows)} dòng</span>
            </div>
            <div class="status-item">
                <span class="status-name">Chuỗi kết nối (PDB)</span>
                <span class="status-val"><code>${data.connectionString || 'FREEPDB1'}</code></span>
            </div>
        `;

        const statusPill = $('oracleStatusPill');
        const statusLabel = $('statusLabel');
        if (statusPill && statusLabel) {
            if (data.status === 'Online') {
                statusPill.classList.remove('offline');
                statusLabel.textContent = `Oracle 23ai · ${formatNumber(data.factIncomeRows)} dòng`;
            } else {
                statusPill.classList.add('offline');
                statusLabel.textContent = 'Oracle 23ai Offline';
            }
        }
    } catch (err) {
        const container = $('systemStatusDetails');
        if (container) {
            container.innerHTML = `<div class="empty-state text-rose">Không thể kết nối tới Oracle Database 23ai</div>`;
        }
    }
}

$('btnNetIncome')?.addEventListener('click', async () => {
    const branchId = $('niBranch')?.value || '1';
    const year = $('niYear')?.value || '2025';
    const quarter = $('niQuarter')?.value || 'Q1';

    const btn = $('btnNetIncome');
    setBtnLoading(btn, true, 'Đang tính...');

    try {
        const res = await api(`/api/net-income?branchId=${branchId}&year=${year}&quarter=${quarter}`);
        const box = $('niResultBox');
        const valEl = $('niResultValue');

        if (box) box.style.display = 'flex';
        if (valEl) {
            valEl.textContent = `${formatNumber(res.netIncome)} triệu ₫`;
            valEl.style.color = res.netIncome < 0 ? 'var(--rose)' : 'var(--primary)';
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setBtnLoading(btn, false);
    }
});

$('btnRefreshTestLog')?.addEventListener('click', loadTestLog);
$('btnRefreshStatus')?.addEventListener('click', loadSystemStatus);
$('btnRefreshAudit')?.addEventListener('click', loadAuditLog);

// ============================================================================
// INITIALIZATION
// ============================================================================
async function loadLookups() {
    try {
        const data = await api('/api/lookups');

        // Populate Branches
        const branchHtml = data.branches.map(b => `<option value="${b.id}">${b.name} (${b.region})</option>`).join('');
        const branchFilterHtml = `<option value="">Tất cả chi nhánh</option>` + branchHtml;

        if ($('txnFilterBranch')) $('txnFilterBranch').innerHTML = branchFilterHtml;
        ['txnBranch', 'wideBranch', 'niBranch', 'addTxnBranch'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = branchHtml;
        });

        // Populate Products
        const prodHtml = data.products.map(p => `<option value="${p.id}">${p.name} (${p.group})</option>`).join('');
        ['txnProduct', 'wideProduct', 'addTxnProduct'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = prodHtml;
        });

        // Populate Items
        const itemHtml = data.items.map(i => {
            const signText = i.sign === 1 ? '+ Thu nhập' : '− Chi phí';
            return `<option value="${i.id}">${i.name} [${signText}]</option>`;
        }).join('');
        ['txnItem', 'wideItem', 'addTxnItem'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = itemHtml;
        });

    } catch (err) {
        console.error('Lỗi khi tải danh mục lookups:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Setup Theme (Default Light)
    initTheme();

    // 2. Setup Sub-Tabs
    initSubTabs();

    // 3. Load Lookups, Status, 8-Quarter Grid
    loadLookups();
    loadSystemStatus();
    loadClosedQuarters();

    // 4. Load Dashboard by default (Year 2025)
    loadDashboard(2025);
});
