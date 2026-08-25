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

  const releaseDeadline =
    nextStart - TRAVEL_TIME;

  const required =
    nextDemand.booths;

  /*
    Agentes que ya están disponibles con
    suficiente anticipación para desplazarse.
  */
  const availableAgents =
    agents.filter(
      (agent) =>
        agent.availableAt <=
        releaseDeadline
    );

  const missing =
    required -
    availableAgents.length;

  if (missing <= 0) {
    return [];
  }

  /*
    Los agentes que necesitamos reservar
    para la próxima apertura.

    Priorizamos los de mayor carga.
  */
  const candidates =
    agents
      .filter(
        (agent) =>
          !availableAgents.includes(
            agent
          )
      )
      .sort((a, b) => {
        if (
          a.minutes !==
          b.minutes
        ) {
          return (
            b.minutes -
            a.minutes
          );
        }

        return (
          a.id -
          b.id
        );
      });

  return candidates.slice(
    0,
    missing
  );
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
    const currentTime =
      current;

    const remainingInterval =
      end - currentTime;

    /*
      Buscamos la próxima apertura.
    */
    const nextDemand =
      getNextDemand(
        demand,
        currentTime
      );

    let releaseDeadline =
      Infinity;

    if (nextDemand) {
      const nextStart =
        timeToMinutes(
          nextDemand.start
        );

      releaseDeadline =
        nextStart -
        TRAVEL_TIME;
    }

    /*
      Agentes que necesitamos reservar
      para la próxima apertura.
    */
    const agentsToRelease =
      getAgentsNeededForNextDemand(
        agents,
        demand,
        currentTime
      );

    /*
      Construimos los candidatos.

      IMPORTANTE:
      hacemos todos los cálculos aquí,
      antes del sort, para evitar el error
      no-loop-func.
    */
    const candidates =
      agents.map((agent) => {
        const target =
          targets.find(
            (item) =>
              item.id === agent.id
          ).target;

        const remaining =
          target -
          agent.minutes;

        const last =
          agent.assignments[
            agent.assignments.length - 1
          ];

        const continuity =
          last &&
          last.end ===
            currentTime
            ? 1
            : 0;

        const mustRelease =
          agentsToRelease.includes(
            agent
          );

        return {
          agent,
          target,
          remaining,
          continuity,
          mustRelease,
        };
      });

    /*
      Orden de prioridad:

      1. No utilizar agentes reservados.
      2. Continuidad.
      3. Menor carga / mayor necesidad
         de minutos.
    */
    candidates.sort(
      (a, b) => {
        if (
          a.mustRelease !==
          b.mustRelease
        ) {
          return a.mustRelease
            ? 1
            : -1;
        }

        if (
          a.continuity !==
          b.continuity
        ) {
          return (
            b.continuity -
            a.continuity
          );
        }

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
      }
    );

    if (
      candidates.length === 0
    ) {
      break;
    }

    let selected =
      candidates[0];

    /*
      Si por alguna razón el primero
      está reservado, buscamos otro.
    */
    if (
      selected.mustRelease
    ) {
      const alternative =
        candidates.find(
          (candidate) =>
            !candidate.mustRelease
        );

      if (alternative) {
        selected =
          alternative;
      }
    }

    /*
      --------------------------------------------------
      CÁLCULO DEL TIEMPO DISPONIBLE
      --------------------------------------------------

      El agente puede trabajar como máximo
      hasta el momento en que necesitamos
      liberar a los agentes reservados.
    */
    let maxDuration =
      remainingInterval;

    if (
      releaseDeadline !==
      Infinity
    ) {
      maxDuration =
        Math.max(
          0,
          releaseDeadline -
            currentTime
        );
    }

    /*
      Si no queda tiempo antes del desplazamiento,
      necesitamos entrar directamente en
      la etapa de relevo.
    */
    if (
      maxDuration <= 0
    ) {
      const fallback =
        candidates.find(
          (candidate) =>
            !candidate.mustRelease
        );

      if (!fallback) {
        break;
      }

      selected =
        fallback;

      maxDuration =
        remainingInterval;
    }

    /*
      --------------------------------------------------
      DURACIÓN DINÁMICA
      --------------------------------------------------

      No usamos siempre 30 minutos.

      Calculamos cuánto debería trabajar
      este agente según su carga.
    */
    let duration =
      maxDuration;

    const nextNonReserved =
      candidates.find(
        (candidate) =>
          !candidate.mustRelease
      );

    if (
      nextNonReserved &&
      !selected.mustRelease
    ) {
      const currentLoad =
        selected.agent.minutes;

      const otherLoad =
        nextNonReserved
          .agent.minutes;

      /*
        Si hay una diferencia de carga,
        el agente con más carga recibe
        menos tiempo.

        Esto permite producir cosas como:

          Pedro 40 min
          Juan 20 min
          Marcos 30 min

        en lugar de forzar siempre
        intervalos idénticos.
      */
      if (
        currentLoad >
        otherLoad
      ) {
        const difference =
          currentLoad -
          otherLoad;

        duration =
          Math.min(
            duration,
            Math.max(
              1,
              Math.floor(
                duration -
                  difference /
                    2
              )
            )
          );
      }
    }

    /*
      Nunca superar el intervalo.
    */
    duration =
      Math.min(
        duration,
        remainingInterval
      );

    if (
      duration <= 0
    ) {
      break;
    }

    /*
      --------------------------------------------------
      ASIGNACIÓN
      --------------------------------------------------
    */
    addAssignment(
      selected.agent,
      currentTime,
      currentTime +
        duration,
      1
    );

    selected.agent.minutes +=
      duration;

    selected.agent.availableAt =
      currentTime +
      duration;

    current =
      currentTime +
      duration;
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
