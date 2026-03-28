/**
 * public/js/socket.js
 * Módulo de conexão Socket.io (lado cliente — dashboard no browser).
 * Inicializa a conexão com o servidor e emite CustomEvents
 * para que o dashboard.js possa reagir aos eventos.
 */

// Conecta ao servidor Socket.io (mesma origem que serve o dashboard)
const socket = io({
  reconnection: true,
  reconnectionDelay: 1500,
  reconnectionAttempts: 10,
});

// ─── Eventos de conexão ─────────────────────────────────────────────────────

socket.on('connect', () => {
  console.log('[Socket] Conectado ao servidor. ID:', socket.id);
  document.dispatchEvent(new CustomEvent('socket:connected', { detail: { id: socket.id } }));
  // Solicita lista atualizada de bots ao conectar
  socket.emit('dashboard:getBots');
});

socket.on('disconnect', (reason) => {
  console.warn('[Socket] Desconectado:', reason);
  document.dispatchEvent(new CustomEvent('socket:disconnected', { detail: { reason } }));
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Erro de conexão:', err.message);
  document.dispatchEvent(new CustomEvent('socket:error', { detail: { message: err.message } }));
});

// ─── Repassa eventos do servidor como CustomEvents ──────────────────────────

const SERVER_EVENTS = [
  'bots:list',
  'bots:updated',
  'bot:online',
  'bot:offline',
  'bot:registered',
  'bot:heartbeat',
  'bot:status',
  'bot:log',
  'bot:detail',
  'profiles:updated',
  'bot:assignments_updated',
];

SERVER_EVENTS.forEach((eventName) => {
  socket.on(eventName, (data) => {
    document.dispatchEvent(new CustomEvent(eventName, { detail: data }));
  });
});
