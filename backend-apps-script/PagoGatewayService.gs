/**
 * PAGOGATEWAYSERVICE.GS  (VERSIÓN MERCADO PAGO - CHECKOUT PRO)
 *
 * Flujo real de pago para la reserva ONLINE:
 *
 *  1. El cliente elige cancha/horario, completa sus datos y elige "Seña" o
 *     "Total" -> el front llama iniciarPagoReserva(). Acá se valida todo, se
 *     guarda la reserva "en curso" en CacheService bajo un token único y se
 *     crea una PREFERENCIA en Mercado Pago. Se devuelve la URL de pago
 *     (urlPago) y el front redirige al cliente a Mercado Pago.
 *
 *  2. El cliente paga en Mercado Pago y vuelve a Netlify con ?pago=...&t=TOKEN.
 *
 *  3. La reserva se crea recién cuando el pago figura APROBADO en Mercado
 *     Pago. Hay dos caminos, ambos idempotentes (si ocurren los dos, la
 *     reserva se crea una sola vez):
 *       a) El front, al volver, llama verificarPagoReserva(token), que le
 *          pregunta a Mercado Pago por el estado real del pago.
 *       b) Mercado Pago avisa por webhook (doPost con ?mp=1), por si el
 *          cliente cerró el navegador antes de volver.
 *
 * SEGURIDAD: nunca se confía en lo que dice el aviso del webhook ni en lo que
 * manda el navegador. Siempre se consulta el pago directo a la API de Mercado
 * Pago con el Access Token, y se verifica que el monto coincida con el
 * esperado. (Apps Script no expone los headers de la request, por eso no se
 * puede validar la firma x-signature; la consulta directa a la API cumple esa
 * función.)
 *
 * CONFIGURACIÓN (Propiedades del script, NO en el código):
 *   MP_ACCESS_TOKEN -> Access Token de Mercado Pago (prueba o producción)
 *   FRONTEND_URL    -> URL del sitio en Netlify, ej: https://tu-sitio.netlify.app
 */

var MP_API = 'https://api.mercadopago.com';
var PAGO_TOKEN_TTL_SEGUNDOS = 3600;        // 1 hora para completar el pago
var PAGO_RESULTADO_TTL_SEGUNDOS = 21600;   // 6 horas (máximo de CacheService)
var PREFERENCIA_VENCE_MINUTOS = 30;        // el link de pago vence a los 30 min

/* ---------------- Utilidades internas ---------------- */

function mpPropiedad_(clave) {
  return PropertiesService.getScriptProperties().getProperty(clave);
}

function mpAccessToken_() {
  var t = mpPropiedad_('MP_ACCESS_TOKEN');
  if (!t) throw new Error('Falta configurar MP_ACCESS_TOKEN en las Propiedades del script.');
  return t;
}

function frontendUrl_() {
  var u = mpPropiedad_('FRONTEND_URL');
  if (!u) throw new Error('Falta configurar FRONTEND_URL en las Propiedades del script.');
  return String(u).replace(/\/+$/, '');
}

/** Llama a la API de Mercado Pago. metodo: 'get' | 'post'. */
function mpFetch_(metodo, path, body) {
  var opciones = {
    method: metodo,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + mpAccessToken_() }
  };
  if (body) {
    opciones.contentType = 'application/json';
    opciones.payload = JSON.stringify(body);
  }
  var resp = UrlFetchApp.fetch(MP_API + path, opciones);
  var codigo = resp.getResponseCode();
  var texto = resp.getContentText() || '{}';
  var json;
  try { json = JSON.parse(texto); } catch (e) { json = { raw: texto }; }
  if (codigo < 200 || codigo >= 300) {
    console.error('Mercado Pago ' + metodo + ' ' + path + ' -> ' + codigo + ': ' + texto);
    throw new Error('Mercado Pago respondió con error ' + codigo + '. Probá de nuevo en unos minutos.');
  }
  return json;
}

