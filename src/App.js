import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// =========================================================
// CATÁLOGO FIJO DE CASILLAS
//
// Dos sectores con numeración propia. La demanda ya no se carga
// como una cantidad ("2 casillas"), sino como una selección concreta
// de casillas de estos catálogos (ej: Entrada 3, Entrada 7, Salida 2).
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
//
// Cuando hay varias casillas simultáneas, el agente que llegó antes
// (mayor prioridad = menor carga acumulada, empate por ID) recibe la
// casilla "preferencial" de su sector:
//   - Entrada primero, Salida después.
//   - Dentro de Entrada: de mayor a menor numeración.
//   - Dentro de Salida: de menor a mayor numeración.
// Es un sesgo puramente de etiquetado: no cambia un solo minuto de
// carga horaria, solo decide qué texto queda grabado en el turno.
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

const INITIAL_AGENTS = [{ id: 1, name: "" }];

const INITIAL_DEMAND = [
  {
    id: 1,
    start: "00:00",
    end: "01:00",
    booths: [],
  },
  {
    id: 2,
    start: "01:00",
    end: "05:00",
    booths: [],
  },
  {
    id: 3,
    start: "05:00",
    end: "06:00",
    booths: [],
  },
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

function normalizeAgents(savedAgents) {
  return savedAgents.map((agent) => ({
    ...agent,
    uid: agent.uid || createUid(),
  }));
}

function normalizeDemand(savedDemand) {
  return savedDemand.map((item) => ({
    ...item,
    booths: Array.isArray(item.booths) ? item.booths : [],
  }));
}

function renumberAgents(list) {
  return list.map((agent, index) => ({
    ...agent,
    id: index + 1,
  }));
}

function renumberDemand(list) {
  return list.map((item, index) => ({
    ...item,
    id: index + 1,
  }));
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
  return `${hours}h ${mins}m`;
}

// =========================================================
// VALIDACIÓN
// =========================================================

function validateDemand(agents, demand) {
  if (agents.length === 0) return "Debe existir al menos un agente.";
  if (demand.length === 0) return "Debe existir al menos un intervalo de demanda.";

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
      return `El intervalo ${item.start} → ${item.end} necesita al menos una casilla seleccionada.`;
    }
    if (item.booths.length > agents.length) {
      return (
        `El intervalo ${item.start} → ${item.end} requiere ${item.booths.length} ` +
        `casillas pero solo hay ${agents.length} agentes.`
      );
    }

    const seen = new Set();
    for (const booth of item.booths) {
      const key = boothKey(booth);
      if (seen.has(key)) {
        return `El intervalo ${item.start} → ${item.end} tiene la casilla ${boothLabel(booth)} repetida.`;
      }
      seen.add(key);

      const max = BOOTH_CATALOG[booth.sector];
      if (!max || booth.numero < 1 || booth.numero > max) {
        return `Casilla inválida: ${boothLabel(booth)}.`;
      }
    }
  }

  const sorted = [...normalized].sort((a, b) =>
    a.startMinutes !== b.startMinutes ? a.startMinutes - b.startMinutes : a.id - b.id
  );

  // La demanda es absoluta: no permitimos superposición.
  // Una casilla extra que se abre "en el medio" de otro intervalo no se
  // modela como solapamiento, sino como un intervalo nuevo y adyacente
  // (ej: en vez de "1 casilla 01→05", cargás "1 casilla 01→02",
  // "2 casillas 02→03", "1 casilla 03→05"). El resto del motor no necesita
  // saber que eso es una apertura excepcional: es un intervalo más.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) {
      return (
        `Hay intervalos superpuestos: ${sorted[i - 1].start} → ${sorted[i - 1].end} ` +
        `y ${sorted[i].start} → ${sorted[i].end}`
      );
    }
  }

  return null;
}

function calculateTotalWork(demand) {
  return demand.reduce((total, item) => {
    const duration = timeToMinutes(item.end) - timeToMinutes(item.start);
    return total + duration * item.booths.length;
  }, 0);
}

// =========================================================
// MOTOR NUEVO DE PLANIFICACIÓN
//
// Concepto:
//   1. Se calcula el trabajo total.
//   2. Se determina un objetivo aproximado por agente.
//   3. El último bloque rígido queda RESERVADO.
//   4. El resto del trabajo se distribuye intentando cerrar
//      agentes sin superar su objetivo.
//   5. La prioridad NO es "menos minutos acumulados".
//
// Prioridad de planificación:
//
//   a) No superar el objetivo si existe una alternativa.
//   b) Proteger trabajo reservado.
//   c) Priorizar al agente que está más cerca de cerrar su objetivo.
//   d) En igualdad razonable, menor ID.
//   e) Mantener las preferencias de casilla.
//
// IMPORTANTE:
// El motor distingue:
//
//   minutos       = trabajo ya realizado
//   reserved      = trabajo futuro comprometido
//   remaining     = trabajo que todavía necesita
//
// =========================================================


// =========================================================
// UTILIDADES DE ORDEN
// =========================================================

function sortAgentsById(agents) {
  return [...agents].sort((a, b) => a.id - b.id);
}

function getAgentById(agents, id) {
  return agents.find((agent) => agent.id === id);
}

function hasOverlap(agent, start, end) {
  return agent.assignments.some(
    (assignment) =>
      assignment.start < end &&
      assignment.end > start
  );
}

function canWork(agent, start, end) {
  return !hasOverlap(agent, start, end);
}


// =========================================================
// OBJETIVOS
// =========================================================

