/* ==========================================================
   student.js
   ========================================================== */

let currentStudent = {};
let semesterLabels = [];

// ----- BACKEND CALL GOES HERE -----
// Real version: GET /api/student/me/semester-summary/?semester=<n>
// Per-semester attendance + academic summary. Only 1st-4th exist
// here since that's what the mockup shows (4th = in progress).
let semesterSummary = {};

// Class performance is only fully modeled for the current (4th)
// semester, matching the mockup. Total is COMPUTED, not hardcoded
// (verified against the mockup's own numbers before writing this):
// unitTest + assignment + preboard + lab(0 if none) + grooming + overall.
let classPerformanceBySemester = {};
function subjectTotal(row) {
  return row.total == null ? 0 : Number(row.total);
}

let topScorersBySemester = {};

// Per-semester subject average. Each subject total is on the same
// permanent 100-point scale used throughout the student dashboard.
let avgMarksBySemester = {};

const ATTENDANCE_ALERT_THRESHOLD = 90; // matches the "Below 90%" flag in the mockup
const studentCharts = {};

function renderStudentChart(key, canvas, type, labels, values, colors) {
  studentCharts[key]?.destroy();
  if (typeof Chart === "undefined") {
    canvas.parentElement.textContent = "Chart library could not load. Check your internet connection and refresh.";
    return;
  }
  if (!values.some((value) => value != null && Number(value) > 0)) {
    canvas.style.display = "none";
    return;
  }
  canvas.style.display = "block";
  studentCharts[key] = new Chart(canvas, {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#4f6df5", borderWidth: type === "line" ? 2 : 0, tension: 0.35, fill: type === "line" ? false : undefined, borderRadius: type === "bar" ? 6 : 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === "doughnut", position: "bottom" }, tooltip: { callbacks: { label: (context) => `${context.label}: ${Number(context.parsed.y ?? context.parsed).toFixed(1)}%` } } }, scales: type === "doughnut" ? {} : { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } } } },
  });
}

/* ----------------------------------------------------------
   Small helpers
   ---------------------------------------------------------- */
function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0;
}
function todayDisplayString() {
  return new Date().toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}
function todayWeekday() {
  return new Date().toLocaleDateString(undefined, { weekday: "long" });
}

function showStudentCelebration() {
  if (sessionStorage.getItem("spaams_show_student_celebration") !== "true") return;
  sessionStorage.removeItem("spaams_show_student_celebration");
  const overlay = document.getElementById("student-celebration");
  const colors = ["#ff5f7e", "#4f6df5", "#2fbf71", "#f0b429", "#9b6cf5", "#35c4d8"];
  overlay.innerHTML = `<div class="celebration-message"><strong>Welcome to SPAAMS</strong><small>Your account is ready.</small></div>`;
  for (let index = 0; index < 26; index += 1) {
    const balloon = document.createElement("span");
    balloon.className = "celebration-balloon";
    balloon.style.setProperty("--x", `${4 + Math.random() * 92}%`);
    balloon.style.setProperty("--delay", `${Math.random() * 0.7}s`);
    balloon.style.setProperty("--duration", `${3.6 + Math.random() * 1.6}s`);
    balloon.style.setProperty("--drift", `${-70 + Math.random() * 140}px`);
    balloon.style.setProperty("--size", `${32 + Math.random() * 27}px`);
    balloon.style.setProperty("--color", colors[index % colors.length]);
    overlay.appendChild(balloon);
  }
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  setTimeout(() => { overlay.classList.remove("show"); overlay.setAttribute("aria-hidden", "true"); }, 5100);
}

/* ----------------------------------------------------------
   SVG charts — no external library, matching the rest of the app.
   ---------------------------------------------------------- */
let chartTooltipEl = null;
function ensureTooltip() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "s-chart-tooltip";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}
function showTooltip(evt, text) {
  const tip = ensureTooltip();
  tip.textContent = text;
  tip.style.left = `${evt.clientX + 12}px`;
  tip.style.top = `${evt.clientY - 10}px`;
  tip.style.display = "block";
}
function hideTooltip() {
  if (chartTooltipEl) chartTooltipEl.style.display = "none";
}

