/**
 * RESERVASSERVICE.GS
 * Nucleo del sistema: disponibilidad, creacion (via pago), calendario diario
 * de administracion, edicion y cancelacion de reservas. Usa LockService para
 * evitar reservas duplicadas ante solicitudes simultaneas.
 *
 * Estados posibles de una reserva (Estado) -- son valores dentro de la misma
 * columna "Estado" que ya existia en RESERVAS, no se agrega ninguna columna:
 *   - PARCIAL     -> falta pagar algo (desde 0 pagado hasta cualquier pago parcial)
 *   - CONFIRMADA  -> 100% del importe pagado
 *   - CANCELADA   -> turno liberado, no ocupa el horario
 * Un turno sin ninguna reserva vigente simplemente se ve "Disponible" en el
 * calendario (no es un estado guardado, es la ausencia de reserva activa).
 * Todos los estados excepto CANCELADA "ocupan" el horario en la grilla.
 */

var ESTADO_CANCELADA = 'CANCELADA';
var ESTADOS_VALIDOS = ['PARCIAL', 'CONFIRMADA', 'CANCELADA'];
var LOCK_TIMEOUT_MS = 10000;

function ocupaTurno_(estado) {
  return String(estado).toUpperCase() !== ESTADO_CANCELADA;
}

/**
 * Determina automaticamente el estado de pago de una reserva a partir del
 * saldo pendiente. Es la unica funcion que decide el estado por pago, para
 * que nunca quede desincronizado con lo que realmente se cobro.
 */
function determinarEstadoPago_(saldo, precio) {
  return saldo <= 0.01 ? 'CONFIRMADA' : 'PARCIAL';
}

/**
 * Combina CANCHAS activas x HORARIOS activos para una fecha dada, marcando
 * cuales ya estan ocupados por una reserva vigente (no cancelada).
 * La usa la vista de cliente (selector de fecha sin cambios).
 */
function getDisponibilidad(fechaStr) {
  if (!validarFechaFormato_(fechaStr)) throw new Error('Fecha invalida.');

  var canchas = listarCanchas(true);
  var horarios = listarHorarios(true);
  var reservasDelDia = sheetToObjects_('RESERVAS').filter(function(r) {
    return formatFecha_(r.Fecha) === fechaStr && ocupaTurno_(r.Estado);
  });

  var ocupados = {};
  reservasDelDia.forEach(function(r) {
    ocupados[r.Cancha_ID + '_' + r.Horario_ID] = true;
  });

  var ahora = new Date();
  var config = getConfig();
  var minHoras = Number(config.Anticipacion_Min_Horas) || 24;

  var grilla = horarios.map(function(h) {
    var slots = canchas.map(function(c) {
      var key = c.canchaId + '_' + h.horarioId;
      var inicio = combinarFechaHora_(fechaStr, new Date(1970, 0, 1, parseInt(h.horaInicio.split(':')[0], 10), parseInt(h.horaInicio.split(':')[1], 10)));
      var horasHastaInicio = (inicio.getTime() - ahora.getTime()) / (1000 * 60 * 60);
      var disponible = !ocupados[key] && horasHastaInicio >= minHoras;
      return {
        canchaId: c.canchaId,
        nombreCancha: c.nombre,
        precio: c.precio,
        disponible: disponible
      };
    });
    return { horarioId: h.horarioId, horaInicio: h.horaInicio, horaFin: h.horaFin, canchas: slots };
  });

  return { fecha: fechaStr, horarios: grilla };
}

/**
 * Nucleo compartido de creacion de reserva. Se ejecuta SIEMPRE dentro de un
 * LockService (lo maneja el caller) y asume que los datos ya fueron
 * validados. Crea la fila en RESERVAS y, si corresponde, la fila de pago en
 * PAGOS, calculando saldo/estado automaticamente.
 *
 * @param {Object} data { fecha, horarioId, canchaId, nombre, apellido, whatsapp, email, observaciones, precio? }
 * @param {Object} contextoPago { monto, tipoPago, medioPago, esOnline, registradoPor }
 */
