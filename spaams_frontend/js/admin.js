/* ==========================================================
   admin.js
   Handles:
     1. Sidebar menu switching
     2. Student list + LIVE search (filters as you type, no
        Enter needed) with bold-highlighted matches, and
        "starts with" results ranked above "contains" results
     3. Student detail view (Personal/Academic tabs)
     4. The Academic tab's Chart.js visual, fed by Django's
        pandas/numpy calculation endpoint
     5. Home icon = go back ONE step (a small history stack),
        not "go to landing page"
   ========================================================== */

/* Empty state used only when the database has no records. */
const mockStudents = [];

async function fetchStudentList() {
  try {
    // Real endpoint — verified with curl + a real session cookie
    // before this was wired up (returned real seeded TU BCA students).
    const students = await apiFetch("/admin/students/");
    // Map only values returned by Django. Missing academic data remains blank.
    return students.map((s) => ({
      id: s.id,
      registration_number: s.registration_number,
      symbol_number: s.symbol_number || "",
      full_name: s.full_name,
      address: s.address,
      contact_no: s.phone,
      email: s.email || "",
      faculty: s.faculty || "",
      semester: s.semester || "",
      semester_number: s.current_semester_number || "",
      academic_year: s.current_academic_year || "",
      first_login: Boolean(s.first_login),
      temp_password_plain: s.temp_password_plain || null,
      temporary_password_status: s.temporary_password_status || "Password already changed.",
      account_status: s.account_status || s.status || "Active",
      board_gpa: s.board_gpa ?? "—",
      batch: s.batch || s.current_academic_year || "—",
      status: s.status || "Active",
    }));
  } catch (err) {
    console.error("Could not reach the backend:", err.message);
    throw err;
  }
}

async function fetchStudentPerformance(studentId) {
  return apiFetch(`/admin/students/${studentId}/performance/`);
}

let adminStudentPerformanceChart = null;

/* ----------------------------------------------------------
   2. NAVIGATION STACK (for the Home/back-one-step icon)
   ---------------------------------------------------------- */
const viewHistory = [];

function goToView(viewId, { pushToHistory = true } = {}) {
  if (pushToHistory) {
    const current = document.querySelector(".view.active");
    if (current && current.id !== viewId) {
      viewHistory.push(current.id);
    }
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");
}

function goBackOneStep() {
  viewHistory.length = 0;
  document.querySelectorAll(".menu-item").forEach((button) => button.classList.toggle("active", button.dataset.menu === "student-dashboard"));
  goToView("view-student-list", { pushToHistory: false });
}

/* ----------------------------------------------------------
   3. LIVE SEARCH: filter-as-you-type + bold highlight
   ---------------------------------------------------------- */
function highlightMatch(text, query) {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);
  return `${before}<mark class="match-highlight">${match}</mark>${after}`;
}

function filterStudents(students, query) {
  const q = query.trim().toLowerCase();
  if (!q) return students;

  const matches = students.filter((s) => {
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.registration_number.toLowerCase().includes(q) ||
      s.symbol_number.toLowerCase().includes(q)
    );
  });

  // Rank "name starts with the query" above "name/id just contains it"
  matches.sort((a, b) => {
    const aStarts = a.full_name.toLowerCase().startsWith(q) ? 0 : 1;
    const bStarts = b.full_name.toLowerCase().startsWith(q) ? 0 : 1;
    return aStarts - bStarts;
  });

  return matches;
}

function renderStudentTable(students, query) {
  const tbody = document.getElementById("student-table-body");
  const countLabel = document.getElementById("search-result-count");
  tbody.innerHTML = "";

  if (students.length === 0) {
    tbody.innerHTML = `<tr class="no-results"><td colspan="12">No students found.</td></tr>`;
    countLabel.textContent = "0 results";
    return;
  }

  countLabel.textContent = query ? `${students.length} result(s)` : "";

  students.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${highlightMatch(s.registration_number, query)}</td>
      <td>${highlightMatch(s.full_name, query)}</td>
      <td>${s.address}</td>
      <td>${s.contact_no}</td>
      <td>${s.email}</td>
      <td>${s.faculty}</td>
      <td>${s.semester}</td>
      <td>${s.batch}</td>
      <td>${s.board_gpa}</td>
      <td><span class="account-state ${s.account_status === "Active" ? "is-active" : "is-disabled"}">${s.account_status}</span></td>
      <td>${s.first_login ? "Temporary password not changed" : "Password already changed"}</td>
      <td>${s.first_login ? (s.temp_password_plain || "Unavailable for legacy account") : "—"}</td>
    `;
    tr.addEventListener("click", () => openStudentDetail(s.id));
    tbody.appendChild(tr);
  });
}

/* ----------------------------------------------------------
   4. STUDENT DETAIL VIEW
   ---------------------------------------------------------- */
let allStudentsCache = [];

async function updateAdminOverviewCards() {
  const students = allStudentsCache || [];
  let graduatedStudents = 0;
  if (!liveTeachers.length) {
    try { liveTeachers = await apiFetch("/admin/teachers/"); } catch (error) { console.error("Could not load teacher overview:", error); }
  }
  try { graduatedStudents = (await apiFetch("/admin/graduated-students/count/")).count || 0; } catch (error) { console.error("Could not load graduated student count:", error); }
  const active = (record) => String(record.account_status || record.status || "Active").toLowerCase() === "active";
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  set("overview-total-students", students.length);
  set("overview-total-teachers", liveTeachers.length);
  set("overview-active-students", students.filter(active).length);
  set("overview-active-teachers", liveTeachers.filter(active).length);
  set("overview-disabled-students", students.filter((student) => !active(student)).length);
  set("overview-disabled-teachers", liveTeachers.filter((teacher) => !active(teacher)).length);
  set("overview-graduated-students", graduatedStudents);
}
let currentStudent = null;

async function openStudentDetail(studentId) {
  const student = allStudentsCache.find((s) => s.id === studentId);
  if (!student) return;
  currentStudent = student;

  document.getElementById("detail-student-name").textContent = student.full_name;

  document.getElementById("personal-details-row").innerHTML = `
    <tr>
      <td>${student.registration_number}</td>
      <td>${student.full_name}</td>
      <td>${student.contact_no}</td>
      <td>${student.address}</td>
      <td>${student.email}</td>
    </tr>
  `;

  // reset to Personal tab every time a new student is opened
  switchDetailTab("personal");

  goToView("view-student-detail");
}

async function switchDetailTab(tabName) {
  document.querySelectorAll(".detail-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tabName));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });

  if (tabName === "academic" && currentStudent) {
    await loadAcademicDetails(currentStudent);
  }
}

async function loadAcademicDetails(student) {
  const chartCanvas = document.getElementById("performance-chart");
  const loadingLabel = document.getElementById("chart-loading");
  chartCanvas.style.display = "none";
  loadingLabel.style.display = "block";

  let result;
  try {
    result = await fetchStudentPerformance(student.id);
  } catch (error) {
    // A stale CSRF/session cookie can occur after the development server
    // reloads. Refresh it once and repeat the read before showing an error.
    try {
      await ensureCsrfCookie();
      result = await fetchStudentPerformance(student.id);
    } catch (retryError) {
      loadingLabel.textContent = retryError.message || "Performance data could not be loaded.";
      document.getElementById("academic-details-row").innerHTML = `<tr><td colspan="8">${loadingLabel.textContent}</td></tr>`;
      console.error("Could not load student performance:", retryError);
      return;
    }
  }
  const stats = result.stats || {};

  document.getElementById("academic-details-row").innerHTML = `
    <tr>
      <td>${student.registration_number}</td>
      <td>${student.faculty}</td>
      <td>${student.semester}</td>
      <td>${stats.attendance_percent}%</td>
      <td>${stats.lab_percent}%</td>
      <td>${stats.overall_activities_percent}%</td>
      <td>${stats.overall_average}%</td>
      <td>${student.gpa}</td>
    </tr>
  `;

  const chartBox = chartCanvas.closest(".chart-box");
  chartBox.querySelector(".no-chart-data")?.remove();
  adminStudentPerformanceChart?.destroy();
  if (!result.has_data) {
    chartCanvas.style.display = "none";
    loadingLabel.style.display = "none";
    chartBox.insertAdjacentHTML("beforeend", '<p class="no-chart-data">No performance data is available for this student.</p>');
    return;
  }
  renderStudentPerformancePie(chartBox, stats);
  loadingLabel.style.display = "none";
}

function renderStudentPerformancePie(chartBox, stats) {
  const segments = [
    { label: "Attendance", value: Number(stats.attendance_percent) || 0, color: "#4f8fff", side: "#2854a2" },
    { label: "Assignments", value: Number(stats.assignments_percent) || 0, color: "#4ed08a", side: "#27845a" },
    { label: "Lab", value: Number(stats.lab_percent) || 0, color: "#f0a84e", side: "#a9631d" },
    { label: "Result", value: Number(stats.result_percent) || 0, color: "#b076f0", side: "#7040ab" },
    { label: "Overall activities", value: Number(stats.overall_activities_percent) || 0, color: "#f0664e", side: "#a7352a" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return;

  chartBox.querySelector(".fallback-pie")?.remove();
  chartBox.querySelector(".student-performance-pie")?.remove();
  const cx = 128, cy = 116, radius = 82, depth = 12;
  const polar = (angle, y = cy) => {
    const radians = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(radians), y + radius * Math.sin(radians)];
  };
  const wedge = (start, end, y) => {
    const [x1, y1] = polar(start, y);
    const [x2, y2] = polar(end, y);
    return `M ${cx} ${y} L ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  };
  let angle = 0;
  const parts = segments.filter((segment) => segment.value > 0).map((segment) => {
    const start = angle;
    angle += segment.value / total * 360;
    return { ...segment, start, end: angle };
  });
  const sides = parts.map((segment) => `<path d="${wedge(segment.start, segment.end, cy + depth)}" fill="${segment.side}" />`).join("");
  const tops = parts.map((segment) => `<path class="student-pie-slice" d="${wedge(segment.start, segment.end, cy)}" fill="${segment.color}" stroke="#ffffff" stroke-width="2" tabindex="0" data-label="${segment.label}" data-value="${segment.value.toFixed(1)}" aria-label="${segment.label}: ${segment.value.toFixed(1)}%"></path>`).join("");
  const average = Number(stats.overall_average) || 0;
  chartBox.insertAdjacentHTML("beforeend", `
    <div class="student-performance-pie" role="img" aria-label="3D pie chart of saved academic performance">
      <svg viewBox="0 0 256 230" aria-hidden="true">
        <ellipse cx="128" cy="214" rx="86" ry="12" fill="rgba(0,0,0,.22)" />
        ${sides}${tops}
        <circle cx="128" cy="116" r="37" fill="#101b2d" stroke="#ffffff" stroke-width="2" />
        <text x="128" y="111" text-anchor="middle" class="pie-average-label">AVERAGE</text>
        <text x="128" y="132" text-anchor="middle" class="pie-average-value">${average.toFixed(1)}%</text>
      </svg>
    </div>`);
  const legend = chartBox.closest(".chart-area")?.querySelector(".chart-legend");
  if (legend) legend.innerHTML = segments.map((segment) => `<li><span class="swatch" style="background:${segment.color}"></span>${segment.label}: ${segment.value.toFixed(1)}%</li>`).join("");

  document.querySelectorAll(".performance-pie-tooltip").forEach((element) => element.remove());
  const tooltip = document.createElement("div");
  tooltip.className = "performance-pie-tooltip";
  document.body.appendChild(tooltip);
  const moveTooltip = (event, slice) => {
    tooltip.innerHTML = `<strong>${slice.dataset.label}</strong><span>Percentage: ${slice.dataset.value}%</span>`;
    tooltip.style.left = `${event.clientX + 15}px`;
    tooltip.style.top = `${event.clientY + 15}px`;
    tooltip.classList.add("show");
  };
  chartBox.querySelectorAll(".student-pie-slice").forEach((slice) => {
    slice.addEventListener("mouseenter", (event) => moveTooltip(event, slice));
    slice.addEventListener("mousemove", (event) => moveTooltip(event, slice));
    slice.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    slice.addEventListener("focus", () => {
      const rect = slice.getBoundingClientRect();
      moveTooltip({ clientX: rect.right, clientY: rect.top }, slice);
    });
    slice.addEventListener("blur", () => tooltip.classList.remove("show"));
  });
}

function renderFallbackPie(stats) {
  const chartBox = document.querySelector(".chart-box");
  const segments = [
    { value: stats.attendance_percent, color: "#4f8fff" },
    { value: stats.assignments_percent, color: "#4ed08a" },
    { value: stats.lab_percent, color: "#f0a84e" },
    { value: stats.result_percent, color: "#b076f0" },
    { value: stats.overall_activities_percent, color: "#f0664e" },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    chartBox.insertAdjacentHTML("beforeend", '<p class="no-chart-data">No marks have been entered for this student yet.</p>');
    return;
  }

  let cumulative = 0;
  const gradientParts = segments.map((s) => {
    const start = (cumulative / total) * 360;
    cumulative += s.value;
    const end = (cumulative / total) * 360;
    return `${s.color} ${start}deg ${end}deg`;
  });

  const existing = chartBox.querySelector(".fallback-pie");
  if (existing) existing.remove();

  const pie = document.createElement("div");
  pie.className = "fallback-pie";
  pie.style.cssText = `
    width: 180px; height: 180px; border-radius: 50%;
    background: conic-gradient(${gradientParts.join(", ")});
  `;
  chartBox.appendChild(pie);
}

/* ----------------------------------------------------------
   5. WIRE UP THE UI
   ---------------------------------------------------------- */
let currentAdminName = "Admin";

function renderAdminName(name) {
  currentAdminName = name || "Admin";
  const label = document.getElementById("admin-welcome-name");
  const avatar = document.querySelector(".admin-welcome-avatar");
  const input = document.getElementById("admin-name-input");
  if (label) label.textContent = currentAdminName;
  if (avatar) avatar.textContent = currentAdminName.charAt(0).toUpperCase();
  if (input) input.value = currentAdminName;
}

async function loadAdminProfile() {
  try {
    const profile = await apiFetch("/admin/profile/");
    renderAdminName(profile.full_name);
  } catch (error) { console.error("Could not load admin profile:", error); }
}

function setupAdminNameControl() {
  const input = document.getElementById("admin-name-input");
  const button = document.getElementById("btn-save-admin-name");
  const status = document.getElementById("admin-name-status");
  if (!input || !button || !status) return;
  input.value = currentAdminName;
  button.onclick = async () => {
    const full_name = input.value.trim();
    if (!full_name) { status.textContent = "Enter an admin name."; return; }
    button.disabled = true;
    try {
      const profile = await apiFetch("/admin/profile/", { method: "PATCH", body: { full_name } });
      renderAdminName(profile.full_name);
      status.textContent = "Admin name saved.";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  await ensureCsrfCookie();
  await loadAdminProfile();
  allStudentsCache = await fetchStudentList();
  allStudentsCache.forEach((s) => { if (!s.status) s.status = "Active"; });
  updateAdminOverviewCards();
  refreshManualTeacherBatchOptions();
  refreshAttendanceBatchOptions();
  renderStudentTable(allStudentsCache, "");

  // Sidebar menu
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".menu-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (btn.dataset.menu === "student-dashboard") {
        goToView("view-student-list");
      } else if (btn.dataset.menu === "semester-wise-details") {
        goToView("view-semester-details");
        loadSemesterDetails(); // defaults to whatever the <select> currently shows
      } else if (btn.dataset.menu === "semester-wise-dashboard") {
        goToView("view-semester-dashboard");
        loadSemesterDashboard(); // defaults to whatever the <select>s currently show
      } else if (btn.dataset.menu === "attendance-monitoring") {
        goToView("view-attendance");
        loadAttendance();
      } else if (btn.dataset.menu === "customize-admin") {
        goToView("view-customize-admin");
        initCustomizeAdmin();
      } else if (btn.dataset.menu === "setting") {
        goToView("view-setting");
        initSettingPage();
      } else {
        goToView("view-coming-soon");
      }
    });
  });

  document.getElementById("admin-welcome-chip").addEventListener("click", () => {
    document.querySelector('[data-menu="customize-admin"]').click();
  });

  // Live search — fires on every keystroke, no Enter key needed
  document.getElementById("student-search").addEventListener("input", (e) => {
    const query = e.target.value;
    const filtered = filterStudents(allStudentsCache, query);
    renderStudentTable(filtered, query);
  });

  const studentSemesterFilter = document.getElementById("student-semester-filter");
  const applyStudentFilters = () => {
    const query = document.getElementById("student-search").value;
    const selected = studentSemesterFilter.value;
    const semesterFiltered = selected === "all" ? allStudentsCache : allStudentsCache.filter((student) => String(student.semester_number) === selected);
    renderStudentTable(filterStudents(semesterFiltered, query), query);
  };
  studentSemesterFilter.addEventListener("change", applyStudentFilters);

  // Student detail tabs
  document.querySelectorAll(".detail-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchDetailTab(btn.dataset.tab);
    });
  });

  // Home icon = go back one step
  document.getElementById("btn-back").addEventListener("click", goBackOneStep);

  // Start on the first real Admin interface.
  goToView("view-student-list", { pushToHistory: false });
});

/* ==========================================================
   SEMESTER-WISE DETAILS
   Sidebar -> pick a semester -> wide editable marks grid,
   one column-group per subject (Result, Lab, Assignment,
   Attendance, Overall Activities, Total Average, Board Mark).
   ========================================================== */

const semesterNames = [
  "I Semester", "II Semester", "III Semester", "IV Semester",
  "V Semester", "VI Semester", "VII Semester", "VIII Semester",
];

// ----- BACKEND CALL GOES HERE -----
// Real version: GET /api/admin/subjects/?semester=<n>
// (your Subject model already has a semester ForeignKey, so this
// is a simple filtered list once the endpoint exists)
const mockSubjectsBySemester = {
  1: ["Computer Fundamentals & Applications", "Mathematics I", "Programming in C", "Digital Logic"],
  6: ["Operating System", "Numerical Method"],
};
function getSubjectsForSemester(semesterIndex) {
  // semesterIndex is 1-8. Semesters without mock data yet get
  // generic placeholder subjects so every semester still works.
  return (
    mockSubjectsBySemester[semesterIndex] || [
      `Subject ${semesterIndex}A`,
      `Subject ${semesterIndex}B`,
      `Subject ${semesterIndex}C`,
    ]
  );
}