function calculateTargets(agents, totalWork) {
  const sorted = sortAgentsById(agents);

  const base = Math.floor(totalWork / sorted.length);
  const remainder = totalWork % sorted.length;

  return new Map(
    sorted.map((agent, index) => [
      agent.id,
      base + (index < remainder ? 1 : 0),
    ])
  );
}


// =========================================================
// ASIGNACIONES
// =========================================================

function addAssignment(agent, start, end, booth) {
  if (end <= start) return;

  const assignments = agent.assignments || [];

  // Si continúa inmediatamente en la misma casilla,
  // fusionamos el tramo.
  const last = assignments.at(-1);

  if (
    last &&
    last.end === start &&
    last.booth === booth
  ) {
    last.end = end;
    last.minutes = last.end - last.start;
    return;
  }

  assignments.push({
    start,
    end,
    booth,
    minutes: end - start,
  });

  agent.assignments = assignments;
}


// =========================================================
// CARGA COMPROMETIDA
// =========================================================
//
// Una reserva futura NO es lo mismo que minutos trabajados.
//
// Ejemplo:
//
// A5:
//   minutos = 0
//   reservados = 60
//
// Para llegar a objetivo 87:
//
//   faltante no reservado = 27
//
// =========================================================

function getReservedMinutes(agent) {
  return agent.reservedMinutes || 0;
}

function getCompletedMinutes(agent) {
  return agent.minutes || 0;
}

function getUnreservedRemaining(agent, target) {
  return Math.max(
    0,
    target - getCompletedMinutes(agent) - getReservedMinutes(agent)
  );
}

function getProjectedLoad(agent) {
  return (
    getCompletedMinutes(agent) +
    getReservedMinutes(agent)
  );
}


// =========================================================
// RESERVA DEL ÚLTIMO BLOQUE RÍGIDO
// =========================================================
//
// El último bloque rígido conocido es especial.
//
// Si tenemos:
//
// 00–01:40 → 2 casillas
// 01:40–05  → 1 casilla
// 05–06     → 2 casillas
//
// reservamos 05–06 para los últimos agentes:
//
// A5
// A6
//
// No se consideran "0 minutos" desde el punto de vista
// de la planificación.
//
// Se consideran:
//
// A5 = 0 realizados + 60 reservados
// A6 = 0 realizados + 60 reservados
//
// =========================================================

function findFinalRigidBlock(sortedDemand) {
  const lastEnd = Math.max(
    ...sortedDemand.map((item) =>
      timeToMinutes(item.end)
    )
  );

  const candidates = sortedDemand
    .filter(
      (item) =>
        timeToMinutes(item.end) === lastEnd &&
        item.booths.length >= 2
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
        timeToMinutes(b.start)
    );

  return candidates.at(-1) || null;
}


// =========================================================
// RESERVAR BLOQUE FINAL
// =========================================================

function reserveFinalBlock(
  agents,
  interval,
  targets
) {
  if (!interval) {
    return {
      reservedPlan: [],
      reservedAgentIds: new Set(),
    };
  }

  const start = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);

  const orderedAgents = sortAgentsById(agents);

  // El bloque final conserva la regla operacional existente:
  //
  // los últimos agentes cubren el bloque final.
  //
  const selected = orderedAgents
    .slice(-interval.booths.length);

  const orderedBooths =
    sortBoothsForAssignment(interval.booths);

  const reservedPlan = [];

  selected
    .sort((a, b) => a.id - b.id)
    .forEach((agent, index) => {
      const booth = orderedBooths[index];

      const duration = end - start;

      agent.reservedMinutes =
        getReservedMinutes(agent) + duration;

      reservedPlan.push({
        agentId: agent.id,
        booth: boothLabel(booth),
        start,
        end,
      });
    });

  return {
    reservedPlan,
    reservedAgentIds: new Set(
      selected.map((agent) => agent.id)
    ),
  };
}


// =========================================================
// PRIORIDAD DE CIERRE
// =========================================================
//
// Esta es una de las diferencias fundamentales respecto
// del motor anterior.
//
// NO:
//
//   menor minutes acumulados
//
// SÍ:
//
//   menor cantidad de minutos NO RESERVADOS que necesita
//   para llegar al objetivo.
//
// Ejemplo:
//
// objetivo = 87
//
// A1 = 60 → necesita 27
// A3 = 40 → necesita 47
// A5 = 0 + 60 reservados → necesita 27
//
// A5 NO gana automáticamente a A3 solamente por tener
// 0 minutos realizados.
//
// La reserva futura ya forma parte de su objetivo.
//
// =========================================================

function getPlanningPriority(agent, targets) {
  const target = targets.get(agent.id);

  const remaining = getUnreservedRemaining(
    agent,
    target
  );

  return {
    agent,
    remaining,
    projectedLoad: getProjectedLoad(agent),
  };
}


// =========================================================
// SELECCIÓN DE AGENTE PARA CASILLA ÚNICA
// =========================================================
//
// La prioridad es:
//
// 1. agente que puede cerrar su objetivo exactamente
//    o acercarse sin pasarlo;
//
// 2. menor faltante;
//
// 3. menor ID.
//
// La carga acumulada NO es el criterio principal.
//
// =========================================================


// =========================================================
// ASIGNACIÓN DE INTERVALO FLEXIBLE
// =========================================================
//
// Una casilla puede ser repartida.
//
// No utilizamos simplemente:
//
//   "doy todo el bloque al primero"
//
// El tramo se corta cuando el agente llega a su objetivo.
//
// =========================================================

