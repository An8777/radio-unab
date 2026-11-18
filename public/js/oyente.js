/**
 * oyente.js — RADIO UNAB
 * Reproductor via YouTube IFrame API + chat en tiempo real
 */

const socket = io({ query: { rol: "oyente" } });

// ── DOM ──────────────────────────────────────────────────────────
const imgCaratula    = document.getElementById("img-caratula");
const diskWrap       = document.getElementById("disk-wrap");
const diskGlow       = document.getElementById("disk-glow");
const eqBars         = document.getElementById("eq-bars");
const livePill       = document.getElementById("live-pill");
const programaNombre = document.getElementById("programa-nombre");
const cancionNombre  = document.getElementById("cancion-nombre");
const artistaNombre  = document.getElementById("artista-nombre");
const oyentesCount   = document.getElementById("oyentes-count");
const miApodoEl      = document.getElementById("mi-apodo");
const msgsContainer  = document.getElementById("mensajes-container");
const chatForm       = document.getElementById("chat-form");
const inputMensaje   = document.getElementById("input-mensaje");

const btnPlay        = document.getElementById("btn-play");
const iconPlay       = document.getElementById("icon-play");
const iconPause      = document.getElementById("icon-pause");
const btnMute        = document.getElementById("btn-mute");
const iconVolOn      = document.getElementById("icon-vol-on");
const iconVolOff     = document.getElementById("icon-vol-off");
const sliderVolumen  = document.getElementById("slider-volumen");
const volPct         = document.getElementById("vol-pct");
const estadoTxt      = document.getElementById("estado-txt");

// ── Estado ───────────────────────────────────────────────────────
let miApodoLocal = "";
let ytPlayer     = null;
let ytIdActivo   = null;
let reproduciendo= false;
let muteado      = false;
let volActual    = 100;
let ytAPILista   = false;
let pendienteId  = null;

// ── YouTube IFrame API ───────────────────────────────────────────
const ytTag = document.createElement("script");
ytTag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytTag);

window.onYouTubeIframeAPIReady = function () {
  ytAPILista = true;
  if (pendienteId) { iniciarPlayer(pendienteId); pendienteId = null; }
};

function iniciarPlayer(videoId) {
  if (ytPlayer) {
    ytPlayer.loadVideoById(videoId);
    ytIdActivo = videoId;
  } else {
    ytPlayer = new YT.Player("yt-player-container", {
      width: "1", height: "1",
      videoId,
      playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
      events: {
        onReady: (e) => {
          e.target.setVolume(volActual);
          if (muteado) e.target.mute();
          ytIdActivo = videoId;
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING)       setEstado(true);
          else if (e.data === YT.PlayerState.PAUSED ||
                   e.data === YT.PlayerState.ENDED)    setEstado(false);
          else if (e.data === YT.PlayerState.BUFFERING) setEstadoTxt("Cargando...");
        },
        onError: () => setEstadoTxt("Error al cargar el video")
      }
    });
  }
}

function cargarVideo(url) {
  const id = ytId(url);
  if (!id) return;
  if (!ytAPILista) { pendienteId = id; setEstadoTxt("Preparando..."); return; }
  if (id === ytIdActivo && ytPlayer) {
    // mismo video — solo asegura que esté reproduciéndose
    try { ytPlayer.playVideo(); } catch(e) {}
    return;
  }
  iniciarPlayer(id);
}

// ── Controles ────────────────────────────────────────────────────
btnPlay.addEventListener("click", () => {
  if (!ytPlayer) { setEstadoTxt("Esperando que el locutor ponga una canción..."); return; }
  reproduciendo ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
});

sliderVolumen.addEventListener("input", () => {
  volActual = parseInt(sliderVolumen.value);
  volPct.textContent = volActual + "%";
  actualizarSlider();
  if (ytPlayer) ytPlayer.setVolume(volActual);
  if (muteado && volActual > 0) {
    muteado = false;
    if (ytPlayer) ytPlayer.unMute();
    iconVolOn.style.display = "block";
    iconVolOff.style.display = "none";
  }
});

