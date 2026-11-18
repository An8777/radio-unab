/**
 * locutor.js — Lógica del panel del locutor (cabina de control)
 * Maneja: Socket.io como locutor, YouTube embed, chat en tiempo real,
 *         gestión de peticiones, actualización de info de canción.
 */

// ─── Conexión al servidor identificándose como locutor ───────────────────────
const socket = io({ query: { rol: "locutor" } });

// ─── Referencias DOM ─────────────────────────────────────────────────────────
// Header
const toggleEnVivo   = document.getElementById("toggle-envivo");
const enVivoLabel    = document.getElementById("envivo-label");
const oyentesCount   = document.getElementById("oyentes-count");

// Reproductor
const fuenteTabs     = document.querySelectorAll(".src-tab");
const panelYoutube   = document.getElementById("panel-youtube");
const panelStream    = document.getElementById("panel-stream");
const inputYoutube   = document.getElementById("input-youtube");
const btnCargarYt    = document.getElementById("btn-cargar-yt");
const ytIframe       = document.getElementById("yt-iframe");
const ytPlaceholder  = document.getElementById("yt-placeholder");
const inputStream    = document.getElementById("input-stream");
const btnAplicarStr  = document.getElementById("btn-aplicar-stream");

// Información de canción
const inpPrograma    = document.getElementById("inp-programa");
const inpCancion     = document.getElementById("inp-cancion");
const inpArtista     = document.getElementById("inp-artista");
const inpCaratula    = document.getElementById("inp-caratula");
const btnActualizar  = document.getElementById("btn-actualizar-cancion");

// Accesos rápidos
const accPausa       = document.getElementById("acc-pausa");
const accLimpiar     = document.getElementById("acc-limpiar-chat");
const accSilenciar   = document.getElementById("acc-silenciar");
const accAvisar      = document.getElementById("acc-avisar");

// Panel de peticiones
const peticionesContainer = document.getElementById("peticiones-container");
const filtrosBtns    = document.querySelectorAll(".filter-btn");
const formLocutor    = document.getElementById("form-locutor");
const inputLocutor   = document.getElementById("input-locutor");

// Toast
const toast          = document.getElementById("toast");

// ─── Estado local del locutor ────────────────────────────────────────────────
let filtroActual = "todos";        // filtro activo de peticiones
let mensajesMap  = new Map();      // id -> { elemento DOM, completado }
let ytMuteado    = false;
let ytPausado    = false;

// ─── Utilidades ──────────────────────────────────────────────────────────────

function formatearHora(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function iniciales(apodo) {
  const partes = apodo.split("_");
  return (partes[0]?.[0] || "?") + (partes[1]?.[0] || "");
}

function escaparHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scrollAlFinal() {
  peticionesContainer.scrollTop = peticionesContainer.scrollHeight;
}

/**
 * Muestra un toast temporal en la esquina inferior derecha
 */
function mostrarToast(texto, duracion = 3000) {
  toast.textContent = texto;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), duracion);
}

/**
 * Extrae el ID de un video de YouTube desde cualquier formato de URL:
 * - https://www.youtube.com/watch?v=ID
 * - https://youtu.be/ID
 * - https://youtu.be/ID?si=TRACKING
 * - https://youtube.com/shorts/ID
 * - https://m.youtube.com/watch?v=ID
 */
function extraerYoutubeId(url) {
  try {
    const u = new URL(url.trim());
    // Formato corto: youtu.be/ID
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1).split("?")[0].split("/")[0];
    }
    // Formato /shorts/ID
    if (u.pathname.includes("/shorts/")) {
      return u.pathname.split("/shorts/")[1].split("?")[0];
    }
    // Formato estándar: ?v=ID
    return u.searchParams.get("v") || null;
  } catch {
    // Si no es URL válida, intenta extraer con regex como último recurso
    const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
}