function renderSparkline(containerId, values, color) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const w = el.clientWidth || 140;
  const h = 30;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 6) - 3;
    return `${x},${y}`;
  }).join(" ");

  el.innerHTML = `
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function renderBarChart(containerId, data, { maxValue, valueSuffix = "" } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const width = 640, height = 260, padBottom = 34, padTop = 24, padLeft = 10;
  const barGap = 18;
  const usableWidth = width - padLeft * 2;
  const barWidth = usableWidth / data.length - barGap;
  const max = maxValue || Math.max(...data.map((d) => d.value)) * 1.15;
  const colors = ["#4f6df5", "#2fbf9a", "#8a5cf6", "#e0a324", "#4f9dff"];

  let bars = "";
  data.forEach((d, i) => {
    const barHeight = (d.value / max) * (height - padTop - padBottom);
    const x = padLeft + i * (barWidth + barGap);
    const y = height - padBottom - barHeight;
    const color = colors[i % colors.length];
    bars += `
      <g class="s-bar-group" data-tooltip="${d.label}: ${d.value}${valueSuffix}">
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${color}" />
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="#1c2434">${d.value}</text>
        <text x="${x + barWidth / 2}" y="${height - padBottom + 16}" text-anchor="middle" font-size="10.5" fill="#8894a6">${d.label}</text>
      </g>
    `;
  });

  el.innerHTML = `<svg width="100%" viewBox="0 0 ${width} ${height}" style="max-width:100%;">${bars}</svg>`;

  el.querySelectorAll(".s-bar-group").forEach((g) => {
    g.addEventListener("mousemove", (e) => showTooltip(e, g.dataset.tooltip));
    g.addEventListener("mouseleave", hideTooltip);
  });
}

function renderLineChart(containerId, points, { yMin = 60, yMax = 100 } = {}) {
  // points: [{ label, value }] — value can be null (not yet available,
  // e.g. current semester's board marks aren't out yet). Null points
  // get a dashed projection stub instead of a solid line segment.
  const el = document.getElementById(containerId);
  if (!el) return;
  const width = 640, height = 220, padLeft = 46, padRight = 20, padTop = 16, padBottom = 30;
  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;

  const knownPoints = points.filter((p) => p.value !== null);
  const stepX = usableW / (points.length - 1);

  function xFor(i) { return padLeft + i * stepX; }
  function yFor(v) { return padTop + usableH - ((v - yMin) / (yMax - yMin)) * usableH; }

  // gridlines every 10%
  let grid = "";
  for (let v = yMin; v <= yMax; v += 10) {
    const y = yFor(v);
    grid += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#eef0f6" stroke-width="1" />`;
    grid += `<text x="${padLeft - 10}" y="${y + 4}" font-size="10" fill="#8894a6" text-anchor="end">${v}%</text>`;
  }

  const solidPts = knownPoints.map((p) => `${xFor(points.indexOf(p))},${yFor(p.value)}`).join(" ");

  // dashed projection: from the last known point to the chart's right edge
  let dashedLine = "";
  if (knownPoints.length < points.length && knownPoints.length > 0) {
    const lastKnownIndex = points.indexOf(knownPoints[knownPoints.length - 1]);
    const lastX = xFor(lastKnownIndex), lastY = yFor(knownPoints[knownPoints.length - 1].value);
    const endX = xFor(points.length - 1), endY = lastY;
    dashedLine = `<line x1="${lastX}" y1="${lastY}" x2="${endX}" y2="${endY}" stroke="#4f6df5" stroke-width="2" stroke-dasharray="5,5" />`;
  }

  let dots = "";
  let labels = "";
  points.forEach((p, i) => {
    const x = xFor(i);
    labels += `<text x="${x}" y="${height - 8}" font-size="10.5" fill="#8894a6" text-anchor="middle">${p.label}</text>`;
    if (p.value !== null) {
      const y = yFor(p.value);
      dots += `
        <g class="s-line-dot" data-tooltip="${p.label}: ${p.value}%">
          <circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="#4f6df5" stroke-width="2.5" />
          <text x="${x}" y="${y - 12}" font-size="11" font-weight="700" fill="#1c2434" text-anchor="middle">${p.value}%</text>
        </g>
      `;
    }
  });

  el.innerHTML = `
    <svg width="100%" viewBox="0 0 ${width} ${height}" style="max-width:100%;">
      ${grid}
      <polyline points="${solidPts}" fill="none" stroke="#4f6df5" stroke-width="2.5" />
      ${dashedLine}
      ${dots}
      ${labels}
    </svg>
  `;

  el.querySelectorAll(".s-line-dot").forEach((g) => {
    g.addEventListener("mousemove", (e) => showTooltip(e, g.dataset.tooltip));
    g.addEventListener("mouseleave", hideTooltip);
  });
}