function assignFlexibleInterval(
  agents,
  interval,
  targets
) {
  let current = timeToMinutes(interval.start);
  const intervalEnd = timeToMinutes(interval.end);

  const booth = boothLabel(interval.booths[0]);

  while (current < intervalEnd) {
    const slotStart = current;
    const slotEnd = intervalEnd;

    const remainingInterval =
      slotEnd - slotStart;

    const candidates = agents
      .filter((agent) =>
        canWork(
          agent,
          slotStart,
          slotEnd
        )
      )
      .map((agent) => ({
        agent,
        remaining:
          getUnreservedRemaining(
            agent,
            targets.get(agent.id)
          ),
      }))
      .filter(
        ({ remaining }) =>
          remaining > 0
      );

    let selected;

    if (candidates.length > 0) {
      selected = candidates.sort(
        (a, b) => {
          if (
            a.remaining !==
            b.remaining
          ) {
            return (
              a.remaining -
              b.remaining
            );
          }

          return (
            a.agent.id -
            b.agent.id
          );
        }
      )[0];
    } else {
      const fallback =
        agents
          .filter((agent) =>
            canWork(
              agent,
              slotStart,
              slotEnd
            )
          )
          .sort(
            (a, b) => {
              const loadA =
                getProjectedLoad(a);

              const loadB =
                getProjectedLoad(b);

              if (
                loadA !== loadB
              ) {
                return (
                  loadA -
                  loadB
                );
              }

              return (
                a.id -
                b.id
              );
            }
          )[0];

      if (!fallback) {
        break;
      }

      selected = {
        agent: fallback,
        remaining: Infinity,
      };
    }

    const duration =
      Math.min(
        selected.remaining,
        remainingInterval
      );

    if (duration <= 0) {
      break;
    }

    addAssignment(
      selected.agent,
      slotStart,
      slotStart + duration,
      booth
    );

    selected.agent.minutes +=
      duration;

    current =
      slotStart + duration;
  }
}

// =========================================================
// ASIGNACIÓN DE BLOQUE RÍGIDO NO FINAL
// =========================================================
//
// Los bloques rígidos que NO son el bloque final se
// consideran trabajo real.
//
// Para seleccionar agentes utilizamos:
//
//   1. menor carga proyectada;
//   2. menor ID.
//
// Pero NO se utiliza esta fase para decidir toda la noche.
// El objetivo es registrar la carga comprometida.
//
// =========================================================

function assignRigidInterval(
  agents,
  interval,
  targets
) {
  const start = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);
  const duration = end - start;

  const available = agents.filter((agent) =>
    canWork(agent, start, end)
  );

  if (
    available.length <
    interval.booths.length
  ) {
    return false;
  }

  const selected = available
    .sort(
      (a, b) => {
        const loadA =
          getProjectedLoad(a);

        const loadB =
          getProjectedLoad(b);

        if (loadA !== loadB) {
          return loadA - loadB;
        }

        return a.id - b.id;
      }
    )
    .slice(0, interval.booths.length);

  const orderedAgents =
    [...selected].sort(
      (a, b) => a.id - b.id
    );

  const orderedBooths =
    sortBoothsForAssignment(
      interval.booths
    );

  orderedAgents.forEach(
    (agent, index) => {
      const booth = orderedBooths[index];

      addAssignment(
        agent,
        start,
        end,
        boothLabel(booth)
      );

      agent.minutes += duration;
    }
  );

  return true;
}


// =========================================================
// NORMALIZAR DEMANDA EN ORDEN CRONOLÓGICO
// =========================================================

function normalizeSortedDemand(demand) {
  return [...demand].sort(
    (a, b) => {
      const startA =
        timeToMinutes(a.start);

      const startB =
        timeToMinutes(b.start);

      if (startA !== startB) {
        return startA - startB;
      }

      return a.id - b.id;
    }
  );
}


// =========================================================
// PLANIFICADOR COMPLETO
// =========================================================
//
// Esta función reemplaza el antiguo:
//
//   planRigidBlocks()
//   applyRigidPlan()
//   assignFlexibleInterval()
//
// No hay:
//
//   "todos los rígidos primero y luego todos los flexibles".
//
// El trabajo se procesa cronológicamente.
//
// La única excepción deliberada es el bloque final:
//
//   ese bloque se reserva primero.
//
// =========================================================

