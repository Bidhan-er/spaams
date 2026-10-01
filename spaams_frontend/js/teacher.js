/* ==========================================================
   teacher.js
   Teacher Panel. Sidebar has 3 items (Semester-wise Details is
   built; the other two are placeholders for now, same pattern
   as the Admin panel's "coming soon" items).

   Semester-wise Details: a list of "Semester / Subject" rows —
   ONE row per thing this teacher actually teaches (set by Admin
   in Customize Admin) — click one to enter marks for just that
   subject. Board Mark is intentionally not shown here; that
   field is Admin-only per the project spec.

   NOTE ON MOCK DATA: self-contained the same way admin.js is.
   Not yet connected to the Admin panel's data — see the
   "BACKEND CALL GOES HERE" comments for what that requires.
   ========================================================== */

const semesterNames = [
  "I Semester", "II Semester", "III Semester", "IV Semester",
  "V Semester", "VI Semester", "VII Semester", "VIII Semester",
];

// All roster, assignment and mark data comes from Django's ORM API.
const currentTeacher = { full_name: "", assignments: [] };
let mockStudents = [];

// Default columns every assignment starts with — but each
// assignment gets its OWN independent, mutable copy (see
// getColumnsForAssignment below), so adding "Unit Test" to
// I Semester/CFA doesn't affect V Semester/Dot Net.
let baseMarkFields = [];

const columnsByAssignment = {};
function getColumnsForAssignment(assignmentIndex) {
  if (!columnsByAssignment[assignmentIndex]) {
    columnsByAssignment[assignmentIndex] = baseMarkFields.map((f) => ({ ...f }));
  }
  return columnsByAssignment[assignmentIndex];
}
function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `col_${Date.now()}`;
}

// Local in-memory store, keyed by subject NAME (not index — there's
// no need to align with the Admin grid's numbering here, since each
// assignment already names its own subject directly).
const marksStore = {};
function marksKey(studentId, semesterIndex, subject) {
  return `${studentId}_${semesterIndex}_${subject}`;
}
function getStoredMarks(studentId, semesterIndex, subject) {
  const key = marksKey(studentId, semesterIndex, subject);
  if (!marksStore[key]) marksStore[key] = {};
  return marksStore[key];
}
function commitMarks(studentId, semesterIndex, subject, updates) {
  const key = marksKey(studentId, semesterIndex, subject);
  marksStore[key] = { ...getStoredMarks(studentId, semesterIndex, subject), ...updates };
}
// Reads a field that might not exist yet on an older seeded row —
// this is what lets a brand-new custom column (e.g. "Unit Test")
// start cleanly at 0 for every student without having to rewrite
// every already-seeded row.
function readField(row, key) {
  return row[key] !== undefined ? row[key] : "";
}

function calcTotalAverage(row, columns) {
  const vals = columns.map((f) => readField(row, f.key)).filter((value) => value !== "" && value !== null && value !== undefined).map(Number);
  if (!vals.length) return "–";
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

function highlightMatch(text, query) {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return `${text.slice(0, index)}<mark class="match-highlight">${text.slice(index, index + query.length)}</mark>${text.slice(index + query.length)}`;
}

function filterStudents(students, query) {
  const q = query.trim().toLowerCase();
  if (!q) return students;
  const matches = students.filter(
    (s) => s.full_name.toLowerCase().includes(q) || s.registration_number.toLowerCase().includes(q)
  );
  matches.sort((a, b) => {
    const aStarts = a.full_name.toLowerCase().startsWith(q) ? 0 : 1;
    const bStarts = b.full_name.toLowerCase().startsWith(q) ? 0 : 1;
    return aStarts - bStarts;
  });
  return matches;
}

/* ----------------------------------------------------------
   Navigation (same goToView/history pattern as admin.js, kept
   local to this file since it's a separate page/script)
   ---------------------------------------------------------- */
function goToView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");
}

let currentAssignment = null; // { semester, subject }
const semesterSelectHistory = []; // for Home = undo one selection

/* ----------------------------------------------------------
   Rendering
   ---------------------------------------------------------- */
function populateSemesterSelect() {
  const select = document.getElementById("teacher-semester-select");
  select.innerHTML = currentTeacher.assignments
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]} / ${a.subject} — ${a.academic_year} batch (${a.student_count ?? 0} students)</option>`)
    .join("");
}

function showTeacherEmptyState(message) {
  const empty = document.getElementById("teacher-empty-state");
  empty.textContent = message;
  empty.style.display = "block";
  document.getElementById("teacher-marks-head").innerHTML = "";
  document.getElementById("teacher-marks-body").innerHTML = "";
  document.getElementById("teacher-marks-foot").innerHTML = "";
}

function hideTeacherEmptyState() {
  document.getElementById("teacher-empty-state").style.display = "none";
}

async function openMarksView(assignmentIndex, { recordHistory = true } = {}) {
  if (recordHistory && currentAssignment) {
    const currentIndex = currentTeacher.assignments.indexOf(currentAssignment);
    if (currentIndex !== assignmentIndex) semesterSelectHistory.push(currentIndex);
  }

  const assignment = currentTeacher.assignments[assignmentIndex];
  if (!assignment) {
    showTeacherEmptyState("No student records are available because this teacher has not been assigned to a subject, semester, and batch yet. Ask the administrator to add an assignment.");
    return;
  }
  hideTeacherEmptyState();
  currentAssignment = assignment;
  currentAssignmentIndex = assignmentIndex;
  document.getElementById("teacher-semester-select").value = String(assignmentIndex);
  document.getElementById("teacher-marks-title").textContent =
    `${semesterNames[assignment.semester - 1]} / ${assignment.subject} subject`;
  document.getElementById("teacher-marks-search").value = "";
  document.getElementById("teacher-search-count").textContent = "";

  try {
    const data = await apiFetch(`/teacher/marks/?subject_id=${assignment.subject_id}&academic_year=${assignment.academic_year}`);
    mockStudents = data.students;
    baseMarkFields = data.assessment_types.map((item) => ({ key: String(item.id), label: item.assessment_name, assessmentId: item.id, maximum: Number(item.maximum_marks), passMarks: Number(item.pass_marks || 0), category: item.category || "Other" }));
    columnsByAssignment[assignmentIndex] = baseMarkFields.map((item) => ({ ...item }));
    mockStudents.forEach((student) => {
      const values = {};
      Object.entries(student.marks || {}).forEach(([key, mark]) => { values[key] = mark && typeof mark === "object" ? mark.obtained : mark; });
      marksStore[marksKey(student.id, assignment.semester, assignment.subject)] = values;
    });
    buildMarksHead();
    buildMarksBody(mockStudents, "");
    if (!mockStudents.length) showTeacherEmptyState(`No active students are enrolled in ${semesterNames[assignment.semester - 1]}, ${assignment.academic_year} batch for ${assignment.subject}. Ask the admin to assign the matching batch.`);
  } catch (err) {
    showTeacherEmptyState(`Could not load this assigned class: ${err.message}`);
    document.getElementById("teacher-save-confirmation").textContent = err.message;
  }
}

function buildMarksHead() {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const thead = document.getElementById("teacher-marks-head");
  const foot = document.getElementById("teacher-marks-foot");

  const headRow = document.createElement("tr");
  headRow.innerHTML = `<th>IDs</th><th>Name</th>`;
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.innerHTML = `${col.label} <button class="col-remove-btn" data-col-key="${col.key}" title="Remove this column">×</button>`;
    headRow.appendChild(th);
  });
  headRow.innerHTML += `<th>Total ave.</th>`;
  thead.innerHTML = "";
  thead.appendChild(headRow);

  const footRow = document.createElement("tr");
  footRow.innerHTML = `<td class="student-id-cell">Total</td><td class="student-name-cell"></td>`;
  columns.forEach((col) => {
    footRow.innerHTML += `<td class="total-avg-cell" id="total-${col.key}">–</td>`;
  });
  footRow.innerHTML += `<td class="total-avg-cell" id="total-average">–</td>`;
  foot.innerHTML = "";
  foot.appendChild(footRow);

  // wire the × buttons just added
  thead.querySelectorAll(".col-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeColumn(btn.dataset.colKey));
  });
}

function buildMarksBody(students, query) {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const tbody = document.getElementById("teacher-marks-body");
  tbody.innerHTML = "";

  students.forEach((student) => {
    const row = getStoredMarks(student.id, currentAssignment.semester, currentAssignment.subject);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="student-id-cell">${student.registration_number}</td><td class="student-name-cell">${highlightMatch(student.full_name, query)}</td>`;

    columns.forEach((f) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.className = "mark-input";
      input.value = readField(row, f.key);
      input.min = 0;
      input.max = f.maximum || 100;
      input.dataset.studentId = student.id;
      input.dataset.field = f.key;
      input.addEventListener("input", () => {
        updateTotalCell(tr, student.id);
        updateFooterTotals();
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    const totalTd = document.createElement("td");
    totalTd.className = "total-avg-cell";
    totalTd.dataset.totalFor = student.id;
    totalTd.textContent = calcTotalAverage(row, columns);
    tr.appendChild(totalTd);

    tbody.appendChild(tr);
  });

  updateFooterTotals();
}