// ─── Toggle EN VIVO ──────────────────────────────────────────────────────────
toggleEnVivo.addEventListener("change", () => {
  const enVivo = toggleEnVivo.checked;
  enVivoLabel.textContent = enVivo ? "EN VIVO" : "OFFLINE";
  enVivoLabel.style.color  = enVivo ? "var(--accent-2)" : "var(--text-muted)";
  socket.emit("toggleEnVivo", { enVivo });
  mostrarToast(enVivo ? "✅ Radio marcada como EN VIVO" : "🔴 Radio marcada como OFFLINE");
});

// ─── Tabs de fuente (YouTube / Stream) ───────────────────────────────────────
fuenteTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    fuenteTabs.forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");

    const fuente = tab.dataset.fuente;
    panelYoutube.classList.toggle("hidden", fuente !== "youtube");
    panelStream.classList.toggle("hidden", fuente !== "stream");
  });
});

// Verificación de que los elementos críticos existen
console.log("[INIT] btnCargarYt:", btnCargarYt);
console.log("[INIT] ytIframe:", ytIframe);
console.log("[INIT] inputYoutube:", inputYoutube);

// ─── Cargar video de YouTube ─────────────────────────────────────────────────
btnCargarYt.addEventListener("click", () => {
  const url = inputYoutube.value.trim();
  console.log("[YT] URL ingresada:", url);

  if (!url) return mostrarToast("⚠️ Escribe una URL de YouTube primero");

  const id = extraerYoutubeId(url);
  console.log("[YT] ID extraído:", id);

  if (!id) return mostrarToast("❌ URL no válida. Copia el link completo desde YouTube.");

  const embedUrl = `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1&rel=0`;
  console.log("[YT] Embed URL:", embedUrl);

  ytIframe.src = embedUrl;
  ytIframe.style.display = "block";
  ytPlaceholder.style.display = "none";
  ytPausado = false;
  ytMuteado = false;

  const urlLimpia = `https://www.youtube.com/watch?v=${id}`;
  socket.emit("actualizarCancion", {
    youtubeUrl: urlLimpia,
    programa: inpPrograma.value || undefined,
    cancion:  inpCancion.value  || undefined,
    artista:  inpArtista.value  || undefined,
    caratula: inpCaratula.value || undefined
  });

  mostrarToast(`▶️ Cargando video: ${id}`);
});

// ─── Aplicar URL de stream de audio ──────────────────────────────────────────
btnAplicarStr.addEventListener("click", () => {
  const url = inputStream.value.trim();
  if (!url) return mostrarToast("⚠️ Escribe la URL del stream primero");

  socket.emit("actualizarCancion", { streamUrl: url });
  mostrarToast("📡 URL de stream enviada a oyentes");
});

// ─── Actualizar información de canción ───────────────────────────────────────
btnActualizar.addEventListener("click", () => {
  const payload = {
    programa:  inpPrograma.value.trim() || undefined,
    cancion:   inpCancion.value.trim()  || undefined,
    artista:   inpArtista.value.trim()  || undefined,
    caratula:  inpCaratula.value.trim() || undefined,
  };

  if (!payload.cancion && !payload.programa) {
    return mostrarToast("⚠️ Escribe al menos el nombre del programa o la canción");
  }

  socket.emit("actualizarCancion", payload);
  mostrarToast("✅ Información enviada a todos los oyentes");
});

// ─── Accesos rápidos ─────────────────────────────────────────────────────────

// Pausa / reanuda el iframe de YouTube via postMessage
accPausa.addEventListener("click", () => {
  if (!ytIframe.src) return mostrarToast("⚠️ No hay video cargado");
  const msg = ytPausado
    ? '{"event":"command","func":"playVideo","args":""}'
    : '{"event":"command","func":"pauseVideo","args":""}';
  ytIframe.contentWindow.postMessage(msg, "*");
  ytPausado = !ytPausado;
  accPausa.textContent = ytPausado ? "▶️ Reanudar YouTube" : "⏸️ Pausar YouTube";
  mostrarToast(ytPausado ? "⏸️ Video pausado" : "▶️ Video reanudado");
});

