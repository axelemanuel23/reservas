import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// =========================================================
// CATÁLOGO FIJO DE CASILLAS
// =========================================================

const BOOTH_CATALOG = {
  entrada: 16,
  salida: 11,
};

const SECTOR_LABEL = {
  entrada: "Entrada",
  salida: "Salida",
};

function boothKey(booth) {
  return `${booth.sector}-${booth.numero}`;
}

function boothLabel(booth) {
  return `${SECTOR_LABEL[booth.sector]} ${booth.numero}`;
}

function boothAbbrev(boothText) {
  return boothText.replace("Entrada ", "E").replace("Salida ", "S");
}

function minutesToShortTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

// =========================================================
// SESGO DE ASIGNACIÓN POR SECTOR
// =========================================================

function sortBoothsForAssignment(booths) {
  const entrada = booths
    .filter((b) => b.sector === "entrada")
    .sort((a, b) => b.numero - a.numero);

  const salida = booths
    .filter((b) => b.sector === "salida")
    .sort((a, b) => a.numero - b.numero);

  return [...entrada, ...salida];
}

// =========================================================
// DATOS INICIALES
// =========================================================

const INITIAL_AGENTS = [{ id: 1, name: "", workedMinutes: 0 }];

const INITIAL_DEMAND = [
  { id: 1, start: "00:00", end: "01:00", booths: [] },
  { id: 2, start: "01:00", end: "05:00", booths: [] },
  { id: 3, start: "05:00", end: "06:00", booths: [] },
];

const STORAGE_KEYS = {
  agents: "guardia-nocturna-agents",
  demand: "guardia-nocturna-demand",
};

// =========================================================
// UTILIDADES
// =========================================================

function createUid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeWorkedMinutes(value) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes)) {
    return 0;
  }

  return Math.max(0, Math.floor(minutes));
}

function normalizeAgents(savedAgents) {
  return savedAgents.map((agent) => ({
    ...agent,
    uid: agent.uid || createUid(),
    workedMinutes: normalizeWorkedMinutes(agent.workedMinutes),
  }));
}

function normalizeDemand(savedDemand) {
  return savedDemand.map((item) => ({
    ...item,
    booths: Array.isArray(item.booths) ? item.booths : [],
  }));
}

function renumberAgents(list) {
  return list.map((agent, index) => ({ ...agent, id: index + 1 }));
}

function renumberDemand(list) {
  return list.map((item, index) => ({ ...item, id: index + 1 }));
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;

  return `${hours}h ${mins}m`;
}

// =========================================================
// VALIDACIÓN
// =========================================================

function validateDemand(agents, demand) {
  if (agents.length === 0) {
    return "Debe existir al menos un agente.";
  }

  if (demand.length === 0) {
    return "Debe existir al menos un intervalo de demanda.";
  }

  const normalized = demand.map((item) => ({
    ...item,
    startMinutes: timeToMinutes(item.start),
    endMinutes: timeToMinutes(item.end),
  }));

  for (const item of normalized) {
    if (item.startMinutes >= item.endMinutes) {
      return `Horario inválido: ${item.start} → ${item.end}`;
    }

    if (!item.booths || item.booths.length < 1) {
      return (
        `El intervalo ${item.start} → ${item.end} ` +
        `necesita al menos una casilla seleccionada.`
      );
    }

    if (item.booths.length > agents.length) {
      return (
        `El intervalo ${item.start} → ${item.end} requiere ` +
        `${item.booths.length} casillas pero solo hay ` +
        `${agents.length} agentes.`
      );
    }

    const seen = new Set();

    for (const booth of item.booths) {
      const key = boothKey(booth);

      if (seen.has(key)) {
        return (
          `El intervalo ${item.start} → ${item.end} tiene ` +
          `la casilla ${boothLabel(booth)} repetida.`
        );
      }

      seen.add(key);

      const max = BOOTH_CATALOG[booth.sector];

      if (!max || booth.numero < 1 || booth.numero > max) {
        return `Casilla inválida: ${boothLabel(booth)}.`;
      }
    }
  }

  const sorted = [...normalized].sort((a, b) =>
    a.startMinutes !== b.startMinutes
      ? a.startMinutes - b.startMinutes
      : a.id - b.id
  );

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) {
      return (
        `Hay intervalos superpuestos: ` +
        `${sorted[i - 1].start} → ${sorted[i - 1].end} ` +
        `y ${sorted[i].start} → ${sorted[i].end}`
      );
    }
  }

  return null;
}

// =========================================================
// DEMANDA
// =========================================================
//
// demandWork     = minutos de la planificación actual.
// historicalWork = minutos ya trabajados previamente.
// globalWork     = historicalWork + demandWork.
// =========================================================

function calculateDemandWork(demand) {
  return demand.reduce((total, item) => {
    const duration = timeToMinutes(item.end) - timeToMinutes(item.start);
    return total + duration * item.booths.length;
  }, 0);
}

function calculateHistoricalWork(agents) {
  return agents.reduce(
    (total, agent) => total + normalizeWorkedMinutes(agent.workedMinutes),
    0
  );
}

// =========================================================
// NIVEL DE EQUILIBRIO (WATER-FILLING)
// =========================================================
//
// Reparte `work` minutos entre los agentes de modo que cada uno
// termine con max(base, L). Los agentes cuya base ya supera el
// nivel quedan EXCLUIDOS (reciben 0) y el nivel se recalcula sin
// ellos. Los minutos sobrantes de la división entera se reparten
// de a 1 por orden de ID entre los agentes que están en el nivel.
//
// Devuelve:
//   allocation     Map(id -> minutos nuevos)
//   level          nivel de equilibrio (puede ser fraccionario)
//   participantIds Set de ids que reciben carga (los "equilibrables")
// =========================================================

function waterFill(agents, baseOf, work) {
  const entries = agents
    .map((agent) => ({ id: agent.id, base: baseOf(agent) }))
    .sort((a, b) => a.base - b.base || a.id - b.id);

  let bestCount = 1;
  let bestSum = entries[0].base;
  let prefix = 0;

  for (let i = 0; i < entries.length; i++) {
    prefix += entries[i].base;
    const count = i + 1;

    // El agente k-ésimo participa si su base no supera el nivel resultante.
    if (entries[i].base * count <= prefix + work) {
      bestCount = count;
      bestSum = prefix;
    } else {
      break;
    }
  }

  const participants = entries
    .slice(0, bestCount)
    .sort((a, b) => a.id - b.id);

  const total = bestSum + work;
  const floorLevel = Math.floor(total / bestCount);
  const remainder = total % bestCount;

  const allocation = new Map(agents.map((agent) => [agent.id, 0]));

  participants.forEach((participant, index) => {
    const finalLoad = floorLevel + (index < remainder ? 1 : 0);
    allocation.set(participant.id, finalLoad - participant.base);
  });

  return {
    allocation,
    level: total / bestCount,
    participantIds: new Set(participants.map((p) => p.id)),
  };
}

// =========================================================
// IDENTIFICACIÓN DE RESERVAS
// =========================================================

