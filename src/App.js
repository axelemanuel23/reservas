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
// CRITERIO ÚNICO DE PRIORIDAD
//
// Esta es la única regla de selección de todo el motor:
//   1) menor cantidad de minutos acumulados hasta el momento
//   2) a igualdad, menor ID (orden de llegada)
//
// Se usa tanto para elegir quién entra a un bloque rígido (varias
// casillas simultáneas) como para elegir quién sigue en el relleno
// flexible (una casilla). El mismo orden de prioridad es el que luego
// se empareja con las casillas ordenadas por sector (ver
// sortBoothsForAssignment): el más prioritario se lleva la casilla
// "preferencial".
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

function addAssignment(agent, start, end, booth) {
  if (end <= start) return;

  const last = agent.assignments[agent.assignments.length - 1];

  // Si el turno nuevo continúa inmediatamente en la misma casilla,
  // lo unimos en vez de crear un segmento aparte.
  if (last && last.end === start && last.booth === booth) {
    last.end = end;
    last.minutes += end - start;
    return;
  }

  agent.assignments.push({ start, end, booth, minutes: end - start });
}

// =========================================================
// OBJETIVO POR AGENTE
//
// Se calcula una sola vez, al principio: es el "ancla" contra la que
// el relleno flexible sabe cuándo dejar de darle minutos a alguien.
// =========================================================

function calculateTargets(agents, totalWork) {
  const sortedById = [...agents].sort((a, b) => a.id - b.id);

  const base = Math.floor(totalWork / sortedById.length);
  const remainder = totalWork % sortedById.length;

  // El resto (si la división no es exacta) se lo lleva primero
  // quien llegó antes.
  return new Map(
    sortedById.map((agent, index) => [agent.id, base + (index < remainder ? 1 : 0)])
  );
}

// =========================================================
// FASE 1 — BLOQUES RÍGIDOS (2+ casillas simultáneas)
//
// Se procesan TODOS los bloques rígidos primero, en orden cronológico,
// antes de tocar cualquier casilla individual. Esto es necesario:
// como un bloque rígido no se puede partir entre agentes, hay que
// "reservar" a los agentes menos cargados para él antes de que el
// relleno flexible los gaste completando objetivos.
//
// Un bloque rígido puede aparecer en cualquier punto del día (al
// principio, al final, o abrirse transitoriamente a mitad de otro
// intervalo): no hay ninguna suposición sobre su posición, solo se
// procesan en el orden en que ocurren.
// =========================================================

function planRigidBlocks(agents, rigidIntervals, demand) {
  const rigidMinutes = new Map(agents.map((agent) => [agent.id, 0]));
  const plan = [];

  const lastDemandEnd = Math.max(
    ...demand.map((item) => timeToMinutes(item.end))
  );

  rigidIntervals.forEach((interval) => {
    const start = timeToMinutes(interval.start);
    const end = timeToMinutes(interval.end);
    const duration = end - start;

    // El último bloque rígido se selecciona de últimos a primeros.
    const isLastRigidBlock = end === lastDemandEnd;

    let selected;

    if (isLastRigidBlock) {
      // Seleccionamos los últimos agentes según ID.
      selected = [...agents]
        .sort((a, b) => b.id - a.id)
        .slice(0, interval.booths.length);
    } else {
      // Bloques normales:
      // menor carga rígida → menor ID.
      selected = pickLeastLoaded(
        agents,
        (agent) => rigidMinutes.get(agent.id),
        interval.booths.length,
        "asc"
      );
    }

    // =====================================================
    // IMPORTANTE:
    //
    // La selección ya se hizo con la prioridad correspondiente.
    // Ahora ordenamos los agentes de menor ID a mayor ID
    // SOLO para emparejarlos con las casillas.
    //
    // Las casillas ya vienen ordenadas por sector:
    //
    // Entrada → mayor número → menor número
    // Salida  → menor número → mayor número
    //
    // Esto hace que:
    //
    // Salida 6,7,8
    // Agente 3,4,5
    //
    // quede:
    // Agente 3 → Salida 6
    // Agente 4 → Salida 7
    // Agente 5 → Salida 8
    // =====================================================

    selected.sort((a, b) => a.id - b.id);

    const orderedBooths = sortBoothsForAssignment(interval.booths);

    selected.forEach((agent, boothIndex) => {
      const booth = orderedBooths[boothIndex];

      plan.push({
        agentId: agent.id,
        booth: boothLabel(booth),
        start,
        end,
      });

      rigidMinutes.set(
        agent.id,
        rigidMinutes.get(agent.id) + duration
      );
    });
  });

  return { rigidMinutes, plan };
}