// Silenciar/desilenciar YouTube via postMessage
accSilenciar.addEventListener("click", () => {
  if (!ytIframe.src) return mostrarToast("⚠️ No hay video cargado");
  const msg = ytMuteado
    ? '{"event":"command","func":"unMute","args":""}'
    : '{"event":"command","func":"mute","args":""}';
  ytIframe.contentWindow.postMessage(msg, "*");
  ytMuteado = !ytMuteado;
  accSilenciar.textContent = ytMuteado ? "🔊 Desilenciar" : "🔇 Silenciar";
  mostrarToast(ytMuteado ? "🔇 Silenciado" : "🔊 Audio activo");
});

// Limpiar solo los mensajes marcados como completados de la vista local
accLimpiar.addEventListener("click", () => {
  const completados = peticionesContainer.querySelectorAll(".peticion-card.completado");
  completados.forEach((el) => el.remove());
  mostrarToast(`🗑️ ${completados.length} peticiones leídas eliminadas`);
});

// Enviar aviso de corte comercial por chat
accAvisar.addEventListener("click", () => {
  accAvisar.disabled = true;
  socket.emit("enviarMensaje", { texto: "📢 ¡En unos momentos regresamos! Corte comercial." });
  mostrarToast("📢 Aviso de corte enviado");
  setTimeout(() => { accAvisar.disabled = false; }, 5000);
});

// ─── Chat del locutor ────────────────────────────────────────────────────────
formLocutor.addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = inputLocutor.value.trim();
  if (!texto) return;
  socket.emit("enviarMensaje", { texto });
  inputLocutor.value = "";
  inputLocutor.focus();
});

// ─── Renderizado de peticiones/mensajes ─────────────────────────────────────

/**
 * Renderiza un mensaje en el panel de peticiones del locutor.
 * Los mensajes de oyentes tienen botones de "Marcar" y "Completado".
 */
function renderizarPeticion(msg, esHistorial = false) {
  // Mensajes de sistema: barra simple centrada
  if (msg.tipo === "sistema") {
    const div = document.createElement("div");
    div.className = "pet-sistema-msg";
    div.textContent = msg.texto;
    peticionesContainer.appendChild(div);
    if (!esHistorial) scrollAlFinal();
    return;
  }

  const esLoc = msg.tipo === "locutor";

  // Contenedor principal
  const card = document.createElement("div");
  card.className = `peticion-card tipo-${msg.tipo}`;
  card.dataset.id = msg.id || "";

  // Avatar
  const avatar = document.createElement("div");
  avatar.className = `pet-avatar${esLoc ? " av-locutor" : ""}`;
  avatar.textContent = iniciales(msg.apodo);

  // Cuerpo
  const body = document.createElement("div");
  body.className = "pet-body";

  const meta = document.createElement("div");
  meta.className = "pet-meta";

  const apodoEl = document.createElement("span");
  apodoEl.className = `pet-apodo${esLoc ? " ap-locutor" : ""}`;
  apodoEl.textContent = esLoc ? `🎙️ ${msg.apodo}` : msg.apodo;

  const horaEl = document.createElement("span");
  horaEl.className = "pet-hora";
  horaEl.textContent = formatearHora(msg.timestamp);

  meta.appendChild(apodoEl);
  meta.appendChild(horaEl);

  const textoEl = document.createElement("p");
  textoEl.className = "pet-texto";
  textoEl.textContent = msg.texto;

  body.appendChild(meta);
  body.appendChild(textoEl);

  card.appendChild(avatar);
  card.appendChild(body);

  // Solo los mensajes de oyentes tienen botones de gestión
  if (!esLoc) {
    const actions = document.createElement("div");
    actions.className = "pet-actions";

    const btnComp = document.createElement("button");
    btnComp.className = "btn-marcar";
    btnComp.textContent = "✅ Listo";
    btnComp.title = "Marcar como completado";
    btnComp.addEventListener("click", () => marcarCompletado(card, msg.id, btnComp));

    actions.appendChild(btnComp);
    card.appendChild(actions);
  }

  // Guarda referencia para actualizarla si llega señal del servidor
  if (msg.id) mensajesMap.set(msg.id, { card, completado: false });

  peticionesContainer.appendChild(card);

  // Aplica el filtro actual
  aplicarFiltroACard(card);

  if (!esHistorial) scrollAlFinal();
}