function getFinalRigidInterval(demand) {
  const lastDemandEnd = Math.max(
    ...demand.map((item) => timeToMinutes(item.end))
  );

  const candidate = [...demand]
    .filter((item) => item.booths.length >= 2)
    .sort((a, b) => timeToMinutes(b.end) - timeToMinutes(a.end))
    .find((item) => timeToMinutes(item.end) === lastDemandEnd);

  if (!candidate) return null;

  const candidateStart = timeToMinutes(candidate.start);

  const hasPreviousDemand = demand.some(
    (item) => timeToMinutes(item.start) < candidateStart
  );

  return hasPreviousDemand ? candidate : null;
}

// =========================================================
// SELECCIÓN DE AGENTES
// =========================================================

function pickLeastLoaded(agents, loadOf, quantity, tieBreak = "asc") {
  const tieBreakSign = tieBreak === "desc" ? -1 : 1;

  return [...agents]
    .sort((a, b) => {
      const diff = loadOf(a) - loadOf(b);
      return diff !== 0 ? diff : tieBreakSign * (a.id - b.id);
    })
    .slice(0, quantity);
}

// =========================================================
// ASIGNACIONES
// =========================================================

function addAssignment(agent, start, end, booth) {
  if (end <= start) return;

  const last = agent.assignments[agent.assignments.length - 1];

  if (last && last.end === start && last.booth === booth) {
    last.end = end;
    last.minutes += end - start;
    return;
  }

  agent.assignments.push({ start, end, booth, minutes: end - start });
}

// =========================================================
// FASE 1 — ROTACIÓN MULTICASILLA Y RESERVA FINAL
// =========================================================
//
// La carga de partida de cada agente es su histórico, de modo
// que "el menos cargado" es el menos cargado de verdad.
//
// fixedMinutes SOLO contiene minutos de esta planificación.
//
// La reserva final se toma primero para que la rotación de los
// bloques anteriores ya cuente esa carga.
// =========================================================

function planMultiBoothBlocks(agents, demand, overloadedIds) {
  const plan = [];

  const fixedMinutes = new Map(agents.map((agent) => [agent.id, 0]));

  const totalLoad = new Map(
    agents.map((agent) => [
      agent.id,
      normalizeWorkedMinutes(agent.workedMinutes),
    ])
  );

  function register(agent, booth, start, end, final) {
    plan.push({ agentId: agent.id, booth, start, end, final });
    fixedMinutes.set(agent.id, fixedMinutes.get(agent.id) + (end - start));
    totalLoad.set(agent.id, totalLoad.get(agent.id) + (end - start));
  }

  const finalRigid = getFinalRigidInterval(demand);

  // ---------- Reserva final ----------
  //
  // Regla original: los IDs más altos. Ahora solo entre agentes
  // con cupo; los ya sobrecargados se usan únicamente si faltan.

  if (finalRigid) {
    const start = timeToMinutes(finalRigid.start);
    const end = timeToMinutes(finalRigid.end);
    const booths = sortBoothsForAssignment(finalRigid.booths);

    const withRoom = agents
      .filter((agent) => !overloadedIds.has(agent.id))
      .sort((a, b) => b.id - a.id);

    const overloaded = agents
      .filter((agent) => overloadedIds.has(agent.id))
      .sort(
        (a, b) =>
          totalLoad.get(a.id) - totalLoad.get(b.id) || b.id - a.id
      );

    const selected = [...withRoom, ...overloaded]
      .slice(0, booths.length)
      .sort((a, b) => a.id - b.id);

    selected.forEach((agent, index) => {
      register(agent, boothLabel(booths[index]), start, end, true);
    });
  }

  // ---------- Rotación en bloques de hasta 60 minutos ----------

  const intervals = [...demand]
    .filter(
      (item) =>
        item.booths.length >= 2 && !(finalRigid && item.id === finalRigid.id)
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) - timeToMinutes(b.start) || a.id - b.id
    );

  for (const interval of intervals) {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);
    const booths = sortBoothsForAssignment(interval.booths);

    let current = start;

    while (current < end) {
      const sliceEnd = Math.min(current + 60, end);

      const selected = pickLeastLoaded(
        agents,
        (agent) => totalLoad.get(agent.id),
        booths.length,
        "asc"
      ).sort((a, b) => a.id - b.id);

      selected.forEach((agent, index) => {
        register(agent, boothLabel(booths[index]), current, sliceEnd, false);
      });

      current = sliceEnd;
    }
  }

  return { plan, fixedMinutes, finalRigid };
}

// =========================================================
// APLICAR PLAN
// =========================================================

function applyPlan(agents, plan) {
  const ordered = [...plan].sort((a, b) => a.start - b.start);

  for (const item of ordered) {
    const agent = agents.find((candidate) => candidate.id === item.agentId);

    if (!agent) continue;

    addAssignment(agent, item.start, item.end, item.booth);
    agent.minutes += item.end - item.start;
  }
}

// =========================================================
// FASE 3 — INTERVALOS DE UNA CASILLA
// =========================================================

function buildFlexibleSchedule(agents, demand, allocation) {
  const remaining = new Map(allocation);

  const flexibleIntervals = [...demand]
    .filter((item) => item.booths.length === 1)
    .sort(
      (a, b) =>
        timeToMinutes(a.start) - timeToMinutes(b.start) || a.id - b.id
    );

  for (const interval of flexibleIntervals) {
    let current = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);
    const booth = boothLabel(interval.booths[0]);

    while (current < end) {
      const candidates = agents
        .filter((agent) => (remaining.get(agent.id) || 0) > 0)
        .sort((a, b) => a.id - b.id);

      if (!candidates.length) break;

      const agent = candidates[0];

      const duration = Math.min(remaining.get(agent.id), end - current);

      addAssignment(agent, current, current + duration, booth);

      agent.minutes += duration;

      remaining.set(agent.id, remaining.get(agent.id) - duration);

      current += duration;
    }
  }

  return remaining;
}

// =========================================================
// VALIDACIÓN FINAL
// =========================================================

function validateGeneratedSchedule(agents, demand) {
  for (const interval of demand) {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);

    for (let minute = start; minute < end; minute++) {
      let activeCount = 0;

      for (const agent of agents) {
        const active = agent.assignments.filter(
          (a) => a.start <= minute && a.end > minute
        );

        if (active.length > 1) {
          return (
            `El agente ${agent.name} ` +
            `está asignado a más de una casilla simultáneamente.`
          );
        }

        activeCount += active.length;
      }

      if (activeCount !== interval.booths.length) {
        return (
          `La demanda ${interval.start} → ${interval.end} requiere ` +
          `${interval.booths.length} casillas, ` +
          `pero el minuto ${minutesToTime(minute)} tiene ` +
          `${activeCount} asignadas.`
        );
      }
    }
  }

  return null;
}

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