function applyRigidPlan(agents, plan) {
  for (const item of plan) {
    const agent = agents.find((a) => a.id === item.agentId);
    if (!agent) continue;

    addAssignment(agent, item.start, item.end, item.booth);
    agent.minutes += item.end - item.start;
  }
}

// =========================================================
// FASE 2 — RELLENO FLEXIBLE (1 casilla)
//
// A diferencia de los bloques rígidos, una casilla individual SÍ se
// puede repartir entre varios agentes dentro del mismo intervalo:
// cada uno toma la casilla hasta llegar a su objetivo (o hasta que
// se acabe el intervalo) y después releva el siguiente.
//
// No se simula minuto a minuto: se entrega el intervalo en "cuotas",
// una por cada cambio de agente.
// =========================================================

function pickNextFlexibleAgent(agents, targets, current) {
  // Continuidad: si el agente que ya estaba en la casilla todavía
  // necesita minutos, sigue él antes que evaluar a cualquier otro.
  // Esto evita cortes artificiales tipo "Juan 1 min, Pedro 1 min...".
  const continuing = agents.find((agent) => {
    const last = agent.assignments[agent.assignments.length - 1];
    return last && last.end === current && targets.get(agent.id) - agent.minutes > 0;
  });

  if (continuing) {
    return { agent: continuing, remaining: targets.get(continuing.id) - continuing.minutes };
  }

  // Orden de llegada estricto: sigue el agente con menor ID que todavía
  // necesite minutos, sin importar cuántos necesite. Si le toca a alguien
  // que necesita mucho (ej. porque quedó afuera de los bloques rígidos),
  // se lleva ese tramo completo antes de pasarle la posta al siguiente.
  const stillNeeding = agents
    .map((agent) => ({ agent, remaining: targets.get(agent.id) - agent.minutes }))
    .filter((item) => item.remaining > 0)
    .sort((a, b) => a.agent.id - b.agent.id);

  if (stillNeeding.length > 0) return stillNeeding[0];

  // Si ya nadie necesita más minutos (puede pasar por redondeos o por
  // sobrecarga de los bloques rígidos), el intervalo igual hay que
  // cubrirlo: lo absorbe quien tenga menos carga total.
  const [lowest] = pickLeastLoaded(agents, (agent) => agent.minutes, 1);
  return { agent: lowest, remaining: Infinity };
}

function assignFlexibleInterval(agents, interval, targets) {
  let current = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);
  const label = boothLabel(interval.booths[0]);

  while (current < end) {
    const { agent, remaining } = pickNextFlexibleAgent(agents, targets, current);
    const duration = Math.min(remaining, end - current);

    if (!agent || duration <= 0) break;

    addAssignment(agent, current, current + duration, label);
    agent.minutes += duration;
    current += duration;
  }
}

