import { useMemo, useState } from "react";
import './App.css';

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
const TRAVEL_TIME = 30;

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
// VALIDAR DEMANDA
// =========================================================

function validateDemand(agents, demand) {
  if (agents.length === 0) {
    return "Debe existir al menos un agente.";
  }

  for (const item of demand) {
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);

    if (start >= end) {
      return `Horario inválido: ${item.start} → ${item.end}`;
    }

    if (item.booths < 1) {
      return "La cantidad de casillas debe ser mayor a 0.";
    }

    if (item.booths > agents.length) {
      return (
        `El intervalo ${item.start} → ${item.end} ` +
        `requiere ${item.booths} casillas pero solo hay ` +
        `${agents.length} agentes.`
      );
    }
  }

  // Los intervalos representan demanda absoluta,
  // por lo tanto no permitimos superposición.
  const sorted = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = timeToMinutes(
      sorted[i - 1].end
    );

    const currentStart = timeToMinutes(
      sorted[i].start
    );

    if (currentStart < previousEnd) {
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
// CARGA TOTAL
// =========================================================

function calculateTotalWork(demand) {
  return demand.reduce((total, item) => {
    const duration =
      timeToMinutes(item.end) -
      timeToMinutes(item.start);

    return total + duration * item.booths;
  }, 0);
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

/*
function addAssignment(
  agent,
  start,
  end,
  booth
) {
  const last =
    agent.assignments[
      agent.assignments.length - 1
    ];

  
    Si el nuevo turno es inmediatamente posterior
    y pertenece a la misma casilla, lo unimos.
  

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
*/

// =========================================================
// SELECCIONAR AGENTES PARA UN BLOQUE FIJO
// =========================================================

function selectAgentsForFixedBlock(
  agents,
  quantity,
  duration
) {
  return [...agents]
    .sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes;
      }

      return a.id - b.id;
    })
    .slice(0, quantity);
}
/*
function selectAgentsForFixedBlock(
  agents,
  quantity,
  duration
) {
  
    Para una demanda de 2 o más casillas:

        00:00 → 01:00
        2 casillas

    elegimos 2 agentes y ambos hacen la hora completa.

    La prioridad es:
    1. Menor cantidad de minutos acumulados.
    2. ID como desempate estable.
  

  return [...agents]
    .sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes;
      }

      return a.id - b.id;
    })
    .slice(0, quantity);
}
*/

// =========================================================
// CALCULAR OBJETIVOS FINALES
// =========================================================

function calculateFinalTargets(
  agents,
  flexibleMinutes,
  totalWork
) {
  /*
    El objetivo ya no se utiliza para forzar una
    distribución exacta.

    Se mantiene como referencia para el balance final,
    pero las necesidades operativas futuras tienen
    prioridad.
  */

  const target =
    totalWork / agents.length;

  return agents.map((agent) => ({
    id: agent.id,
    target,
  }));
}
/*
function calculateFinalTargets(
  agents,
  flexibleMinutes,
  totalWork
) {
  
    Tenemos las horas que ya fueron asignadas por
    bloques fijos.

    Ahora distribuimos los minutos flexibles intentando
    igualar la carga final.

    Ejemplo:

        A = 60
        B = 60
        C = 60
        D = 60
        E = 0

    Si quedan 240 minutos flexibles:

        E recibe 96
        A/B/C/D reciben 36

    Resultado:

        todos = 96
  

  const targets = agents.map((agent) => ({
    id: agent.id,
    target: agent.minutes,
  }));

  let remaining = flexibleMinutes;

  while (remaining > 0) {
    targets.sort((a, b) => {
      if (a.target !== b.target) {
        return a.target - b.target;
      }

      return a.id - b.id;
    });

    targets[0].target += 1;
    remaining--;
  }

  return targets;
}
*/

// =========================================================
// ASIGNAR INTERVALO DE UNA SOLA CASILLA
// =========================================================

function getNextDemand(
  demand,
  currentTime
) {
  return demand
    .filter(
      (item) =>
        timeToMinutes(item.start) > currentTime
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
        timeToMinutes(b.start)
    )[0];
}

function getRequiredAgentsAt(
  demand,
  time
) {
  return demand
    .filter((item) => {
      const start = timeToMinutes(item.start);
      const end = timeToMinutes(item.end);

      return (
        start <= time &&
        time < end
      );
    })
    .reduce(
      (total, item) =>
        total + item.booths,
      0
    );
}