function crearReservaInterna_(data, contextoPago) {
  var cancha = buscarFila_('CANCHAS', 'Cancha_ID', data.canchaId);
  if (!cancha || String(cancha.Activa).toUpperCase() !== 'SI') {
    throw new Error('La cancha seleccionada no esta disponible.');
  }
  var horario = buscarFila_('HORARIOS', 'Horario_ID', data.horarioId);
  if (!horario || String(horario.Activo).toUpperCase() !== 'SI') {
    throw new Error('El horario seleccionado no esta disponible.');
  }

  var yaOcupado = sheetToObjects_('RESERVAS').some(function(r) {
    return formatFecha_(r.Fecha) === data.fecha &&
      r.Horario_ID === data.horarioId &&
      r.Cancha_ID === data.canchaId &&
      ocupaTurno_(r.Estado);
  });
  if (yaOcupado) {
    throw new Error('Ese turno acaba de ser ocupado. Elegi otro horario.');
  }

  var clienteId = buscarOCrearCliente_(
    sanitizar_(data.nombre), sanitizar_(data.apellido),
    sanitizar_(data.whatsapp), sanitizar_(data.email).toLowerCase()
  );

  var precio = data.precio !== undefined && data.precio !== null && data.precio !== ''
    ? Number(data.precio) : Number(cancha.Precio);
  var monto = Number(contextoPago.monto) || 0;
  var saldo = Math.max(0, precio - monto);
  var estado = determinarEstadoPago_(saldo, precio);

  var reservaId = generarId_('RESERVAS', 'Reserva_ID', 'RES');
  appendRowFromObject_('RESERVAS', {
    Reserva_ID: reservaId,
    Fecha: new Date(data.fecha + 'T00:00:00'),
    Horario_ID: data.horarioId,
    Cancha_ID: data.canchaId,
    Cliente_ID: clienteId,
    Estado: estado,
    Precio: precio,
    'Seña': monto,
    Saldo: saldo,
    Medio_Pago: sanitizar_(contextoPago.medioPago || ''),
    Fecha_Creacion: new Date(),
    Creado_Por: contextoPago.registradoPor || 'CLIENTE',
    Observaciones: sanitizar_(data.observaciones || '')
  });

  if (monto > 0) {
    var pagoId = generarId_('PAGOS', 'Pago_ID', 'PAG');
    appendRowFromObject_('PAGOS', {
      Pago_ID: pagoId,
      Reserva_ID: reservaId,
      Fecha: new Date(),
      Tipo: contextoPago.tipoPago || 'SEÑA',
      Monto: monto,
      Medio_Pago: sanitizar_(contextoPago.medioPago || ''),
      Registrado_Por: contextoPago.registradoPor || 'CLIENTE',
      Observaciones: contextoPago.esOnline ? 'Pago online (demo)' : ''
    });
  }

  var fechaHoraInicio = combinarFechaHora_(data.fecha, horario.Hora_Inicio);
  programarRecordatorio_(reservaId, fechaHoraInicio, data.email);

  var reservaCompleta = {
    reservaId: reservaId, fecha: data.fecha, horaInicio: formatHora_(horario.Hora_Inicio),
    horaFin: formatHora_(horario.Hora_Fin), cancha: cancha.Nombre, precio: precio,
    estado: estado, pagado: monto, saldo: saldo
  };

  enviarConfirmacionReserva_(reservaCompleta, {
    nombre: data.nombre, apellido: data.apellido, email: data.email
  });

  return { ok: true, reserva: reservaCompleta };
}

/**
 * El cliente consulta su propia reserva verificando Reserva_ID + email.
 */
function consultarReservaCliente(reservaId, email) {
  var r = buscarFila_('RESERVAS', 'Reserva_ID', reservaId);
  if (!r) throw new Error('No se encontro ninguna reserva con ese codigo.');
  var cliente = buscarFila_('CLIENTES', 'Cliente_ID', r.Cliente_ID);
  if (!cliente || String(cliente.Email).toLowerCase() !== String(email).toLowerCase()) {
    throw new Error('El codigo de reserva y el email no coinciden.');
  }
  var canchas = sheetToObjects_('CANCHAS');
  var horarios = sheetToObjects_('HORARIOS');
  var enr = enriquecerReserva_(r, canchas, horarios);
  enr.puedeCancelar = false;
  enr.motivoNoCancelable = '';
  if (String(r.Estado).toUpperCase() === 'CANCELADA') {
    enr.motivoNoCancelable = 'Esta reserva ya esta cancelada.';
  } else {
    var horario = horarios.filter(function(h) { return h.Horario_ID === r.Horario_ID; })[0];
    var fechaHoraInicio = combinarFechaHora_(formatFecha_(r.Fecha), horario.Hora_Inicio);
    var config = getConfig();
    var minHoras = Number(config.Anticipacion_Min_Horas) || 24;
    var horasRestantes = (fechaHoraInicio.getTime() - new Date().getTime()) / (1000 * 60 * 60);
    if (horasRestantes < minHoras) {
      enr.motivoNoCancelable = 'Ya no se puede cancelar: faltan menos de ' + minHoras + ' horas para el turno.';
    } else {
      enr.puedeCancelar = true;
    }
  }
  return enr;
}