function marcarCompletado(card, id, btn) {
  card.classList.add("completado");
  btn.textContent = "✔ Completado";
  btn.classList.add("completado-btn");
  btn.disabled = true;

  if (id) {
    socket.emit("marcarCompletado", { id });
    mensajesMap.get(id) && (mensajesMap.get(id).completado = true);
  }
}


filtrosBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filtrosBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filtroActual = btn.dataset.filtro;
    aplicarFiltroGlobal();
  });
});

function aplicarFiltroACard(card) {
  const esComp = card.classList.contains("completado");
  const esSistema = card.classList.contains("pet-sistema-msg");

  if (esSistema) { card.style.display = ""; return; }

  if (filtroActual === "todos")       card.style.display = "";
  else if (filtroActual === "pendientes")   card.style.display = esComp ? "none" : "";
  else if (filtroActual === "completados")  card.style.display = esComp ? "" : "none";
}

function aplicarFiltroGlobal() {
  peticionesContainer.querySelectorAll(".peticion-card, .pet-sistema-msg")
    .forEach(aplicarFiltroACard);
}



socket.on("bienvenida", (data) => {
  oyentesCount.textContent = data.oyentesCount;
  // Sincroniza toggle con estado real
  toggleEnVivo.checked = data.estadoRadio?.enVivo ?? true;
});

socket.on("historialChat", (historial) => {
  historial.forEach((msg) => renderizarPeticion(msg, true));
  scrollAlFinal();
});

socket.on("mensajeSistema", (msg) => {
  renderizarPeticion(msg);
});


socket.on("peticionCompletada", (data) => {
  const ref = mensajesMap.get(data.id);
  if (ref && !ref.completado) {
    ref.card.classList.add("completado");
    ref.completado = true;
    const btn = ref.card.querySelector(".btn-marcar");
    if (btn) {
      btn.textContent = "✔ Completado";
      btn.classList.add("completado-btn");
      btn.disabled = true;
    }
    aplicarFiltroACard(ref.card);
  }
});

// ─── VOZ EN VIVO (MediaRecorder + Socket.io) ────────────────────────────────
const btnVoz    = document.getElementById("btn-voz");
const btnVozTxt = document.getElementById("btn-voz-txt");

let vozActiva   = false;
let streamMic   = null;
let mediaRec    = null;

async function iniciarVoz() {
  try {
    streamMic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    mostrarToast("❌ No se pudo acceder al micrófono: " + err.message);
    return;
  }

  // Detecta el formato soportado
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
      ? "audio/ogg;codecs=opus"
      : "audio/webm";

  mediaRec = new MediaRecorder(streamMic, { mimeType, audioBitsPerSecond: 32000 });

  // Cada 250ms envía un chunk al servidor
  mediaRec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      e.data.arrayBuffer().then(buf => socket.emit("voz-chunk", buf));
    }
  };

  mediaRec.start(250);
  vozActiva = true;
  btnVoz.classList.add("al-aire");
  btnVozTxt.textContent = "⏹ Dejar el Aire";

  // Pausa YouTube
  if (ytIframe && ytIframe.src) {
    ytIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
    ytPausado = true;
    accPausa.textContent = "▶️ Reanudar YouTube";
  }

  socket.emit("voz-inicio", { mimeType });
  mostrarToast("🎙️ Estás al aire");
}

