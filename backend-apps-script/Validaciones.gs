/**
 * VALIDACIONES.GS
 * Toda validación de negocio importante se hace acá y se ejecuta SIEMPRE
 * en el servidor, sin confiar en las validaciones del cliente (que son
 * sólo para UX).
 */

function validarEmail_(email) {
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === 'string' && re.test(email.trim());
}

function validarTelefono_(tel) {
  var limpio = String(tel).replace(/[^0-9]/g, '');
  return limpio.length >= 8 && limpio.length <= 15;
}

function validarNoVacio_(valor) {
  return valor !== undefined && valor !== null && String(valor).trim().length > 0;
}

function validarFechaFormato_(fechaStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fechaStr) && !isNaN(new Date(fechaStr + 'T00:00:00').getTime());
}

/**
 * Valida los datos que llegan del formulario de reserva (cliente).
 * Lanza un Error con mensaje claro y en español si algo no es válido.
 */
function validarDatosReserva_(data) {
  if (!validarNoVacio_(data.fecha) || !validarFechaFormato_(data.fecha)) {
    throw new Error('La fecha ingresada no es válida.');
  }
  if (!validarNoVacio_(data.horarioId)) throw new Error('Debés seleccionar un horario.');
  if (!validarNoVacio_(data.canchaId)) throw new Error('Debés seleccionar una cancha.');
  if (!validarNoVacio_(data.nombre)) throw new Error('El nombre es obligatorio.');
  if (!validarNoVacio_(data.apellido)) throw new Error('El apellido es obligatorio.');
  if (!validarNoVacio_(data.whatsapp) || !validarTelefono_(data.whatsapp)) {
    throw new Error('El número de WhatsApp ingresado no es válido.');
  }
  if (!validarNoVacio_(data.email) || !validarEmail_(data.email)) {
    throw new Error('El email ingresado no es válido.');
  }

  var config = getConfig();
  var ahora = new Date();
  var fechaReserva = new Date(data.fecha + 'T00:00:00');

  // Anticipación máxima (días)
  var maxDias = Number(config.Anticipacion_Max_Dias) || 14;
  var limiteMax = new Date(ahora.getTime());
  limiteMax.setDate(limiteMax.getDate() + maxDias);
  limiteMax.setHours(23, 59, 59, 999);
  if (fechaReserva > limiteMax) {
    throw new Error('No se pueden realizar reservas con más de ' + maxDias + ' días de anticipación.');
  }

  // No permitir fechas pasadas
  var hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  if (fechaReserva < hoyInicio) {
    throw new Error('No se pueden realizar reservas en fechas pasadas.');
  }
}

/**
 * Valida que falte al menos "Anticipacion_Min_Horas" para el inicio del turno.
 * Se usa tanto al crear como al evaluar si el cliente puede cancelar.
 */
function validarAnticipacionMinima_(fechaHoraInicio) {
  var config = getConfig();
  var minHoras = Number(config.Anticipacion_Min_Horas) || 24;
  var ahora = new Date();
  var diffMs = new Date(fechaHoraInicio).getTime() - ahora.getTime();
  var diffHoras = diffMs / (1000 * 60 * 60);
  if (diffHoras < minHoras) {
    throw new Error('Esta operación requiere al menos ' + minHoras + ' hora(s) de anticipación respecto al horario del turno.');
  }
}

function validarMontoPago_(monto) {
  var n = Number(monto);
  if (isNaN(n) || n <= 0) throw new Error('El monto del pago debe ser un número mayor a 0.');
  return n;
}