// Sub-columns that repeat under every subject
const markFields = [
  { key: "result", label: "Result", editableBy: "teacher" },
  { key: "lab", label: "Lab", editableBy: "teacher" },
  { key: "assignment", label: "Assig", editableBy: "teacher" },
  { key: "attendance", label: "Attn", editableBy: "teacher" },
  { key: "overall", label: "Overall Act", editableBy: "teacher" },
  { key: "boardMark", label: "Board Mark", editableBy: "admin-only" },
];

let currentSemesterIndex = null;

// ----- BACKEND CALL GOES HERE -----
// Real version: GET /api/admin/marks/?semester=<n>
// returns { studentId: { subjectName: { result, lab, ... } } }
function seedMarks(studentId, subjectIndex) {
  const seed = (studentId * 7 + subjectIndex * 3) % 20;
  return {
    result: 60 + seed,
    lab: 15 + (seed % 5),
    assignment: 16 + (seed % 4),
    attendance: 70 + (seed % 20),
    overall: 65 + (seed % 15),
    boardMark: 55 + seed,
  };
}

// A real (if in-memory-only) shared store, so that when the Admin
// grid and the Teacher marks-entry page both read/write the SAME
// student+semester+subject, a Save on one is visible on the other
// within this session. This is the piece that stands in for the
// database until the Marks backend endpoint exists (see the
// bulk-update comment near the Save button below).
const marksStore = {};
function marksKey(studentId, semesterIndex, subjectIndex) {
  return `${studentId}_${semesterIndex}_${subjectIndex}`;
}
function getStoredMarks(studentId, semesterIndex, subjectIndex) {
  const key = marksKey(studentId, semesterIndex, subjectIndex);
  if (!marksStore[key]) {
    // Never populate mark fields with invented data. Django is the source
    // of truth and teachers/admins enter marks through their own workflow.
    marksStore[key] = { result: "", lab: "", assignment: "", attendance: "", overall: "", boardMark: "" };
  }
  return marksStore[key];
}
function commitMarks(studentId, semesterIndex, subjectIndex, updatedFields) {
  const key = marksKey(studentId, semesterIndex, subjectIndex);
  marksStore[key] = { ...getStoredMarks(studentId, semesterIndex, subjectIndex), ...updatedFields };
}

function loadSemesterDetails() {
  const semesterIndex = Number(document.getElementById("detail-semester-select").value);
  currentSemesterIndex = semesterIndex;
  const subjects = getSubjectsForSemester(semesterIndex);

  document.getElementById("semester-marks-title").textContent = `${semesterNames[semesterIndex - 1]} details`;
  document.getElementById("semester-marks-search").value = "";
  document.getElementById("semester-search-count").textContent = "";

  buildMarksTableHead(subjects);
  buildMarksTableBody(allStudentsCache, subjects, "");
}

function calcTotalAverage(row) {
  // "Total average" = mean of the 5 continuously-tracked fields,
  // kept separate from Board Mark (which is an admin-only,
  // end-of-semester entry, not part of the running average).
  const vals = [row.result, row.lab, row.assignment, row.attendance, row.overall];
  const sum = vals.reduce((a, b) => a + Number(b || 0), 0);
  return (sum / vals.length).toFixed(1);
}

function buildMarksTableHead(subjects) {
  const thead = document.getElementById("marks-table-head");
  const topRow = document.createElement("tr");
  topRow.innerHTML = `<th rowspan="2">ID</th><th rowspan="2">Student Name</th>`;
  subjects.forEach((subject) => {
    const th = document.createElement("th");
    th.colSpan = markFields.length + 1; // +1 for Total Average
    th.textContent = subject;
    topRow.appendChild(th);
  });
  thead.innerHTML = "";
  thead.appendChild(topRow);

  const subRow = document.createElement("tr");
  subjects.forEach(() => {
    markFields.forEach((f) => {
      const th = document.createElement("th");
      th.textContent = f.label;
      subRow.appendChild(th);
    });
    const th = document.createElement("th");
    th.textContent = "Total Avg";
    subRow.appendChild(th);
  });
  thead.appendChild(subRow);
}

function buildMarksTableBody(students, subjects, query) {
  const tbody = document.getElementById("marks-table-body");
  tbody.innerHTML = "";

  if (students.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${2 + subjects.length * (markFields.length + 1)}" style="text-align:center; padding:20px; color:#98a3b5;">No students found.</td>`;
    tbody.appendChild(tr);
    return;
  }

  students.forEach((student) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${student.registration_number}</td>
      <td class="student-name-cell">${highlightMatch(student.full_name, query)}</td>
    `;

    subjects.forEach((subject, subjectIndex) => {
      const row = getStoredMarks(student.id, currentSemesterIndex, subjectIndex);

      markFields.forEach((f) => {
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.type = "number";
        input.className = "mark-input" + (f.key === "boardMark" ? " board-mark" : "");
        input.value = row[f.key];
        input.min = 0;
        input.max = 100;
        input.dataset.studentId = student.id;
        input.dataset.subjectIndex = subjectIndex;
        input.dataset.field = f.key;
        input.addEventListener("input", () => updateTotalAverage(tr, student.id, subjectIndex));
        td.appendChild(input);
        tr.appendChild(td);
      });

      const totalTd = document.createElement("td");
      totalTd.className = "total-avg-cell";
      totalTd.dataset.totalFor = `${student.id}-${subjectIndex}`;
      totalTd.textContent = calcTotalAverage(row);
      tr.appendChild(totalTd);
    });

    tbody.appendChild(tr);
  });
}

function updateTotalAverage(tr, studentId, subjectIndex) {
  const getVal = (field) =>
    tr.querySelector(`input[data-student-id="${studentId}"][data-subject-index="${subjectIndex}"][data-field="${field}"]`).value;

  const row = {
    result: getVal("result"),
    lab: getVal("lab"),
    assignment: getVal("assignment"),
    attendance: getVal("attendance"),
    overall: getVal("overall"),
  };
  const totalCell = tr.querySelector(`[data-total-for="${studentId}-${subjectIndex}"]`);
  totalCell.textContent = calcTotalAverage(row);
}



function collectAllMarks() {
  const rows = document.querySelectorAll("#marks-table-body input.mark-input");
  const payload = [];
  rows.forEach((input) => {
    payload.push({
      studentId: input.dataset.studentId,
      subjectIndex: input.dataset.subjectIndex,
      field: input.dataset.field,
      value: input.value,
    });
  });
  return payload;
}

/* ==========================================================
   SEMESTER-WISE DASHBOARD (whole-class analytics, not
   per-student). Aggregates the same mock marks data used by
   the Semester-wise Details grid, so the two screens agree.
   ========================================================== */

// A per-student average across every subject in the chosen
// semester, for each of the 5 tracked categories.
function computeStudentAverages(studentId, semesterIndex) {
  const subjects = getSubjectsForSemester(semesterIndex);
  const totals = { result: 0, lab: 0, assignment: 0, attendance: 0, overall: 0 };

  subjects.forEach((_, subjectIndex) => {
    const row = getStoredMarks(studentId, semesterIndex, subjectIndex);
    totals.result += Number(row.result);
    totals.lab += Number(row.lab);
    totals.assignment += Number(row.assignment);
    totals.attendance += Number(row.attendance);
    totals.overall += Number(row.overall);
  });

  const n = subjects.length;
  return {
    result: totals.result / n,
    lab: totals.lab / n,
    assignment: totals.assignment / n,
    attendance: totals.attendance / n,
    overall: totals.overall / n,
  };
}

function getStudentsForBatch(batch) {
  if (batch === "all") return allStudentsCache;
  return allStudentsCache.filter((s) => s.batch === batch);
}

function renderDashboardSummaryTable(students, semesterIndex) {
  const tbody = document.getElementById("dashboard-summary-body");
  tbody.innerHTML = "";

  if (students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#98a3b5;">No students in this batch.</td></tr>`;
    return;
  }

  students.forEach((student) => {
    const avg = computeStudentAverages(student.id, semesterIndex);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="student-id-cell">${student.registration_number}</td>
      <td class="student-name-cell">${student.full_name}</td>
      <td>${avg.attendance.toFixed(0)}%</td>
      <td>${avg.assignment.toFixed(0)}%</td>
      <td>${avg.lab.toFixed(0)}%</td>
      <td>${avg.overall.toFixed(0)}%</td>
      <td>${avg.result.toFixed(0)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderConicPie(elementId, segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let cumulative = 0;
  const parts = segments.map((s) => {
    const start = (cumulative / total) * 360;
    cumulative += s.value;
    const end = (cumulative / total) * 360;
    return `${s.color} ${start}deg ${end}deg`;
  });
  const el = document.getElementById(elementId);
  el.style.background = `conic-gradient(${parts.join(", ")})`;
}

function renderDashboardCharts(students, semesterIndex) {
  if (students.length === 0) {
    renderConicPie("attendance-pie", [{ value: 1, color: "#e2e6ee" }]);
    renderConicPie("breakdown-pie", [{ value: 1, color: "#e2e6ee" }]);
    return;
  }

  const averages = students.map((s) => computeStudentAverages(s.id, semesterIndex));
  const classAvg = (key) => averages.reduce((sum, a) => sum + a[key], 0) / averages.length;

  const attendanceAvg = classAvg("attendance");
  renderConicPie("attendance-pie", [
    { value: attendanceAvg, color: C_GOOD },
    { value: 100 - attendanceAvg, color: C_BAD },
  ]);

  renderConicPie("breakdown-pie", [
    { value: classAvg("attendance"), color: "#4f8fff" },
    { value: classAvg("assignment"), color: "#4ed08a" },
    { value: classAvg("lab"), color: "#f0a84e" },
    { value: classAvg("result"), color: "#b076f0" },
    { value: classAvg("overall"), color: "#f0664e" },
  ]);

  document.getElementById("dashboard-legend").innerHTML = `
    <li><span class="swatch swatch-attendance"></span> Attendance (${attendanceAvg.toFixed(0)}%)</li>
    <li><span class="swatch swatch-assignments"></span> Assignments (${classAvg("assignment").toFixed(0)}%)</li>
    <li><span class="swatch swatch-lab"></span> Lab (${classAvg("lab").toFixed(0)}%)</li>
    <li><span class="swatch swatch-result"></span> Result (${classAvg("result").toFixed(0)}%)</li>
    <li><span class="swatch swatch-overall"></span> Overall activities (${classAvg("overall").toFixed(0)}%)</li>
  `;
}

const C_GOOD = "#4ed08a";
const C_BAD = "#f0664e";
const adminDashboardCharts = {};

function renderAdminDashboardChart(containerId, type, labels, values, colors) {
  const container = document.getElementById(containerId);
  if (typeof Chart === "undefined") {
    container.textContent = "Chart library could not load. Check your internet connection and refresh.";
    return;
  }
  if (typeof Chart === "undefined") {
    container.textContent = "Chart library could not load. Check your internet connection and refresh.";
    return;
  }
  adminDashboardCharts[containerId]?.destroy();
  container.replaceChildren();
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  adminDashboardCharts[containerId] = new Chart(canvas, {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, borderRadius: type === "bar" ? 6 : 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === "doughnut", position: "bottom" }, tooltip: { callbacks: { label: (context) => { const value = type === "bar" ? context.parsed.y : context.parsed; return `${context.label}: ${Number(value || 0).toFixed(1)}%`; } } } }, scales: type === "bar" ? { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } } } : {} },
  });
}

// Mock "previous semester" average, just for the comparison line.
// Real version: same aggregation, run against semesterIndex - 1.
const mockPreviousSemesterAvg = 71;

function renderAnalysisPanel(students, semesterIndex) {
  const grid = document.getElementById("analysis-grid");

  if (students.length === 0) {
    grid.innerHTML = `<div class="analysis-card">No students to analyze for this batch.</div>`;
    return;
  }

  const averages = students.map((s) => ({
    student: s,
    avg: computeStudentAverages(s.id, semesterIndex),
  }));

  const classResultAvg =
    averages.reduce((sum, a) => sum + a.avg.result, 0) / averages.length;

  const dangerZone = averages.filter((a) => a.avg.result < 45 || a.avg.attendance < 60);
  const lowAttendance = averages.filter((a) => a.avg.attendance < 75);

  const comparisonGood = classResultAvg >= mockPreviousSemesterAvg;

  grid.innerHTML = `
    <div class="analysis-card ${comparisonGood ? "good" : "warn"}">
      <h4>Compared to last semester</h4>
      This semester's average result is <strong>${classResultAvg.toFixed(1)}%</strong>,
      ${comparisonGood ? "up from" : "down from"} <strong>${mockPreviousSemesterAvg}%</strong> last semester.
    </div>

    <div class="analysis-card ${dangerZone.length ? "bad" : "good"}">
      <h4>Danger zone (${dangerZone.length})</h4>
      ${
        dangerZone.length
          ? `<ul>${dangerZone.map((a) => `<li>${a.student.full_name} — result ${a.avg.result.toFixed(0)}%, attendance ${a.avg.attendance.toFixed(0)}%</li>`).join("")}</ul>`
          : "No students currently at risk."
      }
    </div>

    <div class="analysis-card ${lowAttendance.length ? "warn" : "good"}">
      <h4>Low attendance (below 75%) — ${lowAttendance.length}</h4>
      ${
        lowAttendance.length
          ? `<ul>${lowAttendance.map((a) => `<li>${a.student.full_name} — ${a.avg.attendance.toFixed(0)}%</li>`).join("")}</ul>`
          : "Everyone is meeting the attendance requirement."
      }
    </div>
  `;
}

function loadSemesterDashboard() {
  const semesterIndex = Number(document.getElementById("dash-semester-select").value);
  const batch = document.getElementById("dash-batch-select").value;
  const students = getStudentsForBatch(batch);

  document.getElementById("dashboard-semester-title").textContent =
    `${semesterNames[semesterIndex - 1]} details`;

  renderDashboardSummaryTable(students, semesterIndex);
  renderDashboardCharts(students, semesterIndex);
  renderAnalysisPanel(students, semesterIndex);
}

/* ==========================================================
   ATTENDANCE MONITORING
   Present/Absent per student, per semester, per date.

   Key design point: attendance state lives in a plain JS object
   (currentAttendanceState), NOT just whatever checkboxes happen
   to be in the DOM right now. That way, if the admin searches
   for one student, unchecks them, and hits Save, everyone else's
   attendance (currently hidden by the search filter) is still
   included correctly — nothing gets silently wiped out.
   ========================================================== */

// Mock persistence across date/semester switches, keyed by
// "semesterIndex_date". Real version: GET/POST /api/admin/attendance/
const mockAttendanceStore = {};

let currentAttendanceState = {}; // { studentId: true/false }
let currentAttendanceKey = null;
let adminAttendanceRecords = [];

function localTodayIso() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function attendanceKey(semesterIndex, date) {
  return `${semesterIndex}_${date}`;
}

function initAttendanceState(students, semesterIndex, date) {
  const key = attendanceKey(semesterIndex, date);
  currentAttendanceKey = key;

  if (mockAttendanceStore[key]) {
    // Reuse whatever was saved before for this exact semester+date
    currentAttendanceState = { ...mockAttendanceStore[key] };
  } else {
    // New session for this date: default everyone to Present,
    // matching common attendance-taking convention (mark absentees).
    currentAttendanceState = {};
    students.forEach((s) => {
      currentAttendanceState[s.id] = true;
    });
  }
}

function renderAttendanceRows(students, query) {
  const tbody = document.getElementById("attendance-table-body");
  tbody.innerHTML = "";

  if (students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#98a3b5;">No students found.</td></tr>`;
    return;
  }

  students.forEach((student) => {
    const tr = document.createElement("tr");
    const isPresent = currentAttendanceState[student.id] !== false;

    tr.innerHTML = `
      <td>${student.registration_number}</td>
      <td>${highlightMatch(student.full_name, query)}</td>
      <td></td>
    `;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isPresent;
    checkbox.dataset.studentId = student.id;
    checkbox.addEventListener("change", () => {
      currentAttendanceState[student.id] = checkbox.checked;
      updateAttendanceSummary();
      syncSelectAllCheckbox();
    });

    tr.children[2].appendChild(checkbox);
    tbody.appendChild(tr);
  });
}

function updateAttendanceSummary() {
  // Always counts the FULL roster from currentAttendanceState,
  // not just whatever rows the search box is currently showing.
  const total = allStudentsCache.length;
  const presentCount = allStudentsCache.filter(
    (s) => currentAttendanceState[s.id] !== false
  ).length;
  const absentCount = total - presentCount;

  document.getElementById("summary-total").textContent = total;
  document.getElementById("summary-present").textContent = presentCount;
  document.getElementById("summary-absent").textContent = absentCount;
}

function syncSelectAllCheckbox() {
  const allChecked = allStudentsCache.every((s) => currentAttendanceState[s.id] !== false);
  document.getElementById("attendance-select-all").checked = allChecked;
}