function detenerVoz() {
  if (mediaRec && mediaRec.state !== "inactive") mediaRec.stop();
  if (streamMic) { streamMic.getTracks().forEach(t => t.stop()); streamMic = null; }

  vozActiva = false;
  btnVoz.classList.remove("al-aire");
  btnVozTxt.textContent = "🎙️ Ir al Aire";

  // Reanuda YouTube
  if (ytIframe && ytIframe.src) {
    ytIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', "*");
    ytPausado = false;
    accPausa.textContent = "⏸️ Pausar YouTube";
  }

  socket.emit("voz-fin");
  mostrarToast("🎵 Volviendo a la música");
}

btnVoz.addEventListener("click", () => {
  if (!vozActiva) iniciarVoz();
  else detenerVoz();
});

// ═══════════════════════════════════════════════════════════
// ── TEMPORIZADOR DE SEGMENTOS ───────────────────────────────
// ═══════════════════════════════════════════════════════════
const timerDisplay  = document.getElementById("timer-display");
const timerWidget   = document.getElementById("timer-widget");
const timerToggle   = document.getElementById("timer-toggle");
const timerReset    = document.getElementById("timer-reset");
const timerMarkBtn  = document.getElementById("timer-mark");
const timerMarksEl  = document.getElementById("timer-marks");

let timerSeconds  = 0;
let timerRunning  = false;
let timerInterval = null;
let timerMarks    = [];

function timerFormat(s) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sc = (s % 60).toString().padStart(2, "0");
  return `${m}:${sc}`;
}

function timerTick() {
  timerSeconds++;
  timerDisplay.textContent = timerFormat(timerSeconds);
}

// Toggle icono play/pausa
function timerUpdateIcon() {
  timerToggle.innerHTML = timerRunning
    ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}

timerToggle.addEventListener("click", () => {
  if (timerRunning) {
    clearInterval(timerInterval);
    timerRunning = false;
    timerWidget.classList.remove("running");
  } else {
    timerInterval = setInterval(timerTick, 1000);
    timerRunning = true;
    timerWidget.classList.add("running");
  }
  timerUpdateIcon();
});

timerReset.addEventListener("click", () => {
  clearInterval(timerInterval);
  timerRunning = false;
  timerSeconds = 0;
  timerDisplay.textContent = "00:00";
  timerWidget.classList.remove("running");
  timerMarks = [];
  timerMarksEl.innerHTML = "";
  timerMarksEl.classList.remove("has-marks");
  timerUpdateIcon();
});

timerMarkBtn.addEventListener("click", () => {
  const label = timerFormat(timerSeconds);
  timerMarks.push(label);

  const item = document.createElement("div");
  item.className = "timer-mark-item";
  item.textContent = label;
  timerMarksEl.appendChild(item);
  timerMarksEl.classList.add("has-marks");

  mostrarToast(`⚑ Tiempo marcado: ${label}`);
});

// ═══════════════════════════════════════════════════════════
// ── COLA DE CANCIONES ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════
const inputQueue    = document.getElementById("input-queue");
const btnQueueAdd   = document.getElementById("btn-queue-add");
const queueListEl   = document.getElementById("queue-list");
const queueEmptyEl  = document.getElementById("queue-empty");
const queueBadge    = document.getElementById("queue-badge");
const btnQueueNext  = document.getElementById("btn-queue-next");
const btnQueueClear = document.getElementById("btn-queue-clear");

// Cada entrada: { id, url, videoId, title }
let songQueue    = [];
let queuePlaying = false;   // true mientras hay autoplay en curso

function queueExtractId(url) {
  return extraerYoutubeId(url);  // reutiliza la función existente
}

function queueShortTitle(url, videoId) {
  // Muestra el ID cuando no hay título disponible
  return videoId || url;
}