function updateTotalCell(tr, studentId) {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const getVal = (field) => tr.querySelector(`input[data-student-id="${studentId}"][data-field="${field}"]`).value;
  const row = {};
  columns.forEach((f) => { row[f.key] = getVal(f.key); });
  tr.querySelector(`[data-total-for="${studentId}"]`).textContent = calcTotalAverage(row, columns);
}

function updateFooterTotals() {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const rows = document.querySelectorAll("#teacher-marks-body tr");
  if (rows.length === 0) {
    columns.forEach((f) => {
      const cell = document.getElementById(`total-${f.key}`);
      if (cell) cell.textContent = "–";
    });
    document.getElementById("total-average").textContent = "–";
    return;
  }

  columns.forEach((f) => {
    const inputs = document.querySelectorAll(`#teacher-marks-body input[data-field="${f.key}"]`);
    const entered = [...inputs].filter((input) => input.value !== "");
    const cell = document.getElementById(`total-${f.key}`);
    if (cell) cell.textContent = entered.length ? (entered.reduce((acc, input) => acc + Number(input.value), 0) / entered.length).toFixed(1) : "–";
  });

  const totalCells = [...document.querySelectorAll("#teacher-marks-body .total-avg-cell")]
    .map((cell) => cell.textContent).filter((value) => value !== "–").map(Number);
  document.getElementById("total-average").textContent = totalCells.length
    ? (totalCells.reduce((acc, value) => acc + value, 0) / totalCells.length).toFixed(1)
    : "–";
}

function collectAllMarks() {
  const inputs = document.querySelectorAll("#teacher-marks-body input.mark-input");
  const payload = [];
  inputs.forEach((input) => {
    payload.push({ studentId: input.dataset.studentId, field: input.dataset.field, value: input.value === "" ? null : Number(input.value) });
  });
  return payload;
}

/* ----------------------------------------------------------
   Add / remove columns — Semester-wise Details page only, and
   scoped to whichever semester/subject is currently open, so a
   "Unit Test" column added for one class doesn't leak into others.
   ---------------------------------------------------------- */
async function addColumn(rawName) {
  const name = rawName.trim();
  if (!name) return;
  if (!currentAssignment) return;
  const category = document.getElementById("new-column-category").value;
  try {
    const request = { subject_id: currentAssignment.subject_id, academic_year: currentAssignment.academic_year, assessment_name: name, category };
    try { await apiFetch("/teacher/assessment-columns/", { method: "POST", body: request }); }
    catch (err) {
      if (err.status !== 409 || !err.data?.requires_confirmation || !confirm(`${err.message}\n\nContinue with the automatic reallocation?`)) throw err;
      await apiFetch("/teacher/assessment-columns/", { method: "POST", body: { ...request, confirm_reallocation: true } });
    }
    /* server owns all full-mark allocation; never send a teacher-supplied maximum */
    /* eslint-disable no-unreachable */
    /* legacy payload removed */
    /*
    await apiFetch("/teacher/assessment-columns/", { method: "POST", body: {
      subject_id: currentAssignment.subject_id,
      academic_year: currentAssignment.academic_year,
      assessment_name: name,
      maximum_marks: maximum,
      pass_marks: passMarks,
      category,
    }}); */
    document.getElementById("new-column-name").value = "";
    await openMarksView(currentAssignmentIndex, { recordHistory: false });
  } catch (err) {
    document.getElementById("teacher-save-confirmation").textContent = err.message;
    document.getElementById("teacher-save-confirmation").classList.add("show");
  }
}

async function removeColumn(key) {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const col = columns.find((c) => c.key === key);
  if (!col || !currentAssignment) return;
  if (!confirm(`Delete the "${col.label}" column? Any saved marks in this column for this batch will also be deleted.`)) {
    return;
  }
  try {
    const request = { subject_id: currentAssignment.subject_id, academic_year: currentAssignment.academic_year };
    try { await apiFetch(`/teacher/assessment-columns/${col.assessmentId}/`, { method: "DELETE", body: request }); }
    catch (err) {
      if (err.status !== 409 || !err.data?.requires_confirmation || !confirm(err.message)) throw err;
      await apiFetch(`/teacher/assessment-columns/${col.assessmentId}/`, { method: "DELETE", body: { ...request, confirm_delete: true } });
    }
    await openMarksView(currentAssignmentIndex, { recordHistory: false });
  } catch (err) {
    document.getElementById("teacher-save-confirmation").textContent = err.message;
    document.getElementById("teacher-save-confirmation").classList.add("show");
  }
}

