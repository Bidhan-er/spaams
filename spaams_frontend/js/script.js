/* ==========================================================
   SPAAMS - script.js
   Plain JavaScript, no frameworks.

   Handles page navigation and login/password-change against the
   REAL Django backend (see js/api.js for the actual fetch() calls
   and CSRF handling — verified with curl + a cookie jar before
   this file was wired up to it).
   ========================================================== */

/* ----------------------------------------------------------
   1. PAGE NAVIGATION
   ---------------------------------------------------------- */
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.remove("active");
  });
  document.getElementById(pageId).classList.add("active");
}

// Keeps track of who is currently logged in, so the password
// change screen and dashboard redirect know who they're dealing with.
let currentUser = null;

/* ----------------------------------------------------------
   2. WIRE UP THE UI
   ---------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // Get the CSRF cookie set before any POST request needs it.
  ensureCsrfCookie();

  // Landing -> Role select
  document.getElementById("btn-go-login").addEventListener("click", () => {
    showPage("page-role");
  });

  // Role select -> Home
  document.getElementById("btn-role-home").addEventListener("click", () => {
    showPage("page-landing");
  });

  // Login page -> Home
  document.getElementById("btn-login-home").addEventListener("click", () => {
    showPage("page-landing");
  });

  // Role cards -> Login page (pre-select the matching radio button)
  document.querySelectorAll(".btn-role").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      document.getElementById(`radio-${role.toLowerCase()}`).checked = true;
      document.getElementById("login-error").textContent = "";
      showPage("page-login");
    });
  });

  // Login form submit
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const selectedRoleInput = document.querySelector('input[name="role"]:checked');
    const errorBox = document.getElementById("login-error");

    if (!selectedRoleInput) {
      errorBox.textContent = "Please select a role (Admin / Teacher / Student).";
      return;
    }

    const role = selectedRoleInput.value;
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;

    const submitBtn = document.getElementById("btn-submit-login");
    submitBtn.disabled = true;
    errorBox.textContent = "";

    try {
      const result = await apiLogin(username, password, role);
      currentUser = { fullName: result.full_name, role: result.role, firstLogin: result.first_login };

      if (currentUser.firstLogin) {
        // First-ever login with the temporary password -> force change
        showPage("page-change-password");
      } else {
        goToWelcome(currentUser);
      }
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("btn-forgot-password").addEventListener("click", async () => {
    const username = window.prompt("Enter your username (students use their registration number):");
    if (!username) return;
    try {
      await apiRequestPasswordReset(username.trim());
      const otp = window.prompt("Enter the 6-digit code sent to your email:");
      if (!otp) return;
      const newPassword = window.prompt("Enter a strong new password (at least 8 characters, not common):");
      if (!newPassword) return;
      const confirm = window.prompt("Confirm your new password:");
      await apiConfirmPasswordReset(username.trim(), otp.trim(), newPassword, confirm || "");
      document.getElementById("login-error").textContent = "Password reset. You can now log in.";
    } catch (err) { document.getElementById("login-error").textContent = err.message; }
  });

  // Forced password change submit
  document.getElementById("change-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const oldPassword = document.getElementById("old-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    const errorBox = document.getElementById("change-password-error");

    if (newPassword !== confirmPassword) {
      errorBox.textContent = "New password and confirmation do not match.";
      return;
    }

    errorBox.textContent = "";

    try {
      await apiChangePassword(oldPassword, newPassword, confirmPassword);
      currentUser.firstLogin = false;
      if (currentUser.role === "Student") {
        sessionStorage.setItem("spaams_show_student_celebration", "true");
      }
      goToWelcome(currentUser);
    } catch (err) {
      errorBox.textContent = err.message;
    }
  });

  // Logout
  document.getElementById("btn-logout").addEventListener("click", async () => {
    try {
      await apiLogout();
    } catch (err) {
      console.warn("Logout request failed (continuing to clear local state anyway):", err);
    }
    currentUser = null;
    document.getElementById("login-form").reset();
    document.getElementById("login-username").value = "";
    showPage("page-landing");
  });
});

function goToWelcome(user) {
  // All three roles now have real dashboards.
  if (user.role === "Admin") {
    window.location.href = "admin-dashboard.html";
    return;
  }
  if (user.role === "Teacher") {
    window.location.href = "teacher-dashboard.html";
    return;
  }
  if (user.role === "Student") {
    window.location.href = "student-dashboard.html";
    return;
  }

  document.getElementById("welcome-title").textContent = `Welcome, ${user.fullName}`;
  document.getElementById(
    "welcome-subtitle"
  ).textContent = `${user.role} dashboard will be built here next`;
  showPage("page-welcome");
}
