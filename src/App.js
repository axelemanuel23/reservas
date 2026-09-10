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

const INITIAL_AGENTS = [
  {
    id: 1,
    name: "",
    workedMinutes: 0,
  },
];

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
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");

  const mins = (minutes % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${mins}`;
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins} min`;

  if (mins === 0) {
    return `${hours}h`;
  }

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

      if (
        !max ||
        booth.numero < 1 ||
        booth.numero > max
      ) {
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
    if (
      sorted[i].startMinutes <
      sorted[i - 1].endMinutes
    ) {
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
// IMPORTANTE:
//
// demandWork = solamente los minutos de la planificación actual.
//
// historicalWork = minutos ya trabajados previamente.
//
// globalWork = historicalWork + demandWork.
//
// El objetivo se calcula sobre globalWork.
// =========================================================

function calculateDemandWork(demand) {
  return demand.reduce((total, item) => {
    const duration =
      timeToMinutes(item.end) -
      timeToMinutes(item.start);

    return total + duration * item.booths.length;
  }, 0);
}

function calculateHistoricalWork(agents) {
  return agents.reduce(
    (total, agent) =>
      total + normalizeWorkedMinutes(agent.workedMinutes),
    0
  );
}

function calculateGlobalWork(agents, demand) {
  return (
    calculateHistoricalWork(agents) +
    calculateDemandWork(demand)
  );
}

// =========================================================
// OBJETIVOS
// =========================================================

function calculateTargets(agents, globalWork) {
  const sortedById = [...agents].sort(
    (a, b) => a.id - b.id
  );

  const base = Math.floor(
    globalWork / sortedById.length
  );

  const remainder =
    globalWork % sortedById.length;

  return new Map(
    sortedById.map((agent, index) => [
      agent.id,
      base + (index < remainder ? 1 : 0),
    ])
  );
}

// =========================================================
// IDENTIFICACIÓN DE RESERVAS
// =========================================================

function getFinalRigidInterval(demand) {
  const lastDemandEnd = Math.max(
    ...demand.map((item) =>
      timeToMinutes(item.end)
    )
  );

  const candidate = [...demand]
    .filter((item) => item.booths.length >= 2)
    .sort(
      (a, b) =>
        timeToMinutes(b.end) -
        timeToMinutes(a.end)
    )
    .find(
      (item) =>
        timeToMinutes(item.end) ===
        lastDemandEnd
    );

  if (!candidate) return null;

  const candidateStart = timeToMinutes(
    candidate.start
  );

  const hasPreviousDemand = demand.some(
    (item) =>
      timeToMinutes(item.start) <
      candidateStart
  );

  return hasPreviousDemand ? candidate : null;
}

// =========================================================
// SELECCIÓN DE AGENTES
// =========================================================

function pickLeastLoaded(
  agents,
  loadOf,
  quantity,
  tieBreak = "asc"
) {
  const tieBreakSign =
    tieBreak === "desc" ? -1 : 1;

  return [...agents]
    .sort((a, b) => {
      const diff =
        loadOf(a) - loadOf(b);

      return diff !== 0
        ? diff
        : tieBreakSign *
            (a.id - b.id);
    })
    .slice(0, quantity);
}

// =========================================================
// ASIGNACIONES
// =========================================================

function addAssignment(
  agent,
  start,
  end,
  booth
) {
  if (end <= start) return;

  const last =
    agent.assignments[
      agent.assignments.length - 1
    ];

  if (
    last &&
    last.end === start &&
    last.booth === booth
  ) {
    last.end = end;
    last.minutes += end - start;
    return;
  }

  agent.assignments.push({
    start,
    end,
    booth,
    minutes: end - start,
  });
}

// =========================================================
// FASE 1 — ROTACIÓN MULTICASILLA
// =========================================================

function planMultiBoothBlocks(
  agents,
  demand
) {
  const plan = [];

  const load = new Map(
    agents.map((agent) => [
      agent.id,
      0,
    ])
  );

  const finalRigid =
    getFinalRigidInterval(demand);

  const intervals = [...demand]
    .filter(
      (item) =>
        item.booths.length >= 2
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
          timeToMinutes(b.start) ||
        a.id - b.id
    );

  for (const interval of intervals) {
    const start = timeToMinutes(
      interval.start
    );

    const end = timeToMinutes(
      interval.end
    );

    const isFinal =
      finalRigid &&
      interval.id === finalRigid.id;

    const booths =
      sortBoothsForAssignment(
        interval.booths
      );

    if (isFinal) {
      // Reserva final.
      //
      // Se mantiene exactamente la regla original:
      // los IDs más altos reciben esta reserva.

      const selected = [...agents]
        .sort((a, b) => b.id - a.id)
        .slice(0, booths.length)
        .sort((a, b) => a.id - b.id);

      selected.forEach(
        (agent, index) => {
          plan.push({
            agentId: agent.id,
            booth: boothLabel(
              booths[index]
            ),
            start,
            end,
            final: true,
          });

          load.set(
            agent.id,
            load.get(agent.id) +
              (end - start)
          );
        }
      );

      continue;
    }

    // Rotación en bloques de hasta 60 minutos.

    let current = start;

    while (current < end) {
      const sliceEnd = Math.min(
        current + 60,
        end
      );

      const sliceDuration =
        sliceEnd - current;

      const selected =
        pickLeastLoaded(
          agents,
          (agent) =>
            load.get(agent.id),
          booths.length,
          "asc"
        ).sort(
          (a, b) => a.id - b.id
        );

      for (
        let index = 0;
        index < selected.length;
        index += 1
      ) {
        const agent =
          selected[index];

        plan.push({
          agentId: agent.id,
          booth: boothLabel(
            booths[index]
          ),
          start: current,
          end: sliceEnd,
          final: false,
        });

        load.set(
          agent.id,
          load.get(agent.id) +
            sliceDuration
        );
      }

      current = sliceEnd;
    }
  }

  return {
    plan,
    fixedMinutes: load,
    finalRigid,
  };
}

// =========================================================
// APLICAR PLAN
// =========================================================

function applyPlan(
  agents,
  plan
) {
  for (const item of plan) {
    const agent = agents.find(
      (candidate) =>
        candidate.id ===
        item.agentId
    );

    if (!agent) continue;

    addAssignment(
      agent,
      item.start,
      item.end,
      item.booth
    );

    agent.minutes +=
      item.end - item.start;
  }
}

// =========================================================
// RESERVAS
// =========================================================

function calculateReservedMinutes(
  agents,
  plan
) {
  const reserved = new Map(
    agents.map((agent) => [
      agent.id,
      0,
    ])
  );

  for (const item of plan) {
    if (!item.final) continue;

    reserved.set(
      item.agentId,
      reserved.get(item.agentId) +
        (item.end - item.start)
    );
  }

  return reserved;
}

// =========================================================
// FASE 2 — ASIGNACIÓN FLEXIBLE
// =========================================================
//
// Esta es la parte modificada para contemplar:
//
// workedMinutes = carga previa
// fixedMinutes  = carga nueva rígida/reservada
// target        = carga global objetivo
//
// necesidad nueva flexible:
//
// target
// - workedMinutes
// - fixedMinutes
//
// Nunca se descuenta el histórico de la demanda.
// El histórico solamente afecta cuánto necesita
// trabajar cada agente ahora.
// =========================================================

function calculateFlexibleAllocation(
  agents,
  flexibleWork,
  targets,
  fixedMinutes
) {
  const allocation = new Map(
    agents.map((agent) => [
      agent.id,
      0,
    ])
  );

  const needs = agents.map(
    (agent) => {
      const historical =
        normalizeWorkedMinutes(
          agent.workedMinutes
        );

      const target =
        targets.get(agent.id);

      const fixed =
        fixedMinutes.get(
          agent.id
        ) || 0;

      const need = Math.max(
        0,
        target -
          historical -
          fixed
      );

      return {
        agent,
        target,
        historical,
        fixed,
        need,
      };
    }
  );

  let remainingWork =
    flexibleWork;

  // =======================================================
  // PRIORIDAD:
  //
  // 1. Orden de llegada / ID.
  // 2. Solamente participan agentes que todavía necesitan
  //    minutos para alcanzar su objetivo.
  //
  // El histórico NO cambia el orden de llegada.
  // Sí cambia cuánto necesita trabajar cada uno.
  // =======================================================

  for (const item of needs.sort(
    (a, b) =>
      a.agent.id - b.agent.id
  )) {
    if (remainingWork <= 0) {
      break;
    }

    const available =
      Math.min(
        item.need,
        remainingWork
      );

    allocation.set(
      item.agent.id,
      available
    );

    remainingWork -= available;
  }

  // =======================================================
  // SOBRECARGA INEVITABLE
  //
  // Si todavía queda demanda después de que todos
  // alcanzaron su objetivo, se asigna al agente cuya
  // CARGA TOTAL sea menor.
  //
  // Carga total =
  // histórico + rígido + flexible.
  // =======================================================

  while (remainingWork > 0) {
    const candidates = agents
      .map((agent) => {
        const historical =
          normalizeWorkedMinutes(
            agent.workedMinutes
          );

        const fixed =
          fixedMinutes.get(
            agent.id
          ) || 0;

        const flexible =
          allocation.get(
            agent.id
          ) || 0;

        return {
          agent,
          current:
            historical +
            fixed +
            flexible,
        };
      })
      .sort(
        (a, b) =>
          a.current -
            b.current ||
          a.agent.id -
            b.agent.id
      );

    if (!candidates.length) {
      break;
    }

    const selected =
      candidates[0].agent;

    allocation.set(
      selected.id,
      allocation.get(
        selected.id
      ) + 1
    );

    remainingWork -= 1;
  }

  return allocation;
}

// =========================================================
// FASE 3 — INTERVALOS DE UNA CASILLA
// =========================================================

function buildFlexibleSchedule(
  agents,
  demand,
  allocation
) {
  const remaining = new Map(
    allocation
  );

  const flexibleIntervals =
    [...demand]
      .filter(
        (item) =>
          item.booths.length === 1
      )
      .sort(
        (a, b) =>
          timeToMinutes(a.start) -
            timeToMinutes(b.start) ||
          a.id - b.id
      );

  for (const interval of flexibleIntervals) {
    let current =
      timeToMinutes(
        interval.start
      );

    const end =
      timeToMinutes(
        interval.end
      );

    const booth =
      boothLabel(
        interval.booths[0]
      );

    while (current < end) {
      const candidates =
        agents
          .filter(
            (agent) =>
              (remaining.get(
                agent.id
              ) || 0) > 0
          )
          .sort(
            (a, b) =>
              a.id - b.id
          );

      if (!candidates.length) {
        break;
      }

      const agent =
        candidates[0];

      const duration =
        Math.min(
          remaining.get(
            agent.id
          ),
          end - current
        );

      addAssignment(
        agent,
        current,
        current + duration,
        booth
      );

      agent.minutes +=
        duration;

      remaining.set(
        agent.id,
        remaining.get(
          agent.id
        ) - duration
      );

      current += duration;
    }
  }

  return remaining;
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
            (a) =>
              a.start <= minute &&
              a.end > minute
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
          `pero el minuto ${minutesToTime(
            minute
          )} tiene ${activeCount} asignadas.`
        );
      }
    }
  }

  return null;
}

