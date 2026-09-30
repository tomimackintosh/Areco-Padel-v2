/**
 * CODE.GS
 * Punto de entrada del Web App. Sirve dos experiencias:
 *  - URL_BASE                -> app de reservas para clientes (Index.html)
 *  - URL_BASE?page=admin     -> panel de administración (Admin.html)
 *
 * IMPORTANTE: este script debe estar vinculado (contenedor) a la planilla
 * Areco_Padel para que getDB_() funcione sin configuración adicional.
 */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'cliente';
  var template;

  if (page === 'admin') {
    template = HtmlService.createTemplateFromFile('Admin');
  } else {
    template = HtmlService.createTemplateFromFile('Index');
  }

  var config = getConfig();
  template.nombreClub = config.Nombre_Club || 'Areco Padel';

  return template.evaluate()
    .setTitle((config.Nombre_Club || 'Areco Padel') + (page === 'admin' ? ' | Panel' : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite incluir archivos HTML/CSS/JS parciales dentro de las plantillas. */
function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

/**
 * ===================== API PARA EL FRONT EN NETLIFY =====================
 * El front (cliente y admin) ya no vive dentro de Apps Script: se aloja en
 * Netlify y le habla a este mismo proyecto por HTTP (fetch -> doPost),
 * reemplazando lo que antes era google.script.run. La planilla y toda la
 * lógica de negocio siguen siendo las mismas; sólo cambia el transporte.
 *
 * Lista blanca de funciones invocables desde afuera. Si una función nueva
 * necesita ser llamada desde el front, hay que agregarla acá explícitamente
 * (por seguridad no se permite ejecutar cualquier nombre de función).
 */
var API_FUNCTIONS = {
  // Público / cliente
  obtenerDatosInicialesCliente: obtenerDatosInicialesCliente,
  getDisponibilidad: getDisponibilidad,
  iniciarPagoReserva: iniciarPagoReserva,
  verificarPagoReserva: verificarPagoReserva,
  consultarReservaCliente: consultarReservaCliente,
  cancelarReservaCliente: cancelarReservaCliente,
  listarCanchas: listarCanchas,
  listarHorarios: listarHorarios,
  getConfig: getConfig,
  // Autenticación admin (OTP por email)
  solicitarCodigoAcceso: solicitarCodigoAcceso,
  verificarCodigo: verificarCodigo,
  validarSesionActual: validarSesionActual,
  cerrarSesion: cerrarSesion,
  // Panel admin (cada función valida el token/rol internamente)
  listarUsuarios: listarUsuarios,
  crearUsuario: crearUsuario,
  actualizarUsuario: actualizarUsuario,
  listarClientes: listarClientes,
  actualizarCliente: actualizarCliente,
  historialCliente: historialCliente,
  listarReservas: listarReservas,
  crearReservaAdmin: crearReservaAdmin,
  cancelarReservaAdmin: cancelarReservaAdmin,
  editarReserva: editarReserva,
  registrarPago: registrarPago,
  listarPagosPorReserva: listarPagosPorReserva,
  obtenerCalendarioDia: obtenerCalendarioDia,
  obtenerResumenDashboard: obtenerResumenDashboard,
  actualizarCancha: actualizarCancha,
  actualizarHorario: actualizarHorario,
  actualizarConfig: actualizarConfig
};

/**
 * Único punto de entrada HTTP para el front externo (Netlify).
 * Espera POST con body JSON: { "fn": "nombreFuncion", "args": [ ... ] }
 * y devuelve JSON: { ok:true, result:... } o { ok:false, error:"..." }.
 *
 * Se usa POST con Content-Type "text/plain" desde el cliente (en vez de
 * "application/json") a propósito: así el navegador lo trata como
 * "solicitud simple" y no dispara un preflight OPTIONS, que Apps Script no
 * sabe responder. Google agrega igualmente el header CORS necesario a la
 * respuesta cuando el deployment tiene acceso "Cualquier usuario".
 */
function doPost(e) {
  // Avisos (webhook) de Mercado Pago: llegan a la misma URL /exec con ?mp=1
  // y tienen un formato distinto al {fn, args} de la app.
  if (e && e.parameter && e.parameter.mp === '1') {
    manejarWebhookMercadoPago_(e);
    return ContentService.createTextOutput('OK');
  }

  var respuesta;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Solicitud inválida: falta el cuerpo JSON.');
    }
    var body = JSON.parse(e.postData.contents);
    var fn = API_FUNCTIONS[body.fn];
    if (typeof fn !== 'function') {
      throw new Error('Función no permitida: ' + body.fn);
    }
    var resultado = fn.apply(null, body.args || []);
    respuesta = { ok: true, result: resultado };
  } catch (err) {
    respuesta = { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Datos iniciales públicos que necesita la app de cliente al cargar
 * (no expone nada sensible de administración).
 */
function obtenerDatosInicialesCliente() {
  var config = getConfig();
  return {
    nombreClub: config.Nombre_Club || 'Areco Padel',
    anticipacionMaxDias: Number(config.Anticipacion_Max_Dias) || 14,
    anticipacionMinHoras: Number(config.Anticipacion_Min_Horas) || 24,
    porcentajeSeña: Number(config['Porcentaje_Seña']) || 30,
    moneda: config.Moneda || 'ARS',
    canchas: listarCanchas(true)
  };
}