export function generateSchedule(agentsInput, demand) {
  const error = validateDemand(agentsInput, demand);

  if (error) {
    return { error, schedule: [], stats: null };
  }

  const agents = agentsInput.map((agent) => ({
    ...agent,
    workedMinutes: normalizeWorkedMinutes(agent.workedMinutes),
    minutes: 0,
    assignments: [],
  }));

  const sortedDemand = [...demand].sort((a, b) => {
    const startA = timeToMinutes(a.start);
    const startB = timeToMinutes(b.start);
    return startA !== startB ? startA - startB : a.id - b.id;
  });

  // 1. Totales
  const demandWork = calculateDemandWork(sortedDemand);
  const historicalWork = calculateHistoricalWork(agents);
  const globalWork = demandWork + historicalWork;

  // 2. Nivel de equilibrio global: define quiénes ya están sobrecargados.
  const globalFill = waterFill(
    agents,
    (agent) => agent.workedMinutes,
    demandWork
  );

  const overloadedIds = new Set(
    agents
      .filter((agent) => !globalFill.participantIds.has(agent.id))
      .map((agent) => agent.id)
  );

  // 3. Bloques multicasilla y reserva final.
  const { plan, fixedMinutes } = planMultiBoothBlocks(
    agents,
    sortedDemand,
    overloadedIds
  );

  applyPlan(agents, plan);

  // 4. Demanda flexible: se recalcula el nivel con
  //    base = histórico + minutos rígidos ya asignados.
  const flexibleWork = sortedDemand
    .filter((item) => item.booths.length === 1)
    .reduce(
      (total, item) =>
        total + timeToMinutes(item.end) - timeToMinutes(item.start),
      0
    );

  const flexibleFill = waterFill(
    agents,
    (agent) => agent.workedMinutes + (fixedMinutes.get(agent.id) || 0),
    flexibleWork
  );

  // 5. Convertir cuotas en horarios.
  buildFlexibleSchedule(agents, sortedDemand, flexibleFill.allocation);

  // 6. Orden cronológico.
  for (const agent of agents) {
    agent.assignments.sort((a, b) => a.start - b.start);
  }

  // 7. Validación.
  const scheduleError = validateGeneratedSchedule(agents, sortedDemand);

  if (scheduleError) {
    return { error: scheduleError, schedule: [], stats: null };
  }

  // 8. Estadísticas: la diferencia se mide solo entre agentes
  //    que podían recibir carga (los no sobrecargados).
  const balanceable = agents.filter((agent) => !overloadedIds.has(agent.id));

  const totalLoads = balanceable.map(
    (agent) => agent.workedMinutes + agent.minutes
  );

  const minMinutes = Math.min(...totalLoads);
  const maxMinutes = Math.max(...totalLoads);

  const overloadedWithNewWork = agents.filter(
    (agent) => overloadedIds.has(agent.id) && agent.minutes > 0
  ).length;

  return {
    error: null,
    schedule: agents,
    stats: {
      demandWork,
      historicalWork,
      globalWork,

      // Nivel de equilibrio (antes: promedio global simple).
      target: globalFill.level,

      // Mínimo / máximo de carga total entre agentes equilibrables.
      minMinutes,
      maxMinutes,
      difference: maxMinutes - minMinutes,

      // Agentes que ya superaban el nivel antes de empezar.
      overloadedCount: overloadedIds.size,

      // Cuántos de ellos igualmente recibieron minutos nuevos
      // (porque un bloque multicasilla/reserva lo exigió).
      overloadedWithNewWork,
    },
  };
}

// =========================================================
// TESTS MANUALES DEL MOTOR
// =========================================================

function mkAgents(history = [0, 0, 0, 0, 0, 0]) {
  const names = ["Juan", "Pedro", "Carlos", "Luis", "Miguel", "Diego"];

  return history.map((workedMinutes, index) => ({
    id: index + 1,
    name: names[index] || `Agente ${index + 1}`,
    workedMinutes,
  }));
}

const E = (numero) => ({ sector: "entrada", numero });
const S = (numero) => ({ sector: "salida", numero });

function idsWithBlock(result, start, end) {
  return result.schedule
    .filter((a) => a.assignments.some((x) => x.start === start && x.end === end))
    .map((a) => a.id)
    .sort((a, b) => a - b);
}

function minutesOf(result, id) {
  return result.schedule.find((a) => a.id === id).minutes;
}