// =========================================================
// GENERADOR PRINCIPAL
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

        // Carga previa.
        workedMinutes:
          normalizeWorkedMinutes(
            agent.workedMinutes
          ),

        // Carga generada por ESTA planificación.
        minutes: 0,

        assignments: [],
      })
    );

  const sortedDemand =
    [...demand].sort(
      (a, b) => {
        const startA =
          timeToMinutes(
            a.start
          );

        const startB =
          timeToMinutes(
            b.start
          );

        return (
          startA !== startB
            ? startA - startB
            : a.id - b.id
        );
      }
    );

  // =======================================================
  // 1. DEMANDA NUEVA
  // =======================================================

  const demandWork =
    calculateDemandWork(
      sortedDemand
    );

  // =======================================================
  // 2. HISTÓRICO
  // =======================================================

  const historicalWork =
    calculateHistoricalWork(
      agents
    );

  // =======================================================
  // 3. CARGA GLOBAL
  //
  // Esto es lo que ahora determina el promedio.
  // =======================================================

  const globalWork =
    demandWork +
    historicalWork;

  // =======================================================
  // 4. OBJETIVO GLOBAL POR AGENTE
  // =======================================================

  const targets =
    calculateTargets(
      agents,
      globalWork
    );

  // =======================================================
  // 5. MULTICASILLA / RESERVAS
  // =======================================================

  const {
    plan: multiBoothPlan,
    fixedMinutes,
  } =
    planMultiBoothBlocks(
      agents,
      sortedDemand
    );

  // =======================================================
  // 6. RESERVAS FINALES
  // =======================================================

  const reservedMinutes =
    calculateReservedMinutes(
      agents,
      multiBoothPlan
    );

  // reservedMinutes se mantiene calculado porque
  // forma parte del modelo de reservas y sirve para
  // información/debug futuro.
  void reservedMinutes;

  // =======================================================
  // 7. APLICAR BLOQUES MULTICASILLA
  // =======================================================

  applyPlan(
    agents,
    multiBoothPlan
  );

  // =======================================================
  // 8. DEMANDA FLEXIBLE
  // =======================================================

  const flexibleWork =
    sortedDemand
      .filter(
        (item) =>
          item.booths.length === 1
      )
      .reduce(
        (total, item) =>
          total +
          timeToMinutes(
            item.end
          ) -
          timeToMinutes(
            item.start
          ),
        0
      );

  // =======================================================
  // 9. CUÁNTO NECESITA CADA AGENTE
  //
  // AHORA SE DESCUENTA TAMBIÉN EL HISTÓRICO.
  // =======================================================

  const allocation =
    calculateFlexibleAllocation(
      agents,
      flexibleWork,
      targets,
      fixedMinutes
    );

  // =======================================================
  // 10. CONVERTIR CUOTAS EN HORARIOS
  // =======================================================

  buildFlexibleSchedule(
    agents,
    sortedDemand,
    allocation
  );

  // =======================================================
  // 11. ORDEN CRONOLÓGICO
  // =======================================================

  for (const agent of agents) {
    agent.assignments.sort(
      (a, b) =>
        a.start - b.start
    );
  }

  // =======================================================
  // 12. VALIDACIÓN
  // =======================================================

  const scheduleError =
    validateGeneratedSchedule(
      agents,
      sortedDemand
    );

  if (scheduleError) {
    return {
      error: scheduleError,
      schedule: [],
      stats: null,
    };
  }

  // =======================================================
  // 13. CARGA TOTAL
  //
  // Histórico + nueva planificación.
  // =======================================================

  const totalLoads =
    agents.map(
      (agent) =>
        agent.workedMinutes +
        agent.minutes
    );

  const minMinutes =
    Math.min(...totalLoads);

  const maxMinutes =
    Math.max(...totalLoads);

  const target =
    globalWork / agents.length;

  return {
    error: null,

    schedule: agents,

    stats: {
      // Demanda de este turno.
      demandWork,

      // Minutos trabajados previamente.
      historicalWork,

      // Histórico + demanda nueva.
      globalWork,

      // Promedio global.
      target,

      // Carga total mínima/máxima.
      minMinutes,
      maxMinutes,

      // Diferencia entre cargas totales.
      difference:
        maxMinutes -
        minMinutes,
    },
  };
}