function fechaIsoConOffset_(fecha) {
  return Utilities.formatDate(fecha, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
}

/* ---------------- PASO 1: iniciar el pago ---------------- */

/**
 * @param {Object} data { fecha, horarioId, canchaId, nombre, apellido, whatsapp, email, observaciones }
 * @param {String} tipoPago 'SEÑA' | 'TOTAL'
 * @return {Object} { ok, pagoToken, urlPago, monto, tipoPago, precio, resumen }
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

  // Chequeo temprano de disponibilidad (el definitivo ocurre al confirmar el pago, con lock).
  var ocupado = sheetToObjects_('RESERVAS').some(function(r) {
    return formatFecha_(r.Fecha) === data.fecha && r.Horario_ID === data.horarioId &&
      r.Cancha_ID === data.canchaId && ocupaTurno_(r.Estado);
  });
  if (ocupado) throw new Error('Ese turno ya no esta disponible. Elegi otro horario.');

  var config = getConfig();
  var precio = Number(cancha.Precio);
  var porcentajeSeña = Number(config['Porcentaje_Seña']) || 30;
  var monto = tipoPago === 'TOTAL' ? precio : Math.round(precio * porcentajeSeña / 100);
  if (!(monto > 0)) throw new Error('El monto a pagar no es valido. Contacta al club.');

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

  var horaInicio = formatHora_(horario.Hora_Inicio);
  var horaFin = formatHora_(horario.Hora_Fin);
  var base = frontendUrl_();
  var ahora = new Date();
  var vence = new Date(ahora.getTime() + PREFERENCIA_VENCE_MINUTOS * 60 * 1000);

  var preferencia = mpFetch_('post', '/checkout/preferences', {
    items: [{
      id: String(data.canchaId) + '-' + String(data.horarioId),
      title: 'Reserva ' + cancha.Nombre + ' - ' + data.fecha + ' ' + horaInicio +
        (tipoPago === 'TOTAL' ? ' (pago total)' : ' (seña)'),
      quantity: 1,
      unit_price: monto,
      currency_id: config.Moneda || 'ARS'
    }],
    payer: {
      name: payload.data.nombre,
      surname: payload.data.apellido,
      email: payload.data.email
    },
    external_reference: token,
    back_urls: {
      success: base + '/?pago=ok&t=' + token,
      failure: base + '/?pago=error&t=' + token,
      pending: base + '/?pago=pendiente&t=' + token
    },
    auto_return: 'approved',
    notification_url: ScriptApp.getService().getUrl() + '?mp=1',
    expires: true,
    expiration_date_from: fechaIsoConOffset_(ahora),
    expiration_date_to: fechaIsoConOffset_(vence),
    // Sólo medios de pago que acreditan al instante (excluye Rapipago/Pago Fácil y cajeros),
    // así el turno no queda "colgado" esperando una acreditación de días.
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] }
  });

  if (!preferencia.init_point) throw new Error('No se pudo generar el link de pago. Probá de nuevo.');

  return {
    ok: true,
    pagoToken: token,
    urlPago: preferencia.init_point,
    monto: monto,
    tipoPago: tipoPago,
    precio: precio,
    resumen: { cancha: cancha.Nombre, fecha: data.fecha, horaInicio: horaInicio, horaFin: horaFin }
  };
}

/* ---------------- PASO 2a: el cliente vuelve del checkout ---------------- */

/**
 * Lo llama el front al volver de Mercado Pago (y reintenta hasta que
 * confirme). Devuelve { estado: 'CONFIRMADO', reserva } | 'PENDIENTE' |
 * 'EXPIRADO' | 'CONFLICTO'.
 */
function verificarPagoReserva(pagoToken) {
  pagoToken = String(pagoToken || '');
  if (!pagoToken) throw new Error('Falta el codigo de pago.');

  var cache = CacheService.getScriptCache();
  var hecho = cache.get('PAGORES_' + pagoToken);
  if (hecho) return JSON.parse(hecho);
  if (!cache.get('PAGO_' + pagoToken)) return { estado: 'EXPIRADO' };

  var busqueda = mpFetch_('get', '/v1/payments/search?sort=date_created&criteria=desc&limit=10&external_reference=' +
    encodeURIComponent(pagoToken));
  var aprobado = null;
  (busqueda.results || []).forEach(function(p) {
    if (!aprobado && p.status === 'approved') aprobado = p;
  });
  if (!aprobado) return { estado: 'PENDIENTE' };

  return confirmarPagoMP_(pagoToken, aprobado);
}

/* ---------------- PASO 2b: aviso (webhook) de Mercado Pago ---------------- */

/**
 * Se llama desde doPost cuando la URL trae ?mp=1. Siempre termina sin lanzar
 * error: Mercado Pago sólo necesita recibir una respuesta.
 */
function manejarWebhookMercadoPago_(e) {
  try {
    var params = (e && e.parameter) || {};
    var tipo = params.type || params.topic || '';
    var idPago = params['data.id'] || params.id || '';

    if (e && e.postData && e.postData.contents) {
      try {
        var body = JSON.parse(e.postData.contents);
        if (body && body.type) tipo = body.type;
        if (body && body.data && body.data.id) idPago = body.data.id;
      } catch (err) { /* cuerpo no JSON: se usan los parámetros de la URL */ }
    }

    if (tipo && tipo !== 'payment') return;
    if (!idPago) return;

    // Se consulta el pago real a Mercado Pago; nunca se confía en el aviso.
    var pago = mpFetch_('get', '/v1/payments/' + encodeURIComponent(idPago));
    if (pago.status === 'approved' && pago.external_reference) {
      confirmarPagoMP_(String(pago.external_reference), pago);
    }
  } catch (err) {
    console.error('Webhook Mercado Pago: ' + (err && err.message ? err.message : err));
  }
}

/* ---------------- Creación (idempotente) de la reserva ---------------- */

function confirmarPagoMP_(pagoToken, pago) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw new Error('El sistema esta ocupado, proba de nuevo en unos segundos.');
  try {
    var cache = CacheService.getScriptCache();

    var hecho = cache.get('PAGORES_' + pagoToken);
    if (hecho) return JSON.parse(hecho);   // ya procesado (webhook + vuelta del cliente)

    var raw = cache.get('PAGO_' + pagoToken);
    if (!raw) return { estado: 'EXPIRADO' };
    var payload = JSON.parse(raw);

    if (pago.status !== 'approved') return { estado: 'PENDIENTE' };
    if (String(pago.external_reference) !== pagoToken) {
      console.error('external_reference no coincide: ' + pago.external_reference + ' vs ' + pagoToken);
      return { estado: 'PENDIENTE' };
    }
    if (Math.abs(Number(pago.transaction_amount) - Number(payload.monto)) > 0.01) {
      console.error('Monto no coincide. MP: ' + pago.transaction_amount + ' esperado: ' + payload.monto);
      return { estado: 'PENDIENTE' };
    }

    var salida;
    try {
      var resultado = crearReservaInterna_(payload.data, {
        monto: payload.monto,
        tipoPago: payload.tipoPago,
        medioPago: 'MERCADO_PAGO',
        esOnline: true,
        registradoPor: 'CLIENTE',
        notaPago: 'Pago online Mercado Pago #' + pago.id
      });
      salida = { estado: 'CONFIRMADO', reserva: resultado.reserva };
    } catch (err) {
      // El pago está aprobado pero el turno ya no se pudo reservar (p. ej. lo ocuparon
      // mientras el cliente pagaba). Requiere devolución manual desde Mercado Pago.
      salida = { estado: 'CONFLICTO', mensaje: err.message, mpPagoId: pago.id };
      avisarConflictoPago_(payload, pago, err.message);
    }

    cache.put('PAGORES_' + pagoToken, JSON.stringify(salida), PAGO_RESULTADO_TTL_SEGUNDOS);
    cache.remove('PAGO_' + pagoToken);
    return salida;
  } finally {
    lock.releaseLock();
  }
}