function queueRender() {
  // Limpiar lista (excepto el placeholder)
  queueListEl.querySelectorAll(".queue-item").forEach(el => el.remove());

  if (songQueue.length === 0) {
    queueEmptyEl.style.display = "";
    queueBadge.textContent = "0";
    return;
  }

  queueEmptyEl.style.display = "none";
  queueBadge.textContent = String(songQueue.length);

  songQueue.forEach((entry, idx) => {
    const item = document.createElement("div");
    item.className = "queue-item" + (idx === 0 ? " playing" : "");
    item.dataset.qid = entry.id;

    const num = document.createElement("span");
    num.className = "queue-num";
    num.textContent = idx === 0 ? "▶" : idx + 1;

    const title = document.createElement("span");
    title.className = "queue-title";
    title.title = entry.url;
    title.textContent = entry.videoId || entry.url;

    const btns = document.createElement("div");
    btns.className = "queue-item-btns";

    // Subir
    if (idx > 0) {
      const up = document.createElement("button");
      up.className = "queue-item-btn";
      up.title = "Subir";
      up.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>`;
      up.addEventListener("click", () => queueMove(idx, -1));
      btns.appendChild(up);
    }

    // Bajar
    if (idx < songQueue.length - 1) {
      const dn = document.createElement("button");
      dn.className = "queue-item-btn";
      dn.title = "Bajar";
      dn.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>`;
      dn.addEventListener("click", () => queueMove(idx, 1));
      btns.appendChild(dn);
    }

    // Eliminar
    const del = document.createElement("button");
    del.className = "queue-item-btn del";
    del.title = "Eliminar";
    del.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    del.addEventListener("click", () => queueRemove(idx));
    btns.appendChild(del);

    item.appendChild(num);
    item.appendChild(title);
    item.appendChild(btns);
    queueListEl.appendChild(item);
  });
}

function queueMove(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= songQueue.length) return;
  [songQueue[idx], songQueue[newIdx]] = [songQueue[newIdx], songQueue[idx]];
  queueRender();
}

function queueRemove(idx) {
  songQueue.splice(idx, 1);
  queueRender();
  mostrarToast("🗑️ Canción eliminada de la cola");
}

function queuePlayNext() {
  if (songQueue.length === 0) {
    queuePlaying = false;
    mostrarToast("🎵 Cola terminada");
    return;
  }

  const entry = songQueue[0];
  const embedUrl = `https://www.youtube.com/embed/${entry.videoId}?autoplay=1&enablejsapi=1&rel=0`;

  ytIframe.src = embedUrl;
  ytIframe.style.display = "block";
  ytPlaceholder.style.display = "none";
  ytPausado = false;
  ytMuteado = false;

  socket.emit("actualizarCancion", {
    youtubeUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
    programa: inpPrograma.value || undefined,
    cancion:  inpCancion.value  || undefined,
    artista:  inpArtista.value  || undefined,
    caratula: inpCaratula.value || undefined
  });

  mostrarToast(`▶️ Reproduciendo: ${entry.videoId}`);
  queuePlaying = true;

  // Elimina de la cola y re-renderiza
  songQueue.shift();
  queueRender();
}

btnQueueAdd.addEventListener("click", () => {
  const url = inputQueue.value.trim();
  if (!url) return mostrarToast("⚠️ Escribe una URL de YouTube primero");
  const videoId = queueExtractId(url);
  if (!videoId) return mostrarToast("❌ URL no válida");

  songQueue.push({ id: `q-${Date.now()}`, url, videoId });
  inputQueue.value = "";
  queueRender();
  mostrarToast(`✅ Añadido a la cola: ${videoId}`);
});

// Permitir Enter en el input de cola
inputQueue.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnQueueAdd.click();
});

btnQueueNext.addEventListener("click", () => {
  if (songQueue.length === 0) return mostrarToast("⚠️ La cola está vacía");
  queuePlayNext();
});

btnQueueClear.addEventListener("click", () => {
  songQueue = [];
  queueRender();
  mostrarToast("🗑️ Cola vaciada");
});