// =========================================================
// TEST DE REGRESIÓN CON MINUTOS HISTÓRICOS
// =========================================================
//
// 6 agentes.
// 00:00 → 06:00, una casilla.
//
// A1 ya trabajó 30 minutos.
//
// Demanda nueva = 360.
// Histórico = 30.
// Total global = 390.
// Objetivo = 65.
//
// A1 debe recibir 35 minutos.
// A2-A6 deben recibir 65.
//
// Carga final:
//
// A1 = 30 + 35 = 65
// A2 = 65
// A3 = 65
// A4 = 65
// A5 = 65
// A6 = 65
//
// =========================================================

function runHistoricalMinutesRegressionTest() {
  const testAgents = [
    {
      id: 1,
      name: "Agente 1",
      workedMinutes: 30,
    },
    {
      id: 2,
      name: "Agente 2",
      workedMinutes: 0,
    },
    {
      id: 3,
      name: "Agente 3",
      workedMinutes: 0,
    },
    {
      id: 4,
      name: "Agente 4",
      workedMinutes: 0,
    },
    {
      id: 5,
      name: "Agente 5",
      workedMinutes: 0,
    },
    {
      id: 6,
      name: "Agente 6",
      workedMinutes: 0,
    },
  ];

  const testDemand = [
    {
      id: 1,
      start: "00:00",
      end: "06:00",
      booths: [
        {
          sector: "entrada",
          numero: 16,
        },
      ],
    },
  ];

  const result =
    generateSchedule(
      testAgents,
      testDemand
    );

  console.assert(
    !result.error,
    "HISTÓRICO: no debería haber error."
  );

  console.assert(
    result.stats.globalWork === 390,
    "HISTÓRICO: la carga global debería ser 390 minutos."
  );

  console.assert(
    result.stats.target === 65,
    "HISTÓRICO: el objetivo debería ser 65 minutos."
  );

  const agent1 =
    result.schedule.find(
      (agent) => agent.id === 1
    );

  console.assert(
    agent1.minutes === 35,
    "HISTÓRICO: Agente 1 debería recibir 35 minutos nuevos."
  );

  console.assert(
    agent1.workedMinutes === 30,
    "HISTÓRICO: Agente 1 debería conservar 30 minutos históricos."
  );

  console.assert(
    agent1.workedMinutes +
      agent1.minutes ===
      65,
    "HISTÓRICO: Agente 1 debería terminar con 65 minutos totales."
  );

  console.assert(
    result.stats.difference === 0,
    "HISTÓRICO: la diferencia debería ser 0."
  );

  return result;
}