function updateAttendanceDayLabel(date) {
  const label = document.getElementById("att-date-day");
  if (!label) return;
  label.textContent = date
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`))
    : "Choose a date";
}

async function loadAttendance() {
  const semesterId = Number(document.getElementById("att-semester-select").value);
  const semester = liveSemesters.find((item) => Number(item.id) === semesterId);
  const academicYear = document.getElementById("att-batch-select").value;
  const date = document.getElementById("att-date-input").value;
  const today = localTodayIso();
  updateAttendanceDayLabel(date);

  document.getElementById("attendance-semester-title").textContent =
    `${semester?.semester_name || "Semester"}${academicYear ? ` — ${academicYear} batch` : ""} Attendance`;
  document.getElementById("attendance-search").value = "";
  document.getElementById("attendance-search-count").textContent = "";
  document.getElementById("attendance-select-all").disabled = true;
  document.getElementById("attendance-select-all").checked = false;
  document.getElementById("btn-save-attendance").disabled = true;

  if (date && date > today) {
    adminAttendanceRecords = [];
    document.getElementById("attendance-table-body").innerHTML = '<tr><td colspan="3">Attendance cannot be recorded for tomorrow or a future date.</td></tr>';
    document.getElementById("summary-total").textContent = "0";
    document.getElementById("summary-present").textContent = "0";
    document.getElementById("summary-absent").textContent = "0";
    document.getElementById("attendance-save-confirmation").textContent = "Choose today or a past date to take attendance.";
    return;
  }

  if (!semesterId || !academicYear) {
    adminAttendanceRecords = [];
    document.getElementById("attendance-table-body").innerHTML = '<tr><td colspan="3">Select a semester and batch to view enrolled students.</td></tr>';
    document.getElementById("summary-total").textContent = "0";
    document.getElementById("summary-present").textContent = "0";
    document.getElementById("summary-absent").textContent = "0";
    document.getElementById("attendance-save-confirmation").textContent = "Read-only: teachers submit attendance for their assigned subjects.";
    return;
  }

  try {
    const data = await apiFetch(`/admin/attendance/roster/?semester_id=${semesterId}&academic_year=${encodeURIComponent(academicYear)}&date=${encodeURIComponent(date)}`);
    adminAttendanceRecords = data.records || [];
    renderAdminAttendanceRows(adminAttendanceRecords, "");
    const hasSubmitted = Number(data.submitted_sessions) > 0;
    const present = adminAttendanceRecords.filter((row) => row.status === "Present").length;
    const absent = hasSubmitted ? adminAttendanceRecords.filter((row) => row.status === "Absent").length : 0;
    document.getElementById("summary-total").textContent = data.total_students || 0;
    document.getElementById("summary-present").textContent = present;
    document.getElementById("summary-absent").textContent = absent;
    document.getElementById("attendance-select-all").disabled = !adminAttendanceRecords.length;
    document.getElementById("btn-save-attendance").disabled = !adminAttendanceRecords.length;
    document.getElementById("attendance-save-confirmation").textContent = hasSubmitted
      ? (data.recorded_by
        ? `Attendance for this semester and date was already taken by ${data.recorded_by}. You can review or correct it, then save.`
        : "Attendance is already saved for this semester and date. You can review or correct it, then save.")
      : "Tick students who are present, then save this whole-class attendance.";
  } catch (err) {
    document.getElementById("attendance-table-body").innerHTML = `<tr><td colspan="3">${err.message}</td></tr>`;
  }
}

function renderAdminAttendanceRows(records, query) {
  const term = query.trim().toLowerCase();
  const rows = records.filter((row) => !term || row.registration_number.toLowerCase().includes(term) || row.full_name.toLowerCase().includes(term));
  const body = document.getElementById("attendance-table-body");
  body.innerHTML = rows.length
    ? rows.map((row) => `<tr><td>${row.registration_number}</td><td>${highlightMatch(row.full_name, query)}</td><td><input type="checkbox" class="admin-attendance-present" data-student-id="${row.student_id}" ${row.status === "Present" ? "checked" : ""} aria-label="${row.full_name} present"></td></tr>`).join("")
    : '<tr><td colspan="3">No enrolled students match this selection.</td></tr>';
  body.querySelectorAll(".admin-attendance-present").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const row = adminAttendanceRecords.find((item) => item.student_id === Number(checkbox.dataset.studentId));
    if (row) row.status = checkbox.checked ? "Present" : "Absent";
    const all = adminAttendanceRecords.length && adminAttendanceRecords.every((item) => item.status !== "Absent");
    document.getElementById("attendance-select-all").checked = all;
    document.getElementById("summary-present").textContent = adminAttendanceRecords.filter((item) => item.status === "Present").length;
    document.getElementById("summary-absent").textContent = adminAttendanceRecords.filter((item) => item.status === "Absent").length;
  }));
  // It always starts clear: ticking it is the explicit action to mark all present.
  document.getElementById("attendance-select-all").checked = false;
}

function refreshAttendanceBatchOptions() {
  const semesterSelect = document.getElementById("att-semester-select");
  const batchSelect = document.getElementById("att-batch-select");
  if (!semesterSelect || !batchSelect) return;
  const semester = liveSemesters.find((item) => Number(item.id) === Number(semesterSelect.value));
  const previous = batchSelect.value;
  const batches = [...new Set(allStudentsCache
    .filter((student) => Number(student.semester_number) === Number(semester?.semester_number) && student.academic_year)
    .map((student) => Number(student.academic_year)))].sort((a, b) => b - a);
  batchSelect.innerHTML = batches.length
    ? batches.map((batch) => `<option value="${batch}">${batch} batch</option>`).join("")
    : '<option value="">No active batch</option>';
  if (batches.includes(Number(previous))) batchSelect.value = previous;
}

document.addEventListener("DOMContentLoaded", () => {
  // Semester-wise Details: reload the grid whenever either select changes
  const detailStreamSelect = document.getElementById("detail-stream-select");
  const detailSemesterSelect = document.getElementById("detail-semester-select");
  if (detailSemesterSelect) {
    detailStreamSelect.addEventListener("change", loadSemesterDetails);
    detailSemesterSelect.addEventListener("change", loadSemesterDetails);
  }

  // Live search on the marks grid (filters student rows, bolds matches)
  const marksSearchInput = document.getElementById("semester-marks-search");
  if (marksSearchInput) {
    marksSearchInput.addEventListener("input", (e) => {
      const query = e.target.value;
      // The live marks workspace replaces the legacy in-memory grid. Keep
      // its search applied even when the periodic data refresh runs.
      if (adminMarksData) {
        renderAdminGroupedMarks();
        return;
      }
      const filtered = filterStudents(allStudentsCache, query);
      const subjects = getSubjectsForSemester(currentSemesterIndex);
      buildMarksTableBody(filtered, subjects, query);
      document.getElementById("semester-search-count").textContent = query
        ? `${filtered.length} result(s)`
        : "";
    });
  }

  // Save button
  const saveBtn = document.getElementById("btn-save-marks");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const payload = collectAllMarks();

      // Commit into the shared in-memory store — this is what makes
      // the Teacher panel see Admin's edits (and vice versa) within
      // this session, before a real backend exists.
      payload.forEach((cell) => {
        commitMarks(cell.studentId, currentSemesterIndex, cell.subjectIndex, { [cell.field]: Number(cell.value) });
      });

      // ----- BACKEND CALL GOES HERE -----
      // await fetch("/api/admin/marks/bulk-update/", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      //   body: JSON.stringify({ semester: currentSemesterIndex, marks: payload }),
      //   credentials: "include",
      // });

      console.log("Saving marks:", payload.length, "cells for semester", currentSemesterIndex);

      const confirmLabel = document.getElementById("save-confirmation");
      confirmLabel.textContent = "Saved ✓";
      confirmLabel.classList.add("show");
      setTimeout(() => confirmLabel.classList.remove("show"), 2000);
    });
  }

  // Semester-wise Dashboard: reload whenever stream/semester/batch changes
  const dashStreamSelect = document.getElementById("dash-stream-select");
  const dashSemesterSelect = document.getElementById("dash-semester-select");
  const dashBatchSelect = document.getElementById("dash-batch-select");
  if (dashSemesterSelect) {
    dashStreamSelect.addEventListener("change", loadSemesterDashboard);
    dashSemesterSelect.addEventListener("change", () => {
      refreshDashboardBatchOptions();
      loadSemesterDashboard();
    });
    dashBatchSelect.addEventListener("change", loadSemesterDashboard);
  }

  // ---- Attendance Monitoring wiring ----
  const attDateInput = document.getElementById("att-date-input");
  if (attDateInput) {
    // Default to today, matching "shows default 1st semester [and today's]
    // details" — admin can then pick any other date to look back.
    const today = localTodayIso();
    attDateInput.value = today;
    attDateInput.max = today;

    const attStreamSelect = document.getElementById("att-stream-select");
    const attSemesterSelect = document.getElementById("att-semester-select");
    const attBatchSelect = document.getElementById("att-batch-select");
    attStreamSelect.addEventListener("change", loadAttendance);
    attSemesterSelect.addEventListener("change", () => {
      refreshAttendanceBatchOptions();
      loadAttendance();
    });
    attBatchSelect.addEventListener("change", loadAttendance);
    attDateInput.addEventListener("change", loadAttendance);

    // Select All / Deselect All — the header checkbox
    document.getElementById("attendance-select-all").addEventListener("change", (e) => {
      const markPresent = e.target.checked;
      if (adminAttendanceRecords.length) {
        adminAttendanceRecords.forEach((row) => { row.status = markPresent ? "Present" : "Absent"; });
        renderAdminAttendanceRows(adminAttendanceRecords, document.getElementById("attendance-search").value);
        document.getElementById("summary-present").textContent = markPresent ? adminAttendanceRecords.length : 0;
        document.getElementById("summary-absent").textContent = markPresent ? 0 : adminAttendanceRecords.length;
        return;
      }
      allStudentsCache.forEach((s) => {
        currentAttendanceState[s.id] = markPresent;
      });
      const query = document.getElementById("attendance-search").value;
      const filtered = filterStudents(allStudentsCache, query);
      renderAttendanceRows(filtered, query);
      updateAttendanceSummary();
    });

    // Live search — filters rows, bolds matches, preserves checkbox state
    document.getElementById("attendance-search").addEventListener("input", (e) => {
      const query = e.target.value;
      const filtered = adminAttendanceRecords.filter((row) => row.registration_number.toLowerCase().includes(query.toLowerCase()) || row.full_name.toLowerCase().includes(query.toLowerCase()));
      renderAdminAttendanceRows(adminAttendanceRecords, query);
      document.getElementById("attendance-search-count").textContent = query
        ? `${filtered.length} result(s)`
        : "";
    });

    // Save — persists this semester+date's attendance into the mock
    // store (and, for real, to the backend) so switching dates and
    // coming back shows the corrected data, exactly as requested:
    // "if someone's attendance is a mistake, admin rechecks and saves,
    // then it's updated from anywhere."
    document.getElementById("btn-save-attendance").addEventListener("click", async () => {
      mockAttendanceStore[currentAttendanceKey] = { ...currentAttendanceState };

      // ----- BACKEND CALL GOES HERE -----
      // await fetch("/api/admin/attendance/bulk-update/", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      //   body: JSON.stringify({
      //     semester: Number(document.getElementById("att-semester-select").value),
      //     date: document.getElementById("att-date-input").value,
      //     attendance: currentAttendanceState, // { studentId: true/false }
      //   }),
      //   credentials: "include",
      // });

      console.log("Saving attendance (mock):", currentAttendanceKey, currentAttendanceState);

      const confirmLabel = document.getElementById("attendance-save-confirmation");
      confirmLabel.textContent = "Saved ✓";
      confirmLabel.classList.add("show");
      setTimeout(() => confirmLabel.classList.remove("show"), 2000);
    });
  }
});

/* Live Admin controls. These deliberately replace the old display-only
   controls above: every write below is sent to Django and then reloaded. */
let liveSemesters = [];
let liveSubjects = [];
let liveTeachers = [];
let liveFaculties = [];

async function loadLiveAdminReferenceData() {
  [liveSemesters, liveSubjects, liveTeachers, liveFaculties] = await Promise.all([
    apiFetch("/admin/semesters/"), apiFetch("/admin/subjects/"), apiFetch("/admin/teachers/"), apiFetch("/admin/faculties/"),
  ]);
  const semesterOptions = liveSemesters.map((s) => `<option value="${s.id}">${s.semester_name}</option>`).join("");
  const studentFilter = document.getElementById("student-semester-filter");
  if (studentFilter) {
    const previous = studentFilter.value;
    studentFilter.innerHTML = '<option value="all">All semesters</option>' + liveSemesters.map((s) => `<option value="${s.semester_number}">${s.semester_name}</option>`).join("");
    if ([...studentFilter.options].some((option) => option.value === previous)) studentFilter.value = previous;
  }
  ["subject-semester-select", "new-student-semester", "detail-semester-select", "dash-semester-select", "att-semester-select"].forEach((id) => {
    const select = document.getElementById(id);
    if (select) {
      const previous = select.value;
      select.innerHTML = semesterOptions;
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    }
  });
  const facultySelect = document.getElementById("new-student-faculty");
  if (facultySelect) facultySelect.innerHTML = liveFaculties.length
    ? liveFaculties.map((faculty) => `<option value="${faculty.faculty_name}">${faculty.faculty_name}</option>`).join("")
    : '<option value="">Create a faculty first</option>';
  refreshAttendanceBatchOptions();
  renderLiveSubjects();
}

function renderLiveSubjects() {
  const semesterId = Number(document.getElementById("subject-semester-select").value);
  const list = document.getElementById("subject-chip-list");
  const rows = liveSubjects.filter((subject) => Number(subject.semester) === semesterId);
  list.innerHTML = rows.length ? rows.map((subject) => `<li class="subject-chip">${subject.subject_code} — ${subject.subject_name}<button type="button" data-edit-subject="${subject.id}" title="Edit subject name">Edit</button><button type="button" data-delete-subject="${subject.id}" title="Delete subject">×</button></li>`).join("") : "<li>No subjects have been added for this semester.</li>";
  list.querySelectorAll("[data-edit-subject]").forEach((button) => button.addEventListener("click", async () => {
    const subject = liveSubjects.find((item) => Number(item.id) === Number(button.dataset.editSubject));
    const subject_name = prompt("New subject name:", subject?.subject_name || "");
    if (!subject_name?.trim() || subject_name.trim() === subject.subject_name) return;
    try {
      await apiFetch(`/admin/subjects/${subject.id}/`, { method: "PATCH", body: { subject_name: subject_name.trim() } });
      await loadLiveAdminReferenceData();
    } catch (error) { alert(error.message); }
  }));
  list.querySelectorAll("[data-delete-subject]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Delete this subject? Teacher assignments using it must be removed first.")) return;
    try { await apiFetch(`/admin/subjects/${button.dataset.deleteSubject}/`, { method: "DELETE" }); await loadLiveAdminReferenceData(); }
    catch (error) { alert(error.message); }
  }));
}

async function liveAddSubject() {
  const input = document.getElementById("new-subject-input");
  const subject_name = input.value.trim();
  if (!subject_name) return;
  const semester = Number(document.getElementById("subject-semester-select").value);
  try {
    await apiFetch("/admin/subjects/", { method: "POST", body: { semester, subject_name, subject_code: `CUS${Date.now().toString().slice(-8)}`, credit_hour: 3 } });
    input.value = "";
    await loadLiveAdminReferenceData();
  } catch (error) { alert(error.message); }
}

async function liveAddStudent() {
  const registration_number = document.getElementById("new-student-regno").value.trim();
  const full_name = document.getElementById("new-student-name").value.trim();
  const guardian_name = document.getElementById("new-student-guardian").value.trim();
  const guardian_phone = document.getElementById("new-student-guardian-phone").value.trim();
  const studentPhone = document.getElementById("new-student-phone").value.trim();
  const guardianPhone = document.getElementById("new-student-guardian-phone").value.trim();
  const phoneError = document.getElementById("new-student-phone-error");
  const guardianPhoneError = document.getElementById("new-student-guardian-phone-error");
  phoneError.textContent = studentPhone && !/^\d{10}$/.test(studentPhone) ? "Student phone must contain exactly 10 digits." : "";
  guardianPhoneError.textContent = guardianPhone && !/^\d{10}$/.test(guardianPhone) ? "Guardian phone must contain exactly 10 digits." : "";
  if (!registration_number || !full_name || !guardian_name || !guardianPhone) return alert("Student, registration number, guardian name, and guardian phone are required.");
  if (phoneError.textContent || guardianPhoneError.textContent) return;
  const sem = liveSemesters.find((item) => item.id === Number(document.getElementById("new-student-semester").value));
  const academic_year = Number(document.getElementById("new-student-batch").value);
  if (!sem || !academic_year) return alert("Choose a semester and enter the student's batch / academic year.");
  const faculty_name = document.getElementById("new-student-faculty").value;
  if (!faculty_name) return alert("Create and select a faculty before adding the student.");
  const payload = {
    registration_number, full_name, guardian_name, guardian_phone,
    guardian_email: document.getElementById("new-student-guardian-email").value.trim(),
    email: document.getElementById("new-student-email").value.trim(),
    semester_number: sem.semester_number, academic_year, faculty_name,
    symbol_number: document.getElementById("new-student-symbol").value.trim() || null,
    gender: document.getElementById("new-student-gender").value,
    date_of_birth: document.getElementById("new-student-dob").value,
    phone: studentPhone,
    address: document.getElementById("new-student-address").value.trim(),
    status: document.getElementById("new-student-status").value,
  };
  if (!payload.date_of_birth || !payload.phone || !payload.address) return alert("Date of birth, phone, and address are required.");
  try {
    const student = await apiFetch("/admin/students/", { method: "POST", body: payload });
    allStudentsCache = await fetchStudentList();
    updateAdminOverviewCards();
    const result = document.getElementById("new-student-result");
    result.innerHTML = `<strong>Student saved successfully.</strong><br>Username: ${student.username || registration_number}<br>Temporary password: <strong>${student.temp_password_plain || "Unavailable"}</strong><br><small>Give this password to the student now. It is permanently removed when they set or reset their password.</small><br><button type="button" class="btn btn-navy student-done-button" id="btn-student-done">Done</button>`;
    result.classList.add("show");
    document.getElementById("manual-student-card").classList.remove("collapsed");
    document.getElementById("btn-add-student").disabled = true;
    document.getElementById("btn-student-done").addEventListener("click", () => {
      // Done is created only after a successful save, so it cannot clear an
      // incomplete or invalid form.
      ["new-student-name", "new-student-regno", "new-student-symbol", "new-student-dob", "new-student-phone", "new-student-address", "new-student-guardian", "new-student-guardian-phone", "new-student-guardian-email", "new-student-email"].forEach((id) => { document.getElementById(id).value = ""; });
      phoneError.textContent = "";
      guardianPhoneError.textContent = "";
      result.replaceChildren();
      result.classList.remove("show");
      document.getElementById("btn-add-student").disabled = false;
      const card = document.getElementById("manual-student-card");
      card.classList.add("collapsed");
      const toggle = card.querySelector(".record-card-toggle");
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = "⌄ <span>Open form</span>";
    });
  } catch (error) {
    const result = document.getElementById("new-student-result");
    result.textContent = `Could not save: ${error.message}`;
    result.classList.add("show");
  }
}

function renderLiveTeacherManagement() {
  const tbody = document.getElementById("teacher-management-body");
  if (!tbody) return;
  tbody.innerHTML = liveTeachers.length ? liveTeachers.map((teacher) => `<tr><td>${teacher.id}</td><td>${teacher.login_id || ""}</td><td>${teacher.username_display || ""}</td><td>${teacher.teacher_name}</td><td>${teacher.email || ""}</td><td>${teacher.phone}</td><td>${teacher.qualification || ""}</td><td>${teacher.joining_date || ""}</td><td>${teacher.status}</td><td>${teacher.first_login ? (teacher.temp_password_plain || "Unavailable") : "Password already changed"}</td></tr>`).join("") : '<tr><td colspan="10">No teachers found.</td></tr>';
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadLiveAdminReferenceData();
    renderLiveTeacherManagement();
    document.getElementById("new-student-batch").value = new Date().getFullYear();
    refreshManualTeacherBatchOptions();
  } catch (error) { console.error(error); }
  document.getElementById("subject-semester-select").addEventListener("change", renderLiveSubjects);
  document.getElementById("btn-add-subject").addEventListener("click", (event) => { event.stopImmediatePropagation(); liveAddSubject(); }, true);
  document.getElementById("btn-add-student").addEventListener("click", (event) => { event.stopImmediatePropagation(); liveAddStudent(); }, true);
  [["new-student-phone", "new-student-phone-error", "Student phone"], ["new-student-guardian-phone", "new-student-guardian-phone-error", "Guardian phone"]].forEach(([inputId, errorId, label]) => {
    document.getElementById(inputId)?.addEventListener("input", (event) => {
      const value = event.target.value.trim();
      document.getElementById(errorId).textContent = value && !/^\d{10}$/.test(value) ? `${label} must contain exactly 10 digits.` : "";
    });
  });
  document.getElementById("btn-import-teachers")?.addEventListener("click", async () => {
    const file = document.getElementById("teacher-csv-file-input").files[0];
    if (!file) return alert("Choose a teacher CSV file first.");
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await fetch(`${API_BASE}/admin/teachers/import/`, { method: "POST", credentials: "include", headers: { "X-CSRFToken": getCsrfToken() }, body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Teacher import failed.");
      document.getElementById("teacher-import-result").textContent = `${result.success} teacher(s) imported; ${result.failed} skipped.`;
      document.getElementById("teacher-import-result").classList.add("show");
      liveTeachers = await apiFetch("/admin/teachers/");
      renderLiveTeacherManagement();
    } catch (error) { alert(error.message); }
  });
  document.getElementById("btn-export-teachers")?.addEventListener("click", () => { window.location.href = `${API_BASE}/admin/teachers/export/`; });
  document.getElementById("btn-add-teacher-manual")?.addEventListener("click", async () => {
    const teacher_name = document.getElementById("manual-teacher-name").value.trim();
    const email = document.getElementById("manual-teacher-email").value.trim();
    const phone = document.getElementById("manual-teacher-phone").value.trim();
    const qualification = document.getElementById("manual-teacher-qualification").value.trim();
    if (!teacher_name || !email || !phone || !qualification) return alert("Teacher name, email, phone, and qualification are required.");
    try {
      const batch = Number(document.getElementById("manual-teacher-batch").value);
      const assignments = [...document.querySelectorAll("#teacher-assignment-rows .assignment-row")].map((row) => ({
        subject: Number(row.querySelector(".assignment-subject-select").value),
        semester: Number(row.querySelector(".assignment-semester-select").value),
      })).filter((assignment) => assignment.subject && assignment.semester);
      if (assignments.length && !batch) return alert("Enter the assignment batch / academic year before assigning this teacher.");
      const teacher = await apiFetch("/admin/teachers/", { method: "POST", body: { teacher_name, email, phone, qualification, gender: document.getElementById("manual-teacher-gender").value, username: document.getElementById("manual-teacher-username").value.trim() || undefined, joining_date: document.getElementById("manual-teacher-joining-date").value || null, status: document.getElementById("manual-teacher-status").value } });
      await Promise.all(assignments.map((assignment) => apiFetch("/admin/teacher-assignments/", { method: "POST", body: { teacher: teacher.id, subject: assignment.subject, semester: assignment.semester, academic_year: batch, status: "Active" } })));
      const result = document.getElementById("manual-teacher-result");
      result.innerHTML = `<strong>Teacher saved.</strong><br>ID: ${teacher.id}; username: ${teacher.username_display || "generated"}; temporary password: <strong>${teacher.temp_password_plain || "Unavailable"}</strong>.<br><small>Give it to the teacher now; it is permanently removed after they set or reset their password.</small><br><button type="button" class="btn btn-navy student-done-button" id="btn-teacher-done">Done</button>`;
      result.classList.add("show");
      document.getElementById("manual-teacher-card").classList.remove("collapsed");
      liveTeachers = await apiFetch("/admin/teachers/");
      renderLiveTeacherManagement();
      document.getElementById("btn-add-teacher-manual").disabled = true;
      document.getElementById("btn-teacher-done").addEventListener("click", () => {
        ["manual-teacher-username", "manual-teacher-name", "manual-teacher-email", "manual-teacher-phone", "manual-teacher-qualification", "manual-teacher-joining-date", "manual-teacher-batch"].forEach((id) => { document.getElementById(id).value = ""; });
        const assignmentRows = document.getElementById("teacher-assignment-rows");
        assignmentRows.replaceChildren(buildAssignmentRow());
        result.replaceChildren();
        result.classList.remove("show");
        document.getElementById("btn-add-teacher-manual").disabled = false;
        const card = document.getElementById("manual-teacher-card");
        card.classList.add("collapsed");
        const toggle = card.querySelector(".record-card-toggle");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = "⌄ <span>Open form</span>";
      });
    } catch (error) { alert(error.message); }
  });
  document.getElementById("btn-add-manual-assignment")?.addEventListener("click", () => {
    document.getElementById("teacher-assignment-rows").appendChild(buildAssignmentRow());
    refreshManualTeacherBatchOptions();
  });
  document.querySelectorAll(".record-card-toggle").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest(".collapsible-record-card");
    const isCollapsed = card.classList.toggle("collapsed");
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.innerHTML = isCollapsed ? "⌄ <span>Open form</span>" : "⌃ <span>Hide details</span>";
  }));
});

/* ==========================================================
   CUSTOMIZE ADMIN
   Four pieces: CSV bulk upload+validation, Assigned Subjects
   manager, Add Student, Add Teacher (with semester+subject
   assignment rows), and Update Student/Teacher.
   ========================================================== */

// ---------- CSV Upload & Smart Validation Engine ----------
const REQUIRED_CSV_COLUMNS = [
  "registration_number", "full_name", "gender", "date_of_birth",
  "phone", "address", "guardian_name", "guardian_phone", "faculty",
  "semester_number", "academic_year",
];
const OPTIONAL_CSV_COLUMNS = ["email", "guardian_email"];
let csvReadyToImport = false;

function setCsvImportReady(ready) {
  csvReadyToImport = ready;
  const button = document.getElementById("btn-confirm-import");
  if (button) button.disabled = !ready;
}

function renderColumnMapping(headers) {
  const container = document.getElementById("csv-column-mapping");
  const fields = [...REQUIRED_CSV_COLUMNS, ...OPTIONAL_CSV_COLUMNS];
  container.innerHTML = `<p class="csv-hint"><strong>Uploaded headings:</strong> ${headers.join(", ")}</p><p class="csv-hint"><strong>Column mapping</strong> — choose the heading in your file for every required SPAAMS field. You may change a mapping at any time.</p>${fields.map((field) => {
    const guessed = headers.find((header) => header.toLowerCase() === field) || "";
    return `<label class="selector-label" style="display:inline-flex;gap:6px;margin:4px 14px 4px 0">${field}${REQUIRED_CSV_COLUMNS.includes(field) ? " *" : ""}
      <select class="csv-map" data-field="${field}"><option value="">${REQUIRED_CSV_COLUMNS.includes(field) ? "Choose column" : "Not included"}</option>${headers.map((header) => `<option value="${header}" ${header === guessed ? "selected" : ""}>${header}</option>`).join("")}</select>
    </label>`;
  }).join("")}`;
  container.querySelectorAll(".csv-map").forEach((select) => select.addEventListener("change", () => {
    setCsvImportReady(false);
    document.getElementById("csv-preview-area").innerHTML = '<p class="csv-summary">Mapping changed. Click <strong>Check CSV</strong> again.</p>';
  }));
}

function getColumnMapping() {
  return Object.fromEntries([...document.querySelectorAll(".csv-map")]
    .filter((select) => select.value)
    .map((select) => [select.dataset.field.trim(), select.value.replace(/^\uFEFF/, "").trim().replace(/^['"]|['"]$/g, "")]));
}

// Simple CSV parser: fine for plain comma-separated files without
// quoted commas. The real "smart validation engine" (per your
// wording) belongs on the backend using pandas — it can handle
// messy CSVs, encoding issues, and cross-check against the live
// database far better than anything client-side. This client-side
// version exists so the admin gets INSTANT feedback before the
// file is even sent to the server.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

function validateCsvRows(headers, rows) {
  const missingColumns = REQUIRED_CSV_COLUMNS.filter((c) => !headers.includes(c));
  const existingRegNos = new Set(allStudentsCache.map((s) => s.registration_number));
  const seenInBatch = new Set();

  const validated = rows.map((row) => {
    const errors = [];
    REQUIRED_CSV_COLUMNS.forEach((col) => {
      if (!row[col]) errors.push(`missing ${col}`);
    });
    if (row.registration_number) {
      if (existingRegNos.has(row.registration_number)) errors.push("duplicate registration number (already in DB)");
      if (seenInBatch.has(row.registration_number)) errors.push("duplicate within this CSV");
      seenInBatch.add(row.registration_number);
    }
    return { row, errors };
  });

  return { missingColumns, validated };
}

function renderCsvPreview(missingColumns, validated) {
  const area = document.getElementById("csv-preview-area");

  if (missingColumns.length > 0) {
    area.innerHTML = `<p class="csv-summary"><span class="err-count">Missing required column(s): ${missingColumns.join(", ")}</span></p>`;
    return;
  }

  const okCount = validated.filter((v) => v.errors.length === 0).length;
  const errCount = validated.length - okCount;

  const rowsHtml = validated
    .map(
      ({ row, errors }) => `
      <tr class="${errors.length ? "row-error" : "row-ok"}">
        <td>${row.registration_number || "—"}</td>
        <td>${row.full_name || "—"}</td>
        <td>${row.semester || "—"}</td>
        <td>${errors.length ? errors.join("; ") : "OK"}</td>
      </tr>`
    )
    .join("");

  area.innerHTML = `
    <table class="csv-preview-table">
      <thead><tr><th>Reg. No.</th><th>Full Name</th><th>Semester</th><th>Status</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p class="csv-summary">
      <span class="ok-count">${okCount} row(s) valid and imported</span>
      &nbsp;|&nbsp;
      <span class="err-count">${errCount} row(s) skipped due to errors</span>
    </p>
  `;
}

function importValidCsvRows(validated) {
  let nextId = Math.max(0, ...allStudentsCache.map((s) => s.id)) + 1;

  validated.forEach(({ row, errors }) => {
    if (errors.length > 0) return; // skip invalid rows

    // ----- BACKEND CALL GOES HERE -----
    // Real version: this whole import goes through the Django
    // StudentSerializer.create() you already have, one POST per
    // row (or a dedicated bulk-import endpoint using pandas to
    // read the CSV directly). It already auto-generates the
    // username + temporary password + first_login=True, exactly
    // like the mock version below.
    allStudentsCache.push({
      id: nextId++,
      registration_number: row.registration_number,
      symbol_number: "",
      full_name: row.full_name,
      address: row.address,
      contact_no: row.phone,
      email: "",
      faculty: "BCA",
      semester: `${semesterNames[Number(row.semester) - 1] || row.semester}`,
      gpa: 0,
      rank: 0,
      batch: String(new Date().getFullYear()), status: "Active",
    });
  });
}

async function handleValidateImport() {
  const fileInput = document.getElementById("csv-file-input");
  const file = fileInput.files[0];
  if (!file) {
    document.getElementById("csv-preview-area").innerHTML =
      `<p class="csv-summary"><span class="err-count">Choose a CSV file first.</span></p>`;
    return;
  }

  const mappingArea = document.getElementById("csv-column-mapping");
  if (!mappingArea.children.length) {
    document.getElementById("csv-preview-area").innerHTML = `<p class="csv-summary"><span class="err-count">Choose the file again so SPAAMS can read and display its headings.</span></p>`;
    return;
  }
  const mapping = getColumnMapping();
  const unmapped = REQUIRED_CSV_COLUMNS.filter((field) => !mapping[field]);
  if (unmapped.length) {
    document.getElementById("csv-preview-area").innerHTML = `<p class="csv-summary"><span class="err-count">Map these required fields: ${unmapped.join(", ")}</span></p>`;
    return;
  }

  const area = document.getElementById("csv-preview-area");
  setCsvImportReady(false);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("field_mapping", JSON.stringify(mapping));
  try {
    const response = await fetch(`${API_BASE}/admin/students/import/preview/`, { method: "POST", credentials: "include", headers: { "X-CSRFToken": getCsrfToken() }, body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Validation failed.");
    if (!result.valid) {
      area.innerHTML = `<p class="csv-summary"><span class="err-count">CSV cannot be imported yet. Fix the items below.</span></p><ul>${result.errors.map((item) => `<li>${item.row ? `Row ${item.row}` : "Column mapping"}: ${item.message}</li>`).join("")}</ul>`;
      return;
    }
    const existingNote = result.already_imported ? `<br><span class="csv-hint">${result.already_imported} existing student record(s) will be skipped; only missing students will be imported.</span>` : "";
    area.innerHTML = `<p class="csv-summary"><span class="ok-count">✓ ${result.total_rows} row(s) passed validation. The file is ready to import.</span>${existingNote}</p>`;
    setCsvImportReady(true);
  } catch (err) { area.innerHTML = `<p class="csv-summary"><span class="err-count">${err.message}</span></p>`; }
}

async function confirmCsvImport() {
  const file = document.getElementById("csv-file-input").files[0];
  if (!file || !csvReadyToImport) return;
  const area = document.getElementById("csv-preview-area");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("field_mapping", JSON.stringify(getColumnMapping()));
  try {
    const response = await fetch(`${API_BASE}/admin/students/import/`, { method: "POST", credentials: "include", headers: { "X-CSRFToken": getCsrfToken() }, body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Import failed.");
    const skippedNote = result.skipped ? ` ${result.skipped} existing record(s) were skipped.` : "";
    const failedNote = result.failed ? ` ${result.failed} row(s) could not be imported.` : "";
    area.innerHTML = `<p class="csv-summary"><span class="ok-count">✓ Successfully imported ${result.success} student record(s).</span>${skippedNote}${failedNote}</p>`;
    setCsvImportReady(false);
    allStudentsCache = await fetchStudentList();
  } catch (err) {
    area.innerHTML = `<p class="csv-summary"><span class="err-count">${err.message}</span></p>`;
    setCsvImportReady(false);
  }
}

// ---------- Assigned Subjects (feeds getSubjectsForSemester) ----------
function ensureSubjectsMaterialized(semesterIndex) {
  // getSubjectsForSemester() falls back to generated placeholder
  // names for semesters not yet in mockSubjectsBySemester. The
  // first time an admin touches a semester here, we "materialize"
  // that fallback into a real, editable array.
  if (!mockSubjectsBySemester[semesterIndex]) {
    mockSubjectsBySemester[semesterIndex] = [...getSubjectsForSemester(semesterIndex)];
  }
  return mockSubjectsBySemester[semesterIndex];
}

function renderSubjectChips() {
  const semesterIndex = Number(document.getElementById("subject-semester-select").value);
  const subjects = ensureSubjectsMaterialized(semesterIndex);
  const list = document.getElementById("subject-chip-list");

  list.innerHTML = "";
  subjects.forEach((name, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${name}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.title = "Remove subject";
    removeBtn.addEventListener("click", () => {
      subjects.splice(i, 1);
      renderSubjectChips();
      refreshAllAssignmentRowSubjectOptions();
    });
    li.appendChild(removeBtn);
    list.appendChild(li);
  });

  refreshAssignmentSemesterOptionsFromSubjectPanel();
}

function addSubjectFromInput() {
  const semesterIndex = Number(document.getElementById("subject-semester-select").value);
  const input = document.getElementById("new-subject-input");
  const name = input.value.trim();
  if (!name) return;

  const subjects = ensureSubjectsMaterialized(semesterIndex);
  subjects.push(name);
  input.value = "";
  renderSubjectChips();
  refreshAllAssignmentRowSubjectOptions();
}

// The Add Teacher assignment rows need to reflect whatever subjects
// currently exist — call this after any subject add/remove so a
// teacher can immediately be assigned to a brand-new subject.
function refreshAllAssignmentRowSubjectOptions() {
  document.querySelectorAll(".assignment-row").forEach((row) => {
    const semesterSelect = row.querySelector(".assignment-semester-select");
    updateAssignmentSubjectOptions(row, Number(semesterSelect.value));
  });
}
function refreshAssignmentSemesterOptionsFromSubjectPanel() {
  // no-op placeholder kept for symmetry / future use if semester
  // lists themselves ever become dynamic too
}

// ---------- Add Student ----------
function handleAddStudent() {
  const name = document.getElementById("new-student-name").value.trim();
  const regNo = document.getElementById("new-student-regno").value.trim();

  if (!name || !regNo) {
    alert("Full Name and Registration Number are required.");
    return;
  }
  if (allStudentsCache.some((s) => s.registration_number === regNo)) {
    alert("A student with this registration number already exists.");
    return;
  }

  const semesterIndex = Number(document.getElementById("new-student-semester").value);
  const nextId = Math.max(0, ...allStudentsCache.map((s) => s.id)) + 1;

  // ----- BACKEND CALL GOES HERE -----
  // Real version: POST /api/admin/students/ — your Django
  // StudentSerializer.create() already does exactly this:
  // creates the login with username=registration_number and a
  // temporary password, sets first_login=True.
  const tempPassword = `${regNo}@123`;
  allStudentsCache.push({
    id: nextId,
    registration_number: regNo,
    symbol_number: document.getElementById("new-student-symbol").value.trim(),
    full_name: name,
    address: document.getElementById("new-student-address").value.trim(),
    contact_no: document.getElementById("new-student-phone").value.trim(),
    email: "",
    faculty: "BCA",
    semester: semesterNames[semesterIndex - 1],
    gpa: 0,
    rank: 0,
    batch: String(new Date().getFullYear()), status: "Active",
  });

  const resultBox = document.getElementById("new-student-result");
  resultBox.innerHTML = `<strong>Student created.</strong><br>Username: ${regNo}<br>Temporary password: ${tempPassword}<br>(forced to change password on first login)`;
  resultBox.classList.add("show");

  ["new-student-name", "new-student-regno", "new-student-symbol", "new-student-phone", "new-student-address", "new-student-guardian"]
    .forEach((id) => { document.getElementById(id).value = ""; });
}

// ---------- Add Teacher (with repeatable semester+subject rows) ----------
let teacherIdCounter = 101;
const mockTeachers = [
  { id: 1, teacherId: "T100", full_name: "Ram Bahadur", phone: "9800011111", qualification: "M.Sc. CS", assignments: [{ semester: 5, subject: "Database" }], status: "Active" },
];

function buildAssignmentRow() {
  const row = document.createElement("div");
  row.className = "assignment-row";
  row.innerHTML = `
    <select class="assignment-semester-select">
      ${semesterNames.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("")}
    </select>
    <select class="assignment-subject-select"></select>
  `;
  const semesterSelect = row.querySelector(".assignment-semester-select");
  semesterSelect.addEventListener("change", () => {
    updateAssignmentSubjectOptions(row, Number(semesterSelect.value));
  });
  updateAssignmentSubjectOptions(row, 1);
  return row;
}

function updateAssignmentSubjectOptions(row, semesterIndex) {
  const subjectSelect = row.querySelector(".assignment-subject-select");
  const subjects = getSubjectsForSemester(semesterIndex);
  subjectSelect.innerHTML = subjects.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function handleAddTeacher() {
  const name = document.getElementById("new-teacher-name").value.trim();
  if (!name) {
    alert("Teacher name is required.");
    return;
  }

  const assignments = [];
  document.querySelectorAll("#teacher-assignment-rows .assignment-row").forEach((row) => {
    assignments.push({
      semester: Number(row.querySelector(".assignment-semester-select").value),
      subject: row.querySelector(".assignment-subject-select").value,
    });
  });

  const teacherId = `T${teacherIdCounter++}`;
  const username = name.split(" ")[0].toLowerCase();
  const tempPassword = "Teacher@123";

  // ----- BACKEND CALL GOES HERE -----
  // Real version: POST /api/admin/teachers/, then one POST per
  // assignment row to /api/admin/teacher-assignments/ (a small
  // endpoint using your existing TeacherAssignment model — each
  // row here maps to one row in that table).
  mockTeachers.push({
    id: mockTeachers.length + 1,
    teacherId,
    full_name: name,
    phone: document.getElementById("new-teacher-phone").value.trim(),
    qualification: document.getElementById("new-teacher-qualification").value.trim(),
    assignments,
    status: "Active",
  });

  document.getElementById("teacher-id-preview").textContent = `Teacher ID: ${teacherId}`;
  const resultBox = document.getElementById("new-teacher-result");
  const assignmentSummary = assignments.map((a) => `${semesterNames[a.semester - 1]} – ${a.subject}`).join(", ");
  resultBox.innerHTML = `<strong>Teacher created.</strong><br>Teacher ID: ${teacherId}<br>Username: ${username}<br>Temporary password: ${tempPassword}<br>Assigned: ${assignmentSummary}`;
  resultBox.classList.add("show");

  ["new-teacher-name", "new-teacher-phone", "new-teacher-qualification"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  const rowsContainer = document.getElementById("teacher-assignment-rows");
  rowsContainer.innerHTML = "";
  rowsContainer.appendChild(buildAssignmentRow());
}

// ---------- Update Student / Teacher ----------
function renderUpdateResults(query) {
  const role = document.querySelector('input[name="update-role"]:checked').value;
  const list = document.getElementById("update-results");
  list.innerHTML = "";
  document.getElementById("update-form-area").innerHTML = "";

  if (!query.trim()) return;

  const q = query.toLowerCase();
  const source = role === "student" ? allStudentsCache : mockTeachers;
  const matches = source.filter((p) =>
    p.full_name.toLowerCase().includes(q) ||
    (role === "student" && p.registration_number.toLowerCase().includes(q)) ||
    (role === "teacher" && p.teacherId.toLowerCase().includes(q))
  );

  matches.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = highlightMatch(
      role === "student" ? `${p.registration_number} — ${p.full_name}` : `${p.teacherId} — ${p.full_name}`,
      query
    );
    li.addEventListener("click", () => renderUpdateForm(role, p));
    list.appendChild(li);
  });

  if (matches.length === 0) {
    list.innerHTML = `<li style="cursor:default;">No matches.</li>`;
  }
}

function renderUpdateForm(role, person) {
  const area = document.getElementById("update-form-area");

  if (role === "student") {
    area.innerHTML = `
      <input type="text" id="edit-full-name" value="${person.full_name}" placeholder="Full Name" />
      <input type="text" id="edit-phone" value="${person.contact_no}" placeholder="Phone" />
      <input type="text" id="edit-address" value="${person.address}" placeholder="Address" />
      <button class="btn btn-navy" id="btn-save-update">Save</button>
      <span id="update-confirmation" class="save-confirmation"></span>
    `;
    document.getElementById("btn-save-update").addEventListener("click", () => {
      person.full_name = document.getElementById("edit-full-name").value.trim();
      person.contact_no = document.getElementById("edit-phone").value.trim();
      person.address = document.getElementById("edit-address").value.trim();
      showUpdateConfirmation();
    });
  } else {
    area.innerHTML = `
      <input type="text" id="edit-full-name" value="${person.full_name}" placeholder="Full Name" />
      <input type="text" id="edit-phone" value="${person.phone}" placeholder="Phone" />
      <input type="text" id="edit-qualification" value="${person.qualification}" placeholder="Qualification" />
      <button class="btn btn-navy" id="btn-save-update">Save</button>
      <span id="update-confirmation" class="save-confirmation"></span>
    `;
    document.getElementById("btn-save-update").addEventListener("click", () => {
      person.full_name = document.getElementById("edit-full-name").value.trim();
      person.phone = document.getElementById("edit-phone").value.trim();
      person.qualification = document.getElementById("edit-qualification").value.trim();
      showUpdateConfirmation();
    });
  }
}

function showUpdateConfirmation() {
  // ----- BACKEND CALL GOES HERE -----
  // Real version: PUT /api/admin/students/<id>/ or
  // PUT /api/admin/teachers/<id>/ with the edited fields.
  const label = document.getElementById("update-confirmation");
  label.textContent = "Saved ✓";
  label.classList.add("show");
  setTimeout(() => label.classList.remove("show"), 2000);
}

// ---------- init + wiring ----------
function initCustomizeAdmin() {
  document.getElementById("csv-file-input").value = "";
  document.getElementById("csv-preview-area").innerHTML = "";

  renderSubjectChips();

  document.getElementById("new-student-result").classList.remove("show");
  document.getElementById("new-teacher-result").classList.remove("show");
  document.getElementById("teacher-id-preview").textContent = "Teacher ID: (generated after save)";

  const rowsContainer = document.getElementById("teacher-assignment-rows");
  rowsContainer.innerHTML = "";
  rowsContainer.appendChild(buildAssignmentRow());

  document.getElementById("update-search").value = "";
  document.getElementById("update-results").innerHTML = "";
  document.getElementById("update-form-area").innerHTML = "";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("csv-file-input").addEventListener("change", async (event) => {
    document.getElementById("csv-column-mapping").innerHTML = "";
    setCsvImportReady(false);
    const file = event.target.files[0];
    if (!file) {
      document.getElementById("csv-preview-area").innerHTML = "";
      return;
    }
    const headerLine = (await file.text()).split(/\r?\n/, 1)[0];
    const headers = headerLine.split(",").map((header) => header.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (!headers.length) {
      document.getElementById("csv-preview-area").innerHTML = '<p class="csv-summary"><span class="err-count">The CSV has no header row.</span></p>';
      return;
    }
    renderColumnMapping(headers);
    document.getElementById("csv-preview-area").innerHTML = '<p class="csv-summary">Headings loaded. Review or edit the mapping, then click <strong>Check CSV</strong>.</p>';
  });
  document.getElementById("btn-validate-import").addEventListener("click", handleValidateImport);
  document.getElementById("btn-confirm-import").addEventListener("click", confirmCsvImport);
  document.getElementById("btn-export-students").addEventListener("click", () => {
    const semester = document.getElementById("subject-semester-select").value;
    window.location.href = `${API_BASE}/admin/students/export/?semester_id=${encodeURIComponent(semester)}`;
  });

  document.getElementById("subject-semester-select").addEventListener("change", renderSubjectChips);
  document.getElementById("btn-add-subject").addEventListener("click", addSubjectFromInput);
  document.getElementById("new-subject-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addSubjectFromInput();
  });

  document.getElementById("btn-add-student").addEventListener("click", handleAddStudent);

  document.getElementById("btn-add-assignment-row")?.addEventListener("click", () => {
    document.getElementById("teacher-assignment-rows").appendChild(buildAssignmentRow());
  });
  document.getElementById("btn-add-teacher")?.addEventListener("click", handleAddTeacher);

  document.querySelectorAll('input[name="update-role"]').forEach((radio) => {
    radio.addEventListener("change", () => renderUpdateResults(document.getElementById("update-search").value));
  });
  document.getElementById("update-search").addEventListener("input", (e) => {
    renderUpdateResults(e.target.value);
  });
});

/* ==========================================================
   SETTING PAGE
   Teacher Management, Enable/Disable (with reciprocal ID<->Name
   autofill), Upgrade Semester (password-gated, 3-month cooldown),
   Data Storage Management search, and Logout.
   ========================================================== */

// ---------- Teacher Management ----------
function renderTeacherManagementTable() {
  const tbody = document.getElementById("teacher-management-body");
  tbody.innerHTML = "";

  mockTeachers.forEach((t) => {
    const semestersTaught = [...new Set(t.assignments.map((a) => semesterNames[a.semester - 1]))];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.teacherId}</td>
      <td>${t.full_name}</td>
      <td>${t.phone}</td>
      <td>${t.qualification}</td>
      <td>${semestersTaught.join(", ") || "—"}</td>
      <td>${semestersTaught.length}</td>
      <td>${t.status}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Enable / Disable with reciprocal ID <-> Name autofill ----------
// Searches BOTH students (by registration_number) and teachers
// (by teacherId) so one Enable/Disable panel covers either kind
// of account, matching "if the result found in database" — it
// doesn't matter which table the record lives in.
function findPersonById(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    allStudentsCache.find((s) => s.registration_number.toLowerCase() === q) ||
    mockTeachers.find((t) => t.teacherId.toLowerCase() === q) ||
    null
  );
}
function findPersonByName(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    allStudentsCache.find((s) => s.full_name.toLowerCase() === q) ||
    mockTeachers.find((t) => t.full_name.toLowerCase() === q) ||
    null
  );
}
function getPersonId(person) {
  return person.registration_number || person.teacherId;
}

function wireEnableDisableCard(prefix) {
  const idInput = document.getElementById(`${prefix}-id-input`);
  const nameInput = document.getElementById(`${prefix}-name-input`);
  const toggle = document.getElementById(`${prefix}-toggle-switch`);
  const statusLabel = document.getElementById(`${prefix}-status-label`);
  const confirmBtn = document.getElementById(`btn-confirm-${prefix}`);
  const resultBox = document.getElementById(`${prefix}-result`);

  // Replaced by the dedicated Student/Teacher controls below.
  if (!idInput || !nameInput || !toggle || !statusLabel || !confirmBtn || !resultBox) return null;

  let matchedPerson = null;

  function reflectPerson(person) {
    matchedPerson = person;
    if (!person) {
      statusLabel.textContent = "Not found";
      toggle.classList.remove("on", "off");
      return;
    }
    const isActive = person.status === "Active";
    toggle.classList.toggle("on", isActive);
    toggle.classList.toggle("off", !isActive);
    statusLabel.textContent = person.status;
  }

  idInput.addEventListener("input", () => {
    const person = findPersonById(idInput.value);
    nameInput.value = person ? person.full_name : "";
    reflectPerson(person);
  });

  nameInput.addEventListener("input", () => {
    const person = findPersonByName(nameInput.value);
    idInput.value = person ? getPersonId(person) : "";
    reflectPerson(person);
  });

  toggle.addEventListener("click", () => {
    if (!matchedPerson) return;
    // Just flips the PENDING visual state — Confirm is what actually saves it.
    toggle.classList.toggle("on");
    toggle.classList.toggle("off");
  });

  confirmBtn.addEventListener("click", () => {
    if (!matchedPerson) {
      resultBox.innerHTML = "No matching student/teacher found.";
      resultBox.classList.add("show");
      return;
    }

    const newStatus = prefix === "enable" ? "Active" : "Disabled";

    // ----- BACKEND CALL GOES HERE -----
    // Real version: PATCH /api/admin/students/<id>/ or
    // /api/admin/teachers/<id>/ with { status: newStatus }
    matchedPerson.status = newStatus;
    reflectPerson(matchedPerson);

    resultBox.innerHTML = `<strong>${matchedPerson.full_name}</strong> (${getPersonId(matchedPerson)}) is now <strong>${newStatus}</strong>.`;
    resultBox.classList.add("show");

    if (document.getElementById("teacher-management-table")) renderTeacherManagementTable();
  });

  return { reset: () => { idInput.value = ""; nameInput.value = ""; reflectPerson(null); resultBox.classList.remove("show"); } };
}

// ---------- Upgrade Semester (password-gated, 3-month cooldown) ----------
const ADMIN_CONFIRM_PASSWORD = "Admin@123"; // matches the demo Admin login password
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000; // 3 months — each semester runs ~5 months

// In-memory only: resets when the page reloads. Real version:
// GET/POST /api/admin/semester-promotions/ backed by a DB table
// (your doc's SEMESTER_PROMOTION table already fits this).
const semesterPromotionHistory = {};

function monthsAgoLabel(pastDate, now = new Date()) {
  const diffDays = Math.floor((now - pastDate) / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const months = Math.floor(diffDays / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function canPromote(semesterIndex, now = new Date()) {
  const lastDate = semesterPromotionHistory[semesterIndex];
  if (!lastDate) return { allowed: true };
  const elapsed = now - lastDate;
  if (elapsed < COOLDOWN_MS) {
    const daysLeft = Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60 * 24));
    return {
      allowed: false,
      reason: `This semester was already promoted ${monthsAgoLabel(lastDate, now)}. Wait ${daysLeft} more day(s) — promotions need at least 3 months apart.`,
    };
  }
  return { allowed: true };
}

function promoteStudentsInSemester(semesterIndex) {
  let count = 0;
  allStudentsCache.forEach((s) => {
    if (s.semester === semesterNames[semesterIndex - 1]) {
      s.semester = semesterNames[semesterIndex];
      count++;
    }
  });
  return count;
}

function renderPromotionHistory() {
  const tbody = document.getElementById("promotion-history-body");
  tbody.innerHTML = "";
  for (let i = 1; i <= 7; i++) {
    const lastDate = semesterPromotionHistory[i];
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${semesterNames[i - 1]} → ${semesterNames[i]}</td><td>${lastDate ? monthsAgoLabel(lastDate) : "Never"}</td>`;
    tbody.appendChild(tr);
  }
}