export function generateSchedule(
  agentsInput,
  demand
) {
  const error =
    validateDemand(
      agentsInput,
      demand
    );

  if (error) {
    return {
      error,
      schedule: [],
      stats: null,
    };
  }

  const agents =
    agentsInput.map(
      (agent) => ({
        ...agent,
        minutes: 0,
        reservedMinutes: 0,
        assignments: [],
      })
    );

  const sortedDemand =
    normalizeSortedDemand(demand);

  const totalWork =
    calculateTotalWork(
      sortedDemand
    );

  const targets =
    calculateTargets(
      agents,
      totalWork
    );

  // =======================================================
  // 1. IDENTIFICAR Y RESERVAR EL BLOQUE FINAL
  // =======================================================

  const finalRigid =
    findFinalRigidBlock(
      sortedDemand
    );

  const {
    reservedPlan,
    reservedAgentIds,
  } = reserveFinalBlock(
    agents,
    finalRigid,
    targets
  );

  // =======================================================
  // 2. PROCESAR LA DEMANDA REAL CRONOLÓGICAMENTE
  //
  // El bloque final no se vuelve a asignar.
  // Los demás sí.
  // =======================================================

  for (const interval of sortedDemand) {
    if (
      finalRigid &&
      interval.id === finalRigid.id
    ) {
      continue;
    }

    if (interval.booths.length === 1) {
      assignFlexibleInterval(
        agents,
        interval,
        targets
      );

      continue;
    }

    const success =
      assignRigidInterval(
        agents,
        interval,
        targets
      );

    if (!success) {
      return {
        error:
          `No hay suficientes agentes disponibles para cubrir ` +
          `${interval.start} → ${interval.end}.`,
        schedule: [],
        stats: null,
      };
    }
  }

  // =======================================================
  // 3. MATERIALIZAR LAS RESERVAS
  //
  // Se agregan después de procesar el resto para no
  // confundirlas con trabajo ya realizado.
  // =======================================================

  for (const item of reservedPlan) {
    const agent =
      getAgentById(
        agents,
        item.agentId
      );

    if (!agent) continue;

    addAssignment(
      agent,
      item.start,
      item.end,
      item.booth
    );

    // IMPORTANTE:
    // reservedMinutes YA fue contabilizado arriba.
    // No lo sumamos nuevamente a minutes.
  }

  // =======================================================
  // 4. ORDEN CRONOLÓGICO
  // =======================================================

  for (const agent of agents) {
    agent.assignments.sort(
      (a, b) => {
        if (a.start !== b.start) {
          return a.start - b.start;
        }

        return a.end - b.end;
      }
    );
  }

  // =======================================================
  // 5. CARGA PROYECTADA
  // =======================================================

  const projectedLoads =
    agents.map(
      (agent) =>
        getProjectedLoad(agent)
    );

  const minMinutes =
    Math.min(...projectedLoads);

  const maxMinutes =
    Math.max(...projectedLoads);
const validationError =
  validateGeneratedSchedule(
    agents,
    sortedDemand
  );

if (validationError) {
  return {
    error: validationError,
    schedule: [],
    stats: null,
  };
}

  // =======================================================
  // 6. ESTADÍSTICAS
  // =======================================================

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,

      target:
        totalWork /
        agents.length,

      minMinutes,

      maxMinutes,

      difference:
        maxMinutes -
        minMinutes,

      targets:
        Object.fromEntries(
          targets
        ),

      projectedLoads:
        Object.fromEntries(
          agents.map(
            (agent) => [
              agent.id,
              getProjectedLoad(agent),
            ]
          )
        ),

      reserved:
        Object.fromEntries(
          agents.map(
            (agent) => [
              agent.id,
              getReservedMinutes(agent),
            ]
          )
        ),
    },

    meta: {
      finalRigidBlock:
        finalRigid
          ? {
              id: finalRigid.id,
              start: finalRigid.start,
              end: finalRigid.end,
              booths:
                finalRigid.booths,
            }
          : null,

      reservedAgentIds:
        [...reservedAgentIds],
    },
  };
}


// =========================================================
// PLANIFICADOR FINAL A PARTIR DE UNA SITUACIÓN REAL
// =========================================================
//
// Esta función es la pieza que vamos a utilizar cuando
// implementemos el modo operativo.
//
// Permite decir:
//
// "Esto es lo que REALMENTE ocurrió hasta las 01:40."
//
// Ejemplo:
//
// A1 = 60
// A2 = 60
// A3 = 40
// A4 = 40
// A5 = 0
// A6 = 0
//
// y:
//
// A5/A6 tienen 60 minutos reservados 05–06.
//
// El motor NO vuelve a inventar lo ocurrido.
// Parte de esa realidad.
//
// =========================================================

export function generateFinalSchedule(
  agentsInput,
  demand,
  actualState
) {
  const error =
    validateDemand(
      agentsInput,
      demand
    );

  if (error) {
    return {
      error,
      schedule: [],
      stats: null,
    };
  }

  const agents =
    agentsInput.map(
      (agent) => {
        const state =
          actualState?.[agent.id] ||
          {};

        return {
          ...agent,

          minutes:
            Number(
              state.minutes || 0
            ),

          reservedMinutes:
            Number(
              state.reservedMinutes || 0
            ),

          assignments:
            Array.isArray(
              state.assignments
            )
              ? state.assignments.map(
                  (assignment) => ({
                    ...assignment,
                  })
                )
              : [],
        };
      }
    );

  const sortedDemand =
    normalizeSortedDemand(demand);

  const totalWork =
    calculateTotalWork(
      sortedDemand
    );

  const targets =
    calculateTargets(
      agents,
      totalWork
    );

  // -------------------------------------------------------
  // Determinamos cuánto trabajo ya está realizado.
  //
  // El trabajo reservado NO se vuelve a contabilizar.
  // -------------------------------------------------------

  for (const agent of agents) {
    agent.minutes =
      agent.assignments.reduce(
        (total, assignment) =>
          total +
          (
            assignment.minutes ??
            (
              assignment.end -
              assignment.start
            )
          ),
        0
      );
  }

  // -------------------------------------------------------
  // Si el estado real ya contiene reservas, las respetamos.
  // -------------------------------------------------------

  const finalRigid =
    findFinalRigidBlock(
      sortedDemand
    );

  const finalStart =
    finalRigid
      ? timeToMinutes(
          finalRigid.start
        )
      : null;

  // -------------------------------------------------------
  // El trabajo que queda antes del bloque final se planifica
  // usando la carga REAL.
  // -------------------------------------------------------

  for (const interval of sortedDemand) {
    const start =
      timeToMinutes(
        interval.start
      );

    // El bloque final ya está reservado.
    if (
      finalRigid &&
      interval.id === finalRigid.id
    ) {
      continue;
    }

    // No reconstruimos acontecimientos anteriores al
    // momento indicado por el estado real.
    //
    // Si ya existen assignments allí, simplemente quedan.
    if (
      finalStart !== null &&
      start >= finalStart
    ) {
      continue;
    }

    if (
      interval.booths.length === 1
    ) {
      assignFlexibleInterval(
        agents,
        interval,
        targets
      );
    } else {
      const success =
        assignRigidInterval(
          agents,
          interval,
          targets
        );

      if (!success) {
        return {
          error:
            `No se puede completar la planificación ` +
            `del intervalo ${interval.start} → ${interval.end}.`,
          schedule: [],
          stats: null,
        };
      }
    }
  }

  // -------------------------------------------------------
  // Orden final
  // -------------------------------------------------------

  for (const agent of agents) {
    agent.assignments.sort(
      (a, b) =>
        a.start - b.start
    );
  }

  const loads =
    agents.map(
      (agent) =>
        agent.minutes +
        agent.reservedMinutes
    );

  const minMinutes =
    Math.min(...loads);

  const maxMinutes =
    Math.max(...loads);
  const validationError =
  validateGeneratedSchedule(
    agents,
    sortedDemand
  );

if (validationError) {
  return {
    error: validationError,
    schedule: [],
    stats: null,
  };
}

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,

      target:
        totalWork /
        agents.length,

      minMinutes,

      maxMinutes,

      difference:
        maxMinutes -
        minMinutes,

      targets:
        Object.fromEntries(
          targets
        ),
    },
  };
}