function cancelarReservaCliente(reservaId, email) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Intenta de nuevo en unos segundos.');
  try {
    var r = buscarFila_('RESERVAS', 'Reserva_ID', reservaId);
    if (!r) throw new Error('No se encontro ninguna reserva con ese codigo.');
    var cliente = buscarFila_('CLIENTES', 'Cliente_ID', r.Cliente_ID);
    if (!cliente || String(cliente.Email).toLowerCase() !== String(email).toLowerCase()) {
      throw new Error('El codigo de reserva y el email no coinciden.');
    }
    if (String(r.Estado).toUpperCase() === 'CANCELADA') {
      throw new Error('Esa reserva ya estaba cancelada.');
    }
    var horario = buscarFila_('HORARIOS', 'Horario_ID', r.Horario_ID);
    var fechaHoraInicio = combinarFechaHora_(formatFecha_(r.Fecha), horario.Hora_Inicio);
    var config = getConfig();
    var minHoras = Number(config.Anticipacion_Min_Horas) || 24;
    var horasRestantes = (fechaHoraInicio.getTime() - new Date().getTime()) / (1000 * 60 * 60);
    if (horasRestantes < minHoras) {
      throw new Error('Ya no se puede cancelar: faltan menos de ' + minHoras + ' horas para el turno.');
    }

    updateRowFromObject_('RESERVAS', r.__row, { Estado: 'CANCELADA' });
    cancelarRecordatoriosPendientes_(reservaId);
    enviarCancelacion_(r, cliente);
    return { ok: true, señaReembolsable: false };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Panel administrativo ---------------- */

function enriquecerReserva_(r, canchas, horarios) {
  var cancha = canchas.filter(function(c) { return c.Cancha_ID === r.Cancha_ID; })[0];
  var horario = horarios.filter(function(h) { return h.Horario_ID === r.Horario_ID; })[0];
  return {
    reservaId: r.Reserva_ID,
    fecha: formatFecha_(r.Fecha),
    fechaLegible: formatFechaLegible_(r.Fecha),
    horarioId: r.Horario_ID,
    horaInicio: horario ? formatHora_(horario.Hora_Inicio) : '',
    horaFin: horario ? formatHora_(horario.Hora_Fin) : '',
    canchaId: r.Cancha_ID,
    cancha: cancha ? cancha.Nombre : r.Cancha_ID,
    clienteId: r.Cliente_ID,
    estado: r.Estado,
    precio: Number(r.Precio) || 0,
    pagado: Number(obtenerCampo_(r, 'Seña')) || 0,
    saldo: Number(r.Saldo) || 0,
    medioPago: r.Medio_Pago,
    creadoPor: r.Creado_Por,
    observaciones: r.Observaciones || ''
  };
}

/**
 * Lista reservas con filtros opcionales (fecha exacta o rango, cancha, estado).
 */
function listarReservas(token, filtros) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  filtros = filtros || {};
  var reservas = sheetToObjects_('RESERVAS');
  var canchas = sheetToObjects_('CANCHAS');
  var horarios = sheetToObjects_('HORARIOS');
  var clientes = sheetToObjects_('CLIENTES');

  if (filtros.fecha) {
    reservas = reservas.filter(function(r) { return formatFecha_(r.Fecha) === filtros.fecha; });
  }
  if (filtros.fechaDesde) {
    reservas = reservas.filter(function(r) { return formatFecha_(r.Fecha) >= filtros.fechaDesde; });
  }
  if (filtros.fechaHasta) {
    reservas = reservas.filter(function(r) { return formatFecha_(r.Fecha) <= filtros.fechaHasta; });
  }
  if (filtros.canchaId) {
    reservas = reservas.filter(function(r) { return r.Cancha_ID === filtros.canchaId; });
  }
  if (filtros.estado) {
    reservas = reservas.filter(function(r) { return String(r.Estado).toUpperCase() === filtros.estado.toUpperCase(); });
  }

  return reservas.map(function(r) {
    var enr = enriquecerReserva_(r, canchas, horarios);
    var cli = clientes.filter(function(c) { return c.Cliente_ID === r.Cliente_ID; })[0];
    if (cli) {
      enr.clienteNombre = cli.Nombre + ' ' + cli.Apellido;
      enr.clienteWhatsapp = cli.WhatsApp;
      enr.clienteEmail = cli.Email;
    }
    return enr;
  }).sort(function(a, b) { return b.fecha.localeCompare(a.fecha); });
}