btnMute.addEventListener("click", () => {
  muteado = !muteado;
  if (ytPlayer) muteado ? ytPlayer.mute() : ytPlayer.unMute();
  iconVolOn.style.display  = muteado ? "none" : "block";
  iconVolOff.style.display = muteado ? "block" : "none";
});

function actualizarSlider() {
  sliderVolumen.style.background =
    `linear-gradient(to right, var(--acc) ${volActual}%, var(--input) ${volActual}%)`;
}
actualizarSlider();

// ── Visual ───────────────────────────────────────────────────────
function setEstado(playing) {
  reproduciendo = playing;
  iconPlay.style.display  = playing ? "none" : "block";
  iconPause.style.display = playing ? "block" : "none";
  btnPlay.classList.toggle("playing", playing);
  diskWrap.classList.toggle("spinning", playing);
  diskGlow.classList.toggle("active", playing);
  eqBars.classList.toggle("active", playing);
  imgCaratula.classList.toggle("playing", playing);
  setEstadoTxt(playing ? "Reproduciendo en vivo" : "Pausado");
}

function setEstadoTxt(t) { estadoTxt.textContent = t; }

// ── Utilidades ───────────────────────────────────────────────────
function ytId(url) {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("?")[0].split("/")[0];
    if (u.pathname.includes("/shorts/")) return u.pathname.split("/shorts/")[1].split("?")[0];
    return u.searchParams.get("v") || null;
  } catch {
    const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function inits(apodo) {
  const p = apodo.split("_");
  return (p[0]?.[0] || "?") + (p[1]?.[0] || "");
}

function scrollFin() { msgsContainer.scrollTop = msgsContainer.scrollHeight; }

// ── Chat ─────────────────────────────────────────────────────────
function renderMsg(msg, hist = false) {
  if (msg.tipo === "sistema") {
    const d = document.createElement("div");
    d.className = "msg-sys"; d.textContent = msg.texto;
    msgsContainer.appendChild(d);
    if (!hist) scrollFin(); return;
  }
  const soyYo = msg.apodo === miApodoLocal;
  const esLoc  = msg.tipo === "locutor";

  const wrap = document.createElement("div"); wrap.className = "msg";
  const av   = document.createElement("div");
  av.className = `msg-av ${esLoc ? "av-loc" : "av-user"}`;
  av.textContent = inits(msg.apodo);

  const body = document.createElement("div"); body.className = "msg-body";
  const meta = document.createElement("div"); meta.className = "msg-meta";

  const name = document.createElement("span");
  name.className = "msg-name" + (esLoc ? " is-loc" : "") + (soyYo ? " is-me" : "");
  name.textContent = esLoc ? `🎙️ ${msg.apodo}` : soyYo ? `${msg.apodo} (tú)` : msg.apodo;

  const time = document.createElement("span");
  time.className = "msg-time"; time.textContent = hora(msg.timestamp);

  const txt = document.createElement("p");
  txt.className = "msg-text"; txt.textContent = msg.texto;

  meta.appendChild(name); meta.appendChild(time);
  body.appendChild(meta); body.appendChild(txt);
  wrap.appendChild(av); wrap.appendChild(body);
  msgsContainer.appendChild(wrap);
  if (!hist) scrollFin();
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = inputMensaje.value.trim();
  if (!texto || !miApodoLocal) return;
  socket.emit("enviarMensaje", { texto });
  inputMensaje.value = "";
  inputMensaje.focus();
});

// ── Socket ───────────────────────────────────────────────────────
socket.on("bienvenida", (d) => {
  miApodoLocal = d.apodo;
  miApodoEl.textContent = d.apodo;
  aplicar(d.estadoRadio);
  oyentesCount.textContent = d.oyentesCount;
});