// =========================================================
// TESTS MANUALES DEL MOTOR
// =========================================================

export function runSchedulerTests() {
  const agents = [
    {
      id: 1,
      name: "Juan",
      workedMinutes: 0,
    },
    {
      id: 2,
      name: "Pedro",
      workedMinutes: 0,
    },
    {
      id: 3,
      name: "Carlos",
      workedMinutes: 0,
    },
    {
      id: 4,
      name: "Luis",
      workedMinutes: 0,
    },
    {
      id: 5,
      name: "Miguel",
      workedMinutes: 0,
    },
    {
      id: 6,
      name: "Diego",
      workedMinutes: 0,
    },
  ];

  // =======================================================
  // TEST 1
  // =======================================================

  const test1 =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "01:00",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
            {
              sector: "entrada",
              numero: 2,
            },
          ],
        },
      ]
    );

  console.assert(
    !test1.error,
    "TEST 1: no debería haber error."
  );

  const test1Assignments =
    test1.schedule.flatMap(
      (agent) =>
        agent.assignments.map(
          (a) => ({
            agentId: agent.id,
            booth: a.booth,
          })
        )
    );

  console.assert(
    test1Assignments.some(
      (item) =>
        item.agentId === 1 &&
        item.booth ===
          "Entrada 2"
    ),
    "TEST 1: Juan debe estar en Entrada 2."
  );

  console.assert(
    test1Assignments.some(
      (item) =>
        item.agentId === 2 &&
        item.booth ===
          "Entrada 1"
    ),
    "TEST 1: Pedro debe estar en Entrada 1."
  );

  // =======================================================
  // TEST 2
  // =======================================================

  const test2 =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "00:30",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
            {
              sector: "entrada",
              numero: 2,
            },
          ],
        },
        {
          id: 2,
          start: "00:30",
          end: "05:00",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
          ],
        },
        {
          id: 3,
          start: "05:00",
          end: "06:00",
          booths: [
            {
              sector: "salida",
              numero: 1,
            },
            {
              sector: "salida",
              numero: 2,
            },
            {
              sector: "salida",
              numero: 3,
            },
            {
              sector: "salida",
              numero: 4,
            },
          ],
        },
      ]
    );

  console.assert(
    !test2.error,
    "TEST 2: no debería haber error."
  );

  const test2Rigid1 =
    test2.schedule
      .filter((a) =>
        a.assignments.some(
          (x) =>
            x.start === 0 &&
            x.end === 30
        )
      )
      .map((a) => a.id)
      .sort();

  console.assert(
    JSON.stringify(
      test2Rigid1
    ) ===
      JSON.stringify([1, 2]),
    "TEST 2: el primer bloque rígido debe cubrirlo Juan y Pedro."
  );

  const test2Rigid2 =
    test2.schedule
      .filter((a) =>
        a.assignments.some(
          (x) =>
            x.start === 300 &&
            x.end === 360
        )
      )
      .map((a) => a.id)
      .sort();

  console.assert(
    JSON.stringify(
      test2Rigid2
    ) ===
      JSON.stringify([
        3, 4, 5, 6,
      ]),
    "TEST 2: el segundo bloque rígido debe cubrirlo Carlos, Luis, Miguel y Diego."
  );

  // =======================================================
  // TEST 2b
  // =======================================================

  const test2b =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "00:30",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
            {
              sector: "entrada",
              numero: 2,
            },
          ],
        },
        {
          id: 2,
          start: "00:30",
          end: "05:00",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
          ],
        },
        {
          id: 3,
          start: "05:00",
          end: "06:00",
          booths: [
            {
              sector: "salida",
              numero: 1,
            },
            {
              sector: "salida",
              numero: 2,
            },
            {
              sector: "salida",
              numero: 3,
            },
          ],
        },
      ]
    );

  console.assert(
    !test2b.error,
    "TEST 2b: no debería haber error."
  );

  const test2bRigid2 =
    test2b.schedule
      .filter((a) =>
        a.assignments.some(
          (x) =>
            x.start === 300 &&
            x.end === 360
        )
      )
      .map((a) => a.id)
      .sort();

  console.assert(
    JSON.stringify(
      test2bRigid2
    ) ===
      JSON.stringify([4, 5, 6]),
    "TEST 2b: el último bloque debe cubrirlo Luis, Miguel y Diego."
  );

  const test2bDiego =
    test2b.schedule.find(
      (a) => a.id === 6
    );

  console.assert(
    test2bDiego.assignments.some(
      (a) =>
        a.booth === "Salida 3"
    ),
    "TEST 2b: Diego debe quedar en Salida 3."
  );

  // =======================================================
  // TEST 3
  // =======================================================

  const diego =
    test2.schedule.find(
      (a) => a.id === 6
    );

  console.assert(
    diego.assignments.every(
      (a, i) =>
        i === 0 ||
        diego.assignments[
          i - 1
        ].start <= a.start
    ),
    "TEST 3: los turnos deben quedar ordenados cronológicamente."
  );

  // =======================================================
  // TEST 4
  // =======================================================

  const agents3 = [
    {
      id: 1,
      name: "Juan",
      workedMinutes: 0,
    },
    {
      id: 2,
      name: "Pedro",
      workedMinutes: 0,
    },
    {
      id: 3,
      name: "Carlos",
      workedMinutes: 0,
    },
    {
      id: 4,
      name: "Luis",
      workedMinutes: 0,
    },
    {
      id: 5,
      name: "Miguel",
      workedMinutes: 0,
    },
    {
      id: 6,
      name: "Agente 6",
      workedMinutes: 0,
    },
  ];

  const test4 =
    generateSchedule(
      agents3,
      [
        {
          id: 1,
          start: "00:00",
          end: "01:00",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
            {
              sector: "entrada",
              numero: 2,
            },
          ],
        },
        {
          id: 2,
          start: "01:00",
          end: "05:00",
          booths: [
            {
              sector: "entrada",
              numero: 1,
            },
          ],
        },
        {
          id: 3,
          start: "05:00",
          end: "06:00",
          booths: [
            {
              sector: "salida",
              numero: 1,
            },
            {
              sector: "salida",
              numero: 2,
            },
            {
              sector: "salida",
              numero: 3,
            },
          ],
        },
      ]
    );

  console.assert(
    !test4.error,
    "TEST 4: no debería haber error."
  );

  console.assert(
    test4.stats.difference <= 1,
    "TEST 4: la diferencia debería ser como máximo 1 minuto."
  );

  // =======================================================
  // TEST 5 — HISTÓRICO
  // =======================================================

  const testHistorical =
    runHistoricalMinutesRegressionTest();

  return {
    test1,
    test2,
    test2b,
    test4,
    testHistorical,
  };
}