function getAgentsNeededForNextDemand(
  agents,
  demand,
  currentTime
) {
  const nextDemand =
    getNextDemand(
      demand,
      currentTime
    );

  if (!nextDemand) {
    return [];
  }

  const nextStart =
    timeToMinutes(
      nextDemand.start
    );

  /*
    Los agentes que deben quedar libres antes
    de la próxima apertura.

    Ejemplo:

      ahora = 03:30
      próxima apertura = 05:00
      TRAVEL_TIME = 30

    Los agentes necesarios deben quedar
    disponibles como máximo a las 04:30.
  */

  const releaseDeadline =
    nextStart - TRAVEL_TIME;

  const required =
    nextDemand.booths;

  const currentlyFree =
    agents.filter(
      (agent) =>
        agent.availableAt <=
        releaseDeadline
    );

  if (
    currentlyFree.length >= required
  ) {
    return [];
  }

  const missing =
    required -
    currentlyFree.length;

  return [...agents]
    .filter(
      (agent) =>
        !currentlyFree.includes(agent)
    )
    .sort((a, b) => {
      /*
        Primero liberamos a los agentes
        con mayor carga.

        Así preservamos a los agentes
        con menos minutos para el equilibrio.
      */

      if (a.minutes !== b.minutes) {
        return b.minutes - a.minutes;
      }

      return a.id - b.id;
    })
    .slice(0, missing);
}


function calculateTransitionPenalty(
  agent,
  currentTime,
  demand
) {
  const nextDemand =
    getNextDemand(
      demand,
      currentTime
    );

  if (!nextDemand) {
    return 0;
  }

  const nextStart =
    timeToMinutes(
      nextDemand.start
    );

  const timeUntilNext =
    nextStart - currentTime;

  /*
    Si estamos cerca de una apertura futura,
    penalizamos utilizar agentes que necesitaremos
    para esa apertura.
  */

  if (
    timeUntilNext <=
    TRAVEL_TIME
  ) {
    return 100000;
  }

  if (
    timeUntilNext <=
    TRAVEL_TIME * 2
  ) {
    return 1000;
  }

  return 0;
}

