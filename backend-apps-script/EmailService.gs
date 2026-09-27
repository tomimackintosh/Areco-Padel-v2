/**
 * EMAILSERVICE.GS
 * Todo el envío de emails pasa por acá (MailApp, sin servicios externos).
 * También gestiona la hoja RECORDATORIOS (programación y envío).
 */

function remitente_() {
  var config = getConfig();
  return config.Email_Remite || config.Nombre_Club || 'Areco Padel';
}

function wrapHtml_(tituloInterno, contenidoHtml) {
  var config = getConfig();
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#0f0f10;padding:32px;">' +
      '<div style="max-width:520px;margin:0 auto;background:#18181a;border:1px solid #2a2a2c;border-radius:16px;overflow:hidden;">' +
        '<div style="background:#111;padding:24px 28px;border-bottom:3px solid #CCFF00;">' +
          '<h1 style="margin:0;color:#CCFF00;font-size:20px;letter-spacing:0.5px;">' + (config.Nombre_Club || 'Areco Padel') + '</h1>' +
        '</div>' +
        '<div style="padding:28px;color:#eaeaea;">' +
          '<h2 style="margin-top:0;color:#fff;font-size:17px;">' + tituloInterno + '</h2>' +
          contenidoHtml +
        '</div>' +
        '<div style="padding:16px 28px;background:#111;color:#888;font-size:12px;">' +
          'Este es un email automático de ' + (config.Nombre_Club || 'Areco Padel') + '. No respondas a este mensaje.' +
        '</div>' +
      '</div>' +
    '</div>';
}

function filaDato_(etiqueta, valor) {
  return '<tr>' +
    '<td style="padding:6px 0;color:#999;font-size:13px;">' + etiqueta + '</td>' +
    '<td style="padding:6px 0;color:#fff;font-size:13px;font-weight:bold;text-align:right;">' + valor + '</td>' +
    '</tr>';
}

function enviarConfirmacionReserva_(reserva, cliente) {
  try {
    var contenido = '<p>Hola ' + sanitizar_(cliente.nombre) + ', tu reserva fue registrada con éxito.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px;">' +
      filaDato_('Código de reserva', reserva.reservaId) +
      filaDato_('Cancha', reserva.cancha) +
      filaDato_('Fecha', formatFechaLegible_(new Date(reserva.fecha + 'T00:00:00'))) +
      filaDato_('Horario', reserva.horaInicio + ' - ' + reserva.horaFin) +
      filaDato_('Precio total', formatMoneda_(reserva.precio)) +
      filaDato_('Pagado', formatMoneda_(reserva.pagado || 0)) +
      filaDato_('Saldo pendiente', formatMoneda_(reserva.saldo)) +
      filaDato_('Estado', reserva.estado) +
      '</table>' +
      '<p style="margin-top:16px;color:#bbb;font-size:13px;">Guardá el código de reserva: lo vas a necesitar si querés consultarla o cancelarla.</p>';

    MailApp.sendEmail({
      to: cliente.email,
      subject: 'Confirmación de tu reserva - ' + reserva.reservaId,
      htmlBody: wrapHtml_('¡Reserva confirmada!', contenido),
      name: remitente_()
    });
  } catch (e) {
    // No interrumpe la reserva si el email falla; queda registrado en logs.
    console.error('Error enviando email de confirmación: ' + e.message);
  }
}

function enviarCancelacion_(reserva, cliente) {
  try {
    var contenido = '<p>Hola ' + sanitizar_(cliente.Nombre) + ', tu reserva fue cancelada.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px;">' +
      filaDato_('Código de reserva', reserva.Reserva_ID) +
      filaDato_('Fecha', formatFechaLegible_(reserva.Fecha)) +
      '</table>' +
      '<p style="margin-top:16px;color:#bbb;font-size:13px;">Si fue un error, podés hacer una nueva reserva desde nuestra web.</p>';

    MailApp.sendEmail({
      to: cliente.Email,
      subject: 'Reserva cancelada - ' + reserva.Reserva_ID,
      htmlBody: wrapHtml_('Reserva cancelada', contenido),
      name: remitente_()
    });
  } catch (e) {
    console.error('Error enviando email de cancelación: ' + e.message);
  }
}

