// ==================== Utility Functions ====================
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function formatNumber(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return v;
    return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

// ==================== Toast Notification System ====================
function showToast(message, type = 'info', duration = 5000) {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut .35s ease forwards';
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

// ==================== API Helper ====================
async function api(url, options) {
    const res = await fetch(url, options);
    const json = await res.json();
    if (!res.ok) {
        const errMsg = json.message || json.errorCode || 'Lỗi không xác định';
        throw new Error(errMsg);
    }
    return json;
}

function post(url, body) {
    return api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

// ==================== Button Loading State ====================
function setLoading(btn, loading) {
    btn.disabled = loading;
    if (loading) {
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner" style="display:inline-block"></span> Đang xử lý...';
    } else if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
    }
}

// ==================== Animated Count-Up ====================
function animateValue(el, end, duration = 800) {
    const start = 0;
    const isNumber = typeof end === 'number';
    if (!isNumber) { el.textContent = end; return; }
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (end - start) * eased;
        el.textContent = formatNumber(Math.round(current * 100) / 100);
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

// ==================== Theme Toggle ====================
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}
initTheme();

$('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
});

// ==================== Sidebar Toggle ====================
$('sidebarToggle').addEventListener('click', () => {
    $('sidebar').classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', $('sidebar').classList.contains('collapsed'));
});

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    $('sidebar').classList.add('collapsed');
}

$('mobileToggle').addEventListener('click', () => {
    $('sidebar').classList.toggle('mobile-open');
});

// ==================== Tab Navigation ====================
$$('.nav-item').forEach(navItem => {
    navItem.addEventListener('click', e => {
        e.preventDefault();
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        navItem.classList.add('active');
        $$('.tab-panel').forEach(p => p.classList.remove('active'));
        const tab = $(navItem.dataset.tab);
        if (tab) tab.classList.add('active');
        $('sidebar').classList.remove('mobile-open');

        // Load data for specific tabs
        if (navItem.dataset.tab === 'tab-lock') loadClosedQuarters();
        if (navItem.dataset.tab === 'tab-logs') { loadTestLog(); loadSystemStatus(); loadAuditLog(); }
    });
});

// ==================== Mode Selector ====================
$$('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
        $$('.mode-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
    });
});

// ==================== Report Variables ====================
let currentReportData = null;
let reportChart = null;

// ==================== Load Report ====================
$('btnLoadReport').addEventListener('click', loadReport);