export function runSchedulerTests() {
  const agents = mkAgents();

  // TEST 1 — rotación básica, sesgo de sector
  const test1 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: [E(1), E(2)] },
  ]);

  console.assert(!test1.error, "TEST 1: no debería haber error.");

  const t1 = test1.schedule.flatMap((agent) =>
    agent.assignments.map((a) => ({ agentId: agent.id, booth: a.booth }))
  );

  console.assert(
    t1.some((i) => i.agentId === 1 && i.booth === "Entrada 2"),
    "TEST 1: Juan debe estar en Entrada 2."
  );
  console.assert(
    t1.some((i) => i.agentId === 2 && i.booth === "Entrada 1"),
    "TEST 1: Pedro debe estar en Entrada 1."
  );

  // TEST 2 — reservas finales
  const test2 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "00:30", booths: [E(1), E(2)] },
    { id: 2, start: "00:30", end: "05:00", booths: [E(1)] },
    { id: 3, start: "05:00", end: "06:00", booths: [S(1), S(2), S(3), S(4)] },
  ]);

  console.assert(!test2.error, "TEST 2: no debería haber error.");
  console.assert(
    JSON.stringify(idsWithBlock(test2, 0, 30)) === JSON.stringify([1, 2]),
    "TEST 2: el primer bloque rígido debe cubrirlo Juan y Pedro."
  );
  console.assert(
    JSON.stringify(idsWithBlock(test2, 300, 360)) ===
      JSON.stringify([3, 4, 5, 6]),
    "TEST 2: el segundo bloque rígido debe cubrirlo Carlos, Luis, Miguel y Diego."
  );

  // TEST 2b
  const test2b = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "00:30", booths: [E(1), E(2)] },
    { id: 2, start: "00:30", end: "05:00", booths: [E(1)] },
    { id: 3, start: "05:00", end: "06:00", booths: [S(1), S(2), S(3)] },
  ]);

  console.assert(!test2b.error, "TEST 2b: no debería haber error.");
  console.assert(
    JSON.stringify(idsWithBlock(test2b, 300, 360)) === JSON.stringify([4, 5, 6]),
    "TEST 2b: el último bloque debe cubrirlo Luis, Miguel y Diego."
  );
  console.assert(
    test2b.schedule
      .find((a) => a.id === 6)
      .assignments.some((a) => a.booth === "Salida 3"),
    "TEST 2b: Diego debe quedar en Salida 3."
  );

  // TEST 3 — orden cronológico
  const diego = test2.schedule.find((a) => a.id === 6);
  console.assert(
    diego.assignments.every(
      (a, i) => i === 0 || diego.assignments[i - 1].start <= a.start
    ),
    "TEST 3: los turnos deben quedar ordenados cronológicamente."
  );

  // TEST 4 — equilibrio sin histórico
  const test4 = generateSchedule(agents, [
    { id: 1, start: "00:00", end: "01:00", booths: [E(1), E(2)] },
    { id: 2, start: "01:00", end: "05:00", booths: [E(1)] },
    { id: 3, start: "05:00", end: "06:00", booths: [S(1), S(2), S(3)] },
  ]);

  console.assert(!test4.error, "TEST 4: no debería haber error.");
  console.assert(
    test4.stats.difference <= 1,
    "TEST 4: la diferencia debería ser como máximo 1 minuto."
  );

  // TEST 5 — histórico leve (30 min en un agente)
  const test5 = generateSchedule(mkAgents([30, 0, 0, 0, 0, 0]), [
    { id: 1, start: "00:00", end: "06:00", booths: [E(16)] },
  ]);

  console.assert(!test5.error, "TEST 5: no debería haber error.");
  console.assert(test5.stats.globalWork === 390, "TEST 5: carga global 390.");
  console.assert(test5.stats.target === 65, "TEST 5: nivel 65.");
  console.assert(minutesOf(test5, 1) === 35, "TEST 5: Agente 1 recibe 35.");
  console.assert(
    test5.schedule.every((a) => a.workedMinutes + a.minutes === 65),
    "TEST 5: todos terminan en 65."
  );
  console.assert(test5.stats.difference === 0, "TEST 5: diferencia 0.");

  // TEST 6 — un agente muy por encima del nivel (200 min previos)
  const test6 = generateSchedule(mkAgents([200, 0, 0, 0, 0, 0]), [
    { id: 1, start: "00:00", end: "06:00", booths: [E(1)] },
  ]);

  console.assert(!test6.error, "TEST 6: no debería haber error.");
  console.assert(minutesOf(test6, 1) === 0, "TEST 6: Agente 1 no recibe nada.");
  console.assert(
    [2, 3, 4, 5, 6].every((id) => minutesOf(test6, id) === 72),
    "TEST 6: los demás reciben 72 cada uno."
  );
  console.assert(test6.stats.target === 72, "TEST 6: nivel 72.");
  console.assert(test6.stats.difference === 0, "TEST 6: diferencia 0.");
  console.assert(test6.stats.overloadedCount === 1, "TEST 6: 1 sobrecargado.");
  console.assert(
    test6.stats.overloadedWithNewWork === 0,
    "TEST 6: el sobrecargado no recibe carga nueva."
  );

  // TEST 7 — varios agentes por encima del nivel
  const test7 = generateSchedule(mkAgents([200, 150, 0, 0, 0, 0]), [
    { id: 1, start: "00:00", end: "06:00", booths: [E(1)] },
  ]);

  console.assert(!test7.error, "TEST 7: no debería haber error.");
  console.assert(
    minutesOf(test7, 1) === 0 && minutesOf(test7, 2) === 0,
    "TEST 7: Agentes 1 y 2 no reciben nada."
  );
  console.assert(
    [3, 4, 5, 6].every((id) => minutesOf(test7, id) === 90),
    "TEST 7: los otros cuatro reciben 90."
  );
  console.assert(test7.stats.overloadedCount === 2, "TEST 7: 2 sobrecargados.");

  // TEST 8 — mismo histórico para todos = igual que sin histórico
  const demand8 = [
    { id: 1, start: "00:00", end: "06:00", booths: [E(1)] },
  ];
  const test8a = generateSchedule(mkAgents([0, 0, 0, 0, 0, 0]), demand8);
  const test8b = generateSchedule(mkAgents([50, 50, 50, 50, 50, 50]), demand8);

  console.assert(
    JSON.stringify(test8a.schedule.map((a) => a.assignments)) ===
      JSON.stringify(test8b.schedule.map((a) => a.assignments)),
    "TEST 8: histórico igual para todos no debe cambiar el reparto."
  );
  console.assert(test8b.stats.difference === 0, "TEST 8: diferencia 0.");

  // TEST 9 — bloque rígido que obliga a usar a un agente sobrecargado
  const test9 = generateSchedule(mkAgents([500, 0, 0]), [
    { id: 1, start: "00:00", end: "01:00", booths: [E(1), E(2), E(3)] },
  ]);

  console.assert(!test9.error, "TEST 9: no debería haber error.");
  console.assert(minutesOf(test9, 1) === 60, "TEST 9: Agente 1 forzado, 60 min.");
  console.assert(
    test9.stats.overloadedWithNewWork === 1,
    "TEST 9: debe informar 1 sobrecargado con carga nueva."
  );
  console.assert(
    test9.stats.difference === 0,
    "TEST 9: diferencia entre equilibrables = 0."
  );

  // TEST 10 — la reserva final salta a los sobrecargados
  const test10 = generateSchedule(mkAgents([0, 0, 0, 0, 1000, 1000]), [
    { id: 1, start: "00:00", end: "04:00", booths: [E(1)] },
    { id: 2, start: "04:00", end: "05:00", booths: [E(1), E(2)] },
  ]);

  console.assert(!test10.error, "TEST 10: no debería haber error.");
  console.assert(
    JSON.stringify(idsWithBlock(test10, 240, 300)) === JSON.stringify([3, 4]),
    "TEST 10: la reserva debe ir a Carlos y Luis (con cupo)."
  );
  console.assert(
    minutesOf(test10, 5) === 0 && minutesOf(test10, 6) === 0,
    "TEST 10: Miguel y Diego (sobrecargados) no trabajan."
  );
  console.assert(test10.stats.difference <= 1, "TEST 10: diferencia <= 1.");

  // TEST 11 — sin intervalo flexible, solo bloque final
  const test11 = generateSchedule(mkAgents([0, 0, 0, 0]), [
    { id: 1, start: "00:00", end: "01:00", booths: [E(1), E(2)] },
    { id: 2, start: "01:00", end: "02:00", booths: [E(1), E(2)] },
  ]);

  console.assert(!test11.error, "TEST 11: no debería haber error.");
  console.assert(
    test11.schedule.reduce((t, a) => t + a.minutes, 0) === 240,
    "TEST 11: se cubren los 240 minutos de demanda."
  );

  return { test1, test2, test2b, test4, test5, test6, test7, test8b, test9, test10, test11 };
}

// =========================================================
// COMPONENTE REACT
// =========================================================

function WorkedMinutesInput({
  value,
  onCommit,
  onEnter,
  inputRef,
  ariaLabel,
}) {
  // Se edita como texto para poder vaciar el campo; el valor se
  // normaliza a número entero >= 0 recién al salir del campo.
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(String(value));
    }
  }, [value, editing]);

  return (
    <input
      ref={inputRef}
      className="input"
      type="number"
      min="0"
      step="1"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);

        if (raw !== "") {
          onCommit(raw);
        }
      }}
      onBlur={() => {
        const normalized = normalizeWorkedMinutes(draft);
        setEditing(false);
        setDraft(String(normalized));
        onCommit(normalized);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter?.();
        }
      }}
      style={{ width: 80 }}
      aria-label={ariaLabel}
      title="Minutos trabajados antes de esta planificación"
    />
  );
}