socket.on("historialChat",     (h) => { h.forEach(m => renderMsg(m, true)); scrollFin(); });
socket.on("nuevoMensaje",      renderMsg);
socket.on("mensajeSistema",    renderMsg);
socket.on("actualizarOyentes", (d) => { oyentesCount.textContent = d.count; });
socket.on("estadoEnVivo",      (d) => { livePill.classList.toggle("offline", !d.enVivo); });

function aplicar(e) {
  if (!e) return;
  if (e.cancionActual)  cancionNombre.textContent  = e.cancionActual;
  if (e.artista)        artistaNombre.textContent  = e.artista;
  if (e.programaActual) programaNombre.textContent = e.programaActual;
  if (e.caratula)       imgCaratula.src            = e.caratula;
  if (!e.enVivo)        livePill.classList.add("offline");
  if (e.youtubeUrl) {
    const id = ytId(e.youtubeUrl);
    if (id && id !== ytIdActivo) cargarVideo(e.youtubeUrl);
  }
}

// ─── VOZ EN VIVO (MediaSource + Socket.io) ──────────────────────────────────
let vozMimeType        = "audio/webm;codecs=opus";
let mediaSource        = null;
let sourceBuffer       = null;
let vozQueue           = [];
let vozIniciada        = false;
let vozAudio           = null;
let reproduciaAntesVoz = false; // estaba reproduciendo antes de que el locutor hablara

function crearMediaSource() {
  vozAudio = new Audio();
  vozAudio.autoplay = true;

  mediaSource = new MediaSource();
  vozAudio.src = URL.createObjectURL(mediaSource);

  mediaSource.addEventListener("sourceopen", () => {
    try {
      sourceBuffer = mediaSource.addSourceBuffer(vozMimeType);
      sourceBuffer.mode = "sequence";

      sourceBuffer.addEventListener("updateend", () => {
        if (vozQueue.length > 0 && !sourceBuffer.updating) {
          sourceBuffer.appendBuffer(vozQueue.shift());
        }
      });

      if (vozQueue.length > 0 && !sourceBuffer.updating) {
        sourceBuffer.appendBuffer(vozQueue.shift());
      }
    } catch (e) {
      console.warn("[Voz] MediaSource error:", e);
    }
  });
}

socket.on("voz-inicio", (data) => {
  setEstadoTxt("🎙️ El locutor está hablando...");
  vozMimeType = data?.mimeType || "audio/webm;codecs=opus";
  vozQueue = [];
  vozIniciada = true;
  reproduciaAntesVoz = reproduciendo; // guarda si estaba sonando
  crearMediaSource();
  if (ytPlayer && reproduciendo) ytPlayer.pauseVideo();
});

socket.on("voz-fin", () => {
  vozIniciada = false;
  vozQueue = [];
  if (mediaSource && mediaSource.readyState === "open") {
    try { mediaSource.endOfStream(); } catch(e) {}
  }
  sourceBuffer = null;
  mediaSource  = null;
  if (vozAudio) { vozAudio.pause(); vozAudio = null; }
  setEstadoTxt(reproduciaAntesVoz ? "Reproduciendo en vivo" : "Pausado");
  // Solo reanuda si el oyente estaba escuchando antes
  if (ytPlayer && reproduciaAntesVoz) ytPlayer.playVideo();
});

socket.on("voz-chunk", (chunk) => {
  if (!vozIniciada) return;
  try {
    const buf = chunk instanceof ArrayBuffer ? chunk : chunk.buffer;
    if (!sourceBuffer || mediaSource?.readyState !== "open") {
      vozQueue.push(buf);
      return;
    }
    if (sourceBuffer.updating) {
      vozQueue.push(buf);
    } else {
      sourceBuffer.appendBuffer(buf);
    }
  } catch (e) {
    console.warn("[Voz] chunk error:", e);
  }
});

// ─── HISTORIAL DE CANCIONES ─────────────────────────────────────
const MAX_HIST_CANCIONES = 5;
const historialCanciones = []; // { nombre, artista, hora }

const shList = document.getElementById("sh-list");