// =========================================================
// COMPONENTE REACT
// =========================================================

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

  function focusWorkedMinutes(
    uid
  ) {
    requestAnimationFrame(() => {
      workedMinutesRefs.current[
        uid
      ]?.focus();

      workedMinutesRefs.current[
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
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: 6,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        color:
                          "#666",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      Ya trabajó
                    </label>

                    <input
                      ref={(element) => {
                        workedMinutesRefs.current[
                          agent.uid
                        ] =
                          element;
                      }}
                      className="input"
                      type="number"
                      min="0"
                      step="1"
                      value={
                        agent.workedMinutes ??
                        0
                      }
                      onChange={(
                        event
                      ) =>
                        updateAgentWorkedMinutes(
                          agent.id,
                          event.target
                            .value
                        )
                      }
                      onKeyDown={(
                        event
                      ) => {
                        if (
                          event.key ===
                          "Enter"
                        ) {
                          event.preventDefault();

                          const nextAgent =
                            agents[
                              index + 1
                            ];

                          if (
                            nextAgent
                          ) {
                            focusAgent(
                              nextAgent.uid
                            );
                          }
                        }
                      }}
                      style={{
                        width: 80,
                      }}
                      aria-label={`Minutos ya trabajados por el agente ${agent.id}`}
                      title="Minutos trabajados antes de esta planificación"
                    />

                    <span
                      style={{
                        fontSize: 12,
                        color:
                          "#777",
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
                  Objetivo por agente
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
                  Diferencia máxima
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
            </div>

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