async function handleMoveSemester() {
  const semesterId = Number(document.getElementById("upgrade-semester-select").value);
  const academicYear = Number(document.getElementById("upgrade-batch-select").value);
  const messageEl = document.getElementById("upgrade-status-message");
  messageEl.className = "upgrade-status-message";
  messageEl.textContent = "";
  const semester = liveSemesters.find((item) => Number(item.id) === semesterId);
  if (!semester || !academicYear) {
    messageEl.textContent = "Select both a semester and a batch.";
    messageEl.classList.add("blocked");
    return;
  }
  const destination = Number(semester.semester_number) === 8 ? "Data Storage Management and disable their accounts" : `Semester ${Number(semester.semester_number) + 1}`;
  if (!confirm(`Promote only the ${academicYear} batch from ${semester.semester_name} to ${destination}? Other batches will not change.`)) return;
  try {
    const result = await apiFetch("/admin/semester-promote-batch/", {
      method: "POST", body: { from_semester_id: semesterId, academic_year: academicYear }
    });
    messageEl.textContent = result.archived
      ? `${result.count} student(s) in the ${academicYear} batch were moved to Data Storage Management.`
      : `${result.count} student(s) in the ${academicYear} batch were promoted from ${result.from_semester} to ${result.to_semester}.`;
    messageEl.classList.add("ok");
    await refreshBatchPromotionOptions();
    allStudentsCache = await fetchStudentList();
    renderStudentTable(allStudentsCache, document.getElementById("student-search-input")?.value || "");
  } catch (error) {
    messageEl.textContent = error.message;
    messageEl.classList.add("blocked");
  }
}