/**
 * Vista de calendario diario para el panel: una fila por cancha, una
 * columna por horario, con la reserva (si existe) enriquecida.
 */
function obtenerCalendarioDia(token, fecha, filtros) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  if (!validarFechaFormato_(fecha)) throw new Error('Fecha invalida.');
  filtros = filtros || {};

  var canchas = sheetToObjects_('CANCHAS').map(function(c) {
    return { canchaId: c.Cancha_ID, nombre: c.Nombre, precio: c.Precio, activa: String(c.Activa).toUpperCase() === 'SI' };
  });
  if (filtros.canchaId) canchas = canchas.filter(function(c) { return c.canchaId === filtros.canchaId; });

  var horarios = listarHorarios(false);
  var reservasDia = sheetToObjects_('RESERVAS').filter(function(r) {
    return formatFecha_(r.Fecha) === fecha && ocupaTurno_(r.Estado);
  });
  var clientes = sheetToObjects_('CLIENTES');
  var canchasRaw = sheetToObjects_('CANCHAS');
  var horariosRaw = sheetToObjects_('HORARIOS');

  var filas = canchas.map(function(c) {
    var celdas = horarios.map(function(h) {
      var reserva = reservasDia.filter(function(r) { return r.Cancha_ID === c.canchaId && r.Horario_ID === h.horarioId; })[0];
      var celda = { horarioId: h.horarioId, horaInicio: h.horaInicio, horaFin: h.horaFin, reserva: null, filtradoOculto: false };
      if (reserva) {
        var enr = enriquecerReserva_(reserva, canchasRaw, horariosRaw);
        var cli = clientes.filter(function(x) { return x.Cliente_ID === reserva.Cliente_ID; })[0];
        enr.clienteNombre = cli ? (cli.Nombre + ' ' + cli.Apellido) : reserva.Cliente_ID;
        enr.clienteWhatsapp = cli ? cli.WhatsApp : '';
        enr.clienteEmail = cli ? cli.Email : '';
        celda.reserva = enr;
        celda.filtradoOculto = !!(filtros.estado && enr.estado !== filtros.estado);
      }
      return celda;
    });
    return { canchaId: c.canchaId, nombre: c.nombre, activa: c.activa, celdas: celdas };
  });

  return { fecha: fecha, canchas: filas };
}

/**
 * Crea una reserva manual desde el panel admin. Permite registrar un pago
 * inicial opcional (presencial) en el mismo paso.
 * data: { fecha, canchaId, horarioId, nombre, apellido, whatsapp, email,
 *         observaciones, precio?, pagoInicial?, medioPago? }
 */
function crearReservaAdmin(token, data) {
  var sesion = requireRole_(token, ['ADMIN', 'RECEPCION']);
  validarDatosBasicasReserva_(data);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('El sistema esta ocupado, proba de nuevo en unos segundos.');
  try {
    var pagoInicial = Number(data.pagoInicial) || 0;
    if (pagoInicial < 0) throw new Error('El pago inicial no puede ser negativo.');

    var cancha = buscarFila_('CANCHAS', 'Cancha_ID', data.canchaId);
    var precioRef = data.precio ? Number(data.precio) : (cancha ? Number(cancha.Precio) : 0);
    if (pagoInicial > precioRef) throw new Error('El pago inicial no puede superar el precio de la cancha.');

    var tipoPago = pagoInicial >= precioRef && precioRef > 0 ? 'TOTAL' : 'SEÑA';

    return crearReservaInterna_(data, {
      monto: pagoInicial,
      tipoPago: tipoPago,
      medioPago: data.medioPago || '',
      esOnline: false,
      registradoPor: sesion.usuarioId
    });
  } finally {
    lock.releaseLock();
  }
}

