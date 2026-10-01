/**
 * USUARIOSSERVICE.GS
 * Autenticación del panel admin/recepción mediante código de un solo uso (OTP)
 * enviado por email, sin depender de servicios externos ni de contraseñas
 * guardadas en la planilla (más seguro, y no requiere modificar la
 * estructura de la hoja USUARIOS).
 *
 * Flujo:
 *  1. El usuario ingresa su email -> solicitarCodigoAcceso(email)
 *  2. Se genera un código de 6 dígitos, se guarda en CacheService (5 min) y
 *     se envía por email.
 *  3. El usuario ingresa el código -> verificarCodigo(email, codigo)
 *  4. Si es correcto, se genera un token de sesión (guardado en CacheService,
 *     8 horas) que el cliente guarda y envía en cada llamada del panel admin.
 */

var SESSION_DURATION_SECONDS = 8 * 60 * 60; // 8 horas
var OTP_DURATION_SECONDS = 5 * 60; // 5 minutos
var OTP_MAX_INTENTOS = 5;              // intentos fallidos antes de invalidar el código
var OTP_PEDIDO_COOLDOWN_SECONDS = 45;  // espera mínima entre un pedido de código y el siguiente

function solicitarCodigoAcceso(email) {
  email = sanitizar_(email).toLowerCase();
  if (!validarEmail_(email)) throw new Error('Ingresá un email válido.');

  var cache = CacheService.getScriptCache();

  // Enfriamiento: evita que a alguien le llenen el mail de códigos, o que se
  // gaste de más la cuota diaria de envíos de MailApp.
  if (cache.get('OTP_COOLDOWN_' + email)) {
    throw new Error('Ya te enviamos un código hace muy poco. Esperá unos segundos y volvé a intentar.');
  }

  var usuario = buscarFila_('USUARIOS', 'Email', email) ||
    buscarUsuarioPorEmailInsensible_(email);

  if (!usuario || String(usuario.Activo).toUpperCase() !== 'SI') {
    // No revelamos si el email existe o no, por seguridad, pero igual
    // aplicamos el enfriamiento para no delatar la diferencia por timing.
    cache.put('OTP_COOLDOWN_' + email, '1', OTP_PEDIDO_COOLDOWN_SECONDS);
    return { ok: true, mensaje: 'Si el email corresponde a un usuario activo, recibirás un código por correo.' };
  }

  var codigo = generarCodigo_(6);
  cache.put('OTP_' + email, codigo, OTP_DURATION_SECONDS);
  cache.remove('OTP_INTENTOS_' + email);
  cache.put('OTP_COOLDOWN_' + email, '1', OTP_PEDIDO_COOLDOWN_SECONDS);

  enviarCodigoAcceso_(usuario.Email, usuario.Nombre, codigo);

  return { ok: true, mensaje: 'Te enviamos un código de acceso a tu email.' };
}

function buscarUsuarioPorEmailInsensible_(emailLower) {
  var usuarios = sheetToObjects_('USUARIOS');
  for (var i = 0; i < usuarios.length; i++) {
    if (String(usuarios[i].Email).toLowerCase() === emailLower) return usuarios[i];
  }
  return null;
}