async function refreshBatchPromotionOptions() {
  const semesterSelect = document.getElementById("upgrade-semester-select");
  const batchSelect = document.getElementById("upgrade-batch-select");
  if (!semesterSelect || !batchSelect) return;
  const priorSemester = semesterSelect.value;
  semesterSelect.innerHTML = liveSemesters.map((s) => `<option value="${s.id}">${s.semester_name}</option>`).join("");
  if ([...semesterSelect.options].some((item) => item.value === priorSemester)) semesterSelect.value = priorSemester;
  const semester = liveSemesters.find((s) => String(s.id) === String(semesterSelect.value));
  const rows = await apiFetch("/admin/students/");
  const batches = [...new Set(rows.filter((student) => Number(student.current_semester_number) === Number(semester?.semester_number)).map((student) => student.current_academic_year).filter(Boolean))].sort((a, b) => a - b);
  batchSelect.innerHTML = batches.length ? batches.map((batch) => `<option value="${batch}">${batch} batch</option>`).join("") : '<option value="">No active batch</option>';
}

// ---------- Data Storage Management (archive search) ----------
let archivedRecords = [];

function renderArchiveTable(records, query) {
  const tbody = document.getElementById("archive-table-body");
  tbody.innerHTML = "";
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="archive-empty">No graduated students match the current filter.</td></tr>';
    return;
  }
  records.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${highlightMatch(r.id, query)}</td>
      <td>${highlightMatch(r.full_name, query)}</td>
      <td>${r.batch || "—"}</td>
      <td>${r.cgpa ?? "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateArchiveTable() {
  const query = document.getElementById("archive-search").value.trim();
  const selectedBatch = document.getElementById("archive-batch-filter").value;
  const normalizedQuery = query.toLowerCase();
  const filtered = archivedRecords.filter((record) => {
    const matchesQuery = !normalizedQuery
      || record.full_name.toLowerCase().includes(normalizedQuery)
      || record.id.toLowerCase().includes(normalizedQuery);
    const matchesBatch = selectedBatch === "all" || String(record.batch) === selectedBatch;
    return matchesQuery && matchesBatch;
  });
  renderArchiveTable(filtered, query);
  document.getElementById("archive-search-count").textContent = query || selectedBatch !== "all" ? `${filtered.length} result(s)` : "";
}

