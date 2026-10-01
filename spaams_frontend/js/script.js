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
let passwordResetFlow = { username: "", otp: "", verified: false };
let otpCountdownTimer = null;
let otpExpiresAt = null;

function setResetMessage(elementId, message = "", success = false) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.classList.toggle("success", success);
}

function clearPasswordResetFlow() {
  passwordResetFlow = { username: "", otp: "", verified: false };
  otpExpiresAt = null;
  window.clearInterval(otpCountdownTimer);
  otpCountdownTimer = null;
  ["reset-request-form", "reset-verify-form", "reset-password-form"].forEach((id) => document.getElementById(id).reset());
  ["reset-request-message", "reset-verify-message", "reset-password-message"].forEach((id) => setResetMessage(id));
}

function updateOtpCountdown() {
  const countdown = document.getElementById("reset-otp-countdown");
  const verifyButton = document.getElementById("btn-verify-reset-code");
  if (!otpExpiresAt) {
    countdown.textContent = "";
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  countdown.textContent = secondsLeft ? `Code expires in ${minutes}:${seconds}` : "Code expired. Request a new code.";
  countdown.classList.toggle("expired", secondsLeft === 0);
  verifyButton.disabled = secondsLeft === 0;

  if (secondsLeft === 0) {
    window.clearInterval(otpCountdownTimer);
    otpCountdownTimer = null;
  }
}

function startOtpCountdown(expiresInSeconds = 120) {
  otpExpiresAt = Date.now() + Number(expiresInSeconds) * 1000;
  window.clearInterval(otpCountdownTimer);
  document.getElementById("btn-verify-reset-code").disabled = false;
  updateOtpCountdown();
  otpCountdownTimer = window.setInterval(updateOtpCountdown, 250);
}

/* ----------------------------------------------------------
   2. WIRE UP THE UI
   ---------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const loader = document.getElementById("app-loader");
  const loaderFill = document.getElementById("app-loader-fill");
  const loaderPercent = document.getElementById("app-loader-percent");
  const loaderTrack = loader?.querySelector("[role=progressbar]");
  if (loader && loaderFill && loaderPercent && loaderTrack) {
    let progress = 0;
    const renderLoaderProgress = () => {
      loaderFill.style.width = `${progress}%`;
      loaderPercent.textContent = `${progress}%`;
      loaderTrack.setAttribute("aria-valuenow", String(progress));
    };
    const beginLoader = () => {
      // Keep 0% visible briefly, so the counter never appears to jump.
      renderLoaderProgress();
      // Count every percentage in sequence: 100 × 15ms = about 1.5 seconds.
      window.setTimeout(() => {
        const loaderTimer = window.setInterval(() => {
          progress += 1;
          renderLoaderProgress();
          if (progress === 100) {
            window.clearInterval(loaderTimer);
            window.setTimeout(() => loader.classList.add("is-hidden"), 220);
          }
        }, 15);
      }, 50);
    };

    // Waiting for the load event guarantees the splash has been painted
    // before the visible 0% → 100% count begins.
    if (document.readyState === "complete") beginLoader();
    else window.addEventListener("load", beginLoader, { once: true });
  }

  // Get the CSRF cookie set before any POST request needs it.
  ensureCsrfCookie();

  // Landing -> Role select
  document.getElementById("btn-go-login").addEventListener("click", () => {
    showPage("page-role");
  });

  document.getElementById("btn-show-highlights").addEventListener("click", () => {
    showPage("page-highlights");
  });
  document.getElementById("btn-highlights-home").addEventListener("click", () => {
    showPage("page-landing");
  });
  document.getElementById("btn-highlights-login").addEventListener("click", () => {
    showPage("page-role");
  });

  document.querySelectorAll(".guide-step").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.guideStep;
      document.querySelectorAll(".guide-step").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      document.querySelectorAll(".guide-panel").forEach((panel) => {
        const selected = panel.dataset.guidePanel === step;
        panel.classList.toggle("active", selected);
        panel.hidden = !selected;
      });
    });
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
  document.getElementById("btn-toggle-login-password").addEventListener("click", () => {
    const passwordInput = document.getElementById("login-password");
    const reveal = passwordInput.type === "password";
    passwordInput.type = reveal ? "text" : "password";
    const button = document.getElementById("btn-toggle-login-password");
    button.textContent = reveal ? "Hide" : "Show";
    button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    button.setAttribute("aria-pressed", String(reveal));
  });

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

  // Forgotten password: three normal application pages, with the OTP checked
  // by Django before the password fields are ever shown.
  document.getElementById("btn-forgot-password").addEventListener("click", () => {
    clearPasswordResetFlow();
    document.getElementById("reset-username").value = document.getElementById("login-username").value.trim();
    showPage("page-reset-request");
  });

  document.getElementById("btn-reset-request-back").addEventListener("click", () => showPage("page-login"));
  document.getElementById("btn-reset-verify-back").addEventListener("click", () => showPage("page-reset-request"));
  document.getElementById("btn-reset-password-back").addEventListener("click", () => {
    clearPasswordResetFlow();
    showPage("page-login");
  });

  document.getElementById("reset-request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("reset-username").value.trim();
    const submitButton = document.getElementById("btn-request-reset-code");
    if (!username) return setResetMessage("reset-request-message", "Enter your username or registration number.");
    submitButton.disabled = true;
    setResetMessage("reset-request-message");
    try {
      const result = await apiRequestPasswordReset(username);
      passwordResetFlow = { username, otp: "", verified: false };
      startOtpCountdown(result.expires_in_seconds || 120);
      setResetMessage("reset-verify-message", result.message, true);
      showPage("page-reset-verify");
      document.getElementById("reset-otp").focus();
    } catch (error) {
      setResetMessage("reset-request-message", error.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById("btn-resend-reset-code").addEventListener("click", async () => {
    if (!passwordResetFlow.username) return showPage("page-reset-request");
    const button = document.getElementById("btn-resend-reset-code");
    button.disabled = true;
    try {
      const result = await apiRequestPasswordReset(passwordResetFlow.username);
      passwordResetFlow.otp = "";
      passwordResetFlow.verified = false;
      document.getElementById("reset-otp").value = "";
      startOtpCountdown(result.expires_in_seconds || 120);
      setResetMessage("reset-verify-message", result.message, true);
    } catch (error) {
      setResetMessage("reset-verify-message", error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("reset-verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const otp = document.getElementById("reset-otp").value.trim();
    const submitButton = document.getElementById("btn-verify-reset-code");
    if (!passwordResetFlow.username) return showPage("page-reset-request");
    if (!/^\d{6}$/.test(otp)) return setResetMessage("reset-verify-message", "Enter the six-digit code from your email.");
    submitButton.disabled = true;
    setResetMessage("reset-verify-message");
    try {
      await apiVerifyPasswordResetOtp(passwordResetFlow.username, otp);
      passwordResetFlow.otp = otp;
      passwordResetFlow.verified = true;
      setResetMessage("reset-password-message");
      showPage("page-reset-password");
      document.getElementById("reset-new-password").focus();
    } catch (error) {
      setResetMessage("reset-verify-message", error.message);
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById("reset-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("reset-new-password").value;
    const confirmation = document.getElementById("reset-confirm-password").value;
    const submitButton = document.getElementById("btn-save-reset-password");
    if (!passwordResetFlow.verified) return showPage("page-reset-request");
    if (password !== confirmation) return setResetMessage("reset-password-message", "New password and confirmation do not match.");
    submitButton.disabled = true;
    setResetMessage("reset-password-message");
    try {
      const result = await apiConfirmPasswordReset(passwordResetFlow.username, passwordResetFlow.otp, password, confirmation);
      const username = passwordResetFlow.username;
      clearPasswordResetFlow();
      document.getElementById("login-username").value = username;
      document.getElementById("login-password").value = "";
      document.getElementById("login-error").textContent = result.message + " You can now log in.";
      showPage("page-login");
    } catch (error) {
      setResetMessage("reset-password-message", error.message);
    } finally {
      submitButton.disabled = false;
    }
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
