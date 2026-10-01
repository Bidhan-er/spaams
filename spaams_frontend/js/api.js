/* ==========================================================
   api.js — shared helper for talking to the real Django backend.

   This replaces every mock function that was previously faking
   this behavior in-browser. Every function here maps directly to
   one of the endpoints verified by hand (curl + cookie jar)
   before this file was written:
     - CSRF cookie flow:     GET  /api/auth/csrf/
     - Login:                POST /api/auth/login/
     - Change password:      POST /api/auth/change-password/
     - Logout:                POST /api/auth/logout/
   ========================================================== */

// Change this if your backend runs somewhere else.
// Use the current SPAAMS backend process. It reads the local SMS Pasal
// configuration from spaams_backend/.env when it starts.
const API_BASE = "http://127.0.0.1:8004/api";

/**
 * Reads the csrftoken cookie Django sets. Returns "" if it hasn't
 * been set yet (call ensureCsrfCookie() first, on page load).
 */
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Forces Django to actually WRITE the csrftoken cookie. A plain
 * JSON API never sets this cookie on its own — verified by testing
 * before this fix existed (a curl request with no prior call to
 * this endpoint received no cookie at all).
 */
async function ensureCsrfCookie() {
  await fetch(`${API_BASE}/auth/csrf/`, { credentials: "include" });
}

/**
 * A fetch() wrapper that:
 *   - always sends the session cookie (credentials: "include")
 *   - automatically attaches the CSRF header on unsafe methods
 *   - parses JSON responses and throws on non-2xx so callers can
 *     just try/catch instead of checking response.ok everywhere
 */
async function apiFetch(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (unsafe) {
    headers["X-CSRFToken"] = getCsrfToken();
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // some endpoints (e.g. plain 204s) may not return a body
  }

  if (!response.ok) {
    if (!path.startsWith("/auth/") && (response.status === 401 || (response.status === 403 && /authentication credentials/i.test(data?.detail || data?.message || "")))) {
      const error = new Error("Your login session has expired. Please log out and sign in as Admin again.");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    const fieldMessages = data && typeof data === "object"
      ? Object.entries(data).filter(([key]) => !["message", "detail"].includes(key)).map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(" ") : value}`).join("\n")
      : "";
    const error = new Error(data?.message || data?.detail || fieldMessages || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/* ----------------------------------------------------------
   Auth API — direct replacements for the old mock functions
   ---------------------------------------------------------- */
async function apiLogin(username, password, role) {
  return apiFetch("/auth/login/", { method: "POST", body: { username, password, role } });
}

async function apiChangePassword(oldPassword, newPassword, confirmPassword) {
  return apiFetch("/auth/change-password/", {
    method: "POST",
    body: { old_password: oldPassword, new_password: newPassword, confirm_password: confirmPassword },
  });
}

async function apiLogout() {
  return apiFetch("/auth/logout/", { method: "POST" });
}

async function apiRequestPasswordReset(username) {
  return apiFetch("/auth/forgot-password/", { method: "POST", body: { username } });
}

async function apiVerifyPasswordResetOtp(username, otp) {
  return apiFetch("/auth/verify-reset-otp/", { method: "POST", body: { username, otp } });
}

async function apiConfirmPasswordReset(username, otp, newPassword, confirmPassword) {
  return apiFetch("/auth/reset-password/", { method: "POST", body: { username, otp, new_password: newPassword, confirm_password: confirmPassword } });
}