/* ----------------------------------------------------------
   Wiring
   ---------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await ensureCsrfCookie();
    const teacher = await apiFetch("/teacher/me/");
    currentTeacher.full_name = teacher.full_name;
    currentTeacher.gender = teacher.gender || "Other";
    currentTeacher.assignments = teacher.assignments.map((a) => ({ ...a, semester: a.semester_number, subject: a.subject_name }));
  } catch (err) {
    alert(`Unable to load your teacher data: ${err.message}`);
    window.location.href = "index.html";
    return;
  }
  document.getElementById("teacher-profile-name").textContent = currentTeacher.full_name || "Teacher";
  document.getElementById("teacher-profile-avatar").textContent = (currentTeacher.full_name || "Teacher")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  populateSemesterSelect();
  if (currentTeacher.assignments.length > 0) {
    openMarksView(0, { recordHistory: false });
  } else {
    showTeacherEmptyState("No student data is shown because you do not yet have an active assignment. The admin must assign you a subject, semester, and batch.");
  }

  // Sidebar menu
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".menu-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.menu === "semester-details") {
        goToView("view-teacher-list");
      } else if (btn.dataset.menu === "semester-dashboard") {
        goToView("view-teacher-dashboard");
        initDashboardView();
      } else if (btn.dataset.menu === "attendance-monitoring") {
        goToView("view-teacher-attendance");
        initAttendanceView();
      } else {
        goToView("view-coming-soon");
      }
    });
  });

  // Semester/subject select — this IS the navigation now (no more
  // separate list-then-marks pages, per the latest mockup).
  document.getElementById("teacher-semester-select").addEventListener("change", (e) => {
    openMarksView(Number(e.target.value));
  });

  document.getElementById("teacher-marks-search").addEventListener("input", (e) => {
    const query = e.target.value;
    const filtered = filterStudents(mockStudents, query);
    buildMarksBody(filtered, query);
    document.getElementById("teacher-search-count").textContent = query ? `${filtered.length} result(s)` : "";
  });
  document.getElementById("teacher-status-filter").addEventListener("change", () => {
    buildMarksBody(filterStudents(mockStudents, document.getElementById("teacher-marks-search").value), document.getElementById("teacher-marks-search").value);
  });

  // Subject columns are saved in MySQL and are scoped to this teacher's assignment.
  document.getElementById("btn-add-column").addEventListener("click", () => {
    const input = document.getElementById("new-column-name");
    addColumn(input.value);
  });
  document.getElementById("new-column-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addColumn(e.target.value);
    }
  });

  // Home always returns to the first Teacher interface.
  document.getElementById("btn-teacher-home").addEventListener("click", () => {
    document.querySelectorAll(".menu-item").forEach((b) => b.classList.remove("active"));
    document.querySelector('.menu-item[data-menu="semester-details"]').classList.add("active");
    goToView("view-teacher-list");
  });

  document.getElementById("btn-save-teacher-marks").addEventListener("click", async () => {
    const invalid = [...document.querySelectorAll("#teacher-marks-body input.invalid-mark")];
    if (invalid.length) {
      showColumnError("Correct the red marks before saving. Each value must be between 0 and its column's full marks.");
      invalid[0].focus();
      return;
    }
    const payload = collectAllMarks();
    payload.forEach((cell) => {
      commitMarks(cell.studentId, currentAssignment.semester, currentAssignment.subject, { [cell.field]: cell.value });
    });

    const label = document.getElementById("teacher-save-confirmation");
    try {
      if (!payload.length) {
        label.textContent = "No marks entered yet.";
        label.classList.add("show");
        return;
      }
      const result = await apiFetch("/teacher/marks/", { method: "POST", body: {
        subject_id: currentAssignment.subject_id, academic_year: currentAssignment.academic_year,
        marks: payload.map((cell) => ({ student_id: cell.studentId, assessment_id: Number(cell.field), marks_obtained: cell.value }))
      }});
      mockStudents.forEach((student) => { if (result.performance?.[student.id]) student.performance = result.performance[student.id]; });
      document.getElementById("teacher-performance-note").textContent = "Marks saved. Open Semester-wise Dashboard to view updated performance and charts.";
      buildMarksBody(filterStudents(mockStudents, document.getElementById("teacher-marks-search").value), document.getElementById("teacher-marks-search").value);
      label.textContent = "Saved and performance updated ✓";
      label.classList.add("show");
      setTimeout(() => label.classList.remove("show"), 2000);
    } catch (err) { label.textContent = err.message; label.classList.add("show"); }
  });
});

/* ==========================================================
   SEMESTER-WISE DASHBOARD
   Class-wide summary (not per-student marks entry) for whichever
   of the teacher's own semester/subject assignments is selected.
   Two SVG charts: a donut (attendance) and a shaded "3D"-style
   pie (category breakdown), both with hover tooltips.
   ========================================================== */

const CHART_COLORS = {
  attendance: "#4f8fff",
  assignment: "#4ed08a",
  lab: "#f0a84e",
  overall: "#b076f0",
  midterm: "#f0664e",
  preboard: "#2fb8c4",
  present: "#4ed08a",
  absent: "#f0664e",
};
const teacherDashboardCharts = {};

function renderTeacherDashboardChart(containerId, type, labels, values, colors) {
  const container = document.getElementById(containerId);
  if (typeof Chart === "undefined") {
    container.textContent = "Chart library could not load. Check your internet connection and refresh.";
    return;
  }
  teacherDashboardCharts[containerId]?.destroy();
  container.replaceChildren();
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  teacherDashboardCharts[containerId] = new Chart(canvas, {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, borderRadius: type === "bar" ? 6 : 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === "doughnut", position: "bottom" }, tooltip: { callbacks: { label: (context) => { const value = type === "bar" ? context.parsed.y : context.parsed; return `${context.label}: ${Number(value || 0).toFixed(1)}%`; } } } }, scales: type === "bar" ? { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } } } : {} },
  });
}

// One shared floating tooltip element, reused by both charts.
let chartTooltipEl = null;
function getChartTooltip() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "chart-tooltip";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}
function showChartTooltip(evt, text) {
  const tip = getChartTooltip();
  tip.textContent = text;
  tip.style.left = `${evt.clientX + 14}px`;
  tip.style.top = `${evt.clientY + 14}px`;
  tip.classList.add("show");
}
function moveChartTooltip(evt) {
  const tip = getChartTooltip();
  tip.style.left = `${evt.clientX + 14}px`;
  tip.style.top = `${evt.clientY + 14}px`;
}
function hideChartTooltip() {
  if (chartTooltipEl) chartTooltipEl.classList.remove("show");
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}
function describeWedge(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

// Donut ring (used for Present/Absent attendance) — hollow center,
// rounded, glossy via a radial-gradient overlay, matching the
// reference image's rounded two-tone donut look.
function renderDonutChart(containerId, segments) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const size = 170, r = 62, cx = size / 2, cy = size / 2, strokeWidth = 30;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;

  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size });

  const defs = svgEl("defs", {});
  segments.forEach((seg, i) => {
    const grad = svgEl("radialGradient", { id: `donutGrad-${i}` });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.35" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": seg.color, "stop-opacity": "0" }));
    defs.appendChild(grad);
  });
  svg.appendChild(defs);

  let cumulative = 0;
  segments.forEach((seg, i) => {
    const pct = (seg.value / total) * 100;
    const dash = (pct / 100) * circumference;
    const offset = -((cumulative / total) * circumference);

    const circle = svgEl("circle", {
      cx, cy, r,
      fill: "none",
      stroke: seg.color,
      "stroke-width": strokeWidth,
      "stroke-dasharray": `${dash} ${circumference}`,
      "stroke-dashoffset": offset,
      class: "chart-ring-segment",
    });
    // rotate so the ring starts at 12 o'clock like a normal pie
    circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);

    circle.addEventListener("mouseenter", (e) => showChartTooltip(e, `${seg.label}: ${pct.toFixed(0)}%`));
    circle.addEventListener("mousemove", moveChartTooltip);
    circle.addEventListener("mouseleave", hideChartTooltip);

    svg.appendChild(circle);
    cumulative += seg.value;
  });

  container.appendChild(svg);
}