async function loadReport() {
    const mode = document.querySelector('input[name="reportMode"]:checked').value;
    const year = $('reportYear').value;
    const btn = $('btnLoadReport');
    setLoading(btn, true);
    $('reportSkeleton').style.display = 'block';
    $('reportTable').style.display = 'none';

    try {
        const data = await api(`/api/report?mode=${mode}&year=${year}`);
        currentReportData = data;
        renderReportTable(data, mode);
        renderChart(data, mode);

        // Update KPIs
        animateValue($('kpiRowCount'), data.rowCount);
        animateValue($('kpiExecTime'), data.executionMs);

        // Calculate total net income (grand total row)
        let totalIncome = '—';
        const gidIdx = data.columns.indexOf('GID');
        if (gidIdx >= 0 && mode !== 'PIVOT' && mode !== 'PIVOT_DYN') {
            const incomeCol = data.columns.findIndex(c => c.toUpperCase().includes('LOI_NHUAN') || c.toUpperCase().includes('LỢI_NHUẬN'));
            if (incomeCol >= 0) {
                // Find grand total row
                for (const row of data.rows) {
                    if ((mode === 'SETS' && row[gidIdx] === 7) || (mode !== 'SETS' && row[gidIdx] === Math.pow(2, data.columns.length - 2) - 1)) {
                        totalIncome = row[incomeCol];
                        break;
                    }
                }
                // If not found, take last row with max gid
                if (totalIncome === '—') {
                    const maxGid = Math.max(...data.rows.map(r => r[gidIdx] || 0));
                    const grandRow = data.rows.find(r => r[gidIdx] === maxGid);
                    if (grandRow && incomeCol >= 0) totalIncome = grandRow[incomeCol];
                }
            }
        }
        animateValue($('kpiNetIncome'), typeof totalIncome === 'number' ? totalIncome : 0);

        showToast(`Đã tải báo cáo ${mode}: ${data.rowCount} dòng trong ${data.executionMs}ms`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setLoading(btn, false);
        $('reportSkeleton').style.display = 'none';
        $('reportTable').style.display = 'table';
    }
}

// ==================== Render Report Table ====================
function renderReportTable(data, mode) {
    const { columns, rows } = data;
    const gidIdx = columns.indexOf('GID');
    const visibleCols = columns.map((c, i) => i).filter(i => columns[i] !== 'GID');

    // Header
    const thead = $('reportThead');
    thead.innerHTML = '<tr>' + visibleCols.map(i => {
        const name = columns[i].replace(/_/g, ' ');
        const isNum = rows.length > 0 && typeof rows[0][i] === 'number';
        return `<th class="${isNum ? 'num' : ''}">${name}</th>`;
    }).join('') + '</tr>';

    // Body
    const tbody = $('reportTbody');
    tbody.innerHTML = rows.map(row => {
        const gid = gidIdx >= 0 ? (row[gidIdx] || 0) : -1;
        let rowClass = '';
        if (gidIdx >= 0) {
            if (mode === 'SETS' && gid === 7) rowClass = 'grand-total';
            else if (mode === 'SETS' && gid > 0) rowClass = 'total-row';
            else if (mode !== 'SETS' && mode !== 'PIVOT' && mode !== 'PIVOT_DYN') {
                const maxGid = Math.pow(2, columns.length - 2) - 1;
                if (gid === maxGid) rowClass = 'grand-total';
                else if (gid > 0) rowClass = 'total-row';
            }
        }
        return `<tr class="${rowClass}">` + visibleCols.map(i => {
            const val = row[i];
            const isNum = typeof val === 'number';
            const cls = isNum ? `num${val < 0 ? ' neg' : ''}` : '';
            return `<td class="${cls}">${formatNumber(val)}</td>`;
        }).join('') + '</tr>';
    }).join('');
}

// ==================== Render Chart ====================
function renderChart(data, mode) {
    if (reportChart) { reportChart.destroy(); reportChart = null; }
    const ctx = $('reportChart').getContext('2d');

    if (mode === 'PIVOT' || mode === 'PIVOT_DYN') {
        // Bar chart: each row is a branch, columns are values
        const labels = data.rows.map(r => r[0]);
        const valueCols = data.columns.slice(1).filter(c => c !== 'GID');
        const colors = ['#0f4c81', '#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#16a085'];
        const datasets = valueCols.map((col, idx) => ({
            label: col.replace(/_/g, ' '),
            data: data.rows.map(r => r[data.columns.indexOf(col)]),
            backgroundColor: colors[idx % colors.length] + '99',
            borderColor: colors[idx % colors.length],
            borderWidth: 1
        }));
        reportChart = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => formatNumber(v) } } }
            }
        });
    } else {
        // For ROLLUP/CUBE/SETS: show bar chart of non-total rows
        const gidIdx = data.columns.indexOf('GID');
        const incomeIdx = data.columns.findIndex(c => c.toUpperCase().includes('LOI_NHUAN'));
        if (gidIdx < 0 || incomeIdx < 0) return;

        const detailRows = data.rows.filter(r => r[gidIdx] === 0).slice(0, 20);
        const labels = detailRows.map(r => {
            const parts = [];
            for (let i = 0; i < data.columns.length; i++) {
                if (i !== gidIdx && i !== incomeIdx && r[i]) parts.push(r[i]);
            }
            return parts.join(' / ');
        });
        const values = detailRows.map(r => r[incomeIdx]);

        reportChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Lợi nhuận ròng (triệu đồng)',
                    data: values,
                    backgroundColor: values.map(v => v < 0 ? '#dc262699' : '#0f4c8199'),
                    borderColor: values.map(v => v < 0 ? '#dc2626' : '#0f4c81'),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                indexAxis: labels.length > 10 ? 'y' : 'x',
                plugins: { legend: { display: false } },
                scales: { [labels.length > 10 ? 'x' : 'y']: { ticks: { callback: v => formatNumber(v) } } }
            }
        });
    }
}

// ==================== Chart Toggle ====================
$('btnToggleChart').addEventListener('click', () => {
    $('chartWrapper').classList.toggle('hidden');
});

// ==================== Table Search ====================
$('tableSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('#reportTbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
});

