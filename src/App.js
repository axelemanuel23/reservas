import { useMemo, useState } from "react";
import "./App.css";

const INITIAL_AGENTS = [
  { id: 1, name: "Juan" },
  { id: 2, name: "Pedro" },
  { id: 3, name: "Carlos" },
  { id: 4, name: "Luis" },
  { id: 5, name: "Miguel" },
];

const INITIAL_DEMAND = [
  { id: 1, start: "00:00", end: "01:00", booths: 2 },
  { id: 2, start: "01:00", end: "05:00", booths: 1 },
  { id: 3, start: "05:00", end: "06:00", booths: 3 },
];

// =========================================================
// UTILIDADES
// =========================================================

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

  if (hours === 0) {
    return `${mins} min`;
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
      return (
        `Horario inválido: ` +
        `${item.start} → ${item.end}`
      );
    }

    if (item.booths < 1) {
      return (
        "La cantidad de casillas " +
        "debe ser mayor a 0."
      );
    }

    if (item.booths > agents.length) {
      return (
        `El intervalo ${item.start} → ${item.end} ` +
        `requiere ${item.booths} casillas pero solo ` +
        `hay ${agents.length} agentes.`
      );
    }
  }

  const sorted = [...normalized].sort(
    (a, b) => {
      if (
        a.startMinutes !==
        b.startMinutes
      ) {
        return (
          a.startMinutes -
          b.startMinutes
        );
      }

      return a.id - b.id;
    }
  );

  /*
    La demanda es absoluta.
    No permitimos superposición.
  */

  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i].startMinutes <
      sorted[i - 1].endMinutes
    ) {
      return (
        `Hay intervalos superpuestos: ` +
        `${sorted[i - 1].start} → ` +
        `${sorted[i - 1].end} y ` +
        `${sorted[i].start} → ` +
        `${sorted[i].end}`
      );
    }
  }

  return null;
}

// =========================================================
// CARGA TOTAL
// =========================================================

function calculateTotalWork(demand) {
  return demand.reduce(
    (total, item) => {
      const duration =
        timeToMinutes(item.end) -
        timeToMinutes(item.start);

      return (
        total +
        duration * item.booths
      );
    },
    0
  );
}

// =========================================================
// AGREGAR ASIGNACIÓN
// =========================================================

