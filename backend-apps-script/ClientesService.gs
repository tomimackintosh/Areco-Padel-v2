/**
 * CLIENTESSERVICE.GS
 * Gestion de clientes. Un cliente nuevo se crea automaticamente al reservar
 * (matching por email, case-insensitive). No se duplica informacion.
 */

function buscarClientePorEmail_(email) {
  var clientes = sheetToObjects_('CLIENTES');
  var emailLower = String(email).toLowerCase();
  for (var i = 0; i < clientes.length; i++) {
    if (String(clientes[i].Email).toLowerCase() === emailLower) return clientes[i];
  }
  return null;
}

function buscarOCrearCliente_(nombre, apellido, whatsapp, email) {
  var existente = buscarClientePorEmail_(email);
  if (existente) {
    updateRowFromObject_('CLIENTES', existente.__row, {
      Nombre: nombre, Apellido: apellido, WhatsApp: whatsapp
    });
    return existente.Cliente_ID;
  }
  var id = generarId_('CLIENTES', 'Cliente_ID', 'CLI');
  appendRowFromObject_('CLIENTES', {
    Cliente_ID: id, Nombre: nombre, Apellido: apellido, WhatsApp: whatsapp,
    Email: email, Fecha_Alta: new Date(), Activo: 'SI', Observaciones: ''
  });
  return id;
}

function listarClientes(token, filtro) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var clientes = sheetToObjects_('CLIENTES');
  if (filtro) {
    var f = filtro.toLowerCase();
    clientes = clientes.filter(function(c) {
      return (String(c.Nombre) + ' ' + String(c.Apellido) + ' ' + String(c.Email))
        .toLowerCase().indexOf(f) !== -1;
    });
  }
  return clientes.map(function(c) {
    return {
      clienteId: c.Cliente_ID, nombre: c.Nombre, apellido: c.Apellido,
      whatsapp: c.WhatsApp, email: c.Email,
      fechaAlta: c.Fecha_Alta ? formatFechaLegible_(c.Fecha_Alta) : '',
      activo: String(c.Activo).toUpperCase() === 'SI',
      observaciones: c.Observaciones || ''
    };
  });
}

function obtenerCliente(token, clienteId) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var c = buscarFila_('CLIENTES', 'Cliente_ID', clienteId);
  if (!c) throw new Error('Cliente no encontrado.');
  return c;
}

function actualizarCliente(token, clienteId, cambios) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var cliente = buscarFila_('CLIENTES', 'Cliente_ID', clienteId);
  if (!cliente) throw new Error('Cliente no encontrado.');

  var permitido = {};
  if (cambios.nombre !== undefined) permitido.Nombre = sanitizar_(cambios.nombre);
  if (cambios.apellido !== undefined) permitido.Apellido = sanitizar_(cambios.apellido);
  if (cambios.whatsapp !== undefined) {
    if (!validarTelefono_(cambios.whatsapp)) throw new Error('El WhatsApp ingresado no es valido.');
    permitido.WhatsApp = sanitizar_(cambios.whatsapp);
  }
  if (cambios.email !== undefined) {
    if (!validarEmail_(cambios.email)) throw new Error('El email ingresado no es valido.');
    permitido.Email = sanitizar_(cambios.email).toLowerCase();
  }
  if (cambios.activo !== undefined) permitido.Activo = cambios.activo ? 'SI' : 'NO';
  if (cambios.observaciones !== undefined) permitido.Observaciones = sanitizar_(cambios.observaciones);

  updateRowFromObject_('CLIENTES', cliente.__row, permitido);
  return { ok: true };
}

/**
 * Historial completo de un cliente + estadisticas calculadas
 * automaticamente a partir de sus reservas (total, finalizadas, canceladas,
 * proximas, ultima reserva, cancha mas usada, horario habitual y
 * distribucion mañana/tarde/noche).
 */
function historialCliente(token, clienteId) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var canchas = sheetToObjects_('CANCHAS');
  var horarios = sheetToObjects_('HORARIOS');

  var reservas = sheetToObjects_('RESERVAS')
    .filter(function(r) { return r.Cliente_ID === clienteId; })
    .map(function(r) { return enriquecerReserva_(r, canchas, horarios); })
    .sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });

  var hoy = formatFecha_(new Date());
  var finalizadas = reservas.filter(function(r) { return r.estado !== 'CANCELADA' && r.fecha < hoy; }).length;
  var canceladas = reservas.filter(function(r) { return r.estado === 'CANCELADA'; }).length;
  var proximas = reservas.filter(function(r) { return r.estado !== 'CANCELADA' && r.fecha >= hoy; }).length;

  var conteoCanchas = {};
  var conteoHorarios = {};
  var franjas = { mañana: 0, tarde: 0, noche: 0 };

  reservas.forEach(function(r) {
    if (r.estado === 'CANCELADA') return;
    conteoCanchas[r.cancha] = (conteoCanchas[r.cancha] || 0) + 1;
    conteoHorarios[r.horaInicio] = (conteoHorarios[r.horaInicio] || 0) + 1;
    franjas[obtenerFranjaHoraria_(r.horaInicio)]++;
  });

  function maxClave_(obj) {
    var mejor = null, mejorN = 0;
    for (var k in obj) { if (obj[k] > mejorN) { mejor = k; mejorN = obj[k]; } }
    return mejor;
  }

  return {
    reservas: reservas,
    stats: {
      totalReservas: reservas.length,
      finalizadas: finalizadas,
      canceladas: canceladas,
      proximas: proximas,
      ultimaReserva: reservas.length ? reservas[0].fechaLegible : '-',
      canchaMasUsada: maxClave_(conteoCanchas) || '-',
      horarioHabitual: maxClave_(conteoHorarios) || '-',
      reservasMañana: franjas['mañana'],
      reservasTarde: franjas.tarde,
      reservasNoche: franjas.noche
    }
  };
}