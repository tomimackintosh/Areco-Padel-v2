/**
 * CANCHASSERVICE.GS
 * Gestión de canchas y horarios (grilla fija de turnos definida en la hoja
 * HORARIOS). La duración de cada turno surge de Hora_Inicio/Hora_Fin de esa
 * hoja; el parámetro CONFIG.Duracion_Reserva_Minutos es sólo informativo.
 */

// Canchas y horarios casi no cambian, así que se cachean unos minutos: evita
// releer la planilla en cada apertura del panel o cambio de sección.
var CANCHAS_HORARIOS_CACHE_SECONDS = 300;

function listarCanchas(soloActivas) {
  var cacheKey = 'CANCHAS_' + (soloActivas ? '1' : '0');
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* sigue y relee */ } }

  var canchas = sheetToObjects_('CANCHAS');
  if (soloActivas) {
    canchas = canchas.filter(function(c) { return String(c.Activa).toUpperCase() === 'SI'; });
  }
  var salida = canchas.map(function(c) {
    return {
      canchaId: c.Cancha_ID,
      nombre: c.Nombre,
      tipo: c.Tipo,
      precio: c.Precio,
      activa: String(c.Activa).toUpperCase() === 'SI'
    };
  });
  cache.put(cacheKey, JSON.stringify(salida), CANCHAS_HORARIOS_CACHE_SECONDS);
  return salida;
}

function listarHorarios(soloActivos) {
  var cacheKey = 'HORARIOS_' + (soloActivos ? '1' : '0');
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* sigue y relee */ } }

  var horarios = sheetToObjects_('HORARIOS');
  if (soloActivos) {
    horarios = horarios.filter(function(h) { return String(h.Activo).toUpperCase() === 'SI'; });
  }
  var salida = horarios.map(function(h) {
    return {
      horarioId: h.Horario_ID,
      horaInicio: formatHora_(h.Hora_Inicio),
      horaFin: formatHora_(h.Hora_Fin),
      activo: String(h.Activo).toUpperCase() === 'SI',
      __horaInicioRaw: h.Hora_Inicio
    };
  }).sort(function(a, b) { return new Date(a.__horaInicioRaw) - new Date(b.__horaInicioRaw); })
    .map(function(h) { delete h.__horaInicioRaw; return h; });
  cache.put(cacheKey, JSON.stringify(salida), CANCHAS_HORARIOS_CACHE_SECONDS);
  return salida;
}

/** Limpia el cache de canchas/horarios (se llama al editar cualquiera de las dos). */
function limpiarCacheCanchasHorarios_() {
  var cache = CacheService.getScriptCache();
  cache.removeAll(['CANCHAS_0', 'CANCHAS_1', 'HORARIOS_0', 'HORARIOS_1']);
}

/* ---------------- Administración (requiere sesión) ---------------- */

function actualizarCancha(token, canchaId, cambios) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var cancha = buscarFila_('CANCHAS', 'Cancha_ID', canchaId);
  if (!cancha) throw new Error('Cancha no encontrada.');

  var permitido = {};
  if (cambios.nombre !== undefined) permitido.Nombre = sanitizar_(cambios.nombre);
  if (cambios.tipo !== undefined) permitido.Tipo = sanitizar_(cambios.tipo);
  if (cambios.precio !== undefined) {
    var precio = Number(cambios.precio);
    if (isNaN(precio) || precio < 0) throw new Error('El precio debe ser un número válido.');
    permitido.Precio = precio;
  }
  if (cambios.activa !== undefined) permitido.Activa = cambios.activa ? 'SI' : 'NO';

  updateRowFromObject_('CANCHAS', cancha.__row, permitido);
  limpiarCacheCanchasHorarios_();
  return { ok: true };
}

function crearCancha(token, data) {
  requireRole_(token, ['ADMIN']);
  var nombre = sanitizar_(data.nombre);
  if (!validarNoVacio_(nombre)) throw new Error('El nombre de la cancha es obligatorio.');
  var precio = Number(data.precio);
  if (isNaN(precio) || precio < 0) throw new Error('El precio debe ser un número válido.');

  var id = generarId_('CANCHAS', 'Cancha_ID', 'C');
  appendRowFromObject_('CANCHAS', {
    Cancha_ID: id, Nombre: nombre, Tipo: sanitizar_(data.tipo) || 'Descubierta',
    Precio: precio, Activa: 'SI'
  });
  limpiarCacheCanchasHorarios_();
  return { ok: true, id: id };
}

function actualizarHorario(token, horarioId, cambios) {
  requireRole_(token, ['ADMIN']);
  var horario = buscarFila_('HORARIOS', 'Horario_ID', horarioId);
  if (!horario) throw new Error('Horario no encontrado.');
  var permitido = {};
  if (cambios.activo !== undefined) permitido.Activo = cambios.activo ? 'SI' : 'NO';
  updateRowFromObject_('HORARIOS', horario.__row, permitido);
  limpiarCacheCanchasHorarios_();
  return { ok: true };
}