function agregarAlHistorial(estado) {
  const nombre = estado.cancionActual;
  if (!nombre || nombre === "En Vivo") return;
  // Evita duplicar la misma canción consecutiva
  if (historialCanciones.length && historialCanciones[0].nombre === nombre) return;

  const hora = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  historialCanciones.unshift({ nombre, artista: estado.artista || "", hora });
  if (historialCanciones.length > MAX_HIST_CANCIONES) historialCanciones.pop();
  renderHistorial();
}

function renderHistorial() {
  shList.innerHTML = "";
  if (!historialCanciones.length) {
    const li = document.createElement("li");
    li.className = "sh-empty";
    li.textContent = "Sin historial aún";
    shList.appendChild(li);
    return;
  }
  historialCanciones.forEach((item) => {
    const li   = document.createElement("li");
    li.className = "sh-item";

    const info = document.createElement("div");
    info.className = "sh-item-info";

    const name = document.createElement("div");
    name.className = "sh-item-name";
    name.textContent = item.nombre;

    const artist = document.createElement("div");
    artist.className = "sh-item-artist";
    artist.textContent = item.artista || "—";

    const time = document.createElement("span");
    time.className = "sh-item-time";
    time.textContent = item.hora;

    info.appendChild(name);
    info.appendChild(artist);
    li.appendChild(info);
    li.appendChild(time);
    shList.appendChild(li);
  });
}

// Hook al evento ya existente "cancionActualizada"
socket.on("cancionActualizada", (estado) => {
  agregarAlHistorial(estado);
  aplicar(estado);
});

// ─── BOTÓN COMPARTIR ────────────────────────────────────────────
const btnShare = document.getElementById("btn-share");

btnShare.addEventListener("click", async () => {
  const cancion = cancionNombre.textContent || "Radio UNAB";
  const texto   = `Estoy escuchando ${cancion} en Radio UNAB 🎵 radiounab-production.up.railway.app`;

  // Intenta Web Share API (móvil)
  if (navigator.share) {
    try {
      await navigator.share({ title: "Radio UNAB", text: texto, url: "https://radiounab-production.up.railway.app" });
      return;
    } catch (_) { /* usuario canceló */ }
  }

  // Fallback: copiar al portapapeles
  try {
    await navigator.clipboard.writeText(texto);
  } catch (_) {
    // Último fallback para navegadores sin clipboard API
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  // Feedback visual
  const originalHTML = btnShare.innerHTML;
  btnShare.classList.add("copied");
  btnShare.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>¡Copiado!</span>`;
  setTimeout(() => {
    btnShare.classList.remove("copied");
    btnShare.innerHTML = originalHTML;
  }, 2000);
});

// ─── REACCIONES EN VIVO ──────────────────────────────────────────
const emojiOverlay = document.getElementById("emoji-overlay");
const reactBtns    = document.querySelectorAll(".react-btn");

// Throttle por emoji: evita spam (máx 1 por emoji cada 800 ms)
const reactCooldowns = {};

reactBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const emoji = btn.dataset.emoji;
    const ahora = Date.now();
    if (reactCooldowns[emoji] && ahora - reactCooldowns[emoji] < 800) return;
    reactCooldowns[emoji] = ahora;

    socket.emit("reaccion", { emoji });

    // Animación del botón
    btn.classList.remove("burst");
    void btn.offsetWidth; // reflow para reiniciar la animación
    btn.classList.add("burst");
  });
});

function lanzarEmoji(emoji) {
  const el = document.createElement("span");
  el.className = "floating-emoji";
  el.textContent = emoji;

  // Posición horizontal aleatoria dentro del overlay
  const x = Math.random() * 60; // 0–60px desde la izquierda del overlay
  el.style.left = x + "px";

  // Duración ligeramente aleatoria para que no sean idénticos
  const dur = 2.2 + Math.random() * 0.6;
  el.style.setProperty("--dur", dur + "s");

  emojiOverlay.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

socket.on("reaccion", (data) => {
  if (data?.emoji) lanzarEmoji(data.emoji);
});