function addAssignment(
  agent,
  start,
  end,
  booth
) {
  if (end <= start) {
    return;
  }

  const last =
    agent.assignments[
      agent.assignments.length - 1
    ];

  /*
    Si el nuevo turno continúa inmediatamente
    y está en la misma casilla, lo unimos.
  */

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
// SELECCIÓN DISTRIBUIDA
// =========================================================

function selectEvenlySpaced(
  agents,
  quantity
) {
  if (quantity <= 0) {
    return [];
  }

  if (quantity >= agents.length) {
    return [...agents];
  }

  if (quantity === 1) {
    return [agents[0]];
  }

  const selected = [];

  for (let i = 0; i < quantity; i++) {
    const position =
      Math.round(
        (i * (agents.length - 1)) /
          (quantity - 1)
      );

    selected.push(agents[position]);
  }

  return selected;
}

// =========================================================
// SELECCIONAR AGENTES PARA BLOQUE MÚLTIPLE
// =========================================================

function selectAgentsForFixedBlock(
  agents,
  quantity,
  fixedMinutes
) {
  /*
    Primero buscamos los agentes que tengan
    menor carga fija.

    Esto es importante porque los bloques de
    varias casillas NO se pueden dividir.

    Ejemplo:

      Juan   60
      Pedro   0
      Carlos  0
      Luis    0
      Miguel 60

    Si necesitamos 2 agentes:

      Pedro + Luis

    en lugar de volver a cargar a Juan/Miguel.
  */

  const sorted = [...agents].sort(
    (a, b) => {
      const loadA =
        fixedMinutes.get(a.id) ?? 0;

      const loadB =
        fixedMinutes.get(b.id) ?? 0;

      if (loadA !== loadB) {
        return loadA - loadB;
      }

      return a.id - b.id;
    }
  );

  /*
    Tomamos primero la capa de menor carga.

    Si esa capa tiene suficientes agentes,
    usamos una distribución desde los extremos.

    Ejemplo con:

      1 2 3 4 5

    y 2 casillas:

      1 5

    y 3 casillas:

      1 3 5
  */

  const minimumLoad =
    fixedMinutes.get(
      sorted[0].id
    ) ?? 0;

  const lowestLoadAgents =
    sorted.filter(
      (agent) =>
        (fixedMinutes.get(
          agent.id
        ) ?? 0) === minimumLoad
    );

  if (
    lowestLoadAgents.length >=
    quantity
  ) {
    return selectEvenlySpaced(
      lowestLoadAgents,
      quantity
    ).sort(
      (a, b) => a.id - b.id
    );
  }

  /*
    Si no alcanza una única capa,
    completamos desde las siguientes capas.
  */

  const selected = [
    ...lowestLoadAgents,
  ];

  const remaining =
    sorted.filter(
      (agent) =>
        !selected.some(
          (selectedAgent) =>
            selectedAgent.id ===
            agent.id
        )
    );

  while (
    selected.length <
      quantity &&
    remaining.length > 0
  ) {
    const nextLoad =
      fixedMinutes.get(
        remaining[0].id
      ) ?? 0;

    const nextGroup =
      remaining.filter(
        (agent) =>
          (fixedMinutes.get(
            agent.id
          ) ?? 0) === nextLoad
      );

    const needed =
      quantity - selected.length;

    const chosen =
      selectEvenlySpaced(
        nextGroup,
        Math.min(
          needed,
          nextGroup.length
        )
      );

    selected.push(...chosen);

    for (const agent of chosen) {
      const index =
        remaining.findIndex(
          (item) =>
            item.id === agent.id
        );

      if (index >= 0) {
        remaining.splice(index, 1);
      }
    }
  }

  return selected
    .slice(0, quantity)
    .sort(
      (a, b) => a.id - b.id
    );
}

// =========================================================
// OBJETIVOS
// =========================================================

function calculateTargets(
  agents,
  totalWork
) {
  const base =
    Math.floor(
      totalWork / agents.length
    );

  const remainder =
    totalWork % agents.length;

  /*
    El ID también determina quién recibe
    los minutos sobrantes cuando el total no
    es divisible exactamente.

    Ejemplo:

      302 / 5

      61
      61
      60
      60
      60
  */

  return new Map(
    agents.map(
      (agent, index) => [
        agent.id,
        base +
          (index < remainder
            ? 1
            : 0),
      ]
    )
  );
}

// =========================================================
// PLANIFICAR BLOQUES MÚLTIPLES
// =========================================================

function planFixedIntervals(
  agents,
  fixedIntervals
) {
  const fixedMinutes =
    new Map(
      agents.map((agent) => [
        agent.id,
        0,
      ])
    );

  const fixedPlan = [];

  for (const interval of fixedIntervals) {
    const start =
      timeToMinutes(
        interval.start
      );

    const end =
      timeToMinutes(
        interval.end
      );

    const selected =
      selectAgentsForFixedBlock(
        agents,
        interval.booths,
        fixedMinutes
      );

    /*
      selected ya está ordenado por ID.

      Por lo tanto:

        menor ID → primera casilla
        mayor ID → última casilla
    */

    selected.forEach(
      (agent, index) => {
        const booth =
          index + 1;

        fixedPlan.push({
          agentId: agent.id,
          booth,
          start,
          end,
        });

        fixedMinutes.set(
          agent.id,
          fixedMinutes.get(
            agent.id
          ) +
            (end - start)
        );
      }
    );
  }

  return {
    fixedMinutes,
    fixedPlan,
  };
}

// =========================================================
// APLICAR BLOQUES FIJOS
// =========================================================

function applyFixedPlan(
  agents,
  fixedPlan
) {
  for (const assignment of fixedPlan) {
    const agent =
      agents.find(
        (item) =>
          item.id ===
          assignment.agentId
      );

    if (!agent) {
      continue;
    }

    addAssignment(
      agent,
      assignment.start,
      assignment.end,
      assignment.booth
    );

    agent.minutes +=
      assignment.end -
      assignment.start;
  }
}

// =========================================================
// ASIGNAR TIEMPO FLEXIBLE
// =========================================================

function assignFlexibleInterval(
  agents,
  interval,
  targets
) {
  let current =
    timeToMinutes(
      interval.start
    );

  const end =
    timeToMinutes(
      interval.end
    );

  /*
    La casilla 1 es la única casilla abierta
    durante este intervalo.
  */

  while (current < end) {
    const remainingInterval =
      end - current;

    /*
      Buscamos primero agentes que todavía
      estén por debajo de su objetivo.

      El orden principal es:

      1. Mayor necesidad.
      2. Menor ID.

      Pero antes de esto damos continuidad
      al agente actual si todavía necesita
      tiempo.
    */

    /*
      Si hay alguien que ya estaba trabajando
      exactamente hasta este momento y todavía
      necesita tiempo, le damos continuidad.

      Esto evita:

        01:00 → 01:01 Juan
        01:01 → 01:02 Pedro
        01:02 → 01:03 Juan

      y produce turnos naturales.
    */

    const candidates = agents
  .map((agent) => {
    const target = targets.get(agent.id);

    return {
      agent,
      target,
      remaining: target - agent.minutes,
    };
  })
  .filter(
    (item) => item.remaining > 0
  )
  .sort((a, b) => {
    /*
      Primero el que más necesita.
    */

    if (a.remaining !== b.remaining) {
      return b.remaining - a.remaining;
    }

    /*
      Si necesitan lo mismo, gana
      el que llegó primero.
    */

    return a.agent.id - b.agent.id;
  });

/*
  Buscamos continuidad sin utilizar
  una función que capture "current".
*/

let continuity = null;

for (const candidate of candidates) {
  const assignments =
    candidate.agent.assignments;

  const last =
    assignments[
      assignments.length - 1
    ];

  if (
    last &&
    last.end === current
  ) {
    continuity = candidate;
    break;
  }
}

const selected =
  continuity ?? candidates[0];
    /*
      Si todos llegaron al objetivo,
      todavía puede quedar tiempo debido
      a bloques obligatorios que hicieron
      que algunos superaran el objetivo.

      En ese caso equilibramos empezando
      por el agente con menor carga.
    */

    let agent;
    let duration;

    if (selected) {
      agent =
        selected.agent;

      duration =
        Math.min(
          selected.remaining,
          remainingInterval
        );
    } else {
      const lowest =
        [...agents].sort(
          (a, b) => {
            if (
              a.minutes !==
              b.minutes
            ) {
              return (
                a.minutes -
                b.minutes
              );
            }

            return a.id - b.id;
          }
        )[0];

      agent = lowest;

      /*
        Para no producir demasiados cortes,
        dejamos que el agente con menor carga
        absorba el tramo restante.
      */

      duration =
        remainingInterval;
    }

    if (
      !agent ||
      duration <= 0
    ) {
      break;
    }

    addAssignment(
      agent,
      current,
      current + duration,
      1
    );

    agent.minutes +=
      duration;

    current += duration;
  }
}

// =========================================================
// VALIDACIÓN FINAL DEL SCHEDULE
// =========================================================

function validateGeneratedSchedule(
  agents,
  demand
) {
  /*
    1. Cada intervalo debe estar cubierto
       exactamente por la cantidad de casillas
       solicitadas.

    2. Un agente no puede estar en dos
       casillas simultáneamente.
  */

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
              assignment.start <=
                minute &&
              assignment.end >
                minute
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
        interval.booths
      ) {
        return (
          `La demanda ${interval.start} → ` +
          `${interval.end} requiere ` +
          `${interval.booths} casillas, ` +
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

  /*
    Clonamos los agentes para no modificar
    el estado de React.
  */

  const agents =
    agentsInput.map(
      (agent) => ({
        ...agent,
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

        if (
          startA !==
          startB
        ) {
          return (
            startA -
            startB
          );
        }

        return a.id - b.id;
      }
    );

  const totalWork =
    calculateTotalWork(
      sortedDemand
    );

  /*
    =====================================================
    PASO 1
    =====================================================

    Calculamos el objetivo final.

    Es importante hacerlo antes de asignar,
    porque los bloques múltiples son rígidos.
  */

  const targets =
    calculateTargets(
      agents,
      totalWork
    );

  /*
    =====================================================
    PASO 2
    =====================================================

    Planificamos TODOS los bloques de varias
    casillas antes de tocar las casillas individuales.

    Esto permite mirar hacia adelante.
  */

  const fixedIntervals =
    sortedDemand.filter(
      (item) =>
        item.booths >= 2
    );

  const {
    fixedMinutes,
    fixedPlan,
  } =
    planFixedIntervals(
      agents,
      fixedIntervals
    );

  /*
    =====================================================
    PASO 3
    =====================================================

    Aplicamos los bloques rígidos.

    Estos bloques nunca se cortan.
  */

  applyFixedPlan(
    agents,
    fixedPlan
  );

  /*
    =====================================================
    PASO 4
    =====================================================

    Ahora tenemos algo muy importante:

      cuánto DEBE terminar haciendo
      cada agente

    y:

      cuánto YA hizo en bloques rígidos.

    Las casillas individuales compensan
    exactamente esa diferencia.
  */

  const flexibleIntervals =
    sortedDemand.filter(
      (item) =>
        item.booths === 1
    );

  for (
    const interval
    of flexibleIntervals
  ) {
    assignFlexibleInterval(
      agents,
      interval,
      targets
    );
  }

  /*
    =====================================================
    PASO 5
    =====================================================

    Validamos que toda la demanda haya quedado
    cubierta correctamente.
  */

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

  /*
    =====================================================
    ESTADÍSTICAS
    =====================================================
  */

  const loads =
    agents.map(
      (agent) =>
        agent.minutes
    );

  const minMinutes =
    Math.min(...loads);

  const maxMinutes =
    Math.max(...loads);

  const target =
    totalWork /
    agents.length;

  /*
    Diferencia contra el objetivo matemático.

    Si el total no es divisible por la cantidad
    de agentes, una diferencia de 1 minuto puede
    ser inevitable.
  */

  const difference =
    maxMinutes -
    minMinutes;

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference,
      fixedMinutes:
        Object.fromEntries(
          fixedMinutes
        ),
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
  ];

  /*
    TEST 1
    -----------------------------------------------

    2 casillas durante una hora.

    Debe utilizar:

      ID 1 → Casilla 1
      ID 5 → Casilla 2

    porque las casillas se distribuyen
    desde los extremos del orden de llegada.
  */

  const test1 =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "01:00",
          booths: 2,
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
          (assignment) => ({
            agentId: agent.id,
            booth:
              assignment.booth,
          })
        )
    );

  console.assert(
    test1Assignments.some(
      (item) =>
        item.agentId === 1 &&
        item.booth === 1
    ),
    "TEST 1: Juan debe estar en Casilla 1."
  );

  console.assert(
    test1Assignments.some(
      (item) =>
        item.agentId === 5 &&
        item.booth === 2
    ),
    "TEST 1: Miguel debe estar en Casilla 2."
  );

  /*
    TEST 2
    -----------------------------------------------

    Dos bloques:

      00 → 01 | 2 casillas
      05 → 06 | 3 casillas

    Primer bloque:

      Juan
      Miguel

    Segundo bloque:

      Pedro
      Carlos
      Luis

    Resultado de los bloques fijos:

      Todos = 60 minutos
  */

  const test2 =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "01:00",
          booths: 2,
        },
        {
          id: 2,
          start: "05:00",
          end: "06:00",
          booths: 3,
        },
      ]
    );

  console.assert(
    !test2.error,
    "TEST 2: no debería haber error."
  );

  console.assert(
    test2.schedule.every(
      (agent) =>
        agent.minutes === 60
    ),
    "TEST 2: todos deberían tener 60 min."
  );

  /*
    TEST 3
    -----------------------------------------------

    Este es el caso que describe el usuario:

      2 casillas → 60 min
      1 casilla  → 60 min

    Total = 180 min.

    Los dos primeros agentes hacen
    primero la hora completa.

    Luego la casilla individual completa
    primero al ID 1 y después al ID 2.
  */

  const test3 =
    generateSchedule(
      agents,
      [
        {
          id: 1,
          start: "00:00",
          end: "01:00",
          booths: 2,
        },
        {
          id: 2,
          start: "01:00",
          end: "02:00",
          booths: 1,
        },
      ]
    );

  console.assert(
    !test3.error,
    "TEST 3: no debería haber error."
  );

  const juan =
    test3.schedule.find(
      (agent) => agent.id === 1
    );

  const pedro =
    test3.schedule.find(
      (agent) => agent.id === 2
    );

  console.assert(
    juan.minutes === 60,
    "TEST 3: Juan debe terminar con 60 min."
  );

  console.assert(
    pedro.minutes === 60,
    "TEST 3: Pedro debe terminar con 60 min."
  );

  /*
    TEST 4
    -----------------------------------------------

    Caso completo inicial:

      00 → 01 | 2
      01 → 05 | 1
      05 → 06 | 3

    Total:

      120 + 240 + 180
      = 540

    540 / 5
      = 108 minutos por agente

    Como los bloques múltiples generan:

      Juan   60
      Miguel 60

    y posteriormente:

      Pedro  60
      Carlos 60
      Luis   60

    quedan 48 minutos para cada uno.

    La casilla individual debería completar
    exactamente esos 48 minutos.
  */

  const test4 =
    generateSchedule(
      agents,
      INITIAL_DEMAND
    );

  console.assert(
    !test4.error,
    "TEST 4: no debería haber error."
  );

  console.assert(
    test4.stats.target === 108,
    "TEST 4: objetivo esperado = 108 min."
  );

  console.assert(
    test4.schedule.every(
      (agent) =>
        agent.minutes === 108
    ),
    "TEST 4: todos deberían terminar con 108 min."
  );

  console.assert(
    test4.stats.difference === 0,
    "TEST 4: diferencia esperada = 0."
  );

  return {
    test1,
    test2,
    test3,
    test4,
  };
}

