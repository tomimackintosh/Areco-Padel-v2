/**
 * CONFIGSERVICE.GS
 * Lee/escribe la hoja CONFIG (formato clave/valor: Parametro | Valor).
 * Se cachea 5 minutos para no leer la planilla en cada request.
 */

var CONFIG_CACHE_KEY = 'ARECO_CONFIG_V1';
var CONFIG_CACHE_SECONDS = 300;

/**
 * Devuelve un objeto { Parametro: Valor, ... } con toda la configuración.
 */
function getConfig() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* sigue y relee */ }
  }

  var sheet = getSheet_('CONFIG');
  var lastRow = sheet.getLastRow();
  var config = {};
  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      var param = values[i][0];
      var valor = values[i][1];
      if (param === '' || param === null || param === undefined) continue;
      // Las horas de apertura/cierre vienen como objetos Date (solo hora) -> se guardan como HH:mm
      if (valor instanceof Date) {
        valor = Utilities.formatDate(valor, TIMEZONE, 'HH:mm');
      }
      config[param] = valor;
    }
  }
  cache.put(CONFIG_CACHE_KEY, JSON.stringify(config), CONFIG_CACHE_SECONDS);
  return config;
}

/**
 * Actualiza uno o más parámetros de configuración. Sólo ADMIN puede llamar
 * esta función (se valida en el punto de entrada del panel).
 * @param {Object} cambios - { Parametro: nuevoValor, ... }
 */
function actualizarConfig(token, cambios) {
  requireRole_(token, ['ADMIN']);
  var sheet = getSheet_('CONFIG');
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var param in cambios) {
    if (!cambios.hasOwnProperty(param)) continue;
    for (var i = 0; i < values.length; i++) {
      if (values[i][0] === param) {
        sheet.getRange(i + 2, 2).setValue(cambios[param]);
        break;
      }
    }
  }
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  return { ok: true, config: getConfig() };
}