function populateArchiveBatchFilter() {
  const select = document.getElementById("archive-batch-filter");
  const selected = select.value;
  const batches = [...new Set(archivedRecords.map((record) => record.batch).filter(Boolean))].sort((a, b) => b - a);
  select.innerHTML = '<option value="all">All batches</option>' + batches.map((batch) => `<option value="${batch}">${batch} batch</option>`).join("");
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

// ---------- init + wiring ----------
let enableCardHandle = null;
let disableCardHandle = null;

function initSettingPage() {
  renderTeacherManagementTable();
  renderArchiveTable(mockArchivedRecords, "");
  document.getElementById("archive-search").value = "";
  document.getElementById("archive-search-count").textContent = "";

  document.getElementById("upgrade-panel").style.display = "none";
  document.getElementById("upgrade-status-message").textContent = "";
  document.getElementById("upgrade-status-message").className = "upgrade-status-message";
  renderPromotionHistory();

  if (enableCardHandle) enableCardHandle.reset();
  if (disableCardHandle) disableCardHandle.reset();
}

document.addEventListener("DOMContentLoaded", () => {
  enableCardHandle = wireEnableDisableCard("enable");
  disableCardHandle = wireEnableDisableCard("disable");

  document.getElementById("btn-open-upgrade").addEventListener("click", () => {
    const panel = document.getElementById("upgrade-panel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display === "block") refreshBatchPromotionOptions().catch((error) => {
      document.getElementById("upgrade-status-message").textContent = error.message;
    });
  });
  document.getElementById("btn-move-semester").addEventListener("click", handleMoveSemester);
  document.getElementById("upgrade-semester-select").addEventListener("change", () => refreshBatchPromotionOptions().catch((error) => {
    document.getElementById("upgrade-status-message").textContent = error.message;
  }));

  document.getElementById("archive-search").addEventListener("input", updateArchiveTable);
  document.getElementById("archive-batch-filter").addEventListener("change", updateArchiveTable);

  // Logout redirects straight to the landing page — different from
  // the sidebar Home icon, which only steps back one view.
  document.getElementById("btn-logout-admin").addEventListener("click", () => {
    window.location.href = "index.html";
  });
});

/* Final live overrides for teacher creation and the Customize Admin screen. */
function buildAssignmentRow() {
  const row = document.createElement("div");
  row.className = "assignment-row";
  row.innerHTML = `<select class="assignment-semester-select">${liveSemesters.map((s) => `<option value="${s.id}">${s.semester_name}</option>`).join("")}</select><select class="assignment-subject-select"></select>`;
  const semester = row.querySelector(".assignment-semester-select");
  const setSubjects = () => {
    const subjects = liveSubjects.filter((subject) => Number(subject.semester) === Number(semester.value));
    row.querySelector(".assignment-subject-select").innerHTML = '<option value="">No assignment now</option>' + subjects.map((subject) => `<option value="${subject.id}">${subject.subject_name}</option>`).join("");
  };
  semester.addEventListener("change", () => { setSubjects(); refreshManualTeacherBatchOptions(); });
  setSubjects();
  setTimeout(refreshManualTeacherBatchOptions, 0);
  return row;
}

function refreshManualTeacherBatchOptions() {
  const select = document.getElementById("manual-teacher-batch");
  if (!select || !liveSemesters.length) return;
  const selectedSemesterIds = [...document.querySelectorAll("#teacher-assignment-rows .assignment-semester-select")]
    .map((element) => Number(element.value)).filter(Boolean);
  if (!selectedSemesterIds.length) { select.innerHTML = '<option value="">Choose a semester first</option>'; return; }
  const semesterNumbers = selectedSemesterIds.map((id) => liveSemesters.find((semester) => Number(semester.id) === id)?.semester_number).filter(Boolean);
  const batches = [...new Set(allStudentsCache.map((student) => Number(student.academic_year)).filter(Boolean))].sort((a, b) => b - a)
    .filter((batch) => semesterNumbers.every((semesterNumber) => allStudentsCache.some((student) => Number(student.semester_number) === Number(semesterNumber) && Number(student.academic_year) === batch)));
  const previous = select.value;
  select.innerHTML = batches.length ? '<option value="">Choose enrolled batch</option>' + batches.map((batch) => {
    const count = allStudentsCache.filter((student) => Number(student.semester_number) === Number(semesterNumbers[0]) && Number(student.academic_year) === batch).length;
    return `<option value="${batch}">${batch} batch (${count} students)</option>`;
  }).join("") : '<option value="">No enrolled batch for selected semester</option>';
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

async function handleAddTeacher() {
  const teacher_name = document.getElementById("new-teacher-name").value.trim();
  const phone = document.getElementById("new-teacher-phone").value.trim();
  if (!teacher_name || !phone) return alert("Teacher name and phone are required.");
  try {
    const username = `teacher${Date.now().toString().slice(-8)}`;
    const teacher = await apiFetch("/admin/teachers/", { method: "POST", body: { teacher_name, phone, qualification: document.getElementById("new-teacher-qualification").value.trim(), username, status: "Active" } });
    const academic_year = new Date().getFullYear();
    for (const row of document.querySelectorAll("#teacher-assignment-rows .assignment-row")) {
      const subject = Number(row.querySelector(".assignment-subject-select").value);
      const semester = Number(row.querySelector(".assignment-semester-select").value);
      if (subject) await apiFetch("/admin/teacher-assignments/", { method: "POST", body: { teacher: teacher.id, subject, semester, academic_year, status: "Active" } });
    }
    liveTeachers = await apiFetch("/admin/teachers/");
    renderLiveTeacherManagement();
    const result = document.getElementById("new-teacher-result");
    result.textContent = `Teacher created. Username: ${username}; temporary password: Teacher@123`;
    result.classList.add("show");
  } catch (error) { alert(error.message); }
}

async function initCustomizeAdmin() {
  try { await loadLiveAdminReferenceData(); } catch (error) { alert(error.message); return; }
  setupAdminNameControl();
  setupAcademicReferenceControls();
  setupOperationalDataReset();
  document.getElementById("csv-file-input").value = "";
  document.getElementById("csv-preview-area").innerHTML = "";
  document.getElementById("csv-column-mapping").innerHTML = "";
  const assignments = document.getElementById("teacher-assignment-rows");
  assignments.innerHTML = "";
  assignments.appendChild(buildAssignmentRow());
}

function setupAcademicReferenceControls() {
  const status = document.getElementById("academic-setup-status");
  const facultyButton = document.getElementById("btn-add-faculty");
  const semestersButton = document.getElementById("btn-create-standard-semesters");

  facultyButton.onclick = async () => {
    const faculty_name = document.getElementById("new-faculty-name").value.trim();
    const university_name = document.getElementById("new-university-name").value.trim();
    if (!faculty_name || !university_name) {
      status.textContent = "Enter both the faculty name and university name.";
      return;
    }
    facultyButton.disabled = true;
    try {
      await apiFetch("/admin/faculties/", { method: "POST", body: { faculty_name, university_name } });
      status.textContent = `${faculty_name} was created successfully.`;
      document.getElementById("new-faculty-name").value = "";
      document.getElementById("new-university-name").value = "";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      facultyButton.disabled = false;
    }
  };

  semestersButton.onclick = async () => {
    const names = ["I Semester", "II Semester", "III Semester", "IV Semester", "V Semester", "VI Semester", "VII Semester", "VIII Semester"];
    semestersButton.disabled = true;
    try {
      const existing = await apiFetch("/admin/semesters/");
      const existingNumbers = new Set(existing.map((semester) => Number(semester.semester_number)));
      const missing = names.map((semester_name, index) => ({ semester_name, semester_number: index + 1 })).filter((semester) => !existingNumbers.has(semester.semester_number));
      await Promise.all(missing.map((semester) => apiFetch("/admin/semesters/", { method: "POST", body: semester })));
      await loadLiveAdminReferenceData();
      status.textContent = missing.length ? `Created ${missing.length} missing semester record(s).` : "Semester records 1–8 already exist.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      semestersButton.disabled = false;
    }
  };
}

function setupOperationalDataReset() {
  const button = document.getElementById("btn-reset-operational-data");
  const status = document.getElementById("data-reset-status");
  if (!button || !status) return;

  button.addEventListener("click", async () => {
    if (!window.confirm("Warning: this permanently removes all non-admin data. This cannot be undone. Continue only if you have a backup.")) return;
    const confirmation = window.prompt("Type RESET ALL DATA to confirm the permanent data reset.");
    if (confirmation === null) return;
    if (confirmation !== "RESET ALL DATA") {
      status.textContent = "Nothing was removed. The confirmation phrase did not match.";
      return;
    }
    const password = window.prompt("Enter your current admin password to continue.");
    if (password === null) return;
    const secretCode = window.prompt("Enter the data-reset security code.");
    if (secretCode === null) return;

    button.disabled = true;
    status.textContent = "Removing existing records…";
    try {
      const result = await apiFetch("/admin/data/reset/", { method: "POST", body: { confirmation, password, secret_code: secretCode } });
      status.textContent = `${result.message} You can now create faculty and semesters, then import your new CSV files.`;
      await loadLiveAdminReferenceData();
      allStudentsCache = [];
      liveTeachers = [];
      document.getElementById("student-table-body").innerHTML = '<tr class="no-results"><td colspan="12">No students found.</td></tr>';
    } catch (error) {
      status.textContent = error.message || "The existing data could not be removed.";
    } finally {
      button.disabled = false;
    }
  });
}

function renderUpdateResults(query) {
  const role = document.querySelector('input[name="update-role"]:checked').value;
  const list = document.getElementById("update-results");
  list.innerHTML = "";
  if (!query.trim()) return;
  const q = query.trim().toLowerCase();
  const source = role === "student" ? allStudentsCache : liveTeachers;
  const matches = source.filter((person) => `${person.full_name || person.teacher_name} ${person.registration_number || person.id}`.toLowerCase().includes(q));
  list.innerHTML = matches.length ? matches.map((person, index) => `<li data-live-update="${index}">${role === "student" ? person.registration_number : person.id} — ${person.full_name || person.teacher_name}</li>`).join("") : "<li>No matches.</li>";
  list.querySelectorAll("[data-live-update]").forEach((item) => item.addEventListener("click", () => renderUpdateForm(role, matches[Number(item.dataset.liveUpdate)])));
}

async function renderUpdateForm(role, person) {
  const isStudent = role === "student";
  const area = document.getElementById("update-form-area");
  area.innerHTML = '<p class="csv-hint">Loading complete record…</p>';
  let record = person;
  try { if (isStudent) record = await apiFetch(`/admin/students/${person.id}/`); } catch (error) { area.textContent = error.message; return; }
  let teacherAssignments = [];
  if (!isStudent) {
    try {
      teacherAssignments = (await apiFetch("/admin/teacher-assignments/"))
        .filter((assignment) => Number(assignment.teacher) === Number(record.id) && assignment.status === "Active");
    } catch (error) { console.error("Could not load teacher assignments:", error); }
  }
  const field = (label, id, value, type = "text", required = false) => `<label>${label}${required ? " *" : ""}<input type="${type}" id="${id}" value="${value || ""}" ${required ? "required" : ""}></label>`;
  const semesterOptions = liveSemesters.map((semester) => `<option value="${semester.semester_number}" ${Number(record.current_semester_number) === semester.semester_number ? "selected" : ""}>${semester.semester_name}</option>`).join("");
  if (isStudent) {
    area.innerHTML = `<div class="edit-form-grid edit-student-form">
      ${field("Registration number", "edit-registration-number", record.registration_number, "text", true)}
      ${field("Full name", "edit-full-name", record.full_name, "text", true)}
      ${field("Symbol number", "edit-symbol-number", record.symbol_number)}
      <label>Gender<select id="edit-gender"><option ${record.gender === "Male" ? "selected" : ""}>Male</option><option ${record.gender === "Female" ? "selected" : ""}>Female</option><option ${record.gender === "Other" ? "selected" : ""}>Other</option></select></label>
      ${field("Date of birth", "edit-dob", record.date_of_birth, "date", true)}
      ${field("Student email", "edit-email", record.email, "email")}
      ${field("Student phone", "edit-phone", record.phone, "text", true)}
      ${field("Address", "edit-address", record.address, "text", true)}
      ${field("Guardian name", "edit-guardian-name", record.guardian_name_display, "text", true)}
      ${field("Guardian phone", "edit-guardian-phone", record.guardian_phone_display, "text", true)}
      ${field("Guardian email", "edit-guardian-email", record.guardian_email_display, "email")}
      <label>Faculty<select id="edit-faculty"><option value="BCA">BCA</option></select></label>
      <label>Semester<select id="edit-semester">${semesterOptions}</select></label>
      ${field("Academic year", "edit-academic-year", record.current_academic_year, "number", true)}
      <label>Status<select id="edit-status"><option ${record.status === "Active" ? "selected" : ""}>Active</option><option ${record.status === "Disabled" ? "selected" : ""}>Disabled</option></select></label>
      <div class="temp-password-admin-note"><strong>Initial password:</strong> ${record.temp_password_plain ? record.temp_password_plain : "Password already changed."}</div>
    </div>`;
  } else {
    const teacherSemesterOptions = liveSemesters.map((semester) => `<option value="${semester.id}">${semester.semester_name}</option>`).join("");
    area.innerHTML = `<div class="edit-form-grid">
      ${field("Teacher ID", "edit-teacher-id", record.id, "text")} ${field("Login ID", "edit-login-id", record.login_id, "text")}
      ${field("Username", "edit-username", record.username_display, "text")} ${field("Teacher name", "edit-full-name", record.teacher_name, "text", true)}
      <label>Gender<select id="edit-gender"><option ${record.gender === "Male" ? "selected" : ""}>Male</option><option ${record.gender === "Female" ? "selected" : ""}>Female</option><option ${record.gender === "Other" ? "selected" : ""}>Other</option></select></label>
      ${field("Email", "edit-email", record.email, "email", true)} ${field("Phone", "edit-phone", record.phone, "text", true)}
      ${field("Qualification", "edit-qualification", record.qualification, "text", true)} ${field("Joining date", "edit-joining-date", record.joining_date, "date")}
      <label>Status<select id="edit-status"><option ${record.status === "Active" ? "selected" : ""}>Active</option><option ${record.status === "Disabled" ? "selected" : ""}>Disabled</option></select></label>
      <div class="temp-password-admin-note"><strong>Initial password:</strong> ${record.temp_password_plain ? record.temp_password_plain : "Password already changed."}</div>
    </div>
    <div class="config-card" style="margin-top:14px;"><strong>Currently assigned subjects</strong><div id="current-teacher-assignments" class="csv-hint" style="margin-top:8px;"></div></div>
    <div class="config-card" style="margin-top:14px;"><strong>Add subject and batch</strong><div class="selector-row" style="margin-top:8px;"><select id="edit-assignment-semester">${teacherSemesterOptions}</select><select id="edit-assignment-subject"></select><select id="edit-assignment-batch"><option value="">Choose enrolled batch</option></select><button type="button" class="btn btn-outline-small" id="btn-add-live-assignment">Assign</button></div><span id="assignment-result" class="save-confirmation"></span></div>`;
    area.querySelectorAll("#edit-teacher-id,#edit-login-id").forEach((input) => input.readOnly = true);
    const assignmentSemester = document.getElementById("edit-assignment-semester");
    const assignmentSubject = document.getElementById("edit-assignment-subject");
    const assignmentBatch = document.getElementById("edit-assignment-batch");
    const currentAssignments = document.getElementById("current-teacher-assignments");
    let editingAssignmentId = null;
    const enrolledBatchesFor = (semesterId) => {
      const semesterNumber = liveSemesters.find((semester) => Number(semester.id) === Number(semesterId))?.semester_number;
      return [...new Set(allStudentsCache.filter((student) => Number(student.semester_number) === Number(semesterNumber)).map((student) => Number(student.academic_year)).filter(Boolean))]
        .sort((a, b) => b - a)
        .map((batch) => ({ batch, count: allStudentsCache.filter((student) => Number(student.semester_number) === Number(semesterNumber) && Number(student.academic_year) === batch).length }));
    };
    const renderCurrentAssignments = () => {
      currentAssignments.innerHTML = teacherAssignments.length
        ? teacherAssignments.map((assignment) => {
          if (Number(assignment.id) === Number(editingAssignmentId)) {
            const subjects = liveSubjects.filter((subject) => Number(subject.semester) === Number(assignment.semester));
            const batches = enrolledBatchesFor(assignment.semester);
            const hasCurrentBatch = batches.some(({ batch }) => Number(batch) === Number(assignment.academic_year));
            const batchOptions = (hasCurrentBatch ? "" : `<option value="">${assignment.academic_year} batch has no enrolled students — choose another</option>`) + (batches.map(({ batch, count }) => `<option value="${batch}" ${Number(batch) === Number(assignment.academic_year) ? "selected" : ""}>${batch} batch (${count} students)</option>`).join("") || '<option value="">No enrolled batch</option>');
            return `<div class="selector-row" style="margin-bottom:8px;"><strong>${assignment.semester_name}</strong><select data-current-subject>${subjects.map((subject) => `<option value="${subject.id}" ${Number(subject.id) === Number(assignment.subject) ? "selected" : ""}>${subject.subject_name}</option>`).join("")}</select><select data-current-batch>${batchOptions}</select><button type="button" class="btn btn-navy" data-save-assignment="${assignment.id}">Save</button><button type="button" class="btn btn-outline-small" data-cancel-assignment>Cancel</button></div>`;
          }
          return `<div class="selector-row" style="margin-bottom:8px;"><span><strong>${assignment.semester_name}</strong> — ${assignment.subject_name} <span>(${assignment.academic_year} batch)</span></span><button type="button" class="btn btn-outline-small" data-edit-assignment="${assignment.id}">Edit</button><button type="button" class="btn btn-outline-small" data-remove-assignment="${assignment.id}">Remove</button></div>`;
        }).join("")
        : "No active subjects are assigned yet.";
      currentAssignments.querySelectorAll("[data-edit-assignment]").forEach((button) => button.addEventListener("click", () => {
        editingAssignmentId = Number(button.dataset.editAssignment);
        renderCurrentAssignments();
      }));
      currentAssignments.querySelectorAll("[data-cancel-assignment]").forEach((button) => button.addEventListener("click", () => {
        editingAssignmentId = null;
        renderCurrentAssignments();
      }));
      currentAssignments.querySelectorAll("[data-save-assignment]").forEach((button) => button.addEventListener("click", async () => {
        const subject = Number(currentAssignments.querySelector("[data-current-subject]").value);
        const academic_year = Number(currentAssignments.querySelector("[data-current-batch]").value);
        if (!subject || !academic_year) return alert("Choose a subject and an enrolled batch.");
        try {
          const updated = await apiFetch(`/admin/teacher-assignments/${button.dataset.saveAssignment}/`, { method: "PATCH", body: { subject, academic_year } });
          teacherAssignments = teacherAssignments.map((assignment) => Number(assignment.id) === Number(updated.id) ? updated : assignment);
          editingAssignmentId = null;
          renderCurrentAssignments();
        } catch (error) { alert(error.message); }
      }));
      currentAssignments.querySelectorAll("[data-remove-assignment]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm("Remove this subject assignment from the teacher?")) return;
        try {
          await apiFetch(`/admin/teacher-assignments/${button.dataset.removeAssignment}/`, { method: "DELETE" });
          teacherAssignments = teacherAssignments.filter((assignment) => Number(assignment.id) !== Number(button.dataset.removeAssignment));
          renderCurrentAssignments();
        } catch (error) { alert(error.message); }
      }));
    };
    renderCurrentAssignments();
    const fillAssignmentSubjects = () => {
      assignmentSubject.innerHTML = liveSubjects.filter((subject) => Number(subject.semester) === Number(assignmentSemester.value)).map((subject) => `<option value="${subject.id}">${subject.subject_name}</option>`).join("") || '<option value="">No subjects available</option>';
    };
    const fillAssignmentBatches = () => {
      const semesterNumber = liveSemesters.find((semester) => Number(semester.id) === Number(assignmentSemester.value))?.semester_number;
      const batches = [...new Set(allStudentsCache.filter((student) => Number(student.semester_number) === Number(semesterNumber)).map((student) => Number(student.academic_year)).filter(Boolean))].sort((a, b) => b - a);
      assignmentBatch.innerHTML = batches.length ? '<option value="">Choose enrolled batch</option>' + batches.map((batch) => {
        const count = allStudentsCache.filter((student) => Number(student.semester_number) === Number(semesterNumber) && Number(student.academic_year) === batch).length;
        return `<option value="${batch}">${batch} batch (${count} students)</option>`;
      }).join("") : '<option value="">No enrolled batch</option>';
    };
    fillAssignmentSubjects();
    fillAssignmentBatches();
    assignmentSemester.addEventListener("change", () => { fillAssignmentSubjects(); fillAssignmentBatches(); });
    document.getElementById("btn-add-live-assignment").addEventListener("click", async () => {
      const batch = Number(document.getElementById("edit-assignment-batch").value);
      const subject = Number(assignmentSubject.value);
      if (!batch || !subject) return alert("Choose a subject and an enrolled batch.");
      try {
        const assignment = await apiFetch("/admin/teacher-assignments/", { method: "POST", body: { teacher: record.id, subject, semester: Number(assignmentSemester.value), academic_year: batch, status: "Active" } });
        teacherAssignments.push(assignment);
        renderCurrentAssignments();
        document.getElementById("assignment-result").textContent = "Assignment saved.";
      } catch (error) { document.getElementById("assignment-result").textContent = error.message; }
    });
  }
  area.insertAdjacentHTML("beforeend", '<button class="btn btn-navy" id="btn-save-update">Save all changes</button><span id="update-confirmation" class="save-confirmation"></span>');
  document.getElementById("btn-save-update").addEventListener("click", async () => {
    const value = (id) => document.getElementById(id).value.trim();
    const payload = isStudent ? { registration_number: value("edit-registration-number"), full_name: value("edit-full-name"), symbol_number: value("edit-symbol-number") || null, gender: value("edit-gender"), date_of_birth: value("edit-dob"), email: value("edit-email") || null, phone: value("edit-phone"), address: value("edit-address"), guardian_name: value("edit-guardian-name"), guardian_phone: value("edit-guardian-phone"), guardian_email: value("edit-guardian-email") || "", faculty_name: value("edit-faculty"), semester_number: Number(value("edit-semester")), academic_year: Number(value("edit-academic-year")), status: value("edit-status") } : { username: value("edit-username"), teacher_name: value("edit-full-name"), gender: value("edit-gender"), email: value("edit-email"), phone: value("edit-phone"), qualification: value("edit-qualification"), joining_date: value("edit-joining-date") || null, status: value("edit-status") };
    try {
      await apiFetch(`/admin/${isStudent ? "students" : "teachers"}/${person.id}/`, { method: "PATCH", body: payload });
      if (isStudent) allStudentsCache = await fetchStudentList(); else liveTeachers = await apiFetch("/admin/teachers/");
      renderLiveTeacherManagement();
      updateAdminOverviewCards();
      const confirmation = area.querySelector("#update-confirmation");
      if (confirmation) confirmation.textContent = "Saved";
      setTimeout(() => {
        const search = document.getElementById("update-search");
        const results = document.getElementById("update-results");
        const formArea = document.getElementById("update-form-area");
        if (search) search.value = "";
        if (results) results.innerHTML = "";
        if (formArea) formArea.innerHTML = "";
      }, 700);
    } catch (error) { alert(error.message); }
  });
}