// "3D"-style pie: real SVG wedges (proper geometry) with a
// radial-gradient sheen + drop-shadow per slice to fake the glossy
// raised look from the reference image. (Honest note: this is a
// stylized flat rendering, not literal 3D geometry — a true
// rotated-ellipse 3D pie needs canvas/WebGL, which conflicts with
// staying framework-free.)
function renderPieChart(containerId, segments) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const size = 220, r = 90, cx = size / 2, cy = size / 2;
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;

  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size });

  const defs = svgEl("defs", {});
  const filter = svgEl("filter", { id: "pieShadow", x: "-20%", y: "-20%", width: "140%", height: "140%" });
  filter.appendChild(svgEl("feDropShadow", { dx: "0", dy: "3", stdDeviation: "3", "flood-opacity": "0.35" }));
  defs.appendChild(filter);
  segments.forEach((seg, i) => {
    const grad = svgEl("radialGradient", { id: `pieGrad-${i}`, cx: "35%", cy: "35%", r: "75%" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.45" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#ffffff", "stop-opacity": "0" }));
    defs.appendChild(grad);
  });
  svg.appendChild(defs);

  const group = svgEl("g", { filter: "url(#pieShadow)" });

  let cumulative = 0;
  segments.forEach((seg, i) => {
    const pct = (seg.value / total) * 100;
    const startAngle = (cumulative / total) * 360;
    cumulative += seg.value;
    const endAngle = (cumulative / total) * 360;

    const wedge = svgEl("path", {
      d: describeWedge(cx, cy, r, startAngle, endAngle),
      fill: seg.color,
      class: "chart-wedge",
      stroke: "#fff",
      "stroke-width": "1.5",
    });
    wedge.addEventListener("mouseenter", (e) => showChartTooltip(e, `${seg.label}: ${pct.toFixed(0)}%`));
    wedge.addEventListener("mousemove", moveChartTooltip);
    wedge.addEventListener("mouseleave", hideChartTooltip);
    group.appendChild(wedge);

    // glossy overlay on top of the same wedge
    const overlay = svgEl("path", {
      d: describeWedge(cx, cy, r, startAngle, endAngle),
      fill: `url(#pieGrad-${i})`,
      style: "pointer-events:none;",
    });
    group.appendChild(overlay);

    // percentage label, only if the slice is big enough to fit text
    if (pct >= 6) {
      const midAngle = (startAngle + endAngle) / 2;
      const labelPos = polarToCartesian(cx, cy, r * 0.62, midAngle);
      const text = svgEl("text", {
        x: labelPos.x, y: labelPos.y,
        "text-anchor": "middle", "dominant-baseline": "middle",
        fill: "#fff", "font-size": "11", "font-weight": "700",
        style: "pointer-events:none;",
      });
      text.textContent = `${pct.toFixed(0)}%`;
      group.appendChild(text);
    }
  });

  svg.appendChild(group);
  container.appendChild(svg);
}