// =========================================================
// VALIDACIÓN FINAL DEL SCHEDULE
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
          return `El agente ${agent.name} está asignado a más de una casilla simultáneamente.`;
        }

        activeCount += active.length;
      }

      if (activeCount !== interval.booths.length) {
        return (
          `La demanda ${interval.start} → ${interval.end} requiere ${interval.booths.length} ` +
          `casillas, pero el minuto ${minutesToTime(minute)} tiene ${activeCount} asignadas.`
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
  if (error) return { error, schedule: [], stats: null };

  const agents = agentsInput.map((agent) => ({ ...agent, minutes: 0, assignments: [] }));

  const sortedDemand = [...demand].sort((a, b) => {
    const startA = timeToMinutes(a.start);
    const startB = timeToMinutes(b.start);
    return startA !== startB ? startA - startB : a.id - b.id;
  });

  const totalWork = calculateTotalWork(sortedDemand);
  const targets = calculateTargets(agents, totalWork);

  // Fase 1: todos los bloques rígidos (2+ casillas), en orden cronológico.
  const rigidIntervals = sortedDemand.filter((item) => item.booths.length >= 2);
  const { plan } = planRigidBlocks(agents, rigidIntervals, sortedDemand);
  applyRigidPlan(agents, plan);

  // Fase 2: relleno flexible (1 casilla), en orden cronológico,
  // usando como objetivo lo que falta para llegar a `targets`.
  const flexibleIntervals = sortedDemand.filter((item) => item.booths.length === 1);
  for (const interval of flexibleIntervals) {
    assignFlexibleInterval(agents, interval, targets);
  }

  const scheduleError = validateGeneratedSchedule(agents, sortedDemand);
  if (scheduleError) return { error: scheduleError, schedule: [], stats: null };

  // Cada agente puede haber recibido turnos fuera de orden cronológico
  // (los bloques rígidos se resuelven todos antes que los flexibles,
  // sin importar a qué hora del día caiga cada uno). Se reordena acá,
  // una sola vez, solo para que la lectura de izquierda a derecha en
  // la tabla sea intuitiva — no afecta ningún cálculo de carga.
  for (const agent of agents) {
    agent.assignments.sort((a, b) => a.start - b.start);
  }

  const loads = agents.map((agent) => agent.minutes);
  const minMinutes = Math.min(...loads);
  const maxMinutes = Math.max(...loads);

  return {
    error: null,
    schedule: agents,
    stats: {
      totalWork,
      target: totalWork / agents.length,
      minMinutes,
      maxMinutes,
      difference: maxMinutes - minMinutes,
    },
  };
}

// =========================================================
// TESTS MANUALES DEL MOTOR
// =========================================================

export function runSchedulerTests() {
  const agents = [
    { id: 1, name: "Juan" },
    { id: 2, name: "Pedro" },
    { id: 3, name: "Carlos" },
    { id: 4, name: "Luis" },
    { id: 5, name: "Miguel" },
    { id: 6, name: "Diego" },
  ];

  // TEST 1
  // 2 casillas de Entrada durante una hora, arrancando todos en 0.
  // Con el criterio único (menor carga, menor ID) deben entrar los DOS
  // PRIMEROS por orden de llegada: Juan (1) y Pedro (2). Por el sesgo
  // de Entrada (mayor a menor), Juan (más prioritario) debe quedar en
  // la casilla de numeración más alta: Entrada 2.
  const test1 = generateSchedule(agents, [
    {
      id: 1,
      start: "00:00",
      end: "01:00",
      booths: [
        { sector: "entrada", numero: 1 },
        { sector: "entrada", numero: 2 },
      ],
    },
  ]);

  console.assert(!test1.error, "TEST 1: no debería haber error.");

  const test1Assignments = test1.schedule.flatMap((agent) =>
    agent.assignments.map((a) => ({ agentId: agent.id, booth: a.booth }))
  );

  console.assert(
    test1Assignments.some((item) => item.agentId === 1 && item.booth === "Entrada 2"),
    "TEST 1: Juan debe estar en Entrada 2 (preferencial)."
  );
  console.assert(
    test1Assignments.some((item) => item.agentId === 2 && item.booth === "Entrada 1"),
    "TEST 1: Pedro debe estar en Entrada 1."
  );

  // TEST 2
  // Escenario descrito por el usuario: 00→00:30 (2 casillas Entrada),
  // 00:30→05:00 (1 casilla), 05:00→06:00 (4 casillas Salida), 6 agentes.
  // Los primeros dos agentes cubren el primer bloque; como ya llegan
  // "cargados" a las 05:00, el segundo bloque rígido lo cubren los
  // últimos cuatro (inversa). Los minutos restantes se reparten por
  // orden de llegada en el tramo flexible.
  const test2 = generateSchedule(agents, [
    {
      id: 1,
      start: "00:00",
      end: "00:30",
      booths: [
        { sector: "entrada", numero: 1 },
        { sector: "entrada", numero: 2 },
      ],
    },
    { id: 2, start: "00:30", end: "05:00", booths: [{ sector: "entrada", numero: 1 }] },
    {
      id: 3,
      start: "05:00",
      end: "06:00",
      booths: [
        { sector: "salida", numero: 1 },
        { sector: "salida", numero: 2 },
        { sector: "salida", numero: 3 },
        { sector: "salida", numero: 4 },
      ],
    },
  ]);

  console.assert(!test2.error, "TEST 2: no debería haber error.");

  const test2Rigid1 = test2.schedule
    .filter((a) => a.assignments.some((x) => x.start === 0 && x.end === 30))
    .map((a) => a.id)
    .sort();
  console.assert(
    JSON.stringify(test2Rigid1) === JSON.stringify([1, 2]),
    "TEST 2: el primer bloque rígido debe cubrirlo Juan y Pedro."
  );

  const test2Rigid2 = test2.schedule
    .filter((a) => a.assignments.some((x) => x.start === 300 && x.end === 360))
    .map((a) => a.id)
    .sort();
  console.assert(
    JSON.stringify(test2Rigid2) === JSON.stringify([3, 4, 5, 6]),
    "TEST 2: el segundo bloque rígido debe cubrirlo Carlos, Luis, Miguel y Diego."
  );

  // TEST 2b — mismo escenario pero con el último bloque de solo 3
  // casillas (no 4): al haber empate en carga (0) entre Carlos, Luis,
  // Miguel y Diego, el último bloque rígido debe favorecer a los ID
  // más altos, dejando a Carlos como el que hace el tramo flexible
  // completo en vez de compartirlo.
  const test2b = generateSchedule(agents, [
    {
      id: 1,
      start: "00:00",
      end: "00:30",
      booths: [
        { sector: "entrada", numero: 1 },
        { sector: "entrada", numero: 2 },
      ],
    },
    { id: 2, start: "00:30", end: "05:00", booths: [{ sector: "entrada", numero: 1 }] },
    {
      id: 3,
      start: "05:00",
      end: "06:00",
      booths: [
        { sector: "salida", numero: 1 },
        { sector: "salida", numero: 2 },
        { sector: "salida", numero: 3 },
      ],
    },
  ]);

  console.assert(!test2b.error, "TEST 2b: no debería haber error.");

  const test2bRigid2 = test2b.schedule
    .filter((a) => a.assignments.some((x) => x.start === 300 && x.end === 360))
    .map((a) => a.id)
    .sort();
  console.assert(
    JSON.stringify(test2bRigid2) === JSON.stringify([4, 5, 6]),
    "TEST 2b: el último bloque (3 casillas) debe cubrirlo Luis, Miguel y Diego, no Carlos."
  );

  const test2bDiego = test2b.schedule.find((a) => a.id === 6);
  console.assert(
    test2bDiego.assignments.some((a) => a.booth === "Salida 3"),
    "TEST 2b: Diego (ID más alto entre los empatados) debe quedar en Salida 3."
  );

  // Reparto flexible esperado a mano: total = 570 min / 6 = 95 min c/u.
  // Juan y Pedro ya tienen 30 min de rígido, Carlos/Luis/Miguel/Diego
  // ya tienen 60 min. Juan sigue hasta 01:35, Pedro releva hasta 02:40,
  // Carlos hasta 03:15, Luis hasta 03:50, Miguel hasta 04:25, Diego
  // hasta 05:00 (donde empalma con su turno rígido).
  const juan = test2.schedule.find((a) => a.id === 1);
  const pedro = test2.schedule.find((a) => a.id === 2);
  const diego = test2.schedule.find((a) => a.id === 6);

  console.assert(
    juan.assignments.some((a) => a.start === 30 && a.end === 95),
    "TEST 2: Juan debería continuar hasta 01:35."
  );
  console.assert(
    pedro.assignments.some((a) => a.start === 95 && a.end === 160),
    "TEST 2: Pedro debería relevar hasta 02:40."
  );
  console.assert(
    diego.assignments.some((a) => a.start === 265 && a.end === 300),
    "TEST 2: Diego debería llegar justo hasta las 05:00."
  );
  console.assert(test2.stats.difference <= 1, "TEST 2: la diferencia debería ser mínima.");

  // TEST 3
  // Orden cronológico en el render: un agente que participa solo en el
  // bloque rígido tardío no debe listar ese turno antes que uno más
  // temprano en su propio array de assignments.
  console.assert(
    diego.assignments.every((a, i) => i === 0 || diego.assignments[i - 1].start <= a.start),
    "TEST 3: los turnos de cada agente deben quedar ordenados cronológicamente."
  );

  // TEST 3
  // Escenario "Guardia Nocturna" reportado: 00:00-01:00 (2 casillas
  // Entrada), 01:00-05:00 (1 casilla flexible), 05:00-06:00 (3 casillas
  // Salida), 6 agentes. Carlos queda afuera de ambos bloques rígidos y
  // necesita 90 min en el tramo flexible, pero el orden de llegada debe
  // respetarse igual: Juan, Pedro, Carlos, Luis, Miguel, Agente 6 — cada
  // uno toma lo que le falta cuando le toca el turno, sin saltarse a
  // nadie por tener más o menos minutos pendientes.
  const agents3 = [
    { id: 1, name: "Juan" },
    { id: 2, name: "Pedro" },
    { id: 3, name: "Carlos" },
    { id: 4, name: "Luis" },
    { id: 5, name: "Miguel" },
    { id: 6, name: "Agente 6" },
  ];

  const test3 = generateSchedule(agents3, [
    {
      id: 1,
      start: "00:00",
      end: "01:00",
      booths: [
        { sector: "entrada", numero: 1 },
        { sector: "entrada", numero: 2 },
      ],
    },
    { id: 2, start: "01:00", end: "05:00", booths: [{ sector: "entrada", numero: 1 }] },
    {
      id: 3,
      start: "05:00",
      end: "06:00",
      booths: [
        { sector: "salida", numero: 1 },
        { sector: "salida", numero: 2 },
        { sector: "salida", numero: 3 },
      ],
    },
  ]);

  console.assert(!test3.error, "TEST 3: no debería haber error.");

  const expectedTest3 = [
    { id: 1, start: 60, end: 90 }, // Juan 01:00-01:30
    { id: 2, start: 90, end: 120 }, // Pedro 01:30-02:00
    { id: 3, start: 120, end: 210 }, // Carlos 02:00-03:30
    { id: 4, start: 210, end: 240 }, // Luis 03:30-04:00
    { id: 5, start: 240, end: 270 }, // Miguel 04:00-04:30
    { id: 6, start: 270, end: 300 }, // Agente 6 04:30-05:00
  ];

  for (const expected of expectedTest3) {
    const agent = test3.schedule.find((a) => a.id === expected.id);
    const found = agent.assignments.some(
      (a) => a.start === expected.start && a.end === expected.end
    );
    console.assert(
      found,
      `TEST 3: ${agent.name} debería tener un tramo ${minutesToTime(expected.start)} → ${minutesToTime(expected.end)}.`
    );
  }

  return { test1, test2, test2b, test3 };
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
