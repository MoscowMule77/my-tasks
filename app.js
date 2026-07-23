(function () {
  let supa = null;
  let user = null;
  let tasks = [];
  let lists = [];           // [{id, name, ...}]
  let activeFilter = "All"; // "All" or a list id
  let managing = false;
  let themeOpen = false;
  let searchQuery = "";
  let sortMode = "manual"; // "manual" or "due"
  let view = "board"; // "board" or "calendar"
  let calMode = "month"; // "month" | "week" | "day"
  let calDate = new Date(); // reference date for the calendar period
  const expanded = new Set(); // task ids whose notes are open
  const collapsed = new Set(); // list ids that are collapsed

  (function loadView() {
    const v = localStorage.getItem("mytasks-view"); if (v === "calendar" || v === "board") view = v;
    const m = localStorage.getItem("mytasks-calmode"); if (m === "month" || m === "week" || m === "day") calMode = m;
  })();
  const dueEditing = new Set(); // task ids currently picking a due date

  const $ = (id) => document.getElementById(id);

  // Restore collapsed columns.
  (function loadCollapsed() {
    try {
      const arr = JSON.parse(localStorage.getItem("mytasks-collapsed"));
      if (Array.isArray(arr)) arr.forEach((id) => collapsed.add(id));
    } catch (e) { /* ignore */ }
  })();

  function toggleCollapse(listId) {
    if (collapsed.has(listId)) collapsed.delete(listId); else collapsed.add(listId);
    localStorage.setItem("mytasks-collapsed", JSON.stringify([...collapsed]));
    renderBoard();
  }

  // --- Colour themes ---
  const THEMES = {
    Indigo:  { "--accent": "#4f6df5", "--accent-soft": "#eaeefe", "--bg": "#f4f5f7", "--card": "#ffffff", "--text": "#1d2330", "--line": "#e7e9ef", "--muted": "#8a93a6", "--done": "#aab2c2" },
    Emerald: { "--accent": "#10b981", "--accent-soft": "#e2f6ef", "--bg": "#f4f6f5", "--card": "#ffffff", "--text": "#1d2330", "--line": "#e3ebe7", "--muted": "#8a968f", "--done": "#aab2c2" },
    Rose:    { "--accent": "#e3506a", "--accent-soft": "#fce9ed", "--bg": "#f7f5f6", "--card": "#ffffff", "--text": "#1d2330", "--line": "#ece6e9", "--muted": "#9a8f93", "--done": "#c2aab2" },
    Amber:   { "--accent": "#df8a16", "--accent-soft": "#fbeed7", "--bg": "#f7f6f3", "--card": "#ffffff", "--text": "#1d2330", "--line": "#ece7df", "--muted": "#9a948a", "--done": "#c2bca8" },
    Violet:  { "--accent": "#8b5cf6", "--accent-soft": "#f0eafe", "--bg": "#f6f5f8", "--card": "#ffffff", "--text": "#1d2330", "--line": "#e9e7ec", "--muted": "#928fa0", "--done": "#b2aac2" },
    Slate:   { "--accent": "#475569", "--accent-soft": "#e7ebef", "--bg": "#f4f5f7", "--card": "#ffffff", "--text": "#1d2330", "--line": "#e2e7ec", "--muted": "#8a93a6", "--done": "#aab2c2" },
    Dark:    { "--accent": "#6d8bff", "--accent-soft": "#2a3050", "--bg": "#14161e", "--card": "#1e222e", "--text": "#e6e9f1", "--line": "#2d3342", "--muted": "#8a93a6", "--done": "#586074" }
  };

  function applyVars(vars) {
    Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
  }

  // Light tint of a hex colour, for the "soft" accent background.
  function softTint(hex) {
    const c = hex.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    const mix = (x) => Math.round(x + (255 - x) * 0.88);
    return "rgb(" + mix(r) + "," + mix(g) + "," + mix(b) + ")";
  }

  function setTheme(name) {
    if (!THEMES[name]) return;
    applyVars(THEMES[name]);
    localStorage.setItem("mytasks-theme", JSON.stringify({ type: "preset", name }));
    if (themeOpen) renderThemePanel();
  }

  function setCustomAccent(hex) {
    applyVars({ "--accent": hex, "--accent-soft": softTint(hex) });
    localStorage.setItem("mytasks-theme", JSON.stringify({ type: "accent", hex }));
    if (themeOpen) renderThemePanel();
  }

  function loadSavedTheme() {
    try {
      const s = JSON.parse(localStorage.getItem("mytasks-theme"));
      if (!s) return;
      if (s.type === "preset" && THEMES[s.name]) applyVars(THEMES[s.name]);
      else if (s.type === "accent") applyVars({ "--accent": s.hex, "--accent-soft": softTint(s.hex) });
    } catch (e) { /* ignore */ }
  }

  function currentThemeName() {
    try {
      const s = JSON.parse(localStorage.getItem("mytasks-theme"));
      return s && s.type === "preset" ? s.name : null;
    } catch (e) { return null; }
  }

  function renderThemePanel() {
    const box = $("swatches");
    box.innerHTML = "";
    const active = currentThemeName();
    Object.keys(THEMES).forEach((name) => {
      const sw = document.createElement("button");
      sw.className = "swatch" + (name === active ? " active" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = THEMES[name]["--accent"];
      const lbl = document.createElement("span");
      lbl.textContent = name;
      sw.append(dot, lbl);
      sw.addEventListener("click", () => setTheme(name));
      box.appendChild(sw);
    });
  }

  loadSavedTheme();

  // --- Check config ---
  const configured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
  if (!configured) {
    $("setupBanner").classList.remove("hidden");
    $("authView").classList.remove("hidden");
    $("signInBtn").disabled = true;
    $("createBtn").disabled = true;
    $("authNote").textContent = "Add your Supabase keys to enable sign-in.";
    $("authNote").className = "note err";
    return;
  }

  supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- Auth ---
  let recovering = false; // true while the user is following a reset-password link

  async function init() {
    const { data } = await supa.auth.getSession();
    setUser(data.session ? data.session.user : null);
    supa.auth.onAuthStateChange((event, session) => {
      // When the user clicks the reset link in their email, Supabase fires this event.
      if (event === "PASSWORD_RECOVERY") { recovering = true; showPwView("recovery"); return; }
      if (recovering) return; // stay on the set-password screen until they finish
      setUser(session ? session.user : null);
    });
  }

  function setUser(u) {
    user = u;
    if (user) {
      $("authView").classList.add("hidden");
      $("pwView").classList.add("hidden");
      $("appView").classList.remove("hidden");
      $("appHeader").classList.remove("hidden");
      $("whoEmail").textContent = user.email;
      loadAll();
    } else {
      $("authView").classList.remove("hidden");
      $("pwView").classList.add("hidden");
      $("appView").classList.add("hidden");
      $("appHeader").classList.add("hidden");
    }
  }

  // Show the set/change-password screen. mode: "recovery" (from email link) or "change" (logged in).
  function showPwView(mode) {
    $("authView").classList.add("hidden");
    $("appView").classList.add("hidden");
    $("appHeader").classList.toggle("hidden", mode !== "change");
    $("pwView").classList.remove("hidden");
    $("newPwInput").value = "";
    $("pwNote").textContent = "";
    $("pwTitle").textContent = mode === "recovery" ? "Reset your password" : "Change password";
    $("pwSub").textContent = "Choose a new password (10+ characters).";
    $("newPwInput").focus();
  }

  async function doSignIn() {
    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    const note = $("authNote");
    if (!email || !password) { note.textContent = "Enter your email and password."; note.className = "note err"; return; }
    $("signInBtn").disabled = true;
    note.textContent = "Signing in…"; note.className = "note";
    const { error } = await supa.auth.signInWithPassword({ email, password });
    $("signInBtn").disabled = false;
    if (error) {
      note.textContent = error.message.includes("Invalid login")
        ? "Wrong email or password. New here? Tap \"Create an account\"."
        : error.message;
      note.className = "note err";
    }
  }

  async function doSignUp() {
    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    const note = $("authNote");
    if (!email || !password) { note.textContent = "Enter an email and a password (10+ characters)."; note.className = "note err"; return; }
    if (password.length < 10) { note.textContent = "Password must be at least 10 characters."; note.className = "note err"; return; }
    $("createBtn").disabled = true;
    note.textContent = "Creating your account…"; note.className = "note";
    const { data, error } = await supa.auth.signUp({ email, password });
    $("createBtn").disabled = false;
    if (error) { note.textContent = error.message; note.className = "note err"; return; }
    if (!data.session) {
      note.textContent = "Account created — now tap \"Sign in\".";
      note.className = "note ok";
    }
    // If a session is returned (email confirmation off), onAuthStateChange logs you straight in.
  }

  // Send a password-reset email.
  async function doForgot() {
    const email = $("emailInput").value.trim();
    const note = $("authNote");
    if (!email) { note.textContent = "Type your email above first, then tap \"Forgot password?\"."; note.className = "note err"; return; }
    $("forgotBtn").disabled = true;
    note.textContent = "Sending reset link…"; note.className = "note";
    const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    $("forgotBtn").disabled = false;
    if (error) { note.textContent = error.message; note.className = "note err"; }
    else { note.textContent = "Check your email for a reset link ✉️ (it can take a minute)."; note.className = "note ok"; }
  }

  // Save a new password (used by both recovery and change flows).
  async function savePassword() {
    const pw = $("newPwInput").value;
    const note = $("pwNote");
    if (pw.length < 10) { note.textContent = "Password must be at least 10 characters."; note.className = "note err"; return; }
    $("savePwBtn").disabled = true;
    note.textContent = "Saving…"; note.className = "note";
    const { error } = await supa.auth.updateUser({ password: pw });
    $("savePwBtn").disabled = false;
    if (error) { note.textContent = error.message; note.className = "note err"; return; }
    recovering = false;
    const { data } = await supa.auth.getSession();
    note.textContent = "Password updated ✓";
    setUser(data.session ? data.session.user : null);
  }

  $("signInBtn").addEventListener("click", doSignIn);
  $("createBtn").addEventListener("click", doSignUp);
  $("forgotBtn").addEventListener("click", doForgot);
  $("passwordInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doSignIn(); });
  $("emailInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("passwordInput").focus(); });
  $("logoutBtn").addEventListener("click", async () => { await supa.auth.signOut(); });
  $("pwBtn").addEventListener("click", () => showPwView("change"));
  $("savePwBtn").addEventListener("click", savePassword);
  $("newPwInput").addEventListener("keydown", (e) => { if (e.key === "Enter") savePassword(); });
  $("cancelPwBtn").addEventListener("click", () => {
    recovering = false;
    if (user) { $("pwView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("appHeader").classList.remove("hidden"); }
    else { $("pwView").classList.add("hidden"); $("authView").classList.remove("hidden"); }
  });

  // --- Load lists + tasks ---
  async function loadAll() {
    await loadLists();
    // First-time users get a starter list so the app is usable right away.
    if (lists.length === 0) {
      await createList("Personal", true);
      await loadLists();
    }
    await loadTasks();
  }

  async function loadLists() {
    const { data, error } = await supa
      .from("lists").select("*")
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    lists = data || [];
  }

  async function loadTasks() {
    const { data, error } = await supa
      .from("todos").select("*")
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    tasks = data || [];
    render();
  }

  // Tasks of one list, in display order.
  function listTasks(listId) {
    return tasks.filter((t) => t.list_id === listId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  // Write a list's task order (and list membership) to the database.
  function persistTaskOrder(listId, ordered) {
    ordered.forEach((t, i) => { t.position = i + 1; t.list_id = listId; });
    ordered.forEach((t) => {
      supa.from("todos").update({ position: t.position, list_id: t.list_id }).eq("id", t.id)
        .then(({ error }) => { if (error) console.error(error); });
    });
  }

  // --- List operations ---
  async function createList(name, silent) {
    const clean = (name || "").trim();
    if (!clean) return;
    const maxPos = lists.reduce((m, l) => Math.max(m, l.position || 0), 0);
    const { data, error } = await supa.from("lists").insert({ name: clean, position: maxPos + 1 }).select().single();
    if (error) { console.error(error); if (!silent) alert("Could not add list: " + error.message); return; }
    lists.push(data);
    if (!silent) render();
  }

  // --- Auto-overflow: cap a list at 10 items, spilling into a same-named list beside it ---
  const LIST_CAP = 10;

  // Return a list id (the given list or a same-named sibling) that has room, creating
  // a new same-named list immediately after if all siblings are full.
  async function ensureRoom(listId) {
    const l = lists.find((x) => x.id === listId);
    if (!l) return listId;
    const siblings = lists.filter((x) => x.name === l.name); // already in display order
    for (const s of siblings) {
      if (tasks.filter((t) => t.list_id === s.id).length < LIST_CAP) return s.id;
    }
    const last = siblings[siblings.length - 1] || l;
    const created = await createListAfter(l.name, last.id);
    return created ? created.id : listId;
  }

  // Create a list immediately after another one, shifting the rest along.
  async function createListAfter(name, afterListId) {
    const idx = lists.findIndex((x) => x.id === afterListId);
    const { data, error } = await supa.from("lists").insert({ name }).select().single();
    if (error) { console.error(error); alert("Could not add list: " + error.message); return null; }
    lists.splice(idx < 0 ? lists.length : idx + 1, 0, data);
    persistPositions();
    return data;
  }

  // Re-number positions to match the current array order, and save to Supabase.
  function persistPositions() {
    lists.forEach((l, i) => { l.position = i + 1; });
    lists.forEach((l) => {
      supa.from("lists").update({ position: l.position }).eq("id", l.id)
        .then(({ error }) => { if (error) console.error(error); });
    });
  }

  // --- Drag-to-resize a list ---
  function applyListSize(col, l) {
    if (l.width) {
      col.style.flex = "0 0 " + l.width + "px";
      col.style.width = l.width + "px";
      col.style.minWidth = l.width + "px";
      col.style.maxWidth = l.width + "px";
    }
    if (l.height) {
      col.style.height = l.height + "px";
      col.style.maxHeight = l.height + "px";
    }
  }

  function persistListSize(l) {
    supa.from("lists").update({ width: l.width || null, height: l.height || null }).eq("id", l.id)
      .then(({ error }) => { if (error) console.error(error); });
  }

  function startResize(e, col, l) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, sw = col.offsetWidth, sh = col.offsetHeight;
    let nw = sw, nh = sh;
    const mm = (ev) => {
      nw = Math.max(190, Math.min(720, sw + (ev.clientX - sx)));
      nh = Math.max(140, Math.min(window.innerHeight - 90, sh + (ev.clientY - sy)));
      col.style.flex = "0 0 " + nw + "px"; col.style.width = nw + "px"; col.style.minWidth = nw + "px"; col.style.maxWidth = nw + "px";
      col.style.height = nh + "px"; col.style.maxHeight = nh + "px";
    };
    const mu = () => {
      document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu);
      document.body.style.userSelect = "";
      l.width = Math.round(nw); l.height = Math.round(nh);
      persistListSize(l);
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
  }

  function resetListSize(l) {
    l.width = null; l.height = null;
    persistListSize(l);
    render();
  }

  // Move a list up (dir = -1) or down (dir = +1) — used by the arrow buttons.
  function moveList(id, dir) {
    const i = lists.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lists.length) return;
    const tmp = lists[i]; lists[i] = lists[j]; lists[j] = tmp;
    persistPositions();
    render();
  }

  // Move a list to the very end (bottom row) — used by the bottom drop zone.
  function moveListToEnd(id) {
    const i = lists.findIndex((x) => x.id === id);
    if (i < 0 || i === lists.length - 1) return;
    const [moved] = lists.splice(i, 1);
    lists.push(moved);
    persistPositions();
    render();
  }

  // Drop list `fromId` at the position of `toId` — used by drag and drop.
  function reorderListByDrag(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const from = lists.findIndex((x) => x.id === fromId);
    const to = lists.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = lists.splice(from, 1);
    lists.splice(to, 0, moved);
    persistPositions();
    render();
  }

  async function renameList(id, name) {
    const clean = (name || "").trim();
    if (!clean) return;
    const l = lists.find((x) => x.id === id);
    if (l) l.name = clean;
    const { error } = await supa.from("lists").update({ name: clean }).eq("id", id);
    if (error) { console.error(error); loadAll(); }
  }

  async function deleteList(id) {
    const l = lists.find((x) => x.id === id);
    const taskCount = tasks.filter((t) => t.list_id === id).length;
    const msg = taskCount > 0
      ? `Delete "${l ? l.name : "this list"}" and its ${taskCount} task(s)?`
      : `Delete "${l ? l.name : "this list"}"?`;
    if (!confirm(msg)) return;
    lists = lists.filter((x) => x.id !== id);
    tasks = tasks.filter((t) => t.list_id !== id); // server cascade-deletes these
    if (activeFilter === id) activeFilter = "All";
    render();
    const { error } = await supa.from("lists").delete().eq("id", id);
    if (error) { console.error(error); loadAll(); }
  }

  // Move all of one list's tasks into another, then delete the (now empty) list.
  async function mergeList(fromId, intoId) {
    if (!intoId || fromId === intoId) return;
    const from = lists.find((x) => x.id === fromId);
    const into = lists.find((x) => x.id === intoId);
    const moving = listTasks(fromId);
    const msg = "Move " + moving.length + " task(s) from \"" + (from ? from.name : "") +
      "\" into \"" + (into ? into.name : "") + "\", then delete \"" + (from ? from.name : "") + "\"?";
    if (!confirm(msg)) { render(); return; }
    const base = tasks.filter((t) => t.list_id === intoId).reduce((m, t) => Math.max(m, t.position || 0), 0);
    moving.forEach((t, i) => { t.list_id = intoId; t.position = base + i + 1; });
    lists = lists.filter((x) => x.id !== fromId);
    if (activeFilter === fromId) activeFilter = "All";
    render();
    // Persist moved tasks first; only delete the list if they all saved (so nothing is lost).
    let failed = false;
    for (const t of moving) {
      const { error } = await supa.from("todos").update({ list_id: intoId, position: t.position }).eq("id", t.id);
      if (error) { console.error(error); failed = true; }
    }
    if (failed) { loadAll(); return; }
    const { error } = await supa.from("lists").delete().eq("id", fromId);
    if (error) { console.error(error); loadAll(); }
  }

  // --- Task operations ---
  async function addTaskToList(listId, inputEl) {
    const title = inputEl.value.trim();
    if (!title || !listId) return;
    inputEl.value = "";
    const targetId = await ensureRoom(listId); // spill into a new same-named list if this one is full
    const maxPos = tasks.filter((t) => t.list_id === targetId).reduce((m, t) => Math.max(m, t.position || 0), 0);
    const { data, error } = await supa
      .from("todos").insert({ title, list_id: targetId, done: false, position: maxPos + 1 }).select().single();
    if (error) { console.error(error); alert("Could not add task: " + error.message); return; }
    tasks.push(data);
    render();
    // keep focus in the same column's input for fast entry
    const again = document.querySelector('.col-add input[data-list="' + listId + '"]');
    if (again) again.focus();
  }

  // Move a task up/down within its completion group (active or done), keeping done at the bottom.
  function moveTaskWithinList(t, dir) {
    const ordered = displayTasks(t.list_id);
    const active = ordered.filter((x) => !x.done);
    const done = ordered.filter((x) => x.done);
    const group = t.done ? done : active;
    const i = group.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const tmp = group[i]; group[i] = group[j]; group[j] = tmp;
    persistTaskOrder(t.list_id, active.concat(done));
    render();
  }

  // Move a task into a list, optionally before a specific task (for drag-and-drop).
  function moveTaskToList(taskId, targetListId, beforeTaskId) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const fromList = t.list_id;
    let target = listTasks(targetListId).filter((x) => x.id !== taskId);
    if (beforeTaskId && beforeTaskId !== taskId) {
      const idx = target.findIndex((x) => x.id === beforeTaskId);
      if (idx >= 0) target.splice(idx, 0, t); else target.push(t);
    } else {
      target.push(t);
    }
    t.list_id = targetListId;
    persistTaskOrder(targetListId, target);
    if (fromList !== targetListId) persistTaskOrder(fromList, listTasks(fromList).filter((x) => x.id !== taskId));
    render();
  }

  async function toggleTask(t) {
    const newDone = !t.done;
    t.done = newDone;
    render();
    const { error } = await supa.from("todos").update({ done: newDone }).eq("id", t.id);
    if (error) { console.error(error); t.done = !newDone; render(); }
  }

  async function deleteTask(t) {
    tasks = tasks.filter((x) => x.id !== t.id);
    render();
    const { error } = await supa.from("todos").delete().eq("id", t.id);
    if (error) { console.error(error); loadTasks(); }
  }

  // Inline-edit a task title (double-click the title).
  function editTitle(t, titleEl) {
    const input = document.createElement("input");
    input.className = "title-edit";
    input.value = t.title;
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    titleEl.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (v && v !== t.title) {
        t.title = v;
        const { error } = await supa.from("todos").update({ title: v }).eq("id", t.id);
        if (error) { console.error(error); loadTasks(); return; }
      }
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { done = true; render(); }
    });
    input.addEventListener("blur", commit);
  }

  // Move a task to the bottom of a different list (used by the "Move to…" menu).
  async function reassignTask(t, newListId) {
    if (!newListId || newListId === t.list_id) return;
    const targetId = await ensureRoom(newListId); // spill into a same-named list if full
    moveTaskToList(t.id, targetId, null);
  }

  // Set or clear a task's due date (value is "YYYY-MM-DD" or "").
  async function setDue(t, value) {
    const due = value || null;
    t.due_date = due;
    render();
    const { error } = await supa.from("todos").update({ due_date: due }).eq("id", t.id);
    if (error) { console.error(error); loadTasks(); }
  }

  // Delete all completed tasks in a list.
  async function clearCompleted(listId) {
    const doneTasks = tasks.filter((t) => t.list_id === listId && t.done);
    if (!doneTasks.length) return;
    if (!confirm("Delete " + doneTasks.length + " completed task(s) in this list?")) return;
    const ids = doneTasks.map((t) => t.id);
    tasks = tasks.filter((t) => !ids.includes(t.id));
    render();
    const { error } = await supa.from("todos").delete().in("id", ids);
    if (error) { console.error(error); loadTasks(); }
  }

  // Returns "overdue" | "today" | "" for a YYYY-MM-DD date string.
  function dueStatus(due) {
    if (!due) return "";
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(due + "T00:00:00");
    if (d < today) return "overdue";
    if (d.getTime() === today.getTime()) return "today";
    return "";
  }

  // Save a task's notes.
  async function setNotes(t, value) {
    const notes = value.trim() || null;
    t.notes = notes;
    const { error } = await supa.from("todos").update({ notes }).eq("id", t.id);
    if (error) console.error(error);
  }

  // --- Subtasks (a checklist stored on the task) ---
  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(16).slice(2));
  }
  async function saveSubtasks(t) {
    const { error } = await supa.from("todos").update({ subtasks: t.subtasks || [] }).eq("id", t.id);
    if (error) console.error(error);
  }
  function addSubtask(t, title) {
    const v = (title || "").trim();
    if (!v) return;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    t.subtasks.push({ id: uid(), title: v, done: false });
    saveSubtasks(t); render();
    const again = document.querySelector('.sub-add[data-sub="' + t.id + '"]');
    if (again) again.focus();
  }
  function toggleSubtask(t, id) {
    const s = (t.subtasks || []).find((x) => x.id === id);
    if (!s) return;
    s.done = !s.done;
    saveSubtasks(t); render();
  }
  function deleteSubtask(t, id) {
    t.subtasks = (t.subtasks || []).filter((x) => x.id !== id);
    saveSubtasks(t); render();
  }

  // Tasks of a list in the current display order (manual position, or by due date),
  // with completed tasks always sunk to the bottom.
  function displayTasks(listId) {
    let arr = listTasks(listId);
    if (sortMode === "due") {
      arr = arr.slice().sort((a, b) => {
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : (a.due_date > b.due_date ? 1 : 0);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return 0;
      });
    }
    return arr.filter((t) => !t.done).concat(arr.filter((t) => t.done));
  }

  // Number of overdue, not-done tasks across all lists.
  function overdueCount() {
    return tasks.filter((t) => !t.done && dueStatus(t.due_date) === "overdue").length;
  }

  // Restore saved sort preference.
  (function loadSort() {
    const s = localStorage.getItem("mytasks-sort");
    if (s === "due" || s === "manual") sortMode = s;
  })();

  // Bottom drop zone: drag a list header here to send it to the end (next row).
  $("boardDrop").addEventListener("dragover", (e) => { e.preventDefault(); $("boardDrop").classList.add("drop-target"); });
  $("boardDrop").addEventListener("dragleave", () => $("boardDrop").classList.remove("drop-target"));
  $("boardDrop").addEventListener("drop", (e) => {
    e.preventDefault();
    $("boardDrop").classList.remove("drop-target");
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("col:")) moveListToEnd(data.slice(4));
  });

  $("manageBtn").addEventListener("click", () => { managing = !managing; render(); });
  $("themeBtn").addEventListener("click", () => {
    themeOpen = !themeOpen;
    $("themePanel").classList.toggle("hidden", !themeOpen);
    if (themeOpen) renderThemePanel();
  });
  $("accentPicker").addEventListener("input", (e) => setCustomAccent(e.target.value));
  $("calBtn").addEventListener("click", () => {
    const panel = $("calPanel");
    const open = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !open);
    if (open) {
      $("calUrl").value = feedUrl();
      $("calNote").textContent = "";
      updateCalendarFeed(); // make sure the feed file exists/refreshed
    }
  });
  $("calCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(feedUrl()); $("calNote").textContent = "Link copied ✓"; $("calNote").className = "note ok"; }
    catch (e) { $("calUrl").select(); $("calNote").textContent = "Press Cmd+C to copy."; $("calNote").className = "note"; }
  });
  $("backupBtn").addEventListener("click", () => {
    const p = $("backupPanel");
    const opening = p.classList.contains("hidden");
    p.classList.toggle("hidden", !opening);
    if (opening) { $("backupNote").textContent = ""; $("backupNote").className = "note"; }
  });
  $("exportBtn").addEventListener("click", exportBackup);
  $("importFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importBackup(f);
    e.target.value = ""; // allow re-selecting the same file
  });
  $("viewBoardBtn").addEventListener("click", () => { view = "board"; localStorage.setItem("mytasks-view", "board"); render(); });
  $("viewCalBtn").addEventListener("click", () => { view = "calendar"; localStorage.setItem("mytasks-view", "calendar"); render(); });
  $("searchInput").addEventListener("input", (e) => { searchQuery = e.target.value.trim().toLowerCase(); renderBoard(); });
  $("sortSelect").addEventListener("change", (e) => { sortMode = e.target.value; localStorage.setItem("mytasks-sort", sortMode); renderBoard(); });
  $("addListBtn").addEventListener("click", async () => {
    await createList($("newListInput").value);
    $("newListInput").value = "";
  });
  $("newListInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addListBtn").click(); });

  function listName(id) {
    const l = lists.find((x) => x.id === id);
    return l ? l.name : "—";
  }

  // --- Backup & restore ---
  function exportBackup() {
    const data = {
      app: "my-tasks", version: 1,
      exported_at: new Date().toISOString(),
      lists: lists.map((l) => ({ id: l.id, name: l.name, position: l.position, width: l.width, height: l.height })),
      tasks: tasks.map((t) => ({
        id: t.id, list_id: t.list_id, title: t.title, done: t.done, position: t.position,
        due_date: t.due_date, notes: t.notes, subtasks: t.subtasks || []
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-tasks-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const n = $("backupNote");
    n.textContent = "Backup downloaded (" + data.lists.length + " lists, " + data.tasks.length + " tasks) ✓";
    n.className = "note ok";
  }

  async function importBackup(file) {
    const n = $("backupNote");
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { n.textContent = "That file isn't valid JSON."; n.className = "note err"; return; }
    if (!data || !Array.isArray(data.lists) || !Array.isArray(data.tasks)) {
      n.textContent = "That doesn't look like a My Tasks backup file."; n.className = "note err"; return;
    }
    const msg = "This will REPLACE everything in your account with the backup:\n\n" +
      data.lists.length + " lists and " + data.tasks.length + " tasks.\n\nYour current data will be deleted. Continue?";
    if (!confirm(msg)) return;

    n.textContent = "Restoring…"; n.className = "note";
    // 1. Remove current lists (tasks cascade-delete with them)
    const currentIds = lists.map((l) => l.id);
    if (currentIds.length) {
      const { error } = await supa.from("lists").delete().in("id", currentIds);
      if (error) { n.textContent = "Restore failed: " + error.message; n.className = "note err"; return; }
    }
    // 2. Recreate lists, mapping old ids -> new ids
    const idMap = {};
    for (const l of data.lists) {
      const { data: nl, error } = await supa.from("lists")
        .insert({ name: l.name, position: l.position, width: l.width, height: l.height }).select().single();
      if (error) { n.textContent = "Restore failed: " + error.message; n.className = "note err"; return; }
      idMap[l.id] = nl.id;
    }
    // 3. Recreate tasks against the new list ids
    const rows = data.tasks
      .map((t) => ({
        title: t.title, list_id: idMap[t.list_id], done: !!t.done, position: t.position,
        due_date: t.due_date || null, notes: t.notes || null, subtasks: t.subtasks || []
      }))
      .filter((r) => r.list_id);
    if (rows.length) {
      const { error } = await supa.from("todos").insert(rows);
      if (error) { n.textContent = "Restore failed: " + error.message; n.className = "note err"; return; }
    }
    await loadAll();
    n.textContent = "Restore complete — " + data.lists.length + " lists and " + rows.length + " tasks restored ✓";
    n.className = "note ok";
  }

  // --- Calendar (.ics) feed ---
  function feedUrl() {
    return user ? (SUPABASE_URL + "/storage/v1/object/public/calendar/" + user.id + ".ics") : "";
  }

  function buildICS() {
    const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    const ymd = (d) => d.replace(/-/g, "");
    const nextDay = (d) => { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + 1); return dt.toISOString().slice(0, 10).replace(/-/g, ""); };
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//My Tasks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:My Tasks", "NAME:My Tasks"];
    tasks.filter((t) => t.due_date).forEach((t) => {
      out.push("BEGIN:VEVENT");
      out.push("UID:" + t.id + "@mytasks");
      out.push("DTSTAMP:" + stamp);
      out.push("DTSTART;VALUE=DATE:" + ymd(t.due_date));
      out.push("DTEND;VALUE=DATE:" + nextDay(t.due_date));
      out.push("SUMMARY:" + esc((t.done ? "✓ " : "") + t.title));
      out.push("DESCRIPTION:" + esc((t.notes ? t.notes + "\n" : "") + "List: " + listName(t.list_id)));
      out.push("END:VEVENT");
    });
    out.push("END:VCALENDAR");
    return out.join("\r\n");
  }

  let calTimer = null;
  function scheduleCalendarUpdate() {
    if (!user || !supa) return;
    clearTimeout(calTimer);
    calTimer = setTimeout(updateCalendarFeed, 2500);
  }
  async function updateCalendarFeed() {
    if (!user || !supa) return;
    try {
      const blob = new Blob([buildICS()], { type: "text/calendar" });
      const { error } = await supa.storage.from("calendar")
        .upload(user.id + ".ics", blob, { contentType: "text/calendar", upsert: true, cacheControl: "60" });
      if (error) console.error("calendar upload:", error);
    } catch (e) { console.error(e); }
  }

  // --- Render ---
  function render() {
    renderManagePanel();
    renderView();
    scheduleCalendarUpdate();
  }

  function renderView() {
    const boardOn = view === "board";
    $("viewBoardBtn").classList.toggle("active", boardOn);
    $("viewCalBtn").classList.toggle("active", !boardOn);
    $("board").classList.toggle("hidden", !boardOn);
    $("boardDrop").classList.toggle("hidden", !boardOn);
    $("calView").classList.toggle("hidden", boardOn);
    // overdue badge is shared across both views
    const oc = overdueCount();
    const badge = $("overdueBadge");
    if (oc > 0) { badge.textContent = "⚠ " + oc + " overdue"; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
    if (boardOn) renderBoard(); else renderCalendar();
  }

  // --- Calendar view ---
  const CAL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const CAL_WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function ymdLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }
  function shiftCal(dir) {
    const d = new Date(calDate);
    if (calMode === "month") d.setMonth(d.getMonth() + dir);
    else if (calMode === "week") d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + dir);
    calDate = d; render();
  }
  function calLabel() {
    if (calMode === "month") return CAL_MONTHS[calDate.getMonth()] + " " + calDate.getFullYear();
    if (calMode === "day") return CAL_WD[(calDate.getDay() + 6) % 7] + " " + calDate.getDate() + " " + CAL_MONTHS[calDate.getMonth()].slice(0, 3) + " " + calDate.getFullYear();
    const s = startOfWeek(calDate), e = new Date(startOfWeek(calDate)); e.setDate(s.getDate() + 6);
    return s.getDate() + " " + CAL_MONTHS[s.getMonth()].slice(0, 3) + " – " + e.getDate() + " " + CAL_MONTHS[e.getMonth()].slice(0, 3) + " " + e.getFullYear();
  }
  function calChip(t) {
    const c = document.createElement("div");
    c.className = "cal-chip" + (t.done ? " done" : (dueStatus(t.due_date) === "overdue" ? " overdue" : ""));
    c.textContent = t.title;
    c.title = listName(t.list_id) + (t.done ? " · done" : "") + " — click to toggle done";
    c.addEventListener("click", () => toggleTask(t));
    return c;
  }
  function tasksOn(ds) { return tasks.filter((t) => t.due_date === ds); }

  function renderCalendar() {
    const cal = $("calView");
    cal.innerHTML = "";

    const head = document.createElement("div"); head.className = "cal-head";
    const nav = document.createElement("div"); nav.className = "cal-nav";
    const prev = document.createElement("button"); prev.textContent = "‹"; prev.title = "Previous"; prev.addEventListener("click", () => shiftCal(-1));
    const next = document.createElement("button"); next.textContent = "›"; next.title = "Next"; next.addEventListener("click", () => shiftCal(1));
    const today = document.createElement("button"); today.className = "cal-today"; today.textContent = "Today"; today.addEventListener("click", () => { calDate = new Date(); render(); });
    nav.append(prev, next, today);
    const label = document.createElement("div"); label.className = "cal-label"; label.textContent = calLabel();
    const modes = document.createElement("div"); modes.className = "cal-modes";
    ["month", "week", "day"].forEach((m) => {
      const b = document.createElement("button"); b.textContent = m.charAt(0).toUpperCase() + m.slice(1);
      if (calMode === m) b.classList.add("active");
      b.addEventListener("click", () => { calMode = m; localStorage.setItem("mytasks-calmode", m); render(); });
      modes.appendChild(b);
    });
    head.append(nav, label, modes);
    cal.appendChild(head);

    if (calMode === "month") cal.appendChild(buildMonth());
    else if (calMode === "week") cal.appendChild(buildWeek());
    else cal.appendChild(buildDay());

    const un = document.createElement("div"); un.className = "cal-unscheduled";
    const undated = tasks.filter((t) => !t.due_date);
    const h = document.createElement("h3"); h.textContent = "No due date (" + undated.length + ")";
    un.appendChild(h);
    const items = document.createElement("div"); items.className = "cal-unsched-items";
    if (undated.length === 0) { const e = document.createElement("div"); e.className = "cal-empty"; e.textContent = "Everything has a due date."; items.appendChild(e); }
    undated.forEach((t) => items.appendChild(calChip(t)));
    un.appendChild(items);
    cal.appendChild(un);
  }

  function buildMonth() {
    const wrap = document.createElement("div");
    const wd = document.createElement("div"); wd.className = "cal-weekdays";
    CAL_WD.forEach((d) => { const c = document.createElement("div"); c.className = "cal-weekday"; c.textContent = d; wd.appendChild(c); });
    wrap.appendChild(wd);
    const grid = document.createElement("div"); grid.className = "cal-grid";
    const start = startOfWeek(new Date(calDate.getFullYear(), calDate.getMonth(), 1));
    const todayStr = ymdLocal(new Date());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const cell = document.createElement("div"); cell.className = "cal-cell";
      if (d.getMonth() !== calDate.getMonth()) cell.classList.add("other");
      const ds = ymdLocal(d);
      if (ds === todayStr) cell.classList.add("today");
      const num = document.createElement("div"); num.className = "cal-daynum"; num.textContent = d.getDate();
      cell.appendChild(num);
      const dt = tasksOn(ds);
      dt.slice(0, 3).forEach((t) => cell.appendChild(calChip(t)));
      if (dt.length > 3) {
        const more = document.createElement("div"); more.className = "cal-more"; more.textContent = "+" + (dt.length - 3) + " more";
        more.addEventListener("click", () => { calMode = "day"; calDate = new Date(d); render(); });
        cell.appendChild(more);
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function buildWeek() {
    const wrap = document.createElement("div");
    const start = startOfWeek(calDate);
    const wd = document.createElement("div"); wd.className = "cal-weekdays";
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const c = document.createElement("div"); c.className = "cal-weekday"; c.textContent = CAL_WD[i] + " " + d.getDate(); wd.appendChild(c); }
    wrap.appendChild(wd);
    const grid = document.createElement("div"); grid.className = "cal-grid week";
    const todayStr = ymdLocal(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const cell = document.createElement("div"); cell.className = "cal-cell";
      const ds = ymdLocal(d);
      if (ds === todayStr) cell.classList.add("today");
      const dt = tasksOn(ds);
      if (dt.length === 0) { const e = document.createElement("div"); e.className = "cal-empty"; e.textContent = "—"; cell.appendChild(e); }
      dt.forEach((t) => cell.appendChild(calChip(t)));
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function buildDay() {
    const wrap = document.createElement("div");
    const ds = ymdLocal(calDate);
    const list = document.createElement("div"); list.className = "cal-day-list";
    const dt = tasksOn(ds);
    if (dt.length === 0) { const e = document.createElement("div"); e.className = "cal-empty"; e.textContent = "No tasks due this day."; list.appendChild(e); }
    dt.forEach((t) => list.appendChild(calChip(t)));
    wrap.appendChild(list);
    return wrap;
  }

  function renderManagePanel() {
    const panel = $("managePanel");
    panel.classList.toggle("hidden", !managing);
    if (!managing) return;
    const box = $("listEdits");
    box.innerHTML = "";
    if (lists.length === 0) {
      box.innerHTML = '<div style="color:var(--muted);font-size:13px;">No lists yet — add one below.</div>';
    }
    lists.forEach((l, idx) => {
      const row = document.createElement("div");
      row.className = "list-edit";
      const up = document.createElement("button");
      up.className = "icon-btn"; up.innerHTML = "▲"; up.title = "Move up";
      up.disabled = idx === 0;
      up.addEventListener("click", () => moveList(l.id, -1));
      const down = document.createElement("button");
      down.className = "icon-btn"; down.innerHTML = "▼"; down.title = "Move down";
      down.disabled = idx === lists.length - 1;
      down.addEventListener("click", () => moveList(l.id, 1));
      const inp = document.createElement("input");
      inp.value = l.name;
      inp.addEventListener("change", () => renameList(l.id, inp.value));
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.innerHTML = "🗑";
      del.title = "Delete list (and its tasks)";
      del.addEventListener("click", () => deleteList(l.id));
      if (lists.length > 1) {
        const mrg = document.createElement("select");
        mrg.className = "merge-select";
        mrg.title = "Move this list's tasks into another list, then delete it";
        const ph = document.createElement("option"); ph.value = ""; ph.textContent = "Merge into…";
        mrg.appendChild(ph);
        lists.filter((x) => x.id !== l.id).forEach((x) => {
          const o = document.createElement("option"); o.value = x.id; o.textContent = "→ " + x.name;
          mrg.appendChild(o);
        });
        mrg.addEventListener("change", () => { if (mrg.value) mergeList(l.id, mrg.value); mrg.value = ""; });
        row.append(up, down, inp, mrg, del);
      } else {
        row.append(up, down, inp, del);
      }
      box.appendChild(row);
    });
  }

  function renderBoard() {
    const board = $("board");
    board.innerHTML = "";

    // Toolbar state: sort selection + overdue badge.
    $("sortSelect").value = sortMode;
    const oc = overdueCount();
    const badge = $("overdueBadge");
    if (oc > 0) { badge.textContent = "⚠ " + oc + " overdue"; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");

    lists.forEach((l) => {
      const isCollapsed = collapsed.has(l.id);
      const col = document.createElement("div");
      col.className = "column" + (isCollapsed ? " collapsed" : "");
      if (isCollapsed) col.addEventListener("click", () => toggleCollapse(l.id));
      // Accept dropped cards (move task here) and dropped columns (reorder).
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-target"); });
      col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drop-target");
        const data = e.dataTransfer.getData("text/plain");
        if (data.startsWith("card:")) {
          const t = tasks.find((x) => x.id === data.slice(5));
          if (t) reassignTask(t, l.id);
        } else if (data.startsWith("col:")) {
          reorderListByDrag(data.slice(4), l.id);
        }
      });

      // Header (drag handle for reordering columns)
      const head = document.createElement("div");
      head.className = "col-head";
      head.draggable = true;
      head.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", "col:" + l.id); e.dataTransfer.effectAllowed = "move"; head.classList.add("dragging"); });
      head.addEventListener("dragend", () => head.classList.remove("dragging"));
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "icon-btn collapse-btn";
      collapseBtn.innerHTML = isCollapsed ? "▸" : "▾";
      collapseBtn.title = isCollapsed ? "Expand list" : "Collapse list";
      collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleCollapse(l.id); });
      const grip = document.createElement("span"); grip.className = "grip"; grip.textContent = "⠿";
      const name = document.createElement("span"); name.className = "col-name"; name.textContent = l.name;
      const allColTasks = displayTasks(l.id);
      const colTasks = searchQuery
        ? allColTasks.filter((t) => t.title.toLowerCase().includes(searchQuery))
        : allColTasks;
      const count = document.createElement("span"); count.className = "col-count"; count.textContent = colTasks.length;
      head.append(collapseBtn, grip, name, count);

      // Collapsed columns show only a slim vertical strip (click anywhere to expand).
      if (isCollapsed) {
        col.title = "Click to expand";
        const exp = document.createElement("span");
        exp.className = "col-collapse"; exp.textContent = "▸";
        exp.style.marginBottom = "8px";
        const cnt = document.createElement("span");
        cnt.className = "col-collapsed-count"; cnt.textContent = colTasks.length;
        const nm = document.createElement("span");
        nm.className = "col-collapsed-name"; nm.textContent = l.name;
        col.append(exp, cnt, nm);
        board.appendChild(col);
        return;
      }

      // Cards
      const cards = document.createElement("div");
      cards.className = "col-cards";
      if (colTasks.length === 0) {
        const e = document.createElement("div"); e.className = "col-empty";
        e.textContent = searchQuery ? "No matches" : "No tasks yet";
        cards.appendChild(e);
      }
      colTasks.forEach((t, ti) => {
        const card = document.createElement("div");
        card.className = "card" + (t.done ? " done" : "");
        card.draggable = true;
        card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", "card:" + t.id); e.dataTransfer.effectAllowed = "move"; e.stopPropagation(); card.classList.add("dragging"); });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        // Drop another card onto this one to drop it right above (reorder or cross-list move).
        card.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); card.classList.add("card-drop"); });
        card.addEventListener("dragleave", () => card.classList.remove("card-drop"));
        card.addEventListener("drop", (e) => {
          e.preventDefault(); e.stopPropagation();
          card.classList.remove("card-drop");
          const data = e.dataTransfer.getData("text/plain");
          if (data.startsWith("card:")) moveTaskToList(data.slice(5), l.id, t.id);
        });

        const main = document.createElement("div");
        main.className = "card-main";
        const check = document.createElement("div");
        check.className = "check" + (t.done ? " on" : "");
        check.addEventListener("click", () => toggleTask(t));
        const title = document.createElement("div");
        title.className = "title";
        title.textContent = t.title;
        title.title = "Click for details · double-click to rename";
        const toggleNotes = () => { if (expanded.has(t.id)) expanded.delete(t.id); else expanded.add(t.id); render(); };
        let titleClickTimer = null;
        title.addEventListener("click", () => {
          if (titleClickTimer) return; // a double-click is in progress
          titleClickTimer = setTimeout(() => { titleClickTimer = null; toggleNotes(); }, 220);
        });
        title.addEventListener("dblclick", () => { clearTimeout(titleClickTimer); titleClickTimer = null; editTitle(t, title); });
        const del = document.createElement("button");
        del.className = "del";
        del.innerHTML = "✕";
        del.title = "Delete";
        del.addEventListener("click", () => deleteTask(t));
        main.append(check, title);
        const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
        if (subs.length) {
          const badge = document.createElement("span");
          badge.className = "sub-badge";
          badge.textContent = "☑ " + subs.filter((s) => s.done).length + "/" + subs.length;
          badge.title = "Subtasks";
          badge.addEventListener("click", toggleNotes);
          main.appendChild(badge);
        }
        if (t.notes) {
          const dot = document.createElement("span");
          dot.className = "note-dot"; dot.textContent = "🗒"; dot.title = "Has notes";
          dot.addEventListener("click", toggleNotes);
          main.appendChild(dot);
        }
        main.appendChild(del);
        card.appendChild(main);

        // Details (subtasks + notes) shown when the card is expanded
        if (expanded.has(t.id)) {
          const subWrap = document.createElement("div");
          subWrap.className = "subtasks";
          subs.forEach((s) => {
            const srow = document.createElement("div");
            srow.className = "subtask" + (s.done ? " done" : "");
            const schk = document.createElement("div");
            schk.className = "sub-check" + (s.done ? " on" : "");
            schk.addEventListener("click", () => toggleSubtask(t, s.id));
            const stt = document.createElement("span");
            stt.className = "sub-title"; stt.textContent = s.title;
            const sdl = document.createElement("button");
            sdl.className = "sub-del"; sdl.innerHTML = "✕"; sdl.title = "Delete subtask";
            sdl.addEventListener("click", () => deleteSubtask(t, s.id));
            srow.append(schk, stt, sdl);
            subWrap.appendChild(srow);
          });
          const subInp = document.createElement("input");
          subInp.className = "sub-add"; subInp.type = "text"; subInp.placeholder = "+ Add subtask";
          subInp.setAttribute("data-sub", t.id);
          subInp.addEventListener("mousedown", (e) => e.stopPropagation());
          subInp.addEventListener("keydown", (e) => { if (e.key === "Enter") addSubtask(t, subInp.value); });
          subWrap.appendChild(subInp);
          card.appendChild(subWrap);

          const ta = document.createElement("textarea");
          ta.className = "notes";
          ta.placeholder = "Notes…";
          ta.value = t.notes || "";
          ta.draggable = false;
          ta.addEventListener("mousedown", (e) => e.stopPropagation());
          ta.addEventListener("change", () => setNotes(t, ta.value));
          card.appendChild(ta);
        }

        // Footer: up/down reorder (manual sort only) + (when >1 list) a move-to menu.
        const foot = document.createElement("div");
        foot.className = "card-foot";
        if (sortMode === "manual" && !searchQuery) {
          const grp = colTasks.filter((x) => x.done === t.done);
          const gi = grp.findIndex((x) => x.id === t.id);
          const up = document.createElement("button");
          up.className = "icon-btn"; up.innerHTML = "▲"; up.title = "Move up";
          up.disabled = gi === 0;
          up.addEventListener("click", () => moveTaskWithinList(t, -1));
          const down = document.createElement("button");
          down.className = "icon-btn"; down.innerHTML = "▼"; down.title = "Move down";
          down.disabled = gi === grp.length - 1;
          down.addEventListener("click", () => moveTaskWithinList(t, 1));
          foot.append(up, down);
        }

        // Due date — hidden (n/a) until added; shows a small "Add due" button instead.
        if (t.due_date || dueEditing.has(t.id)) {
          const due = document.createElement("input");
          due.type = "date";
          due.className = "due-input" + (t.due_date ? " " + dueStatus(t.due_date) : "");
          due.title = "Due date";
          if (t.due_date) due.value = t.due_date;
          due.addEventListener("change", () => { dueEditing.delete(t.id); setDue(t, due.value); });
          foot.appendChild(due);
          const clr = document.createElement("button");
          clr.className = "due-clear"; clr.innerHTML = "✕"; clr.title = "Remove due date";
          clr.addEventListener("click", () => { dueEditing.delete(t.id); setDue(t, ""); });
          foot.appendChild(clr);
          if (!t.due_date && dueEditing.has(t.id)) {
            setTimeout(() => { try { due.focus(); if (due.showPicker) due.showPicker(); } catch (e) { /* ignore */ } }, 0);
          }
        } else {
          const addDue = document.createElement("button");
          addDue.className = "due-add"; addDue.textContent = "📅 Add due";
          addDue.title = "Add a due date";
          addDue.addEventListener("click", () => { dueEditing.add(t.id); render(); });
          foot.appendChild(addDue);
        }

        if (lists.length > 1) {
          const mv = document.createElement("select");
          mv.className = "move-select";
          mv.title = "Move to another list";
          const ph = document.createElement("option");
          ph.value = ""; ph.textContent = "Move to…";
          mv.appendChild(ph);
          lists.filter((x) => x.id !== l.id).forEach((x) => {
            const o = document.createElement("option");
            o.value = x.id; o.textContent = "→ " + x.name;
            mv.appendChild(o);
          });
          mv.addEventListener("change", () => { if (mv.value) reassignTask(t, mv.value); });
          foot.appendChild(mv);
        }
        card.appendChild(foot);

        cards.appendChild(card);
      });

      // Clear-completed button (only when this list has completed tasks)
      const doneCount = allColTasks.filter((t) => t.done).length;
      let clr = null;
      if (doneCount > 0) {
        clr = document.createElement("button");
        clr.className = "col-clear";
        clr.textContent = "Clear " + doneCount + " completed";
        clr.addEventListener("click", () => clearCompleted(l.id));
      }

      // Add-task input for this column
      const addWrap = document.createElement("div");
      addWrap.className = "col-add";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.placeholder = "+ Add a task";
      inp.setAttribute("data-list", l.id);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addTaskToList(l.id, inp); });
      addWrap.appendChild(inp);

      col.append(head, cards);
      if (clr) col.appendChild(clr);
      col.appendChild(addWrap);

      // Saved custom size + drag-to-resize grip
      applyListSize(col, l);
      const resizeGrip = document.createElement("div");
      resizeGrip.className = "col-resize";
      resizeGrip.title = "Drag to resize · double-click to reset to auto";
      resizeGrip.addEventListener("mousedown", (e) => startResize(e, col, l));
      resizeGrip.addEventListener("dblclick", () => resetListSize(l));
      col.appendChild(resizeGrip);

      board.appendChild(col);
    });

    // "Add list" button at the end of the board
    const addCol = document.createElement("button");
    addCol.className = "add-column-btn";
    addCol.textContent = "+ Add list";
    addCol.addEventListener("click", async () => {
      const name = prompt("New list name:");
      if (name && name.trim()) await createList(name);
    });
    board.appendChild(addCol);
  }

  init();
})();