// Auto-avance: cuando el iframe carga un nuevo video y la cola tiene canciones,
// escucha el evento de fin del video mediante postMessage de YouTube
window.addEventListener("message", (e) => {
  if (!e.data || typeof e.data !== "string") return;
  try {
    const d = JSON.parse(e.data);
    // YouTube playerState 0 = video ended
    if (d.event === "onStateChange" && d.info === 0 && songQueue.length > 0) {
      queuePlayNext();
    }
  } catch {}
});

// ═══════════════════════════════════════════════════════════
// ── NOTAS RÁPIDAS ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
const cardNotas     = document.getElementById("card-notas");
const notasTrigger  = document.getElementById("notas-trigger");
const notasBody     = document.getElementById("notas-body");
const notasTextarea = document.getElementById("notas-textarea");
const notasHint     = document.getElementById("notas-hint");
const btnNotasLimp  = document.getElementById("btn-notas-limpiar");

const NOTAS_KEY = "radio-unab-notas";
let notasSaveTimer = null;

// Cargar notas guardadas
notasTextarea.value = localStorage.getItem(NOTAS_KEY) || "";

// Toggle colapsar/expandir
notasTrigger.addEventListener("click", () => {
  cardNotas.classList.toggle("open");
});

// Auto-guardado con debounce
notasTextarea.addEventListener("input", () => {
  notasHint.textContent = "Guardando…";
  notasHint.className = "notas-hint guardando";

  clearTimeout(notasSaveTimer);
  notasSaveTimer = setTimeout(() => {
    localStorage.setItem(NOTAS_KEY, notasTextarea.value);
    notasHint.textContent = "Guardado ✓";
    notasHint.className = "notas-hint guardado";
  }, 600);
});

btnNotasLimp.addEventListener("click", () => {
  notasTextarea.value = "";
  localStorage.removeItem(NOTAS_KEY);
  notasHint.textContent = "Limpiado";
  notasHint.className = "notas-hint";
  mostrarToast("🗒️ Notas borradas");
});

// ═══════════════════════════════════════════════════════════
// ── ESTADÍSTICAS ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
const statOyentes  = document.getElementById("stat-oyentes");
const statPico     = document.getElementById("stat-pico");
const statMensajes = document.getElementById("stat-mensajes");
const statUptime   = document.getElementById("stat-uptime");

// Estado local de stats (el servidor puede sobreescribir con el evento "estadisticas")
let statsLocal = {
  oyentes:  0,
  pico:     0,
  mensajes: 0,
  inicio:   Date.now()
};

// Uptime calculado localmente (desde que el locutor abre la cabina)
setInterval(() => {
  const elapsed = Math.floor((Date.now() - statsLocal.inicio) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  statUptime.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}, 1000);

// Sincroniza oyentes con el contador del header
function statsUpdateOyentes(count) {
  statsLocal.oyentes = count;
  if (count > statsLocal.pico) statsLocal.pico = count;
  statOyentes.textContent = count;
  statPico.textContent    = statsLocal.pico;
}

// Conta mensajes recibidos
socket.on("nuevoMensaje", (msg) => {
  renderizarPeticion(msg);
  if (msg.tipo === "oyente") {
    statsLocal.mensajes++;
    statMensajes.textContent = statsLocal.mensajes;
  }
});

socket.on("actualizarOyentes", (data) => {
  oyentesCount.textContent = data.count;
  statsUpdateOyentes(data.count);
});

// Evento enviado por el servidor con datos persistentes (opcional)
socket.on("estadisticas", (data) => {
  if (data.picOyentes   != null) { statsLocal.pico     = data.picOyentes;   statPico.textContent     = data.picOyentes; }
  if (data.totalMensajes != null) { statsLocal.mensajes = data.totalMensajes; statMensajes.textContent = data.totalMensajes; }
  if (data.tiempoAlAire  != null) { statUptime.textContent = data.tiempoAlAire; }
});