function assignFlexibleInterval(
  agents,
  interval,
  targets,
  demand
) {
  let current =
    timeToMinutes(
      interval.start
    );

  const end =
    timeToMinutes(
      interval.end
    );

  while (current < end) {
    const remainingInterval =
      end - current;

    /*
      Detectamos qué agentes necesitamos
      liberar para la próxima apertura.
    */

    const agentsToRelease =
      getAgentsNeededForNextDemand(
        agents,
        demand,
        current
      );

    const candidates =
      agents
        .map((agent) => {
          const target =
            targets.find(
              (item) =>
                item.id === agent.id
            ).target;

          const remaining =
            target -
            agent.minutes;

          const transitionPenalty =
            agentsToRelease.includes(agent)
              ? 100000
              : calculateTransitionPenalty(
                  agent,
                  current,
                  demand
                );

          const last =
            agent.assignments[
              agent.assignments.length - 1
            ];

          const continuity =
            last &&
            last.end === current
              ? 1
              : 0;

          return {
            agent,
            remaining,
            continuity,
            transitionPenalty,
          };
        })
        .sort((a, b) => {
          /*
            PRIORIDAD 1:
            No utilizar agentes que necesitamos
            liberar para la próxima apertura.
          */

          if (
            a.transitionPenalty !==
            b.transitionPenalty
          ) {
            return (
              a.transitionPenalty -
              b.transitionPenalty
            );
          }

          /*
            PRIORIDAD 2:
            Continuidad de la casilla.
          */

          if (
            a.continuity !==
            b.continuity
          ) {
            return (
              b.continuity -
              a.continuity
            );
          }

          /*
            PRIORIDAD 3:
            Balance de carga.
          */

          if (
            a.remaining !==
            b.remaining
          ) {
            return (
              b.remaining -
              a.remaining
            );
          }

          return (
            a.agent.id -
            b.agent.id
          );
        });

    let selected =
      candidates[0];

    if (!selected) {
      break;
    }

    /*
      Si el agente seleccionado tiene que
      quedar libre para la próxima apertura,
      buscamos otro agente.

      Esto permite que aparezca un relevo.
    */

    if (
      agentsToRelease.includes(
        selected.agent
      )
    ) {
      const alternative =
        candidates.find(
          (candidate) =>
            !agentsToRelease.includes(
              candidate.agent
            )
        );

      if (alternative) {
        selected = alternative;
      }
    }

    if (!selected) {
      break;
    }

    let duration;

    /*
      Calculamos cuánto tiempo puede continuar
      este agente antes de que necesitemos
      liberar a los agentes destinados a la
      siguiente apertura.
    */

    const nextDemand =
      getNextDemand(
        demand,
        current
      );

    let maximumUntilTransition =
      remainingInterval;

    if (nextDemand) {
      const nextStart =
        timeToMinutes(
          nextDemand.start
        );

      const releaseDeadline =
        nextStart -
        TRAVEL_TIME;

      maximumUntilTransition =
        Math.max(
          0,
          releaseDeadline -
            current
        );
    }

    /*
      Evitamos que una sola persona absorba
      todo el intervalo si necesitamos preparar
      la siguiente apertura.
    */

    duration = Math.min(
      remainingInterval,
      maximumUntilTransition
    );

    /*
      Si ya estamos dentro de la ventana
      de transición, usamos un tramo corto
      para forzar el relevo.
    */

    if (duration <= 0) {
      duration = Math.min(
        remainingInterval,
        30
      );
    }

    if (duration <= 0) {
      break;
    }

    addAssignment(
      selected.agent,
      current,
      current + duration,
      1
    );

    selected.agent.minutes +=
      duration;

    selected.agent.availableAt =
      current + duration;

    current += duration;
  }
}
/*
function assignFlexibleInterval(
  agents,
  interval,
  targets
) {
  let current = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);

  
    Esta función trabaja en minutos reales.

    NO utiliza slots de 5 minutos.

    Por eso puede producir:

        01:00 → 01:48
        01:48 → 02:36

    etc.
  

  while (current < end) {
    const remainingInterval = end - current;

    
      Cuánto le falta a cada agente para llegar
      a su objetivo.
    
    const currentTime = current;
    
    const candidates = agents
      .map((agent) => {
        const target =
          targets.find(
            (item) => item.id === agent.id
          ).target;

        return {
          agent,
          target,
          remaining:
            target - agent.minutes,
        };
      })
      .sort((a, b) => {
        
          Primero el que más necesita minutos.
        

        if (a.remaining !== b.remaining) {
          return b.remaining - a.remaining;
        }

        
          Si están empatados, preferimos continuar
          con el mismo agente si estaba trabajando.
        

        const aLast =
          a.agent.assignments[
            a.agent.assignments.length - 1
          ];

        const bLast =
          b.agent.assignments[
            b.agent.assignments.length - 1
          ];

        const aContinuity =
          aLast && aLast.end === currentTime ? 1 : 0;

        const bContinuity =
          bLast && bLast.end === currentTime ? 1 : 0;

        if (aContinuity !== bContinuity) {
          return bContinuity - aContinuity;
        }

        return a.agent.id - b.agent.id;
      });

    const selected = candidates[0];

    if (!selected) {
      break;
    }

    
      Si todos ya llegaron al objetivo, buscamos al que
      tenga menor carga para absorber el sobrante.
    

    let duration;

    if (selected.remaining > 0) {
      duration = Math.min(
        selected.remaining,
        remainingInterval
      );
    } else {
      const lowest = [...agents].sort(
        (a, b) => a.minutes - b.minutes
      )[0];

      selected.agent = lowest;

      duration = remainingInterval;
    }

    if (duration <= 0) {
      break;
    }

    addAssignment(
      selected.agent,
      current,
      current + duration,
      1
    );

    selected.agent.minutes += duration;

    current += duration;
  }
}
*/

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

