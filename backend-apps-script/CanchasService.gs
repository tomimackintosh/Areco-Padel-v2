/**
 * CANCHASSERVICE.GS
 * Gestión de canchas y horarios (grilla fija de turnos definida en la hoja
 * HORARIOS). La duración de cada turno surge de Hora_Inicio/Hora_Fin de esa
 * hoja; el parámetro CONFIG.Duracion_Reserva_Minutos es sólo informativo.
 */

function listarCanchas(soloActivas) {
  var canchas = sheetToObjects_('CANCHAS');
  if (soloActivas) {
    canchas = canchas.filter(function(c) { return String(c.Activa).toUpperCase() === 'SI'; });
  }
  return canchas.map(function(c) {
    return {
      canchaId: c.Cancha_ID,
      nombre: c.Nombre,
      tipo: c.Tipo,
      precio: c.Precio,
      activa: String(c.Activa).toUpperCase() === 'SI'
    };
  });
}

function listarHorarios(soloActivos) {
  var horarios = sheetToObjects_('HORARIOS');
  if (soloActivos) {
    horarios = horarios.filter(function(h) { return String(h.Activo).toUpperCase() === 'SI'; });
  }
  return horarios.map(function(h) {
    return {
      horarioId: h.Horario_ID,
      horaInicio: formatHora_(h.Hora_Inicio),
      horaFin: formatHora_(h.Hora_Fin),
      activo: String(h.Activo).toUpperCase() === 'SI',
      __horaInicioRaw: h.Hora_Inicio
    };
  }).sort(function(a, b) { return new Date(a.__horaInicioRaw) - new Date(b.__horaInicioRaw); })
    .map(function(h) { delete h.__horaInicioRaw; return h; });
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
  return { ok: true, id: id };
}

function actualizarHorario(token, horarioId, cambios) {
  requireRole_(token, ['ADMIN']);
  var horario = buscarFila_('HORARIOS', 'Horario_ID', horarioId);
  if (!horario) throw new Error('Horario no encontrado.');
  var permitido = {};
  if (cambios.activo !== undefined) permitido.Activo = cambios.activo ? 'SI' : 'NO';
  updateRowFromObject_('HORARIOS', horario.__row, permitido);
  return { ok: true };
}