async function initSettingPage() {
  try {
    liveTeachers = await apiFetch("/admin/teachers/");
    renderLiveTeacherManagement();
    const records = await apiFetch("/admin/archived-students/");
    archivedRecords = records.map((record) => ({
      id: record.registration_number,
      full_name: record.full_name,
      batch: record.batch,
      cgpa: record.cgpa,
    }));
    populateArchiveBatchFilter();
    updateArchiveTable();
  } catch (error) { console.error(error); }
}

/* No fabricated marks or JavaScript charts: these views render only data
   returned from MySQL, and remain blank until staff enter real marks. */
function loadSemesterDetails() {
  const semesterId = Number(document.getElementById("detail-semester-select").value);
  const sem = liveSemesters.find((item) => item.id === semesterId);
  const students = allStudentsCache.filter((student) => String(student.semester_number) === String(sem?.semester_number));
  const subjects = liveSubjects.filter((subject) => Number(subject.semester) === semesterId);
  document.getElementById("semester-marks-title").textContent = `${sem?.semester_name || "Semester"} details`;
  const head = document.getElementById("marks-table-head");
  head.innerHTML = `<tr><th>Registration No.</th><th>Student name</th>${subjects.map((subject) => `<th>${subject.subject_name}</th>`).join("")}</tr>`;
  document.getElementById("marks-table-body").innerHTML = students.length ? students.map((student) => `<tr><td>${student.registration_number}</td><td>${student.full_name}</td>${subjects.map(() => "<td>—</td>").join("")}</tr>`).join("") : '<tr><td colspan="20">No students in this semester.</td></tr>';
  document.getElementById("btn-save-marks").disabled = true;
  document.getElementById("save-confirmation").textContent = "Marks are entered by the assigned teacher; no marks have been entered yet.";
}

let semesterDashboardData = null;

// Keep this calculation aligned with Semester-wise Details: a student fails
// when an entered Midterm or Preboard mark is below 24 out of 60.
function semesterDashboardStatus(row, subjects) {
  const examScores = subjects.flatMap((subject) => ["Midterm", "Preboard"].map((category) =>
    row.subjects?.[subject.id]?.categories?.[category]?.display_obtained
  )).filter((score) => score != null && score !== "");
  if (!examScores.length) return "–";
  return examScores.some((score) => Number(score) < 24) ? "Fail" : "Pass";
}