function generateSchedule(
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
        assignments: [],
        availableAt: 0,
      })
    );

  const sortedDemand =
    [...demand].sort(
      (a, b) =>
        timeToMinutes(
          a.start
        ) -
        timeToMinutes(
          b.start
        )
    );

  const totalWork =
    calculateTotalWork(
      sortedDemand
    );

  /*
    -----------------------------------------------------
    PASO 1
    BLOQUES DE MÚLTIPLES CASILLAS
    -----------------------------------------------------
  */

  const fixedIntervals =
    sortedDemand.filter(
      (item) =>
        item.booths >= 2
    );

  for (
    const interval
    of fixedIntervals
  ) {
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
        end - start
      );

    selected.forEach(
      (agent, index) => {
        addAssignment(
          agent,
          start,
          end,
          index + 1
        );

        agent.minutes +=
          end - start;

        agent.availableAt =
          end;
      }
    );
  }

  /*
    -----------------------------------------------------
    PASO 2
    INTERVALOS FLEXIBLES
    -----------------------------------------------------
  */

  const flexibleIntervals =
    sortedDemand.filter(
      (item) =>
        item.booths === 1
    );

  const flexibleMinutes =
    flexibleIntervals.reduce(
      (
        total,
        interval
      ) => {
        return (
          total +
          timeToMinutes(
            interval.end
          ) -
          timeToMinutes(
            interval.start
          )
        );
      },
      0
    );

  /*
    -----------------------------------------------------
    PASO 3
    OBJETIVOS DE CARGA
    -----------------------------------------------------
  */

  const targets =
    calculateFinalTargets(
      agents,
      flexibleMinutes,
      totalWork
    );

  /*
    -----------------------------------------------------
    PASO 4
    ASIGNACIÓN CON LOOK-AHEAD
    -----------------------------------------------------
  */

  for (
    const interval
    of flexibleIntervals
  ) {
    assignFlexibleInterval(
      agents,
      interval,
      targets,
      sortedDemand
    );
  }

  /*
    -----------------------------------------------------
    RESULTADO
    -----------------------------------------------------
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

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference:
        maxMinutes -
        minMinutes,
    },
  };
}

/*
function generateSchedule(
  agentsInput,
  demand
) {
  const error = validateDemand(
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

  const agents = agentsInput.map((agent) => ({
    ...agent,
    minutes: 0,
    assignments: [],
  }));

  const sortedDemand = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  const totalWork =
    calculateTotalWork(sortedDemand);

  
    -----------------------------------------------------
    PASO 1
    -----------------------------------------------------

    Asignamos primero los bloques de 2 o más casillas.

    Ejemplo:

        00–01 → 2
        05–06 → 3

    Estos bloques NO se dividen.
  

  const fixedIntervals = sortedDemand.filter(
    (item) => item.booths >= 2
  );

  for (const interval of fixedIntervals) {
    const start = timeToMinutes(
      interval.start
    );

    const end = timeToMinutes(
      interval.end
    );

    const selected =
      selectAgentsForFixedBlock(
        agents,
        interval.booths,
        end - start
      );

    selected.forEach((agent, index) => {
      addAssignment(
        agent,
        start,
        end,
        index + 1
      );

      agent.minutes += end - start;
    });
  }

  
    -----------------------------------------------------
    PASO 2
    -----------------------------------------------------

    Calculamos cuánto tiempo queda en intervalos
    de una sola casilla.
  

  const flexibleIntervals =
    sortedDemand.filter(
      (item) => item.booths === 1
    );

  const flexibleMinutes =
    flexibleIntervals.reduce(
      (total, interval) => {
        return (
          total +
          timeToMinutes(interval.end) -
          timeToMinutes(interval.start)
        );
      },
      0
    );

  
    -----------------------------------------------------
    PASO 3
    -----------------------------------------------------

    Calculamos el objetivo final de cada agente.

    Esto tiene en cuenta los bloques fijos que ya
    asignamos.
  

  const targets = calculateFinalTargets(
    agents,
    flexibleMinutes,
    totalWork
  );

  
    -----------------------------------------------------
    PASO 4
    -----------------------------------------------------

    Ahora utilizamos las horas de una sola casilla
    como "espacio flexible" para igualar las cargas.

    Es aquí donde pueden aparecer minutos arbitrarios:

        48 min
        36 min
        17 min
        etc.
  

  for (const interval of flexibleIntervals) {
    assignFlexibleInterval(
      agents,
      interval,
      targets
    );
  }

  
    -----------------------------------------------------
    RESULTADO
    -----------------------------------------------------
  

  const loads = agents.map(
    (agent) => agent.minutes
  );

  const minMinutes = Math.min(...loads);
  const maxMinutes = Math.max(...loads);

  const target =
    totalWork / agents.length;

  return {
    error: null,

    schedule: agents,

    stats: {
      totalWork,
      target,
      minMinutes,
      maxMinutes,
      difference:
        maxMinutes - minMinutes,
    },
  };
}
*/

// =========================================================
// COMPONENTE REACT
// =========================================================