function BoothPicker({
  sector,
  count,
  selected,
  onToggle,
}) {
  const numbers =
    Array.from(
      { length: count },
      (_, i) => i + 1
    );

  return (
    <div
      style={{
        marginTop: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#555",
          marginBottom: 4,
        }}
      >
        {SECTOR_LABEL[sector]}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {numbers.map(
          (numero) => {
            const isActive =
              selected.some(
                (b) =>
                  b.sector ===
                    sector &&
                  b.numero ===
                    numero
              );

            return (
              <button
                key={numero}
                type="button"
                onClick={() =>
                  onToggle(
                    sector,
                    numero
                  )
                }
                style={{
                  minWidth: 30,
                  height: 30,
                  borderRadius: 6,
                  border: isActive
                    ? "1px solid #2563eb"
                    : "1px solid #ccc",
                  background:
                    isActive
                      ? "#2563eb"
                      : "#fff",
                  color: isActive
                    ? "#fff"
                    : "#333",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {numero}
              </button>
            );
          }
        )}
      </div>
    </div>
  );
}

// =========================================================
// TEXTO PARA COPIAR
// =========================================================

function generatePlainTextSchedule(
  schedule
) {
  const timePoints = [
    ...new Set(
      schedule.flatMap(
        (agent) =>
          agent.assignments.flatMap(
            (assignment) => [
              assignment.start,
              assignment.end,
            ]
          )
      )
    ),
  ].sort((a, b) => a - b);

  const rows = [];

  for (
    let i = 0;
    i <
    timePoints.length - 1;
    i++
  ) {
    const start =
      timePoints[i];

    const end =
      timePoints[i + 1];

    const active =
      schedule
        .map((agent) => {
          const assignment =
            agent.assignments.find(
              (a) =>
                a.start <= start &&
                a.end >= end
            );

          if (!assignment) {
            return null;
          }

          return {
            agent: agent.name,
            booth:
              assignment.booth,
          };
        })
        .filter(Boolean);

    if (active.length === 0) {
      continue;
    }

    rows.push({
      start,
      end,
      active,
    });
  }

  const mergedRows = [];

  for (const row of rows) {
    const previous =
      mergedRows[
        mergedRows.length - 1
      ];

    const sameAssignments =
      previous &&
      JSON.stringify(
        previous.active
      ) ===
        JSON.stringify(
          row.active
        ) &&
      previous.end ===
        row.start;

    if (sameAssignments) {
      previous.end = row.end;
    } else {
      mergedRows.push({
        ...row,
      });
    }
  }

  const lines = [
    "Guardia Nocturna",
    "Hora -> Agente|Casilla",
  ];

  for (const row of mergedRows) {
    const time =
      `${minutesToShortTime(
        row.start
      )}-${minutesToShortTime(
        row.end
      )}`;

    const assignments =
      row.active
        .map(
          ({
            agent,
            booth,
          }) =>
            `${agent}/${boothAbbrev(
              booth
            )}`
        )
        .join("|");

    lines.push(
      `${time} ${assignments}`
    );
  }

  return lines.join("\n");
}

// =========================================================
// APP
// =========================================================

export default function App() {
  const [agents, setAgents] =
    useState(() => {
      try {
        const saved =
          localStorage.getItem(
            STORAGE_KEYS.agents
          );

        if (saved) {
          return normalizeAgents(
            JSON.parse(saved)
          );
        }

        return normalizeAgents(
          INITIAL_AGENTS.map(
            (agent) => ({
              ...agent,
              uid: createUid(),
            })
          )
        );
      } catch (error) {
        console.error(
          "No se pudieron cargar los agentes:",
          error
        );

        return normalizeAgents(
          INITIAL_AGENTS.map(
            (agent) => ({
              ...agent,
              uid: createUid(),
            })
          )
        );
      }
    });

  const [demand, setDemand] =
    useState(() => {
      try {
        const saved =
          localStorage.getItem(
            STORAGE_KEYS.demand
          );

        if (saved) {
          return normalizeDemand(
            JSON.parse(saved)
          );
        }

        return INITIAL_DEMAND;
      } catch (error) {
        console.error(
          "No se pudo cargar la demanda:",
          error
        );

        return INITIAL_DEMAND;
      }
    });

  const agentInputRefs =
    useRef({});

  const workedMinutesRefs =
    useRef({});

  const demandStartRefs =
    useRef({});

  const demandEndRefs =
    useRef({});

  const draggedAgentUid =
    useRef(null);

  const draggedDemandId =
    useRef(null);

  // =======================================================
  // LOCAL STORAGE
  // =======================================================

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.agents,
        JSON.stringify(agents)
      );
    } catch (error) {
      console.error(
        "No se pudieron guardar los agentes:",
        error
      );
    }
  }, [agents]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.demand,
        JSON.stringify(demand)
      );
    } catch (error) {
      console.error(
        "No se pudo guardar la demanda:",
        error
      );
    }
  }, [demand]);

  // =======================================================
  // RESET
  // =======================================================

  function resetData() {
    const confirmed =
      window.confirm(
        "¿Querés borrar todos los agentes y horarios y volver a los valores iniciales?"
      );

    if (!confirmed) return;

    localStorage.removeItem(
      STORAGE_KEYS.agents
    );

    localStorage.removeItem(
      STORAGE_KEYS.demand
    );

    setAgents(
      INITIAL_AGENTS.map(
        (agent) => ({
          ...agent,
          uid: createUid(),
        })
      )
    );

    setDemand(
      INITIAL_DEMAND
    );
  }

  // =======================================================
  // RESULTADO
  // =======================================================

  const result = useMemo(
    () =>
      generateSchedule(
        agents,
        demand
      ),
    [agents, demand]
  );

  // =======================================================
  // AGENTES
  // =======================================================

  function focusAgent(uid) {
    requestAnimationFrame(() => {
      agentInputRefs.current[
        uid
      ]?.focus();

      agentInputRefs.current[
        uid
      ]?.select();
    });
  }

  function addAgent() {
    const newAgent = {
      uid: createUid(),
      id: agents.length + 1,
      name:
        `Agente ${agents.length + 1}`,
      workedMinutes: 0,
    };

    setAgents((current) => [
      ...current,
      newAgent,
    ]);

    focusAgent(
      newAgent.uid
    );
  }

  function removeAgent(id) {
    setAgents((current) => {
      const updated =
        current.filter(
          (agent) =>
            agent.id !== id
        );

      return renumberAgents(
        updated
      );
    });
  }

  function updateAgent(
    id,
    name
  ) {
    setAgents((current) =>
      current.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              name,
            }
          : agent
      )
    );
  }

  function updateAgentWorkedMinutes(
    id,
    value
  ) {
    const minutes =
      normalizeWorkedMinutes(
        value
      );

    setAgents((current) =>
      current.map((agent) =>
        agent.id === id
          ? {
              ...agent,
              workedMinutes:
                minutes,
            }
          : agent
      )
    );
  }

  function handleAgentKeyDown(
    event,
    agent
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const index =
      agents.findIndex(
        (item) =>
          item.uid === agent.uid
      );

    if (
      index ===
      agents.length - 1
    ) {
      addAgent();
      return;
    }

    const nextAgent =
      agents[index + 1];

    focusAgent(
      nextAgent.uid
    );
  }

  function reorderAgents(
    sourceUid,
    targetUid
  ) {
    if (
      !sourceUid ||
      !targetUid ||
      sourceUid === targetUid
    ) {
      return;
    }

    setAgents((current) => {
      const sourceIndex =
        current.findIndex(
          (agent) =>
            agent.uid ===
            sourceUid
        );

      const targetIndex =
        current.findIndex(
          (agent) =>
            agent.uid ===
            targetUid
        );

      if (
        sourceIndex === -1 ||
        targetIndex === -1
      ) {
        return current;
      }

      const updated = [
        ...current,
      ];

      const [moved] =
        updated.splice(
          sourceIndex,
          1
        );

      updated.splice(
        targetIndex,
        0,
        moved
      );

      return renumberAgents(
        updated
      );
    });
  }

  function moveAgent(
    agentUid,
    direction
  ) {
    setAgents((current) => {
      const index =
        current.findIndex(
          (agent) =>
            agent.uid ===
            agentUid
        );

      if (index === -1) {
        return current;
      }

      const targetIndex =
        index + direction;

      if (
        targetIndex < 0 ||
        targetIndex >=
          current.length
      ) {
        return current;
      }

      const updated = [
        ...current,
      ];

      [
        updated[index],
        updated[targetIndex],
      ] = [
        updated[targetIndex],
        updated[index],
      ];

      return renumberAgents(
        updated
      );
    });

    requestAnimationFrame(() => {
      agentInputRefs.current[
        agentUid
      ]?.focus();
    });
  }

  function handleAgentDragStart(
    event,
    agent
  ) {
    draggedAgentUid.current =
      agent.uid;

    event.dataTransfer.effectAllowed =
      "move";

    event.dataTransfer.setData(
      "text/plain",
      agent.uid
    );
  }

  function handleAgentDragOver(
    event
  ) {
    event.preventDefault();

    event.dataTransfer.dropEffect =
      "move";
  }

  function handleAgentDrop(
    event,
    targetAgent
  ) {
    event.preventDefault();

    const sourceUid =
      event.dataTransfer.getData(
        "text/plain"
      ) ||
      draggedAgentUid.current;

    reorderAgents(
      sourceUid,
      targetAgent.uid
    );

    draggedAgentUid.current =
      null;
  }

  function handleAgentDragEnd() {
    draggedAgentUid.current =
      null;
  }

  // =======================================================
  // DEMANDA
  // =======================================================

  function focusDemandStart(id) {
    requestAnimationFrame(() => {
      demandStartRefs.current[
        id
      ]?.focus();
    });
  }

  function focusDemandEnd(id) {
    requestAnimationFrame(() => {
      demandEndRefs.current[
        id
      ]?.focus();
    });
  }

  function addDemand() {
    const lastDemand =
      demand[demand.length - 1];

    const newDemand = {
      id: demand.length + 1,
      start:
        lastDemand?.end ||
        "00:00",
      end:
        lastDemand?.end ||
        "01:00",
      booths: [],
    };

    setDemand((current) => [
      ...current,
      newDemand,
    ]);

    focusDemandStart(
      newDemand.id
    );
  }

  function removeDemand(id) {
    setDemand((current) => {
      const updated =
        current.filter(
          (item) =>
            item.id !== id
        );

      return renumberDemand(
        updated
      );
    });
  }

  function updateDemand(
    id,
    field,
    value
  ) {
    setDemand((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  }

  function handleDemandStartKeyDown(
    event,
    item
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    focusDemandEnd(
      item.id
    );
  }

  function handleDemandEndKeyDown(
    event,
    item
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const index =
      demand.findIndex(
        (current) =>
          current.id ===
          item.id
      );

    if (
      index <
      demand.length - 1
    ) {
      focusDemandStart(
        demand[index + 1].id
      );

      return;
    }

    addDemand();
  }

  function reorderDemand(
    sourceId,
    targetId
  ) {
    if (
      sourceId === targetId
    ) {
      return;
    }

    setDemand((current) => {
      const sourceIndex =
        current.findIndex(
          (item) =>
            item.id ===
            sourceId
        );

      const targetIndex =
        current.findIndex(
          (item) =>
            item.id ===
            targetId
        );

      if (
        sourceIndex === -1 ||
        targetIndex === -1
      ) {
        return current;
      }

      const updated = [
        ...current,
      ];

      const [moved] =
        updated.splice(
          sourceIndex,
          1
        );

      updated.splice(
        targetIndex,
        0,
        moved
      );

      return renumberDemand(
        updated
      );
    });
  }

  function moveDemand(
    id,
    direction
  ) {
    setDemand((current) => {
      const index =
        current.findIndex(
          (item) =>
            item.id === id
        );

      if (index === -1) {
        return current;
      }

      const targetIndex =
        index + direction;

      if (
        targetIndex < 0 ||
        targetIndex >=
          current.length
      ) {
        return current;
      }

      const updated = [
        ...current,
      ];

      [
        updated[index],
        updated[targetIndex],
      ] = [
        updated[targetIndex],
        updated[index],
      ];

      return renumberDemand(
        updated
      );
    });

    requestAnimationFrame(() => {
      demandStartRefs.current[
        id
      ]?.focus();
    });
  }

  function handleDemandDragStart(
    event,
    item
  ) {
    draggedDemandId.current =
      item.id;

    event.dataTransfer.effectAllowed =
      "move";

    event.dataTransfer.setData(
      "text/plain",
      String(item.id)
    );
  }

  function handleDemandDragOver(
    event
  ) {
    event.preventDefault();

    event.dataTransfer.dropEffect =
      "move";
  }

  function handleDemandDrop(
    event,
    targetItem
  ) {
    event.preventDefault();

    const sourceId =
      Number(
        event.dataTransfer.getData(
          "text/plain"
        )
      ) ||
      draggedDemandId.current;

    reorderDemand(
      sourceId,
      targetItem.id
    );

    draggedDemandId.current =
      null;
  }

  function handleDemandDragEnd() {
    draggedDemandId.current =
      null;
  }

  function toggleBooth(
    demandId,
    sector,
    numero
  ) {
    setDemand(
      demand.map((item) => {
        if (
          item.id !==
          demandId
        ) {
          return item;
        }

        const exists =
          item.booths.some(
            (b) =>
              b.sector ===
                sector &&
              b.numero ===
                numero
          );

        const booths = exists
          ? item.booths.filter(
              (b) =>
                !(
                  b.sector ===
                    sector &&
                  b.numero ===
                    numero
                )
            )
          : [
              ...item.booths,
              {
                sector,
                numero,
              },
            ];

        return {
          ...item,
          booths,
        };
      })
    );
  }

  // =======================================================
  // COPIAR
  // =======================================================

  async function copyPlainTextSchedule() {
    if (
      !result.schedule?.length
    ) {
      return;
    }

    const text =
      generatePlainTextSchedule(
        result.schedule
      );

    try {
      await navigator.clipboard.writeText(
        text
      );

      alert(
        "Horario copiado al portapapeles."
      );
    } catch (error) {
      console.error(
        "No se pudo copiar el horario:",
        error
      );

      alert(
        "No se pudo copiar el horario."
      );
    }
  }

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <h1>
            Gestión de horarios
          </h1>

          <p>
            Distribución automática de agentes y casillas
          </p>
        </header>

        {/* =================================================
            AGENTES
        ================================================= */}

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Agentes
              </h2>

              <p className="card-description">
                El ID determina el orden de llegada.
                Los minutos ya trabajados se tienen
                en cuenta para equilibrar la carga total.
              </p>
            </div>
          </div>

          <div className="agent-list">
            {agents.map(
              (agent, index) => (
                <div
                  key={agent.uid}
                  className="agent-row"
                  draggable
                  onDragStart={(
                    event
                  ) =>
                    handleAgentDragStart(
                      event,
                      agent
                    )
                  }
                  onDragOver={
                    handleAgentDragOver
                  }
                  onDrop={(event) =>
                    handleAgentDrop(
                      event,
                      agent
                    )
                  }
                  onDragEnd={
                    handleAgentDragEnd
                  }
                  style={{
                    cursor: "grab",
                  }}
                >
                  {/* DRAG */}

                  <div
                    className="agent-number"
                    title="Arrastrar para cambiar el orden"
                    aria-label={`Agente ${agent.id}. Arrastrar para cambiar el orden.`}
                  >
                    ⋮⋮
                  </div>

                  {/* ID */}

                  <div
                    style={{
                      minWidth: 28,
                      textAlign:
                        "center",
                      fontWeight: 700,
                    }}
                  >
                    {agent.id}
                  </div>

                  {/* NOMBRE */}

                  <input
                    ref={(element) => {
                      agentInputRefs.current[
                        agent.uid
                      ] =
                        element;
                    }}
                    className="input input-name"
                    value={
                      agent.name
                    }
                    placeholder={`Agente ${agent.id}`}
                    autoFocus={
                      index === 0
                    }
                    onChange={(
                      event
                    ) =>
                      updateAgent(
                        agent.id,
                        event.target
                          .value
                      )
                    }
                    onKeyDown={(
                      event
                    ) =>
                      handleAgentKeyDown(
                        event,
                        agent
                      )
                    }
                    aria-label={`Nombre del agente ${agent.id}`}
                  />

                  {/* MINUTOS PREVIOS */}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        color: "#666",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Ya trabajó
                    </label>

                    <WorkedMinutesInput
                      value={agent.workedMinutes ?? 0}
                      onCommit={(value) =>
                        updateAgentWorkedMinutes(agent.id, value)
                      }
                      onEnter={() => {
                        const nextAgent = agents[index + 1];

                        if (nextAgent) {
                          focusAgent(nextAgent.uid);
                        }
                      }}
                      inputRef={(element) => {
                        workedMinutesRefs.current[agent.uid] = element;
                      }}
                      ariaLabel={`Minutos ya trabajados por el agente ${agent.id}`}
                    />

                    <span
                      style={{
                        fontSize: 12,
                        color: "#777",
                      }}
                    >
                      min
                    </span>
                  </div>

                  {/* SUBIR */}

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      moveAgent(
                        agent.uid,
                        -1
                      )
                    }
                    disabled={
                      index === 0
                    }
                    aria-label={`Subir agente ${agent.id}`}
                    title="Subir"
                  >
                    ↑
                  </button>

                  {/* BAJAR */}

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      moveAgent(
                        agent.uid,
                        1
                      )
                    }
                    disabled={
                      index ===
                      agents.length -
                        1
                    }
                    aria-label={`Bajar agente ${agent.id}`}
                    title="Bajar"
                  >
                    ↓
                  </button>

                  {/* ELIMINAR */}

                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() =>
                      removeAgent(
                        agent.id
                      )
                    }
                  >
                    Eliminar
                  </button>
                </div>
              )
            )}
          </div>

          <button
            className="button button-primary"
            onClick={
              addAgent
            }
          >
            + Agregar agente
          </button>
        </section>

        {/* =================================================
            DEMANDA
        ================================================= */}

        <section
          style={{
            marginTop: 40,
          }}
        >
          <h2>
            Horarios de casillas
          </h2>

          <p>
            Los bloques finales con varias casillas se
            mantienen completos y funcionan como reserva.
            Los bloques multicasilla anteriores se rotan
            operativamente. Las casillas individuales
            completan la carga restante según el objetivo
            global. Los minutos ya trabajados por cada agente
            se descuentan de lo que necesita trabajar ahora.
            El orden de llegada determina la prioridad.
          </p>

          <div className="demand-list">
            {demand.map(
              (item, index) => (
                <div
                  key={item.id}
                  className="demand-row"
                  draggable
                  onDragStart={(
                    event
                  ) =>
                    handleDemandDragStart(
                      event,
                      item
                    )
                  }
                  onDragOver={
                    handleDemandDragOver
                  }
                  onDrop={(event) =>
                    handleDemandDrop(
                      event,
                      item
                    )
                  }
                  onDragEnd={
                    handleDemandDragEnd
                  }
                  style={{
                    flexDirection:
                      "column",
                    alignItems:
                      "stretch",
                    cursor: "grab",
                  }}
                >
                  {/* CABECERA */}

                  <div
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: 8,
                    }}
                  >
                    <div
                      title="Arrastrar para cambiar el orden"
                      aria-label={`Intervalo ${item.id}. Arrastrar para cambiar el orden.`}
                      style={{
                        fontWeight: 700,
                        minWidth: 20,
                        cursor:
                          "grab",
                        userSelect:
                          "none",
                        color:
                          "#777",
                      }}
                    >
                      ⋮⋮
                    </div>

                    <strong
                      style={{
                        minWidth: 24,
                      }}
                    >
                      {item.id}
                    </strong>

                    {/* INICIO */}

                    <input
                      ref={(
                        element
                      ) => {
                        demandStartRefs.current[
                          item.id
                        ] =
                          element;
                      }}
                      className="input input-time"
                      type="time"
                      value={
                        item.start
                      }
                      onChange={(
                        event
                      ) =>
                        updateDemand(
                          item.id,
                          "start",
                          event.target
                            .value
                        )
                      }
                      onKeyDown={(
                        event
                      ) =>
                        handleDemandStartKeyDown(
                          event,
                          item
                        )
                      }
                      aria-label={`Comienzo del intervalo ${item.id}`}
                    />

                    <span className="time-arrow">
                      →
                    </span>

                    {/* FIN */}

                    <input
                      ref={(
                        element
                      ) => {
                        demandEndRefs.current[
                          item.id
                        ] =
                          element;
                      }}
                      className="input input-time"
                      type="time"
                      value={
                        item.end
                      }
                      onChange={(
                        event
                      ) =>
                        updateDemand(
                          item.id,
                          "end",
                          event.target
                            .value
                        )
                      }
                      onKeyDown={(
                        event
                      ) =>
                        handleDemandEndKeyDown(
                          event,
                          item
                        )
                      }
                      aria-label={`Final del intervalo ${item.id}`}
                    />

                    <span
                      style={{
                        fontSize: 12,
                        color:
                          "#777",
                      }}
                    >
                      {
                        item.booths
                          .length
                      }{" "}
                      casilla
                      {item.booths
                        .length ===
                      1
                        ? ""
                        : "s"}{" "}
                      seleccionada
                      {item.booths
                        .length ===
                      1
                        ? ""
                        : "s"}
                    </span>

                    {/* SUBIR */}

                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        moveDemand(
                          item.id,
                          -1
                        )
                      }
                      disabled={
                        index === 0
                      }
                      aria-label={`Subir intervalo ${item.id}`}
                      title="Subir"
                    >
                      ↑
                    </button>

                    {/* BAJAR */}

                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        moveDemand(
                          item.id,
                          1
                        )
                      }
                      disabled={
                        index ===
                        demand.length -
                          1
                      }
                      aria-label={`Bajar intervalo ${item.id}`}
                      title="Bajar"
                    >
                      ↓
                    </button>

                    {/* ELIMINAR */}

                    <button
                      type="button"
                      className="button button-danger"
                      style={{
                        marginLeft:
                          "auto",
                      }}
                      onClick={() =>
                        removeDemand(
                          item.id
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </div>

                  {/* CASILLAS */}

                  <div
                    style={{
                      display:
                        "flex",
                      gap: 24,
                      flexWrap:
                        "wrap",
                    }}
                  >
                    <BoothPicker
                      sector="entrada"
                      count={
                        BOOTH_CATALOG.entrada
                      }
                      selected={
                        item.booths
                      }
                      onToggle={(
                        sector,
                        numero
                      ) =>
                        toggleBooth(
                          item.id,
                          sector,
                          numero
                        )
                      }
                    />

                    <BoothPicker
                      sector="salida"
                      count={
                        BOOTH_CATALOG.salida
                      }
                      selected={
                        item.booths
                      }
                      onToggle={(
                        sector,
                        numero
                      ) =>
                        toggleBooth(
                          item.id,
                          sector,
                          numero
                        )
                      }
                    />
                  </div>
                </div>
              )
            )}
          </div>

          <button
            className="button button-secondary"
            onClick={
              addDemand
            }
          >
            + Agregar intervalo
          </button>
        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {result.error && (
          <div className="error">
            {result.error}
          </div>
        )}

        {/* =================================================
            RESULTADO
        ================================================= */}

        {result.stats && (
          <section
            style={{
              marginTop: 40,
            }}
          >
            <h2>
              Resultado
            </h2>

            <div className="stats">

              <div className="stat">
                <div className="stat-label">
                  Demanda nueva
                </div>

                <div className="stat-value">
                  {formatMinutes(
                    result.stats
                      .demandWork
                  )}
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Carga previa
                </div>

                <div className="stat-value">
                  {formatMinutes(
                    result.stats
                      .historicalWork
                  )}
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Carga global
                </div>

                <div className="stat-value">
                  {formatMinutes(
                    result.stats
                      .globalWork
                  )}
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Nivel de equilibrio
                </div>

                <div className="stat-value">
                  {result.stats.target.toFixed(
                    1
                  )}{" "}
                  min
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Menor carga total
                </div>

                <div className="stat-value">
                  {formatMinutes(
                    result.stats
                      .minMinutes
                  )}
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Diferencia máxima (entre agentes con cupo)
                </div>

                <div
                  className={
                    `stat-value ${
                      result.stats
                        .difference <=
                      1
                        ? "good"
                        : "warning"
                    }`
                  }
                >
                  {
                    result.stats
                      .difference
                  }{" "}
                  min
                </div>
              </div>

              <div className="stat">
                <div className="stat-label">
                  Agentes sobre el nivel
                </div>

                <div className="stat-value">
                  {result.stats.overloadedCount}
                </div>
              </div>
            </div>

            {result.stats.overloadedCount > 0 && (
              <p style={{ fontSize: 13, color: "#555", marginTop: 12 }}>
                {result.stats.overloadedCount === 1
                  ? "1 agente ya superaba"
                  : `${result.stats.overloadedCount} agentes ya superaban`}{" "}
                el nivel de equilibrio y no recibe
                {result.stats.overloadedCount === 1 ? "" : "n"} minutos
                nuevos
                {result.stats.overloadedWithNewWork > 0
                  ? `, salvo ${result.stats.overloadedWithNewWork} que ` +
                    `debieron cubrir un bloque con varias casillas ` +
                    `porque no había suficientes agentes con cupo.`
                  : "."}
              </p>
            )}

            {result.stats.difference > 1 && (
              <p style={{ fontSize: 13, color: "#b45309", marginTop: 8 }}>
                La diferencia supera 1 minuto porque los bloques con varias
                casillas y las reservas no se pueden repartir en fracciones.
              </p>
            )}

            {/* =================================================
                TABLA
            ================================================= */}

            <div className="table-wrapper">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>
                      Agente
                    </th>

                    <th>
                      Previo
                    </th>

                    <th>
                      Nuevo
                    </th>

                    <th>
                      Total
                    </th>

                    <th>
                      Turnos
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {result.schedule.map(
                    (agent) => {
                      const total =
                        agent.workedMinutes +
                        agent.minutes;

                      return (
                        <tr
                          key={
                            agent.id
                          }
                        >
                          <td
                            style={{
                              padding: 8,
                              verticalAlign:
                                "top",
                            }}
                          >
                            <strong>
                              {
                                agent.name
                              }
                            </strong>

                            <div
                              style={{
                                fontSize: 12,
                                color:
                                  "#777",
                                marginTop: 4,
                              }}
                            >
                              ID{" "}
                              {
                                agent.id
                              }
                            </div>
                          </td>

                          <td
                            style={{
                              padding: 8,
                              verticalAlign:
                                "top",
                            }}
                          >
                            {formatMinutes(
                              agent.workedMinutes
                            )}
                          </td>

                          <td
                            style={{
                              padding: 8,
                              verticalAlign:
                                "top",
                            }}
                          >
                            {formatMinutes(
                              agent.minutes
                            )}
                          </td>

                          <td
                            style={{
                              padding: 8,
                              verticalAlign:
                                "top",
                              fontWeight:
                                700,
                            }}
                          >
                            {formatMinutes(
                              total
                            )}
                          </td>

                          <td
                            style={{
                              padding: 8,
                            }}
                          >
                            {agent.assignments.map(
                              (
                                assignment,
                                index
                              ) => (
                                <div
                                  key={
                                    index
                                  }
                                  className="assignment"
                                >
                                  <span className="assignment-booth">
                                    {
                                      assignment.booth
                                    }
                                  </span>

                                  {" — "}

                                  <span className="assignment-time">
                                    {minutesToTime(
                                      assignment.start
                                    )}{" "}
                                    →
                                    {" "}
                                    {minutesToTime(
                                      assignment.end
                                    )}
                                  </span>

                                  {" — "}

                                  <span>
                                    {
                                      assignment.minutes
                                    }{" "}
                                    min
                                  </span>
                                </div>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            {/* =================================================
                ACCIONES
            ================================================= */}

            <div
              style={{
                marginTop: 20,
              }}
            >
              <button
                className="button button-primary"
                onClick={
                  copyPlainTextSchedule
                }
              >
                📋 Copiar horario para mensaje
              </button>

              <button
                className="button button-danger"
                onClick={
                  resetData
                }
              >
                🗑️ Restablecer datos
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
