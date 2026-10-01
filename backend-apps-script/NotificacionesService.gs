/**
 * NOTIFICACIONESSERVICE.GS
 * Avisa al celular del admin (vía OneSignal, notificación push web) cuando
 * un cliente reserva o cancela un turno. No se usa para nada más: las
 * acciones que el propio admin hace desde el panel no se notifican a sí
 * mismo.
 *
 * CONFIGURACIÓN (Propiedades del script, NO en el código):
 *   ONESIGNAL_APP_ID               -> App ID de OneSignal (no es secreto)
 *   ONESIGNAL_API_KEY               -> REST API Key de OneSignal (sí es secreto)
 *   ONESIGNAL_ADMIN_SUBSCRIPTION_ID -> Subscription ID del celular del admin
 *                                      (se obtiene una vez desde el panel,
 *                                      después de aceptar las notificaciones)
 *
 * Si falta alguna de las tres, o si OneSignal responde con error, la
 * notificación simplemente no sale — nunca rompe la reserva ni la
 * cancelación que la dispara.
 */

function enviarNotificacionAdmin_(titulo, mensaje, url) {
  try {
    var props = PropertiesService.getScriptProperties();
    var appId = props.getProperty('ONESIGNAL_APP_ID');
    var apiKey = props.getProperty('ONESIGNAL_API_KEY');
    var subscriptionId = props.getProperty('ONESIGNAL_ADMIN_SUBSCRIPTION_ID');

    if (!appId || !apiKey || !subscriptionId) {
      console.log('Notificaciones push no configuradas todavía (falta appId/apiKey/subscriptionId); se omite el envío.');
      return;
    }

    var payload = {
      app_id: appId,
      headings: { en: titulo },
      contents: { en: mensaje },
      include_subscription_ids: [subscriptionId],
      url: url || (mpPropiedad_('FRONTEND_URL') ? mpPropiedad_('FRONTEND_URL').replace(/\/+$/, '') + '/admin/' : undefined)
    };

    var resp = UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Key ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var codigo = resp.getResponseCode();
    if (codigo < 200 || codigo >= 300) {
      console.error('OneSignal respondió ' + codigo + ': ' + resp.getContentText());
    }
  } catch (err) {
    // Una notificación que falla nunca debe tirar abajo la reserva/cancelación.
    console.error('Error enviando notificación push: ' + (err && err.message ? err.message : err));
  }
}
