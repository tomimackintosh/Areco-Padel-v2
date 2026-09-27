/**
 * PAGOGATEWAYSERVICE.GS  (ARCHIVO NUEVO)
 *
 * Pasarela de pago para la reserva ONLINE. Hoy funciona en modo DEMO
 * (simulada, sin conexion a Mercado Pago real), pero esta separada del
 * resto del sistema justamente para poder reemplazarla el dia de mañana
 * sin tocar ReservasService ni el frontend mas que en un par de lineas:
 *
 *   - iniciarPagoReserva(data)    -> hoy genera un token DEMO en memoria.
 *                                    Mañana: llamaria a la API de Mercado
 *                                    Pago (crear preferencia) via UrlFetchApp
 *                                    y devolveria la URL de checkout real.
 *   - confirmarPagoDemo(token)    -> hoy el propio cliente "aprueba" el pago
 *                                    desde el navegador (boton demo).
 *                                    Mañana: esto lo dispararia el webhook
 *                                    de Mercado Pago (Notificacion IPN),
 *                                    no el usuario.
 *
 * Los datos de la reserva "en curso" NO se escriben en RESERVAS hasta que
 * el pago esta confirmado: se guardan temporalmente en CacheService (10
 * minutos) asociados a un token unico. Asi el turno solo se ocupa cuando el
 * pago realmente se concreta, y no quedan reservas fantasma si alguien
 * abandona el pago a mitad de camino.
 */

var DEMO_MODE = true; // Cambiar a false cuando se conecte Mercado Pago real.
var PAGO_TOKEN_TTL_SEGUNDOS = 600; // 10 minutos para completar el pago demo.

/**
 * PASO 1: el cliente ya eligio cancha/horario/fecha y completo sus datos.
 * Ahora elige "Seña (30%)" o "Total (100%)". Esta funcion valida todo,
 * calcula el monto a pagar y devuelve un token de pago (no crea la reserva
 * todavia).
 * @param {Object} data { fecha, horarioId, canchaId, nombre, apellido, whatsapp, email, observaciones }
 * @param {String} tipoPago 'SEÑA' | 'TOTAL'
 */
function iniciarPagoReserva(data, tipoPago) {
  validarDatosReserva_(data);
  tipoPago = String(tipoPago || '').toUpperCase();
  if (['SEÑA', 'TOTAL'].indexOf(tipoPago) === -1) {
    throw new Error('Elegi una forma de pago valida.');
  }

  var cancha = buscarFila_('CANCHAS', 'Cancha_ID', data.canchaId);
  if (!cancha || String(cancha.Activa).toUpperCase() !== 'SI') throw new Error('La cancha seleccionada no esta disponible.');
  var horario = buscarFila_('HORARIOS', 'Horario_ID', data.horarioId);
  if (!horario || String(horario.Activo).toUpperCase() !== 'SI') throw new Error('El horario seleccionado no esta disponible.');

  var fechaHoraInicio = combinarFechaHora_(data.fecha, horario.Hora_Inicio);
  validarAnticipacionMinima_(fechaHoraInicio);

  // Chequeo temprano de disponibilidad (el chequeo definitivo ocurre al confirmar el pago, con lock).
  var ocupado = sheetToObjects_('RESERVAS').some(function(r) {
    return formatFecha_(r.Fecha) === data.fecha && r.Horario_ID === data.horarioId &&
      r.Cancha_ID === data.canchaId && ocupaTurno_(r.Estado);
  });
  if (ocupado) throw new Error('Ese turno ya no esta disponible. Elegi otro horario.');

  var config = getConfig();
  var precio = Number(cancha.Precio);
  var porcentajeSeña = Number(config['Porcentaje_Seña']) || 30;
  var monto = tipoPago === 'TOTAL' ? precio : Math.round(precio * porcentajeSeña / 100);

  var token = Utilities.getUuid();
  var payload = {
    data: {
      fecha: data.fecha, horarioId: data.horarioId, canchaId: data.canchaId,
      nombre: sanitizar_(data.nombre), apellido: sanitizar_(data.apellido),
      whatsapp: sanitizar_(data.whatsapp), email: sanitizar_(data.email).toLowerCase(),
      observaciones: sanitizar_(data.observaciones || '')
    },
    tipoPago: tipoPago, monto: monto, precio: precio
  };
  CacheService.getScriptCache().put('PAGO_' + token, JSON.stringify(payload), PAGO_TOKEN_TTL_SEGUNDOS);

  return {
    ok: true,
    modoDemo: DEMO_MODE,
    pagoToken: token,
    monto: monto,
    tipoPago: tipoPago,
    precio: precio,
    resumen: {
      cancha: cancha.Nombre, fecha: data.fecha,
      horaInicio: formatHora_(horario.Hora_Inicio), horaFin: formatHora_(horario.Hora_Fin)
    }
  };
}

/**
 * PASO 2 (modo DEMO): el cliente confirma el pago simulado desde la propia
 * pantalla. Aca es donde se crea la reserva de verdad, ya con el pago
 * registrado, y queda confirmada sin intervencion del administrador.
 *
 * NOTA para integrar Mercado Pago real: esta funcion pasaria a ejecutarse
 * desde un endpoint de webhook (doPost) validando la notificacion de MP en
 * vez de recibir el token directo del navegador.
 */
function confirmarPagoDemo(pagoToken) {
  if (!DEMO_MODE) throw new Error('El modo demo esta desactivado.');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('PAGO_' + pagoToken);
  if (!raw) throw new Error('El pago expiro o ya fue utilizado. Volve a iniciar la reserva.');

  var payload = JSON.parse(raw);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('El sistema esta ocupado, proba de nuevo en unos segundos.');
  try {
    var resultado = crearReservaInterna_(payload.data, {
      monto: payload.monto,
      tipoPago: payload.tipoPago,
      medioPago: 'MERCADO_PAGO_DEMO',
      esOnline: true,
      registradoPor: 'CLIENTE'
    });
    cache.remove('PAGO_' + pagoToken);
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

/** El cliente cancelo el pago demo antes de confirmarlo: solo se descarta el token, nada quedo escrito. */
function cancelarPagoDemo(pagoToken) {
  CacheService.getScriptCache().remove('PAGO_' + pagoToken);
  return { ok: true };
}