export default function App() {
  const [agents, setAgents] =
    useState(INITIAL_AGENTS);

  const [demand, setDemand] =
    useState(INITIAL_DEMAND);

  const result = useMemo(() => {
    return generateSchedule(
      agents,
      demand
    );
  }, [agents, demand]);

  // -------------------------------------------------------
  // AGENTES
  // -------------------------------------------------------

  function addAgent() {
    const nextId =
      Math.max(
        0,
        ...agents.map((agent) => agent.id)
      ) + 1;

    setAgents([
      ...agents,
      {
        id: nextId,
        name: `Agente ${nextId}`,
      },
    ]);
  }

  function removeAgent(id) {
    setAgents(
      agents.filter(
        (agent) => agent.id !== id
      )
    );
  }

  function updateAgent(id, name) {
    setAgents(
      agents.map((agent) =>
        agent.id === id
          ? { ...agent, name }
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
        ...demand.map((item) => item.id)
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
        (item) => item.id !== id
      )
    );
  }

  function updateDemand(
    id,
    field,
    value
  ) {
    setDemand(
      demand.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]:
                field === "booths"
                  ? Number(value)
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
          <h1>Gestión de horarios</h1>
          <p>Distribución automática de agentes y casillas</p>
    </header>
      {/* ================================================= */}
      {/* AGENTES */}
      {/* ================================================= */}
    
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Agentes</h2>
            <p className="card-description">Personas disponibles para cubrir las casillas.</p>
          </div>
        <div className="agent-list">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="agent-row"
          >
              <div className="agent-number">
                {agent.id}
              </div>
            <input
              className="input input-name"
              value={agent.name}
              onChange={(event) =>
                updateAgent(
                  agent.id,
                  event.target.value
                )
              }
            />

            <button
              className="button button-danger"
              onClick={() =>
                removeAgent(agent.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}
        </div>

        <button 
          className="button button-primary"
          onClick={addAgent}>
          + Agregar agente
        </button>
        </div>
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
          Los intervalos de 2 o más casillas
          se consideran bloques completos.
          Los intervalos de una sola casilla
          se utilizan para equilibrar las horas.
        </p>
        <div className="demand-list">
        {demand.map((item) => (
          <div
            key={item.id}
            className="demand-row"
          >
            <input
              className="input input-time"
              type="time"
              value={item.start}
              onChange={(event) =>
                updateDemand(
                  item.id,
                  "start",
                  event.target.value
                )
              }
            />

            <span className="time-arrow">→</span>

            <input
              className="input input-time"
              type="time"
              value={item.end}
              onChange={(event) =>
                updateDemand(
                  item.id,
                  "end",
                  event.target.value
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
                value={item.booths}
                onChange={(event) =>
                  updateDemand(
                    item.id,
                    "booths",
                    event.target.value
                  )
                }
              />
            </div>

            <button
              className="button button-danger"
              onClick={() =>
                removeDemand(item.id)
              }
            >
              Eliminar
            </button>
          </div>
        ))}
        </div>

        <button
          className="button button-secondary"
          onClick={addDemand}>
          + Agregar intervalo
        </button>
      </section>

      {/* ================================================= */}
      {/* ERROR */}
      {/* ================================================= */}

      {result.error && (
        <div
          className="error"
        >
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
          <h2>Resultado</h2>

          <div className="stats" >
            <div className="stat">
              <div className="stat-label">
                Demanda total
              </div>

              <div className="stat-value">
                {formatMinutes(
                  result.stats.totalWork
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

              <div className="stat-value" >
                {formatMinutes(
                  result.stats.minMinutes
                )}
              </div>
            </div>

            <div className="stat">
              <div className="stat-label">
                Diferencia Máxima
              </div>

              <div className={`stat-value ${
                result.stats.difference <= 1
                ? "good"
                : "warning"
                }`}>
                {result.stats.difference} min
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
                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Agente
                </th>

                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Total
                </th>

                <th
                  style={{
                    textAlign: "left",
                    padding: 8,
                    borderBottom:
                      "1px solid #ccc",
                  }}
                >
                  Turnos
                </th>
              </tr>
            </thead>

            <tbody>
              {result.schedule.map(
                (agent) => (
                  <tr key={agent.id}>
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
                            key={index}
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
                            Casilla {assignment.booth}
                            </span>
                            {" — "}

                            <span>
                            {assignment.minutes} min
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