// ---------- Class-wide aggregation ----------
function computeClassAggregates(semesterIndex, subject, students) {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  const percentageFor = (row, category) => {
    const entered = columns.filter((column) => column.category === category && row[column.key] !== "" && row[column.key] != null);
    if (!entered.length) return null;
    const earned = entered.reduce((sum, column) => sum + Number(row[column.key]), 0);
    const full = entered.reduce((sum, column) => sum + Number(column.maximum), 0);
    return full ? earned * 100 / full : null;
  };
  const rows = students.map((student) => getStoredMarks(student.id, semesterIndex, subject));
  const average = (category) => {
    const values = rows.map((row) => percentageFor(row, category)).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return { attendance: null, assignment: average("Assignments"), lab: average("Lab Reports"), overall: average("Overall Activities"), midterm: average("Midterm"), preboard: average("Preboards"), unitTest: average("Unit Test") };
}

function renderDashboardTable(students, semesterIndex, subject, assignmentIndex) {
  const tbody = document.getElementById("dash-summary-body");
  tbody.innerHTML = "";
  const columns = getColumnsForAssignment(assignmentIndex);

  students.forEach((student) => {
    const row = getStoredMarks(student.id, semesterIndex, subject);
    const total = calcWeightedPercentage(row, columns);
    const category = (name) => {
      const related = columns.filter((column) => column.category === name && row[column.key] !== "" && row[column.key] != null);
      if (!related.length) return "–";
      const earned = related.reduce((sum, column) => sum + Number(row[column.key]), 0);
      const maximum = related.reduce((sum, column) => sum + Number(column.maximum), 0);
      return maximum ? `${(earned * 100 / maximum).toFixed(1)}%` : "–";
    };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${student.registration_number}</td>
      <td class="student-name-cell">${student.full_name}</td>
      <td>–</td>
      <td>${category("Assignments")}</td>
      <td>${category("Lab Reports")}</td>
      <td>${category("Overall Activities")}</td>
      <td>${total}</td>
    `;
    tbody.appendChild(tr);
  });

  const agg = computeClassAggregates(semesterIndex, subject, students);
  const display = (value) => value == null ? "–" : `${value.toFixed(1)}%`;
  document.getElementById("dash-total-attendance").textContent = "–";
  document.getElementById("dash-total-assignment").textContent = display(agg.assignment);
  document.getElementById("dash-total-lab").textContent = display(agg.lab);
  document.getElementById("dash-total-overall").textContent = display(agg.overall);
  const entered = [agg.unitTest, agg.assignment, agg.lab, agg.overall, agg.midterm, agg.preboard].filter((value) => value != null);
  document.getElementById("dash-total-average").textContent = entered.length ? `${(entered.reduce((sum, value) => sum + value, 0) / entered.length).toFixed(1)}%` : "–";

  return agg;
}

function populateDashboardSemesterSelect() {
  const select = document.getElementById("dash-semester-select");
  select.innerHTML = currentTeacher.assignments
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]}/${a.subject} — ${a.academic_year} batch (${a.student_count ?? 0} students)</option>`)
    .join("");
}

let dashboardInitialized = false;

async function loadDashboard(assignmentIndex) {
  const assignment = currentTeacher.assignments[assignmentIndex];
  if (!assignment) return;
  document.getElementById("dash-semester-select").value = String(assignmentIndex);
  document.getElementById("dash-title").textContent = `${semesterNames[assignment.semester - 1]} — ${assignment.academic_year} batch`;
  try {
    const data = await apiFetch(`/analytics/semester-summary/?semester_id=${assignment.semester_id}&academic_year=${assignment.academic_year}`);
    renderTeacherSemesterDashboard(data);
  } catch (err) {
    document.getElementById("dash-title").textContent = `Could not load ${assignment.subject}: ${err.message}`;
    document.getElementById("dash-summary-body").innerHTML = `<tr><td>${err.message}</td></tr>`;
  }
}

function renderTeacherSemesterDashboard(data) {
  const subjects = data.subjects || [], categories = data.categories || [];
  const table = document.getElementById("dash-summary-table");
  table.querySelector("thead").innerHTML = `<tr><th rowspan="2">ID</th><th rowspan="2">Full Name</th>${subjects.map((subject) => `<th class="subject-divider" colspan="${categories.length + 1}">${subject.name}</th>`).join("")}<th rowspan="2">Overall Performance<small>/100</small></th></tr><tr>${subjects.flatMap(() => [...categories.map((category, index) => `<th class="${index === 0 ? "subject-divider" : ""}">${category.name}<small>/${category.input_full_marks || category.full_marks}</small></th>`), "<th>Subject Total<small>/100</small></th>"]).join("")}</tr>`;
  document.getElementById("dash-summary-body").innerHTML = data.students.length ? data.students.map((student) => {
    const cells = subjects.flatMap((subject) => {
      const categoryCells = categories.map((category, index) => {
        const value = student.subjects?.[subject.id]?.categories?.[category.name]?.display_obtained;
        return `<td class="${index === 0 ? "subject-divider" : ""}">${value == null ? "–" : `${value} /${category.input_full_marks || category.full_marks}`}</td>`;
      });
      const total = student.subjects?.[subject.id]?.performance_percent;
      return [...categoryCells, `<td class="subject-total-cell">${total == null ? "–" : `${total}%`}</td>`];
    }).join("");
    return `<tr><td>${student.registration_number}</td><td>${student.full_name}</td>${cells}<td class="overall-performance-cell">${student.overall_performance == null ? "–" : `${student.overall_performance}%`}</td></tr>`;
  }).join("") : '<tr><td colspan="3">No students are enrolled in this assigned class.</td></tr>';

  const attendanceBox = document.getElementById("dash-donut-box");
  if (data.summary.average_attendance == null) {
    teacherDashboardCharts["dash-donut-box"]?.destroy(); delete teacherDashboardCharts["dash-donut-box"];
    attendanceBox.textContent = "No attendance recorded yet";
    attendanceBox.classList.add("attendance-chart-empty");
  } else {
    attendanceBox.classList.remove("attendance-chart-empty");
    renderTeacherDashboardChart("dash-donut-box", "doughnut", ["Present", "Absent"], [data.summary.average_attendance, 100 - data.summary.average_attendance], [CHART_COLORS.present, CHART_COLORS.absent]);
  }
  const chartArea = document.getElementById("teacher-subject-performance-charts");
  Object.keys(teacherDashboardCharts).filter((key) => key.startsWith("teacher-subject-")).forEach((key) => { teacherDashboardCharts[key]?.destroy(); delete teacherDashboardCharts[key]; });
  chartArea.replaceChildren();
  subjects.forEach((subject) => {
    const chartId = `teacher-subject-${subject.id}`;
    const card = document.createElement("section"); card.className = "subject-performance-chart";
    card.innerHTML = `<h4>${subject.name} — Performance Breakdown</h4><p>Percentage by category</p><div class="subject-performance-canvas" id="${chartId}"></div>`;
    chartArea.appendChild(card);
    const values = categories.map((category) => {
      const marks = data.students.map((student) => student.subjects?.[subject.id]?.categories?.[category.name]?.obtained).filter((value) => value != null);
      return marks.length ? marks.reduce((sum, value) => sum + value, 0) / marks.length / category.full_marks * 100 : 0;
    });
    renderTeacherDashboardChart(chartId, "bar", categories.map((category) => category.name), values, ["#2f80ed", "#43bd66", "#ff922b", "#8b52d1", "#ef4444", "#22b3c5", "#f5c518", "#e84393"]);
  });
  document.getElementById("dash-legend").innerHTML = `<li><span class="swatch" style="background:${CHART_COLORS.present}"></span> Class attendance: ${data.summary.average_attendance == null ? "No attendance yet" : `${data.summary.average_attendance}%`}</li><li><span class="swatch" style="background:#2f80ed"></span> Assigned subject category performance</li>`;
  const scored = data.students.filter((student) => student.overall_performance != null);
  const band = (name, className, rows) => `<section class="performer-band ${className}"><strong>${name}</strong><span>${rows.length ? rows.map((student) => `${student.full_name} (${student.overall_performance}%)`).join(", ") : "None"}</span></section>`;
  document.getElementById("teacher-performer-summary").innerHTML = [
    band("Top performers — above 90%", "top", scored.filter((student) => student.overall_performance > 90)),
    band("Good performers — above 80%", "good", scored.filter((student) => student.overall_performance > 80 && student.overall_performance <= 90)),
    band("Average performers — above 60%", "average", scored.filter((student) => student.overall_performance > 60 && student.overall_performance <= 80)),
    band("Low performers — 60% or below", "low", scored.filter((student) => student.overall_performance <= 60)),
  ].join("");
}

function initDashboardView() {
  if (!dashboardInitialized) {
    populateDashboardSemesterSelect();
    dashboardInitialized = true;
  }
  loadDashboard(0);
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dash-semester-select").addEventListener("change", (e) => {
    loadDashboard(Number(e.target.value));
  });
  document.getElementById("btn-dashboard-edit-marks").addEventListener("click", () => {
    const assignmentIndex = Number(document.getElementById("dash-semester-select").value);
    document.querySelectorAll(".menu-item").forEach((button) => button.classList.toggle("active", button.dataset.menu === "semester-details"));
    goToView("view-teacher-list");
    openMarksView(assignmentIndex, { recordHistory: false });
  });
});

/* ==========================================================
   ATTENDANCE MONITORING
   Mark present/absent -> Submit -> Absent students + guardian
   contacts -> write a message -> Send -> success screen.
   Locked once submitted for a subject, until the next calendar day.
   ========================================================== */

