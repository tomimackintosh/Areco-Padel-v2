/**
 * PAGOSSERVICE.GS
 * Registro y consulta de pagos manuales (presenciales) hechos desde el
 * panel: seÃ±a parcial, cobro de saldo restante, pago total, etc.
 * El estado de la reserva se recalcula siempre con determinarEstadoPago_,
 * nunca hay que "adivinar" o setearlo a mano.
 */

function listarPagosPorReserva(token, reservaId) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  return sheetToObjects_('PAGOS').filter(function(p) { return p.Reserva_ID === reservaId; })
    .sort(function(a, b) { return new Date(a.Fecha) - new Date(b.Fecha); });
}

/**
 * Registra un pago (SEÃ‘A, SALDO o TOTAL) contra una reserva existente y
 * recalcula SeÃ±a (monto pagado acumulado), Saldo y Estado.
 */
function registrarPago(token, data) {
  var sesion = requireRole_(token, ['ADMIN', 'RECEPCION']);
  var monto = validarMontoPago_(data.monto);
  var tipo = String(data.tipo || '').toUpperCase();
  if (['SEÃ‘A', 'SALDO', 'TOTAL'].indexOf(tipo) === -1) {
    throw new Error('El tipo de pago debe ser SEÃ‘A, SALDO o TOTAL.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('Intenta de nuevo en unos segundos.');
  try {
    var reserva = buscarFila_('RESERVAS', 'Reserva_ID', data.reservaId);
    if (!reserva) throw new Error('Reserva no encontrada.');
    if (String(reserva.Estado).toUpperCase() === 'CANCELADA') {
      throw new Error('No se pueden registrar pagos sobre una reserva cancelada.');
    }

    var saldoActual = Number(reserva.Saldo) || 0;
    if (monto > saldoActual + 0.01) {
      throw new Error('El monto ingresado (' + monto + ') supera el saldo pendiente (' + saldoActual + ').');
    }

    var pagoId = generarId_('PAGOS', 'Pago_ID', 'PAG');
    appendRowFromObject_('PAGOS', {
      Pago_ID: pagoId,
      Reserva_ID: data.reservaId,
      Fecha: new Date(),
      Tipo: tipo,
      Monto: monto,
      Medio_Pago: sanitizar_(data.medioPago || ''),
      Registrado_Por: sesion.usuarioId,
      Observaciones: sanitizar_(data.observaciones || '')
    });

    var nuevoPagado = (Number(obtenerCampo_(reserva, 'Seña')) || 0) + monto;
    var precio = Number(reserva.Precio) || 0;
    var nuevoSaldo = Math.max(0, precio - nuevoPagado);
    var nuevoEstado = determinarEstadoPago_(nuevoSaldo, precio);

    updateRowFromObject_('RESERVAS', reserva.__row, {
      'Seña': nuevoPagado,
      Saldo: nuevoSaldo,
      Estado: nuevoEstado,
      Medio_Pago: sanitizar_(data.medioPago || reserva.Medio_Pago || '')
    });

    invalidarCachePanel_(formatFecha_(reserva.Fecha));
    return { ok: true, pagoId: pagoId, saldoRestante: nuevoSaldo, estado: nuevoEstado };
  } finally {
    lock.releaseLock();
  }
}