// =========================================================
// VALIDACIÓN FINAL
// =========================================================

function validateGeneratedSchedule(
  agents,
  demand
) {
  for (const interval of demand) {
    const start =
      timeToMinutes(
        interval.start
      );

    const end =
      timeToMinutes(
        interval.end
      );

    for (
      let minute = start;
      minute < end;
      minute++
    ) {
      let activeCount = 0;

      for (const agent of agents) {
        const active =
          agent.assignments.filter(
            (assignment) =>
              assignment.start <= minute &&
              assignment.end > minute
          );

        if (active.length > 1) {
          return (
            `El agente ${agent.name} ` +
            `está asignado a más de una ` +
            `casilla simultáneamente.`
          );
        }

        activeCount +=
          active.length;
      }

      if (
        activeCount !==
        interval.booths.length
      ) {
        return (
          `La demanda ${interval.start} → ` +
          `${interval.end} requiere ` +
          `${interval.booths.length} casillas, ` +
          `pero el minuto ${minutesToTime(minute)} ` +
          `tiene ${activeCount} asignadas.`
        );
      }
    }
  }

  return null;
}

// =========================================================
// COMPONENTE REACT
// =========================================================

function BoothPicker({ sector, count, selected, onToggle }) {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>
        {SECTOR_LABEL[sector]}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {numbers.map((numero) => {
          const isActive = selected.some((b) => b.sector === sector && b.numero === numero);
          return (
            <button
              key={numero}
              type="button"
              onClick={() => onToggle(sector, numero)}
              style={{
                minWidth: 30,
                height: 30,
                borderRadius: 6,
                border: isActive ? "1px solid #2563eb" : "1px solid #ccc",
                background: isActive ? "#2563eb" : "#fff",
                color: isActive ? "#fff" : "#333",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {numero}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function generatePlainTextSchedule(schedule) {
  // Obtener todos los puntos donde comienza o termina algún turno.
  const timePoints = [
    ...new Set(
      schedule.flatMap((agent) =>
        agent.assignments.flatMap((assignment) => [
          assignment.start,
          assignment.end,
        ])
      )
    ),
  ].sort((a, b) => a - b);

  const rows = [];

  for (let i = 0; i < timePoints.length - 1; i++) {
    const start = timePoints[i];
    const end = timePoints[i + 1];

    // Buscar todos los agentes que están trabajando durante este bloque.
    const active = schedule
      .map((agent) => {
        const assignment = agent.assignments.find(
          (a) => a.start <= start && a.end >= end
        );

        if (!assignment) return null;

        return {
          agent: agent.name,
          booth: assignment.booth,
        };
      })
      .filter(Boolean);

    if (active.length === 0) continue;

    // Si exactamente la misma asignación continúa, podemos fusionar
    // posteriormente los bloques.
    rows.push({
      start,
      end,
      active,
    });
  }

  // Fusionar intervalos consecutivos cuando tienen exactamente
  // los mismos agentes/casillas.
  const mergedRows = [];

  for (const row of rows) {
    const previous = mergedRows[mergedRows.length - 1];

    const sameAssignments =
      previous &&
      JSON.stringify(previous.active) === JSON.stringify(row.active) &&
      previous.end === row.start;

    if (sameAssignments) {
      previous.end = row.end;
    } else {
      mergedRows.push({ ...row });
    }
  }

  const lines = ["Guardia Nocturna","Hora -> Agente|Casilla"];

  for (const row of mergedRows) {
    const time = `${minutesToShortTime(row.start)}-${minutesToShortTime(row.end)}`;

    const assignments = row.active
      .map(({ agent, booth }) => `${agent}/${boothAbbrev(booth)}`)
      .join("|");

    lines.push(`${time} ${assignments}`);
  }

  return lines.join("\n");
}

export default function App() {
  const [agents, setAgents] = useState(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.agents);

    if (saved) {
      return normalizeAgents(JSON.parse(saved));
    }

    return normalizeAgents(
      INITIAL_AGENTS.map((agent) => ({
        ...agent,
        uid: createUid(),
      }))
    );
  } catch (error) {
    console.error("No se pudieron cargar los agentes:", error);

    return normalizeAgents(
      INITIAL_AGENTS.map((agent) => ({
        ...agent,
        uid: createUid(),
      }))
    );
  }
});

const [demand, setDemand] = useState(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.demand);

    if (saved) {
      return normalizeDemand(JSON.parse(saved));
    }

    return INITIAL_DEMAND;
  } catch (error) {
    console.error("No se pudo cargar la demanda:", error);
    return INITIAL_DEMAND;
  }
});

  const agentInputRefs = useRef({});
const demandStartRefs = useRef({});
const demandEndRefs = useRef({});

const draggedAgentUid = useRef(null);
const draggedDemandId = useRef(null);

useEffect(() => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.agents,
      JSON.stringify(agents)
    );
  } catch (error) {
    console.error("No se pudieron guardar los agentes:", error);
  }
}, [agents]);

