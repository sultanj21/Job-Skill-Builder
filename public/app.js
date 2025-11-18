// ------------- REGISTRATION STEP HELPERS -------------

function saveStepData(stepKey, formElement) {
    const data = {};
    const inputs = formElement.querySelectorAll("input, select, textarea");
    inputs.forEach((el) => {
        if (!el.name) return;
        data[el.name] = el.value;
    });
    sessionStorage.setItem(stepKey, JSON.stringify(data));
}

function loadStepData(stepKey, formElement) {
    const raw = sessionStorage.getItem(stepKey);
    if (!raw) return;
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return;
    }
    const inputs = formElement.querySelectorAll("input, select, textarea");
    inputs.forEach((el) => {
        if (!el.name) return;
        if (data[el.name] !== undefined) {
            el.value = data[el.name];
        }
    });
}

function collectAllRegistrationData() {
    const keys = [
        "register_step_personal",
        "register_step_address",
        "register_step_college",
    ];
    const combined = {};
    keys.forEach((k) => {
        const raw = sessionStorage.getItem(k);
        if (!raw) return;
        try {
            const part = JSON.parse(raw);
            Object.assign(combined, part);
        } catch {}
    });
    return combined;
}

// ------------- SHOW / HIDE PASSWORD -------------

function setupShowPassword(toggleSelector, inputSelector) {
    const toggle = document.querySelector(toggleSelector);
    const input = document.querySelector(inputSelector);
    if (!toggle || !input) return;

    toggle.addEventListener("click", () => {
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        toggle.textContent = isPassword ? "Hide" : "Show";
    });
}

// ------------- SIMPLE ALERT BANNER -------------

function showBanner(message, type = "info") {
    let banner = document.querySelector(".banner-message");
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "banner-message";
        document.body.prepend(banner);
    }
    banner.textContent = message;
    banner.className = `banner-message banner-${type}`;
}

// ------------- LOGOUT HELPER -------------

async function handleLogout() {
    try {
        const res = await fetch("/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.success) {
            window.location.href = "/login.html";
        }
    } catch (e) {
        console.error("Logout error:", e);
    }
}

window.AppUtils = {
    saveStepData,
    loadStepData,
    collectAllRegistrationData,
    setupShowPassword,
    showBanner,
    handleLogout,
};