function renderSemesterDashboardRows() {
  if (!semesterDashboardData) return;
  const { students, subjects, categories } = semesterDashboardData;
  const query = (document.getElementById("dashboard-student-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("dashboard-status-filter")?.value || "all";
  const visibleStudents = students.filter((row) => {
    const matchesSearch = !query || row.full_name.toLowerCase().includes(query) || row.registration_number.toLowerCase().includes(query);
    const status = semesterDashboardStatus(row, subjects).toLowerCase();
    return matchesSearch && (statusFilter === "all" || status === statusFilter);
  });
  document.getElementById("dashboard-summary-body").innerHTML = visibleStudents.length ? visibleStudents.map((row) => {
    const cells = subjects.flatMap((subject) => {
      const categoryCells = categories.map((category, index) => {
        const value = row.subjects?.[subject.id]?.categories?.[category.name]?.display_obtained;
        return `<td class="${index === 0 ? "subject-divider" : ""}">${value == null ? "–" : `${value} /${category.input_full_marks || category.full_marks}`}</td>`;
      });
      const total = row.subjects?.[subject.id]?.performance_percent;
      return [...categoryCells, `<td class="subject-total-cell">${total == null ? "–" : `${total}%`}</td>`];
    }).join("");
    const status = semesterDashboardStatus(row, subjects);
    return `<tr><td>${highlightMatch(row.registration_number, query)}</td><td>${highlightMatch(row.full_name, query)}</td>${cells}<td class="exam-status ${status.toLowerCase()}">${status}</td><td class="overall-performance-cell">${row.overall_performance == null ? "–" : `${row.overall_performance}%`}</td></tr>`;
  }).join("") : `<tr><td colspan="${2 + subjects.length * (categories.length + 1) + 2}">No students match this search or status.</td></tr>`;
  const count = document.getElementById("dashboard-search-count");
  if (count) count.textContent = (query || statusFilter !== "all") ? `${visibleStudents.length} result(s)` : "";
}

async function loadSemesterDashboard() {
  // Always use the current database roster, including students imported
  // after this browser tab was opened.
  try { allStudentsCache = await fetchStudentList(); } catch (error) { console.error(error); }
  refreshDashboardBatchOptions();
  const semesterId = Number(document.getElementById("dash-semester-select").value);
  const sem = liveSemesters.find((item) => item.id === semesterId);
  const yearSelect = document.getElementById("dash-batch-select");
  const year = yearSelect.value;
  document.getElementById("dashboard-semester-title").textContent = `${sem?.semester_name || "Semester"} dashboard`;
  if (!year) {
    document.getElementById("dashboard-summary-body").innerHTML = '<tr><td colspan="7">No student batch exists for this semester.</td></tr>';
    return;
  }
  try {
    const data = await apiFetch(`/analytics/semester-summary/?semester_id=${semesterId}&academic_year=${year}`);
    const summary = data.summary, subjects = data.subjects || [], categories = data.categories || [];
    const dashboardTable = document.getElementById("dashboard-summary-table");
    dashboardTable.querySelector("thead").innerHTML = `<tr><th rowspan="2">ID</th><th rowspan="2">Full Name</th>${subjects.map((subject) => `<th class="subject-divider" colspan="${categories.length + 1}">${subject.name} <button type="button" class="dashboard-manage-marks" data-subject-id="${subject.id}">Manage marks</button></th>`).join("")}<th rowspan="2">Status</th><th rowspan="2">Overall Performance<small>/100</small></th></tr><tr>${subjects.flatMap(() => [...categories.map((category, index) => `<th class="${index === 0 ? "subject-divider" : ""}">${category.name}<small>/${category.input_full_marks || category.full_marks}</small></th>`), "<th>Subject Total<small>/100</small></th>"]).join("")}</tr>`;
    semesterDashboardData = { students: data.students, subjects, categories };
    renderSemesterDashboardRows();
    dashboardTable.querySelectorAll(".dashboard-manage-marks").forEach((button) => button.addEventListener("click", () => openAdminMarksWorkspace(semesterId, year, Number(button.dataset.subjectId))));

    // These circles are calculated from the live MySQL summary.  They do not
    // display a made-up percentage when attendance or marks have not yet been entered.
    const attendanceChart = document.getElementById("attendance-pie");
    if (summary.average_attendance == null) {
      adminDashboardCharts["attendance-pie"]?.destroy();
      delete adminDashboardCharts["attendance-pie"];
      attendanceChart.textContent = "No attendance recorded yet";
      attendanceChart.classList.add("attendance-chart-empty");
    } else {
      attendanceChart.classList.remove("attendance-chart-empty");
      renderAdminDashboardChart("attendance-pie", "doughnut", ["Present", "Absent"], [summary.average_attendance, 100 - summary.average_attendance], [C_GOOD, C_BAD]);
    }
    const subjectCharts = document.getElementById("subject-performance-charts");
    adminDashboardCharts["breakdown-pie"]?.destroy();
    delete adminDashboardCharts["breakdown-pie"];
    Object.keys(adminDashboardCharts).filter((key) => key.startsWith("subject-breakdown-")).forEach((key) => { adminDashboardCharts[key]?.destroy(); delete adminDashboardCharts[key]; });
    subjectCharts.replaceChildren();
    subjects.forEach((subject) => {
      const chartId = `subject-breakdown-${subject.id}`;
      const card = document.createElement("section");
      card.className = "subject-performance-chart";
      card.innerHTML = `<h4>${subject.name} — Performance Breakdown</h4><p>Percentage by category</p><div class="subject-performance-canvas" id="${chartId}"></div>`;
      subjectCharts.appendChild(card);
      const values = categories.map((category) => {
        const marks = data.students
          .map((student) => student.subjects?.[subject.id]?.categories?.[category.name]?.obtained)
          .filter((value) => value != null);
        return marks.length ? marks.reduce((sum, value) => sum + value, 0) / marks.length / category.full_marks * 100 : 0;
      });
      renderAdminDashboardChart(chartId, "bar", categories.map((category) => category.name), values, ["#2f80ed", "#43bd66", "#ff922b", "#8b52d1", "#ef4444", "#22b3c5", "#f5c518", "#e84393"]);
    });
    document.getElementById("dashboard-legend").innerHTML = `
      <li><span class="swatch swatch-attendance"></span> Class attendance: ${summary.average_attendance ?? "No attendance yet"}${summary.average_attendance != null ? "%" : ""}</li>
      <li><span class="swatch swatch-result"></span> Each subject chart shows the percentage for all eight performance categories</li>`;
    const band = (title, className, rows) => `<section class="performer-band ${className}"><strong>${title}</strong><span>${rows.length ? rows.map((row) => `${row.full_name} (${row.average_marks}%)`).join(", ") : "None"}</span></section>`;
    const scored = data.students.filter((row) => row.average_marks != null);
    document.getElementById("performer-summary").innerHTML = [
      band("Top performers — above 90%", "top", scored.filter((row) => row.average_marks > 90)),
      band("Good performers — above 80%", "good", scored.filter((row) => row.average_marks > 80 && row.average_marks <= 90)),
      band("Average performers — above 60%", "average", scored.filter((row) => row.average_marks > 60 && row.average_marks <= 80)),
      band("Low performers — 60% or below", "low", scored.filter((row) => row.average_marks <= 60)),
    ].join("");
  } catch (error) { document.getElementById("dashboard-summary-body").innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`; }
}

function openAdminMarksWorkspace(semesterId, academicYear, subjectId) {
  const semester = document.getElementById("detail-semester-select");
  semester.value = String(semesterId);
  refreshAdminMarksSelectors();
  document.getElementById("detail-batch-select").value = String(academicYear);
  document.getElementById("detail-subject-select").value = String(subjectId);
  document.querySelectorAll(".menu-item").forEach((item) => item.classList.toggle("active", item.dataset.menu === "semester-wise-details"));
  goToView("view-semester-details");
  loadSemesterDetails();
}

function refreshDashboardBatchOptions() {
  const semesterSelect = document.getElementById("dash-semester-select");
  const batchSelect = document.getElementById("dash-batch-select");
  if (!semesterSelect || !batchSelect) return;
  const semester = liveSemesters.find((item) => Number(item.id) === Number(semesterSelect.value));
  const previous = batchSelect.value;
  const batches = [...new Set(allStudentsCache
    .filter((student) => Number(student.semester_number) === Number(semester?.semester_number) && student.academic_year)
    .map((student) => Number(student.academic_year)))].sort((a, b) => b - a);
  batchSelect.innerHTML = batches.length
    ? batches.map((batch) => `<option value="${batch}">${batch} batch</option>`).join("")
    : '<option value="">No batch</option>';
  if ([...batchSelect.options].some((option) => option.value === previous)) batchSelect.value = previous;
}

/* Dedicated Student/Teacher account controls for the Settings page. */
function wireAccountStatusControl(role) {
  const isStudent = role === "student";
  const idInput = document.getElementById(`${role}-status-id`);
  const nameInput = document.getElementById(`${role}-status-name`);
  const suggestions = document.getElementById(`${role}-status-suggestions`);
  const toggle = document.getElementById(`${role}-status-toggle`);
  const label = document.getElementById(`${role}-status-label`);
  const button = document.getElementById(`btn-confirm-${role}-status`);
  const result = document.getElementById(`${role}-status-result`);
  let selected = null;
  let desiredActive = null;

  const people = () => isStudent ? allStudentsCache : liveTeachers;
  const displayName = (person) => person.full_name || person.teacher_name;
  const displayId = (person) => isStudent ? person.registration_number : `${person.id} · ${person.username_display || ""}`;
  const matches = (text) => {
    const term = text.trim().toLowerCase();
    if (!term) return [];
    return people().filter((person) => `${displayName(person)} ${displayId(person)}`.toLowerCase().includes(term)).slice(0, 7);
  };
  const paint = () => {
    const active = desiredActive === true;
    toggle.classList.toggle("on", active);
    toggle.classList.toggle("off", !active);
    label.textContent = active ? "Active" : "Inactive";
    label.style.color = active ? "#dff8e9" : "#e3e7ee";
    button.disabled = !selected;
    button.textContent = selected ? `Confirm to ${active ? "disable" : "enable"} ${isStudent ? "student" : "teacher"}` : `Select a ${role} first`;
  };
  const choose = (person) => {
    selected = person;
    desiredActive = person.status === "Active";
    idInput.value = isStudent ? person.registration_number : person.id;
    nameInput.value = displayName(person);
    suggestions.innerHTML = "";
    suggestions.classList.remove("show");
    result.classList.remove("show");
    paint();
  };
  const suggest = (text) => {
    const items = matches(text);
    suggestions.innerHTML = items.map((person, index) => `<li data-status-match="${index}"><strong>${displayId(person)}</strong> — ${displayName(person)}</li>`).join("");
    suggestions.classList.toggle("show", items.length > 0);
    suggestions.querySelectorAll("[data-status-match]").forEach((item) => item.addEventListener("click", () => choose(items[Number(item.dataset.statusMatch)])));
  };
  idInput.addEventListener("input", () => suggest(idInput.value));
  nameInput.addEventListener("input", () => suggest(nameInput.value));
  // The status indicator is read-only. The confirmation button is the
  // only control that enables/disables an account.
  button.addEventListener("click", async () => {
    if (!selected) return;
    const nextActive = !desiredActive;
    const status = isStudent ? (nextActive ? "Active" : "Disabled") : (nextActive ? "Active" : "Inactive");
    try {
      await apiFetch(`/admin/${isStudent ? "students" : "teachers"}/${selected.id}/`, { method: "PATCH", body: { status } });
      if (isStudent) allStudentsCache = await fetchStudentList(); else liveTeachers = await apiFetch("/admin/teachers/");
      selected = people().find((person) => person.id === selected.id);
      desiredActive = selected.status === "Active";
      paint();
      result.textContent = `${displayName(selected)} is now ${desiredActive ? "Active" : "Inactive"}.`;
      result.classList.add("show");
      renderLiveTeacherManagement();
    } catch (error) { alert(error.message); }
  });
  label.textContent = isStudent ? "Search by name or registration number" : "Search by name, teacher ID, or username";
}

document.addEventListener("DOMContentLoaded", () => {
  wireAccountStatusControl("student");
  wireAccountStatusControl("teacher");
});

/* Admin marks workspace: same real, grouped subject/batch view used by teachers. */
let adminMarksData = null;
function adminDetailContext() {
  return { subjectId: Number(document.getElementById("detail-subject-select").value), academicYear: Number(document.getElementById("detail-batch-select").value) };
}
function refreshAdminMarksSelectors() {
  const semesterId = Number(document.getElementById("detail-semester-select").value), semester = liveSemesters.find((item) => item.id === semesterId);
  const priorBatch = document.getElementById("detail-batch-select").value, priorSubject = document.getElementById("detail-subject-select").value;
  // Show every batch that exists in MySQL (2022–2025 here), but calculate
  // the student count for the selected semester. The matching batch is
  // selected automatically, so no students from another semester mix in.
  const batches = [...new Set(allStudentsCache.map((student) => Number(student.academic_year)).filter(Boolean))].sort((a,b)=>a-b);
  const matchingBatches = new Set(allStudentsCache
    .filter((student) => Number(student.semester_number) === Number(semester?.semester_number))
    .map((student) => String(student.academic_year)));
  const batch = document.getElementById("detail-batch-select");
  batch.innerHTML = batches.length ? batches.map((year) => {
    const count = allStudentsCache.filter((student) => Number(student.semester_number) === Number(semester?.semester_number) && Number(student.academic_year) === year).length;
    return `<option value="${year}">${year} batch${count ? ` (${count} students)` : " (no students in this semester)"}</option>`;
  }).join("") : '<option value="">No batch</option>';
  if (matchingBatches.has(priorBatch)) batch.value = priorBatch;
  else if (matchingBatches.size) batch.value = [...matchingBatches][0];
  const subject = document.getElementById("detail-subject-select"); subject.innerHTML = liveSubjects.filter((item) => Number(item.semester) === semesterId).map((item) => `<option value="${item.id}">${item.subject_name}</option>`).join("") || '<option value="">No subject</option>';
  if ([...subject.options].some((item)=>item.value===priorSubject)) subject.value=priorSubject;
}
async function loadSemesterDetails() {
  // Records may have been imported after the dashboard first loaded. Refresh
  // before building the batch selector so newly imported classes appear now.
  try {
    allStudentsCache = await fetchStudentList();
    await loadLiveAdminReferenceData();
  } catch (error) {
    console.error("Could not refresh semester records:", error);
  }
  refreshAdminMarksSelectors();
  const {subjectId, academicYear} = adminDetailContext();
  const body = document.getElementById("marks-table-body");
  const head = document.getElementById("marks-table-head");
  if (!academicYear) { head.innerHTML = ""; body.innerHTML='<tr><td>Select a semester and batch.</td></tr>'; return; }
  if (!subjectId) {
    const semester = liveSemesters.find((item) => item.id === Number(document.getElementById("detail-semester-select").value));
    const roster = allStudentsCache.filter((student) => Number(student.semester_number) === Number(semester?.semester_number) && Number(student.academic_year) === academicYear);
    head.innerHTML = '<tr><th>Registration No.</th><th>Student name</th><th>Marks workspace</th></tr>';
    body.innerHTML = roster.length
      ? roster.map((student) => `<tr><td>${student.registration_number}</td><td>${student.full_name}</td><td>Add a subject in Customize Admin before entering marks.</td></tr>`).join("")
      : '<tr><td colspan="3">No students are enrolled for this batch.</td></tr>';
    document.getElementById("semester-marks-title").textContent = `${semester?.semester_name || "Semester"} — ${academicYear} batch (${roster.length} students)`;
    document.getElementById("btn-save-marks").disabled = true;
    return;
  }
  document.getElementById("semester-marks-title").textContent = `${document.getElementById("detail-subject-select").selectedOptions[0]?.text || "Subject"} — ${academicYear} batch`;
  try { adminMarksData = await apiFetch(`/teacher/marks/?subject_id=${subjectId}&academic_year=${academicYear}`); renderAdminGroupedMarks(); document.getElementById("btn-save-marks").disabled=false; document.getElementById("save-confirmation").textContent=""; }
  catch (error) { body.innerHTML=`<tr><td>${error.message}</td></tr>`; document.getElementById("btn-save-marks").disabled=true; }
}
function renderAdminGroupedMarks() {
  const data=adminMarksData, columns=data.assessment_types, groups=["Assignments","Unit Tests","Attendance","Grooming","Midterm","Lab Reports","Overall Activities","Preboard"], head=document.getElementById("marks-table-head"), body=document.getElementById("marks-table-body");
  const category=(column)=>column.category || "Other", inGroup=(group)=>columns.filter((column)=>category(column)===group);
  const examStatus=(student)=>{const scores=columns.filter((column)=>["midterm","preboard","preboards"].includes(String(column.category||"").toLowerCase())).map((column)=>{const value=student.marks[String(column.id)];return value&&typeof value==="object"?value.obtained:value;}).filter((value)=>value!==""&&value!=null);return !scores.length?"–":scores.some((value)=>Number(value)<24)?"Fail":"Pass";};
  let top='<tr class="marks-group-row"><th rowspan="2" class="sticky-id">IDs</th><th rowspan="2" class="sticky-name">Name</th>';
  groups.forEach((group)=>top+=`<th colspan="${Math.max(1,inGroup(group).length)}">${group}${["Assignments","Unit Tests","Lab Reports"].includes(group) ? ` <button class="group-add-btn" data-admin-group="${group}">+ Add</button>` : ""}</th>`); top+='<th rowspan="2">Status</th><th rowspan="2">Performance</th><th rowspan="2">Board GPA<small>/4.00</small></th></tr>';
  let sub='<tr>'; groups.forEach((group)=>{const items=inGroup(group);sub+=items.length?items.map((column)=>`<th>${column.assessment_name}<small>/${column.maximum_marks} · pass ${column.pass_marks}</small><button class="col-remove-btn" data-admin-remove="${column.id}">×</button></th>`).join(""):'<th class="empty-subcolumn">No column</th>';}); sub+='</tr>'; head.innerHTML=top+sub;
  const input=(student,column)=>column?`<td><input class="mark-input" data-student="${student.id}" data-assessment="${column.id}" min="0" max="${column.maximum_marks}" step="1" type="number" value="${student.marks[String(column.id)]?.obtained ?? student.marks[String(column.id)] ?? ""}"><small class="mark-error" aria-live="polite"></small></td>`:'<td>–</td>';
  const boardInput=(student)=>`<td class="board-exam-cell"><input class="mark-input board-mark-input" data-board-student="${student.id}" data-board-id="${student.board_exam_id || ""}" min="0" max="4" step="0.01" type="number" placeholder="0.00–4.00" value="${student.board_exam ?? ""}"><small class="mark-error" aria-live="polite"></small></td>`;
  const statusFilter=document.getElementById("admin-marks-status-filter")?.value||"all", searchQuery=(document.getElementById("semester-marks-search")?.value||"").trim().toLowerCase(), students=data.students.filter((student)=>(statusFilter==="all"||examStatus(student).toLowerCase()===statusFilter)&&(!searchQuery||student.full_name.toLowerCase().includes(searchQuery)||student.registration_number.toLowerCase().includes(searchQuery)));
  body.innerHTML=students.length?students.map((student)=>{let cells=`<td class="student-id-cell">${highlightMatch(student.registration_number,searchQuery)}</td><td class="student-name-cell">${highlightMatch(student.full_name,searchQuery)}</td>`;groups.forEach((group)=>{if(group==="Attendance"){const attendance=student.performance?.categories?.Attendance?.obtained;cells+=`<td class="attendance-mark-cell">${attendance == null ? "– /15" : `${attendance} /15`}</td>`;return;}const items=inGroup(group);cells+=items.length?items.map((column)=>input(student,column)).join(""):input(student,null);});const status=examStatus(student);return `<tr>${cells}<td class="exam-status ${status.toLowerCase()}">${status}</td><td class="total-avg-cell" data-overall="${student.id}">${adminOverall(student,columns)}</td>${boardInput(student)}</tr>`;}).join(""):'<tr><td colspan="21">No students match this status.</td></tr>';
  const count=document.getElementById("semester-search-count");if(count)count.textContent=searchQuery?`${students.length} result(s)`:"";
  body.querySelectorAll("input.mark-input:not(.board-mark-input)").forEach((element)=>element.addEventListener("input",()=>{const column=columns.find((item)=>item.id===Number(element.dataset.assessment)), valid=element.value===""||(Number(element.value)>=0&&Number(element.value)<=Number(column.maximum_marks)), message=element.nextElementSibling;element.classList.toggle("invalid-mark",!valid);message.textContent=valid?"":`Please enter a value between 0 and ${column.maximum_marks}.`;element.title=message.textContent;if(valid){const student=data.students.find((item)=>item.id===Number(element.dataset.student));student.marks[String(column.id)]=element.value;body.querySelector(`[data-overall="${student.id}"]`).textContent=adminOverall(student,columns);const statusCell=element.closest("tr").querySelector(".exam-status");if(statusCell){const status=examStatus(student);statusCell.textContent=status;statusCell.className=`exam-status ${status.toLowerCase()}`;}}}));
  body.querySelectorAll(".board-mark-input").forEach((element)=>element.addEventListener("input",()=>{const valid=element.value===""||(Number(element.value)>=0&&Number(element.value)<=Number(element.max));const message=element.nextElementSibling;element.classList.toggle("invalid-mark",!valid);message.textContent=valid?"":`Please enter a value between 0 and ${element.max}.`;element.title=message.textContent;}));
  head.querySelectorAll("[data-admin-remove]").forEach((button)=>button.addEventListener("click",async()=>{if(!confirm("Are you sure? This deletes the column and all saved marks in it."))return;const password=prompt("Re-enter your current admin password to delete this column:");if(!password)return;const {subjectId,academicYear}=adminDetailContext();try{await apiFetch(`/teacher/assessment-columns/${button.dataset.adminRemove}/`,{method:"DELETE",body:{subject_id:subjectId,academic_year:academicYear,password}});await loadSemesterDetails();}catch(error){alert(error.message);}}));
  head.querySelectorAll("[data-admin-group]").forEach((button)=>button.addEventListener("click",()=>{document.getElementById("admin-column-category").value=button.dataset.adminGroup;document.getElementById("admin-column-name").focus();}));
}
function adminOverall(student,columns){if(student.performance)return `${student.performance.performance_percent}%${student.performance.is_complete ? "" : "*"}`;const used=columns.filter((column)=>student.marks[String(column.id)]!==""&&student.marks[String(column.id)]!=null);if(!used.length)return"–";return `${(used.reduce((sum,column)=>sum+Number(student.marks[String(column.id)]),0)/used.reduce((sum,column)=>sum+Number(column.maximum_marks),0)*100).toFixed(1)}%`;}
document.addEventListener("DOMContentLoaded",()=>{
  ["detail-semester-select","detail-batch-select","detail-subject-select"].forEach((id)=>document.getElementById(id)?.addEventListener("change",loadSemesterDetails));
  document.getElementById("admin-marks-status-filter")?.addEventListener("change", renderAdminGroupedMarks);
  document.getElementById("dashboard-student-search")?.addEventListener("input", renderSemesterDashboardRows);
  document.getElementById("dashboard-status-filter")?.addEventListener("change", renderSemesterDashboardRows);
  // Header checkbox is the explicit class-wide Present control.  Capture the
  // event so older attendance listeners cannot overwrite this live API state.
  document.getElementById("attendance-select-all")?.addEventListener("change", (event) => {
    if (!adminAttendanceRecords.length) return;
    event.stopImmediatePropagation();
    const present = event.target.checked;
    adminAttendanceRecords.forEach((row) => { row.status = present ? "Present" : "Absent"; });
    document.querySelectorAll(".admin-attendance-present").forEach((checkbox) => { checkbox.checked = present; });
    document.getElementById("summary-present").textContent = present ? adminAttendanceRecords.length : 0;
    document.getElementById("summary-absent").textContent = present ? 0 : adminAttendanceRecords.length;
  }, true);
  document.getElementById("btn-save-attendance")?.addEventListener("click", async (event) => {
    event.stopImmediatePropagation();
    const semester_id = Number(document.getElementById("att-semester-select").value);
    const academic_year = Number(document.getElementById("att-batch-select").value);
    const date = document.getElementById("att-date-input").value;
    const records = adminAttendanceRecords.map((row) => ({ student_id: Number(row.student_id), status: row.status === "Present" ? "Present" : "Absent" }));
    if (!semester_id || !academic_year || !date || !records.length) return alert("Select semester, batch, date, and attendance first.");
    if (date > localTodayIso()) return alert("Attendance cannot be recorded for tomorrow or a future date.");
    try {
      const result = await apiFetch("/admin/attendance/roster/", { method: "POST", body: { semester_id, academic_year, date, records } });
      const confirmation = document.getElementById("attendance-save-confirmation");
      confirmation.textContent = `Saved: ${result.present} present, ${result.absent} absent.`;
      confirmation.classList.add("show");
      await loadAttendance();
    } catch (error) { alert(error.message); }
  }, true);
  document.getElementById("btn-admin-add-column")?.addEventListener("click",async()=>{const {subjectId,academicYear}=adminDetailContext(),name=document.getElementById("admin-column-name").value.trim(),maximum=Number(document.getElementById("admin-column-maximum").value),pass=Number(document.getElementById("admin-column-pass").value),category=document.getElementById("admin-column-category").value;if(!subjectId)return alert("Create or select a subject first. Admins can manage every subject and batch once the subject exists.");if(!academicYear)return alert("Select a batch first.");if(!name||maximum<=0||pass<0||pass>maximum)return alert("Enter a column name, full marks above 0, and pass marks between 0 and full marks.");try{await apiFetch("/teacher/assessment-columns/",{method:"POST",body:{subject_id:subjectId,academic_year:academicYear,assessment_name:name,maximum_marks:maximum,pass_marks:pass,category}});document.getElementById("admin-column-name").value="";await loadSemesterDetails();}catch(error){alert(error.message);}});
  document.getElementById("btn-save-marks")?.addEventListener("click", async (event) => {
    if (!adminMarksData) return;
    event.stopImmediatePropagation();
    const confirmation = document.getElementById("save-confirmation");
    const invalid = [...document.querySelectorAll("#marks-table-body input.invalid-mark")];
    if (invalid.length) {
      confirmation.textContent = "Correct the red-mark fields shown below before saving.";
      confirmation.classList.add("show"); invalid[0].scrollIntoView({ block: "center", behavior: "smooth" }); invalid[0].focus(); return;
    }
    const { subjectId, academicYear } = adminDetailContext();
    const entries = [...document.querySelectorAll("#marks-table-body input.mark-input:not(.board-mark-input)")]
      .filter((input) => input.value !== "").map((input) => ({ student_id: Number(input.dataset.student), assessment_id: Number(input.dataset.assessment), marks_obtained: Number(input.value) }));
    const boardEntries = [...document.querySelectorAll("#marks-table-body .board-mark-input")]
      .filter((input) => input.value !== "").map((input) => ({ student_id: Number(input.dataset.boardStudent), board_id: input.dataset.boardId ? Number(input.dataset.boardId) : null, marks_obtained: Number(input.value), maximum_marks: Number(input.max) }));
    if (!entries.length && !boardEntries.length) {
      confirmation.textContent = "Enter marks or Board GPA before saving."; confirmation.classList.add("show"); return;
    }
    try {
      let updated = 0;
      if (entries.length) { const result = await apiFetch("/teacher/marks/", { method: "POST", body: { subject_id: subjectId, academic_year: academicYear, marks: entries } }); updated += result.updated; }
      await Promise.all(boardEntries.map((entry) => apiFetch(entry.board_id ? `/admin/board-marks/${entry.board_id}/` : "/admin/board-marks/", {
        method: entry.board_id ? "PATCH" : "POST",
        body: { student: entry.student_id, subject: subjectId, academic_year: academicYear, marks_obtained: entry.marks_obtained, maximum_marks: entry.maximum_marks },
      })));
      confirmation.textContent = `Saved ${updated} subject mark(s) and ${boardEntries.length} Board GPA value(s) ✓`;
      confirmation.classList.add("show"); await loadSemesterDetails();
    } catch (error) { confirmation.textContent = error.message; confirmation.classList.add("show"); }
  }, true);
  // Teacher saves are ordinary MySQL writes. Poll while the admin marks view
  // is open so newly saved teacher marks appear without a manual reload.
  setInterval(()=>{if(document.getElementById("view-semester-details")?.classList.contains("active")&&!document.activeElement?.matches("#marks-table-body input"))loadSemesterDetails();},10000);
});