useEffect(() => {
  try {
    localStorage.setItem(
      STORAGE_KEYS.demand,
      JSON.stringify(demand)
    );
  } catch (error) {
    console.error("No se pudo guardar la demanda:", error);
  }
}, [demand]);

  function resetData() {
  const confirmed = window.confirm(
    "¿Querés borrar todos los agentes y horarios y volver a los valores iniciales?"
  );

  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEYS.agents);
  localStorage.removeItem(STORAGE_KEYS.demand);

 setAgents(
  INITIAL_AGENTS.map((agent) => ({
    ...agent,
    uid: createUid(),
  }))
);
  setDemand(INITIAL_DEMAND);
}
  const result = useMemo(() => generateSchedule(agents, demand), [agents, demand]);

  function focusAgent(uid) {
  requestAnimationFrame(() => {
    agentInputRefs.current[uid]?.focus();
    agentInputRefs.current[uid]?.select();
  });
}

function addAgent() {
  const newAgent = {
    uid: createUid(),
    id: agents.length + 1,
    name: `Agente ${agents.length + 1}`,
  };

  setAgents((current) => [...current, newAgent]);

  focusAgent(newAgent.uid);
}

function removeAgent(id) {
  setAgents((current) => {
    const updated = current.filter((agent) => agent.id !== id);
    return renumberAgents(updated);
  });
}

function updateAgent(id, name) {
  setAgents((current) =>
    current.map((agent) =>
      agent.id === id ? { ...agent, name } : agent
    )
  );
}

function handleAgentKeyDown(event, agent) {
  if (event.key !== "Enter") return;

  event.preventDefault();

  const index = agents.findIndex((item) => item.uid === agent.uid);

  // Enter en el último agente → crear uno nuevo.
  if (index === agents.length - 1) {
    addAgent();
    return;
  }

  // Enter en un agente existente → siguiente agente.
  const nextAgent = agents[index + 1];

  focusAgent(nextAgent.uid);
}

  function reorderAgents(sourceUid, targetUid) {
  if (!sourceUid || !targetUid || sourceUid === targetUid) return;

  setAgents((current) => {
    const sourceIndex = current.findIndex(
      (agent) => agent.uid === sourceUid
    );

    const targetIndex = current.findIndex(
      (agent) => agent.uid === targetUid
    );

    if (sourceIndex === -1 || targetIndex === -1) {
      return current;
    }

    const updated = [...current];
    const [moved] = updated.splice(sourceIndex, 1);

    updated.splice(targetIndex, 0, moved);

    return renumberAgents(updated);
  });
}

function moveAgent(agentUid, direction) {
  setAgents((current) => {
    const index = current.findIndex(
      (agent) => agent.uid === agentUid
    );

    if (index === -1) return current;

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= current.length) {
      return current;
    }

    const updated = [...current];
    [updated[index], updated[targetIndex]] = [
      updated[targetIndex],
      updated[index],
    ];

    return renumberAgents(updated);
  });

  requestAnimationFrame(() => {
    agentInputRefs.current[agentUid]?.focus();
  });
}

function handleAgentDragStart(event, agent) {
  draggedAgentUid.current = agent.uid;

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", agent.uid);
}

function handleAgentDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleAgentDrop(event, targetAgent) {
  event.preventDefault();

  const sourceUid =
    event.dataTransfer.getData("text/plain") ||
    draggedAgentUid.current;

  reorderAgents(sourceUid, targetAgent.uid);

  draggedAgentUid.current = null;
}

function handleAgentDragEnd() {
  draggedAgentUid.current = null;
}

  function focusDemandStart(id) {
  requestAnimationFrame(() => {
    demandStartRefs.current[id]?.focus();
  });
}

function focusDemandEnd(id) {
  requestAnimationFrame(() => {
    demandEndRefs.current[id]?.focus();
  });
}

function addDemand() {
  const lastDemand = demand[demand.length - 1];

  const newDemand = {
    id: demand.length + 1,
    start: lastDemand?.end || "00:00",
    end: lastDemand?.end || "01:00",
    booths: [],
  };

  setDemand((current) => [...current, newDemand]);

  focusDemandStart(newDemand.id);
}

function removeDemand(id) {
  setDemand((current) => {
    const updated = current.filter((item) => item.id !== id);
    return renumberDemand(updated);
  });
}

