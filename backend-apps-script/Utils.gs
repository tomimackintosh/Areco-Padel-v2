/**
 * UTILS.GS
 * Funciones utilitarias generales usadas por todos los servicios.
 * No contienen lógica de negocio.
 */

var TIMEZONE = Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires';

/**
 * Devuelve la spreadsheet activa (el script debe estar contenedor-vinculado
 * a la planilla Areco_Padel). Si en el futuro se usa como script standalone,
 * reemplazar por SpreadsheetApp.openById(SPREADSHEET_ID).
 */
function getDB_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Devuelve una hoja por nombre y lanza error claro si no existe.
 */
function getSheet_(nombre) {
  var ss = getDB_();
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    throw new Error('No se encontró la hoja "' + nombre + '" en la planilla. Verificá la estructura del archivo.');
  }
  return sheet;
}

/**
 * Convierte todas las filas de una hoja (a partir de la fila de encabezados)
 * en un array de objetos { columna: valor }. Ignora filas completamente vacías
 * (columna A vacía), lo que permite hojas con filas en blanco al final (como CONFIG).
 */
function sheetToObjects_(nombreHoja) {
  var sheet = getSheet_(nombreHoja);
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row[0] === '' || row[0] === null) continue; // fila vacía -> se ignora
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj.__row = i + 1; // fila real en la hoja (1-indexed), útil para updates
    out.push(obj);
  }
  return out;
}

/**
 * Devuelve el índice de columna (0-based) de un encabezado dado.
 */
function getColIndex_(nombreHoja, nombreColumna) {
  var sheet = getSheet_(nombreHoja);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf(nombreColumna);
  if (idx === -1) {
    throw new Error('La hoja "' + nombreHoja + '" no tiene una columna "' + nombreColumna + '".');
  }
  return idx;
}

/**
 * Genera el próximo ID incremental para una hoja, respetando el prefijo y el
 * ancho de padding usados en los datos existentes (ej: RES001, RES002...).
 */
function generarId_(nombreHoja, columnaId, prefijo) {
  var sheet = getSheet_(nombreHoja);
  var lastRow = sheet.getLastRow();
  var idxCol = getColIndex_(nombreHoja, columnaId);
  var maxNum = 0;
  var padWidth = 3;
  if (lastRow > 1) {
    var ids = sheet.getRange(2, idxCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var val = ids[i][0];
      if (!val) continue;
      var str = String(val);
      if (str.indexOf(prefijo) === 0) {
        var numPart = str.substring(prefijo.length);
        padWidth = Math.max(padWidth, numPart.length);
        var num = parseInt(numPart, 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  }
  var next = maxNum + 1;
  var nextStr = String(next);
  while (nextStr.length < padWidth) nextStr = '0' + nextStr;
  return prefijo + nextStr;
}

/**
 * Agrega una fila a una hoja a partir de un objeto, respetando el orden de
 * las columnas existentes en el encabezado.
 */
function appendRowFromObject_(nombreHoja, obj) {
  var sheet = getSheet_(nombreHoja);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) {
    return (obj[h] !== undefined && obj[h] !== null) ? obj[h] : '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/**
 * Actualiza celdas puntuales de una fila ya existente (1-indexed), a partir
 * de un objeto parcial { columna: valor }.
 */
/** Compara dos nombres de columna ignorando mayúsculas/espacios y normalizando acentos Unicode. */
function encabezadosIguales_(a, b) {
  var norm = function(s) { return String(s).normalize('NFC').trim().toLowerCase(); };
  return norm(a) === norm(b);
}

/** Lee un campo de un objeto (fila) buscando la clave de forma flexible (por si el
 * encabezado real de la hoja difiere levemente en mayúsculas/acentos/espacios). */
function obtenerCampo_(obj, nombreBuscado) {
  if (obj[nombreBuscado] !== undefined) return obj[nombreBuscado];
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && encabezadosIguales_(key, nombreBuscado)) return obj[key];
  }
  return undefined;
}

function updateRowFromObject_(nombreHoja, filaNum, camposParciales) {
  var sheet = getSheet_(nombreHoja);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var campo in camposParciales) {
    if (!camposParciales.hasOwnProperty(campo)) continue;
    var idx = -1;
    for (var i = 0; i < headers.length; i++) {
      if (encabezadosIguales_(headers[i], campo)) { idx = i; break; }
    }
    if (idx === -1) continue;
    sheet.getRange(filaNum, idx + 1).setValue(camposParciales[campo]);
  }
}

/**
 * Busca la primera fila (objeto) donde columna === valor. Devuelve null si no existe.
 */
function buscarFila_(nombreHoja, columna, valor) {
  var rows = sheetToObjects_(nombreHoja);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][columna]) === String(valor)) return rows[i];
  }
  return null;
}

/** Formatea una fecha (Date) como yyyy-MM-dd usando la zona horaria del script. */
function formatFecha_(fecha) {
  return Utilities.formatDate(new Date(fecha), TIMEZONE, 'yyyy-MM-dd');
}

/** Formatea una fecha (Date) como dd/MM/yyyy para mostrar al usuario. */
function formatFechaLegible_(fecha) {
  return Utilities.formatDate(new Date(fecha), TIMEZONE, 'dd/MM/yyyy');
}

/** Formatea un objeto Date "de hora" (los de HORARIOS) como HH:mm. */
function formatHora_(horaDate) {
  return Utilities.formatDate(new Date(horaDate), TIMEZONE, 'HH:mm');
}

/** Combina una fecha (yyyy-MM-dd) con una hora (Date con hora/min) en un único Date. */
function combinarFechaHora_(fechaStr, horaDate) {
  var partes = fechaStr.split('-');
  var h = new Date(horaDate);
  return new Date(
    parseInt(partes[0], 10),
    parseInt(partes[1], 10) - 1,
    parseInt(partes[2], 10),
    h.getHours(),
    h.getMinutes(),
    0
  );
}

/** Formatea un número como moneda simple (ej: $ 18.000). */
function formatMoneda_(numero) {
  var n = Number(numero) || 0;
  var partes = n.toFixed(0).split('').reverse().join('').match(/.{1,3}/g).join('.').split('').reverse().join('');
  return '$ ' + partes;
}

/** Genera un código numérico aleatorio de N dígitos (para OTP de login admin). */
function generarCodigo_(digitos) {
  var min = Math.pow(10, digitos - 1);
  var max = Math.pow(10, digitos) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

/** Clasifica una hora "HH:mm" en mañana (antes de 13), tarde (13-19) o noche (después de 19). */
function obtenerFranjaHoraria_(horaStr) {
  var h = parseInt(String(horaStr).split(':')[0], 10);
  if (h < 13) return 'mañana';
  if (h < 19) return 'tarde';
  return 'noche';
}

/** Sanitiza un string simple (trim + elimina < > para evitar HTML injection). */
function sanitizar_(texto) {
  if (texto === undefined || texto === null) return '';
  return String(texto).trim().replace(/[<>]/g, '');
}