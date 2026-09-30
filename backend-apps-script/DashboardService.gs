/**
 * DASHBOARDSERVICE.GS
 * Todo el dashboard se resuelve en una sola llamada: obtenerResumenDashboard.
 * El filtro de período (Hoy / 7 días / Mes / Año) controla TODAS las
 * métricas y los gráficos — ya no hay una caja fija de "Hoy" aparte.
 */

function rangoFechasPorPeriodo_(periodo) {
  var hoy = new Date();
  var desde = new Date(hoy);
  var hasta = new Date(hoy);

  if (periodo === 'HOY') {
    // desde = hasta = hoy
  } else if (periodo === '7D') {
    desde.setDate(desde.getDate() - 6);
  } else if (periodo === 'MES') {
    desde.setDate(1);
  } else if (periodo === 'ANIO') {
    desde = new Date(hoy.getFullYear(), 0, 1);
  } else if (periodo === 'MAÑANA') {
    // Períodos "a futuro": ocupación de los próximos turnos, no de los ya jugados.
    desde.setDate(desde.getDate() + 1);
    hasta.setDate(hasta.getDate() + 1);
  } else { // PROX_7D
    hasta.setDate(hasta.getDate() + 6);
  }

  desde.setHours(0, 0, 0, 0);
  hasta.setHours(0, 0, 0, 0);
  return { desde: formatFecha_(desde), hasta: formatFecha_(hasta) };
}

function obtenerResumenDashboard(token, periodo, forzar) {
  requireRole_(token, ['ADMIN', 'RECEPCION']);
  periodo = ['HOY', '7D', 'MES', 'ANIO', 'MAÑANA', 'PROX_7D'].indexOf(periodo) !== -1 ? periodo : 'HOY';

  var cacheKey = 'DASH_' + periodo;
  var cache = CacheService.getScriptCache();
  if (!forzar) {
    var cached = cache.get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (e) { /* sigue y recalcula */ } }
  }

  var todasReservas = sheetToObjects_('RESERVAS');
  var canchas = sheetToObjects_('CANCHAS');
  var canchasActivas = canchas.filter(function(c) { return String(c.Activa).toUpperCase() === 'SI'; });
  var horarios = listarHorarios(true);

  var rango = rangoFechasPorPeriodo_(periodo);
  var enRango = todasReservas.filter(function(r) {
    var f = formatFecha_(r.Fecha);
    return f >= rango.desde && f <= rango.hasta;
  });
  var activasRango = enRango.filter(function(r) { return ocupaTurno_(r.Estado); });

  var ingresosCobrados = activasRango.reduce(function(acc, r) { return acc + (Number(obtenerCampo_(r, 'Seña')) || 0); }, 0);
  var ingresosPendientes = activasRango.reduce(function(acc, r) { return acc + (Number(r.Saldo) || 0); }, 0);
  var ingresosPotenciales = activasRango.reduce(function(acc, r) { return acc + (Number(r.Precio) || 0); }, 0);
  var progresoCobroPorc = ingresosPotenciales > 0 ? Math.round((ingresosCobrados / ingresosPotenciales) * 100) : 0;

  var diasEnRango = Math.max(1, Math.round((new Date(rango.hasta) - new Date(rango.desde)) / 86400000) + 1);
  var turnosPosiblesRango = canchasActivas.length * horarios.length * diasEnRango;
  var ocupacionRango = turnosPosiblesRango > 0 ? Math.round((activasRango.length / turnosPosiblesRango) * 100) : 0;
  var turnosLibres = Math.max(0, turnosPosiblesRango - activasRango.length);

  // Uso por cancha (KPI "cancha mas usada" + grafico de ocupacion por cancha)
  var usoPorCancha = canchasActivas.map(function(c) {
    var reservasCancha = activasRango.filter(function(r) { return r.Cancha_ID === c.Cancha_ID; });
    var posiblesCancha = horarios.length * diasEnRango;
    return {
      cancha: c.Nombre,
      reservas: reservasCancha.length,
      ocupacionPorc: posiblesCancha > 0 ? Math.round((reservasCancha.length / posiblesCancha) * 100) : 0
    };
  }).sort(function(a, b) { return b.reservas - a.reservas; });

  // Horarios mas demandados (KPI + grafico)
  var conteoHorarios = {};
  activasRango.forEach(function(r) {
    var h = horarios.filter(function(x) { return x.horarioId === r.Horario_ID; })[0];
    var label = h ? h.horaInicio : r.Horario_ID;
    conteoHorarios[label] = (conteoHorarios[label] || 0) + 1;
  });
  var horariosOrdenados = Object.keys(conteoHorarios).sort().map(function(k) {
    return { horario: k, reservas: conteoHorarios[k] };
  });
  var horariosDemandados = horariosOrdenados.slice().sort(function(a, b) { return b.reservas - a.reservas; });

  // Reservas por dia (serie temporal para el grafico de lineas)
  var conteoPorDia = {};
  var cursor = new Date(rango.desde + 'T00:00:00');
  var fin = new Date(rango.hasta + 'T00:00:00');
  while (cursor <= fin) {
    conteoPorDia[formatFecha_(cursor)] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  activasRango.forEach(function(r) {
    var f = formatFecha_(r.Fecha);
    if (conteoPorDia[f] !== undefined) conteoPorDia[f]++;
  });
  var fechasOrdenadas = Object.keys(conteoPorDia).sort();

  var resumen = {
    reservas: activasRango.length,
    ocupacionPorc: ocupacionRango,
    turnosLibres: turnosLibres,
    ingresosCobrados: ingresosCobrados,
    ingresosPendientes: ingresosPendientes,
    ingresosPotenciales: ingresosPotenciales,
    progresoCobroPorc: progresoCobroPorc,
    canchaMasUsada: usoPorCancha.length ? usoPorCancha[0].cancha : '-',
    horarioMasDemandado: horariosDemandados.length ? horariosDemandados[0].horario : '-'
  };

  var graficos = {
    reservasPorDia: {
      etiquetas: fechasOrdenadas.map(function(f) { return formatFechaLegible_(new Date(f + 'T00:00:00')); }),
      valores: fechasOrdenadas.map(function(f) { return conteoPorDia[f]; })
    },
    ocupacionPorCancha: {
      etiquetas: usoPorCancha.map(function(u) { return u.cancha; }),
      valores: usoPorCancha.map(function(u) { return u.ocupacionPorc; })
    },
    reservasPorHorario: {
      etiquetas: horariosOrdenados.map(function(h) { return h.horario; }),
      valores: horariosOrdenados.map(function(h) { return h.reservas; })
    },
    ocupacionDonut: {
      ocupados: activasRango.length,
      disponibles: turnosLibres
    }
  };

  var salida = { periodo: periodo, resumen: resumen, graficos: graficos };
  cache.put(cacheKey, JSON.stringify(salida), DASHBOARD_CACHE_SECONDS);
  return salida;
}