function todayDateString() {
  // YYYY-MM-DD, used as the lock key so "today" is unambiguous
  // regardless of how the date is displayed.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayDisplayString() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ----- BACKEND CALL GOES HERE -----
// Real version: GET/POST /api/teacher/attendance/ — this whole
// object is what the ATTENDANCE_SESSION + ATTENDANCE tables from
// your schema hold. Keyed here by assignmentIndex + date so a
// teacher can only submit once per subject per day; the real
// backend must re-check this server-side too, not just trust the
// UI being disabled — the same principle as the marks endpoints.
const attendanceLog = {};
function attendanceKey(assignmentIndex, dateStr) {
  return `${assignmentIndex}_${dateStr}`;
}
function isLockedToday(assignmentIndex) {
  return Boolean(attendanceLog[attendanceKey(assignmentIndex, todayDateString())]);
}

let currentAttendanceAssignmentIndex = null;
let pendingPresentMap = {}; // studentId -> boolean, before Submit is clicked
const attStepHistory = [];

function showAttStep(stepId, { recordHistory = true } = {}) {
  const steps = ["att-step-mark", "att-step-absent", "att-step-success"];
  const current = steps.find((id) => document.getElementById(id).style.display !== "none");
  if (recordHistory && current && current !== stepId) attStepHistory.push(current);
  steps.forEach((id) => {
    document.getElementById(id).style.display = id === stepId ? "block" : "none";
  });
}

function populateAttendanceSemesterSelect() {
  const select = document.getElementById("att-semester-select");
  select.innerHTML = currentTeacher.assignments
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]}/${a.subject} — ${a.academic_year} batch (${a.student_count ?? 0} students)</option>`)
    .join("");
}

function renderAttendanceMarkTable() {
  const tbody = document.getElementById("att-mark-body");
  tbody.innerHTML = "";

  mockStudents.forEach((s) => {
    const isPresent = pendingPresentMap[s.id];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${s.registration_number}</td>
      <td class="student-name-cell">${s.full_name}</td>
      <td style="text-align:center;">
        <input type="checkbox" class="att-present-checkbox" data-student-id="${s.id}" ${isPresent ? "checked" : ""} />
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".att-present-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      pendingPresentMap[cb.dataset.studentId] = cb.checked;
      updateAttendanceSummary();
      syncSelectAllCheckbox();
    });
  });

  updateAttendanceSummary();
  syncSelectAllCheckbox();
}

function updateAttendanceSummary() {
  const total = mockStudents.length;
  const presentCount = Object.values(pendingPresentMap).filter(Boolean).length;
  document.getElementById("att-total-students").textContent = total;
  document.getElementById("att-total-present").textContent = presentCount;
  document.getElementById("att-total-absent").textContent = total - presentCount;
}

function syncSelectAllCheckbox() {
  const allPresent = mockStudents.length > 0 && mockStudents.every((s) => pendingPresentMap[s.id]);
  document.getElementById("att-select-all").checked = allPresent;
}

let attendanceSessionId = null;
let absentStudents = [];
async function loadAttendanceForAssignment(assignmentIndex, { recordHistory = false } = {}) {
  currentAttendanceAssignmentIndex = assignmentIndex;
  attStepHistory.length = 0; // switching subject starts a fresh flow

  const assignment = currentTeacher.assignments[assignmentIndex];
  document.getElementById("att-semester-select").value = String(assignmentIndex);
  document.getElementById("att-mark-title").textContent =
    `Attendance details — ${semesterNames[assignment.semester - 1]}/${assignment.subject}`;

  try {
    const data = await apiFetch(`/teacher/attendance/?subject_id=${assignment.subject_id}&academic_year=${assignment.academic_year}`);
    mockStudents = data.records.map((r) => ({ id: r.student_id, ...r }));
    attendanceSessionId = data.session_id;
    // A new attendance sheet starts with no selection, preventing an
    // accidental "everybody present" submission.
    pendingPresentMap = {};
    mockStudents.forEach((s) => { pendingPresentMap[s.id] = s.status === "Present"; });
    absentStudents = mockStudents.filter((student) => student.status === "Absent");
    const rosterMessage = document.getElementById("att-locked-message");
    const alreadySentMessage = document.getElementById("att-already-sent-message");
    rosterMessage.style.display = "none";
    if (!mockStudents.length) {
      rosterMessage.textContent = `No active students are enrolled in ${semesterNames[assignment.semester - 1]}, ${assignment.academic_year} batch for ${assignment.subject}. Ask the administrator to assign the teacher to the matching batch.`;
      rosterMessage.style.display = "block";
    }
    if (data.locked) {
      renderAttendanceSuccessRecap(pendingPresentMap, assignment);
      document.getElementById("att-success-heading").textContent = "Attendance already submitted";
      document.getElementById("att-success-message").style.display = "none";
      alreadySentMessage.textContent = "Attendance has already been sent for today. The saved Present/Absent statuses are shown below and cannot be changed.";
      alreadySentMessage.style.display = "block";
      showAttStep("att-step-success", { recordHistory: false });
    } else {
      alreadySentMessage.style.display = "none";
      document.getElementById("att-success-message").style.display = "block";
      renderAttendanceMarkTable();
      showAttStep("att-step-mark", { recordHistory: false });
    }
  } catch (err) { document.getElementById("att-locked-message").textContent = err.message; document.getElementById("att-locked-message").style.display = "block"; }
}

function renderAttendanceSuccessRecap(records, assignment) {
  const tbody = document.getElementById("att-success-body");
  tbody.innerHTML = "";
  mockStudents.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${s.registration_number}</td>
      <td class="student-name-cell">${s.full_name}</td>
      <td style="text-align:center;">${records[s.id] ? "✔ Present" : "Absent"}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function handleAttendanceSubmit() {
  const assignmentIndex = currentAttendanceAssignmentIndex;
  const assignment = currentTeacher.assignments[assignmentIndex];
  const records = { ...pendingPresentMap };
  if (!mockStudents.length) {
    alert("No students are enrolled in this selected semester and batch.");
    return;
  }
  if (!Object.values(records).some(Boolean)) {
    alert("Please select at least one student before submitting attendance.");
    return;
  }
  try {
    const result = await apiFetch("/teacher/attendance/submit/", { method: "POST", body: {
      subject_id: assignment.subject_id, academic_year: assignment.academic_year,
      records: mockStudents.map((s) => ({ student_id: s.id, status: records[s.id] ? "Present" : "Absent" }))
    }});
    attendanceSessionId = result.session_id;
    absentStudents = result.absent_students.map((s) => ({ id: s.student_id, ...s }));
  } catch (err) {
    if (err.status === 409) {
      // Another teacher or an admin submitted attendance after this page
      // was opened. Reload the saved, read-only statuses instead of showing
      // a browser alert or allowing another mark attempt.
      await loadAttendanceForAssignment(assignmentIndex, { recordHistory: false });
      return;
    }
    alert(err.message);
    return;
  }
  document.getElementById("att-absent-subtitle").textContent = `${semesterNames[assignment.semester - 1]}/${assignment.subject}`;
  const submittedMessage = document.getElementById("att-submitted-message");
  submittedMessage.textContent = "Attendance submitted successfully. Review absent students, then send the guardian message.";
  submittedMessage.style.display = "block";

  const tbody = document.getElementById("att-absent-body");
  tbody.innerHTML = absentStudents.length
    ? absentStudents.map((s) => `
        <tr>
          <td>${s.registration_number}</td>
          <td>${s.full_name}</td>
          <td>${s.guardian_name}</td>
          <td>${s.guardian_phone}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" style="text-align:center;color:#98a3b5;">No absent students today.</td></tr>`;

  showAttStep("att-step-absent");
}