function validarDatosBasicasReserva_(data) {
  if (!validarNoVacio_(data.fecha) || !validarFechaFormato_(data.fecha)) throw new Error('La fecha ingresada no es valida.');
  if (!validarNoVacio_(data.horarioId)) throw new Error('Debes seleccionar un horario.');
  if (!validarNoVacio_(data.canchaId)) throw new Error('Debes seleccionar una cancha.');
  if (!validarNoVacio_(data.nombre)) throw new Error('El nombre es obligatorio.');
  if (!validarNoVacio_(data.apellido)) throw new Error('El apellido es obligatorio.');
  if (!validarNoVacio_(data.whatsapp) || !validarTelefono_(data.whatsapp)) throw new Error('El WhatsApp ingresado no es valido.');
  if (!validarNoVacio_(data.email) || !validarEmail_(data.email)) throw new Error('El email ingresado no es valido.');
}

function editarReserva(token, reservaId, cambios) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Intenta de nuevo en unos segundos.');
  try {
    var r = buscarFila_('RESERVAS', 'Reserva_ID', reservaId);
    if (!r) throw new Error('Reserva no encontrada.');

    var permitido = {};

    var nuevaFecha = cambios.fecha !== undefined ? cambios.fecha : formatFecha_(r.Fecha);
    var nuevoHorario = cambios.horarioId !== undefined ? cambios.horarioId : r.Horario_ID;
    var nuevaCancha = cambios.canchaId !== undefined ? cambios.canchaId : r.Cancha_ID;
    var cambiaTurno = (nuevaFecha !== formatFecha_(r.Fecha)) || (nuevoHorario !== r.Horario_ID) || (nuevaCancha !== r.Cancha_ID);

    if (cambiaTurno) {
      if (!validarFechaFormato_(nuevaFecha)) throw new Error('Fecha invalida.');
      var ocupado = sheetToObjects_('RESERVAS').some(function(x) {
        return x.Reserva_ID !== reservaId &&
          formatFecha_(x.Fecha) === nuevaFecha && x.Horario_ID === nuevoHorario && x.Cancha_ID === nuevaCancha &&
          ocupaTurno_(x.Estado);
      });
      if (ocupado) throw new Error('Ese turno ya esta ocupado por otra reserva.');
      permitido.Fecha = new Date(nuevaFecha + 'T00:00:00');
      permitido.Horario_ID = nuevoHorario;
      permitido.Cancha_ID = nuevaCancha;
    }

    if (cambios.estado !== undefined) {
      var estado = String(cambios.estado).toUpperCase();
      if (ESTADOS_VALIDOS.indexOf(estado) === -1) throw new Error('Estado invalido.');
      permitido.Estado = estado;
      if (estado === 'CANCELADA') cancelarRecordatoriosPendientes_(reservaId);
    }
    if (cambios.observaciones !== undefined) permitido.Observaciones = sanitizar_(cambios.observaciones);
    if (cambios.medioPago !== undefined) permitido.Medio_Pago = sanitizar_(cambios.medioPago);
    if (cambios.precio !== undefined) {
      var precio = Number(cambios.precio);
      if (isNaN(precio) || precio < 0) throw new Error('El precio debe ser un numero valido.');
      permitido.Precio = precio;
      var pagadoActual = Number(obtenerCampo_(r, 'Seña')) || 0;
      permitido.Saldo = Math.max(0, precio - pagadoActual);
    }

    updateRowFromObject_('RESERVAS', r.__row, permitido);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function cancelarReservaAdmin(token, reservaId, motivo) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  var r = buscarFila_('RESERVAS', 'Reserva_ID', reservaId);
  if (!r) throw new Error('Reserva no encontrada.');
  updateRowFromObject_('RESERVAS', r.__row, {
    Estado: 'CANCELADA',
    Observaciones: (r.Observaciones ? r.Observaciones + ' | ' : '') + 'Cancelada por administracion' + (motivo ? (': ' + sanitizar_(motivo)) : '')
  });
  cancelarRecordatoriosPendientes_(reservaId);
  var cliente = buscarFila_('CLIENTES', 'Cliente_ID', r.Cliente_ID);
  if (cliente) enviarCancelacion_(r, cliente);
  return { ok: true };
}