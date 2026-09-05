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
  return row[key] !== undefined ? row[key] : 0;
}

function calcTotalAverage(row, columns) {
  const vals = columns.map((f) => Number(readField(row, f.key)));
  const sum = vals.reduce((a, b) => a + b, 0);
  return (sum / vals.length).toFixed(1);
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
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]}/${a.subject}</option>`)
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
    baseMarkFields = data.assessment_types.map((item) => ({ key: String(item.id), label: item.assessment_name, assessmentId: item.id, maximum: item.maximum_marks }));
    columnsByAssignment[assignmentIndex] = baseMarkFields.map((item) => ({ ...item }));
    mockStudents.forEach((student) => { marksStore[marksKey(student.id, assignment.semester, assignment.subject)] = student.marks || {}; });
    buildMarksHead();
    buildMarksBody(mockStudents, "");
    if (!mockStudents.length) showTeacherEmptyState(`No active students exist in the ${assignment.academic_year} batch for this assignment.`);
  } catch (err) {
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
    const sum = [...inputs].reduce((acc, input) => acc + Number(input.value || 0), 0);
    const cell = document.getElementById(`total-${f.key}`);
    if (cell) cell.textContent = (sum / inputs.length).toFixed(1);
  });

  const totalCells = document.querySelectorAll("#teacher-marks-body .total-avg-cell");
  const overallSum = [...totalCells].reduce((acc, cell) => acc + Number(cell.textContent || 0), 0);
  document.getElementById("total-average").textContent = (overallSum / totalCells.length).toFixed(1);
}

function collectAllMarks() {
  const inputs = document.querySelectorAll("#teacher-marks-body input.mark-input");
  const payload = [];
  inputs.forEach((input) => {
    payload.push({ studentId: input.dataset.studentId, field: input.dataset.field, value: Number(input.value) });
  });
  return payload;
}

/* ----------------------------------------------------------
   Add / remove columns — Semester-wise Details page only, and
   scoped to whichever semester/subject is currently open, so a
   "Unit Test" column added for one class doesn't leak into others.
   ---------------------------------------------------------- */
function addColumn(rawName) {
  const name = rawName.trim();
  if (!name) return;

  const columns = getColumnsForAssignment(currentAssignmentIndex);
  let key = slugify(name);
  // guard against a duplicate/colliding key (e.g. adding "Unit Test" twice)
  let suffix = 2;
  while (columns.some((c) => c.key === key)) {
    key = `${slugify(name)}_${suffix++}`;
  }

  columns.push({ key, label: name });
  buildMarksHead();
  buildMarksBody(mockStudents, document.getElementById("teacher-marks-search").value);
}

function removeColumn(key) {
  const columns = getColumnsForAssignment(currentAssignmentIndex);
  if (columns.length <= 1) {
    alert("At least one mark column is required.");
    return;
  }
  const col = columns.find((c) => c.key === key);
  if (!confirm(`Remove the "${col ? col.label : key}" column? This won't delete already-entered marks from the record, just hide this column here.`)) {
    return;
  }
  const index = columns.findIndex((c) => c.key === key);
  if (index !== -1) columns.splice(index, 1);
  buildMarksHead();
  buildMarksBody(mockStudents, document.getElementById("teacher-marks-search").value);
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
  document.getElementById("teacher-profile-avatar").textContent = currentTeacher.gender === "Female" ? "👩‍🏫" : currentTeacher.gender === "Male" ? "👨‍🏫" : "🧑‍🏫";
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

  // Assessment types are database-managed so mark columns stay consistent
  // across teachers, reports, and the maximum-mark validation.
  document.getElementById("new-column-name").disabled = true;
  document.getElementById("btn-add-column").disabled = true;
  document.querySelector(".column-manager-hint").textContent = "Assessment columns are managed from the database.";

  // Add Column — kept for backwards-compatible markup; disabled above.
  document.getElementById("btn-add-column").addEventListener("click", () => {
    const input = document.getElementById("new-column-name");
    addColumn(input.value);
    input.value = "";
  });
  document.getElementById("new-column-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addColumn(e.target.value);
      e.target.value = "";
    }
  });

  // Home always returns to the first Teacher interface.
  document.getElementById("btn-teacher-home").addEventListener("click", () => {
    document.querySelectorAll(".menu-item").forEach((b) => b.classList.remove("active"));
    document.querySelector('.menu-item[data-menu="semester-details"]').classList.add("active");
    goToView("view-teacher-list");
  });

  document.getElementById("btn-save-teacher-marks").addEventListener("click", async () => {
    const payload = collectAllMarks();
    payload.forEach((cell) => {
      commitMarks(cell.studentId, currentAssignment.semester, currentAssignment.subject, { [cell.field]: cell.value });
    });

    const label = document.getElementById("teacher-save-confirmation");
    try {
      const columns = getColumnsForAssignment(currentAssignmentIndex);
      await apiFetch("/teacher/marks/", { method: "POST", body: {
        subject_id: currentAssignment.subject_id, academic_year: currentAssignment.academic_year,
        marks: payload.map((cell) => ({ student_id: cell.studentId, assessment_id: Number(cell.field), marks_obtained: cell.value }))
      }});
      label.textContent = "Saved ✓";
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
  const rows = students.map((s) => getStoredMarks(s.id, semesterIndex, subject));
  const avg = (key) => rows.reduce((sum, r) => sum + Number(r[key]), 0) / rows.length;
  return {
    attendance: avg("attendance"),
    assignment: avg("assignment"),
    lab: avg("lab"),
    overall: avg("overall"),
    midterm: avg("midterm"),
    preboard: avg("preboard"),
  };
}

function renderDashboardTable(students, semesterIndex, subject, assignmentIndex) {
  const tbody = document.getElementById("dash-summary-body");
  tbody.innerHTML = "";
  const columns = getColumnsForAssignment(assignmentIndex);

  students.forEach((student) => {
    const row = getStoredMarks(student.id, semesterIndex, subject);
    const total = calcTotalAverage(row, columns);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${student.registration_number}</td>
      <td class="student-name-cell">${student.full_name}</td>
      <td>${row.attendance}%</td>
      <td>${row.assignment}%</td>
      <td>${row.lab}%</td>
      <td>${row.overall}%</td>
      <td>${total}%</td>
    `;
    tbody.appendChild(tr);
  });

  const agg = computeClassAggregates(semesterIndex, subject, students);
  document.getElementById("dash-total-attendance").textContent = `${agg.attendance.toFixed(1)}%`;
  document.getElementById("dash-total-assignment").textContent = `${agg.assignment.toFixed(1)}%`;
  document.getElementById("dash-total-lab").textContent = `${agg.lab.toFixed(1)}%`;
  document.getElementById("dash-total-overall").textContent = `${agg.overall.toFixed(1)}%`;
  const classOverall = (agg.attendance + agg.assignment + agg.lab + agg.overall + agg.midterm + agg.preboard) / 6;
  document.getElementById("dash-total-average").textContent = `${classOverall.toFixed(1)}%`;

  return agg;
}

function populateDashboardSemesterSelect() {
  const select = document.getElementById("dash-semester-select");
  select.innerHTML = currentTeacher.assignments
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]}/${a.subject}</option>`)
    .join("");
}

let dashboardInitialized = false;

function loadDashboard(assignmentIndex) {
  const assignment = currentTeacher.assignments[assignmentIndex];
  document.getElementById("dash-semester-select").value = String(assignmentIndex);
  document.getElementById("dash-title").textContent = `${semesterNames[assignment.semester - 1]} / ${assignment.subject}`;

  const agg = renderDashboardTable(mockStudents, assignment.semester, assignment.subject, assignmentIndex);

  renderDonutChart("dash-donut-box", [
    { label: "Present", value: agg.attendance, color: CHART_COLORS.present },
    { label: "Absent", value: 100 - agg.attendance, color: CHART_COLORS.absent },
  ]);

  renderPieChart("dash-pie-box", [
    { label: "Attendance", value: agg.attendance, color: CHART_COLORS.attendance },
    { label: "Assignments", value: agg.assignment, color: CHART_COLORS.assignment },
    { label: "Lab", value: agg.lab, color: CHART_COLORS.lab },
    { label: "Overall activities", value: agg.overall, color: CHART_COLORS.overall },
    { label: "Midterm", value: agg.midterm, color: CHART_COLORS.midterm },
    { label: "Pre-board", value: agg.preboard, color: CHART_COLORS.preboard },
  ]);

  document.getElementById("dash-legend").innerHTML = `
    <li><span class="swatch" style="background:${CHART_COLORS.attendance}"></span> Attendance</li>
    <li><span class="swatch" style="background:${CHART_COLORS.assignment}"></span> Assignments</li>
    <li><span class="swatch" style="background:${CHART_COLORS.lab}"></span> Lab</li>
    <li><span class="swatch" style="background:${CHART_COLORS.overall}"></span> Overall activities</li>
    <li><span class="swatch" style="background:${CHART_COLORS.midterm}"></span> Midterm</li>
    <li><span class="swatch" style="background:${CHART_COLORS.preboard}"></span> Pre-board</li>
  `;
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
    .map((a, i) => `<option value="${i}">${semesterNames[a.semester - 1]}/${a.subject}</option>`)
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
  const allPresent = mockStudents.every((s) => pendingPresentMap[s.id]);
  document.getElementById("att-select-all").checked = allPresent;
}

let attendanceSessionId = null;
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
    pendingPresentMap = {};
    mockStudents.forEach((s) => { pendingPresentMap[s.id] = s.status !== "Absent"; });
    if (data.locked) {
      renderAttendanceSuccessRecap(pendingPresentMap, assignment);
      showAttStep("att-step-success", { recordHistory: false });
    } else {
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
  let absentStudents;
  try {
    const result = await apiFetch("/teacher/attendance/submit/", { method: "POST", body: {
      subject_id: assignment.subject_id, academic_year: assignment.academic_year,
      records: mockStudents.map((s) => ({ student_id: s.id, status: records[s.id] ? "Present" : "Absent" }))
    }});
    attendanceSessionId = result.session_id;
    absentStudents = result.absent_students.map((s) => ({ id: s.student_id, ...s }));
  } catch (err) { alert(err.message); return; }
  document.getElementById("att-absent-subtitle").textContent = `${semesterNames[assignment.semester - 1]}/${assignment.subject}`;

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
  try { await apiFetch("/teacher/attendance/notify-guardians/", { method: "POST", body: { session_id: attendanceSessionId, message } }); }
  catch (err) { alert(err.message); return; }

  const confirmLabel = document.getElementById("att-send-confirmation");
  confirmLabel.textContent = "Sent ✓";
  confirmLabel.classList.add("show");

  const assignment = currentTeacher.assignments[assignmentIndex];
  renderAttendanceSuccessRecap(pendingPresentMap, assignment);
  showAttStep("att-step-success");
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

  document.getElementById("btn-att-logout").addEventListener("click", async () => {
    try { await apiLogout(); } catch (_) { /* session may already have expired */ }
    window.location.href = "index.html";
  });
});