/* ----------------------------------------------------------
   Populate: Personal Details tab
   ---------------------------------------------------------- */
function renderPersonalTab() {
  document.getElementById("p-full-name").textContent = currentStudent.full_name;
  document.getElementById("p-student-id").textContent = `Student ID: ${currentStudent.student_id}`;
  document.getElementById("p-reg-no").textContent = `Reg. No.: ${currentStudent.reg_no}`;
  document.getElementById("p-program").textContent = currentStudent.program;

  document.getElementById("p-info-table").innerHTML = `
    <tr><td>Date of Birth</td><td>${currentStudent.dob}</td></tr>
    <tr><td>Address</td><td>${currentStudent.address}</td></tr>
    <tr><td>Phone</td><td>${currentStudent.phone}</td></tr>
    <tr><td>Email</td><td>${currentStudent.email}</td></tr>
    <tr><td>Guardian Name</td><td>${currentStudent.guardian_name}</td></tr>
    <tr><td>Guardian Contact</td><td>${currentStudent.guardian_phone}</td></tr>
  `;
}

/* ----------------------------------------------------------
   Populate: Academic Details tab
   ---------------------------------------------------------- */
function renderAcademicTab() {
  const tbody = document.getElementById("a-academic-body");
  tbody.innerHTML = semesterLabels.map((label, i) => {
    const semNum = i + 1;
    const s = semesterSummary[semNum];
    return `
      <tr>
        <td>${label}</td>
        <td>${currentStudent.full_name}</td>
        <td>${currentStudent.student_id}</td>
        <td>${s.boardMarks !== null ? s.boardMarks.toFixed(2) : "-"}</td>
        <td>${s.cgpa !== null ? s.cgpa.toFixed(2) : "-"}</td>
      </tr>
    `;
  }).join("");

  const progressCanvas = document.getElementById("a-progress-chart");
  const progressValues = semesterLabels.map((_, index) => semesterSummary[index + 1]?.boardMarks ?? null);
  renderStudentChart("academic-progress", progressCanvas, "line", semesterLabels, progressValues, "#4f6df5");

  const currentSemNum = Math.max(...Object.keys(semesterSummary).map(Number));
  const rows = classPerformanceBySemester[currentSemNum] || [];
  document.getElementById("a-avg-label").textContent = `Avg. Marks (${semesterLabels[currentSemNum - 1]})`;
  const enteredRows = rows.filter((row) => row.has_entered_marks === true || row.total != null);
  const average = avgMarksBySemester[currentSemNum];
  document.getElementById("a-avg-value").textContent = average == null ? "–" : `${average.toFixed(2)}%`;

  if (enteredRows.length > 0) {
    const withTotals = enteredRows.map((r) => ({ ...r, total: subjectTotal(r) }));
    const best = withTotals.reduce((a, b) => (b.total > a.total ? b : a));
    const worst = withTotals.reduce((a, b) => (b.total < a.total ? b : a));
    document.getElementById("a-best-subject").textContent = `${best.subject} (${best.total}/100)`;
    document.getElementById("a-lowest-subject").textContent = `${worst.subject} (${worst.total}/100)`;
  } else {
    document.getElementById("a-best-subject").textContent = "–";
    document.getElementById("a-lowest-subject").textContent = "–";
  }

  const s = semesterSummary[currentSemNum];
  const attendancePct = pct(s.present, s.total);
  document.getElementById("a-attendance-value").textContent = `${attendancePct.toFixed(2)}%`;
  const flag = document.getElementById("a-attendance-flag");
  if (attendancePct < ATTENDANCE_ALERT_THRESHOLD) {
    flag.textContent = `Below ${ATTENDANCE_ALERT_THRESHOLD}%`;
    flag.style.display = "block";
  } else {
    flag.style.display = "none";
  }
}