async function handleSendGuardianMessage() {
  const assignmentIndex = currentAttendanceAssignmentIndex;
  const message = document.getElementById("att-guardian-message").value;
  let result;
  try { result = await apiFetch("/teacher/attendance/notify-guardians/", { method: "POST", body: { session_id: attendanceSessionId, message } }); }
  catch (err) { alert(err.message); return; }

  const confirmLabel = document.getElementById("att-send-confirmation");
  const retryLabel = document.getElementById("att-retry-confirmation");
  const statusLabel = document.getElementById("att-step-success").style.display !== "none" ? retryLabel : confirmLabel;
  const expected = absentStudents.length;
  if (!expected) {
    statusLabel.textContent = "There are no absent guardians to notify.";
    statusLabel.classList.add("show");
    return;
  }
  const alreadySent = result.already_sent || 0;
  if (alreadySent === expected) {
    statusLabel.textContent = "Messages were already sent successfully to absent guardians today.";
    statusLabel.classList.add("show");
    return;
  }
  if (result.sent + alreadySent !== expected) {
    const pending = (result.notifications || []).filter((item) => item.status === "Pending").length;
    const failed = (result.notifications || []).filter((item) => item.status === "Failed").length;
    const detail = (result.notifications || []).find((item) => item.detail)?.detail || "Check the SMS Pasal API key and credits.";
    statusLabel.textContent = `SMS not sent: ${pending} pending, ${failed} failed. ${detail}`;
    statusLabel.classList.add("show");
    return;
  }
  statusLabel.textContent = alreadySent
    ? `SMS request submitted for ${result.sent} remaining guardian(s) ✓`
    : `SMS request submitted for ${result.sent} guardian(s) ✓`;
  statusLabel.classList.add("show");

  const assignment = currentTeacher.assignments[assignmentIndex];
  renderAttendanceSuccessRecap(pendingPresentMap, assignment);
  document.getElementById("att-success-heading").textContent = "Messages sent successfully";
  const successMessage = document.getElementById("att-success-message");
  successMessage.textContent = `Messages sent successfully to ${expected} absent guardian${expected === 1 ? "" : "s"}.`;
  successMessage.style.display = "block";
  document.getElementById("att-already-sent-message").style.display = "none";
  showAttStep("att-step-success");
}

async function showGuardianMessageDetails() {
  const panel = document.getElementById("att-message-details-panel");
  const body = document.getElementById("att-message-details-body");
  document.getElementById("btn-att-message-details").style.display = "none";
  document.getElementById("btn-att-hide-message-details").style.display = "inline-block";
  if (!attendanceSessionId) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#98a3b5;">No submitted attendance session is selected.</td></tr>`;
    panel.style.display = "block";
    return;
  }

  body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#98a3b5;">Loading message details…</td></tr>`;
  panel.style.display = "block";
  try {
    const result = await apiFetch(`/teacher/attendance/message-details/?session_id=${encodeURIComponent(attendanceSessionId)}`);
    const messages = result.messages || [];
    body.innerHTML = messages.length ? messages.map((item) => `
      <tr>
        <td>${item.registration_number}<br><strong>${item.student_name}</strong></td>
        <td>${item.guardian_name}</td>
        <td>${item.guardian_phone}</td>
        <td style="white-space:pre-wrap;min-width:250px;">${item.message}</td>
        <td>${item.status}</td>
        <td>${item.sent_time ? new Date(item.sent_time).toLocaleString() : "—"}</td>
      </tr>
    `).join("") : `<tr><td colspan="6" style="text-align:center;color:#98a3b5;">No guardian message has been sent for this attendance yet.</td></tr>`;
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ff8080;">${err.message}</td></tr>`;
  }
}

function hideGuardianMessageDetails() {
  document.getElementById("att-message-details-panel").style.display = "none";
  document.getElementById("btn-att-message-details").style.display = "inline-block";
  document.getElementById("btn-att-hide-message-details").style.display = "none";
}

function initAttendanceView() {
  document.getElementById("attendance-today-date").textContent = todayDisplayString();
  populateAttendanceSemesterSelect();
  if (currentTeacher.assignments.length > 0) {
    loadAttendanceForAssignment(0);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Keep the date label honestly "live" — checks once a minute
  // and updates if the calendar day has actually rolled over.
  setInterval(() => {
    const label = document.getElementById("attendance-today-date");
    if (label) label.textContent = todayDisplayString();
  }, 60 * 1000);

  document.getElementById("att-semester-select").addEventListener("change", (e) => {
    loadAttendanceForAssignment(Number(e.target.value));
  });

  document.getElementById("att-select-all").addEventListener("change", (e) => {
    const markPresent = e.target.checked;
    mockStudents.forEach((s) => { pendingPresentMap[s.id] = markPresent; });
    renderAttendanceMarkTable();
  });

  document.getElementById("btn-att-submit").addEventListener("click", handleAttendanceSubmit);
  document.getElementById("btn-att-send-message").addEventListener("click", handleSendGuardianMessage);
  document.getElementById("btn-att-retry-sms")?.addEventListener("click", handleSendGuardianMessage);
  document.getElementById("btn-att-message-details")?.addEventListener("click", showGuardianMessageDetails);
  document.getElementById("btn-att-hide-message-details")?.addEventListener("click", hideGuardianMessageDetails);

  const logout = async () => {
    try { await apiLogout(); } catch (_) { /* session may already have expired */ }
    window.location.href = "index.html";
  };
  document.getElementById("btn-att-logout").addEventListener("click", logout);
  document.getElementById("btn-teacher-logout").addEventListener("click", logout);
});

/* Grouped, persisted marks grid. These functions replace the earlier flat
   renderers while retaining the existing roster and save API. */
