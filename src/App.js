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


// =========================================================
// SELECCIONAR AGENTES PARA UN BLOQUE FIJO
// =========================================================

function selectAgentsForFixedBlock(
  agents,
  quantity
) {
  return [...agents]
    .sort((a, b) => {
      /*
        1. Orden de llegada
        2. Menor carga como desempate
      */

      if (
        a.id !== b.id
      ) {
        return a.id - b.id;
      }

      return (
        a.minutes -
        b.minutes
      );
    })
    .slice(
      0,
      quantity
    );
}

// =========================================================
// ASIGNAR INTERVALO DE UNA SOLA CASILLA
// =========================================================

function selectReservedAgents(
  agents,
  demand,
  currentTime
) {
  const nextDemand = [...demand]
    .filter(
      (item) =>
        timeToMinutes(item.start) >
          currentTime &&
        item.booths >= 2
    )
    .sort(
      (a, b) =>
        timeToMinutes(a.start) -
        timeToMinutes(b.start)
    )[0];

  if (!nextDemand) {
    return [];
  }

  const nextStart =
    timeToMinutes(
      nextDemand.start
    );

  const releaseDeadline =
    nextStart -
    TRAVEL_TIME;

  const required =
    nextDemand.booths;

  const candidates =
    agents
      .filter(
        (agent) =>
          agent.availableAt <=
          releaseDeadline
      )
      .sort(
        (a, b) =>
          a.id - b.id
      );

  return candidates.slice(
    0,
    required
  );
}

function getRemainingNeed(
  agent,
  agents,
  totalWork
) {
  const target =
    totalWork / agents.length;

  return Math.max(
    0,
    target - agent.minutes
  );
}