/* ----------------------------------------------------------
   Populate: Class Details tab (semester-select driven)
   ---------------------------------------------------------- */
function loadClassDetails(semNum) {
  const s = semesterSummary[semNum];
  if (!s) return;

  document.getElementById("s-welcome-msg").textContent = `Welcome back, ${currentStudent.full_name.split(" ")[0]}.`;

  document.getElementById("c-full-name").textContent = currentStudent.full_name;
  document.getElementById("c-student-id").textContent = `Student ID: ${currentStudent.student_id}`;
  document.getElementById("c-reg-no").textContent = `Reg. No.: ${currentStudent.reg_no}`;
  document.getElementById("c-program").textContent = currentStudent.program;

  const presentPct = pct(s.present, s.total);
  const absentDays = s.total - s.present;
  const absentPct = pct(absentDays, s.total);

  document.getElementById("c-present-days").textContent = s.present;
  document.getElementById("c-present-pct").textContent = `${presentPct.toFixed(2)}%`;
  document.getElementById("c-total-days").textContent = s.total;
  document.getElementById("c-absent-days").textContent = absentDays;
  document.getElementById("c-absent-pct").textContent = `${absentPct.toFixed(2)}%`;

  // Illustrative trend data (day-by-day attendance isn't modeled per-day
  // in this mock, so these sparklines show a representative trend
  // shape, not literal daily figures).
  // Do not draw fake attendance trends. These spaces stay empty until a
  // real per-day analytics feed is available.
  ["c-present-spark", "c-total-spark", "c-absent-spark"].forEach((id) => { document.getElementById(id).innerHTML = ""; });

  document.getElementById("c-current-sem").textContent = semesterLabels[semNum - 1];
  document.getElementById("c-program-2").textContent = currentStudent.program;
  document.getElementById("c-academic-year").textContent = `Academic Year ${currentStudent.academic_year}`;

  const scorers = topScorersBySemester[semNum] || [];
  const me = scorers.find((s2) => s2.isMe);
  document.getElementById("c-top-rank-band").textContent = me ? `Top ${Math.ceil(me.rank / 5) * 5}` : "–";

  // Attendance alert — threshold matches the "Below 90%" flag shown
  // elsewhere on this same data.
  const alertCard = document.getElementById("c-attendance-alert");
  const alertTitle = alertCard.querySelector(".s-alert-title");
  if (presentPct < ATTENDANCE_ALERT_THRESHOLD) {
    alertCard.classList.remove("s-alert-ok");
    alertTitle.textContent = "Attendance Alert!";
    document.getElementById("c-alert-text").textContent =
      `Your attendance percentage is below ${ATTENDANCE_ALERT_THRESHOLD}%. Please attend classes regularly.`;
  } else {
    alertCard.classList.add("s-alert-ok");
    alertTitle.textContent = "Good Attendance!";
    document.getElementById("c-alert-text").textContent = "You're meeting the attendance requirement. Keep it up!";
  }
  document.getElementById("c-alert-pct").textContent = `${presentPct.toFixed(2)}%`;
  document.getElementById("c-alert-bar-fill").style.width = `${Math.min(presentPct, 100)}%`;

  document.getElementById("c-top5-title").textContent = `Top 5 Students (${semesterLabels[semNum - 1]})`;
  document.getElementById("c-top5-list").innerHTML = scorers.map((sc) => `
    <div class="s-top5-row ${sc.isMe ? "me" : ""}">
      <span class="s-top5-rank">${sc.rank}</span>
      <span class="s-top5-avatar" aria-hidden="true">${sc.name.charAt(0).toUpperCase()}</span>
      <span class="s-top5-name">${sc.name}</span>
      <span class="s-top5-pct">${sc.pct.toFixed(2)}%</span>
    </div>
  `).join("");

  document.getElementById("c-class-perf-title").textContent = `Class Performance Overview (${semesterLabels[semNum - 1]})`;
  const rows = classPerformanceBySemester[semNum] || [];
  document.getElementById("c-class-perf-body").innerHTML = rows.length
    ? rows.map((r) => {
        const mark = (value) => value == null ? "–" : Number(value).toFixed(2).replace(/\.00$/, "");
        return `
          <tr>
            <td>${r.subject}</td>
            <td>${mark(r.assignment)}</td>
            <td>${mark(r.unitTest)}</td>
            <td>${mark(r.attendance)}</td>
            <td>${mark(r.grooming)}</td>
            <td>${mark(r.midterm)}</td>
            <td>${mark(r.lab)}</td>
            <td>${mark(r.overall)}</td>
            <td>${mark(r.preboard)}</td>
            <td><strong>${r.has_entered_marks ? mark(r.total) : "–"}</strong></td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="10" style="text-align:center;color:#8894a6;">No class performance data for this semester yet.</td></tr>`;

  const subjectContainer = document.getElementById("c-subject-bar-chart");
  subjectContainer.innerHTML = '<canvas aria-label="Subject performance"></canvas>';
  const subjectCanvas = subjectContainer.querySelector("canvas");
  renderStudentChart("subject-performance", subjectCanvas, "bar", rows.map((row) => row.subject), rows.map((row) => subjectTotal(row)), ["#4f6df5", "#2fbf71", "#f0a84e", "#8a5cf6", "#f0664e"]);
}

/* ----------------------------------------------------------
   Notifications (mock)
   ---------------------------------------------------------- */
let mockNotifications = [];
function renderNotifications() {
  document.getElementById("s-bell-count").textContent = mockNotifications.length;
  document.getElementById("s-notif-menu").innerHTML = mockNotifications.map((n) => `
    <div class="s-notif-item">
      <div>${n.text}</div>
      <div class="s-notif-time">${n.time}</div>
    </div>
  `).join("");
}

/* ----------------------------------------------------------
   Change Password (same validation rules as elsewhere in SPAAMS)
   ---------------------------------------------------------- */
function openChangePasswordModal() {
  document.getElementById("cp-old-password").value = "";
  document.getElementById("cp-new-password").value = "";
  document.getElementById("cp-confirm-password").value = "";
  document.getElementById("cp-error").textContent = "";
  document.getElementById("cp-success").style.display = "none";
  document.getElementById("change-password-modal").style.display = "flex";
}
function closeChangePasswordModal() {
  document.getElementById("change-password-modal").style.display = "none";
}
async function handleChangePasswordSave() {
  const oldPassword = document.getElementById("cp-old-password").value;
  const newPassword = document.getElementById("cp-new-password").value;
  const confirmPassword = document.getElementById("cp-confirm-password").value;
  const errorBox = document.getElementById("cp-error");
  errorBox.textContent = "";

  if (newPassword.length < 8 || !/\d/.test(newPassword)) {
    errorBox.textContent = "New password must be at least 8 characters and include a number.";
    return;
  }
  if (newPassword !== confirmPassword) {
    errorBox.textContent = "New password and confirmation do not match.";
    return;
  }
  if (newPassword === oldPassword) {
    errorBox.textContent = "New password must be different from the current password.";
    return;
  }

  try {
    await apiChangePassword(oldPassword, newPassword, confirmPassword);
    document.getElementById("cp-success").style.display = "block";
    setTimeout(closeChangePasswordModal, 1200);
  } catch (err) { errorBox.textContent = err.message; }
}

/* ----------------------------------------------------------
   Wiring
   ---------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await ensureCsrfCookie();
    const data = await apiFetch("/student/me/");
    currentStudent = data.profile;
    semesterSummary = data.semester_summary || {};
    classPerformanceBySemester = data.class_performance || {};
    mockNotifications = data.notifications || [];
    const semesterNumbers = Object.keys(semesterSummary).map(Number).sort((a, b) => a - b);
    semesterLabels = semesterNumbers.map((n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} Semester`);
    semesterNumbers.forEach((n) => {
      const rows = classPerformanceBySemester[n] || [];
      const enteredRows = rows.filter((row) => row.has_entered_marks === true || row.total != null);
      avgMarksBySemester[n] = enteredRows.length
        ? enteredRows.reduce((total, row) => total + subjectTotal(row), 0) / enteredRows.length
        : null;
      topScorersBySemester[n] = [];
    });
    if (!semesterNumbers.length) throw new Error("No enrollment records are available for this account.");
  } catch (err) {
    alert(`Unable to load your dashboard: ${err.message}`);
    window.location.href = "index.html";
    return;
  }
  document.getElementById("s-today-date").innerHTML =
    `${todayDisplayString()}<br><span style="font-weight:400;color:#8894a6;">${todayWeekday()}</span>`;

  const semSelect = document.getElementById("s-semester-select");
  semSelect.innerHTML = semesterLabels.map((l, i) => `<option value="${i + 1}">${l}</option>`).join("");
  const currentSemester = Math.max(...Object.keys(semesterSummary).map(Number));
  semSelect.value = String(currentSemester);

  document.getElementById("s-profile-name").textContent = currentStudent.full_name;
  showStudentCelebration();

  renderPersonalTab();
  renderAcademicTab();
  loadClassDetails(currentSemester);
  renderNotifications();

  semSelect.addEventListener("change", (e) => loadClassDetails(Number(e.target.value)));

  // Tabs
  document.querySelectorAll(".s-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".s-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".s-tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });

  document.getElementById("btn-view-top5").addEventListener("click", () => {
    document.querySelector('.s-tab[data-tab="class"]').click();
    document.getElementById("c-top5-list").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // Sidebar
  document.querySelectorAll(".s-nav-item").forEach((btn) => {
    if (btn.id === "btn-student-logout") return;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".s-nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".s-view").forEach((v) => v.classList.remove("active"));
      document.getElementById(btn.dataset.menu === "dashboard" ? "view-dashboard" : "view-coming-soon").classList.add("active");
    });
  });
  document.getElementById("btn-student-logout").addEventListener("click", async () => {
    try { await apiLogout(); } catch (_) { /* leave the page even if session expired */ }
    window.location.href = "index.html";
  });
  document.getElementById("btn-student-home").addEventListener("click", () => {
    document.querySelectorAll(".s-nav-item").forEach((button) => button.classList.toggle("active", button.dataset.menu === "dashboard"));
    document.querySelectorAll(".s-view").forEach((view) => view.classList.remove("active"));
    document.getElementById("view-dashboard").classList.add("active");
    document.querySelector('.s-tab[data-tab="personal"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Notifications dropdown
  document.getElementById("s-bell-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("s-profile-menu").classList.remove("open");
    document.getElementById("s-notif-menu").classList.toggle("open");
  });

  // Profile dropdown
  document.getElementById("s-profile-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("s-notif-menu").classList.remove("open");
    document.getElementById("s-profile-menu").classList.toggle("open");
  });
  document.addEventListener("click", () => {
    document.getElementById("s-notif-menu").classList.remove("open");
    document.getElementById("s-profile-menu").classList.remove("open");
  });

  document.getElementById("btn-open-change-password").addEventListener("click", () => {
    document.getElementById("s-profile-menu").classList.remove("open");
    openChangePasswordModal();
  });
  document.getElementById("btn-cp-cancel").addEventListener("click", closeChangePasswordModal);
  document.getElementById("btn-cp-save").addEventListener("click", handleChangePasswordSave);
  document.getElementById("change-password-modal").addEventListener("click", (e) => {
    if (e.target.id === "change-password-modal") closeChangePasswordModal();
  });
});