// =========================================================
// COMPONENTE REACT
// =========================================================

export default function App() {
  const [agents, setAgents] =
    useState(INITIAL_AGENTS);

  const [demand, setDemand] =
    useState(INITIAL_DEMAND);

  const result =
    useMemo(
      () =>
        generateSchedule(
          agents,
          demand
        ),
      [agents, demand]
    );

  // -------------------------------------------------------
  // AGENTES
  // -------------------------------------------------------

  function addAgent() {
    /*
      El ID es el orden de llegada.

      Si existen:

        1
        3
        5

      el próximo será:

        6

      Nunca reutilizamos un ID eliminado.
    */

    const nextId =
      Math.max(
        0,
        ...agents.map(
          (agent) =>
            agent.id
        )
      ) + 1;

    setAgents([
      ...agents,
      {
        id: nextId,
        name:
          `Agente ${nextId}`,
      },
    ]);
  }

  function removeAgent(id) {
    setAgents(
      agents.filter(
        (agent) =>
          agent.id !== id
      )
    );
  }

  function updateAgent(
    id,
    name
  ) {
    setAgents(
      agents.map(
        (agent) =>
          agent.id === id
            ? {
                ...agent,
                name,
              }
            : agent
      )
    );
  }

  // -------------------------------------------------------
  // DEMANDA
  // -------------------------------------------------------

  function addDemand() {
    const nextId =
      Math.max(
        0,
        ...demand.map(
          (item) =>
            item.id
        )
      ) + 1;

    setDemand([
      ...demand,
      {
        id: nextId,
        start: "00:00",
        end: "01:00",
        booths: 1,
      },
    ]);
  }

  function removeDemand(id) {
    setDemand(
      demand.filter(
        (item) =>
          item.id !== id
      )
    );
  }

  function updateDemand(
    id,
    field,
    value
  ) {
    setDemand(
      demand.map(
        (item) =>
          item.id === id
            ? {
                ...item,
                [field]:
                  field ===
                  "booths"
                    ? Number(
                        value
                      )
                    : value,
              }
            : item
      )
    );
  }

  // -------------------------------------------------------
  // RENDER
  // -------------------------------------------------------

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <h1>
            Gestión de horarios
          </h1>

          <p>
            Distribución automática
            de agentes y casillas
          </p>
        </header>

        {/* ================================================= */}
        {/* AGENTES */}
        {/* ================================================= */}

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Agentes
              </h2>

              <p className="card-description">
                El ID determina el orden
                de llegada.
              </p>
            </div>
          </div>

          <div className="agent-list">
            {agents.map(
              (agent) => (
                <div
                  key={agent.id}
                  className="agent-row"
                >
                  <div className="agent-number">
                    {agent.id}
                  </div>

                  <input
                    className="input input-name"
                    value={
                      agent.name
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
                  />

                  <button
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
            onClick={addAgent}
          >
            + Agregar agente
          </button>
        </section>

        {/* ================================================= */}
        {/* DEMANDA */}
        {/* ================================================= */}

        <section
          style={{
            marginTop: 40,
          }}
        >
          <h2>
            Horarios de casillas
          </h2>

          <p>
            Los bloques con varias
            casillas se mantienen
            completos. Las casillas
            individuales se utilizan
            posteriormente para
            completar los minutos
            faltantes.
          </p>

          <div className="demand-list">
            {demand.map(
              (item) => (
                <div
                  key={item.id}
                  className="demand-row"
                >
                  <input
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
                  />

                  <span className="time-arrow">
                    →
                  </span>

                  <input
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
                  />

                  <div className="field">
                    <span className="field-label">
                      Casillas:
                    </span>

                    <input
                      className="input input-number"
                      type="number"
                      min="1"
                      value={
                        item.booths
                      }
                      onChange={(
                        event
                      ) =>
                        updateDemand(
                          item.id,
                          "booths",
                          event.target
                            .value
                        )
                      }
                    />
                  </div>

                  <button
                    className="button button-danger"
                    onClick={() =>
                      removeDemand(
                        item.id
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
            className="button button-secondary"
            onClick={addDemand}
          >
            + Agregar intervalo
          </button>
        </section>

        {/* ================================================= */}
        {/* ERROR */}
        {/* ================================================= */}

        {result.error && (
          <div className="error">
            {result.error}
          </div>
        )}

        {/* ================================================= */}
        {/* RESULTADO */}
        {/* ================================================= */}

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
                  Demanda total
                </div>

                <div className="stat-value">
                  {formatMinutes(
                    result.stats
                      .totalWork
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
                  Menor carga
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

            {/* ================================================= */}
            {/* TABLA */}
            {/* ================================================= */}

            <div className="table-wrapper">
              <table className="schedule-table">
                <thead>
                  <tr>
                    <th>
                      Agente
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
                    (agent) => (
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
                            {agent.name}
                          </strong>

                          <div
                            style={{
                              fontSize:
                                12,
                              color:
                                "#777",
                              marginTop:
                                4,
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
                            agent.minutes
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
                                <span className="assignment-time">
                                  {minutesToTime(
                                    assignment.start
                                  )}

                                  {" → "}

                                  {minutesToTime(
                                    assignment.end
                                  )}
                                </span>

                                <span className="assignment-booth">
                                  Casilla{" "}
                                  {
                                    assignment.booth
                                  }
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
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