function enviarCodigoAcceso_(email, nombre, codigo) {
  var contenido = '<p>Hola ' + sanitizar_(nombre) + ', tu código de acceso al panel es:</p>' +
    '<p style="font-size:32px;font-weight:bold;color:#CCFF00;letter-spacing:6px;text-align:center;margin:24px 0;">' + codigo + '</p>' +
    '<p style="color:#bbb;font-size:13px;">Este código vence en 5 minutos. Si no lo solicitaste, ignorá este email.</p>';

  MailApp.sendEmail({
    to: email,
    subject: 'Tu código de acceso - ' + (getConfig().Nombre_Club || 'Areco Padel'),
    htmlBody: wrapHtml_('Código de acceso', contenido),
    name: remitente_()
  });
}

function enviarRecordatorio_(reserva, cancha, horario, email) {
  try {
    var contenido = '<p>¡Te esperamos! Recordá tu turno de mañana:</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px;">' +
      filaDato_('Código de reserva', reserva.Reserva_ID) +
      filaDato_('Cancha', cancha ? cancha.Nombre : reserva.Cancha_ID) +
      filaDato_('Fecha', formatFechaLegible_(reserva.Fecha)) +
      filaDato_('Horario', horario ? (formatHora_(horario.Hora_Inicio) + ' - ' + formatHora_(horario.Hora_Fin)) : '') +
      '</table>';

    MailApp.sendEmail({
      to: email,
      subject: 'Recordatorio de tu turno - ' + reserva.Reserva_ID,
      htmlBody: wrapHtml_('Recordatorio de turno', contenido),
      name: remitente_()
    });
    return true;
  } catch (e) {
    console.error('Error enviando recordatorio: ' + e.message);
    return false;
  }
}

/* ---------------- Gestión de la hoja RECORDATORIOS ---------------- */

function programarRecordatorio_(reservaId, fechaHoraInicio, email) {
  var config = getConfig();
  var horasAntes = Number(config.Recordatorio_Email_Horas) || 24;
  var fechaProgramada = new Date(fechaHoraInicio.getTime() - horasAntes * 60 * 60 * 1000);

  // Si la fecha programada ya pasó (turno muy próximo), no se agenda recordatorio.
  if (fechaProgramada <= new Date()) return;

  var id = generarId_('RECORDATORIOS', 'Recordatorio_ID', 'REC');
  appendRowFromObject_('RECORDATORIOS', {
    Recordatorio_ID: id,
    Reserva_ID: reservaId,
    Tipo: '24H',
    Fecha_Programada: fechaProgramada,
    Email: email,
    Estado: 'PENDIENTE',
    Fecha_Envio: ''
  });
}

function cancelarRecordatoriosPendientes_(reservaId) {
  var sheet = getSheet_('RECORDATORIOS');
  var recordatorios = sheetToObjects_('RECORDATORIOS').filter(function(r) {
    return r.Reserva_ID === reservaId && String(r.Estado).toUpperCase() === 'PENDIENTE';
  });
  recordatorios.forEach(function(r) {
    updateRowFromObject_('RECORDATORIOS', r.__row, { Estado: 'CANCELADO' });
  });
}

/**
 * Se ejecuta periódicamente (trigger instalable, ver Triggers.gs). Envía
 * todos los recordatorios PENDIENTES cuya Fecha_Programada ya llegó.
 */
function procesarRecordatoriosPendientes() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) return;
  try {
    var ahora = new Date();
    var recordatorios = sheetToObjects_('RECORDATORIOS').filter(function(r) {
      return String(r.Estado).toUpperCase() === 'PENDIENTE' && new Date(r.Fecha_Programada) <= ahora;
    });
    if (recordatorios.length === 0) return;

    var canchas = sheetToObjects_('CANCHAS');
    var horarios = sheetToObjects_('HORARIOS');

    recordatorios.forEach(function(rec) {
      var reserva = buscarFila_('RESERVAS', 'Reserva_ID', rec.Reserva_ID);
      if (!reserva || String(reserva.Estado).toUpperCase() === 'CANCELADA') {
        updateRowFromObject_('RECORDATORIOS', rec.__row, { Estado: 'CANCELADO' });
        return;
      }
      var cancha = canchas.filter(function(c) { return c.Cancha_ID === reserva.Cancha_ID; })[0];
      var horario = horarios.filter(function(h) { return h.Horario_ID === reserva.Horario_ID; })[0];
      var enviado = enviarRecordatorio_(reserva, cancha, horario, rec.Email);
      updateRowFromObject_('RECORDATORIOS', rec.__row, {
        Estado: enviado ? 'ENVIADO' : 'ERROR',
        Fecha_Envio: enviado ? new Date() : ''
      });
    });
  } finally {
    lock.releaseLock();
  }
}