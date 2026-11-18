const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const { pool, inicializarDB } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ─── Sesiones ────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || "radio-unab-secret-2024",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Middleware: verificar sesión de locutor ──────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.locutor) return next();
  res.redirect("/login");
}

// ─── Rutas de autenticación ───────────────────────────────────────────────────

// Página de login
app.get("/login", (req, res) => {
  if (req.session && req.session.locutor) return res.redirect("/locutor");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Registro
app.post("/auth/registro", async (req, res) => {
  const { usuario, nombre, password } = req.body;
  if (!usuario || !nombre || !password) return res.status(400).json({ error: "Completa todos los campos" });
  if (password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO locutores (usuario, nombre, password) VALUES (?, ?, ?)",
      [usuario.toLowerCase(), nombre, hash]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "Ese usuario ya existe" });
    console.error("[Auth] Registro error:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Login
app.post("/auth/login", async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: "Completa todos los campos" });
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM locutores WHERE usuario = ?",
      [usuario.toLowerCase()]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    const valido = await bcrypt.compare(password, rows[0].password);
    if (!valido) return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    req.session.locutor = { id: rows[0].id, usuario: rows[0].usuario, nombre: rows[0].nombre };
    res.json({ ok: true });
  } catch (err) {
    console.error("[Auth] Login error:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Ruta de setup — crea o resetea el admin (usar solo una vez)
app.get("/setup", async (req, res) => {
  try {
    const hash = await bcrypt.hash("radio2024", 10);
    await pool.execute(
      "INSERT INTO locutores (usuario, nombre, password) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = ?",
      ["admin", "Administrador", hash, hash]
    );
    res.send("OK usuario: admin | contrasena: radio2024");
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// Listar locutores (solo locutor autenticado)
app.get("/auth/locutores", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT id, usuario, nombre, creado_en FROM locutores ORDER BY creado_en DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// Eliminar locutor (solo locutor autenticado)
app.delete("/auth/locutores/:id", requireAuth, async (req, res) => {
  try {
    await pool.execute("DELETE FROM locutores WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// Página de gestión de locutores (protegida)
app.get("/locutor/usuarios", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "usuarios.html"));
});

const ADJETIVOS = [
  "Alegre", "Veloz", "Curioso", "Valiente", "Brillante",
  "Salvaje", "Tranquilo", "Audaz", "Sereno", "Feroz",
  "Amable", "Astuto", "Gentil", "Mágico", "Libre"
];

const ANIMALES = [
  "Lobo", "Gato", "Aguila", "Zorro", "Puma",
  "Delfin", "Tigre", "Cuervo", "Oso", "Jaguar",
  "Halcon", "Lince", "Nutria", "Panda", "Koala"
];


function generarApodo() {
  const adj = ADJETIVOS[Math.floor(Math.random() * ADJETIVOS.length)];
  const ani = ANIMALES[Math.floor(Math.random() * ANIMALES.length)];
  const num = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
  return `${adj}_${ani}_${num}`;
}

// ─── Estado global de la radio ──────────────────────────────────────────────
let estadoRadio = {
  enVivo: true,
  programaActual: "Programa de la Tarde",
  cancionActual: "En Vivo",
  artista: "",
  caratula: "/img/logo.jpg",
  streamUrl: "",  // URL del stream de audio (configurable por el locutor)
  youtubeUrl: ""  // URL de YouTube activa
};

// Registro de oyentes conectados: { socketId -> { apodo, esLocutor } }
const oyentesConectados = new Map();

// Historial de chat (últimos 50 mensajes para nuevos entrantes)
const historialChat = [];
const MAX_HISTORIAL = 50;

// ─── Archivos estáticos ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Ruta temporal para resetear admin (solo si no hay sesión activa)
app.get("/setup", async (req, res) => {
  try {
    const bcrypt = require("bcrypt");
    const hash = await bcrypt.hash("radio2024", 10);
    await pool.execute(
      "INSERT INTO locutores (usuario, nombre, password) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = ?",
      ["admin", "Administrador", hash, hash]
    );
    res.send("✅ Admin creado/actualizado. Usuario: admin | Contraseña: radio2024");
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Ruta del locutor — protegida por login
app.get("/locutor", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "locutor.html"));
});

// API: estado actual de la radio (para clientes que reconectan)
app.get("/api/estado", (req, res) => {
  res.json({
    ...estadoRadio,
    oyentesCount: oyentesConectados.size
  });
});

// ─── Lógica Socket.io ───────────────────────────────────────────────────────
io.on("connection", (socket) => {

  // Determina si es el locutor por query param: /locutor?locutor=true
  const esLocutor = socket.handshake.query.rol === "locutor";
  const apodo = esLocutor ? "Locutor" : generarApodo();

  // Guarda en el mapa de conexiones
  oyentesConectados.set(socket.id, { apodo, esLocutor });

  console.log(`[+] Conectado: ${apodo} (${esLocutor ? "LOCUTOR" : "oyente"}) — ID: ${socket.id}`);

  // 1. Envía al nuevo cliente su apodo y el estado actual de la radio
  socket.emit("bienvenida", {
    apodo,
    esLocutor,
    estadoRadio,
    oyentesCount: oyentesConectados.size
  });

  // 2. Envía el historial de chat al nuevo oyente
  socket.emit("historialChat", historialChat);

  // 3. Notifica a todos que alguien se unió (excepto el locutor para no saturar)
  if (!esLocutor) {
    const msgSistema = {
      tipo: "sistema",
      texto: `${apodo} se unió a la radio 🎵`,
      timestamp: new Date().toISOString()
    };
    io.emit("mensajeSistema", msgSistema);
  }

  // 4. Actualiza el contador de oyentes para todos
  io.emit("actualizarOyentes", { count: oyentesConectados.size });

  // 5. Si el locutor ya está al aire con el micrófono, avisa al nuevo oyente
  if (!esLocutor && estadoRadio.vozActiva) {
    socket.emit("voz-inicio");
    // Notifica al locutor que hay un nuevo oyente para que conecte WebRTC
    const locutorSocket = [...oyentesConectados.entries()]
      .find(([, v]) => v.esLocutor);
    if (locutorSocket) {
      io.to(locutorSocket[0]).emit("oyente-conectado-voz", { socketId: socket.id });
    }
  }

  // ── Evento: mensaje de chat enviado por un oyente o el locutor ──
  socket.on("enviarMensaje", (data) => {
    const usuario = oyentesConectados.get(socket.id);
    if (!usuario) return;

    const mensaje = {
      tipo: usuario.esLocutor ? "locutor" : "oyente",
      apodo: usuario.apodo,
      texto: String(data.texto).slice(0, 300), // límite de 300 caracteres
      timestamp: new Date().toISOString(),
      id: `${socket.id}-${Date.now()}`
    };

    // Guardar en historial (circular)
    historialChat.push(mensaje);
    if (historialChat.length > MAX_HISTORIAL) historialChat.shift();

    // Emitir a todos los clientes conectados
    io.emit("nuevoMensaje", mensaje);
    console.log(`[Chat] ${mensaje.apodo}: ${mensaje.texto}`);
  });

  // ── Evento: el locutor actualiza la canción actual ──
  socket.on("actualizarCancion", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;

    estadoRadio.cancionActual = data.cancion || estadoRadio.cancionActual;
    estadoRadio.artista = data.artista || estadoRadio.artista;
    estadoRadio.caratula = data.caratula || estadoRadio.caratula;
    estadoRadio.programaActual = data.programa || estadoRadio.programaActual;
    estadoRadio.youtubeUrl = data.youtubeUrl || estadoRadio.youtubeUrl;
    estadoRadio.streamUrl = data.streamUrl || estadoRadio.streamUrl;

    // Notificar a todos con la nueva info
    io.emit("cancionActualizada", estadoRadio);

    const msgSistema = {
      tipo: "sistema",
      texto: `🎵 Ahora suena: ${estadoRadio.cancionActual}${estadoRadio.artista ? " — " + estadoRadio.artista : ""}`,
      timestamp: new Date().toISOString()
    };
    io.emit("mensajeSistema", msgSistema);
    console.log(`[Cancion] ${estadoRadio.cancionActual} - ${estadoRadio.artista}`);
  });

  // ── Evento: el locutor cambia el estado EN VIVO ──
  socket.on("toggleEnVivo", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.enVivo = !!data.enVivo;
    io.emit("estadoEnVivo", { enVivo: estadoRadio.enVivo });
    console.log(`[Radio] Estado EN VIVO: ${estadoRadio.enVivo}`);
  });

  // ── Evento: el locutor marca una petición como completada ──
  socket.on("marcarCompletado", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    io.emit("peticionCompletada", { id: data.id });
  });

  // ── Voz en vivo: el locutor envía chunks de audio via Socket.io ─────────────
  socket.on("voz-chunk", (chunk) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    // Reenvía el chunk de audio a todos los oyentes
    socket.broadcast.emit("voz-chunk", chunk);
  });

  socket.on("voz-inicio", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.vozActiva = true;
    estadoRadio.vozMimeType = data?.mimeType || "audio/webm;codecs=opus";
    console.log("[Voz] Locutor al aire, mimeType:", estadoRadio.vozMimeType);
    socket.broadcast.emit("voz-inicio", { mimeType: estadoRadio.vozMimeType });
    io.emit("mensajeSistema", {
      tipo: "sistema",
      texto: "🎙️ El locutor está hablando en vivo",
      timestamp: new Date().toISOString()
    });
  });

  socket.on("voz-fin", () => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.vozActiva = false;
    console.log("[Voz] Locutor dejó el aire");
    socket.broadcast.emit("voz-fin");
    io.emit("mensajeSistema", {
      tipo: "sistema",
      texto: "🎵 Volviendo a la música",
      timestamp: new Date().toISOString()
    });
  });

  // ── Desconexión ──
  socket.on("disconnect", () => {
    const usuario = oyentesConectados.get(socket.id);
    if (usuario) {
      oyentesConectados.delete(socket.id);
      console.log(`[-] Desconectado: ${usuario.apodo}`);

      if (!usuario.esLocutor) {
        io.emit("mensajeSistema", {
          tipo: "sistema",
          texto: `${usuario.apodo} salió de la radio`,
          timestamp: new Date().toISOString()
        });
      }
      io.emit("actualizarOyentes", { count: oyentesConectados.size });
    }
  });
});

//   ─── Arrancar servidor ───────  //
const PORT = process.env.PORT || 3000;
inicializarDB().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🎙️  Radio en Vivo corriendo en: http://localhost:${PORT}`);
    console.log(`🎚️  Panel del Locutor en:        http://localhost:${PORT}/locutor\n`);
  });
});