function verificarCodigo(email, codigo) {
  email = sanitizar_(email).toLowerCase();
  codigo = sanitizar_(codigo);
  var cache = CacheService.getScriptCache();
  var esperado = cache.get('OTP_' + email);

  if (!esperado) {
    throw new Error('El código ingresado es incorrecto o expiró. Solicitá uno nuevo.');
  }

  if (esperado !== codigo) {
    var intentosKey = 'OTP_INTENTOS_' + email;
    var intentos = (parseInt(cache.get(intentosKey), 10) || 0) + 1;
    if (intentos >= OTP_MAX_INTENTOS) {
      cache.remove('OTP_' + email);
      cache.remove(intentosKey);
      throw new Error('Superaste la cantidad de intentos permitidos. Solicitá un código nuevo.');
    }
    cache.put(intentosKey, String(intentos), OTP_DURATION_SECONDS);
    throw new Error('El código ingresado es incorrecto. Te quedan ' + (OTP_MAX_INTENTOS - intentos) + ' intentos.');
  }

  cache.remove('OTP_' + email);
  cache.remove('OTP_INTENTOS_' + email);

  var usuario = buscarUsuarioPorEmailInsensible_(email);
  if (!usuario || String(usuario.Activo).toUpperCase() !== 'SI') {
    throw new Error('El usuario no está habilitado.');
  }

  var token = Utilities.getUuid();
  var sesion = {
    usuarioId: usuario.Usuario_ID,
    nombre: usuario.Nombre,
    email: usuario.Email,
    rol: usuario.Rol
  };
  cache.put('SESION_' + token, JSON.stringify(sesion), SESSION_DURATION_SECONDS);

  return { ok: true, token: token, usuario: sesion };
}

/** Devuelve los datos de sesión asociados a un token, o null si no es válido/expiró. */
function obtenerSesion_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('SESION_' + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * Verifica que el token sea válido y que el rol del usuario esté dentro de
 * los roles permitidos. Lanza error si no cumple. Devuelve la sesión.
 */
function requireRole_(token, rolesPermitidos) {
  var sesion = obtenerSesion_(token);
  if (!sesion) throw new Error('Tu sesión expiró. Volvé a iniciar sesión.');
  if (rolesPermitidos && rolesPermitidos.indexOf(sesion.rol) === -1) {
    throw new Error('No tenés permisos para realizar esta acción.');
  }
  return sesion;
}

function cerrarSesion(token) {
  if (token) CacheService.getScriptCache().remove('SESION_' + token);
  return { ok: true };
}

function validarSesionActual(token) {
  var sesion = obtenerSesion_(token);
  if (!sesion) return { ok: false };
  return { ok: true, usuario: sesion };
}

/* ---------------- Gestión de usuarios (sólo ADMIN) ---------------- */

function listarUsuarios(token) {
  requireRole_(token, ['ADMIN']);
  return sheetToObjects_('USUARIOS');
}

function crearUsuario(token, data) {
  requireRole_(token, ['ADMIN']);
  var nombre = sanitizar_(data.nombre);
  var email = sanitizar_(data.email).toLowerCase();
  var rol = sanitizar_(data.rol).toUpperCase();

  if (!validarNoVacio_(nombre)) throw new Error('El nombre es obligatorio.');
  if (!validarEmail_(email)) throw new Error('El email no es válido.');
  if (['ADMIN', 'RECEPCION'].indexOf(rol) === -1) throw new Error('El rol debe ser ADMIN o RECEPCION.');
  if (buscarUsuarioPorEmailInsensible_(email)) throw new Error('Ya existe un usuario con ese email.');

  var id = generarId_('USUARIOS', 'Usuario_ID', 'USR');
  appendRowFromObject_('USUARIOS', {
    Usuario_ID: id, Nombre: nombre, Email: email, Rol: rol, Activo: 'SI'
  });
  return { ok: true, id: id };
}

function actualizarUsuario(token, usuarioId, cambios) {
  requireRole_(token, ['ADMIN']);
  var usuario = buscarFila_('USUARIOS', 'Usuario_ID', usuarioId);
  if (!usuario) throw new Error('Usuario no encontrado.');

  var permitido = {};
  if (cambios.nombre !== undefined) permitido.Nombre = sanitizar_(cambios.nombre);
  if (cambios.rol !== undefined) {
    var rol = sanitizar_(cambios.rol).toUpperCase();
    if (['ADMIN', 'RECEPCION'].indexOf(rol) === -1) throw new Error('Rol inválido.');
    permitido.Rol = rol;
  }
  if (cambios.activo !== undefined) permitido.Activo = cambios.activo ? 'SI' : 'NO';

  updateRowFromObject_('USUARIOS', usuario.__row, permitido);
  return { ok: true };
}