// ==================== CSV / Excel Export ====================
function exportData(type) {
    if (!currentReportData) { showToast('Chưa có dữ liệu để xuất', 'info'); return; }
    const { columns, rows } = currentReportData;
    const visibleCols = columns.filter(c => c !== 'GID');
    const visibleIdx = columns.map((c, i) => i).filter(i => columns[i] !== 'GID');

    let csv = '\uFEFF'; // UTF-8 BOM
    csv += visibleCols.join(',') + '\n';
    rows.forEach(row => {
        csv += visibleIdx.map(i => {
            const val = row[i];
            if (val === null || val === undefined) return '';
            if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
            return val;
        }).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: type === 'excel' ? 'application/vnd.ms-excel;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString().slice(0, 10)}.${type === 'excel' ? 'xls' : 'csv'}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Đã xuất file ${type.toUpperCase()}`, 'success');
}

$('btnExportCsv').addEventListener('click', () => exportData('csv'));
$('btnExportExcel').addEventListener('click', () => exportData('excel'));

// ==================== Confirm Modal ====================
function showConfirm(message) {
    return new Promise(resolve => {
        $('confirmMessage').textContent = message;
        $('confirmModal').classList.add('show');
        $('confirmOk').onclick = () => { $('confirmModal').classList.remove('show'); resolve(true); };
        $('confirmCancel').onclick = () => { $('confirmModal').classList.remove('show'); resolve(false); };
    });
}

// ==================== Close / Reopen Quarter ====================
$('btnCloseQuarter').addEventListener('click', async () => {
    const year = $('lockYear').value;
    const quarter = $('lockQuarter').value;
    const confirmed = await showConfirm(`Bạn có chắc chắn muốn chốt quý ${year}-${quarter}? Sau khi chốt, mọi thay đổi dữ liệu trên kỳ này sẽ bị từ chối.`);
    if (!confirmed) return;
    const btn = $('btnCloseQuarter');
    setLoading(btn, true);
    try {
        await post('/api/close', { year: +year, quarter });
        showToast(`Đã chốt quý ${year}-${quarter}`, 'success');
        loadClosedQuarters();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(btn, false); }
});

$('btnReopenQuarter').addEventListener('click', async () => {
    const year = $('lockYear').value;
    const quarter = $('lockQuarter').value;
    const btn = $('btnReopenQuarter');
    setLoading(btn, true);
    try {
        await post('/api/reopen', { year: +year, quarter });
        showToast(`Đã mở lại quý ${year}-${quarter}`, 'success');
        loadClosedQuarters();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(btn, false); }
});

async function loadClosedQuarters() {
    try {
        const data = await api('/api/closed');
        const container = $('closedQuartersList');
        if (data.length === 0) {
            container.innerHTML = '<p class="text-muted">Chưa có quý nào được chốt.</p>';
        } else {
            container.innerHTML = data.map(d =>
                `<div class="locked-card">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span><strong>${d.year}-${d.quarter}</strong> <span class="badge badge-locked">LOCKED</span> <small class="text-muted">${d.closedAt}</small></span>
                </div>`
            ).join('');
        }
        animateValue($('kpiLocked'), data.length);
        loadPeriodCloseLog();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadPeriodCloseLog() {
    try {
        const data = await api('/api/logs/period-close');
        $('periodCloseLogBody').innerHTML = data.map(d =>
            `<tr>
                <td>${d.logId}</td><td>${d.year}</td><td>${d.quarter}</td>
                <td><span class="badge ${d.action === 'CLOSE' ? 'badge-locked' : 'badge-pass'}">${d.action}</span></td>
                <td>${d.actedBy}</td><td>${d.actedAt}</td>
            </tr>`
        ).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center">Chưa có dữ liệu</td></tr>';
    } catch (e) { console.error(e); }
}

// ==================== Add Transaction ====================
$('btnAddTxn').addEventListener('click', async () => {
    const btn = $('btnAddTxn');
    setLoading(btn, true);
    try {
        await post('/api/txn', {
            branchId: +$('txnBranch').value,
            productId: +$('txnProduct').value,
            itemId: +$('txnItem').value,
            periodId: +$('txnPeriod').value,
            amount: +$('txnAmount').value
        });
        showToast('Đã thêm giao dịch thành công', 'success');
    } catch (e) { showToast(e.message, 'error', 8000); }
    finally { setLoading(btn, false); }
});

// ==================== Load Wide (UNPIVOT) ====================
$('btnLoadWide').addEventListener('click', async () => {
    const btn = $('btnLoadWide');
    setLoading(btn, true);
    try {
        const q1 = $('wideQ1').value ? +$('wideQ1').value : null;
        const q2 = $('wideQ2').value ? +$('wideQ2').value : null;
        const q3 = $('wideQ3').value ? +$('wideQ3').value : null;
        const q4 = $('wideQ4').value ? +$('wideQ4').value : null;
        const result = await post('/api/load-wide', {
            branchId: +$('wideBranch').value,
            productId: +$('wideProduct').value,
            itemId: +$('wideItem').value,
            year: +$('wideYear').value,
            q1, q2, q3, q4
        });
        showToast(result.message, 'success');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(btn, false); }
});

// ==================== Lookups (Load Dropdowns) ====================
async function loadLookups() {
    try {
        const data = await api('/api/lookups');

        // Branches
        const branchOptions = data.branches.map(b => `<option value="${b.id}">${b.name} (${b.region})</option>`).join('');
        ['txnBranch', 'wideBranch', 'niBranch'].forEach(id => { if ($(id)) $(id).innerHTML = branchOptions; });

        // Products
        const productOptions = data.products.map(p => `<option value="${p.id}">${p.name} (${p.group})</option>`).join('');
        ['txnProduct', 'wideProduct'].forEach(id => { if ($(id)) $(id).innerHTML = productOptions; });

        // Items with sign indicator
        const itemOptions = data.items.map(i => {
            const sign = i.sign === 1 ? '+ Thu nhập' : '− Chi phí';
            return `<option value="${i.id}">${i.name} [${sign}]</option>`;
        }).join('');
        ['txnItem', 'wideItem'].forEach(id => { if ($(id)) $(id).innerHTML = itemOptions; });

    } catch (e) {
        console.error('Failed to load lookups:', e);
    }
}

// ==================== Net Income Query ====================
$('btnNetIncome').addEventListener('click', async () => {
    const btn = $('btnNetIncome');
    setLoading(btn, true);
    try {
        const data = await api(`/api/net-income?branchId=${$('niBranch').value}&year=${$('niYear').value}&quarter=${$('niQuarter').value}`);
        $('niResult').textContent = `Lợi nhuận ròng: ${formatNumber(data.netIncome)} triệu đồng`;
        $('niResult').style.color = data.netIncome < 0 ? 'var(--danger)' : 'var(--accent)';
    } catch (e) { showToast(e.message, 'error'); $('niResult').textContent = ''; }
    finally { setLoading(btn, false); }
});

// ==================== Test Log ====================
async function loadTestLog() {
    try {
        const status = await api('/api/system/status');
        const tbody = $('testLogBody');
        tbody.innerHTML = status.testResults.map(t => {
            const isPass = t.message.startsWith('PASS') || t.message.includes('mong đợi 0') || t.message.includes('mong đợi 3');
            const badgeClass = isPass ? 'badge-pass' : (t.message.includes('ORA-') ? 'badge-ora' : 'badge-info');
            const label = isPass ? 'PASS' : (t.message.includes('ORA-') ? 'ORA' : 'INFO');
            return `<tr><td><strong>${t.test}</strong></td><td><span class="badge ${badgeClass}">${label}</span> ${t.message}</td></tr>`;
        }).join('') || '<tr><td colspan="2" class="text-muted">Chưa có dữ liệu</td></tr>';
    } catch (e) { console.error(e); }
}

// ==================== System Status ====================
async function loadSystemStatus() {
    try {
        const data = await api('/api/system/status');
        $('systemStatusBody').innerHTML = `
            <div class="sys-item"><span class="sys-label">Trạng thái</span><span class="sys-value" style="color:var(--success)">${data.status}</span></div>
            <div class="sys-item"><span class="sys-label">Phiên bản Oracle</span><span class="sys-value">${data.oracleVersion || 'N/A'}</span></div>
            <div class="sys-item"><span class="sys-label">Số dòng fact_income</span><span class="sys-value">${formatNumber(data.factIncomeRows)}</span></div>
            <div class="sys-item"><span class="sys-label">Kết nối</span><span class="sys-value">${data.connectionString}</span></div>
        `;
    } catch (e) {
        $('systemStatusBody').innerHTML = `<div class="sys-item"><span class="sys-label">Trạng thái</span><span class="sys-value" style="color:var(--danger)">Offline</span></div>`;
    }
}

// ==================== Audit Log ====================
async function loadAuditLog() {
    try {
        const data = await api('/api/logs/audit');
        $('auditLogBody').innerHTML = data.map(d =>
            `<tr>
                <td>${d.logId}</td><td>${d.action}</td><td>${d.factId ?? ''}</td>
                <td class="num">${d.oldAmount != null ? formatNumber(d.oldAmount) : ''}</td>
                <td class="num">${d.newAmount != null ? formatNumber(d.newAmount) : ''}</td>
                <td>${d.changedBy}</td><td>${d.changedAt}</td>
            </tr>`
        ).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center">Chưa có dữ liệu</td></tr>';
    } catch (e) { console.error(e); }
}

$('btnRefreshAudit').addEventListener('click', loadAuditLog);

// ==================== Oracle Status Check ====================
async function checkOracleStatus() {
    try {
        const data = await api('/api/system/status');
        const dot = document.querySelector('.status-dot');
        if (data.status === 'Online') {
            dot.classList.remove('offline');
        } else {
            dot.classList.add('offline');
        }
    } catch {
        document.querySelector('.status-dot').classList.add('offline');
    }
}

// ==================== Initialize ====================
document.addEventListener('DOMContentLoaded', () => {
    loadLookups();
    checkOracleStatus();
    loadClosedQuarters();
});