function assignFlexibleInterval(
  agents,
  interval,
  demand,
  totalWork
) {
  let current =
    timeToMinutes(interval.start);

  const end =
    timeToMinutes(interval.end);

  while (current < end) {
    const currentStart = current;

    /*
      --------------------------------------------------
      PRÓXIMA DEMANDA DE MÚLTIPLES CASILLAS
      --------------------------------------------------
    */

    const nextDemand = [...demand]
      .filter(
        (item) =>
          timeToMinutes(item.start) >
            currentStart &&
          item.booths >= 2
      )
      .sort(
        (a, b) =>
          timeToMinutes(a.start) -
          timeToMinutes(b.start)
      )[0];

    let releaseDeadline = Infinity;

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
      --------------------------------------------------
      AGENTES RESERVADOS
      --------------------------------------------------
    */

    const reservedAgents =
      selectReservedAgents(
        agents,
        demand,
        currentStart
      );

    /*
      --------------------------------------------------
      DEFINIR SI ESTAMOS ANTES O DESPUÉS
      DEL DEADLINE
      --------------------------------------------------
    */

    const beforeDeadline =
      currentStart <
      releaseDeadline;

    /*
      --------------------------------------------------
      DEFINIR EL FINAL DEL SEGMENTO
      --------------------------------------------------
    */

    let segmentEnd = end;

    if (
      beforeDeadline &&
      releaseDeadline < end
    ) {
      segmentEnd =
        releaseDeadline;
    }

    const currentEnd =
      segmentEnd;

    if (
      currentEnd <= currentStart
    ) {
      break;
    }

    /*
      --------------------------------------------------
      SELECCIONAR CANDIDATOS
      --------------------------------------------------

      ANTES del deadline:

        solamente agentes reservados.

      DESPUÉS del deadline:

        solamente agentes NO reservados.
    */

    let candidateAgents;

    if (beforeDeadline) {
      candidateAgents =
        agents.filter(
          (agent) =>
            reservedAgents.includes(
              agent
            )
        );
    } else {
      candidateAgents =
        agents.filter(
          (agent) =>
            !reservedAgents.includes(
              agent
            )
        );
    }

    /*
      --------------------------------------------------
      FILTRAR DISPONIBILIDAD
      --------------------------------------------------
    */

    candidateAgents =
      candidateAgents.filter(
        (agent) =>
          agent.availableAt <=
          currentStart
      );

    if (
      candidateAgents.length === 0
    ) {
      /*
        No hay agentes disponibles.
      */

      if (
        releaseDeadline !== Infinity &&
        currentStart <
          releaseDeadline
      ) {
        current =
          releaseDeadline;

        continue;
      }

      break;
    }

    /*
      --------------------------------------------------
      ORDEN FIFO
      --------------------------------------------------
    */

    candidateAgents.sort(
      (a, b) => {
        /*
          Primero orden de llegada.
        */

        if (
          a.id !== b.id
        ) {
          return (
            a.id - b.id
          );
        }

        /*
          Luego menor carga.
        */

        return (
          a.minutes -
          b.minutes
        );
      }
    );

    /*
      --------------------------------------------------
      CALCULAR DURACIÓN
      --------------------------------------------------
    */

    const remainingTime =
      currentEnd -
      currentStart;

    /*
      Si tenemos varios agentes reservados,
      dividimos el tramo entre ellos.

      Ejemplo:

        03:30 → 04:30
        2 agentes

        60 / 2 = 30
    */

    const agentCount =
      candidateAgents.length;

    let duration =
      Math.floor(
        remainingTime /
        agentCount
      );

    duration =
      Math.max(
        1,
        duration
      );

    duration =
      Math.min(
        duration,
        remainingTime
      );

    /*
      --------------------------------------------------
      SELECCIONAR AGENTE
      --------------------------------------------------

      FIFO.
    */

    const selected =
      candidateAgents[0];

    /*
      --------------------------------------------------
      LIMITAR SEGÚN OBJETIVO
      --------------------------------------------------
    */

    const remainingNeed =
      getRemainingNeed(
        selected,
        agents,
        totalWork
      );

    if (
      remainingNeed > 0
    ) {
      duration =
        Math.min(
          duration,
          remainingNeed
        );
    }

    if (duration <= 0) {
      break;
    }

    /*
      --------------------------------------------------
      ASIGNAR
      --------------------------------------------------
    */

    addAssignment(
      selected,
      currentStart,
      currentStart + duration,
      1
    );

    selected.minutes +=
      duration;

    selected.availableAt =
      currentStart +
      duration;

    current =
      currentStart +
      duration;
  }
}

// =========================================================
// GENERADOR PRINCIPAL
// =========================================================

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

  const agents = agentsInput.map(
    (agent) => ({
      ...agent,
      minutes: 0,
      assignments: [],
      availableAt: 0,
    })
  );

  const sortedDemand = [...demand].sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );

  const totalWork =
    calculateTotalWork(sortedDemand);

  /*
    -----------------------------------------------------
    ASIGNACIÓN CRONOLÓGICA
    -----------------------------------------------------

    Ahora procesamos TODOS los intervalos
    en orden temporal.

    Esto es importante porque el algoritmo
    necesita conocer las demandas futuras.
  */

for (const interval of sortedDemand) {
  const start =
    timeToMinutes(interval.start);

  const end =
    timeToMinutes(interval.end);

  if (interval.booths >= 2) {
    const selected =
      selectAgentsForFixedBlock(
        agents,
        interval.booths
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
  } else {
    assignFlexibleInterval(
      agents,
      interval,
      sortedDemand,
      totalWork
    );
  }
}

  /*
    -----------------------------------------------------
    OBJETIVO FINAL
    -----------------------------------------------------
  */

  const target =
    totalWork /
    agents.length;

  /*
    -----------------------------------------------------
    RESULTADO
    -----------------------------------------------------
  */

  const loads =
    agents.map(
      (agent) => agent.minutes
    );

  const minMinutes =
    Math.min(...loads);

  const maxMinutes =
    Math.max(...loads);

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
