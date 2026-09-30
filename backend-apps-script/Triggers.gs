/**
 * TRIGGERS.GS
 * InstalaciÃ³n del trigger de tiempo que dispara el envÃ­o automÃ¡tico de
 * recordatorios. Ejecutar UNA VEZ manualmente la funciÃ³n
 * instalarTriggerRecordatorios() desde el editor de Apps Script despuÃ©s de
 * desplegar el sistema (ver instrucciones de instalaciÃ³n).
 */

function instalarTriggerRecordatorios() {
  // Evita duplicar el trigger si ya existe.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'procesarRecordatoriosPendientes') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('procesarRecordatoriosPendientes')
    .timeBased()
    .everyHours(1)
    .create();

  return 'Trigger instalado correctamente: se ejecutarÃ¡ cada 1 hora.';
}

function eliminarTriggerRecordatorios() {
  var triggers = ScriptApp.getProjectTriggers();
  var eliminados = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'procesarRecordatoriosPendientes') {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  });
  return eliminados + ' trigger(s) eliminado(s).';
}