function updateDemand(id, field, value) {
  setDemand((current) =>
    current.map((item) =>
      item.id === id
        ? { ...item, [field]: value }
        : item
    )
  );
}

function handleDemandStartKeyDown(event, item) {
  if (event.key !== "Enter") return;

  event.preventDefault();

  focusDemandEnd(item.id);
}

function handleDemandEndKeyDown(event, item) {
  if (event.key !== "Enter") return;

  event.preventDefault();

  const index = demand.findIndex(
    (current) => current.id === item.id
  );

  // Si no es la última demanda, ir a la siguiente.
  if (index < demand.length - 1) {
    focusDemandStart(demand[index + 1].id);
    return;
  }

  // Si es la última, crear otra.
  addDemand();
}

  function reorderDemand(sourceId, targetId) {
  if (sourceId === targetId) return;

  setDemand((current) => {
    const sourceIndex = current.findIndex(
      (item) => item.id === sourceId
    );

    const targetIndex = current.findIndex(
      (item) => item.id === targetId
    );

    if (sourceIndex === -1 || targetIndex === -1) {
      return current;
    }

    const updated = [...current];
    const [moved] = updated.splice(sourceIndex, 1);

    updated.splice(targetIndex, 0, moved);

    return renumberDemand(updated);
  });
}

function moveDemand(id, direction) {
  setDemand((current) => {
    const index = current.findIndex(
      (item) => item.id === id
    );

    if (index === -1) return current;

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= current.length) {
      return current;
    }

    const updated = [...current];

    [updated[index], updated[targetIndex]] = [
      updated[targetIndex],
      updated[index],
    ];

    return renumberDemand(updated);
  });

  requestAnimationFrame(() => {
    demandStartRefs.current[id]?.focus();
  });
}

function handleDemandDragStart(event, item) {
  draggedDemandId.current = item.id;

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(
    "text/plain",
    String(item.id)
  );
}

function handleDemandDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleDemandDrop(event, targetItem) {
  event.preventDefault();

  const sourceId = Number(
    event.dataTransfer.getData("text/plain")
  ) || draggedDemandId.current;

  reorderDemand(sourceId, targetItem.id);

  draggedDemandId.current = null;
}

function handleDemandDragEnd() {
  draggedDemandId.current = null;
}

  function toggleBooth(demandId, sector, numero) {
    setDemand(
      demand.map((item) => {
        if (item.id !== demandId) return item;
        const exists = item.booths.some((b) => b.sector === sector && b.numero === numero);
        const booths = exists
          ? item.booths.filter((b) => !(b.sector === sector && b.numero === numero))
          : [...item.booths, { sector, numero }];
        return { ...item, booths };
      })
    );
  }

  async function copyPlainTextSchedule() {
    if (!result.schedule?.length) return;
    const text = generatePlainTextSchedule(result.schedule);
    try {
      await navigator.clipboard.writeText(text);
      alert("Horario copiado al portapapeles.");
    } catch (error) {
      console.error("No se pudo copiar el horario:", error);
      alert("No se pudo copiar el horario.");
    }
  }
  
  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>Gestión de horarios</h1>
          <p>Distribución automática de agentes y casillas</p>
        </header>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Agentes</h2>
              <p className="card-description">El ID determina el orden de llegada.</p>
            </div>
          </div>
          <div className="agent-list">
            {agents.map((agent, index) => (
              <div
                key={agent.uid}
                className="agent-row"
                draggable
                onDragStart={(event) => handleAgentDragStart(event, agent)}
                onDragOver={handleAgentDragOver}
                onDrop={(event) => handleAgentDrop(event, agent)}
                onDragEnd={handleAgentDragEnd}
                style={{
                  cursor: "grab",
                }}
              >
                <div
          className="agent-number"
      title="Arrastrar para cambiar el orden"
      aria-label={`Agente ${agent.id}. Arrastrar para cambiar el orden.`}
    >
      ⋮⋮
    </div>

    <div
      style={{
        minWidth: 28,
        textAlign: "center",
        fontWeight: 700,
      }}
    >
      {agent.id}
    </div>

    <input
      ref={(element) => {
        agentInputRefs.current[agent.uid] = element;
      }}
      className="input input-name"
      value={agent.name}
      placeholder={`Agente ${agent.id}`}
      autoFocus={index === 0}
      onChange={(event) =>
        updateAgent(agent.id, event.target.value)
      }
      onKeyDown={(event) =>
        handleAgentKeyDown(event, agent)
      }
      aria-label={`Nombre del agente ${agent.id}`}
    />

    <button
      type="button"
      className="button button-secondary"
      onClick={() => moveAgent(agent.uid, -1)}
      disabled={index === 0}
      aria-label={`Subir agente ${agent.id}`}
      title="Subir"
    >
      ↑
    </button>

    <button
      type="button"
      className="button button-secondary"
      onClick={() => moveAgent(agent.uid, 1)}
      disabled={index === agents.length - 1}
      aria-label={`Bajar agente ${agent.id}`}
      title="Bajar"
    >
      ↓
    </button>

    <button
      type="button"
      className="button button-danger"
      onClick={() => removeAgent(agent.id)}
    >
      Eliminar
    </button>
  </div>
))}
          </div>

          <button className="button button-primary" onClick={addAgent}>
            + Agregar agente
          </button>
        </section>

        <section style={{ marginTop: 40 }}>
          <h2>Horarios de casillas</h2>
          <p>
            Los bloques con varias casillas se mantienen completos. Las casillas
            individuales se utilizan posteriormente para completar los minutos
            faltantes, respetando el orden de llegada. Al elegir casilla el que
            llega primero recibe la preferencial de cada sector (Entrada: mayor
            numeración primero; Salida: menor numeración primero).
          </p>
