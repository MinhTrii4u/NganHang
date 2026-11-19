/**
 * ============================================================================
 * BANK REPORT - MODERN EXECUTIVE FINTECH APPLICATION SCRIPT
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
        minimumFractionDigits: decimals > 0 ? 0 : 0,
        maximumFractionDigits: decimals
    });
}

// Animated count-up for numbers
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

    // Re-render chart if open to adjust colors
    if (currentReportData && activeChartInstance) {
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

// Tab navigation
$$('.sidebar-menu .menu-item').forEach(item => {
    item.addEventListener('click', e => {
        e.preventDefault();
        $$('.sidebar-menu .menu-item').forEach(m => m.classList.remove('active'));
        item.classList.add('active');

        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        const tabId = item.dataset.tab;
        const targetPanel = $(tabId);
        if (targetPanel) targetPanel.classList.add('active');

        $('sidebar')?.classList.remove('mobile-open');

        // Lazy load tab data
        if (tabId === 'tab-lock') {
            loadClosedQuarters();
            loadPeriodCloseLog();
        } else if (tabId === 'tab-logs') {
            loadTestLog();
            loadSystemStatus();
            loadAuditLog();
        }
    });
});

// ============================================================================
// REPORT LOADING (MAIN FEATURE)
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

        // Render Table and Chart
        renderTable(data, currentMode);
        renderChart(data, currentMode);

        // Calculate and animate KPIs
        updateKPIs(data, currentMode, currentYear);

        // Update badges
        const countBadge = $('tableRowCountBadge');
        if (countBadge) countBadge.textContent = `${data.rowCount} dòng`;

    } catch (err) {
        console.error('Lỗi khi tải báo cáo:', err);
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
        if (skeleton) skeleton.style.display = 'none';
        if (table) table.style.display = 'table';
    }
}

// Calculate and animate KPI Cards
function updateKPIs(data, mode, year) {
    const { columns, rows, rowCount, executionMs } = data;

    // 1. Row count & execution time
    animateCount($('kpiRowCount'), rowCount);
    animateCount($('kpiExecTime'), executionMs);

    const rowCountMeta = $('kpiRowCountMeta');
    if (rowCountMeta) {
        const modeDesc = {
            'ROLLUP': 'Báo cáo ROLLUP đa cấp bậc',
            'CUBE': 'Báo cáo CUBE mọi tổ hợp chiều',
            'SETS': 'Báo cáo GROUPING SETS chọn lọc',
            'PIVOT': 'Báo cáo PIVOT 4 Quý thành cột',
            'PIVOT_DYN': 'Báo cáo PIVOT Nhóm Sản Phẩm động'
        };
        rowCountMeta.textContent = modeDesc[mode] || `${mode} - ${year}`;
    }

    // 2. Net Income calculation
    let grandTotalIncome = null;
    const gidIdx = columns.indexOf('GID');
    const incomeColIdx = columns.findIndex(c => c.toUpperCase().includes('LOI_NHUAN') || c.toUpperCase().includes('NET'));

    if (mode === 'ROLLUP' || mode === 'CUBE' || mode === 'SETS') {
        if (gidIdx >= 0 && incomeColIdx >= 0) {
            // Grand total row has highest GID (7 for 3 grouped columns)
            const grandTotalRow = rows.find(r => r[gidIdx] === 7);
            if (grandTotalRow) {
                grandTotalIncome = grandTotalRow[incomeColIdx];
            } else {
                // Fallback: row with region or branch = 'Tổng toàn hệ thống'
                const fallbackRow = rows.find(r => r[0] === 'Tổng toàn hệ thống' || r[1] === 'Tổng toàn hệ thống');
                if (fallbackRow) grandTotalIncome = fallbackRow[incomeColIdx];
            }
        }
    } else if (mode === 'PIVOT' || mode === 'PIVOT_DYN') {
        // In PIVOT mode, sum all numeric columns across all branch rows
        let sum = 0;
        const numIndices = columns.map((col, idx) => idx).filter(idx => idx > 0 && columns[idx] !== 'GID');
        rows.forEach(r => {
            numIndices.forEach(colIdx => {
                const val = r[colIdx];
                if (typeof val === 'number') sum += val;
            });
        });
        grandTotalIncome = sum;
    }

    if (grandTotalIncome !== null) {
        animateCount($('kpiNetIncome'), grandTotalIncome);
        const meta = $('kpiNetIncomeMeta');
        if (meta) meta.textContent = `Tổng toàn hệ thống (Năm ${year})`;
    } else {
        $('kpiNetIncome').textContent = '—';
    }
}

// ============================================================================
// TABLE RENDERING
// ============================================================================
function renderTable(data, mode) {
    const { columns, rows } = data;
    const gidIdx = columns.indexOf('GID');
    const visibleColIndices = columns.map((col, idx) => idx).filter(idx => columns[idx] !== 'GID');

    // Render Table Header
    const thead = $('reportThead');
    if (thead) {
        thead.innerHTML = '<tr>' + visibleColIndices.map(idx => {
            const rawName = columns[idx];
            const label = COLUMN_LABELS[rawName] || rawName.replace(/_/g, ' ');
            const isNumericCol = rows.length > 0 && typeof rows[0][idx] === 'number';
            return `<th class="${isNumericCol ? 'text-right' : ''}">${label}</th>`;
        }).join('') + '</tr>';
    }

    // Render Table Body
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

            let cellClass = '';
            if (isNum) {
                cellClass = 'text-right tabular-nums';
                if (val < 0) cellClass += ' negative-amount';
            }

            return `<td class="${cellClass}">${isNum ? formatNumber(val) : (val ?? '—')}</td>`;
        }).join('');

        return `<tr class="${rowClass}">${cellsHtml}</tr>`;
    }).join('');
}

// ============================================================================
// CHART RENDERING (CHART.JS)
// ============================================================================
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
        // Display comparison of 9 Branches: extract rows where gid == 1 (branch total)
        const branchTotalRows = rows.filter(r => gidIdx >= 0 && r[gidIdx] === 1);
        chartLabels = branchTotalRows.map(r => r[1]); // Branch name
        const values = branchTotalRows.map(r => r[3]); // Net income

        datasets = [{
            label: 'Lợi Nhuận Ròng Chi Nhánh (triệu ₫)',
            data: values,
            backgroundColor: values.map(v => v >= 0 ? '#1D4ED8' : '#DC2626'),
            borderRadius: 6,
            maxBarThickness: 42
        }];

        $('chartTitle').textContent = `Lợi Nhuận Ròng 9 Chi Nhánh (Năm ${currentYear})`;
        $('chartSubtitle').textContent = `Dữ liệu tổng hợp cấp Chi nhánh từ mệnh đề ROLLUP`;

    } else if (mode === 'PIVOT') {
        // Compare Q1, Q2, Q3, Q4 across 9 branches
        chartLabels = rows.map(r => r[0]); // Chi nhánh
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
        // Compare Product Groups across 9 branches
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
        // Display top contributing segments
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
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        boxWidth: 12,
                        padding: 14,
                        font: { family: 'Plus Jakarta Sans', size: 12, weight: 600 }
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? '#1E293B' : '#0F172A',
                    titleColor: '#FFFFFF',
                    bodyColor: '#F8FAFC',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function (context) {
                            const val = context.parsed.y ?? context.parsed.x ?? 0;
                            return ` ${context.dataset.label}: ${formatNumber(val)} triệu ₫`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor, drawBorder: false },
                    ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11, weight: 500 } }
                },
                y: {
                    grid: { color: gridColor, drawBorder: false },
                    ticks: {
                        color: textColor,
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        callback: val => formatNumber(val, 0)
                    }
                }
            }
        }
    });
}

// Chart Toggle
$('btnToggleChart')?.addEventListener('click', () => {
    const content = $('chartContent');
    const textEl = $('chartToggleText');
    if (!content) return;

    content.classList.toggle('collapsed');
    if (content.classList.contains('collapsed')) {
        if (textEl) textEl.textContent = 'Mở rộng';
    } else {
        if (textEl) textEl.textContent = 'Thu gọn';
    }
});

// ============================================================================
// TABLE SEARCH & EXPORT
// ============================================================================
$('tableSearch')?.addEventListener('input', e => {
    const term = e.target.value.toLowerCase().trim();
    const rows = $$('#reportTbody tr');
    let visibleCount = 0;

    rows.forEach(tr => {
        const text = tr.textContent.toLowerCase();
        const match = !term || text.includes(term);
        tr.style.display = match ? '' : 'none';
        if (match) visibleCount++;
    });

    const badge = $('tableRowCountBadge');
    if (badge) badge.textContent = `${visibleCount} dòng`;
});

function exportReport(format = 'csv') {
    if (!currentReportData || !currentReportData.rows.length) {
        showToast('Không có dữ liệu báo cáo để xuất', 'error');
        return;
    }

    const { columns, rows } = currentReportData;
    const visibleIndices = columns.map((c, i) => i).filter(i => columns[i] !== 'GID');
    const headerRow = visibleIndices.map(i => COLUMN_LABELS[columns[i]] || columns[i]);

    let content = '\uFEFF'; // UTF-8 BOM for Excel
    content += headerRow.join(',') + '\r\n';

    rows.forEach(r => {
        const rowVals = visibleIndices.map(i => {
            const val = r[i];
            if (val === null || val === undefined) return '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        content += rowVals.join(',') + '\r\n';
    });

    const mime = format === 'excel' ? 'application/vnd.ms-excel;charset=utf-8' : 'text/csv;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `BaoCao_HopNhat_${currentMode}_${currentYear}.${format === 'excel' ? 'xls' : 'csv'}`;
    link.click();
    URL.revokeObjectURL(link.href);

    showToast(`Đã xuất file ${format.toUpperCase()} thành công!`);
}

$('btnExportCsv')?.addEventListener('click', () => exportReport('csv'));
$('btnExportExcel')?.addEventListener('click', () => exportReport('excel'));

// ============================================================================
// INTERACTIVE CONTROLS (MODE & YEAR)
// ============================================================================
$$('.segmented-control .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.segmented-control .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Auto-refresh instantly
        loadReport();
    });
});

$('reportYear')?.addEventListener('change', () => {
    loadReport();
});

$('btnRefreshReport')?.addEventListener('click', () => {
    loadReport();
});

// ============================================================================
// TAB 2: CHỐT KỲ & KIỂM SOÁT KHÓA
// ============================================================================
function showConfirmModal(message) {
    return new Promise(resolve => {
        const modal = $('confirmModal');
        const msgEl = $('confirmMessage');
        const okBtn = $('confirmOk');
        const cancelBtn = $('confirmCancel');

        if (msgEl) msgEl.textContent = message;
        if (modal) modal.classList.add('show');

        const cleanUp = () => {
            if (modal) modal.classList.remove('show');
            okBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        okBtn.onclick = () => { cleanUp(); resolve(true); };
        cancelBtn.onclick = () => { cleanUp(); resolve(false); };
    });
}

$('btnCloseQuarter')?.addEventListener('click', async () => {
    const year = parseInt($('lockYear')?.value || '2024', 10);
    const quarter = $('lockQuarter')?.value || 'Q1';

    const confirmed = await showConfirmModal(`Bạn có chắc chắn muốn chốt quý ${year}-${quarter}? Hệ thống sẽ khóa SHARE MODE và trigger sẽ chặn mọi thao tác cập nhật dữ liệu trên kỳ này.`);
    if (!confirmed) return;

    const btn = $('btnCloseQuarter');
    setBtnLoading(btn, true, 'Đang chốt...');

    try {
        const res = await post('/api/close', { year, quarter });
        showToast(res.message || `Đã chốt thành công quý ${year}-${quarter}`, 'success');
        loadClosedQuarters();
        loadPeriodCloseLog();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

$('btnReopenQuarter')?.addEventListener('click', async () => {
    const year = parseInt($('lockYear')?.value || '2024', 10);
    const quarter = $('lockQuarter')?.value || 'Q1';

    const confirmed = await showConfirmModal(`Bạn có muốn mở lại quý ${year}-${quarter}? Sau khi mở lại, người dùng có thể tiếp tục thêm, sửa giao dịch.`);
    if (!confirmed) return;

    const btn = $('btnReopenQuarter');
    setBtnLoading(btn, true, 'Đang mở lại...');

    try {
        const res = await post('/api/reopen', { year, quarter });
        showToast(res.message || `Đã mở lại thành công quý ${year}-${quarter}`, 'success');
        loadClosedQuarters();
        loadPeriodCloseLog();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

async function loadClosedQuarters() {
    try {
        const list = await api('/api/closed');
        const container = $('closedQuartersList');
        const kpiLocked = $('kpiLockedCount');
        const kpiMeta = $('kpiLockedMeta');

        if (kpiLocked) kpiLocked.textContent = list.length;

        if (list.length === 0) {
            if (container) container.innerHTML = `<div class="empty-state">Chưa có quý nào được chốt bảo vệ.</div>`;
            if (kpiMeta) kpiMeta.textContent = 'Chưa có quý nào bị khóa';
            return;
        }

        const names = list.map(item => `${item.year}-${item.quarter}`).join(', ');
        if (kpiMeta) kpiMeta.textContent = `Đang khóa: ${names}`;

        if (container) {
            container.innerHTML = list.map(item => `
                <div class="locked-card">
                    <div class="locked-card-info">
                        <span class="locked-pill">ĐÃ KHÓA</span>
                        <span class="locked-quarter-name">${item.year} - ${item.quarter}</span>
                    </div>
                    <span class="locked-time">${item.closedAt}</span>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Lỗi khi tải danh sách quý chốt:', err);
    }
}

async function loadPeriodCloseLog() {
    try {
        const logs = await api('/api/logs/period-close');
        const tbody = $('periodCloseLogBody');
        if (!tbody) return;

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Chưa có bản ghi nhật ký</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(d => {
            const badgeClass = d.action === 'CLOSE' ? 'badge-ora' : 'badge-pass';
            return `
                <tr>
                    <td><strong>#${d.logId}</strong></td>
                    <td>${d.year}</td>
                    <td><strong>${d.quarter}</strong></td>
                    <td><span class="${badgeClass}">${d.action}</span></td>
                    <td>${d.actedBy}</td>
                    <td class="text-muted">${d.actedAt}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Lỗi khi tải nhật ký chốt kỳ:', err);
    }
}

$('btnRefreshClosed')?.addEventListener('click', () => {
    loadClosedQuarters();
    loadPeriodCloseLog();
});

// ============================================================================
// TAB 3: NHẬP GIAO DỊCH & UNPIVOT
// ============================================================================
$('btnAddTxn')?.addEventListener('click', async () => {
    const btn = $('btnAddTxn');
    setBtnLoading(btn, true, 'Đang gửi giao dịch...');

    try {
        const branchId = parseInt($('txnBranch')?.value || '1', 10);
        const productId = parseInt($('txnProduct')?.value || '1', 10);
        const itemId = parseInt($('txnItem')?.value || '1', 10);
        const periodId = parseInt($('txnPeriod')?.value || '202503', 10);
        const amount = parseFloat($('txnAmount')?.value || '100');

        const res = await post('/api/txn', { branchId, productId, itemId, periodId, amount });
        showToast(res.message || 'Đã thêm giao dịch thành công vào Oracle 23ai!', 'success');

        // Refresh current report to show new numbers
        loadReport();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

// Toggle test mode for edge cases
$('toggleTestMode')?.addEventListener('change', e => {
    const isTest = e.target.checked;
    const periodInput = $('txnPeriod');
    const amountInput = $('txnAmount');

    if (isTest) {
        if (periodInput) periodInput.value = 202402; // Closed quarter test
        if (amountInput) amountInput.value = -5; // Negative amount test
        showToast('Đã điền giá trị kiểm thử biên: Kỳ 202402 và Số tiền -5', 'error');
    } else {
        if (periodInput) periodInput.value = 202503;
        if (amountInput) amountInput.value = 100;
    }
});

// Load wide table (UNPIVOT)
$('btnLoadWide')?.addEventListener('click', async () => {
    const btn = $('btnLoadWide');
    setBtnLoading(btn, true, 'Đang xử lý UNPIVOT...');

    try {
        const branchId = parseInt($('wideBranch')?.value || '1', 10);
        const productId = parseInt($('wideProduct')?.value || '1', 10);
        const itemId = parseInt($('wideItem')?.value || '1', 10);
        const year = parseInt($('wideYear')?.value || '2025', 10);

        const q1 = $('wideQ1')?.value ? parseFloat($('wideQ1').value) : null;
        const q2 = $('wideQ2')?.value ? parseFloat($('wideQ2').value) : null;
        const q3 = $('wideQ3')?.value ? parseFloat($('wideQ3').value) : null;
        const q4 = $('wideQ4')?.value ? parseFloat($('wideQ4').value) : null;

        const res = await post('/api/load-wide', { branchId, productId, itemId, year, q1, q2, q3, q4 });
        showToast(res.message || 'Đã nạp thành công dữ liệu bảng rộng bằng UNPIVOT!', 'success');

        // Clear quarter inputs
        ['wideQ1', 'wideQ2', 'wideQ3', 'wideQ4'].forEach(id => {
            const el = $(id);
            if (el) el.value = '';
        });

        loadReport();
    } catch (err) {
        showToast(err.message, 'error', 8000);
    } finally {
        setBtnLoading(btn, false);
    }
});

// ============================================================================
// TAB 4: NHẬT KÝ & HỆ THỐNG
// ============================================================================
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

async function loadTestLog() {
    try {
        const status = await api('/api/system/status');
        const tbody = $('testLogBody');
        if (!tbody) return;

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

        // Update header pill
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

async function loadAuditLog() {
    try {
        const logs = await api('/api/logs/audit');
        const tbody = $('auditLogBody');
        if (!tbody) return;

        if (logs.length === 0) {
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
    }
}

$('btnRefreshTestLog')?.addEventListener('click', loadTestLog);
$('btnRefreshStatus')?.addEventListener('click', loadSystemStatus);
$('btnRefreshAudit')?.addEventListener('click', loadAuditLog);

// ============================================================================
// INITIALIZATION ON DOMCONTENTLOADED
// ============================================================================
async function loadLookups() {
    try {
        const data = await api('/api/lookups');

        // 1. Branches
        const branchHtml = data.branches.map(b => `<option value="${b.id}">${b.name} (${b.region})</option>`).join('');
        ['txnBranch', 'wideBranch', 'niBranch'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = branchHtml;
        });

        // 2. Products
        const prodHtml = data.products.map(p => `<option value="${p.id}">${p.name} (${p.group})</option>`).join('');
        ['txnProduct', 'wideProduct'].forEach(id => {
            const el = $(id);
            if (el) el.innerHTML = prodHtml;
        });

        // 3. Items
        const itemHtml = data.items.map(i => {
            const signText = i.sign === 1 ? '+ Thu nhập' : '− Chi phí';
            return `<option value="${i.id}">${i.name} [${signText}]</option>`;
        }).join('');
        ['txnItem', 'wideItem'].forEach(id => {
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

    // 2. Load Lookups, Status & Closed Quarters
    loadLookups();
    loadSystemStatus();
    loadClosedQuarters();

    // 3. CRITICAL: Automatically load initial ROLLUP 2025 report immediately!
    loadReport();
});