/** Avisa al club por email cuando hay un pago aprobado sin turno asociado. */
function avisarConflictoPago_(payload, pago, motivo) {
  try {
    var config = getConfig();
    var destino = config.Email_Club;
    console.error('PAGO SIN TURNO. MP #' + pago.id + ' - ' + motivo);
    if (!destino) return;
    MailApp.sendEmail({
      to: destino,
      subject: 'Pago aprobado sin turno asignado (Mercado Pago #' + pago.id + ')',
      body: 'Se aprobó un pago en Mercado Pago pero el turno ya no estaba disponible.\n\n' +
        'Pago Mercado Pago: #' + pago.id + '\nMonto: ' + pago.transaction_amount + '\n' +
        'Cliente: ' + payload.data.nombre + ' ' + payload.data.apellido + '\n' +
        'Email: ' + payload.data.email + '\nWhatsApp: ' + payload.data.whatsapp + '\n' +
        'Turno pedido: ' + payload.data.fecha + ' (horario ' + payload.data.horarioId + ', cancha ' + payload.data.canchaId + ')\n' +
        'Motivo: ' + motivo + '\n\n' +
        'Hay que devolverle el dinero desde el panel de Mercado Pago o reubicar al cliente.'
    });
  } catch (e) {
    console.error('No se pudo enviar el aviso de conflicto: ' + e.message);
  }
}

/* ---------------- Prueba de conexión (ejecutar a mano desde el editor) ---------------- */

/**
 * Ejecutá esta función UNA VEZ desde el editor de Apps Script. Sirve para
 * (1) autorizar el permiso de conexión externa y (2) verificar que el
 * Access Token cargado funciona. Mirá el resultado en Ver > Registros.
 */
function probarConexionMercadoPago() {
  var yo = mpFetch_('get', '/users/me');
  Logger.log('Conexión OK. Cuenta: ' + yo.id + ' | País: ' + yo.site_id);
  Logger.log('Front configurado: ' + frontendUrl_());
  return 'OK';
}