<div className="demand-list">
  {demand.map((item, index) => (
    <div
      key={item.id}
      className="demand-row"
      draggable
      onDragStart={(event) =>
        handleDemandDragStart(event, item)
      }
      onDragOver={handleDemandDragOver}
      onDrop={(event) =>
        handleDemandDrop(event, item)
      }
      onDragEnd={handleDemandDragEnd}
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        cursor: "grab",
      }}
    >
      {/* CABECERA DEL INTERVALO */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* Indicador de drag */}
        <div
          title="Arrastrar para cambiar el orden"
          aria-label={`Intervalo ${item.id}. Arrastrar para cambiar el orden.`}
          style={{
            fontWeight: 700,
            minWidth: 20,
            cursor: "grab",
            userSelect: "none",
            color: "#777",
          }}
        >
          ⋮⋮
        </div>

        {/* Número del intervalo */}
        <strong style={{ minWidth: 24 }}>
          {item.id}
        </strong>

        {/* INICIO */}
        <input
          ref={(element) => {
            demandStartRefs.current[item.id] = element;
          }}
          className="input input-time"
          type="time"
          value={item.start}
          onChange={(event) =>
            updateDemand(item.id, "start", event.target.value)
          }
          onKeyDown={(event) =>
            handleDemandStartKeyDown(event, item)
          }
          aria-label={`Comienzo del intervalo ${item.id}`}
        />

        <span className="time-arrow">→</span>

        {/* FIN */}
        <input
          ref={(element) => {
            demandEndRefs.current[item.id] = element;
          }}
          className="input input-time"
          type="time"
          value={item.end}
          onChange={(event) =>
            updateDemand(item.id, "end", event.target.value)
          }
          onKeyDown={(event) =>
            handleDemandEndKeyDown(event, item)
          }
          aria-label={`Final del intervalo ${item.id}`}
        />

        {/* Cantidad de casillas */}
        <span
          style={{
            fontSize: 12,
            color: "#777",
          }}
        >
          {item.booths.length} casilla
          {item.booths.length === 1 ? "" : "s"} seleccionada
          {item.booths.length === 1 ? "" : "s"}
        </span>

        {/* SUBIR */}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => moveDemand(item.id, -1)}
          disabled={index === 0}
          aria-label={`Subir intervalo ${item.id}`}
          title="Subir"
        >
          ↑
        </button>

        {/* BAJAR */}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => moveDemand(item.id, 1)}
          disabled={index === demand.length - 1}
          aria-label={`Bajar intervalo ${item.id}`}
          title="Bajar"
        >
          ↓
        </button>

        {/* ELIMINAR */}
        <button
          type="button"
          className="button button-danger"
          style={{ marginLeft: "auto" }}
          onClick={() => removeDemand(item.id)}
        >
          Eliminar
        </button>
      </div>

      {/* SELECTOR DE CASILLAS */}
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <BoothPicker
          sector="entrada"
          count={BOOTH_CATALOG.entrada}
          selected={item.booths}
          onToggle={(sector, numero) =>
            toggleBooth(item.id, sector, numero)
          }
        />

        <BoothPicker
          sector="salida"
          count={BOOTH_CATALOG.salida}
          selected={item.booths}
          onToggle={(sector, numero) =>
            toggleBooth(item.id, sector, numero)
          }
        />
      </div>
    </div>
  ))}
</div>

          <button className="button button-secondary" onClick={addDemand}>
            + Agregar intervalo
          </button>
        </section>

        {result.error && <div className="error">{result.error}</div>}

        {result.stats && (
          <section style={{ marginTop: 40 }}>
            <h2>Resultado</h2>

            <div className="stats">
              <div className="stat">
                <div className="stat-label">Demanda total</div>
                <div className="stat-value">{formatMinutes(result.stats.totalWork)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Objetivo por agente</div>
                <div className="stat-value">{result.stats.target.toFixed(1)} min</div>
              </div>
              <div className="stat">
                <div className="stat-label">Menor carga</div>
                <div className="stat-value">{formatMinutes(result.stats.minMinutes)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Diferencia máxima</div>
                <div
                  className={`stat-value ${result.stats.difference <= 1 ? "good" : "warning"}`}
                >
                  {result.stats.difference} min
                </div>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>Agente</th>
                    <th>Total</th>
                    <th>Turnos</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((agent) => (
                    <tr key={agent.id}>
                      <td style={{ padding: 8, verticalAlign: "top" }}>
                        <strong>{agent.name}</strong>
                        <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                          ID {agent.id}
                        </div>
                      </td>
                      <td style={{ padding: 8, verticalAlign: "top" }}>
                        {formatMinutes(agent.minutes)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {agent.assignments.map((assignment, index) => (
                          <div key={index} className="assignment">
                            <span className="assignment-booth">{assignment.booth}</span>
                            {" — "}
                            <span className="assignment-time">
                              {minutesToTime(assignment.start)} → {minutesToTime(assignment.end)}
                            </span>
                            {" — "}
                            <span>{assignment.minutes} min</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
                    <div style={{ marginTop: 20 }}>
  <button
    className="button button-primary"
    onClick={copyPlainTextSchedule}
  >
    📋 Copiar horario para mensaje
  </button>
      <button
  className="button button-danger"
  onClick={resetData}
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
