/* Agenda Fácil — app.js v5 (con fixes de prioridad 1 + export/import) */
(function () {
  "use strict";

  // ============================================================
  // CONSTANTES
  // ============================================================
  var STORE_KEY = "agenda-facil-data-v4";      // ⚠️ NO CAMBIAR (preserva datos existentes)
  var PREFS_KEY = "agenda-facil-prefs";
  var NOTIF_KEY = "af-notified";               // persistencia de notificaciones enviadas

  var DEFAULT_WA_TEMPLATE = "¡Hola {nombre}! 👋 Te recuerdo tu cita:\n📅 {fecha}\n🕐 {hora}\n💇 {servicio}\n\n¡Te espero! — {negocio}";

  // ============================================================
  // UTILIDADES
  // ============================================================
  function pad(n) { return String(n).padStart(2, "0"); }
  function fechaISO(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function conMayuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p || 12); } catch (e) {} }

  // FIX P1.1: minutos desde medianoche para detectar solapamientos por duración
  function horaAMinutos(h) {
    var p = (h || "00:00").split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  }
  function hayConflicto(fecha, hora, duracion, excluirId) {
    var ini = horaAMinutos(hora);
    var fin = ini + (duracion || 60);
    return state.citas.some(function (c) {
      if (c.id === excluirId) return false;
      if (c.fecha !== fecha || c.estado === "cancelada") return false;
      var cIni = horaAMinutos(c.hora);
      var cFin = cIni + (c.duracion || 60);
      return ini < cFin && cIni < fin;
    });
  }
  function buscarConflicto(fecha, hora, duracion, excluirId) {
    var ini = horaAMinutos(hora);
    var fin = ini + (duracion || 60);
    var found = null;
    state.citas.forEach(function (c) {
      if (c.id === excluirId) return;
      if (c.fecha !== fecha || c.estado === "cancelada") return;
      var cIni = horaAMinutos(c.hora);
      var cFin = cIni + (c.duracion || 60);
      if (ini < cFin && cIni < fin) found = c;
    });
    return found;
  }

  // FIX P1.3: persistencia de notificaciones en localStorage
  function notifDB() {
    try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function marcarNotificado(id) {
    var db = notifDB(); db[id] = Date.now();
    try { localStorage.setItem(NOTIF_KEY, JSON.stringify(db)); } catch (e) {}
  }
  function yaNotificado(id) { return !!notifDB()[id]; }
  function limpiarNotificado(id) {
    var db = notifDB();
    if (db[id]) { delete db[id]; try { localStorage.setItem(NOTIF_KEY, JSON.stringify(db)); } catch (e) {} }
  }

  // Persistencia de almacenamiento
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) { if (!already) navigator.storage.persist(); });
  }

  // ============================================================
  // ESTADO
  // ============================================================
  function estadoInicial() { return { servicios: [], clientes: [], citas: [] }; }
  function migrar(state) {
    if (!state || typeof state !== "object") state = estadoInicial();
    if (!Array.isArray(state.servicios)) state.servicios = [];
    if (!Array.isArray(state.clientes)) state.clientes = [];
    if (!Array.isArray(state.citas)) state.citas = [];
    state.clientes = state.clientes.map(function (c) {
      if (typeof c.notas !== "string") c.notas = "";
      return c;
    });
    state.citas = state.citas.map(function (c) {
      if (typeof c.pagado !== "boolean") c.pagado = (c.estado === "atendida");
      if (typeof c.duracion !== "number") c.duracion = 60;
      return c;
    });
    return state;
  }
  function cargar() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return migrar(JSON.parse(raw));
    } catch (e) {}
    return migrar(estadoInicial());
  }
  function guardar(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function cargarPrefs() {
    var defaults = { waTemplate: DEFAULT_WA_TEMPLATE, negocio: "", paisCode: "52" };
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (typeof parsed.waTemplate !== "string" || !parsed.waTemplate.trim()) parsed.waTemplate = DEFAULT_WA_TEMPLATE;
        if (typeof parsed.negocio !== "string") parsed.negocio = "";
        if (typeof parsed.paisCode !== "string") parsed.paisCode = "52";
        return parsed;
      }
    } catch (e) {}
    return defaults;
  }
  function guardarPrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  var state = cargar();
  var prefs = cargarPrefs();
  var diaActual = new Date();
  var selectedServicesMap = {};
  var vistaActual = "agenda";
  var filtroTodas = "todas";
  var editandoId = null;
  var editEstadoActual = "pendiente";
  var deleteCallback = null;
  var clienteActualId = null;
  var modoDiaFecha = new Date();
  var invertirOrdenAgenda = false;
  var invertirOrdenTodas = true;

  var viewsTrack = document.getElementById("viewsTrack");
  var viewsTrackWrap = document.getElementById("viewsTrackWrap");
  var nuevaView = document.getElementById("view-nueva");
  var alphaIndexEl = document.getElementById("alphaIndex");
  var headerTitle = document.getElementById("headerTitle");

  var SWIPE_ORDER = ["agenda", "todas", "calendario", "clientes"];
  var currentIndex = 0;
  var TITULOS = { agenda: "Agenda Fácil", todas: "Citas", calendario: "Calendario", clientes: "Clientes", nueva: "Nueva cita" };

  function clientePorId(id) {
    for (var i = 0; i < state.clientes.length; i++) if (state.clientes[i].id === id) return state.clientes[i];
    return null;
  }

  // ============================================================
  // TOASTS
  // ============================================================
  function showToast(message, type, action) {
    var container = document.getElementById("toastContainer");
    var toast = document.createElement("div");
    var palette = {
      success: "bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-emerald-600/30",
      error:   "bg-gradient-to-r from-red-600 to-rose-500 shadow-red-600/30",
      info:    "bg-gradient-to-r from-slate-900 to-slate-700 dark:from-zinc-800 dark:to-zinc-700 shadow-black/30"
    };
    var icon = type === "success" ? "check-circle-2" : type === "error" ? "alert-circle" : "info";
    toast.className = "toast-item pointer-events-auto px-4 py-3 rounded-2xl text-white text-sm font-medium shadow-xl flex items-center gap-2 " + (palette[type] || palette.info);
    toast.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4 shrink-0"></i><span>' + message + "</span>";
    if (action) {
      var btn = document.createElement("button");
      btn.className = "ml-2 px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-bold whitespace-nowrap";
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        action.fn();
        toast.classList.add("leaving");
        setTimeout(function () { toast.remove(); }, 320);
      });
      toast.appendChild(btn);
    }
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(function () {
      if (toast.parentNode) {
        toast.classList.add("leaving");
        setTimeout(function () { if (toast.parentNode) toast.remove(); }, 320);
      }
    }, action ? 5500 : 2600);
  }

  // ============================================================
  // FIX P1.5: modales con scroll-lock + Escape
  // ============================================================
  function showModal(modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    var content = modal.querySelector(".anim-scale");
    if (content) { content.classList.remove("anim-scale"); void content.offsetWidth; content.classList.add("anim-scale"); }
    if (window.lucide) lucide.createIcons();
  }
  function hideModal(modal) {
    modal.classList.add("hidden");
    // Solo liberar el scroll si no queda otro modal abierto
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.style.overflow = "";
    }
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var abiertos = document.querySelectorAll(".modal-backdrop:not(.hidden)");
      if (abiertos.length) {
        abiertos.forEach(function (m) { hideModal(m); });
      }
    }
  });

  // ============================================================
  // FECHAS Y ESTADOS
  // ============================================================
  function fechaHoraCita(c) {
    var f = c.fecha.split("-");
    var h = (c.hora || "00:00").split(":");
    return new Date(Number(f[0]), Number(f[1]) - 1, Number(f[2]), Number(h[0]) || 0, Number(h[1]) || 0, 0, 0);
  }
  function esPasada(c) { return c.estado === "pendiente" && fechaHoraCita(c).getTime() < Date.now(); }
  function getEstadoVisual(c) {
    if (c.estado === "cancelada") return "cancelada";
    if (c.estado === "atendida") return "atendida";
    if (esPasada(c)) return "pasada";
    return "pendiente";
  }
  function filtroAEstado(f) {
    switch (f) {
      case "pendientes": return "pendiente";
      case "atendidas":  return "atendida";
      case "pasadas":    return "pasada";
      case "canceladas": return "cancelada";
      default:           return null;
    }
  }
  function getStatusBadgeHtml(c) {
    var e = getEstadoVisual(c);
    if (e === "pendiente") return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40"><span class="badge-dot bg-amber-500"></span> Pendiente</span>';
    if (e === "atendida")  return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40"><span class="badge-dot bg-emerald-500"></span> Atendida</span>';
    if (e === "pasada")    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/40"><span class="badge-dot bg-rose-500"></span> Vencida</span>';
    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-zinc-700"><span class="badge-dot bg-slate-400"></span> Cancelada</span>';
  }
  function getStatusBadgeMiniHtml(c) {
    var e = getEstadoVisual(c);
    if (e === "pendiente") return '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">PENDIENTE</span>';
    if (e === "atendida")  return '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">ATENDIDA</span>';
    if (e === "pasada")    return '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">VENCIDA</span>';
    return '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-zinc-800 text-slate-500 dark:text-slate-400">CANCELADA</span>';
  }
  function statusColor(c) {
    var e = getEstadoVisual(c);
    if (e === "pendiente") return "#f59e0b";
    if (e === "atendida")  return "#10b981";
    if (e === "pasada")    return "#f43f5e";
    return "#94a3b8";
  }
  function formatHora12(hora) {
    var parts = (hora || "00:00").split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] || "00";
    var suf = h >= 12 ? "pm" : "am";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + m + " " + suf;
  }
  function horaFin(c) {
    var p = (c.hora || "00:00").split(":");
    var total = parseInt(p[0], 10) * 60 + parseInt(p[1], 10) + (c.duracion || 60);
    return pad(Math.floor(total / 60) % 24) + ":" + pad(total % 60);
  }

  // ============================================================
  // FIX P1.6: WhatsApp respeta código de país
  // ============================================================
  function waLink(phone, message) {
    var clean = (phone || "").replace(/\D/g, "");
    if (!clean) return "#";
    var cc = (prefs.paisCode || "52").replace(/\D/g, "");
    if (clean.length === 10) clean = cc + clean;
    return "https://wa.me/" + clean + "?text=" + encodeURIComponent(message);
  }
  function renderTemplate(template, cita) {
    var cli = clientePorId(cita.clienteId);
    var nombre = cli ? cli.nombre.split(" ")[0] : "";
    var fecha = conMayuscula(new Date(cita.fecha + "T00:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }));
    var hora = formatHora12(cita.hora);
    var servicio = cita.servicio || "";
    var precio = "$" + (cita.precio || 0);
    var negocio = prefs.negocio && prefs.negocio.trim() ? prefs.negocio.trim() : "Agenda Fácil";
    return (template || DEFAULT_WA_TEMPLATE)
      .replace(/\{nombre\}/g, nombre)
      .replace(/\{fecha\}/g, fecha)
      .replace(/\{hora\}/g, hora)
      .replace(/\{servicio\}/g, servicio)
      .replace(/\{precio\}/g, precio)
      .replace(/\{negocio\}/g, negocio);
  }
  function recordatorioTexto(c) { return renderTemplate(prefs.waTemplate, c); }

  // ============================================================
  // TEMAS
  // ============================================================
  var TEMAS_DARK = { purple: true, red: true };
  function applyTheme(name) {
    if (!name) name = "soft";
    document.documentElement.setAttribute("data-theme", name);
    if (TEMAS_DARK[name]) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    localStorage.setItem("agenda_theme", name);
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      if (b.getAttribute("data-theme-set") === name) b.classList.add("active");
      else b.classList.remove("active");
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var colors = { soft: "#f2efe9", gray: "#e6e6e6", purple: "#0c0916", red: "#0a0606", ios: "#f2f2f7" };
      meta.setAttribute("content", colors[name] || "#c8384f");
    }
  }
  var savedTheme = localStorage.getItem("agenda_theme");
  if (savedTheme === "dark") savedTheme = "purple";
  else if (savedTheme === "light") savedTheme = "soft";
  if (!savedTheme || ["soft", "gray", "purple", "red", "ios"].indexOf(savedTheme) === -1) {
    savedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "purple" : "soft";
  }
  applyTheme(savedTheme);

  var themeToggle = document.getElementById("themeToggle");
  var themePanel = document.getElementById("themePanel");
  themeToggle.addEventListener("click", function (e) {
    e.stopPropagation();
    themePanel.classList.toggle("hidden");
    if (window.lucide) lucide.createIcons();
  });
  document.querySelectorAll("[data-theme-set]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(btn.getAttribute("data-theme-set"));
      themePanel.classList.add("hidden");
      haptic(10);
    });
  });
  document.addEventListener("click", function (e) {
    if (!themePanel.classList.contains("hidden") && !e.target.closest("#themePanel") && !e.target.closest("#themeToggle")) {
      themePanel.classList.add("hidden");
    }
  });

  // ============================================================
  // AJUSTES
  // ============================================================
  var settingsModal = document.getElementById("settingsModal");
  var settingsWa = document.getElementById("settingsWaTemplate");
  var settingsNegocio = document.getElementById("settingsNegocio");
  var settingsPais = document.getElementById("settingsPais");
  var waPreview = document.getElementById("waPreview");

  function actualizarPreviewWA() {
    var demoCita = { clienteId: "__demo__", fecha: fechaISO(new Date()), hora: "15:30", servicio: "Corte", precio: 150 };
    var original = state.clientes;
    state.clientes = original.concat([{ id: "__demo__", nombre: "Ana López", tel: "", notas: "" }]);
    var oldPais = prefs.paisCode;
    prefs.paisCode = settingsPais ? settingsPais.value : "52";
    waPreview.textContent = renderTemplate(settingsWa.value, demoCita);
    prefs.paisCode = oldPais;
    state.clientes = original;
  }

  document.getElementById("btnSettings").addEventListener("click", function () {
    settingsWa.value = prefs.waTemplate;
    settingsNegocio.value = prefs.negocio;
    settingsPais.value = prefs.paisCode || "52";
    actualizarPreviewWA();
    showModal(settingsModal);
  });
  settingsWa.addEventListener("input", actualizarPreviewWA);
  settingsNegocio.addEventListener("input", actualizarPreviewWA);
  settingsPais.addEventListener("change", actualizarPreviewWA);

  document.querySelectorAll(".var-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var v = chip.getAttribute("data-var");
      var ta = settingsWa;
      var start = ta.selectionStart || ta.value.length;
      var end = ta.selectionEnd || ta.value.length;
      ta.value = ta.value.slice(0, start) + v + ta.value.slice(end);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + v.length;
      actualizarPreviewWA();
      haptic(8);
    });
  });
  document.getElementById("btnResetWaTemplate").addEventListener("click", function () {
    settingsWa.value = DEFAULT_WA_TEMPLATE;
    actualizarPreviewWA();
    haptic(8);
  });
  document.getElementById("btnCloseSettings").addEventListener("click", function () { hideModal(settingsModal); });
  document.getElementById("btnCancelSettings").addEventListener("click", function () { hideModal(settingsModal); });
  document.getElementById("btnSaveSettings").addEventListener("click", function () {
    var tpl = settingsWa.value;
    if (!tpl || !tpl.trim()) tpl = DEFAULT_WA_TEMPLATE;
    prefs.waTemplate = tpl;
    prefs.negocio = settingsNegocio.value.trim();
    prefs.paisCode = settingsPais.value || "52";
    guardarPrefs();
    hideModal(settingsModal);
    haptic([10, 30, 10]);
    showToast("Ajustes guardados ✓", "success");
    refrescarVistaActiva();
  });

  // ============================================================
  // FIX P1.7: EXPORTAR / IMPORTAR
  // ============================================================
  function descargarArchivo(blob, nombre) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function exportarJSON() {
    var data = { app: "agenda-facil", version: 4, exportedAt: new Date().toISOString(), state: state, prefs: prefs };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    descargarArchivo(blob, "agenda-facil-respaldo-" + fechaISO(new Date()) + ".json");
    showToast("Respaldo descargado ✓", "success");
  }

  function importarJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        // Acepta tanto {state, prefs} como el array crudo por compatibilidad
        var nuevoState = data.state || (Array.isArray(data.citas) ? data : null);
        if (!nuevoState || !Array.isArray(nuevoState.citas) || !Array.isArray(nuevoState.clientes)) {
          showToast("Archivo inválido", "error");
          return;
        }
        var nCitas = nuevoState.citas.length;
        var nClientes = nuevoState.clientes.length;
        var ok = window.confirm(
          "Se reemplazarán TODOS los datos actuales.\n\n" +
          "Respaldo contiene:\n" +
          "• " + nCitas + " citas\n" +
          "• " + nClientes + " clientes\n" +
          "• " + (nuevoState.servicios || []).length + " servicios\n\n" +
          "¿Continuar?"
        );
        if (!ok) return;
        state = migrar(nuevoState);
        if (data.prefs) {
          prefs = Object.assign(prefs, data.prefs);
          guardarPrefs();
        }
        guardar(state);
        refrescarVistaActiva();
        poblarSelectClientes();
        showToast("Datos restaurados ✓", "success");
        haptic([15, 40, 15]);
      } catch (e) {
        showToast("Error al leer el archivo", "error");
      }
    };
    reader.readAsText(file);
  }

  function csvEscape(v) {
    var s = String(v == null ? "" : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportarCSV() {
    var rows = [["Fecha", "Hora", "Duración (min)", "Cliente", "Teléfono", "Servicio", "Precio", "Estado", "Pagado", "Notas"]];
    var citas = state.citas.slice().sort(function (a, b) { return (a.fecha + a.hora).localeCompare(b.fecha + b.hora); });
    citas.forEach(function (c) {
      var cli = clientePorId(c.clienteId);
      rows.push([
        c.fecha, c.hora, c.duracion || 60,
        cli ? cli.nombre : "Cliente no registrado",
        cli ? (cli.tel || "") : "",
        c.servicio, c.precio || 0, c.estado,
        c.pagado ? "Sí" : "No",
        c.notas || ""
      ]);
    });
    var csv = rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    descargarArchivo(blob, "citas-" + fechaISO(new Date()) + ".csv");
    showToast("CSV descargado ✓", "success");
  }

  function icsFecha(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(d.getHours()) + pad(d.getMinutes()) + "00";
  }
  function exportarICS() {
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agenda Facil//ES", "CALSCALE:GREGORIAN"];
    state.citas.forEach(function (c) {
      if (c.estado === "cancelada") return;
      var dt = fechaHoraCita(c);
      var dtEnd = new Date(dt.getTime() + (c.duracion || 60) * 60000);
      var cli = clientePorId(c.clienteId);
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + c.id + "@agendafacil");
      lines.push("DTSTAMP:" + icsFecha(new Date()));
      lines.push("DTSTART:" + icsFecha(dt));
      lines.push("DTEND:" + icsFecha(dtEnd));
      lines.push("SUMMARY:" + (cli ? cli.nombre : "Cliente") + " - " + (c.servicio || "Cita"));
      if (c.notas) lines.push("DESCRIPTION:" + c.notas.replace(/\n/g, "\\n"));
      if (cli && cli.tel) lines.push("CONTACT:" + cli.nombre + " " + cli.tel);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    descargarArchivo(blob, "citas-" + fechaISO(new Date()) + ".ics");
    showToast("Calendario exportado ✓ (abre en Google Calendar/Apple)", "success");
  }

  document.getElementById("btnExportJSON").addEventListener("click", exportarJSON);
  document.getElementById("btnExportCSV").addEventListener("click", exportarCSV);
  document.getElementById("btnExportICS").addEventListener("click", exportarICS);

  var importFileInput = document.getElementById("importFileInput");
  document.getElementById("btnImportJSON").addEventListener("click", function () {
    importFileInput.value = "";
    importFileInput.click();
  });
  importFileInput.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) importarJSON(file);
  });

  // ============================================================
  // NOTIFICACIONES
  // ============================================================
  var btnNotif = document.getElementById("btnNotif");
  function notifStatus() {
    if (!("Notification" in window)) return "no-soportado";
    return Notification.permission;
  }
  function actualizarBotonNotif() {
    if (notifStatus() === "granted") btnNotif.classList.add("text-brand-600", "dark:text-brand-400");
    else btnNotif.classList.remove("text-brand-600", "dark:text-brand-400");
  }
  btnNotif.addEventListener("click", function () {
    var s = notifStatus();
    if (s === "no-soportado") { showToast("Tu navegador no soporta notificaciones", "error"); return; }
    if (s === "granted") { showToast("Recordatorios activados ✓", "success"); return; }
    Notification.requestPermission().then(function (p) {
      actualizarBotonNotif();
      if (p === "granted") showToast("Recordatorios activados ✓", "success");
      else showToast("No se activaron los recordatorios", "info");
    });
  });
  actualizarBotonNotif();

  function revisarNotificaciones() {
    if (notifStatus() !== "granted") return;
    var ahora = Date.now();
    state.citas.forEach(function (c) {
      if (c.estado !== "pendiente") return;
      if (yaNotificado(c.id)) return;
      var t = fechaHoraCita(c).getTime();
      var diff = t - ahora;
      if (diff > 0 && diff <= 15 * 60 * 1000 && diff > 14 * 60 * 1000) {
        marcarNotificado(c.id);
        var cli = clientePorId(c.clienteId);
        try {
          new Notification("Cita en 15 min — " + (cli ? cli.nombre : "Cliente"), {
            body: formatHora12(c.hora) + " · " + c.servicio,
            icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23c8384f'/></svg>",
            tag: c.id
          });
        } catch (e) {}
      }
    });
  }

  // ============================================================
  // NAVEGACIÓN
  // ============================================================
  var desktopTabs = document.querySelectorAll("nav.hidden.sm\\:flex .tab-btn");
  var mobileTabs = document.querySelectorAll("#mobileNav .mobile-nav-btn");
  document.querySelectorAll("[data-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-tab");
      if (target) { haptic(8); irAVista(target); }
    });
  });

  function setActiveTab(nombre) {
    desktopTabs.forEach(function (b) {
      var isNew = b.getAttribute("data-tab") === "nueva";
      var isActive = b.getAttribute("data-tab") === nombre;
      if (isActive) {
        b.className = isNew
          ? "tab-btn tab-active flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap bg-gradient-to-r from-brand-700 to-brand-600 text-white shadow-lg shadow-brand-600/30 ml-auto"
          : "tab-btn tab-active flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap bg-brand-600 text-white shadow-md shadow-brand-600/25";
      } else {
        b.className = isNew
          ? "tab-btn flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap bg-gradient-to-r from-brand-600 to-brand-500 text-white hover:from-brand-700 hover:to-brand-600 shadow-lg shadow-brand-600/25 ml-auto"
          : "tab-btn flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-zinc-800/60";
      }
    });
    mobileTabs.forEach(function (b) {
      if (b.getAttribute("data-tab") === nombre) b.classList.add("active");
      else b.classList.remove("active");
    });
    var fab = document.getElementById("fabNueva");
    if (fab) {
      if (nombre === "nueva") fab.classList.add("hidden");
      else fab.classList.remove("hidden");
    }
  }

  function setTrackIndex(i, animate) {
    if (i < 0) i = 0;
    if (i > SWIPE_ORDER.length - 1) i = SWIPE_ORDER.length - 1;
    currentIndex = i;
    if (!animate) {
      viewsTrack.style.transition = "none";
      viewsTrack.style.transform = "translateX(" + (-i * 100) + "%)";
      void viewsTrack.offsetWidth;
      viewsTrack.style.transition = "";
    } else {
      viewsTrack.style.transition = "transform .38s cubic-bezier(.16, 1, .3, 1)";
      viewsTrack.style.transform = "translateX(" + (-i * 100) + "%)";
    }
  }

  function updateHeaderTitle(nombre) {
    var txt = (nombre === "agenda" && prefs.negocio && prefs.negocio.trim()) ? prefs.negocio.trim() : (TITULOS[nombre] || "Agenda Fácil");
    if (headerTitle.textContent === txt) return;
    headerTitle.textContent = txt;
    headerTitle.classList.remove("anim-title");
    void headerTitle.offsetWidth;
    headerTitle.classList.add("anim-title");
  }

  function irAVista(nombre) {
    vistaActual = nombre;
    setActiveTab(nombre);
    updateHeaderTitle(nombre);
    if (nombre !== "clientes") alphaIndexEl.classList.remove("visible");

    if (nombre === "nueva") {
      viewsTrackWrap.classList.add("hidden");
      nuevaView.classList.remove("hidden");
      nuevaView.classList.add("anim-fade-up");
    } else {
      viewsTrackWrap.classList.remove("hidden");
      nuevaView.classList.add("hidden");
      nuevaView.classList.remove("anim-fade-up");
      var idx = SWIPE_ORDER.indexOf(nombre);
      if (idx !== -1) setTrackIndex(idx, true);
    }

    if (nombre === "agenda") renderAgenda();
    if (nombre === "todas") renderTodas();
    if (nombre === "calendario") renderCalendario();
    if (nombre === "clientes") renderClientes(document.getElementById("buscarCliente").value);
    if (nombre === "nueva") prepararFormulario();

    if (window.innerWidth < 640) window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.lucide) lucide.createIcons();
  }

  // ============================================================
  // FIX P1.2: refresco silencioso (sin animaciones)
  // ============================================================
  function refrescarVistaActiva() {
    if (vistaActual === "agenda") renderAgenda();
    if (vistaActual === "todas") renderTodas();
    if (vistaActual === "calendario") renderCalendario();
    if (vistaActual === "clientes") renderClientes(document.getElementById("buscarCliente").value);
    var cm = document.getElementById("clientModal");
    if (clienteActualId && !cm.classList.contains("hidden")) renderFichaClienteBody(clienteActualId);
    if (window.lucide) lucide.createIcons();
  }
  function refrescarSilencioso() {
    document.body.classList.add("no-anim");
    refrescarVistaActiva();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { document.body.classList.remove("no-anim"); });
    });
  }

  // ============================================================
  // RENDER: AGENDA
  // ============================================================
  var FORMATO_LARGO = { weekday: "long", day: "numeric", month: "long" };

  function crearFilaCita(c, index) {
    var cli = clientePorId(c.clienteId);
    var nombreCli = cli ? cli.nombre : "Cliente no registrado";
    var telCli = cli && cli.tel ? cli.tel : "";
    var isCancelada = c.estado === "cancelada";

    var card = document.createElement("div");
    card.className = "cita-card card-hover anim-fade-up bg-white dark:bg-zinc-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-zinc-800 shadow-sm space-y-3";
    card.style.setProperty("--status-color", statusColor(c));
    if (index !== undefined) card.style.animationDelay = Math.min(index * 45, 420) + "ms";

    var tituloClase = isCancelada ? "line-through opacity-60" : "";
    var servicioClase = isCancelada ? "line-through" : "";

    var pagoBadge = c.pagado
      ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"><i data-lucide="check" class="w-2.5 h-2.5"></i>PAGADO</span>'
      : (c.estado === "atendida" ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300">POR COBRAR</span>' : "");

    card.innerHTML =
      '<div class="flex items-start justify-between gap-3">' +
        '<div class="flex items-center gap-3 min-w-0">' +
          '<div class="px-2.5 py-1.5 rounded-xl bg-brand-50 dark:bg-brand-950/60 text-brand-700 dark:text-brand-300 font-bold text-xs font-serif border border-brand-100 dark:border-brand-900/40 shrink-0 text-center leading-tight">' +
            '<div class="flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i>' + formatHora12(c.hora) + '</div>' +
            '<div class="text-[9px] opacity-70 font-normal mt-0.5">' + (c.duracion || 60) + ' min</div>' +
          '</div>' +
          '<div class="min-w-0">' +
            '<h3 class="font-bold text-slate-900 dark:text-white text-base truncate ' + tituloClase + '">' + nombreCli + '</h3>' +
            (telCli ? '<p class="text-xs text-slate-400 flex items-center gap-1"><i data-lucide="phone" class="w-3 h-3"></i>' + telCli + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<div class="shrink-0 text-right space-y-1">' + getStatusBadgeHtml(c) + '<div class="flex justify-end">' + pagoBadge + '</div></div>' +
      '</div>' +
      '<div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-zinc-800/80 text-xs">' +
        '<div class="text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1.5 min-w-0 ' + servicioClase + '">' +
          '<i data-lucide="scissors" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>' +
          '<span class="truncate">' + c.servicio + '</span>' +
        '</div>' +
        '<div class="font-bold text-slate-900 dark:text-white text-sm font-serif shrink-0 ml-2">$' + c.precio + '</div>' +
      '</div>' +
      (c.notas ? '<p class="text-xs italic bg-slate-50 dark:bg-zinc-800/40 p-2 rounded-lg text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-zinc-800">"' + c.notas + '"</p>' : '') +
      '<div class="cita-acciones flex items-center justify-end gap-1.5 pt-1 flex-wrap"></div>';

    var acciones = card.querySelector(".cita-acciones");

    if (c.estado === "pendiente") {
      var btnAtender = document.createElement("button");
      btnAtender.type = "button";
      btnAtender.className = "px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1";
      btnAtender.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Atender';
      btnAtender.addEventListener("click", function () { cambiarEstado(c.id, "atendida"); });
      acciones.appendChild(btnAtender);
    }

    if (c.estado !== "cancelada") {
      var btnPago = document.createElement("button");
      btnPago.type = "button";
      btnPago.title = c.pagado ? "Marcar como no pagado" : "Marcar como pagado";
      btnPago.className = "px-2.5 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1 " +
        (c.pagado ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200"
                  : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-slate-400 hover:bg-amber-50 hover:text-amber-700");
      btnPago.innerHTML = '<i data-lucide="' + (c.pagado ? "badge-check" : "banknote") + '" class="w-3.5 h-3.5"></i>';
      btnPago.addEventListener("click", function () { togglePago(c.id); });
      acciones.appendChild(btnPago);
    }

    if (telCli) {
      var btnWa = document.createElement("a");
      btnWa.href = waLink(telCli, recordatorioTexto(c));
      btnWa.target = "_blank";
      btnWa.rel = "noopener";
      btnWa.className = "px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1";
      btnWa.title = "Enviar recordatorio por WhatsApp";
      btnWa.innerHTML = '<i data-lucide="message-circle" class="w-3.5 h-3.5"></i>';
      btnWa.addEventListener("click", function () { haptic(12); });
      acciones.appendChild(btnWa);
    }

    var btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "px-2.5 py-1.5 text-xs font-medium rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-brand-50 hover:text-brand-600 text-slate-600 dark:text-slate-400 flex items-center gap-1";
    btnEditar.title = "Editar";
    btnEditar.innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5"></i>';
    btnEditar.addEventListener("click", function () { abrirEditarCita(c.id); });
    acciones.appendChild(btnEditar);

    var btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "p-1.5 rounded-xl hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 text-slate-400";
    btnEliminar.title = "Eliminar";
    btnEliminar.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
    btnEliminar.addEventListener("click", function () { pedirConfirmacionEliminar(c); });
    acciones.appendChild(btnEliminar);

    return card;
  }

  function renderResumenDia() {
    var iso = fechaISO(diaActual);
    var citasDia = state.citas.filter(function (c) { return c.fecha === iso && c.estado !== "cancelada"; });
    var total = citasDia.reduce(function (a, c) { return a + Number(c.precio || 0); }, 0);
    var cobrado = citasDia.filter(function (c) { return c.pagado; }).reduce(function (a, c) { return a + Number(c.precio || 0); }, 0);
    var pendiente = total - cobrado;
    document.getElementById("resumenDia").innerHTML =
      '<div class="bg-white dark:bg-zinc-900 rounded-2xl p-3 border border-slate-200/80 dark:border-zinc-800 shadow-sm text-center">' +
        '<p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Citas</p>' +
        '<p class="text-lg font-extrabold stat-number text-slate-900 dark:text-white">' + citasDia.length + '</p></div>' +
      '<div class="bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl p-3 border border-emerald-200/60 dark:border-emerald-900/40 shadow-sm text-center">' +
        '<p class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">Cobrado</p>' +
        '<p class="text-lg font-extrabold stat-number text-emerald-700 dark:text-emerald-300">$' + cobrado + '</p></div>' +
      '<div class="bg-amber-50 dark:bg-amber-950/30 rounded-2xl p-3 border border-amber-200/60 dark:border-amber-900/40 shadow-sm text-center">' +
        '<p class="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-0.5">Por cobrar</p>' +
        '<p class="text-lg font-extrabold stat-number text-amber-700 dark:text-amber-300">$' + pendiente + '</p></div>';
  }

  function renderAgenda() {
    document.getElementById("dayLabel").textContent = conMayuscula(diaActual.toLocaleDateString("es-MX", FORMATO_LARGO));
    var iso = fechaISO(diaActual);
    var citasDia = state.citas.filter(function (c) { return c.fecha === iso; }).sort(function (a, b) { return a.hora.localeCompare(b.hora); });
    if (invertirOrdenAgenda) citasDia.reverse();
    document.getElementById("dayCount").textContent = citasDia.length === 0 ? "Sin citas" : (citasDia.length + (citasDia.length === 1 ? " cita" : " citas"));
    renderResumenDia();

    var cont = document.getElementById("citasList");
    cont.innerHTML = "";

    if (state.clientes.length === 0 && state.citas.length === 0) {
      cont.innerHTML =
        '<div class="anim-fade-up bg-white dark:bg-zinc-900 rounded-2xl p-6 border border-slate-200/80 dark:border-zinc-800 space-y-4">' +
          '<div class="text-center space-y-2">' +
            '<div class="floaty w-16 h-16 rounded-full bg-gradient-to-tr from-brand-100 to-brand-50 dark:from-brand-950 dark:to-zinc-900 text-brand-500 flex items-center justify-center mx-auto"><i data-lucide="sparkles" class="w-7 h-7"></i></div>' +
            '<h3 class="font-serif font-bold text-slate-900 dark:text-white text-xl">¡Bienvenido a Agenda Fácil!</h3>' +
            '<p class="text-sm text-slate-500 max-w-sm mx-auto">Empieza en 3 pasos rápidos.</p></div>' +
          '<div class="space-y-2">' +
            '<div class="onboard-step"><div class="onboard-num">1</div><div class="flex-1 min-w-0"><p class="font-bold text-sm text-slate-900 dark:text-white">Agrega tus servicios</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Define lo que ofreces.</p><button id="btnOnboardServices" type="button" class="mt-2 px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 text-xs font-semibold inline-flex items-center gap-1.5"><i data-lucide="scissors" class="w-3.5 h-3.5"></i> Añadir servicios</button></div></div>' +
            '<div class="onboard-step"><div class="onboard-num">2</div><div class="flex-1 min-w-0"><p class="font-bold text-sm text-slate-900 dark:text-white">Registra un cliente</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Nombre y teléfono.</p><button id="btnOnboardClients" type="button" class="mt-2 px-3 py-1.5 rounded-lg bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 text-xs font-semibold inline-flex items-center gap-1.5"><i data-lucide="user-plus" class="w-3.5 h-3.5"></i> Ir a Clientes</button></div></div>' +
            '<div class="onboard-step"><div class="onboard-num">3</div><div class="flex-1 min-w-0"><p class="font-bold text-sm text-slate-900 dark:text-white">Agenda tu primera cita</p><p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Elige fecha y hora.</p><button id="btnOnboardCita" type="button" class="mt-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-md shadow-brand-600/25"><i data-lucide="plus" class="w-3.5 h-3.5"></i> Nueva cita</button></div></div>' +
          '</div></div>';
      document.getElementById("btnOnboardServices").addEventListener("click", function () { renderModalServicesList(); showModal(serviceModal); });
      document.getElementById("btnOnboardClients").addEventListener("click", function () { irAVista("clientes"); });
      document.getElementById("btnOnboardCita").addEventListener("click", function () { irAVista("nueva"); });
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (citasDia.length === 0) {
      cont.innerHTML =
        '<div class="anim-fade-up bg-white dark:bg-zinc-900 rounded-2xl p-8 text-center border border-slate-200/80 dark:border-zinc-800 space-y-3">' +
          '<div class="floaty w-14 h-14 rounded-full bg-gradient-to-tr from-brand-100 to-brand-50 dark:from-brand-950 dark:to-zinc-900 text-brand-500 flex items-center justify-center mx-auto"><i data-lucide="calendar-off" class="w-6 h-6"></i></div>' +
          '<h3 class="font-serif font-bold text-slate-900 dark:text-white text-lg">Sin citas este día</h3>' +
          '<p class="text-xs text-slate-500 max-w-xs mx-auto">Aprovecha para descansar o agendar algo nuevo.</p>' +
          '<button id="btnEmptyNueva" type="button" class="mt-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i> Programar Cita</button></div>';
      document.getElementById("btnEmptyNueva").addEventListener("click", function () { irAVista("nueva"); });
      if (window.lucide) lucide.createIcons();
      return;
    }
    citasDia.forEach(function (c, i) { cont.appendChild(crearFilaCita(c, i)); });
    if (window.lucide) lucide.createIcons();
  }

  // ============================================================
  // RENDER: TODAS
  // ============================================================
  var FILTROS = [
    { id: "todas",       label: "Todas",       icon: "list-todo" },
    { id: "pendientes",  label: "Pendientes",  icon: "clock" },
    { id: "atendidas",   label: "Atendidas",   icon: "check-circle-2" },
    { id: "pasadas",     label: "Pasadas",     icon: "history" },
    { id: "canceladas",  label: "Canceladas",  icon: "x-circle" }
  ];

  function contarFiltro(id) {
    var eo = filtroAEstado(id);
    return state.citas.filter(function (c) { return eo === null || getEstadoVisual(c) === eo; }).length;
  }

  function renderFiltrosTodas() {
    var cont = document.getElementById("filtrosTodas");
    cont.innerHTML = "";
    FILTROS.forEach(function (f) {
      var count = contarFiltro(f.id);
      var active = filtroTodas === f.id;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border " +
        (active ? "bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-600/25"
                : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400");
      btn.innerHTML = '<i data-lucide="' + f.icon + '" class="w-3.5 h-3.5"></i><span>' + f.label + '</span>' +
        '<span class="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ' + (active ? "bg-white/25 text-white" : "bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400") + '">' + count + '</span>';
      btn.addEventListener("click", function () { filtroTodas = f.id; haptic(8); renderTodas(); });
      cont.appendChild(btn);
    });
    if (window.lucide) lucide.createIcons();
  }

  function actualizarBotonInvertirTodas() {
    var txt = document.getElementById("btnInvertirTodasTxt");
    var icon = document.getElementById("iconInvertirTodas");
    if (!txt || !icon) return;
    if (invertirOrdenTodas) { txt.textContent = "Más antiguas primero"; icon.classList.add("is-inverted"); }
    else { txt.textContent = "Más recientes primero"; icon.classList.remove("is-inverted"); }
  }
  function actualizarBotonInvertirAgenda() {
    var icon = document.getElementById("iconInvertirAgenda");
    if (!icon) return;
    if (invertirOrdenAgenda) icon.classList.add("is-inverted");
    else icon.classList.remove("is-inverted");
  }

  function renderTodas() {
    renderFiltrosTodas();
    actualizarBotonInvertirTodas();
    var cont = document.getElementById("todasList");
    cont.innerHTML = "";
    var eo = filtroAEstado(filtroTodas);
    var lista = state.citas.filter(function (c) { return eo === null || getEstadoVisual(c) === eo; });

    var r = document.getElementById("todasResumen");
    if (lista.length === 0) r.textContent = "";
    else r.textContent = lista.length + (lista.length === 1 ? " cita" : " citas");

    if (lista.length === 0) {
      var label = FILTROS.filter(function (f) { return f.id === filtroTodas; })[0];
      var msg = state.citas.length === 0 ? "Aún no tienes citas registradas." : 'No hay citas en "' + (label ? label.label : "") + '".';
      cont.innerHTML = '<div class="anim-fade-up bg-white dark:bg-zinc-900 rounded-2xl p-10 text-center border border-slate-200/80 dark:border-zinc-800 space-y-3">' +
        '<div class="floaty w-14 h-14 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-400 flex items-center justify-center mx-auto"><i data-lucide="inbox" class="w-6 h-6"></i></div>' +
        '<h3 class="font-serif font-bold text-slate-900 dark:text-white text-base">Sin resultados</h3><p class="text-xs text-slate-500 max-w-xs mx-auto">' + msg + '</p></div>';
      if (window.lucide) lucide.createIcons();
      return;
    }

    var porFecha = {};
    lista.forEach(function (c) { (porFecha[c.fecha] = porFecha[c.fecha] || []).push(c); });
    var fechas = Object.keys(porFecha).sort();
    if (invertirOrdenTodas) fechas.reverse();
    var gi = 0;

    fechas.forEach(function (fecha) {
      var cd = porFecha[fecha].sort(function (a, b) { return a.hora.localeCompare(b.hora); });
      if (invertirOrdenTodas) cd.reverse();

      var g = document.createElement("div");
      g.className = "space-y-3 anim-fade-up";
      var fObj = new Date(fecha + "T00:00:00");
      var h = document.createElement("div");
      h.className = "flex items-center justify-between pb-2 border-b border-slate-200 dark:border-zinc-800";
      h.innerHTML = '<h3 class="font-serif font-bold text-slate-900 dark:text-white text-base capitalize flex items-center gap-2">' +
        '<span class="w-7 h-7 rounded-lg bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 flex items-center justify-center"><i data-lucide="calendar" class="w-3.5 h-3.5"></i></span>' +
        conMayuscula(fObj.toLocaleDateString("es-MX", FORMATO_LARGO)) + '</h3>' +
        '<span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400">' + cd.length + '</span>';
      g.appendChild(h);
      var li = document.createElement("div");
      li.className = "space-y-2.5";
      cd.forEach(function (c) { li.appendChild(crearFilaCita(c, gi++)); });
      g.appendChild(li);
      cont.appendChild(g);
    });
    if (window.lucide) lucide.createIcons();
  }

  // ============================================================
  // RENDER: CALENDARIO
  // ============================================================
  var mesActual = new Date(diaActual.getFullYear(), diaActual.getMonth(), 1);
  var diaSeleccionado = null;

  function citasEnFecha(iso) { return state.citas.filter(function (c) { return c.fecha === iso; }); }

  function renderCalendario() {
    document.getElementById("mesLabel").textContent = conMayuscula(mesActual.toLocaleDateString("es-MX", { month: "long", year: "numeric" }));
    var grid = document.getElementById("calGrid");
    grid.innerHTML = "";
    var primerDia = new Date(mesActual.getFullYear(), mesActual.getMonth(), 1);
    var ultimoDia = new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 0);
    var offset = (primerDia.getDay() + 6) % 7;
    var hoyIso = fechaISO(new Date());

    for (var i = 0; i < offset; i++) {
      var bl = document.createElement("div");
      bl.className = "aspect-square rounded-xl opacity-0 pointer-events-none";
      grid.appendChild(bl);
    }

    for (var dia = 1; dia <= ultimoDia.getDate(); dia++) {
      (function (dia) {
        var fecha = new Date(mesActual.getFullYear(), mesActual.getMonth(), dia);
        var iso = fechaISO(fecha);
        var cd = citasEnFecha(iso);
        var tiene = cd.length > 0;
        var celda = document.createElement("button");
        celda.type = "button";
        celda.className = "cal-cell aspect-square rounded-xl border p-1 flex flex-col items-center justify-center transition relative text-xs font-semibold ";

        if (iso === hoyIso) celda.className += "border-brand-500 bg-brand-50/60 dark:bg-brand-950/40 text-brand-600 dark:text-brand-300 font-bold ";
        else if (iso === diaSeleccionado) celda.className += "border-brand-600 bg-brand-600 text-white shadow-md shadow-brand-600/25 ";
        else celda.className += "border-slate-100 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-800/30 text-slate-700 dark:text-slate-300 hover:border-brand-300 ";

        var dots = "";
        if (tiene) {
          var max = Math.min(cd.length, 3);
          dots = '<div class="absolute bottom-1 flex gap-0.5 justify-center">';
          for (var k = 0; k < max; k++) dots += '<span class="w-1.5 h-1.5 rounded-full" style="background:' + statusColor(cd[k]) + '"></span>';
          dots += "</div>";
        }
        celda.innerHTML = '<span>' + dia + "</span>" + dots;
        celda.addEventListener("click", function () { diaSeleccionado = iso; renderCalendario(); mostrarSeleccionCalendario(iso); });
        grid.appendChild(celda);
      })(dia);
    }
  }

  function mostrarSeleccionCalendario(iso) {
    var panel = document.getElementById("calSeleccion");
    var fObj = new Date(iso + "T00:00:00");
    document.getElementById("calSelTitulo").textContent = conMayuscula(fObj.toLocaleDateString("es-MX", FORMATO_LARGO));
    var contenido = document.getElementById("calSelContenido");
    var cd = citasEnFecha(iso).sort(function (a, b) { return a.hora.localeCompare(b.hora); });

    if (cd.length === 0) {
      contenido.innerHTML = '<p class="text-xs text-slate-400 py-2">Sin citas para esta fecha.</p>';
    } else {
      contenido.innerHTML = "";
      cd.forEach(function (c, i) {
        var cli = clientePorId(c.clienteId);
        var item = document.createElement("div");
        item.className = "anim-fade-up flex items-center justify-between text-xs py-2 border-b border-slate-100 dark:border-zinc-800/60 last:border-0";
        item.style.animationDelay = (i * 40) + "ms";
        item.innerHTML = '<div class="flex items-center gap-2 min-w-0">' +
          '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + statusColor(c) + '"></span>' +
          '<span class="font-semibold text-slate-800 dark:text-slate-200 truncate">' + formatHora12(c.hora) + ' · ' + (cli ? cli.nombre : "Cliente") + '</span></div>' +
          '<span class="text-slate-500 dark:text-slate-400 shrink-0 ml-2">' + c.servicio + ' ($' + c.precio + ')</span>';
        contenido.appendChild(item);
      });
    }
    panel.classList.remove("hidden");
    panel.classList.remove("anim-fade-up"); void panel.offsetWidth;
    panel.classList.add("anim-fade-up");
    document.getElementById("calSelBtnAgendar").onclick = function () { irANuevaConFecha(iso); };
    if (window.lucide) lucide.createIcons();
  }

  document.getElementById("prevMes").addEventListener("click", function () { mesActual.setMonth(mesActual.getMonth() - 1); renderCalendario(); });
  document.getElementById("nextMes").addEventListener("click", function () { mesActual.setMonth(mesActual.getMonth() + 1); renderCalendario(); });
  document.getElementById("mesHoy").addEventListener("click", function () {
    mesActual = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    diaSeleccionado = fechaISO(new Date());
    renderCalendario(); mostrarSeleccionCalendario(diaSeleccionado);
  });

  var fechaPendienteNueva = null;
  function irANuevaConFecha(iso) { fechaPendienteNueva = iso; irAVista("nueva"); }

  // ============================================================
  // ACCIONES SOBRE CITAS
  // ============================================================
  function cambiarEstado(id, nuevoEstado) {
    var cita = null;
    state.citas.forEach(function (c) { if (c.id === id) { c.estado = nuevoEstado; cita = c; } });
    guardar(state);
    limpiarNotificado(id); // FIX P1.3: limpiar marca al cambiar estado
    haptic(nuevoEstado === "atendida" ? [15, 40, 15] : 20);
    if (nuevoEstado === "atendida") {
      showToast("Cita atendida ✓", "success", { label: "Cobrar", fn: function () { if (cita && !cita.pagado) togglePago(cita.id); } });
    } else if (nuevoEstado === "cancelada") {
      showToast("Cita cancelada", "info");
    }
    refrescarVistaActiva();
    if (vistaActual === "calendario" && diaSeleccionado) mostrarSeleccionCalendario(diaSeleccionado);
  }

  function togglePago(id) {
    state.citas.forEach(function (c) { if (c.id === id) c.pagado = !c.pagado; });
    guardar(state);
    haptic(12);
    showToast("Estado de pago actualizado", "success");
    refrescarVistaActiva();
  }

  function pedirConfirmacionEliminar(cita) {
    var cli = clientePorId(cita.clienteId);
    document.getElementById("deleteModalTitle").textContent = "¿Eliminar cita?";
    document.getElementById("deleteModalDesc").textContent =
      "Se eliminará la cita de " + (cli ? cli.nombre : "cliente") + " (" + formatHora12(cita.hora) + "). Esta acción no se puede deshacer.";
    deleteCallback = function () {
      state.citas = state.citas.filter(function (c) { return c.id !== cita.id; });
      guardar(state);
      limpiarNotificado(cita.id);
      haptic([10, 50, 10]);
      showToast("Cita eliminada", "info");
      refrescarVistaActiva();
    };
    showModal(document.getElementById("deleteModal"));
  }

  function pedirConfirmacionEliminarCliente(clienteId) {
    var cli = clientePorId(clienteId);
    if (!cli) return;
    var nCitas = state.citas.filter(function (c) { return c.clienteId === clienteId; }).length;
    document.getElementById("deleteModalTitle").textContent = "¿Eliminar cliente?";
    document.getElementById("deleteModalDesc").textContent = nCitas > 0
      ? "Se eliminará a " + cli.nombre + " y también sus " + nCitas + " cita" + (nCitas === 1 ? "" : "s") + " asociada" + (nCitas === 1 ? "" : "s") + "."
      : "Se eliminará a " + cli.nombre + " de tu lista.";
    deleteCallback = function () {
      state.clientes = state.clientes.filter(function (c) { return c.id !== clienteId; });
      if (nCitas > 0) state.citas = state.citas.filter(function (c) { return c.clienteId !== clienteId; });
      guardar(state);
      haptic([10, 50, 10]);
      showToast("Cliente eliminado", "info");
      clienteActualId = null;
      refrescarVistaActiva();
    };
    showModal(document.getElementById("deleteModal"));
  }

  document.getElementById("btnCancelDelete").addEventListener("click", function () { hideModal(document.getElementById("deleteModal")); deleteCallback = null; });
  document.getElementById("btnConfirmDelete").addEventListener("click", function () { hideModal(document.getElementById("deleteModal")); if (deleteCallback) deleteCallback(); deleteCallback = null; });

  document.getElementById("prevDay").addEventListener("click", function () { diaActual.setDate(diaActual.getDate() - 1); renderAgenda(); });
  document.getElementById("nextDay").addEventListener("click", function () { diaActual.setDate(diaActual.getDate() + 1); renderAgenda(); });
  document.getElementById("goToday").addEventListener("click", function () { diaActual = new Date(); renderAgenda(); });
  document.getElementById("btnInvertirAgenda").addEventListener("click", function () { invertirOrdenAgenda = !invertirOrdenAgenda; actualizarBotonInvertirAgenda(); renderAgenda(); });
  document.getElementById("btnInvertirTodas").addEventListener("click", function () { invertirOrdenTodas = !invertirOrdenTodas; actualizarBotonInvertirTodas(); renderTodas(); });

  document.getElementById("fabNueva").addEventListener("click", function () {
    haptic(12);
    fechaPendienteNueva = fechaISO(new Date());
    irAVista("nueva");
  });

  // ============================================================
  // CLIENTES
  // ============================================================
  function letraDe(nombre) {
    var c = (nombre || "").trim().charAt(0).toUpperCase();
    if (!c) return "#";
    if (c === "Ñ") return "Ñ";
    c = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/^[A-Z]$/.test(c)) return c;
    return "#";
  }

  function renderClientes(filtro) {
    var cont = document.getElementById("clientesList");
    cont.innerHTML = "";
    alphaIndexEl.innerHTML = "";
    var f = (filtro || "").trim().toLowerCase();
    var lista = state.clientes.filter(function (c) {
      if (!f) return true;
      return c.nombre.toLowerCase().indexOf(f) !== -1 || (c.tel || "").indexOf(f) !== -1;
    });

    var resumen = document.getElementById("clientesResumen");
    if (resumen) {
      if (f) resumen.textContent = lista.length + (lista.length === 1 ? " resultado" : " resultados");
      else resumen.textContent = state.clientes.length + (state.clientes.length === 1 ? " cliente registrado" : " clientes registrados");
    }

    if (lista.length === 0) {
      var vacio = state.clientes.length === 0;
      cont.innerHTML = '<div class="anim-fade-up bg-white dark:bg-zinc-900 rounded-2xl p-10 text-center border border-slate-200/80 dark:border-zinc-800 space-y-3">' +
        '<div class="floaty w-14 h-14 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-400 flex items-center justify-center mx-auto"><i data-lucide="users" class="w-6 h-6"></i></div>' +
        '<h3 class="font-serif font-bold text-slate-900 dark:text-white text-base">' + (vacio ? "Aún no hay clientes" : "Sin resultados") + '</h3>' +
        '<p class="text-xs text-slate-500 max-w-xs mx-auto">' + (vacio ? "Agrega tu primer cliente arriba." : "Prueba con otra búsqueda.") + '</p></div>';
      alphaIndexEl.classList.remove("visible");
      if (window.lucide) lucide.createIcons();
      return;
    }

    lista.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }); });
    var grupos = {};
    lista.forEach(function (cli) { var l = letraDe(cli.nombre); (grupos[l] = grupos[l] || []).push(cli); });
    var letras = Object.keys(grupos).sort(function (a, b) {
      if (a === "#") return 1; if (b === "#") return -1;
      if (a === "Ñ" && b === "N") return 1; if (b === "Ñ" && a === "N") return -1;
      return a.localeCompare(b, "es");
    });

    letras.forEach(function (letra) {
      var grupo = document.createElement("div");
      grupo.className = "anim-fade-up";
      grupo.id = "grupo-letra-" + letra;
      var header = document.createElement("div");
      header.className = "flex items-center gap-2 mb-2 sticky top-[60px] sm:top-[120px] z-10 py-1";
      header.innerHTML = '<span class="letter-header">' + letra + '</span>' +
        '<span class="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">' +
        (grupos[letra].length === 1 ? "1 cliente" : grupos[letra].length + " clientes") + '</span>' +
        '<span class="flex-1 h-px bg-slate-200 dark:bg-zinc-800"></span>';
      grupo.appendChild(header);

      var inner = document.createElement("div");
      inner.className = "grid grid-cols-1 md:grid-cols-2 gap-2.5";
      grupos[letra].forEach(function (cli, i) {
        var nCitas = state.citas.filter(function (c) { return c.clienteId === cli.id; }).length;
        var card = document.createElement("button");
        card.type = "button";
        card.className = "card-hover bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-slate-200/80 dark:border-zinc-800 shadow-sm flex items-center justify-between gap-3 text-left w-full";
        card.style.animationDelay = (i * 30) + "ms";
        card.innerHTML = '<div class="flex items-center gap-3 min-w-0">' +
          '<div class="w-10 h-10 rounded-full bg-gradient-to-tr from-brand-500 to-brand-400 text-white font-bold flex items-center justify-center font-serif shadow-md shadow-brand-500/25 shrink-0">' + cli.nombre.charAt(0).toUpperCase() + '</div>' +
          '<div class="min-w-0"><h4 class="font-bold text-sm text-slate-900 dark:text-white truncate">' + cli.nombre + '</h4>' +
          '<p class="text-xs text-slate-400 flex items-center gap-1 truncate"><i data-lucide="phone" class="w-3 h-3 shrink-0"></i>' + (cli.tel || "Sin teléfono") + '</p></div></div>' +
          '<span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-slate-400 shrink-0">' + nCitas + ' citas</span>';
        card.addEventListener("click", function () { haptic(10); abrirFichaCliente(cli.id); });
        inner.appendChild(card);
      });
      grupo.appendChild(inner);
      cont.appendChild(grupo);
    });

    buildAlphaIndex(letras);
    if (window.lucide) lucide.createIcons();
  }

  function buildAlphaIndex(letras) {
    alphaIndexEl.innerHTML = "";
    if (vistaActual !== "clientes" || window.innerWidth >= 640 || letras.length <= 1) { alphaIndexEl.classList.remove("visible"); return; }
    letras.forEach(function (letra) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = letra;
      b.addEventListener("click", function () {
        var t = document.getElementById("grupo-letra-" + letra);
        if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 80, behavior: "smooth" });
      });
      alphaIndexEl.appendChild(b);
    });
    alphaIndexEl.classList.add("visible");
  }

  var buscarInput = document.getElementById("buscarCliente");
  var btnLimpiar = document.getElementById("btnLimpiarBusqueda");
  buscarInput.addEventListener("input", function (e) {
    var v = e.target.value;
    if (v) btnLimpiar.classList.remove("hidden"); else btnLimpiar.classList.add("hidden");
    renderClientes(v);
  });
  btnLimpiar.addEventListener("click", function () { buscarInput.value = ""; btnLimpiar.classList.add("hidden"); renderClientes(""); buscarInput.focus(); });

  // ============================================================
  // FICHA CLIENTE
  // ============================================================
  function renderFichaClienteBody(clienteId) {
    var cli = clientePorId(clienteId);
    if (!cli) { hideModal(document.getElementById("clientModal")); clienteActualId = null; return; }

    var citas = state.citas.filter(function (c) { return c.clienteId === clienteId; });
    var atendidas = citas.filter(function (c) { return c.estado === "atendida"; });
    var gastado = atendidas.reduce(function (a, c) { return a + Number(c.precio || 0); }, 0);
    var ultima = citas.slice().sort(function (a, b) { return (b.fecha + b.hora).localeCompare(a.fecha + a.hora); })[0];

    var body = document.getElementById("clientModalBody");
    body.innerHTML =
      '<div class="flex items-center gap-4">' +
        '<div class="w-16 h-16 rounded-full bg-gradient-to-tr from-brand-500 to-brand-400 text-white font-bold text-2xl flex items-center justify-center font-serif shadow-lg shadow-brand-500/25 shrink-0">' + cli.nombre.charAt(0).toUpperCase() + '</div>' +
        '<div class="min-w-0 flex-1"><h2 class="font-serif font-bold text-lg text-slate-900 dark:text-white truncate">' + cli.nombre + '</h2>' +
        (cli.tel ? '<a href="' + waLink(cli.tel, "¡Hola " + cli.nombre.split(" ")[0] + "!") + '" target="_blank" rel="noopener" class="text-sm text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 mt-0.5"><i data-lucide="message-circle" class="w-3.5 h-3.5"></i>' + cli.tel + '</a>' : '<p class="text-sm text-slate-400">Sin teléfono</p>') + '</div></div>' +
      '<div class="grid grid-cols-3 gap-2">' +
        '<div class="bg-slate-50 dark:bg-zinc-800/50 rounded-xl p-2.5 text-center border border-slate-100 dark:border-zinc-800"><p class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Citas</p><p class="text-lg font-extrabold text-slate-900 dark:text-white stat-number">' + citas.length + '</p></div>' +
        '<div class="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-2.5 text-center border border-emerald-100 dark:border-emerald-900/40"><p class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Total</p><p class="text-lg font-extrabold text-emerald-700 dark:text-emerald-300 stat-number">$' + gastado + '</p></div>' +
        '<div class="bg-brand-50 dark:bg-brand-950/30 rounded-xl p-2.5 text-center border border-brand-100 dark:border-brand-900/40"><p class="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">Visitas</p><p class="text-lg font-extrabold text-brand-700 dark:text-brand-300 stat-number">' + atendidas.length + '</p></div>' +
      '</div>' +
      (ultima ? '<p class="text-xs text-slate-500 dark:text-slate-400 text-center">Última visita: <span class="font-semibold capitalize">' + conMayuscula(new Date(ultima.fecha + "T00:00:00").toLocaleDateString("es-MX", FORMATO_LARGO)) + '</span></p>' : '') +
      '<div class="space-y-1.5 pt-3 border-t border-slate-100 dark:border-zinc-800"><label class="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><i data-lucide="notebook-pen" class="w-3.5 h-3.5"></i>Notas del cliente</label>' +
      '<textarea id="clienteNotas" rows="3" placeholder="Alergias, preferencias..." class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/50 text-sm outline-none focus:ring-2 focus:ring-brand-500">' + (cli.notas || "") + '</textarea>' +
      '<p class="text-[10px] text-slate-400 text-right">Se guardan automáticamente</p></div>' +
      '<div class="flex gap-2 pt-2">' +
        '<button id="btnFichaNuevaCita" type="button" class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 text-white font-semibold text-sm shadow-lg shadow-brand-600/25 flex items-center justify-center gap-2"><i data-lucide="plus" class="w-4 h-4"></i> Nueva cita</button>' +
        '<button id="btnFichaEliminarCliente" type="button" title="Eliminar cliente" class="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 active:bg-red-200 font-semibold text-sm flex items-center justify-center"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>' +
      '<div class="pt-4 border-t border-slate-100 dark:border-zinc-800 space-y-2"><h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2"><i data-lucide="history" class="w-3.5 h-3.5"></i>Historial de citas</h4><div id="fichaHistorial" class="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1"></div></div>';

    var hist = document.getElementById("fichaHistorial");
    var ordenadas = citas.slice().sort(function (a, b) { return (b.fecha + b.hora).localeCompare(a.fecha + a.hora); });
    if (ordenadas.length === 0) hist.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center">Sin historial aún.</p>';
    else {
      ordenadas.forEach(function (c) {
        var row = document.createElement("div");
        row.className = "flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/40 border border-slate-100 dark:border-zinc-800/60 text-xs";
        row.innerHTML = '<div class="flex items-center gap-2 min-w-0 flex-1">' +
          '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + statusColor(c) + '"></span>' +
          '<div class="min-w-0 flex-1"><div class="flex items-center gap-2">' +
            '<p class="font-semibold text-slate-800 dark:text-slate-200 truncate capitalize">' + new Date(c.fecha + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) + ' · ' + formatHora12(c.hora) + '</p>' +
            getStatusBadgeMiniHtml(c) + '</div>' +
            '<p class="text-slate-500 dark:text-slate-400 truncate">' + c.servicio + '</p></div></div>' +
          '<div class="flex items-center gap-1.5 shrink-0"><div class="text-right"><p class="font-bold text-slate-900 dark:text-white">$' + c.precio + '</p>' +
            '<p class="text-[10px] ' + (c.pagado ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400") + '">' + (c.pagado ? "Pagado" : "Pendiente") + '</p></div>' +
          '<button type="button" class="p-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-slate-400 hover:text-brand-600 hover:border-brand-400 transition" title="Editar cita" data-edit-cita="' + c.id + '"><i data-lucide="pencil" class="w-3 h-3"></i></button></div>';
        row.querySelector('[data-edit-cita]').addEventListener("click", function (e) { e.stopPropagation(); haptic(10); abrirEditarCita(c.id); });
        hist.appendChild(row);
      });
    }

    var ta = document.getElementById("clienteNotas");
    function guardarNotas() { cli.notas = ta.value.trim(); guardar(state); }
    ta.addEventListener("change", guardarNotas);
    ta.addEventListener("blur", guardarNotas);

    document.getElementById("btnFichaNuevaCita").addEventListener("click", function () {
      hideModal(document.getElementById("clientModal"));
      fechaPendienteNueva = fechaISO(new Date());
      irAVista("nueva");
      setTimeout(function () { var sel = document.getElementById("selCliente"); if (sel) sel.value = clienteId; }, 100);
    });
    document.getElementById("btnFichaEliminarCliente").addEventListener("click", function () {
      hideModal(document.getElementById("clientModal"));
      haptic(15);
      setTimeout(function () { pedirConfirmacionEliminarCliente(clienteId); }, 180);
    });

    if (window.lucide) lucide.createIcons();
  }

  function abrirFichaCliente(id) {
    clienteActualId = id;
    renderFichaClienteBody(id);
    showModal(document.getElementById("clientModal"));
  }
  document.getElementById("btnCloseClientModal").addEventListener("click", function () { hideModal(document.getElementById("clientModal")); clienteActualId = null; });

  var btnImport = document.getElementById("btnImportContacts");
  btnImport.addEventListener("click", function () {
    if (!("contacts" in navigator) || !("ContactsManager" in window)) { showToast("Solo Chrome en Android permite importar contactos", "error"); return; }
    navigator.contacts.select(["name", "tel"], { multiple: true }).then(function (contacts) {
      if (!contacts || contacts.length === 0) return;
      var added = 0;
      contacts.forEach(function (c) {
        var nombre = (c.name && c.name[0]) || "";
        var tel = (c.tel && c.tel[0]) || "";
        if (!nombre) return;
        state.clientes.push({ id: uid(), nombre: nombre, tel: tel.replace(/\D/g, ""), notas: "" });
        added++;
      });
      guardar(state);
      renderClientes(buscarInput.value);
      poblarSelectClientes();
      haptic([10, 40, 10]);
      showToast(added + " contacto" + (added === 1 ? "" : "s") + " agregado" + (added === 1 ? "" : "s"), "success");
    }).catch(function (err) { if (err && err.name !== "AbortError") showToast("No se pudieron importar", "error"); });
  });

  document.getElementById("btnAddCliente").addEventListener("click", function () {
    var nombre = document.getElementById("nuevoClienteNombre").value.trim();
    var tel = document.getElementById("nuevoClienteTel").value.trim();
    if (!nombre) { showToast("Escribe el nombre", "error"); return; }
    state.clientes.push({ id: uid(), nombre: nombre, tel: tel.replace(/\D/g, ""), notas: "" });
    guardar(state);
    document.getElementById("nuevoClienteNombre").value = "";
    document.getElementById("nuevoClienteTel").value = "";
    renderClientes(buscarInput.value);
    poblarSelectClientes();
    haptic([10, 30, 10]);
    showToast("Cliente agregado ✓", "success");
    document.getElementById("nuevoClienteNombre").focus();
  });

  function poblarSelectClientes() {
    var sel = document.getElementById("selCliente");
    var actual = sel.value;
    sel.innerHTML = "";
    if (state.clientes.length === 0) {
      var optVacio = document.createElement("option");
      optVacio.value = "__nuevo__"; optVacio.textContent = "+ Agregar Nuevo Cliente";
      sel.appendChild(optVacio); return;
    }
    state.clientes.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); }).forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id; opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
    var optNuevo = document.createElement("option");
    optNuevo.value = "__nuevo__"; optNuevo.textContent = "+ Agregar Nuevo Cliente";
    sel.appendChild(optNuevo);
    if (actual) sel.value = actual;
  }

  document.getElementById("selCliente").addEventListener("change", function (e) {
    var inline = document.getElementById("nuevoClienteInline");
    if (e.target.value === "__nuevo__") inline.classList.remove("hidden");
    else inline.classList.add("hidden");
  });

  // ============================================================
  // SERVICIOS
  // ============================================================
  function renderServiciosChips() {
    var cont = document.getElementById("serviciosContainer");
    cont.innerHTML = "";
    if (state.servicios.length === 0) {
      cont.innerHTML = '<p class="text-xs text-slate-400 italic py-1">Aún no hay servicios guardados. Agrega uno con el botón "Administrar".</p>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    state.servicios.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      var isSel = !!selectedServicesMap[s.id];
      chip.className = "px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5 active:scale-95 " +
        (isSel ? "bg-brand-600 text-white border-brand-600 shadow-sm shadow-brand-600/25 anim-pop"
                : "bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-zinc-700 hover:border-brand-400");
      chip.innerHTML = (isSel ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : "") + s.nombre + ' <span class="opacity-75">($' + s.precio + ')</span>';
      chip.addEventListener("click", function () {
        if (selectedServicesMap[s.id]) delete selectedServicesMap[s.id];
        else selectedServicesMap[s.id] = s;
        actualizarCamposServicios();
        renderServiciosChips();
      });
      cont.appendChild(chip);
    });
    if (window.lucide) lucide.createIcons();
  }
  function actualizarCamposServicios() {
    var keys = Object.keys(selectedServicesMap);
    if (keys.length === 0) return;
    var nombres = [], total = 0;
    keys.forEach(function (k) { nombres.push(selectedServicesMap[k].nombre); total += Number(selectedServicesMap[k].precio); });
    document.getElementById("inpServicio").value = nombres.join(" y ");
    document.getElementById("inpPrecio").value = total;
  }

  var serviceModal = document.getElementById("serviceModal");
  document.getElementById("btnOpenAddServiceModal").addEventListener("click", function () { renderModalServicesList(); showModal(serviceModal); });
  document.getElementById("btnCloseServiceModal").addEventListener("click", function () { hideModal(serviceModal); });

  function renderModalServicesList() {
    var list = document.getElementById("modalServicesList");
    list.innerHTML = "";
    if (state.servicios.length === 0) { list.innerHTML = '<p class="text-xs text-slate-400">Sin servicios.</p>'; return; }
    state.servicios.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-zinc-800 text-xs";
      row.innerHTML = '<span class="font-medium text-slate-800 dark:text-slate-200">' + s.nombre + ' ($' + s.precio + ')</span>' +
        '<button type="button" class="text-red-500 hover:text-red-700 p-1 rounded-lg"><i data-lucide="trash" class="w-3.5 h-3.5"></i></button>';
      row.querySelector("button").addEventListener("click", function () { eliminarServicio(s.id); });
      list.appendChild(row);
    });
    if (window.lucide) lucide.createIcons();
  }
  function eliminarServicio(id) {
    state.servicios = state.servicios.filter(function (s) { return s.id !== id; });
    delete selectedServicesMap[id];
    guardar(state);
    renderModalServicesList(); renderServiciosChips(); actualizarCamposServicios();
    showToast("Servicio eliminado", "info");
  }
  document.getElementById("btnSaveNewService").addEventListener("click", function () {
    var name = document.getElementById("newServiceName").value.trim();
    var price = Number(document.getElementById("newServicePrice").value) || 0;
    if (!name) { showToast("Escribe el nombre", "error"); return; }
    state.servicios.push({ id: uid(), nombre: name, precio: price });
    guardar(state);
    document.getElementById("newServiceName").value = "";
    document.getElementById("newServicePrice").value = "";
    renderModalServicesList(); renderServiciosChips();
    showToast("Servicio agregado", "success");
  });

  function prepararFormulario() {
    poblarSelectClientes();
    renderServiciosChips();
    document.getElementById("inpFecha").value = fechaPendienteNueva || fechaISO(diaActual);
    fechaPendienteNueva = null;
    document.getElementById("avisoError").classList.add("hidden");
    document.getElementById("avisoOk").classList.add("hidden");
  }

  // ============================================================
  // FIX P1.1: submit usa hayConflicto
  // ============================================================
  document.getElementById("formCita").addEventListener("submit", function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("avisoError");
    var okBox = document.getElementById("avisoOk");
    errorBox.classList.add("hidden"); okBox.classList.add("hidden");

    var selVal = document.getElementById("selCliente").value;
    var clienteId = selVal;

    if (selVal === "__nuevo__") {
      var nn = document.getElementById("inlineNombre").value.trim();
      if (!nn) {
        document.getElementById("avisoErrorTxt").textContent = "Escribe el nombre del nuevo cliente.";
        errorBox.classList.remove("hidden"); if (window.lucide) lucide.createIcons(); return;
      }
      var nid = uid();
      state.clientes.push({ id: nid, nombre: nn, tel: (document.getElementById("inlineTel").value || "").replace(/\D/g, ""), notas: "" });
      clienteId = nid;
    }

    var fecha = document.getElementById("inpFecha").value;
    var hora = document.getElementById("inpHora").value;
    var duracion = Number(document.getElementById("inpDuracion").value) || 60;
    var servicio = document.getElementById("inpServicio").value.trim();
    var precio = Number(document.getElementById("inpPrecio").value) || 0;
    var notas = document.getElementById("inpNotas").value.trim();

    if (!fecha || !hora || !servicio) {
      document.getElementById("avisoErrorTxt").textContent = "Completa fecha, hora y servicio.";
      errorBox.classList.remove("hidden"); if (window.lucide) lucide.createIcons(); return;
    }

    var choque = buscarConflicto(fecha, hora, duracion, null);
    if (choque) {
      var cliChoque = clientePorId(choque.clienteId);
      document.getElementById("avisoErrorTxt").textContent =
        "Se cruza con la cita de " + (cliChoque ? cliChoque.nombre : "otro cliente") +
        " (" + formatHora12(choque.hora) + " – " + formatHora12(horaFin(choque)) + ").";
      errorBox.classList.remove("hidden"); if (window.lucide) lucide.createIcons(); return;
    }

    state.citas.push({
      id: uid(), clienteId: clienteId, fecha: fecha, hora: hora, duracion: duracion,
      servicio: servicio, precio: precio, estado: "pendiente", pagado: false, notas: notas
    });
    guardar(state);
    haptic([15, 30, 15]);

    document.getElementById("avisoOkTxt").textContent = "¡Cita agendada!";
    okBox.classList.remove("hidden"); if (window.lucide) lucide.createIcons();

    document.getElementById("formCita").reset();
    document.getElementById("nuevoClienteInline").classList.add("hidden");
    selectedServicesMap = {};
    poblarSelectClientes();
    renderServiciosChips();
    showToast("Cita agendada ✓", "success");
    diaActual = new Date(fecha + "T00:00:00");
    setTimeout(function () { irAVista("agenda"); }, 900);
  });

  // ============================================================
  // EDITAR CITA
  // ============================================================
  var editModal = document.getElementById("editModal");
  function setEditEstado(estado) {
    editEstadoActual = estado;
    document.querySelectorAll("#editEstadoGroup .estado-btn").forEach(function (b) {
      var e = b.getAttribute("data-estado");
      if (e === estado) {
        if (e === "pendiente") b.className = "estado-btn py-2 rounded-xl text-xs font-semibold border transition bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/25";
        else if (e === "atendida") b.className = "estado-btn py-2 rounded-xl text-xs font-semibold border transition bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/25";
        else b.className = "estado-btn py-2 rounded-xl text-xs font-semibold border transition bg-slate-500 text-white border-slate-500 shadow-md shadow-slate-500/25";
      } else {
        b.className = "estado-btn py-2 rounded-xl text-xs font-semibold border transition bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-700 hover:border-brand-400";
      }
    });
  }
  document.querySelectorAll("#editEstadoGroup .estado-btn").forEach(function (b) {
    b.addEventListener("click", function () { setEditEstado(b.getAttribute("data-estado")); haptic(8); });
  });

  function abrirEditarCita(id) {
    var cita = state.citas.filter(function (c) { return c.id === id; })[0];
    if (!cita) return;
    editandoId = id;
    var sel = document.getElementById("editCliente");
    sel.innerHTML = "";
    state.clientes.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); }).forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id; opt.textContent = c.nombre;
      sel.appendChild(opt);
    });
    sel.value = cita.clienteId;
    document.getElementById("editFecha").value = cita.fecha;
    document.getElementById("editHora").value = cita.hora;
    document.getElementById("editDuracion").value = String(cita.duracion || 60);
    document.getElementById("editServicio").value = cita.servicio;
    document.getElementById("editPrecio").value = cita.precio;
    document.getElementById("editNotas").value = cita.notas || "";
    setEditEstado(cita.estado);
    showModal(editModal);
  }
  function cerrarEditModal() { hideModal(editModal); editandoId = null; }
  document.getElementById("btnCloseEditModal").addEventListener("click", cerrarEditModal);
  document.getElementById("btnCloseEditModal2").addEventListener("click", cerrarEditModal);

  document.getElementById("btnGuardarEdicion").addEventListener("click", function () {
    if (!editandoId) return;
    var cita = state.citas.filter(function (c) { return c.id === editandoId; })[0];
    if (!cita) return;
    var fecha = document.getElementById("editFecha").value;
    var hora = document.getElementById("editHora").value;
    var duracion = Number(document.getElementById("editDuracion").value) || 60;
    var servicio = document.getElementById("editServicio").value.trim();
    if (!fecha || !hora || !servicio) { showToast("Completa fecha, hora y servicio", "error"); return; }

    var choque = buscarConflicto(fecha, hora, duracion, editandoId);
    if (choque) {
      var cliCh = clientePorId(choque.clienteId);
      showToast("Se cruza con " + (cliCh ? cliCh.nombre : "otra cita") + " (" + formatHora12(choque.hora) + " – " + formatHora12(horaFin(choque)) + ")", "error");
      return;
    }

    cita.clienteId = document.getElementById("editCliente").value;
    cita.fecha = fecha;
    cita.hora = hora;
    cita.duracion = duracion;
    cita.servicio = servicio;
    cita.precio = Number(document.getElementById("editPrecio").value) || 0;
    cita.estado = editEstadoActual;
    cita.notas = document.getElementById("editNotas").value.trim();
    guardar(state);
    limpiarNotificado(cita.id); // FIX P1.3: reprogramar permite volver a notificar
    haptic([10, 30, 10]);
    cerrarEditModal();
    showToast("Cita actualizada ✓", "success");
    refrescarVistaActiva();
  });

  // ============================================================
  // MODO DÍA
  // ============================================================
  function renderModoDia() {
    document.getElementById("modoDiaFecha").textContent = conMayuscula(modoDiaFecha.toLocaleDateString("es-MX", FORMATO_LARGO));
    var iso = fechaISO(modoDiaFecha);
    var citas = state.citas.filter(function (c) { return c.fecha === iso; }).sort(function (a, b) { return a.hora.localeCompare(b.hora); });
    var cont = document.getElementById("modoDiaList");
    cont.innerHTML = "";

    if (citas.length === 0) {
      cont.innerHTML = '<div class="bg-white dark:bg-zinc-900 rounded-3xl p-10 text-center border border-slate-200/80 dark:border-zinc-800"><p class="text-4xl mb-3">🎉</p><h3 class="font-serif font-bold text-xl text-slate-900 dark:text-white">Día libre</h3><p class="text-sm text-slate-500 mt-2">No hay citas para este día.</p></div>';
      return;
    }

    citas.forEach(function (c) {
      var cli = clientePorId(c.clienteId);
      var card = document.createElement("div");
      card.className = "cita-card bg-white dark:bg-zinc-900 rounded-3xl p-5 border-2 border-slate-200 dark:border-zinc-800 shadow-sm";
      card.style.setProperty("--status-color", statusColor(c));
      card.innerHTML =
        '<div class="flex items-center justify-between gap-3 mb-3"><div class="text-3xl font-extrabold font-serif stat-number text-slate-900 dark:text-white">' + formatHora12(c.hora) + '</div>' +
        '<div class="text-right">' + getStatusBadgeHtml(c) + (c.pagado ? '<div class="mt-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ PAGADO</div>' : '') + '</div></div>' +
        '<h3 class="text-2xl font-bold text-slate-900 dark:text-white mb-1 truncate">' + (cli ? cli.nombre : "Cliente") + '</h3>' +
        '<p class="text-base text-slate-600 dark:text-slate-300 mb-4">' + c.servicio + ' · $' + c.precio + '</p>' +
        (c.notas ? '<p class="text-sm italic bg-slate-50 dark:bg-zinc-800/40 p-3 rounded-xl text-slate-600 dark:text-slate-400 mb-4">"' + c.notas + '"</p>' : '') +
        '<div class="grid grid-cols-2 gap-2">' +
          (c.estado === "pendiente" ? '<button data-action="atender" class="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base flex items-center justify-center gap-2"><i data-lucide="check" class="w-5 h-5"></i>Atender</button>' : '') +
          (cli && cli.tel ? '<a href="' + waLink(cli.tel, recordatorioTexto(c)) + '" target="_blank" rel="noopener" class="py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2 col-span-' + (c.estado === "pendiente" ? "1" : "2") + '"><i data-lucide="message-circle" class="w-5 h-5"></i>WhatsApp</a>' : '') +
        '</div>';
      if (c.estado === "pendiente") {
        card.querySelector('[data-action="atender"]').addEventListener("click", function () { cambiarEstado(c.id, "atendida"); renderModoDia(); });
      }
      cont.appendChild(card);
    });
    if (window.lucide) lucide.createIcons();
  }

  document.getElementById("btnModoDia").addEventListener("click", function () {
    modoDiaFecha = new Date(diaActual);
    document.getElementById("modoDia").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    renderModoDia();
  });
  document.getElementById("btnCerrarModoDia").addEventListener("click", function () {
    document.getElementById("modoDia").classList.add("hidden");
    document.body.style.overflow = "";
  });
  document.getElementById("modoPrevDay").addEventListener("click", function () { modoDiaFecha.setDate(modoDiaFecha.getDate() - 1); renderModoDia(); });
  document.getElementById("modoNextDay").addEventListener("click", function () { modoDiaFecha.setDate(modoDiaFecha.getDate() + 1); renderModoDia(); });
  document.getElementById("modoToday").addEventListener("click", function () { modoDiaFecha = new Date(); renderModoDia(); });

  // ============================================================
  // SWIPE
  // ============================================================
  var touchActive = false, touchDecided = false, touchDir = null;
  var startX = 0, startY = 0, startTranslate = 0, trackWidth = 0;

  function isInteractiveTarget(el) {
    if (!el || !el.closest) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.closest(".modal-backdrop")) return true;
    if (el.closest("#mobileNav") || el.closest("#fabNueva")) return true;
    if (el.closest("#alphaIndex")) return true;
    if (el.closest("#themePanel")) return true;
    if (el.closest("#modoDia")) return true;
    if (el.closest("[data-no-swipe]")) return true;
    return false;
  }

  document.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1 || vistaActual === "nueva") return;
    if (isInteractiveTarget(e.target)) return;
    var t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    trackWidth = viewsTrack.offsetWidth || 1;
    startTranslate = -currentIndex * trackWidth;
    touchActive = true; touchDecided = false; touchDir = null;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!touchActive || e.touches.length !== 1) return;
    var t = e.touches[0];
    var dx = t.clientX - startX, dy = t.clientY - startY;
    if (!touchDecided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      touchDecided = true;
      if (Math.abs(dy) > Math.abs(dx)) { touchActive = false; return; }
      else { touchDir = "h"; viewsTrack.style.transition = "none"; }
    }
    if (touchDir !== "h") return;
    if (e.cancelable) e.preventDefault();
    var tr = startTranslate + dx;
    var minTr = -(SWIPE_ORDER.length - 1) * trackWidth, maxTr = 0;
    if (tr > maxTr) tr = maxTr + (tr - maxTr) * 0.3;
    else if (tr < minTr) tr = minTr + (tr - minTr) * 0.3;
    viewsTrack.style.transform = "translateX(" + tr + "px)";
  }, { passive: false });

  document.addEventListener("touchend", function (e) {
    if (!touchActive) { touchDecided = false; touchDir = null; return; }
    if (touchDir !== "h") { touchActive = false; touchDecided = false; touchDir = null; return; }
    var t = e.changedTouches[0];
    var dx = t.clientX - startX;
    var threshold = trackWidth * 0.22;
    if (dx < -threshold && currentIndex < SWIPE_ORDER.length - 1) irAVista(SWIPE_ORDER[currentIndex + 1]);
    else if (dx > threshold && currentIndex > 0) irAVista(SWIPE_ORDER[currentIndex - 1]);
    else {
      viewsTrack.style.transition = "transform .35s cubic-bezier(.16, 1, .3, 1)";
      viewsTrack.style.transform = "translateX(" + (-currentIndex * 100) + "%)";
    }
    touchActive = false; touchDecided = false; touchDir = null;
  }, { passive: true });

  document.addEventListener("touchcancel", function () {
    if (touchDir === "h") {
      viewsTrack.style.transition = "transform .3s ease";
      viewsTrack.style.transform = "translateX(" + (-currentIndex * 100) + "%)";
    }
    touchActive = false; touchDecided = false; touchDir = null;
  }, { passive: true });

  // ============================================================
  // REFRESCO PERIÓDICO (silencioso) + notificaciones
  // ============================================================
  setInterval(function () {
    if (vistaActual === "agenda" || vistaActual === "todas" || vistaActual === "calendario") {
      refrescarSilencioso();
    }
    revisarNotificaciones();
  }, 30000);

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      setTrackIndex(currentIndex, false);
      if (vistaActual === "clientes") renderClientes(buscarInput.value);
    }, 200);
  });

  // ============================================================
  // PWA (Service Worker real, no blob)
  // ============================================================
  (function initPWA() {
    var deferredPrompt = null;
    var installBtn = document.getElementById("installBtn");

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (window.matchMedia("(display-mode: standalone)").matches) return;
      if (localStorage.getItem("installDismissed") === "1") return;
      installBtn.classList.add("show");
    });

    installBtn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      installBtn.classList.remove("show");
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === "dismissed") localStorage.setItem("installDismissed", "1");
        deferredPrompt = null;
      });
    });

    window.addEventListener("appinstalled", function () {
      installBtn.classList.remove("show");
      localStorage.removeItem("installDismissed");
      haptic([15, 40, 15]);
      showToast("¡App instalada! Búscala en tu pantalla de inicio 🎉", "success");
    });

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (isIOS && !isStandalone && localStorage.getItem("installDismissed") !== "1") {
      var iosBtn = document.createElement("button");
      iosBtn.id = "installBtnIOS";
      iosBtn.type = "button";
      iosBtn.style.cssText = "position:fixed; bottom:calc(100px + env(safe-area-inset-bottom,0px)); left:50%; transform:translateX(-50%); z-index:45; padding:12px 20px; border-radius:9999px; background:linear-gradient(135deg,#c8384f,#dd576a); color:white; font-weight:700; font-size:14px; box-shadow:0 12px 30px -8px rgba(200,56,79,.5); display:flex; align-items:center; gap:8px;";
      iosBtn.innerHTML = "<span>📲 Instalar en iPhone</span>";
      document.body.appendChild(iosBtn);
      iosBtn.addEventListener("click", function () {
        showToast("Toca Compartir ⎋ y luego 'Añadir a pantalla de inicio'", "info");
        setTimeout(function () { iosBtn.remove(); localStorage.setItem("installDismissed", "1"); }, 6000);
      });
    }

    // Service Worker real (archivo externo)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").catch(function (e) {
          console.warn("SW no registrado:", e);
        });
      });
    }
  })();

  // ============================================================
  // ARRANQUE
  // ============================================================
  setActiveTab("agenda");
  updateHeaderTitle("agenda");
  setTrackIndex(0, false);
  actualizarBotonInvertirAgenda();
  actualizarBotonInvertirTodas();
  renderAgenda();
  poblarSelectClientes();
  if (window.lucide) lucide.createIcons();

  // Exponer handlers globales por si algo se rompe (debug)
  window.__agenda = { state: function () { return state; }, prefs: function () { return prefs; } };
})();