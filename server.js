const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const { pool, inicializarDB } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || "radio-unab-secret-2024",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.locutor) return next();
  res.redirect("/login");
}

// ─── Rutas de autenticación ───────────────────────────────────────────────────
app.get("/login", (req, res) => {
  if (req.session && req.session.locutor) return res.redirect("/locutor");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/auth/registro", async (req, res) => {
  const { usuario, nombre, password } = req.body;
  if (!usuario || !nombre || !password) return res.status(400).json({ error: "Completa todos los campos" });
  if (password.length < 6) return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres" });
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

app.post("/auth/login", async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: "Completa todos los campos" });
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM locutores WHERE usuario = ?",
      [usuario.toLowerCase()]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Usuario o contrasena incorrectos" });
    const valido = await bcrypt.compare(password, rows[0].password);
    if (!valido) return res.status(401).json({ error: "Usuario o contrasena incorrectos" });
    req.session.locutor = { id: rows[0].id, usuario: rows[0].usuario, nombre: rows[0].nombre };
    res.json({ ok: true });
  } catch (err) {
    console.error("[Auth] Login error:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Setup: crea o resetea el admin
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

// Listar locutores
app.get("/auth/locutores", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT id, usuario, nombre, creado_en FROM locutores ORDER BY creado_en DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// Eliminar locutor
app.delete("/auth/locutores/:id", requireAuth, async (req, res) => {
  try {
    await pool.execute("DELETE FROM locutores WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

// Rutas principales
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/locutor", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "locutor.html"));
});

app.get("/locutor/usuarios", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "usuarios.html"));
});

app.get("/api/estado", (req, res) => {
  res.json({ ...estadoRadio, oyentesCount: oyentesConectados.size });
});

// ─── Estado global ────────────────────────────────────────────────────────────
const ADJETIVOS = ["Alegre","Veloz","Curioso","Valiente","Brillante","Salvaje","Tranquilo","Audaz","Sereno","Feroz","Amable","Astuto","Gentil","Magico","Libre"];
const ANIMALES  = ["Lobo","Gato","Aguila","Zorro","Puma","Delfin","Tigre","Cuervo","Oso","Jaguar","Halcon","Lince","Nutria","Panda","Koala"];

function generarApodo() {
  const adj = ADJETIVOS[Math.floor(Math.random() * ADJETIVOS.length)];
  const ani = ANIMALES[Math.floor(Math.random() * ANIMALES.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}_${ani}_${num}`;
}

let estadoRadio = {
  enVivo: true,
  programaActual: "Programa de la Tarde",
  cancionActual: "En Vivo",
  artista: "",
  caratula: "/img/logo.jpg",
  streamUrl: "",
  youtubeUrl: ""
};

const oyentesConectados = new Map();
const historialChat = [];
const MAX_HISTORIAL = 50;

// Estadísticas globales
let stats = {
  picOyentes: 0,
  totalMensajes: 0,
  inicioServidor: Date.now()
};

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const esLocutor = socket.handshake.query.rol === "locutor";
  const apodo = esLocutor ? "Locutor" : generarApodo();
  oyentesConectados.set(socket.id, { apodo, esLocutor });

  console.log(`[+] Conectado: ${apodo} (${esLocutor ? "LOCUTOR" : "oyente"})`);

  socket.emit("bienvenida", { apodo, esLocutor, estadoRadio, oyentesCount: oyentesConectados.size });
  socket.emit("historialChat", historialChat);

  if (!esLocutor) {
    io.emit("mensajeSistema", { tipo: "sistema", texto: `${apodo} se unio a la radio`, timestamp: new Date().toISOString() });
  }
  if (oyentesConectados.size > stats.picOyentes) stats.picOyentes = oyentesConectados.size;
  io.emit("actualizarOyentes", { count: oyentesConectados.size });
  io.emit("estadisticas", { picOyentes: stats.picOyentes, totalMensajes: stats.totalMensajes, tiempoAlAire: Date.now() - stats.inicioServidor });

  if (!esLocutor && estadoRadio.vozActiva) {
    socket.emit("voz-inicio");
  }

  socket.on("enviarMensaje", (data) => {
    const usuario = oyentesConectados.get(socket.id);
    if (!usuario) return;
    const mensaje = {
      tipo: usuario.esLocutor ? "locutor" : "oyente",
      apodo: usuario.apodo,
      texto: String(data.texto).slice(0, 300),
      timestamp: new Date().toISOString(),
      id: `${socket.id}-${Date.now()}`
    };
    historialChat.push(mensaje);
    if (historialChat.length > MAX_HISTORIAL) historialChat.shift();
    stats.totalMensajes++;
    io.emit("nuevoMensaje", mensaje);
    io.emit("estadisticas", { picOyentes: stats.picOyentes, totalMensajes: stats.totalMensajes, tiempoAlAire: Date.now() - stats.inicioServidor });
  });

  socket.on("actualizarCancion", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.cancionActual  = data.cancion  || estadoRadio.cancionActual;
    estadoRadio.artista        = data.artista  || estadoRadio.artista;
    estadoRadio.caratula       = data.caratula || estadoRadio.caratula;
    estadoRadio.programaActual = data.programa || estadoRadio.programaActual;
    estadoRadio.youtubeUrl     = data.youtubeUrl || estadoRadio.youtubeUrl;
    estadoRadio.streamUrl      = data.streamUrl  || estadoRadio.streamUrl;
    io.emit("cancionActualizada", estadoRadio);
    io.emit("mensajeSistema", { tipo: "sistema", texto: `Ahora suena: ${estadoRadio.cancionActual}`, timestamp: new Date().toISOString() });
  });

  socket.on("toggleEnVivo", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.enVivo = !!data.enVivo;
    io.emit("estadoEnVivo", { enVivo: estadoRadio.enVivo });
  });

  socket.on("reaccion", (data) => {
    const EMOJIS_VALIDOS = ["❤️", "🔥", "🎵", "🎉", "👏", "❤"];
    if (!data?.emoji || !EMOJIS_VALIDOS.includes(data.emoji)) return;
    io.emit("reaccion", { emoji: data.emoji });
  });

  socket.on("marcarCompletado", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    io.emit("peticionCompletada", { id: data.id });
  });

  socket.on("voz-chunk", (chunk) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    socket.broadcast.emit("voz-chunk", chunk);
  });

  socket.on("voz-inicio", (data) => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.vozActiva  = true;
    estadoRadio.vozMimeType = data?.mimeType || "audio/webm;codecs=opus";
    socket.broadcast.emit("voz-inicio", { mimeType: estadoRadio.vozMimeType });
    io.emit("mensajeSistema", { tipo: "sistema", texto: "El locutor esta hablando en vivo", timestamp: new Date().toISOString() });
  });

  socket.on("voz-fin", () => {
    if (!oyentesConectados.get(socket.id)?.esLocutor) return;
    estadoRadio.vozActiva = false;
    socket.broadcast.emit("voz-fin");
    io.emit("mensajeSistema", { tipo: "sistema", texto: "Volviendo a la musica", timestamp: new Date().toISOString() });
  });

  socket.on("disconnect", () => {
    const usuario = oyentesConectados.get(socket.id);
    if (usuario) {
      oyentesConectados.delete(socket.id);
      if (!usuario.esLocutor) {
        io.emit("mensajeSistema", { tipo: "sistema", texto: `${usuario.apodo} salio de la radio`, timestamp: new Date().toISOString() });
      }
      io.emit("actualizarOyentes", { count: oyentesConectados.size });
      io.emit("estadisticas", { picOyentes: stats.picOyentes, totalMensajes: stats.totalMensajes, tiempoAlAire: Date.now() - stats.inicioServidor });
    }
  });
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
inicializarDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Radio corriendo en http://localhost:${PORT}`);
  });
});