function showColumnError(message) { const label = document.getElementById("teacher-save-confirmation"); label.textContent = message; label.classList.add("show"); }
function calcWeightedPercentage(row, columns) {
  const entered = columns.filter((column) => row[column.key] !== "" && row[column.key] !== null && row[column.key] !== undefined);
  if (!entered.length) return "–";
  const score = entered.reduce((total, column) => total + Number(row[column.key]), 0);
  const maximum = entered.reduce((total, column) => total + Number(column.maximum), 0);
  return maximum ? `${((score / maximum) * 100).toFixed(1)}%` : "–";
}
function examResult(values, columns) {
  const examColumns = columns.filter((column) => ["midterm", "preboard", "preboards"].includes(String(column.category || "").toLowerCase()));
  const marks = examColumns.map((column) => values[column.key] ?? values[String(column.assessmentId || column.id)]).filter((value) => value !== "" && value != null);
  if (!marks.length) return "–";
  return marks.some((value) => Number(value) < 24) ? "Fail" : "Pass";
}
function buildMarksHead() {
  const columns = getColumnsForAssignment(currentAssignmentIndex), groups = ["Assignments", "Unit Tests", "Attendance", "Grooming", "Midterm", "Lab Reports", "Overall Activities", "Preboard"];
  const thead = document.getElementById("teacher-marks-head"), foot = document.getElementById("teacher-marks-foot"), inGroup = (name) => columns.filter((column) => column.category === name);
  const top = document.createElement("tr"); top.className = "marks-group-row";
  top.innerHTML = '<th rowspan="2" class="sticky-id">IDs</th><th rowspan="2" class="sticky-name">Name</th>';
  groups.forEach((group) => { top.innerHTML += `<th colspan="${Math.max(1, inGroup(group).length)}">${group}${["Assignments", "Unit Tests", "Lab Reports"].includes(group) ? ` <button type="button" class="group-add-btn" data-group="${group}">+ Add</button>` : ""}</th>`; });
  top.innerHTML += '<th rowspan="2">Status</th><th rowspan="2">Total</th><th rowspan="2">Board Exam</th>';
  const sub = document.createElement("tr");
  groups.forEach((group) => { const items = inGroup(group); sub.innerHTML += items.length ? items.map((item) => `<th>${item.label}<small>/${item.maximum} · pass ${item.passMarks || 0}</small><button class="col-remove-btn" data-col-key="${item.key}">×</button></th>`).join("") : '<th class="empty-subcolumn">No column</th>'; });
  thead.replaceChildren(top, sub);
  const footRow = document.createElement("tr"); footRow.innerHTML = '<td class="student-id-cell">Class</td><td class="student-name-cell">Average</td>';
  groups.forEach((group) => { const items = inGroup(group); (items.length ? items : [null]).forEach((column) => { footRow.innerHTML += column ? `<td class="total-avg-cell" id="total-${column.key}">–</td>` : '<td></td>'; }); });
  footRow.innerHTML += '<td></td><td class="total-avg-cell" id="total-average">–</td><td></td>'; foot.replaceChildren(footRow);
  thead.querySelectorAll(".group-add-btn").forEach((button) => button.addEventListener("click", () => { document.getElementById("new-column-category").value = button.dataset.group; document.getElementById("new-column-name").focus(); }));
  thead.querySelectorAll(".col-remove-btn").forEach((button) => button.addEventListener("click", () => removeColumn(button.dataset.colKey)));
}
function buildMarksBody(students, query) {
  const columns = getColumnsForAssignment(currentAssignmentIndex), groups = ["Assignments", "Unit Tests", "Attendance", "Grooming", "Midterm", "Lab Reports", "Overall Activities", "Preboard"], tbody = document.getElementById("teacher-marks-body"); tbody.innerHTML = "";
  const statusFilter = document.getElementById("teacher-status-filter")?.value || "all";
  students.filter((student) => {
    const result = examResult(getStoredMarks(student.id, currentAssignment.semester, currentAssignment.subject), columns).toLowerCase();
    return statusFilter === "all" || result === statusFilter;
  }).forEach((student) => {
    const stored = getStoredMarks(student.id, currentAssignment.semester, currentAssignment.subject), tr = document.createElement("tr");
    tr.innerHTML = `<td class="student-id-cell">${student.registration_number}</td><td class="student-name-cell">${highlightMatch(student.full_name, query)}</td>`;
    const addInput = (column, group) => { const td = document.createElement("td"); if (group === "Attendance") { td.textContent = student.performance?.categories?.Attendance?.obtained == null ? "– /15" : `${student.performance.categories.Attendance.obtained} /15`; tr.appendChild(td); return; } if (!column) { tr.appendChild(td); return; } const input = document.createElement("input"); input.type="number"; input.step="1"; input.className="mark-input"; input.min="0"; input.max=String(column.maximum); input.value=stored[column.key] ?? ""; input.dataset.studentId=student.id; input.dataset.field=column.key; const message = document.createElement("small"); message.className="mark-error"; input.addEventListener("input", () => { const valid=input.value==="" || (Number(input.value)>=0 && Number(input.value)<=Number(column.maximum)); input.classList.toggle("invalid-mark",!valid); message.textContent=valid?"":`Please enter a value between 0 and ${column.maximum}.`; input.title=message.textContent; if(valid){stored[column.key]=input.value;updateTotalCell(tr,student.id);const result=examResult(stored,columns);const statusCell=tr.querySelector(`[data-status-for="${student.id}"]`);if(statusCell){statusCell.textContent=result;statusCell.className=`exam-status ${result.toLowerCase()}`;}updateFooterTotals();} }); td.append(input, message); tr.appendChild(td); };
    groups.forEach((group) => { const entries = columns.filter((column) => column.category === group); entries.length ? entries.forEach((entry) => addInput(entry, group)) : addInput(null, group); });
    const status=document.createElement("td"); status.className=`exam-status ${examResult(stored,columns).toLowerCase()}`; status.dataset.statusFor=student.id; status.textContent=examResult(stored,columns); tr.appendChild(status);
    const total=document.createElement("td"); total.className="total-avg-cell"; total.dataset.totalFor=student.id; total.textContent=student.performance ? `${student.performance.performance_percent}%${student.performance.is_complete ? "" : "*"}` : calcWeightedPercentage(stored,columns); tr.appendChild(total);
    const board=document.createElement("td"); board.className="board-exam-cell"; board.textContent=student.board_exam == null ? "Not yet" : student.board_exam; tr.appendChild(board); tbody.appendChild(tr);
  }); updateFooterTotals();
}
function updateTotalCell(tr, studentId) { const columns=getColumnsForAssignment(currentAssignmentIndex), row={}; columns.forEach((column)=>{const input=tr.querySelector(`input[data-student-id="${studentId}"][data-field="${column.key}"]`);row[column.key]=input?input.value:"";}); tr.querySelector(`[data-total-for="${studentId}"]`).textContent=calcWeightedPercentage(row,columns); }
const performanceCharts = {};
function renderPerformanceCharts(students) {
  if (!window.Chart) return;
  Object.values(performanceCharts).forEach((chart) => chart.destroy());
  const entered = students.filter((student) => student.performance), labels = ["Assignments", "Unit Tests", "Attendance", "Grooming", "Midterm", "Lab Reports", "Overall Activities", "Preboard"];
  const averages = labels.map((label) => { const values = entered.map((student) => student.performance.categories[label]?.obtained).filter((value) => value != null); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; });
  const overall = entered.length ? entered.reduce((sum, student) => sum + student.performance.performance_percent, 0) / entered.length : 0;
  performanceCharts.overall = new Chart(document.getElementById("performance-overall-chart"), { type: "doughnut", data: { labels: ["Current marks", "Not entered"], datasets: [{ data: [overall, 100 - overall], backgroundColor: ["#4f8fff", "#dfe7ef"] }] } });
  performanceCharts.categories = new Chart(document.getElementById("performance-category-chart"), { type: "bar", data: { labels, datasets: [{ label: "Average obtained marks", data: averages, backgroundColor: "#4ed08a" }] }, options: { scales: { y: { beginAtZero: true } } } });
  performanceCharts.attendance = new Chart(document.getElementById("performance-attendance-chart"), { type: "scatter", data: { datasets: [{ label: "Students", data: entered.map((student) => ({ x: student.performance.categories.Attendance?.attendance_rate, y: student.performance.performance_percent })).filter((point) => point.x != null), backgroundColor: "#f0a84e" }] }, options: { scales: { x: { min: 0, max: 100, title: { display: true, text: "Attendance rate (%)" } }, y: { min: 0, max: 100, title: { display: true, text: "Current performance (%)" } } } } });
}
